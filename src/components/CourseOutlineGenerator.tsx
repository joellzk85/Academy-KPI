import React, { useState, useEffect } from 'react';
import { Representative, CourseOutline, CourseOutlineItem } from '../types';
import {
  Plus, Trash2, Tag, RotateCcw, Save, BookOpen, Eye, EyeOff, Layers,
  FileText, ClipboardList, Info, Search, Share2, Check, Clock, CheckCircle,
  Edit3
} from 'lucide-react';
import Logo from './Logo';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query } from 'firebase/firestore';

interface CourseOutlineGeneratorProps {
  rep: Representative;
  reps: Representative[];
  requestManagerPermission: (actionToExecute: () => void) => void;
  key?: string;
}

const DEFAULT_MODULES: CourseOutlineItem[] = [
  {
    id: 'm1',
    no: 1,
    moduleTitle: 'Introduction to Web Technologies & Git',
    topics: '• Understanding Client-Server Architecture\n• Working with the UNIX Terminal\n• Git & GitHub Version Control workflow\n• Setting up the local developer environment (VS Code, Node.js)',
    duration: '3 Hours',
    methodology: 'Interactive Lecture & Hands-on Terminal Lab'
  },
  {
    id: 'm2',
    no: 2,
    moduleTitle: 'Advanced HTML5 & Modern Semantic Styling',
    topics: '• HTML5 semantic document structure\n• CSS3 Box Model, Flexbox & CSS Grid layouts\n• Responsive web design & Mobile-First styling strategies\n• Building complex multi-column responsive page structures',
    duration: '4 Hours',
    methodology: 'Visual Layout Challenge & Live Coding Lab'
  },
  {
    id: 'm3',
    no: 3,
    moduleTitle: 'JavaScript (ES6+) Programming Fundamentals',
    topics: '• Variables, Data Types & Operator logic\n• Functions, arrow syntax & lexical scoping\n• Control flow structures (conditionals & loops)\n• Arrays, Objects & ES6 Destructuring helpers',
    duration: '4 Hours',
    methodology: 'Algorithmic Problem-Solving & Coding Drills'
  },
  {
    id: 'm4',
    no: 4,
    moduleTitle: 'Asynchronous JavaScript & DOM Manipulation',
    topics: '• Interacting with the browser DOM tree\n• Advanced event listener patterns\n• Promises, Callbacks, and async/await syntax\n• Fetching third-party APIs using REST endpoints',
    duration: '3 Hours',
    methodology: 'Real-time API Weather Dashboard Project'
  }
];

const DEFAULT_OUTCOMES = [
  'Deploy real, modern, responsive static sites to cloud platforms like Vercel or Netlify',
  'Understand and apply fundamental programming logic using Javascript ES6 standards',
  'Navigate and manipulate the browser DOM dynamically using asynchronous fetch promises',
  'Establish robust version control strategies and collaborative workflows using Git/GitHub repositories'
];

const defaultOutlineTemplate: CourseOutline = {
  id: 'outline_default',
  refNumber: 'CO-2026-WD01',
  date: new Date().toISOString().substring(0, 10),
  courseTitle: 'Full-Stack Web Development: Fundamental Bootcamp',
  durationDays: 2,
  totalHours: 14,
  category: 'Web Development',
  level: 'Beginner',
  audience: 'Aspiring developers, career changers, managers wanting technical literacy, and designers looking to code.',
  prerequisites: 'No prior programming experience required. Familiarity with standard computer operations is recommended.',
  overview: 'This intensive bootcamp is designed to transition participants from absolute beginners to capable frontend web builders. Through 100% hands-on coding and real-world projects, students learn semantic layout, modern styling engines, core JavaScript programming logic, and Git collaboration workflows. Perfect for establishing a solid software engineering foundation.',
  outcomes: DEFAULT_OUTCOMES,
  items: DEFAULT_MODULES,
  preparedBy: 'Joel Outreach',
  creatorId: 'xin-ying',
  ownerId: 'xin-ying',
  ownerName: 'Ng Xin Ying',
  isHidden: false,
  isCompleted: false
};

