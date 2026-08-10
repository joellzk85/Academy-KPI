import React, { useState, useEffect } from 'react';
import { Quotation, QuotationItem, Representative } from '../types';
import { Plus, Trash2, Printer, Save, FileText, CheckCircle, RefreshCw, Layers, Edit3, ClipboardList, Info, Search, Eye, EyeOff, Tag, Share2, RotateCcw, Cloud, Check, Clock } from 'lucide-react';
import Logo from './Logo';
import { initAuth, googleSignIn, googleSignOut, syncQuotationToGoogleSheet } from '../lib/googleCalendar';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query } from 'firebase/firestore';

interface QuotationGeneratorProps {
  rep: Representative;
  reps?: Representative[];
  key?: string;
  requestManagerPermission?: (action: () => void) => void;
}

const DEFAULT_TERMS = [
  "Cancellation or rescheduling of training must be made in writing at least fourteen (14) working days prior to the commencement of the course.",
  "Any cancellation received less than fourteen (14) working days but more than seven (7) working days prior to the course date will be subject to a cancellation fee of 50% of the total course fee.",
  "For cancellations received less than seven (7) working days, or in case of non-attendance, 100% of the course fee will be charged and invoiced.",
  "Rescheduling is permitted up to seven (7) working days before the course starts, subject to slot availability and a rescheduling admin fee.",
  "Substitution of participants is permitted at no extra charge, provided NEXT Academy is notified in writing at least three (3) working days prior to training.",
  "Participants must achieve a minimum of 75% attendance for HRD Corp claims and to qualify for the Certificate of Attendance / Completion.",
  "Participants are required to participate fully in all training activities, assessments, and feedback sessions as requested by the trainers.",
  "Participants must comply with the training schedule, starting promptly at 9:00 AM and concluding at 5:00 PM unless otherwise specified.",
  "Late arrivals or early departures may result in disqualification of attendance records for certification and employer HRD Corp grant claims.",
  "All training materials, slides, hand-outs, videos, and intellectual property remain the exclusive property of NEXT Academy (1 Group).",
  "No part of the provided training materials may be reproduced, recorded, stored, or shared in any form without prior written permission.",
  "Materials distributed are for individual participant use only and may not be distributed or used for internal corporate retraining.",
  "Both parties agree to treat all business information and trade secrets disclosed during training as strictly confidential.",
  "Personal data of participants is collected and processed in compliance with the Personal Data Protection Act 2010 (PDPA) of Malaysia.",
  "Participants' personal info, emails, and phone numbers will be used solely for training administration, feedback, and certification purposes."
];

const defaultQuoteTemplate: Quotation = {
  id: 'q_default',
  refNumber: `1G/NA/${new Date().getFullYear()}${(new Date().getMonth()+1).toString().padStart(2,'0')}${new Date().getDate().toString().padStart(2,'0')}/01`,
  date: new Date().toISOString().substring(0, 10),
  attn: '',
  company: '',
  address: '',
  venue: '',
  time: '',
  participants: '',
  trainingProvider: '',
  items: [],
  remarks: [],
  terms: DEFAULT_TERMS
};

// Preset courses to load instantly
const coursePresets = [
  { program: 'F&B Basics Service Excellence', code: '10001669509', fee: 5500, trainer: 'Y Kanagalingam / M F Yogaretnam' },
  { program: 'Handling VIP Guest in F&B', code: '10001670249', fee: 5500, trainer: 'Y Kanagalingam / M F Yogaretnam' },
  { program: 'The wine languages: Understand Wine and Wine Service', code: '10001669756', fee: 5500, trainer: 'Chris Low' },
  { program: 'Full-Stack Web Engineering Boot Camp', code: '10001672345', fee: 6500, trainer: 'Sarah Amanda' },
  { program: 'React & AI Integration Workshop', code: '10001679901', fee: 6000, trainer: 'Dr. Jason Lee' },
  { program: 'Digital Product Design Thinking', code: '10001681211', fee: 4500, trainer: 'Aris Rahman' }
];