export default function CourseOutlineGenerator({ rep, reps, requestManagerPermission }: CourseOutlineGeneratorProps) {
  // Outlines List state (permanently tied to lzk.joel@gmail.com, matching Quotation Generator's persistence key pattern)
  const [outlines, setOutlines] = useState<CourseOutline[]>(() => {
    const TIED_KEY = 'next_course_outlines_lzk.joel@gmail.com';
    const saved = localStorage.getItem(TIED_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // ignore
      }
    }
    const defaultList = [JSON.parse(JSON.stringify(defaultOutlineTemplate))];
    localStorage.setItem(TIED_KEY, JSON.stringify(defaultList));
    return defaultList;
  });

  const [selectedId, setSelectedId] = useState<string>(() => {
    const saved = localStorage.getItem('next_course_outlines_lzk.joel@gmail.com');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.length > 0) return parsed[0].id;
    }
    return 'outline_default';
  });

  // Undo States
  const [previousOutlines, setPreviousOutlines] = useState<CourseOutline[] | null>(null);
  const [previousSelectedId, setPreviousSelectedId] = useState<string | null>(null);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);

  const handleUndo = async () => {
    if (previousOutlines) {
      setOutlines(previousOutlines);
      localStorage.setItem('next_course_outlines_lzk.joel@gmail.com', JSON.stringify(previousOutlines));
      if (previousSelectedId) {
        setSelectedId(previousSelectedId);
      }
      setPreviousOutlines(null);
      setPreviousSelectedId(null);
      setUndoMessage(null);

      // Sync reverted state to Firestore
      for (const co of previousOutlines) {
        try {
          await setDoc(doc(db, 'course_outlines', co.id), co);
        } catch (err) {
          console.error("Firestore course outline undo sync failed:", err);
        }
      }
    }
  };

  // Toast notification state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Tagging parameters
  const [taggingRowId, setTaggingRowId] = useState<string | null>(null);
  const [tagTargetRepIds, setTagTargetRepIds] = useState<string[]>([]);
  const [tagNoteText, setTagNoteText] = useState('');
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  // Deletion and reset states
  const [outlineToDeleteId, setOutlineToDeleteId] = useState<string | null>(null);
  const [tagResetId, setTagResetId] = useState<string | null>(null);

  // Searching & Sorting
  const [outlineSearchQuery, setOutlineSearchQuery] = useState('');
  const [outlineSortBy, setOutlineSortBy] = useState<'date' | 'title'>('date');
  const [showHiddenOutlines, setShowHiddenOutlines] = useState(false);

  // Workspace Layout Mode ('split' | 'stacked' | 'edit-only' | 'preview-only')
  const [layoutMode, setLayoutMode] = useState<'split' | 'stacked' | 'edit-only' | 'preview-only'>('split');

  // ACTIVE EDITING OBJECT BINDINGS
  const [courseTitle, setCourseTitle] = useState('');
  const [refNumber, setRefNumber] = useState('');
  const [date, setDate] = useState('');
  const [durationDays, setDurationDays] = useState(2);
  const [totalHours, setTotalHours] = useState(14);
  const [category, setCategory] = useState('Web Development');
  const [level, setLevel] = useState<'Beginner' | 'Intermediate' | 'Advanced'>('Beginner');
  const [audience, setAudience] = useState('');
  const [prerequisites, setPrerequisites] = useState('');
  const [overview, setOverview] = useState('');
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [items, setItems] = useState<CourseOutlineItem[]>([]);
  const [preparedBy, setPreparedBy] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [ownerName, setOwnerName] = useState('');

  // Module row inputs
  const [newItemModuleTitle, setNewItemModuleTitle] = useState('');
  const [newItemTopics, setNewItemTopics] = useState('');
  const [newItemDuration, setNewItemDuration] = useState('');
  const [newItemMethodology, setNewItemMethodology] = useState('');

  // Learning outcome input
  const [newOutcome, setNewOutcome] = useState('');

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');

  // Real-time Firestore sync for Course Outlines
  useEffect(() => {
    if (!db) return;

    const q = query(collection(db, 'course_outlines'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const firestoreOutlines: CourseOutline[] = [];
      snapshot.forEach((docSnap) => {
        firestoreOutlines.push({ ...docSnap.data() as CourseOutline, id: docSnap.id });
      });

      if (firestoreOutlines.length > 0) {
        // Maintain stable alphabetical order
        firestoreOutlines.sort((a, b) => a.id.localeCompare(b.id));
        setOutlines(firestoreOutlines);
        localStorage.setItem('next_course_outlines_lzk.joel@gmail.com', JSON.stringify(firestoreOutlines));
      } else {
        // Firestore genuinely has no outlines (either none created yet, or all
        // deleted). Reflect that truthfully instead of re-uploading stale
        // localStorage data or a hardcoded template, which would silently
        // resurrect deleted course outlines.
        setOutlines([]);
        localStorage.setItem('next_course_outlines_lzk.joel@gmail.com', JSON.stringify([]));
      }
    });

    return () => unsubscribe();
  }, []);

  // Sync state with selected item
  useEffect(() => {
    const active = outlines.find(o => o.id === selectedId) || outlines[0] || defaultOutlineTemplate;
    if (!active) return;

    setCourseTitle(active.courseTitle || '');
    setRefNumber(active.refNumber || '');
    setDate(active.date || '');
    setDurationDays(active.durationDays || 2);
    setTotalHours(active.totalHours || 14);
    setCategory(active.category || 'Web Development');
    setLevel(active.level || 'Beginner');
    setAudience(active.audience || '');
    setPrerequisites(active.prerequisites || '');
    setOverview(active.overview || '');
    setOutcomes(active.outcomes || []);
    setItems(active.items || []);
    setPreparedBy(active.preparedBy || rep.name);
    setOwnerId(active.ownerId || active.creatorId || rep.id);
    setOwnerName(active.ownerName || active.preparedBy || rep.name);
  }, [selectedId, outlines, rep]);

  // Save the current values back into the list
  const handleSaveOutline = async () => {
    setPreviousOutlines(JSON.parse(JSON.stringify(outlines)));
    setPreviousSelectedId(selectedId);
    setUndoMessage('Course outline changes saved.');

    const updated = outlines.map(o => {
      if (o.id === selectedId) {
        const updatedItem = {
          ...o,
          courseTitle,
          refNumber,
          date,
          durationDays,
          totalHours,
          category,
          level,
          audience,
          prerequisites,
          overview,
          outcomes,
          items,
          isHidden: o.isHidden ?? false,
          taggedBy: o.taggedBy ?? '',
          tagNote: o.tagNote ?? '',
          preparedBy: o.preparedBy || preparedBy || rep.name,
          creatorId: o.creatorId || rep.id,
          ownerId: ownerId || o.ownerId || rep.id,
          ownerName: ownerName || o.ownerName || rep.name,
          taggedRepId: o.taggedRepId ?? '',
          taggedRepName: o.taggedRepName ?? '',
          isCompleted: o.isCompleted ?? false
        };
        // Sync to Firestore
        setDoc(doc(db, 'course_outlines', o.id), updatedItem).catch(err => console.error("Firestore save course outline failed:", err));
        return updatedItem;
      }
      return o;
    });

    setOutlines(updated);
    localStorage.setItem('next_course_outlines_lzk.joel@gmail.com', JSON.stringify(updated));
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 3000);
  };

  const handleTagOutlineMultiple = async (o: CourseOutline) => {
    if (tagTargetRepIds.length === 0) return;
    try {
      setPreviousOutlines(JSON.parse(JSON.stringify(outlines)));
      setPreviousSelectedId(selectedId);
      setUndoMessage('Course outline tagged successfully.');

      let updated = [...outlines];
      const promises: Promise<void>[] = [];

      tagTargetRepIds.forEach(targetId => {
        const targetRep = reps?.find(r => r.id === targetId);
        if (!targetRep) return;

        const cloned: CourseOutline = JSON.parse(JSON.stringify(o));
        cloned.id = `outline_tagged_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

        // Ownership & Tag metadata
        cloned.creatorId = rep.id;
        cloned.preparedBy = rep.name;
        cloned.taggedRepId = targetId;
        cloned.taggedRepName = targetRep.name;
        cloned.taggedBy = rep.name;
        cloned.isCompleted = false;

        // Clear general fields to ensure representative uses as library template
        cloned.refNumber = `${cloned.refNumber}-TAG`;

        if (tagNoteText.trim()) {
          cloned.tagNote = tagNoteText.trim();
        }

        updated.push(cloned);
        promises.push(setDoc(doc(db, 'course_outlines', cloned.id), cloned));
      });

      setOutlines(updated);
      localStorage.setItem('next_course_outlines_lzk.joel@gmail.com', JSON.stringify(updated));
      await Promise.all(promises);

      const names = tagTargetRepIds.map(id => reps?.find(r => r.id === id)?.name || id).join(', ');
      setActionStatus(`Successfully tagged ${names} on this course outline!`);
      setTagTargetRepIds([]);
      setTagNoteText('');

      setTimeout(() => {
        setActionStatus(null);
        setTaggingRowId(null);
      }, 3000);

      showToast('Course outline shared with tagged reps', 'success');
    } catch (e) {
      showToast('Tagging failed', 'error');
    }
  };

  const handleDeleteOutline = (idToDelete: string) => {
    if (outlines.length <= 1) {
      showToast('Cannot delete the only course outline. Please create another one first.', 'error');
      return;
    }
    setOutlineToDeleteId(idToDelete);
  };

  const confirmDeleteOutline = (idToDelete: string) => {
    requestManagerPermission(async () => {
      setOutlineToDeleteId(null);
      setPreviousOutlines(JSON.parse(JSON.stringify(outlines)));
      setPreviousSelectedId(selectedId);
      setUndoMessage('Course outline deleted.');

      const remaining = outlines.filter(o => o.id !== idToDelete);
      setOutlines(remaining);
      localStorage.setItem('next_course_outlines_lzk.joel@gmail.com', JSON.stringify(remaining));

      // Sync deletion to Firestore
      try {
        await deleteDoc(doc(db, 'course_outlines', idToDelete));
      } catch (err) {
        console.error("Firestore delete course outline failed:", err);
      }

      if (selectedId === idToDelete && remaining.length > 0) {
        setSelectedId(remaining[0].id);
      } else if (remaining.length === 0) {
        // Genuinely no outlines left — leave it empty. The library table and
        // preview panel already fall back gracefully to a blank/template
        // state on their own (outlines.find(...) || outlines[0] ||
        // defaultOutlineTemplate), so there's no need to actually write a
        // placeholder back into Firestore here.
        setSelectedId('');
      }
      showToast('Outline deleted successfully', 'success');
    });
  };

  const handleResetTagParameters = async (idToReset: string) => {
    let updatedItem: CourseOutline | null = null;
    const updated = outlines.map(o => {
      if (o.id === idToReset) {
        const copy: CourseOutline = {
          ...o,
          taggedRepId: '',
          taggedRepName: '',
          taggedBy: '',
          isCompleted: false,
          tagNote: ''
        };
        updatedItem = copy;
        return copy;
      }
      return o;
    });
    setOutlines(updated);
    localStorage.setItem('next_course_outlines_lzk.joel@gmail.com', JSON.stringify(updated));
    setTagResetId(null);
    showToast('Tag configurations cleared!', 'success');

    if (updatedItem) {
      try {
        await setDoc(doc(db, 'course_outlines', idToReset), updatedItem);
      } catch (err) {
        console.error("Firestore reset tag failed:", err);
      }
    }
  };

  const handleMarkCompleted = async (o: CourseOutline) => {
    setPreviousOutlines(JSON.parse(JSON.stringify(outlines)));
    setPreviousSelectedId(selectedId);
    setUndoMessage('Course outline marked as completed & untagged.');

    const updated = outlines.map(item => {
      if (item.id === o.id) {
        const updatedItem = { ...item, isCompleted: true };
        setDoc(doc(db, 'course_outlines', o.id), updatedItem).catch(err => console.error("Firestore complete course outline failed:", err));
        return updatedItem;
      }
      return item;
    });
    setOutlines(updated);
    localStorage.setItem('next_course_outlines_lzk.joel@gmail.com', JSON.stringify(updated));
    showToast('Course outline marked as completed!');
  };

  // Toggle Hide/Unhide a prepared outline
  const toggleHideOutline = async (id: string) => {
    setPreviousOutlines(JSON.parse(JSON.stringify(outlines)));
    setPreviousSelectedId(selectedId);
    setUndoMessage('Course outline visibility toggled.');

    const updated = outlines.map(o => {
      if (o.id === id) {
        const updatedItem = { ...o, isHidden: !o.isHidden };
        setDoc(doc(db, 'course_outlines', id), updatedItem).catch(err => console.error("Firestore toggle hidden failed:", err));
        return updatedItem;
      }
      return o;
    });
    setOutlines(updated);
    localStorage.setItem('next_course_outlines_lzk.joel@gmail.com', JSON.stringify(updated));
  };

  const handleCreateNewOutline = async () => {
    const newObj: CourseOutline = {
      id: `outline_${Date.now()}`,
      refNumber: `CO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      date: new Date().toISOString().substring(0, 10),
      courseTitle: 'New Professional Course Outline',
      durationDays: 1,
      totalHours: 7,
      category: 'Software Engineering',
      level: 'Intermediate',
      audience: 'Working professionals seeking technical skills.',
      prerequisites: 'Basic knowledge of the course topic.',
      overview: 'Provide a brief summary detailing the key learning journeys, industry relevances, and targeted skill upgrades here.',
      outcomes: ['List learning outcome #1 here'],
      items: [
        {
          id: `module_1_${Date.now()}`,
          no: 1,
          moduleTitle: 'Module 1: Foundations',
          topics: '• Key Concept 1\n• Hands-on Project Part A',
          duration: '3 Hours',
          methodology: 'Hands-on training'
        }
      ],
      preparedBy: rep.name,
      creatorId: rep.id,
      ownerId: rep.id,
      ownerName: rep.name
    };

    const updated = [newObj, ...outlines];
    setOutlines(updated);
    localStorage.setItem('next_course_outlines_lzk.joel@gmail.com', JSON.stringify(updated));
    setSelectedId(newObj.id);
    showToast('Created new empty course outline template!', 'success');

    // Sync to Firestore
    try {
      await setDoc(doc(db, 'course_outlines', newObj.id), newObj);
    } catch (err) {
      console.error("Firestore create course outline failed:", err);
    }
  };

  // Filter & sort list
  const filteredOutlines = outlines.filter(o => {
    // Privacy constraints
    const isSystemDefault = !o.creatorId && !o.preparedBy;
    const isOwner =
      o.creatorId === rep.id ||
      o.preparedBy === rep.name ||
      o.ownerId === rep.id ||
      (o.ownerName && o.ownerName === rep.name);
    const isTagged = o.taggedRepId === rep.id;

    if (isTagged && o.isCompleted) return false;
    if (!isSystemDefault && !isOwner && !isTagged) return false;
    if (!showHiddenOutlines && o.isHidden) return false;

    const q = outlineSearchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      (o.courseTitle || '').toLowerCase().includes(q) ||
      (o.refNumber || '').toLowerCase().includes(q) ||
      (o.category || '').toLowerCase().includes(q)
    );
  }).sort((a, b) => {
    if (outlineSortBy === 'title') {
      return (a.courseTitle || '').localeCompare(b.courseTitle || '');
    }
    return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
  });

  // Module Row Management
  const handleAddModuleRow = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemModuleTitle.trim()) {
      showToast('Please specify a module title', 'error');
      return;
    }
    const newMod: CourseOutlineItem = {
      id: `mod_${Date.now()}`,
      no: items.length + 1,
      moduleTitle: newItemModuleTitle.trim(),
      topics: newItemTopics.trim() || '• Topic 1\n• Topic 2',
      duration: newItemDuration.trim() || '2 Hours',
      methodology: newItemMethodology.trim() || 'Interactive Lecture'
    };
    setItems([...items, newMod]);
    setNewItemModuleTitle('');
    setNewItemTopics('');
    setNewItemDuration('');
    setNewItemMethodology('');
  };

  const handleRemoveModuleRow = (id: string) => {
    const filtered = items.filter(m => m.id !== id).map((m, idx) => ({
      ...m,
      no: idx + 1
    }));
    setItems(filtered);
  };

  // Learning Outcomes Management
  const handleAddOutcome = () => {
    if (!newOutcome.trim()) return;
    setOutcomes([...outcomes, newOutcome.trim()]);
    setNewOutcome('');
  };

  const handleRemoveOutcome = (idx: number) => {
    setOutcomes(outcomes.filter((_, i) => i !== idx));
  };

  // Native browser print (matches Quotation Generator's print approach)
  const handlePrint = () => {
    window.print();
  };

  const getOutlineTotal = (o: CourseOutline) => `${o.durationDays || 0}D / ${o.totalHours || 0}H`;

  return (
    <div className="space-y-6">
      {/* CSS print override styles — mirrors Quotation Generator's print-paper approach */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body * {
            visibility: hidden !important;
          }
          #root,
          #root div,
          .print-container-wrapper,
          .print-paper,
          .print-paper * {
            visibility: visible !important;
          }
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
          .outline-grid {
            border-collapse: collapse !important;
            width: 100% !important;
            border: 1px solid #000000 !important;
          }
          .outline-grid th, .outline-grid td {
            border: 1px solid #000000 !important;
            padding: 6px !important;
            color: #000000 !important;
          }
          .outline-grid th {
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
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>{undoMessage}</span>
          </div>
          <button
            onClick={handleUndo}
            className="flex items-center gap-1.5 text-[11px] font-black text-emerald-400 hover:text-emerald-300 bg-white/10 hover:bg-white/15 px-3 py-1 rounded-lg transition-all uppercase tracking-wider cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" /> Undo
          </button>
        </div>
      )}

      {/* Header Panel with Outline Selector */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div className="space-y-1">
          <h4 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5 font-display">
            <BookOpen className="w-4 h-4 text-emerald-600" />
            Interactive Course Outline Builder
          </h4>
          <p className="text-xs text-slate-500">
            Generate and save official NEXT Academy syllabus outlines, ready for print or PDF export.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-slate-100 font-bold px-2.5 py-1.5 rounded border border-slate-200 text-xs">
            <span className="text-slate-500 uppercase tracking-wider">Select Outline:</span>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="bg-white text-slate-800 font-mono font-bold border border-slate-200 focus:outline-none cursor-pointer rounded px-2 py-0.5 text-xs"
            >
              {outlines.map(o => (
                <option key={o.id} value={o.id}>{o.courseTitle ? o.courseTitle.substring(0, 28) : 'Untitled Outline'} ({o.refNumber})</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleCreateNewOutline}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs uppercase tracking-wider px-3.5 py-2 rounded-lg border border-slate-250 transition-colors"
          >
            Create New
          </button>

          <button
            onClick={() => handleDeleteOutline(selectedId)}
            className="bg-rose-50 hover:bg-rose-100 text-rose-600 font-black text-xs uppercase tracking-wider px-3.5 py-2 rounded-lg border border-rose-200 transition-colors"
            title="Delete current course outline template"
          >
            Delete
          </button>
        </div>
      </div>

      {/* PREPARED OUTLINES LIBRARY — SEARCHABLE, SORTABLE, HIDEABLE */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs no-print space-y-4" id="outline-library-panel">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-100">
          <div className="space-y-1">
            <h5 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5 font-display">
              <Layers className="w-4 h-4 text-emerald-600" />
              Syllabus Library
            </h5>
            <p className="text-[11px] text-slate-500">
              Manage your prepared outlines. Hide/unhide, sort, or search to load into the interactive workspace.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by title, ref, category..."
                value={outlineSearchQuery}
                onChange={(e) => setOutlineSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-emerald-500 bg-slate-50 w-56 font-medium"
              />
            </div>

            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
              <span>Sort:</span>
              <select
                value={outlineSortBy}
                onChange={(e) => setOutlineSortBy(e.target.value as any)}
                className="bg-white border border-slate-200 rounded px-2 py-1 cursor-pointer font-sans"
              >
                <option value="date">Latest Date</option>
                <option value="title">Course Title</option>
              </select>
            </div>

            <button
              onClick={() => setShowHiddenOutlines(!showHiddenOutlines)}
              className={`text-xs font-black px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1 ${
                showHiddenOutlines
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {showHiddenOutlines ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              {showHiddenOutlines ? 'Showing Hidden' : 'Show Hidden Drafts'}
            </button>
          </div>
        </div>

        {filteredOutlines.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-200 rounded-xl">
            <p className="text-xs text-slate-500 font-semibold">
              No prepared course outlines match your query or filters.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50 text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">
                  <th className="py-2 px-3">Ref. Number</th>
                  <th className="py-2 px-3">Date</th>
                  <th className="py-2 px-3">Course Title</th>
                  <th className="py-2 px-3">Owner / Prep</th>
                  <th className="py-2 px-3 text-right">Duration / Level</th>
                  <th className="py-2 px-3 text-center">Status</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {filteredOutlines.map(o => {
                  const isCurrent = o.id === selectedId;
                  return (
                    <React.Fragment key={o.id}>
                      <tr
                        className={`hover:bg-slate-50/50 transition-colors ${
                          isCurrent ? 'bg-emerald-50/20 border-l-2 border-l-emerald-500' : ''
                        } ${
                          o.taggedRepId === rep.id && !o.isCompleted ? 'bg-rose-50 border-l-4 border-l-rose-500 animate-pulse' : ''
                        }`}
                      >
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-800">{o.refNumber || 'N/A'}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-500">{o.date || 'N/A'}</td>
                        <td className="py-2.5 px-3">
                          <span className="font-extrabold text-slate-900 block truncate max-w-[220px]" title={o.courseTitle}>
                            {o.courseTitle || 'Untitled Course Outline'}
                          </span>
                          {o.taggedBy && (
                            <div className="space-y-1 mt-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 border border-purple-200 text-purple-700 rounded text-[9px] font-black font-mono uppercase tracking-wider">
                                <Tag className="w-2.5 h-2.5" /> Tagged by {o.taggedBy}
                              </span>
                              {o.tagNote && (
                                <div className="text-[10px] text-purple-600 bg-purple-50/40 rounded-lg p-1.5 italic border border-purple-100 max-w-[220px]">
                                  "{o.tagNote}"
                                </div>
                              )}
                            </div>
                          )}
                          {o.taggedRepId && (
                            <div className="mt-1">
                              {o.isCompleted ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded text-[9px] font-black font-mono uppercase tracking-wider">
                                  <CheckCircle className="w-2.5 h-2.5 text-emerald-600" /> Completed by {o.taggedRepName}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded text-[9px] font-black font-mono uppercase tracking-wider animate-pulse">
                                  <Clock className="w-2.5 h-2.5 text-amber-600" /> Pending: {o.taggedRepName}
                                </span>
                              )}
                            </div>
                          )}
                          <span className="text-[10px] text-slate-400 block mt-0.5">{o.category}</span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 font-semibold truncate max-w-[150px]">
                          <div className="font-extrabold text-slate-900">{o.ownerName || o.preparedBy || rep.name}</div>
                          {o.preparedBy && o.preparedBy !== o.ownerName && (
                            <div className="text-[10px] text-slate-400 font-normal mt-0.5">Prep: {o.preparedBy}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-black text-slate-800">
                          {getOutlineTotal(o)}
                          <div className="text-[9px] text-slate-400 font-sans font-bold uppercase mt-0.5">{o.level}</div>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {o.isHidden ? (
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
                            <button
                              onClick={() => {
                                setSelectedId(o.id);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                                showToast('Course outline loaded into workspace for Full Edit!');
                              }}
                              className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded transition-all flex items-center gap-1 ${
                                isCurrent
                                  ? 'bg-emerald-600 text-white font-black shadow-3xs animate-pulse'
                                  : 'bg-slate-100 hover:bg-emerald-50 hover:text-emerald-600 text-slate-700 border border-slate-200'
                              }`}
                              title="Load course outline into active workspace editor for full amendments and saving"
                            >
                              ✏️ {isCurrent ? 'Active' : 'Full Edit'}
                            </button>

                            {o.taggedRepId === rep.id && !o.isCompleted && (
                              <button
                                onClick={() => handleMarkCompleted(o)}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase tracking-wider rounded transition-all cursor-pointer flex items-center gap-1 shadow-3xs"
                                title="Mark completed & untag yourself"
                              >
                                <Check className="w-3 h-3 text-white" /> Done
                              </button>
                            )}

                            <button
                              onClick={() => {
                                if (taggingRowId === o.id) {
                                  setTaggingRowId(null);
                                } else {
                                  setTaggingRowId(o.id);
                                  setTagTargetRepIds([]);
                                  setTagNoteText('');
                                  setActionStatus(null);
                                }
                              }}
                              className={`p-1.5 rounded transition-all border ${
                                taggingRowId === o.id
                                  ? 'bg-purple-100 text-purple-700 border-purple-300'
                                  : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                              }`}
                              title="Tag other representatives"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => toggleHideOutline(o.id)}
                              className={`p-1.5 rounded transition-all border ${
                                o.isHidden
                                  ? 'bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100'
                                  : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                              }`}
                              title={o.isHidden ? 'Unhide outline from the library list' : 'Hide outline from the library list'}
                            >
                              {o.isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>

                            {(o.creatorId === rep.id || o.preparedBy === rep.name || o.ownerId === rep.id || (o.ownerName && o.ownerName === rep.name) || !o.creatorId) && o.taggedRepId && (
                              <button
                                onClick={() => setTagResetId(o.id)}
                                className="p-1.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-600 border border-amber-200 transition-all cursor-pointer"
                                title="Reset tagging & clear tag parameters"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}

                            <button
                              onClick={() => handleDeleteOutline(o.id)}
                              className="p-1.5 rounded bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition-all"
                              title="Permanently delete template"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {taggingRowId === o.id && (
                        <tr className="bg-slate-50/70 border-b border-slate-100">
                          <td colSpan={7} className="p-4">
                            <div className="space-y-3 max-w-md">
                              <h5 className="text-[10px] font-black uppercase tracking-wider text-slate-500 font-mono">
                                Tag/Share Course Outline with Team Members
                              </h5>
                              <p className="text-[11px] text-slate-400 font-medium">
                                Select team members and enter a comment. This will make a copy of this course outline available in their personal syllabus library.
                              </p>

                              {actionStatus && (
                                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-[11px] text-emerald-800 font-semibold">
                                  {actionStatus}
                                </div>
                              )}

                              <div className="space-y-1.5 border border-slate-100 rounded-lg p-3 bg-white shadow-3xs">
                                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                                  Select Team Members (Select Multiple):
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                  {(reps || []).filter(r => r.id !== rep.id).map(r => {
                                    const isChecked = tagTargetRepIds.includes(r.id);
                                    return (
                                      <label key={r.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:text-emerald-600 transition-colors">
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => {
                                            if (isChecked) {
                                              setTagTargetRepIds(tagTargetRepIds.filter(id => id !== r.id));
                                            } else {
                                              setTagTargetRepIds([...tagTargetRepIds, r.id]);
                                            }
                                          }}
                                          className="rounded border-slate-350 text-emerald-600 focus:ring-emerald-500 h-3.5 w-3.5 cursor-pointer"
                                        />
                                        <span>{r.name}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>

                              <div className="space-y-1">
                                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                                  Note / Comment Box:
                                </label>
                                <textarea
                                  value={tagNoteText}
                                  onChange={(e) => setTagNoteText(e.target.value)}
                                  placeholder="e.g. Please review this syllabus outline! Let me know if you need any adjustments."
                                  rows={2}
                                  className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white"
                                />
                              </div>

                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => handleTagOutlineMultiple(o)}
                                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-[10px] font-black uppercase transition-all cursor-pointer"
                                  disabled={tagTargetRepIds.length === 0}
                                >
                                  Tag Representatives
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setTaggingRowId(null);
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
              layoutMode === 'split' ? 'bg-emerald-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            ↔️ Split Screen
          </button>
          <button
            onClick={() => setLayoutMode('stacked')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
              layoutMode === 'stacked' ? 'bg-emerald-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            ↕️ Stacked View
          </button>
          <button
            onClick={() => setLayoutMode('edit-only')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
              layoutMode === 'edit-only' ? 'bg-emerald-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            📝 Form Only
          </button>
          <button
            onClick={() => setLayoutMode('preview-only')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
              layoutMode === 'preview-only' ? 'bg-emerald-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-50'
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
                <Edit3 className="w-4 h-4 text-emerald-400" />
                1. Syllabus Metadata
              </h5>
              <span className="text-[10px] bg-slate-700 text-slate-300 font-mono font-bold px-2 py-0.5 rounded">
                Ref & Scope
              </span>
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
                    title="This is the person who prepared/drafted the course outline."
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 tracking-wider flex items-center gap-1">
                    Outline Owner <span className="text-[9px] text-emerald-500 font-normal lowercase">(has library copy)</span>
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
                    className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white font-bold"
                  >
                    {reps?.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name} {r.id === rep.id ? '(You)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-600 uppercase mb-2 tracking-wider">
                  Course Title
                </label>
                <input
                  type="text"
                  value={courseTitle}
                  onChange={(e) => setCourseTitle(e.target.value)}
                  placeholder="e.g. UX Design Foundations Mastery"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3.5 py-2.5 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black text-slate-600 uppercase mb-2 tracking-wider">
                    Outline Reference Code
                  </label>
                  <input
                    type="text"
                    value={refNumber}
                    onChange={(e) => setRefNumber(e.target.value)}
                    placeholder="e.g. CO-2026-UX01"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3.5 py-2.5 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white font-mono font-medium"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-600 uppercase mb-2 tracking-wider">
                    Issue Date
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3.5 py-2.5 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white font-medium"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 tracking-wider">
                    Duration (Days)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={durationDays}
                    onChange={(e) => setDurationDays(parseInt(e.target.value) || 1)}
                    className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 tracking-wider">
                    Total Hours
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="240"
                    value={totalHours}
                    onChange={(e) => setTotalHours(parseInt(e.target.value) || 1)}
                    className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 tracking-wider">
                    Difficulty Level
                  </label>
                  <select
                    value={level}
                    onChange={(e) => setLevel(e.target.value as any)}
                    className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white font-bold"
                  >
                    <option value="Beginner">Beginner</option>
                    <option value="Intermediate">Intermediate</option>
                    <option value="Advanced">Advanced</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-600 uppercase mb-2 tracking-wider">
                  Category / Area
                </label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Digital Marketing, Team Building"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3.5 py-2.5 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-600 uppercase mb-2 tracking-wider">
                  Target Audience
                </label>
                <textarea
                  rows={2}
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  placeholder="Identify the targeted user persona or background..."
                  className="w-full text-sm border border-slate-200 rounded-lg px-3.5 py-2.5 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-600 uppercase mb-2 tracking-wider">
                  Prerequisites
                </label>
                <input
                  type="text"
                  value={prerequisites}
                  onChange={(e) => setPrerequisites(e.target.value)}
                  placeholder="e.g. Basic math, no previous coding experience required."
                  className="w-full text-sm border border-slate-200 rounded-lg px-3.5 py-2.5 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-600 uppercase mb-2 tracking-wider">
                  Course Overview / Description
                </label>
                <textarea
                  rows={3}
                  value={overview}
                  onChange={(e) => setOverview(e.target.value)}
                  placeholder="Describe the overall scope, curriculum focus, and value proposition..."
                  className="w-full text-sm border border-slate-200 rounded-lg px-3.5 py-2.5 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white"
                />
              </div>
            </div>
          </div>

          {/* Learning Outcomes Editor */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="p-4 bg-slate-800 text-white flex items-center justify-between">
              <h5 className="text-xs font-black uppercase tracking-wider font-display flex items-center gap-1.5 text-white">
                <Info className="w-4 h-4 text-emerald-400" />
                2. Learning Outcomes
              </h5>
              <span className="text-[10px] bg-slate-700 text-slate-300 font-mono font-bold px-2 py-0.5 rounded">
                Competencies
              </span>
            </div>

            <div className="p-5 space-y-3">
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="Add learning outcome (e.g. Deploy custom server routing...)"
                  value={newOutcome}
                  onChange={(e) => setNewOutcome(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { handleAddOutcome(); e.preventDefault(); } }}
                  className="flex-1 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={handleAddOutcome}
                  className="bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-bold px-3 text-xs rounded-lg"
                >
                  Add
                </button>
              </div>

              <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
                {outcomes.map((out, idx) => (
                  <div key={idx} className="flex justify-between items-start gap-2 bg-slate-50 p-2 rounded-lg text-[11px] text-slate-600">
                    <p className="flex-1 text-left font-medium leading-relaxed">✓ {out}</p>
                    <button
                      type="button"
                      onClick={() => handleRemoveOutcome(idx)}
                      className="text-rose-500 hover:text-rose-700 p-0.5"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Modular Breakdown Builder */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="p-4 bg-slate-800 text-white flex items-center justify-between">
              <h5 className="text-xs font-black uppercase tracking-wider font-display flex items-center gap-1.5 text-white">
                <ClipboardList className="w-4 h-4 text-emerald-400" />
                3. Module / Syllabus Builder
              </h5>
              <span className="text-[10px] bg-slate-700 text-slate-300 font-mono font-bold px-2 py-0.5 rounded">
                {items.length} Modules
              </span>
            </div>

            <div className="p-5 space-y-4">
              {/* Add New Row Form */}
              <form onSubmit={handleAddModuleRow} className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-150">
                <span className="block text-[10px] font-black text-slate-600 uppercase tracking-wider">
                  Add Module to Outline
                </span>

                <div>
                  <label className="block text-[9px] font-black text-slate-500 uppercase mb-1">
                    Module Title
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Module 3: Advanced UI Styling"
                    value={newItemModuleTitle}
                    onChange={(e) => setNewItemModuleTitle(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-black text-slate-500 uppercase mb-1">
                    Topics Covered
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Use bullet points like: • Topic A\n• Topic B"
                    value={newItemTopics}
                    onChange={(e) => setNewItemTopics(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-black text-slate-500 uppercase mb-1">
                      Duration
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 4 Hours"
                      value={newItemDuration}
                      onChange={(e) => setNewItemDuration(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-black text-slate-500 uppercase mb-1">
                      Methodology
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Practical Lab"
                      value={newItemMethodology}
                      onChange={(e) => setNewItemMethodology(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-emerald-500 bg-white font-semibold"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase tracking-wider py-2 rounded-lg transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Module Row
                </button>
              </form>

              {/* Current Listing for deletion */}
              <div className="space-y-2 mt-3 pt-3 border-t border-slate-100">
                <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Current Module Lines:
                </span>
                {items.length === 0 ? (
                  <p className="text-xs text-slate-400 italic text-center py-2">No modules added. Use form above to add.</p>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-[220px] overflow-y-auto">
                    {items.map((m) => (
                      <div key={m.id} className="flex justify-between items-start py-2 text-xs gap-2">
                        <div className="truncate pr-4 flex-1">
                          <p className="font-extrabold text-slate-800 truncate">Module {m.no}: {m.moduleTitle}</p>
                          <p className="text-[10px] text-slate-500 font-mono">
                            {m.duration} • {m.methodology}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveModuleRow(m.id)}
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

          {/* Action Footer Button Bar (Save Outline changes) */}
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
              onClick={handleSaveOutline}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider px-6 py-2.5 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <Save className="w-4 h-4" />
              Save Outline
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN: LIVE HIGH-FIDELITY PREVIEW & PRINT */}
        <div className={`${
          layoutMode === 'preview-only'
            ? 'lg:col-span-12'
            : layoutMode === 'edit-only'
              ? 'hidden print:block lg:col-span-12'
              : layoutMode === 'stacked'
                ? 'lg:col-span-12'
                : 'lg:col-span-7'
        } space-y-4 print-container-wrapper`}>

          <div className="flex justify-between items-center no-print">
            <div className="space-y-1">
              <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest font-mono bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded inline-block">
                High-Fidelity Document Preview
              </span>
              <p className="text-[9px] text-slate-400 font-medium max-w-[250px] leading-tight">
                Tip: If the PDF save dialog is blocked by the editor, click "Open in New Tab" at the top-right of your screen to save perfectly.
              </p>
            </div>
            <button
              onClick={handlePrint}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider px-5 py-2.5 rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              Save as PDF
            </button>
          </div>

          <div className="w-full overflow-x-auto pb-4 print:overflow-visible print:pb-0">
            <div className="bg-white border border-slate-300 rounded-xl shadow-xl overflow-hidden print-paper text-slate-900 font-sans p-8 md:p-12 space-y-6 max-w-4xl mx-auto min-w-[760px] lg:min-w-0">

              {/* Header block with logo */}
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

              {/* Document Title Block */}
              <div className="border-b border-slate-200 pb-2 mb-4 flex justify-between items-end">
                <h2 className="text-lg md:text-xl font-extrabold tracking-widest text-slate-800 uppercase">
                  COURSE OUTLINE
                </h2>
                <span className="text-[10px] font-bold text-slate-400 font-mono">
                  REF: {refNumber || 'DRAFT'}
                </span>
              </div>

              <div className="space-y-1">
                <h1 className="text-base md:text-lg font-extrabold text-slate-900 uppercase tracking-tight leading-tight">
                  {courseTitle || 'UNTITLED SYLLABUS COURSE'}
                </h1>
              </div>

              {/* Address / Meta Reference details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                <div className="space-y-2">
                  <div className="flex">
                    <span className="font-extrabold text-slate-500 uppercase tracking-wider w-28">Category:</span>
                    <span className="font-bold text-slate-800">{category || 'N/A'}</span>
                  </div>
                  <div className="flex">
                    <span className="font-extrabold text-slate-500 uppercase tracking-wider w-28">Level:</span>
                    <span className="inline-block bg-emerald-50 border border-emerald-200 text-emerald-700 font-black text-[11px] uppercase px-1.5 py-0.5 rounded">
                      {level}
                    </span>
                  </div>
                  <div className="flex">
                    <span className="font-extrabold text-slate-500 uppercase tracking-wider w-28">Duration:</span>
                    <span className="text-slate-600 font-medium leading-relaxed flex-1">{durationDays} Days ({totalHours} Hours)</span>
                  </div>
                </div>

                <div className="space-y-2 md:pl-6 md:border-l border-slate-100 font-mono">
                  <div className="flex">
                    <span className="font-extrabold text-slate-500 uppercase tracking-wider w-32">Ref. Number:</span>
                    <span className="font-extrabold text-emerald-700">{refNumber || 'N/A'}</span>
                  </div>
                  <div className="flex">
                    <span className="font-extrabold text-slate-500 uppercase tracking-wider w-32">Date:</span>
                    <span className="font-bold text-slate-700">{date || 'N/A'}</span>
                  </div>
                  <div className="flex">
                    <span className="font-extrabold text-slate-500 uppercase tracking-wider w-32">Prepared By:</span>
                    <span className="text-slate-600 font-semibold">{preparedBy || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* Logistics bar */}
              <div className="bg-slate-50/50 border border-slate-200/80 rounded-lg p-5 grid grid-cols-1 md:grid-cols-2 gap-5 text-sm font-sans shadow-2xs">
                <div>
                  <span className="block text-[11px] font-black text-slate-400 uppercase tracking-widest font-mono">Target Audience</span>
                  <span className="font-extrabold text-slate-800 mt-1.5 block">{audience || 'Open enrollment'}</span>
                </div>
                <div>
                  <span className="block text-[11px] font-black text-slate-400 uppercase tracking-widest font-mono">Prerequisites</span>
                  <span className="font-semibold text-slate-800 mt-1.5 block">{prerequisites || 'None specified'}</span>
                </div>
              </div>

              {/* Overview */}
              <div className="space-y-1.5">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider font-mono border-b border-slate-100 pb-1">
                  Course Synopsis
                </h3>
                <p className="text-xs md:text-sm text-slate-600 text-justify leading-relaxed">
                  {overview || 'Provide course overview details in the left editor panel...'}
                </p>
              </div>

              {/* Outcomes */}
              {outcomes.length > 0 && (
                <div className="space-y-1.5">
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider font-mono border-b border-slate-100 pb-1">
                    Key Competency Outcomes
                  </h3>
                  <ul className="space-y-1 list-disc pl-4 text-xs md:text-sm text-slate-600 font-medium">
                    {outcomes.map((out, idx) => (
                      <li key={idx}>{out}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* PAGE BREAK before the modular curriculum table, matching Quotation's T&C pagination */}
              <div className="page-break" />

              {/* Modular Breakdown Table */}
              <div className="overflow-x-auto pt-2">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider font-mono mb-3">
                  Curriculum Path
                </h3>
                <table className="w-full text-left outline-grid border border-slate-300 text-sm">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-300 text-[11px] font-black text-slate-500 uppercase tracking-widest font-mono">
                      <th className="p-3.5 w-12 text-center border-r border-slate-300">No.</th>
                      <th className="p-3.5 border-r border-slate-300">Module Title</th>
                      <th className="p-3.5 border-r border-slate-300">Topics Covered</th>
                      <th className="p-3.5 w-28 border-r border-slate-300">Duration</th>
                      <th className="p-3.5 w-40">Methodology</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-250 text-slate-800 font-sans">
                    {items.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50/40">
                        <td className="p-3.5 text-center font-mono font-bold border-r border-slate-200">{m.no}</td>
                        <td className="p-3.5 font-extrabold text-slate-900 border-r border-slate-200 leading-normal">{m.moduleTitle}</td>
                        <td className="p-3.5 text-slate-600 font-medium border-r border-slate-200 leading-normal whitespace-pre-wrap">{m.topics}</td>
                        <td className="p-3.5 font-mono font-bold text-slate-600 border-r border-slate-200 text-xs">{m.duration}</td>
                        <td className="p-3.5 font-semibold text-slate-700 italic text-xs leading-normal">{m.methodology}</td>
                      </tr>
                    ))}

                    {items.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-slate-400 italic text-xs">
                          No modules added yet. Add a module in the left editor panel.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Bottom corporate signature area */}
              <div className="pt-12 grid grid-cols-2 gap-12 text-sm font-sans">
                <div className="space-y-12">
                  <p className="font-bold text-slate-500">Prepared By:</p>
                  <div className="border-t border-slate-300 pt-1.5 w-48">
                    <p className="font-extrabold text-slate-800">{preparedBy || rep.name}</p>
                    <p className="text-xs text-slate-400 font-mono font-semibold">NEXT Academy Representative</p>
                  </div>
                </div>

                <div className="space-y-12 text-right flex flex-col items-end">
                  <p className="font-bold text-slate-500 text-left w-48">Approved By:</p>
                  <div className="border-t border-slate-300 pt-1.5 w-48 text-left">
                    <p className="font-extrabold text-slate-800">Academic Board Signatory</p>
                    <p className="text-xs text-slate-400 font-mono font-semibold">Designation & Stamp</p>
                  </div>
                </div>
              </div>

              <div className="text-center text-[10px] text-slate-400 pt-6 border-t border-slate-100 font-mono">
                © {new Date().getFullYear()} NEXT Academy. All Rights Reserved. This syllabus outline is proprietary information.
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* Toast notifications */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[9999] rounded-xl p-4 flex items-center gap-3 shadow-lg border animate-bounce no-print ${
          toast.type === 'error'
            ? 'bg-rose-50 text-rose-800 border-rose-200'
            : 'bg-emerald-50 text-emerald-800 border-emerald-200'
        }`}>
          <span className={`w-2 h-2 rounded-full ${toast.type === 'error' ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500 animate-pulse'}`} />
          <span className="text-xs font-black uppercase tracking-wider">{toast.message}</span>
        </div>
      )}

      {/* Custom Delete Confirmation Modal */}
      {outlineToDeleteId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs no-print">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl max-w-sm w-full mx-4 space-y-4 animate-scale-in">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2 bg-rose-50 rounded-full">
                <Trash2 className="w-6 h-6 text-rose-600" />
              </div>
              <h4 className="text-sm font-black uppercase tracking-wider font-display">Delete Course Outline?</h4>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed font-semibold">
              Are you absolutely sure you want to permanently delete this course outline from NEXT Academy's syllabus library? This action is irreversible.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setOutlineToDeleteId(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmDeleteOutline(outlineToDeleteId)}
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
              Are you sure you want to reset tagging and clear all tag parameters from this course outline?
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
                onClick={() => handleResetTagParameters(tagResetId)}
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