export default function QuotationGenerator({ rep, reps, requestManagerPermission }: QuotationGeneratorProps) {
  // Quotations List state (permanently tied to lzk.joel@gmail.com)
  const [quotations, setQuotations] = useState<Quotation[]>(() => {
    const TIED_KEY = 'next_quotations_lzk.joel@gmail.com';
    const saved = localStorage.getItem(TIED_KEY);
    
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const cleaned = parsed.map((q: Quotation) => {
          if (q.id === 'q_default' && (q.company === '1 Group (Melaka) Sdn Bhd' || q.company === '')) {
            return JSON.parse(JSON.stringify(defaultQuoteTemplate));
          }
          return q;
        });
        return cleaned;
      } catch (e) {
        // ignore
      }
    }

    // Migrate any legacy rep-specific quotations to the new lzk.joel@gmail.com key
    let migratedQuotes: Quotation[] = [];
    const legacyKeys = ['xin-ying', 'alif', 'atiqa', 'chee-cai', 'new-guy'];
    const seenIds = new Set<string>();

    legacyKeys.forEach(id => {
      const legacySaved = localStorage.getItem(`next_quotations_${id}`);
      if (legacySaved) {
        try {
          const parsed = JSON.parse(legacySaved);
          if (Array.isArray(parsed)) {
            parsed.forEach((q: Quotation) => {
              if (q && q.id && !seenIds.has(q.id)) {
                seenIds.add(q.id);
                migratedQuotes.push(q);
              }
            });
          }
        } catch (e) {
          // ignore
        }
      }
    });

    if (migratedQuotes.length > 0) {
      localStorage.setItem(TIED_KEY, JSON.stringify(migratedQuotes));
      return migratedQuotes;
    }

    const defaultList = [JSON.parse(JSON.stringify(defaultQuoteTemplate))];
    localStorage.setItem(TIED_KEY, JSON.stringify(defaultList));
    return defaultList;
  });

  // Undo States for Quotation Management
  const [previousQuotes, setPreviousQuotes] = useState<Quotation[] | null>(null);
  const [previousSelectedId, setPreviousSelectedId] = useState<string | null>(null);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);

  const handleUndo = async () => {
    if (previousQuotes) {
      setQuotations(previousQuotes);
      localStorage.setItem('next_quotations_lzk.joel@gmail.com', JSON.stringify(previousQuotes));
      if (previousSelectedId) {
        setSelectedId(previousSelectedId);
      }
      setPreviousQuotes(null);
      setPreviousSelectedId(null);
      setUndoMessage(null);
      
      // Sync reverted state to Firestore
      for (const q of previousQuotes) {
        try {
          await setDoc(doc(db, 'quotations', q.id), q);
        } catch (err) {
          console.error("Firestore undo sync failed:", err);
        }
      }
    }
  };

  // Quotation row specific actions (Edit/Tag)
  const [taggingQuoteRowId, setTaggingQuoteRowId] = useState<string | null>(null);
  
  const [tagTargetRepIds, setTagTargetRepIds] = useState<string[]>([]);
  const [tagNoteText, setTagNoteText] = useState('');
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  // Toast notification state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Custom Confirmation Modal states
  const [quoteToDeleteId, setQuoteToDeleteId] = useState<string | null>(null);
  const [tagResetId, setTagResetId] = useState<string | null>(null);

  const handleTagQuotationMultiple = async (q: Quotation) => {
    if (tagTargetRepIds.length === 0) return;
    try {
      setPreviousQuotes(JSON.parse(JSON.stringify(quotations)));
      setPreviousSelectedId(selectedId);
      setUndoMessage('Quotation tagged successfully.');

      let updated = [...quotations];
      const promises: Promise<void>[] = [];

      tagTargetRepIds.forEach(targetId => {
        const targetRep = reps?.find(r => r.id === targetId);
        if (!targetRep) return;

        const cloned: Quotation = JSON.parse(JSON.stringify(q));
        cloned.id = `q_tagged_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        
        // Ownership & Tag metadata
        cloned.creatorId = rep.id;
        cloned.preparedBy = rep.name;
        cloned.taggedRepId = targetId;
        cloned.taggedRepName = targetRep.name;
        cloned.taggedBy = rep.name;
        cloned.isCompleted = false;

        // Clear client metadata to ensure a clean slate before representative use
        cloned.attn = '';
        cloned.company = '';
        cloned.address = '';
        cloned.venue = '';
        cloned.time = '';
        cloned.participants = '';
        cloned.trainingProvider = '';

        if (tagNoteText.trim()) {
          cloned.tagNote = tagNoteText.trim();
        }

        updated.push(cloned);
        promises.push(setDoc(doc(db, 'quotations', cloned.id), cloned));
      });

      setQuotations(updated);
      localStorage.setItem('next_quotations_lzk.joel@gmail.com', JSON.stringify(updated));
      await Promise.all(promises);
      
      const names = tagTargetRepIds.map(id => reps?.find(r => r.id === id)?.name || id).join(', ');
      setActionStatus(`Successfully tagged ${names} on this quotation!`);
      setTagTargetRepIds([]);
      setTagNoteText('');
      
      setTimeout(() => {
        setActionStatus(null);
        setTaggingQuoteRowId(null);
      }, 3000);
    } catch (err) {
      console.error("Failed to tag quotation:", err);
      setActionStatus("Failed to tag quotation. Please try again.");
    }
  };

  const [selectedId, setSelectedId] = useState<string>(() => {
    const saved = localStorage.getItem('next_quotations_lzk.joel@gmail.com');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.length > 0) return parsed[0].id;
    }
    return 'q_default';
  });

  // Current Quotation data states
  const [refNumber, setRefNumber] = useState('');
  const [date, setDate] = useState('');
  const [attn, setAttn] = useState('');
  const [company, setCompany] = useState('');
  const [address, setAddress] = useState('');
  const [venue, setVenue] = useState('');
  const [time, setTime] = useState('');
  const [participants, setParticipants] = useState('');
  const [trainingProvider, setTrainingProvider] = useState('');
  const [items, setItems] = useState<QuotationItem[]>([]);
  const [remarks, setRemarks] = useState<string[]>([]);
  const [terms, setTerms] = useState<string[]>([]);
  const [applySST, setApplySST] = useState<boolean>(false);
  const [sstRate, setSstRate] = useState<number>(8);
  const [preparedBy, setPreparedBy] = useState<string>('');
  const [ownerId, setOwnerId] = useState<string>('');
  const [ownerName, setOwnerName] = useState<string>('');

  // Form input builders
  const [newItemProgram, setNewItemProgram] = useState('');
  const [newItemCode, setNewItemCode] = useState('');
  const [newItemDate, setNewItemDate] = useState('');
  const [newItemTrainer, setNewItemTrainer] = useState('');
  const [newItemFee, setNewItemFee] = useState('5500');
  const [newItemDays, setNewItemDays] = useState('2');

  const [newRemark, setNewRemark] = useState('');
  const [newTerm, setNewTerm] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');

  // Workspace Layout Mode ('split' | 'stacked' | 'edit-only' | 'preview-only')
  const [layoutMode, setLayoutMode] = useState<'split' | 'stacked' | 'edit-only' | 'preview-only'>('split');

  // Quotations Prepared Library list view states
  const [quoteSearchQuery, setQuoteSearchQuery] = useState('');
  const [quoteSortBy, setQuoteSortBy] = useState<'date' | 'created' | 'client'>('date');
  const [showHiddenQuotes, setShowHiddenQuotes] = useState(false);

  // Google Sheets Integration State
  const [googleUser, setGoogleUser] = useState<any>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [isSyncingSheets, setIsSyncingSheets] = useState(false);
  const [sheetsSyncMsg, setSheetsSyncMsg] = useState<string | null>(null);
  const [sheetsUrl, setSheetsUrl] = useState<string | null>(null);

  // Real-time Firestore sync for Quotations
  useEffect(() => {
    if (!db) return;

    const q = query(collection(db, 'quotations'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const firestoreQuotes: Quotation[] = [];
      snapshot.forEach((docSnap) => {
        firestoreQuotes.push({ ...docSnap.data() as Quotation, id: docSnap.id });
      });

      if (firestoreQuotes.length > 0) {
        // Maintain a stable sort order
        firestoreQuotes.sort((a, b) => a.id.localeCompare(b.id));
        setQuotations(firestoreQuotes);
        localStorage.setItem('next_quotations_lzk.joel@gmail.com', JSON.stringify(firestoreQuotes));
      } else {
        // Firestore genuinely has no quotations (either none created yet, or all
        // deleted). Reflect that truthfully instead of re-uploading stale
        // localStorage data or a hardcoded template, which would silently
        // resurrect deleted quotations.
        setQuotations([]);
        localStorage.setItem('next_quotations_lzk.joel@gmail.com', JSON.stringify([]));
      }
    });

    return () => unsubscribe();
  }, []);

  // Setup Firebase Auth Listener for Google Sheets Sync
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setGoogleUser(user);
        setGoogleToken(token);
      },
      () => {
        setGoogleUser(null);
        setGoogleToken(null);
      }
    );
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  const handleGoogleLogin = async () => {
    try {
      setSheetsSyncMsg("Opening Google Sign-In...");
      const res = await googleSignIn();
      if (res) {
        setGoogleUser(res.user);
        setGoogleToken(res.accessToken);
        setSheetsSyncMsg("Connected with Google account successfully!");
        setTimeout(() => setSheetsSyncMsg(null), 3000);
      }
    } catch (err: any) {
      console.error("Login failed:", err);
      setSheetsSyncMsg(`Failed to connect Google account: ${err.message || String(err)}`);
      setTimeout(() => setSheetsSyncMsg(null), 5000);
    }
  };

  const handleGoogleLogout = async () => {
    await googleSignOut();
    setGoogleUser(null);
    setGoogleToken(null);
    setSheetsUrl(null);
    setSheetsSyncMsg("Google account disconnected.");
    setTimeout(() => setSheetsSyncMsg(null), 3000);
  };

  const handleSyncToSheets = async () => {
    if (!googleToken) {
      setSheetsSyncMsg("Please connect your Google account first.");
      setTimeout(() => setSheetsSyncMsg(null), 3000);
      return;
    }

    setIsSyncingSheets(true);
    setSheetsSyncMsg("Syncing current quotation to Google Sheets...");
    try {
      const currentQuotation = {
        refNumber,
        date,
        attn,
        company,
        address,
        venue,
        time,
        participants,
        trainingProvider,
        items,
        remarks,
        terms,
        applySST,
        sstRate
      };

      const result = await syncQuotationToGoogleSheet(currentQuotation, rep.name);
      setSheetsUrl(result.spreadsheetUrl);
      setSheetsSyncMsg("Successfully saved to Google Sheets tracking log!");
    } catch (err: any) {
      console.error("Google Sheets Sync failed:", err);
      setSheetsSyncMsg(`Failed to save to Google Sheets: ${err.message || String(err)}`);
      setTimeout(() => setSheetsSyncMsg(null), 6000);
    } finally {
      setIsSyncingSheets(false);
    }
  };

  // Toggle Hide/Unhide a prepared quotation
  const toggleHideQuote = async (id: string) => {
    setPreviousQuotes(JSON.parse(JSON.stringify(quotations)));
    setPreviousSelectedId(selectedId);
    setUndoMessage('Quotation visibility toggled.');

    const updated = quotations.map(q => {
      if (q.id === id) {
        const updatedItem = { ...q, isHidden: !q.isHidden };
        // Sync to Firestore
        setDoc(doc(db, 'quotations', id), updatedItem).catch(err => console.error("Firestore toggle hidden failed:", err));
        return updatedItem;
      }
      return q;
    });
    setQuotations(updated);
    localStorage.setItem('next_quotations_lzk.joel@gmail.com', JSON.stringify(updated));
  };

  // Load selected quotation values
  useEffect(() => {
    const currentQuotes = quotations;
    const active = currentQuotes.find(q => q.id === selectedId) || currentQuotes[0] || defaultQuoteTemplate;
    
    setRefNumber(active.refNumber || '');
    setDate(active.date || '');
    setAttn(active.attn || '');
    setCompany(active.company || '');
    setAddress(active.address || '');
    setVenue(active.venue || '');
    setTime(active.time || '');
    setParticipants(active.participants || '');
    setTrainingProvider(active.trainingProvider || '');
    setItems(active.items || []);
    setRemarks(active.remarks || []);
    setTerms(active.terms || []);
    setApplySST(active.applySST || false);
    setSstRate(active.sstRate || 8);
    setPreparedBy(active.preparedBy || rep.name);
    setOwnerId(active.ownerId || active.creatorId || rep.id);
    setOwnerName(active.ownerName || active.preparedBy || rep.name);
  }, [selectedId, quotations, rep]);

  // Save the current values back into the quotations list
  const handleSaveQuotation = async () => {
    setPreviousQuotes(JSON.parse(JSON.stringify(quotations)));
    setPreviousSelectedId(selectedId);
    setUndoMessage('Quotation changes saved.');

    const updated = quotations.map(q => {
      if (q.id === selectedId) {
        const updatedItem = {
          id: q.id,
          refNumber,
          date,
          attn,
          company,
          address,
          venue,
          time,
          participants,
          trainingProvider,
          items,
          remarks,
          terms,
          applySST,
          sstRate,
          isHidden: q.isHidden,
          taggedBy: q.taggedBy,
          tagNote: q.tagNote,
          preparedBy: q.preparedBy || preparedBy || rep.name,
          creatorId: q.creatorId || rep.id,
          ownerId: ownerId || q.ownerId || rep.id,
          ownerName: ownerName || q.ownerName || rep.name,
          taggedRepId: q.taggedRepId,
          taggedRepName: q.taggedRepName,
          isCompleted: q.isCompleted
        };
        // Sync to Firestore
        setDoc(doc(db, 'quotations', q.id), updatedItem).catch(err => console.error("Firestore save quotation failed:", err));
        return updatedItem;
      }
      return q;
    });

    setQuotations(updated);
    localStorage.setItem('next_quotations_lzk.joel@gmail.com', JSON.stringify(updated));
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 3000);
  };

  // Create a brand new blank quotation
  const handleCreateNewQuotation = async () => {
    setPreviousQuotes(JSON.parse(JSON.stringify(quotations)));
    setPreviousSelectedId(selectedId);
    setUndoMessage('New quotation created.');

    const newId = `q_${Date.now()}`;
    const cleanQuote: Quotation = {
      id: newId,
      refNumber: `1G/NA/${new Date().getFullYear()}${(new Date().getMonth()+1).toString().padStart(2,'0')}${new Date().getDate().toString().padStart(2,'0')}/${(quotations.length + 1).toString().padStart(2, '0')}`,
      date: new Date().toISOString().substring(0, 10),
      attn: '',
      company: '',
      address: '',
      venue: '',
      time: '',
      participants: '',
      trainingProvider: '',
      items: [],
      remarks: [],
      terms: DEFAULT_TERMS,
      preparedBy: rep.name,
      creatorId: rep.id,
      ownerId: rep.id,
      ownerName: rep.name
    };

    const updated = [...quotations, cleanQuote];
    setQuotations(updated);
    localStorage.setItem('next_quotations_lzk.joel@gmail.com', JSON.stringify(updated));
    setSelectedId(newId);

    // Sync to Firestore
    try {
      await setDoc(doc(db, 'quotations', newId), cleanQuote);
    } catch (err) {
      console.error("Firestore create quotation failed:", err);
    }
  };

  // Delete a quotation
  const handleDeleteQuotation = (idToDelete: string) => {
    if (quotations.length <= 1) {
      showToast('Cannot delete the only quotation. Please create another one first.', 'error');
      return;
    }
    setQuoteToDeleteId(idToDelete);
  };

  // Add course row
  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemProgram.trim()) return;

    const rate = parseFloat(newItemFee) || 0;
    const days = parseInt(newItemDays) || 1;
    const total = rate * days;

    const added: QuotationItem = {
      id: `qi_${Date.now()}`,
      no: items.length + 1,
      program: newItemProgram,
      code: newItemCode || 'TBD',
      date: newItemDate || 'TBD',
      trainer: newItemTrainer || 'TBD',
      feePerDay: rate,
      days,
      totalFee: total
    };

    const updated = [...items, added].map((it, idx) => ({ ...it, no: idx + 1 }));
    setItems(updated);

    // reset fields
    setNewItemProgram('');
    setNewItemCode('');
    setNewItemDate('');
    setNewItemTrainer('');
    setNewItemFee('5500');
    setNewItemDays('2');
  };

  // Remove course row
  const handleRemoveItem = (itemId: string) => {
    const updated = items.filter(it => it.id !== itemId).map((it, idx) => ({ ...it, no: idx + 1 }));
    setItems(updated);
  };

  // Add remark bullet
  const handleAddRemark = () => {
    if (!newRemark.trim()) return;
    setRemarks([...remarks, newRemark.trim()]);
    setNewRemark('');
  };

  // Remove remark bullet
  const handleRemoveRemark = (index: number) => {
    setRemarks(remarks.filter((_, idx) => idx !== index));
  };

  // Add term bullet
  const handleAddTerm = () => {
    if (!newTerm.trim()) return;
    setTerms([...terms, newTerm.trim()]);
    setNewTerm('');
  };

  // Remove term bullet
  const handleRemoveTerm = (index: number) => {
    setTerms(terms.filter((_, idx) => idx !== index));
  };

  // Load a preset course details
  const handleApplyPreset = (preset: typeof coursePresets[0]) => {
    setNewItemProgram(preset.program);
    setNewItemCode(preset.code);
    setNewItemFee(preset.fee.toString());
    setNewItemTrainer(preset.trainer);
  };

  // Calculate sum of training fees
  const grandTotal = items.reduce((sum, item) => sum + item.totalFee, 0);
  const sstAmount = applySST ? (grandTotal * sstRate / 100) : 0;
  const finalTotal = grandTotal + sstAmount;

  // Trigger Browser native print
  const handlePrint = () => {
    window.print();
  };

  const getQuotationTotal = (q: Quotation) => {
    const itemsTotal = (q.items || []).reduce((sum, item) => sum + item.totalFee, 0);
    const sst = q.applySST ? (itemsTotal * (q.sstRate || 8) / 100) : 0;
    return itemsTotal + sst;
  };

  const filteredQuotes = quotations.filter(q => {
    // Privacy constraint: Only show if:
    // 1. System default templates (no creatorId and no preparedBy)
    // 2. Owner/Creator (creatorId === rep.id or preparedBy === rep.name)
    // 3. Tagged representative (taggedRepId === rep.id)
    const isSystemDefault = !q.creatorId && !q.preparedBy;
    const isOwner = 
      q.creatorId === rep.id || 
      q.preparedBy === rep.name || 
      q.ownerId === rep.id || 
      (q.ownerName && q.ownerName === rep.name);
    const isTagged = q.taggedRepId === rep.id;

    // Completed tags: A tagged person who completes a quotation gets untagged (hidden from their library)
    // but the tagger/owner can still see it in their library to verify completion
    if (isTagged && q.isCompleted) {
      return false;
    }

    if (!isSystemDefault && !isOwner && !isTagged) {
      return false;
    }

    if (!showHiddenQuotes && q.isHidden) return false;
    const query = quoteSearchQuery.toLowerCase().trim();
    if (!query) return true;
    return (
      (q.refNumber || '').toLowerCase().includes(query) ||
      (q.company || '').toLowerCase().includes(query) ||
      (q.attn || '').toLowerCase().includes(query) ||
      (q.trainingProvider || '').toLowerCase().includes(query)
    );
  }).sort((a, b) => {
    if (quoteSortBy === 'date') {
      return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
    }
    if (quoteSortBy === 'client') {
      return (a.company || '').localeCompare(b.company || '');
    }
    const timeA = a.id.startsWith('q_') ? parseInt(a.id.substring(2)) || 0 : 0;
    const timeB = b.id.startsWith('q_') ? parseInt(b.id.substring(2)) || 0 : 0;
    return timeB - timeA;
  });

  return (
    <div className="space-y-6">
      {/* CSS print override styles */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          /* Hide EVERYTHING in the DOM by default */
          body * {
            visibility: hidden !important;
          }
          /* Make the ancestor chain of print-paper visible so browsers will render the child */
          #root,
          #root div,
          .print-container-wrapper,
          .print-paper, 
          .print-paper * {
            visibility: visible !important;
          }
          /* Absolute position the print-paper to print from the top-left corner of the page */
          .print-paper {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 15mm !important;
            border: none !important;
            box-shadow: none !important;
            background: white !important;
          }
          /* Excel spreadsheet print simulation style */
          .spreadsheet-grid {
            border-collapse: collapse !important;
            width: 100% !important;
            border: 1px solid #000000 !important;
          }
          .spreadsheet-grid th, .spreadsheet-grid td {
            border: 1px solid #000000 !important; /* crisper black gridlines for physical printer */
            padding: 6px !important;
            color: #000000 !important;
          }
          .spreadsheet-grid th {
            background-color: #f1f5f9 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .page-break {
            page-break-before: always !important;
          }
        }
      `}} />

      {undoMessage && (
        <div className="bg-slate-900 text-white rounded-xl p-3 px-4 flex items-center justify-between text-xs shadow-md animate-fade-in border border-slate-800 no-print mb-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span>{undoMessage}</span>
          </div>
          <button
            onClick={handleUndo}
            className="flex items-center gap-1.5 text-[11px] font-black text-blue-400 hover:text-blue-300 bg-white/10 hover:bg-white/15 px-3 py-1 rounded-lg transition-all uppercase tracking-wider cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" /> Undo
          </button>
        </div>
      )}

      {/* Header Panel with Quotation Selector */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div className="space-y-1">
          <h4 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5 font-display">
            <FileText className="w-4 h-4 text-blue-600" />
            Interactive Quotation Builder
          </h4>
          <p className="text-xs text-slate-500">
            Generate and save official NEXT Academy HRDC claimable quotation PDFs in spreadsheet grid fidelity.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Selector */}
          <div className="flex items-center gap-1.5 bg-slate-100 font-bold px-2.5 py-1.5 rounded border border-slate-200 text-xs">
            <span className="text-slate-500 uppercase tracking-wider">Select Quote:</span>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="bg-white text-slate-800 font-mono font-bold border border-slate-200 focus:outline-none cursor-pointer rounded px-2 py-0.5 text-xs"
            >
              {quotations.map(q => (
                <option key={q.id} value={q.id}>{q.company ? q.company.substring(0, 22) : 'Untitled Quote'} ({q.refNumber})</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleCreateNewQuotation}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs uppercase tracking-wider px-3.5 py-2 rounded-lg border border-slate-250 transition-colors"
          >
            Create New
          </button>

          <button
            onClick={() => handleDeleteQuotation(selectedId)}
            className="bg-rose-50 hover:bg-rose-100 text-rose-600 font-black text-xs uppercase tracking-wider px-3.5 py-2 rounded-lg border border-rose-200 transition-colors"
            title="Delete current quotation template"
          >
            Delete
          </button>
        </div>
      </div>

      {/* PREPARED QUOTATIONS LIBRARY - SEARCHABLE, SORTABLE, HIDEABLE */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs no-print space-y-4" id="quotation-library-panel">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-100">
          <div className="space-y-1">
            <h5 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5 font-display">
              <ClipboardList className="w-4 h-4 text-emerald-600" />
              Prepared Quotations Library
            </h5>
            <p className="text-[11px] text-slate-500">
              Manage your prepared templates. Hide/unhide, sort, or search to load into the interactive workspace.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by client, ref, provider..."
                value={quoteSearchQuery}
                onChange={(e) => setQuoteSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-500 bg-slate-50 w-56 font-medium"
              />
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
              <span>Sort:</span>
              <select
                value={quoteSortBy}
                onChange={(e) => setQuoteSortBy(e.target.value as any)}
                className="bg-white border border-slate-200 rounded px-2 py-1 cursor-pointer font-sans"
              >
                <option value="date">Quote Date</option>
                <option value="created">Created Time</option>
                <option value="client">Client Name</option>
              </select>
            </div>

            {/* Show Hidden Toggle */}
            <button
              onClick={() => setShowHiddenQuotes(!showHiddenQuotes)}
              className={`text-xs font-black px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1 ${
                showHiddenQuotes 
                  ? 'bg-amber-50 border-amber-200 text-amber-700' 
                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {showHiddenQuotes ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              {showHiddenQuotes ? 'Showing Hidden' : 'Show Hidden Drafts'}
            </button>
          </div>
        </div>

        {filteredQuotes.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-200 rounded-xl">
            <p className="text-xs text-slate-500 font-semibold">
              No prepared quotations match your query or filters.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50 text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">
                  <th className="py-2 px-3">Ref. Number</th>
                  <th className="py-2 px-3">Quote Date</th>
                  <th className="py-2 px-3">Client / Company</th>
                  <th className="py-2 px-3">Owner / Prep</th>
                  <th className="py-2 px-3 text-right">Total Amount</th>
                  <th className="py-2 px-3 text-center">Status</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {filteredQuotes.map(q => {
                  const isCurrent = q.id === selectedId;
                  const total = getQuotationTotal(q);
                  return (
                    <React.Fragment key={q.id}>
                      <tr 
                        className={`hover:bg-slate-50/50 transition-colors ${
                          isCurrent ? 'bg-blue-50/20 border-l-2 border-l-blue-500' : ''
                        } ${
                          q.taggedRepId === rep.id && !q.isCompleted ? 'bg-rose-50 border-l-4 border-l-rose-500 animate-pulse' : ''
                        }`}
                      >
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-800">{q.refNumber || 'N/A'}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-500">{q.date || 'N/A'}</td>
                        <td className="py-2.5 px-3">
                          <span className="font-extrabold text-slate-900 block truncate max-w-[200px]" title={q.company}>
                            {q.company || 'Untitled Company'}
                          </span>
                          {q.taggedBy && (
                            <div className="space-y-1 mt-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 border border-purple-200 text-purple-700 rounded text-[9px] font-black font-mono uppercase tracking-wider">
                                <Tag className="w-2.5 h-2.5" /> Tagged by {q.taggedBy}
                              </span>
                              {q.tagNote && (
                                <div className="text-[10px] text-purple-600 bg-purple-50/40 rounded-lg p-1.5 italic border border-purple-100 max-w-[220px]">
                                  "{q.tagNote}"
                                </div>
                              )}
                            </div>
                          )}
                          {q.taggedRepId && (
                            <div className="mt-1">
                              {q.isCompleted ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded text-[9px] font-black font-mono uppercase tracking-wider">
                                  <CheckCircle className="w-2.5 h-2.5 text-emerald-600" /> Completed by {q.taggedRepName}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded text-[9px] font-black font-mono uppercase tracking-wider animate-pulse">
                                  <Clock className="w-2.5 h-2.5 text-amber-600" /> Pending: {q.taggedRepName}
                                </span>
                              )}
                            </div>
                          )}
                          <span className="text-[10px] text-slate-400 block truncate max-w-[180px] mt-0.5" title={q.attn}>
                            Attn: {q.attn || 'N/A'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 font-semibold truncate max-w-[150px]">
                          <div className="font-extrabold text-slate-900">{q.ownerName || q.preparedBy || rep.name}</div>
                          {q.preparedBy && q.preparedBy !== q.ownerName && (
                            <div className="text-[10px] text-slate-400 font-normal mt-0.5">Prep: {q.preparedBy}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-black text-slate-800">
                          RM {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {q.isHidden ? (
                            <span className="inline-flex items-center gap-1 text-[10px] bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-full">
                              <EyeOff className="w-3 h-3" /> Hidden
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded-full">
                              <Eye className="w-3 h-3" /> Visible
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Full Edit button */}
                            <button
                              onClick={() => {
                                setSelectedId(q.id);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                                showToast('Quotation template loaded into workspace for Full Edit!');
                              }}
                              className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded transition-all flex items-center gap-1 ${
                                isCurrent 
                                  ? 'bg-blue-600 text-white font-black shadow-3xs animate-pulse' 
                                  : 'bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-700 border border-slate-200'
                              }`}
                              title="Load quotation template into active workspace editor for full amendments and saving"
                            >
                              ✏️ {isCurrent ? 'Active' : 'Full Edit'}
                            </button>

                            {/* Tagged representative Done/Completed button */}
                            {q.taggedRepId === rep.id && !q.isCompleted && (
                              <button
                                onClick={async () => {
                                  setPreviousQuotes(JSON.parse(JSON.stringify(quotations)));
                                  setPreviousSelectedId(selectedId);
                                  setUndoMessage('Quotation marked as completed & untagged.');

                                  const updated = quotations.map(item => {
                                    if (item.id === q.id) {
                                      const updatedItem = { ...item, isCompleted: true };
                                      // Sync to Firestore
                                      setDoc(doc(db, 'quotations', q.id), updatedItem).catch(err => console.error("Firestore complete quotation failed:", err));
                                      return updatedItem;
                                    }
                                    return item;
                                  });
                                  setQuotations(updated);
                                  localStorage.setItem('next_quotations_lzk.joel@gmail.com', JSON.stringify(updated));
                                  showToast('Quotation marked as completed!');
                                }}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase tracking-wider rounded transition-all cursor-pointer flex items-center gap-1 shadow-3xs"
                                title="Mark completed & untag yourself"
                              >
                                <Check className="w-3 h-3 text-white" /> Done
                              </button>
                            )}

                            {/* Tag Representative */}
                            <button
                              onClick={() => {
                                if (taggingQuoteRowId === q.id) {
                                  setTaggingQuoteRowId(null);
                                } else {
                                  setTaggingQuoteRowId(q.id);
                                  setTagTargetRepIds([]);
                                  setTagNoteText('');
                                  setActionStatus(null);
                                }
                              }}
                              className={`p-1.5 rounded transition-all border ${
                                taggingQuoteRowId === q.id 
                                  ? 'bg-purple-100 text-purple-700 border-purple-300' 
                                  : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                              }`}
                              title="Tag other representatives"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>

                            {/* Hide/Unhide toggle */}
                            <button
                              onClick={() => toggleHideQuote(q.id)}
                              className={`p-1.5 rounded transition-all border ${
                                q.isHidden 
                                  ? 'bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100' 
                                  : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                              }`}
                              title={q.isHidden ? 'Unhide quotation from the library list' : 'Hide quotation from the library list'}
                            >
                              {q.isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>

                            {/* Reset Tagging (Creator/Owner Only) */}
                            {(q.creatorId === rep.id || q.preparedBy === rep.name || q.ownerId === rep.id || (q.ownerName && q.ownerName === rep.name) || !q.creatorId) && q.taggedRepId && (
                              <button
                                onClick={() => setTagResetId(q.id)}
                                className="p-1.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-600 border border-amber-200 transition-all cursor-pointer"
                                title="Reset tagging & clear tag parameters"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {/* Delete */}
                            <button
                              onClick={() => handleDeleteQuotation(q.id)}
                              className="p-1.5 rounded bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition-all"
                              title="Permanently delete template"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Tag Representative Expandable Panel */}
                      {taggingQuoteRowId === q.id && (
                        <tr className="bg-slate-50/70 border-b border-slate-100">
                          <td colSpan={7} className="p-4">
                            <div className="space-y-3 max-w-md">
                              <h5 className="text-[10px] font-black uppercase tracking-wider text-slate-500 font-mono">
                                Tag/Share Quotation with Team Members
                              </h5>
                              <p className="text-[11px] text-slate-400 font-medium">
                                Select team members and enter a comment. This will make a copy of this quotation template available in their personal quotation library.
                              </p>
                              
                              {actionStatus && (
                                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-[11px] text-emerald-800 font-semibold">
                                  {actionStatus}
                                </div>
                              )}

                              {/* Multiple Rep selection Checkboxes */}
                              <div className="space-y-1.5 border border-slate-100 rounded-lg p-3 bg-white shadow-3xs">
                                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                                  Select Team Members (Select Multiple):
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                  {(reps || [
                                    { id: 'xin-ying', name: 'Ng Xin Ying' },
                                    { id: 'chee-cai', name: 'Chee Cai' },
                                    { id: 'alif', name: 'Alif' },
                                    { id: 'atiqa', name: 'Atiqa' }
                                  ]).filter(m => m.id !== rep.id).map(m => {
                                    const isChecked = tagTargetRepIds.includes(m.id);
                                    return (
                                      <label key={m.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:text-blue-600 transition-colors">
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => {
                                            if (isChecked) {
                                              setTagTargetRepIds(tagTargetRepIds.filter(id => id !== m.id));
                                            } else {
                                              setTagTargetRepIds([...tagTargetRepIds, m.id]);
                                            }
                                          }}
                                          className="rounded border-slate-350 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5 cursor-pointer"
                                        />
                                        <span>{m.name}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Note / Comment Box */}
                              <div className="space-y-1">
                                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                                  Note / Comment Box:
                                </label>
                                <textarea
                                  value={tagNoteText}
                                  onChange={(e) => setTagNoteText(e.target.value)}
                                  placeholder="e.g. Please check this quotation template! Let me know if you need any adjustments."
                                  rows={2}
                                  className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                                />
                              </div>

                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => handleTagQuotationMultiple(q)}
                                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-[10px] font-black uppercase transition-all cursor-pointer"
                                  disabled={tagTargetRepIds.length === 0}
                                >
                                  Tag Representatives
                                </button>
                                
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTaggingQuoteRowId(null);
                                    setTagTargetRepIds([]);
                                    setTagNoteText('');
                                    setActionStatus(null);
                                  }}
                                  className="px-3 py-2 border border-slate-200 bg-white rounded-lg text-[10px] font-black uppercase text-slate-500 hover:bg-slate-50 transition-all cursor-pointer"
                                >
                                  Close
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Workspace View Layout Controls */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-3xs flex flex-col md:flex-row items-center justify-between gap-3 no-print">
        <div className="space-y-0.5 text-center md:text-left">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono block">
            Workspace Configuration
          </span>
          <h4 className="text-xs font-bold text-slate-700">
            Customize layout for comfortable split-screen viewing:
          </h4>
        </div>
        <div className="flex flex-wrap items-center justify-center bg-slate-100 border border-slate-200 rounded-lg p-1 gap-1">
          <button
            onClick={() => setLayoutMode('split')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
              layoutMode === 'split'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            ↔️ Split Screen
          </button>
          <button
            onClick={() => setLayoutMode('stacked')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
              layoutMode === 'stacked'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            ↕️ Stacked View
          </button>
          <button
            onClick={() => setLayoutMode('edit-only')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
              layoutMode === 'edit-only'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            📝 Form Only
          </button>
          <button
            onClick={() => setLayoutMode('preview-only')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
              layoutMode === 'preview-only'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            👁️ Preview Only
          </button>
        </div>
      </div>

      {/* Grid: Editor Panel + Live Document Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* LEFT COLUMN: INTERACTIVE FORM CONTROLS (HIDES ON PRINT) */}
        <div className={`${
          layoutMode === 'edit-only' 
            ? 'lg:col-span-12' 
            : layoutMode === 'preview-only' 
              ? 'hidden' 
              : layoutMode === 'stacked' 
                ? 'lg:col-span-12' 
                : 'lg:col-span-5'
        } space-y-6 no-print`}>
          
          {/* General Metadata Config Card */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="p-4 bg-slate-800 text-white flex items-center justify-between">
              <h5 className="text-xs font-black uppercase tracking-wider font-display flex items-center gap-1.5 text-white">
                <Edit3 className="w-4 h-4 text-blue-400" />
                1. Quotation Metadata
              </h5>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAttn('');
                    setCompany('');
                    setAddress('');
                    setVenue('');
                    setTime('');
                    setParticipants('');
                    setTrainingProvider('');
                  }}
                  className="text-[10px] bg-rose-950 hover:bg-rose-900 text-rose-200 border border-rose-800 font-extrabold px-2.5 py-1 rounded transition-colors cursor-pointer"
                  title="Clear all client metadata fields to start fresh"
                >
                  🧹 Clear Metadata
                </button>
                <span className="text-[10px] bg-slate-700 text-slate-300 font-mono font-bold px-2 py-0.5 rounded">
                  Ref & Address
                </span>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {/* Ownership and Prepared By Settings */}
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-xl border border-slate-150">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 tracking-wider">
                    Prepared By (Creator)
                  </label>
                  <input
                    type="text"
                    disabled
                    value={preparedBy || rep.name}
                    className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-400 bg-slate-100 font-bold cursor-not-allowed"
                    title="This is the person who prepared/drafted the quotation."
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 tracking-wider flex items-center gap-1">
                    Quotation Owner <span className="text-[9px] text-blue-500 font-normal lowercase">(has library copy)</span>
                  </label>
                  <select
                    value={ownerId || rep.id}
                    onChange={(e) => {
                      const selectedRep = reps?.find(r => r.id === e.target.value);
                      if (selectedRep) {
                        setOwnerId(selectedRep.id);
                        setOwnerName(selectedRep.name);
                      }
                    }}
                    className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-bold"
                  >
                    {reps?.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name} {r.id === rep.id ? '(You)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black text-slate-600 uppercase mb-2 tracking-wider">
                    Ref. Number
                  </label>
                  <input
                    type="text"
                    value={refNumber}
                    onChange={(e) => setRefNumber(e.target.value)}
                    placeholder="e.g. 1G/NA/20260422/01"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3.5 py-2.5 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-mono font-medium"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-600 uppercase mb-2 tracking-wider">
                    Quotation Date
                  </label>
                  <input
                    type="text"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    placeholder="e.g. 22 Apr 2026"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3.5 py-2.5 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-mono font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-600 uppercase mb-2 tracking-wider">
                  Attn: (Recipient Name)
                </label>
                <input
                  type="text"
                  value={attn}
                  onChange={(e) => setAttn(e.target.value)}
                  placeholder="e.g. Muhammad Arif Fikri Nordin"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3.5 py-2.5 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-600 uppercase mb-2 tracking-wider">
                  Company Name
                </label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="e.g. 1 Group (Melaka) Sdn Bhd"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3.5 py-2.5 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-600 uppercase mb-2 tracking-wider">
                  Company Address
                </label>
                <textarea
                  rows={2}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. 1-Altitude Melaka Sky Deck, Hatten City..."
                  className="w-full text-sm border border-slate-200 rounded-lg px-3.5 py-2.5 text-slate-800 focus:outline-none focus:border-blue-500 bg-white resize-none font-medium"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 space-y-2">
                <span className="block text-xs font-black text-slate-600 uppercase tracking-wider">
                  SST Settings (Sales & Service Tax)
                </span>
                <div className="flex items-center gap-4 bg-slate-50 p-3 rounded-lg border border-slate-150">
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applySST}
                      onChange={(e) => setApplySST(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4.5 w-4.5 cursor-pointer"
                    />
                    Add SST to Invoice
                  </label>
                  {applySST && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-500 font-semibold">SST Rate:</span>
                      <div className="relative w-24">
                        <input
                          type="number"
                          value={sstRate}
                          onChange={(e) => setSstRate(parseFloat(e.target.value) || 0)}
                          className="w-full text-sm border border-slate-200 rounded px-2.5 py-1 text-slate-800 font-mono pr-6"
                          min="0"
                          max="100"
                        />
                        <span className="absolute right-1.5 top-1 text-xs text-slate-400">%</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-black text-slate-600 uppercase mb-2 tracking-wider">
                    Training Venue
                  </label>
                  <input
                    type="text"
                    value={venue}
                    onChange={(e) => setVenue(e.target.value)}
                    placeholder="e.g. Happi Village, Janda Baik"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3.5 py-2.5 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-medium"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-600 uppercase mb-2 tracking-wider">
                    Timing Hours
                  </label>
                  <input
                    type="text"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    placeholder="e.g. 9:00 AM – 5:00 PM"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3.5 py-2.5 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black text-slate-600 uppercase mb-2 tracking-wider">
                    Participants Capacity
                  </label>
                  <input
                    type="text"
                    value={participants}
                    onChange={(e) => setParticipants(e.target.value)}
                    placeholder="e.g. Up to 25 pax"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3.5 py-2.5 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-medium"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-600 uppercase mb-2 tracking-wider">
                    Quotation Prepared by
                  </label>
                  <input
                    type="text"
                    value={trainingProvider}
                    onChange={(e) => setTrainingProvider(e.target.value)}
                    placeholder="e.g. Next Academy Sdn Bhd..."
                    className="w-full text-sm border border-slate-200 rounded-lg px-3.5 py-2.5 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-medium"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Training Program Line Items Editor */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="p-4 bg-slate-800 text-white flex items-center justify-between">
              <h5 className="text-xs font-black uppercase tracking-wider font-display flex items-center gap-1.5 text-white">
                <ClipboardList className="w-4 h-4 text-blue-400" />
                2. Training Programs Roster
              </h5>
              <span className="text-[10px] bg-slate-700 text-slate-300 font-mono font-bold px-2 py-0.5 rounded">
                RM Rates
              </span>
            </div>

            <div className="p-5 space-y-4">
              {/* Presets Quickbar */}
              <div>
                <span className="block text-[9px] font-black text-slate-400 uppercase mb-1.5">
                  ⚡ Load Quick Program Preset:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {coursePresets.map((preset, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => handleApplyPreset(preset)}
                      className="text-[9px] bg-slate-50 hover:bg-blue-50 hover:border-blue-300 border border-slate-200 text-slate-600 font-bold px-2 py-1 rounded transition-all cursor-pointer"
                    >
                      {preset.program.split(':')[0]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Add New Row Form */}
              <form onSubmit={handleAddItem} className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-150">
                <span className="block text-[10px] font-black text-slate-600 uppercase tracking-wider">
                  Add Course to Quotation
                </span>

                <div>
                  <label className="block text-[9px] font-black text-slate-500 uppercase mb-1">
                    Course / Program Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. F&B Basics Service Excellence"
                    value={newItemProgram}
                    onChange={(e) => setNewItemProgram(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-black text-slate-500 uppercase mb-1">
                      Programme Code
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 10001669509"
                      value={newItemCode}
                      onChange={(e) => setNewItemCode(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-black text-slate-500 uppercase mb-1">
                      Training Dates
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 5, 6, 19, 20 May 2026"
                      value={newItemDate}
                      onChange={(e) => setNewItemDate(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[9px] font-black text-slate-500 uppercase mb-1">
                    Assigned Trainer
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Chris Low"
                    value={newItemTrainer}
                    onChange={(e) => setNewItemTrainer(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-blue-500 bg-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-black text-slate-500 uppercase mb-1">
                      Fee per day (RM)
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 5500"
                      value={newItemFee}
                      onChange={(e) => setNewItemFee(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-black text-slate-500 uppercase mb-1">
                      Number of Days
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 4"
                      value={newItemDays}
                      onChange={(e) => setNewItemDays(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-blue-500 bg-white font-mono"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black text-[10px] uppercase tracking-wider py-2 rounded-lg transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Course to Listing
                </button>
              </form>

              {/* Current Listing list for deletion */}
              <div className="space-y-2 mt-3 pt-3 border-t border-slate-100">
                <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Current Course Lines:
                </span>
                {items.length === 0 ? (
                  <p className="text-xs text-slate-400 italic text-center py-2">No courses added. Use form above to add.</p>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-[180px] overflow-y-auto">
                    {items.map((it) => (
                      <div key={it.id} className="flex justify-between items-center py-2 text-xs">
                        <div className="truncate pr-4 flex-1">
                          <p className="font-extrabold text-slate-800 truncate">{it.program}</p>
                          <p className="text-[10px] text-slate-500 font-mono">
                            RM {it.feePerDay.toLocaleString()} x {it.days} days = <span className="font-bold text-slate-700">RM {it.totalFee.toLocaleString()}</span>
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(it.id)}
                          className="text-rose-500 hover:text-rose-700 p-1.5 hover:bg-rose-50 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Remarks & Terms Editor */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="p-4 bg-slate-800 text-white flex items-center justify-between">
              <h5 className="text-xs font-black uppercase tracking-wider font-display flex items-center gap-1.5 text-white">
                <Info className="w-4 h-4 text-blue-400" />
                3. Remarks & Terms Clauses
              </h5>
              <span className="text-[10px] bg-slate-700 text-slate-300 font-mono font-bold px-2 py-0.5 rounded">
                Legal Block
              </span>
            </div>

            <div className="p-5 space-y-6">
              {/* Remarks block */}
              <div className="space-y-2">
                <span className="block text-[10px] font-black text-slate-600 uppercase tracking-wider pb-1 border-b border-slate-150">
                  Remarks / Notes
                </span>
                
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newRemark}
                    onChange={(e) => setNewRemark(e.target.value)}
                    placeholder="Add custom remark bullet..."
                    className="flex-1 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-blue-500"
                    onKeyDown={(e) => { if (e.key === 'Enter') { handleAddRemark(); e.preventDefault(); } }}
                  />
                  <button
                    type="button"
                    onClick={handleAddRemark}
                    className="bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-bold px-3 text-xs rounded-lg"
                  >
                    Add
                  </button>
                </div>

                <div className="space-y-1.5 max-h-[140px] overflow-y-auto">
                  {remarks.map((r, idx) => (
                    <div key={idx} className="flex justify-between items-start gap-2 bg-slate-50 p-2 rounded-lg text-[11px] text-slate-600">
                      <p className="flex-1 text-left font-medium leading-relaxed">• {r}</p>
                      <button
                        type="button"
                        onClick={() => handleRemoveRemark(idx)}
                        className="text-rose-500 hover:text-rose-700 p-0.5"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Terms block */}
              <div className="space-y-2">
                <div className="flex justify-between items-center pb-1 border-b border-slate-150">
                  <span className="block text-[10px] font-black text-slate-600 uppercase tracking-wider">
                    Terms & Conditions Clauses
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setTerms([...DEFAULT_TERMS]);
                      showToast('T&C Clauses reset to defaults!');
                    }}
                    className="text-[10px] text-blue-600 hover:text-blue-800 font-bold transition-colors"
                  >
                    Reset to Defaults
                  </button>
                </div>

                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newTerm}
                    onChange={(e) => setNewTerm(e.target.value)}
                    placeholder="Add terms and conditions clause..."
                    className="flex-1 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-blue-500"
                    onKeyDown={(e) => { if (e.key === 'Enter') { handleAddTerm(); e.preventDefault(); } }}
                  />
                  <button
                    type="button"
                    onClick={handleAddTerm}
                    className="bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-bold px-3 text-xs rounded-lg"
                  >
                    Add
                  </button>
                </div>

                <div className="space-y-1.5 max-h-[140px] overflow-y-auto">
                  {terms.map((t, idx) => (
                    <div key={idx} className="flex justify-between items-start gap-2 bg-slate-50 p-2 rounded-lg text-[11px] text-slate-600">
                      <p className="flex-1 text-left font-medium leading-relaxed">• {t}</p>
                      <button
                        type="button"
                        onClick={() => handleRemoveTerm(idx)}
                        className="text-rose-500 hover:text-rose-700 p-0.5"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Google Sheets Cloud Integration Panel */}
          <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl space-y-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cloud className="w-5 h-5 text-blue-600 animate-pulse" />
                <div>
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">
                    Google Sheets Synchronization
                  </h4>
                  <p className="text-[10px] text-slate-500 font-medium">
                    Log and track all quotations in a secure central Google Sheet spreadsheet.
                  </p>
                </div>
              </div>
              
              {/* Google Auth Status Badge */}
              {googleUser ? (
                <span className="text-[9px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Connected
                </span>
              ) : (
                <span className="text-[9px] font-black bg-slate-150 text-slate-500 border border-slate-200 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Offline
                </span>
              )}
            </div>

            {/* Status Messages */}
            {sheetsSyncMsg && (
              <div className="text-[11px] font-semibold text-blue-700 bg-blue-100/50 px-3 py-1.5 rounded-lg flex items-center gap-1.5 border border-blue-100">
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSheets ? 'animate-spin' : ''}`} />
                {sheetsSyncMsg}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 justify-between pt-1">
              <div className="flex gap-2">
                {!googleUser ? (
                  <button
                    onClick={handleGoogleLogin}
                    className="bg-white hover:bg-slate-50 text-slate-700 font-bold text-[11px] px-3 py-2 rounded-lg border border-slate-200 shadow-2xs transition-colors flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v3.92h6.61c-.29 1.5-.1.14 1.14 2.18l3.43 2.66c2.01-1.85 3.56-4.59 3.56-7.69z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.43-2.66c-1.12.75-2.55 1.19-4.5 1.19-3.46 0-6.4-2.33-7.44-5.46H1.15v2.76C3.13 21.03 7.31 24 12 24z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M4.56 14.16c-.26-.75-.41-1.56-.41-2.4s.15-1.65.41-2.4V6.6H1.15C.42 8.06 0 9.7 0 11.4c0 1.7.42 3.34 1.15 4.8l3.41-2.04z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0 7.31 0 3.13 2.97 1.15 7.02l3.41 2.04c1.04-3.13 3.98-5.46 7.44-5.46z"
                      />
                    </svg>
                    Connect Google Account
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSyncToSheets}
                      disabled={isSyncingSheets}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-black text-[11px] uppercase tracking-wider px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                    >
                      <Cloud className="w-3.5 h-3.5" />
                      Sync to Google Sheet
                    </button>
                    <button
                      onClick={handleGoogleLogout}
                      className="text-slate-400 hover:text-slate-600 text-[10px] font-bold"
                    >
                      Disconnect
                    </button>
                  </div>
                )}
              </div>

              {sheetsUrl && (
                <a
                  href={sheetsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:text-blue-800 text-[11px] font-black underline flex items-center gap-1"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Open Google Sheet Log
                </a>
              )}
            </div>
          </div>

          {/* Action Footer Button Bar (Save Quote changes) */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between shadow-2xs">
            <div className="flex-1 pr-4">
              {saveStatus === 'saved' ? (
                <div className="flex items-center gap-1.5 text-emerald-600 text-xs font-black">
                  <CheckCircle className="w-4 h-4" />
                  Changes Synced to System Storage!
                </div>
              ) : (
                <p className="text-[10px] text-slate-400 font-semibold font-mono leading-normal">
                  Values are updated live in the document draft on the right. Save to store permanently.
                </p>
              )}
            </div>

            <button
              onClick={handleSaveQuotation}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider px-6 py-2.5 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <Save className="w-4 h-4" />
              Save Quotation
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN: LIVE HIGH-FIDELITY PREVIEW & PRINT (SHOWS ON PRINT IN SPECIAL LAYOUT) */}
        <div className={`${
          layoutMode === 'preview-only' 
            ? 'lg:col-span-12' 
            : layoutMode === 'edit-only' 
              ? 'hidden print:block lg:col-span-12' 
              : layoutMode === 'stacked' 
                ? 'lg:col-span-12' 
                : 'lg:col-span-7'
        } space-y-4 print-container-wrapper`}>
          
          {/* Quick Info bar */}
          <div className="flex justify-between items-center no-print">
            <div className="space-y-1">
              <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest font-mono bg-blue-50 border border-blue-100 px-2.5 py-1 rounded inline-block">
                High-Fidelity Document Preview
              </span>
              <p className="text-[9px] text-slate-400 font-medium max-w-[250px] leading-tight">
                Tip: If the PDF save dialog is blocked by the editor, click "Open in New Tab" at the top-right of your screen to save perfectly.
              </p>
            </div>
            <button
              onClick={handlePrint}
              className="bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider px-5 py-2.5 rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              Save as PDF
            </button>
          </div>

          {/* Scrollable container for perfect high-fidelity viewing on narrow viewports */}
          <div className="w-full overflow-x-auto pb-4 print:overflow-visible print:pb-0">
            {/* The Actual A4 Quotation Paper */}
            <div className="bg-white border border-slate-300 rounded-xl shadow-xl overflow-hidden print-paper text-slate-900 font-sans p-8 md:p-12 space-y-6 max-w-4xl mx-auto min-w-[760px] lg:min-w-0">
            
            {/* NEXT Academy vector/text logo matching PDF structure */}
            <div className="flex justify-between items-start border-b-2 border-slate-100 pb-5">
              <div>
                <Logo className="h-[120px] w-auto object-contain" />
              </div>

              <div className="text-right text-[11px] md:text-xs text-slate-500 font-mono space-y-1">
                <p className="font-bold text-slate-800">NEXT ACADEMY SDN BHD</p>
                <p>(Company No. 202401030750)</p>
                <p>10, Jalan SS 5B/4, Ss 5, 47301 Petaling Jaya, Selangor</p>
                <p>Tel: +603-2201 1234 | Email: corporate@nextacademy.my</p>
              </div>
            </div>

            {/* Document Title Block - Clean and tidy above ATTN */}
            <div className="border-b border-slate-200 pb-2 mb-4 flex justify-between items-end">
              <h2 className="text-lg md:text-xl font-extrabold tracking-widest text-slate-800 uppercase">
                QUOTATION
              </h2>
              <span className="text-[10px] font-bold text-slate-400 font-mono">
                REF: {refNumber || 'N/A'}
              </span>
            </div>

            {/* Address & Invoice Reference details section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
              
              {/* Left Column: Client metadata */}
              <div className="space-y-2">
                <div className="flex">
                  <span className="font-extrabold text-slate-500 uppercase tracking-wider w-24">Attn:</span>
                  <span className="font-bold text-slate-800">{attn || 'N/A'}</span>
                </div>
                <div className="flex">
                  <span className="font-extrabold text-slate-500 uppercase tracking-wider w-24">Company:</span>
                  <span className="font-extrabold text-slate-900">{company || 'N/A'}</span>
                </div>
                <div className="flex">
                  <span className="font-extrabold text-slate-500 uppercase tracking-wider w-24">Address:</span>
                  <span className="text-slate-600 font-medium leading-relaxed flex-1">{address || 'N/A'}</span>
                </div>
              </div>

              {/* Right Column: Quotation identifiers */}
              <div className="space-y-2 md:pl-6 md:border-l border-slate-100 font-mono">
                <div className="flex">
                  <span className="font-extrabold text-slate-500 uppercase tracking-wider w-32">Ref. Number:</span>
                  <span className="font-extrabold text-blue-700">{refNumber || 'N/A'}</span>
                </div>
                <div className="flex">
                  <span className="font-extrabold text-slate-500 uppercase tracking-wider w-32">Date:</span>
                  <span className="font-bold text-slate-700">{date || 'N/A'}</span>
                </div>
                <div className="flex">
                  <span className="font-extrabold text-slate-500 uppercase tracking-wider w-44">Quotation Prepared by:</span>
                  <span className="text-slate-600 font-semibold">{trainingProvider || 'N/A'}</span>
                </div>
              </div>

            </div>

            {/* Quotation Logistics details bar */}
            <div className="bg-slate-50/50 border border-slate-200/80 rounded-lg p-5 grid grid-cols-1 md:grid-cols-3 gap-5 text-sm font-sans shadow-2xs">
              <div>
                <span className="block text-[11px] font-black text-slate-400 uppercase tracking-widest font-mono">Venue Selected</span>
                <span className="font-extrabold text-slate-800 mt-1.5 block">{venue || 'N/A'}</span>
              </div>
              <div>
                <span className="block text-[11px] font-black text-slate-400 uppercase tracking-widest font-mono">Timing Slot</span>
                <span className="font-semibold text-slate-800 mt-1.5 block">{time || 'N/A'}</span>
              </div>
              <div>
                <span className="block text-[11px] font-black text-slate-400 uppercase tracking-widest font-mono">Participants Count</span>
                <span className="font-bold text-blue-600 mt-1.5 block">{participants || 'N/A'}</span>
              </div>
            </div>

            {/* Main Spreadsheet grid table for Training Courses */}
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-left spreadsheet-grid border border-slate-300 text-sm">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 text-[11px] font-black text-slate-500 uppercase tracking-widest font-mono">
                    <th className="p-3.5 w-12 text-center border-r border-slate-300">No.</th>
                    <th className="p-3.5 border-r border-slate-300">Training Program</th>
                    <th className="p-3.5 w-32 border-r border-slate-300">Programme Code</th>
                    <th className="p-3.5 w-40 border-r border-slate-300">Training Date</th>
                    <th className="p-3.5 border-r border-slate-300">Trainer</th>
                    <th className="p-3.5 w-32 text-right border-r border-slate-300">Rate / Day</th>
                    <th className="p-3.5 w-32 text-right">Total Fee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-250 text-slate-800 font-sans">
                  {items.map((item, index) => (
                    <tr key={item.id} className="hover:bg-slate-50/40">
                      <td className="p-3.5 text-center font-mono font-bold border-r border-slate-200">{item.no}</td>
                      <td className="p-3.5 font-extrabold text-slate-900 border-r border-slate-200 leading-normal">{item.program}</td>
                      <td className="p-3.5 font-mono font-semibold text-slate-600 border-r border-slate-200 text-xs">{item.code}</td>
                      <td className="p-3.5 text-slate-600 font-medium border-r border-slate-200 leading-normal">{item.date}</td>
                      <td className="p-3.5 font-semibold text-slate-700 border-r border-slate-200 leading-normal">{item.trainer}</td>
                      <td className="p-3.5 text-right font-mono font-bold text-slate-600 border-r border-slate-200">
                        RM {item.feePerDay.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3.5 text-right font-mono font-black text-slate-900">
                        RM {item.totalFee.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}

                  {/* Empty Spacer Rows to simulate spreadsheet looks exactly as shown in screenshot */}
                  {items.length < 3 && Array.from({ length: 3 - items.length }).map((_, spacerIdx) => (
                    <tr key={`spacer_${spacerIdx}`} className="h-12">
                      <td className="p-3.5 border-r border-slate-200"></td>
                      <td className="p-3.5 border-r border-slate-200"></td>
                      <td className="p-3.5 border-r border-slate-200"></td>
                      <td className="p-3.5 border-r border-slate-200"></td>
                      <td className="p-3.5 border-r border-slate-200"></td>
                      <td className="p-3.5 border-r border-slate-200"></td>
                      <td className="p-3.5"></td>
                    </tr>
                  ))}

                  {/* SST and Total Rows */}
                  {applySST && (
                    <>
                      <tr className="bg-slate-50/40 border-t border-slate-200 font-bold text-slate-600">
                        <td colSpan={5} className="p-3.5 border-r border-slate-200 text-right uppercase tracking-wider text-xs font-mono">
                          SUB-TOTAL COURSE FEES
                        </td>
                        <td colSpan={2} className="p-3.5 text-right text-sm font-mono font-bold text-slate-700 bg-slate-50/20">
                          RM {grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                      <tr className="bg-slate-50/40 border-t border-slate-200 font-bold text-slate-600">
                        <td colSpan={5} className="p-3.5 border-r border-slate-200 text-right uppercase tracking-wider text-xs font-mono">
                          ADD SST ({sstRate}%)
                        </td>
                        <td colSpan={2} className="p-3.5 text-right text-sm font-mono font-bold text-slate-700 bg-slate-50/20">
                          RM {sstAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    </>
                  )}

                  {/* Grand Total Row */}
                  <tr className="bg-slate-55/60 border-t border-slate-300 font-black">
                    <td colSpan={5} className="p-4 border-r border-slate-200 text-right uppercase tracking-wider text-xs text-slate-500 font-mono">
                      GRAND TOTAL COURSE FEES CLAIMABLE
                    </td>
                    <td colSpan={2} className="p-4 text-right text-base font-mono font-black text-blue-700 bg-slate-50">
                      RM {finalTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Remarks Section */}
            <div className="space-y-2 pt-4 border-t border-slate-100">
              <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider font-mono">
                Remarks:
              </h4>
              <ul className="space-y-1.5 text-xs md:text-sm text-slate-600 list-none leading-relaxed pl-1">
                {remarks.map((r, idx) => (
                  <li key={idx} className="flex items-start gap-1">
                    <span className="font-extrabold pr-1">•</span>
                    <span className="font-medium">{r}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* PAGE BREAK INDICATOR (FOR PRINT PAGINATION TO ENSURE TERMS & CONDITIONS SPLIT TO PAGE 2 NICELY) */}
            <div className="page-break" />

            {/* Terms and Conditions Section */}
            <div className="space-y-4 pt-4 border-t border-slate-200">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest font-mono border-b border-slate-100 pb-1">
                TERMS AND CONDITIONS
              </h3>

              <div className="grid grid-cols-1 gap-4 text-xs md:text-sm text-slate-600 leading-relaxed font-medium">
                
                {/* Standard bullet lines matching original document terms */}
                <div className="space-y-2.5">
                  <p className="font-bold text-slate-800 uppercase tracking-wider">
                    1. Cancellation & Rescheduling Policy:
                  </p>
                  <ul className="space-y-1 list-none pl-2 text-[11px] md:text-xs">
                    {terms.filter(t => t.toLowerCase().includes('cancel') || t.toLowerCase().includes('resched')).map((t, idx) => (
                      <li key={idx} className="flex items-start gap-1">
                        <span className="font-extrabold text-slate-400 pr-1">-</span>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-2.5 pt-2">
                  <p className="font-bold text-slate-800 uppercase tracking-wider">
                    2. Participant Requirements:
                  </p>
                  <ul className="space-y-1 list-none pl-2 text-[11px] md:text-xs">
                    {terms.filter(t => t.toLowerCase().includes('particip') || t.toLowerCase().includes('attend')).map((t, idx) => (
                      <li key={idx} className="flex items-start gap-1">
                        <span className="font-extrabold text-slate-400 pr-1">-</span>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="space-y-2">
                    <p className="font-bold text-slate-800 uppercase tracking-wider">
                      3. Training Materials & Intellectual Property:
                    </p>
                    <ul className="space-y-1 list-none pl-2 text-[11px] md:text-xs">
                      {terms.filter(t => t.toLowerCase().includes('material') || t.toLowerCase().includes('intellect') || t.toLowerCase().includes('reproduce')).map((t, idx) => (
                        <li key={idx} className="flex items-start gap-1">
                          <span className="font-extrabold text-slate-400 pr-1">-</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <p className="font-bold text-slate-800 uppercase tracking-wider">
                      4. Confidentiality & Data Protection:
                    </p>
                    <ul className="space-y-1 list-none pl-2 text-[11px] md:text-xs">
                      {terms.filter(t => t.toLowerCase().includes('confident') || t.toLowerCase().includes('personal info') || t.toLowerCase().includes('data protect')).map((t, idx) => (
                        <li key={idx} className="flex items-start gap-1">
                          <span className="font-extrabold text-slate-400 pr-1">-</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Additional / Unmatched terms */}
                {terms.some(t => {
                  const text = t.toLowerCase();
                  return !(text.includes('cancel') || text.includes('resched') ||
                           text.includes('particip') || text.includes('attend') ||
                           text.includes('material') || text.includes('intellect') || text.includes('reproduce') ||
                           text.includes('confident') || text.includes('personal info') || text.includes('data protect'));
                }) && (
                  <div className="space-y-2.5 pt-2 border-t border-slate-100">
                    <p className="font-bold text-slate-800 uppercase tracking-wider">
                      5. Additional Terms & Conditions:
                    </p>
                    <ul className="space-y-1 list-none pl-2 text-[11px] md:text-xs">
                      {terms.filter(t => {
                        const text = t.toLowerCase();
                        return !(text.includes('cancel') || text.includes('resched') ||
                                 text.includes('particip') || text.includes('attend') ||
                                 text.includes('material') || text.includes('intellect') || text.includes('reproduce') ||
                                 text.includes('confident') || text.includes('personal info') || text.includes('data protect'));
                      }).map((t, idx) => (
                        <li key={idx} className="flex items-start gap-1">
                          <span className="font-extrabold text-slate-400 pr-1">-</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

              </div>
            </div>

            {/* Bottom corporate signature area */}
            <div className="pt-12 grid grid-cols-2 gap-12 text-sm font-sans">
              <div className="space-y-12">
                <p className="font-bold text-slate-500">Prepared By:</p>
                <div className="border-t border-slate-300 pt-1.5 w-48">
                  <p className="font-extrabold text-slate-800">{rep.name}</p>
                  <p className="text-xs text-slate-400 font-mono font-semibold">NEXT Academy Representative</p>
                </div>
              </div>

              <div className="space-y-12 text-right flex flex-col items-end">
                <p className="font-bold text-slate-500 text-left w-48">Accepted By:</p>
                <div className="border-t border-slate-300 pt-1.5 w-48 text-left">
                  <p className="font-extrabold text-slate-800">Authorized Signatory</p>
                  <p className="text-xs text-slate-400 font-mono font-semibold">Designation & Stamp</p>
                </div>
              </div>
            </div>

          </div>

          </div>

        </div>

      </div>

      {/* Toast notifications */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[9999] rounded-xl p-4 flex items-center gap-3 shadow-lg border animate-bounce ${
          toast.type === 'error' 
            ? 'bg-rose-50 text-rose-800 border-rose-200' 
            : 'bg-emerald-50 text-emerald-800 border-emerald-200'
        }`}>
          <span className={`w-2 h-2 rounded-full ${toast.type === 'error' ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500 animate-pulse'}`} />
          <span className="text-xs font-black uppercase tracking-wider">{toast.message}</span>
        </div>
      )}

      {/* Custom Delete Confirmation Modal */}
      {quoteToDeleteId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs no-print">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl max-w-sm w-full mx-4 space-y-4 animate-scale-in">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2 bg-rose-50 rounded-full">
                <Trash2 className="w-6 h-6 text-rose-600" />
              </div>
              <h4 className="text-sm font-black uppercase tracking-wider font-display">Delete Quotation?</h4>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed font-semibold">
              Are you sure you want to permanently delete this quotation template? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setQuoteToDeleteId(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const idToDelete = quoteToDeleteId;
                  setQuoteToDeleteId(null);
                  setPreviousQuotes(JSON.parse(JSON.stringify(quotations)));
                  setPreviousSelectedId(selectedId);
                  setUndoMessage('Quotation template deleted.');

                  const updated = quotations.filter(q => q.id !== idToDelete);
                  setQuotations(updated);
                  localStorage.setItem('next_quotations_lzk.joel@gmail.com', JSON.stringify(updated));
                  
                  if (selectedId === idToDelete) {
                    setSelectedId(updated[0].id);
                  }
                  showToast('Quotation template deleted.');

                  // Sync to Firestore
                  if (idToDelete) {
                    try {
                      await deleteDoc(doc(db, 'quotations', idToDelete));
                    } catch (err) {
                      console.error("Firestore delete quotation failed:", err);
                    }
                  }
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Reset Tagging Confirmation Modal */}
      {tagResetId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs no-print">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl max-w-sm w-full mx-4 space-y-4 animate-scale-in">
            <div className="flex items-center gap-3 text-amber-600">
              <div className="p-2 bg-amber-50 rounded-full">
                <RotateCcw className="w-6 h-6 text-amber-600" />
              </div>
              <h4 className="text-sm font-black uppercase tracking-wider font-display">Reset Tagging?</h4>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed font-semibold">
              Are you sure you want to reset tagging and clear all tag parameters from this quotation template?
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setTagResetId(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const idToReset = tagResetId;
                  setTagResetId(null);
                  setPreviousQuotes(JSON.parse(JSON.stringify(quotations)));
                  setPreviousSelectedId(selectedId);
                  setUndoMessage('Quotation tagging reset successfully.');

                  const updated = quotations.map(item => {
                    if (item.id === idToReset) {
                      const updatedItem = {
                        ...item,
                        taggedRepId: '',
                        taggedRepName: '',
                        taggedBy: '',
                        isCompleted: false,
                        tagNote: ''
                      };
                      // Sync to Firestore
                      setDoc(doc(db, 'quotations', idToReset), updatedItem).catch(err => console.error("Firestore reset tagging failed:", err));
                      return updatedItem;
                    }
                    return item;
                  });
                  setQuotations(updated);
                  localStorage.setItem('next_quotations_lzk.joel@gmail.com', JSON.stringify(updated));
                  showToast('Quotation tagging reset.');
                }}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
              >
                Yes, Reset
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
