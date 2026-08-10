import React, { useState, useEffect } from 'react';
import { Quotation, QuotationItem, Representative } from '../types';
import { Plus, Trash2, Printer, Save, FileText, CheckCircle, RefreshCw, Layers, Edit3, ClipboardList, Info, Search, Eye, EyeOff, Tag, Share2, RotateCcw, Cloud, Check, Clock } from 'lucide-react';
import Logo from './Logo';
import { initAuth, googleSignIn, googleSignOut, syncQuotationToGoogleSheet } from '../lib/googleCalendar';
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

const DEFAULT_OUTLINE_TEMPLATE: CourseOutline = {
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
    const defaultList = [JSON.parse(JSON.stringify(DEFAULT_OUTLINE_TEMPLATE))];
    localStorage.setItem(TIED_KEY, JSON.stringify(defaultList));
    return defaultList;
  });

  const [selectedId, setSelectedId] = useState<string>(() => {
    const defaultList = [DEFAULT_OUTLINE_TEMPLATE];
    return defaultList[0].id;
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
    const active = outlines.find(o => o.id === selectedId) || outlines[0] || DEFAULT_OUTLINE_TEMPLATE;
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
    setUndoMessage('Outline saved successfully.');

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
          isHidden: o.isHidden,
          taggedBy: o.taggedBy,
          tagNote: o.tagNote,
          preparedBy: o.preparedBy || preparedBy || rep.name,
          creatorId: o.creatorId || rep.id,
          ownerId: ownerId || o.ownerId || rep.id,
          ownerName: ownerName || o.ownerName || rep.name,
          taggedRepId: o.taggedRepId,
          taggedRepName: o.taggedRepName,
          isCompleted: o.isCompleted
        };
        // Sync to Firestore
        setDoc(doc(db, 'course_outlines', o.id), updatedItem).catch(err => console.error("Firestore save course outline failed:", err));
        return updatedItem;
      }
      return o;
    });

    setOutlines(updated);
    localStorage.setItem('next_course_outlines_lzk.joel@gmail.com', JSON.stringify(updated));
    showToast('Course outline saved successfully!', 'success');
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
    requestManagerPermission(async () => {
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
        // Reset with default template
        const freshDefault = [JSON.parse(JSON.stringify(DEFAULT_OUTLINE_TEMPLATE))];
        setOutlines(freshDefault);
        localStorage.setItem('next_course_outlines_lzk.joel@gmail.com', JSON.stringify(freshDefault));
        setSelectedId(freshDefault[0].id);

        try {
          await setDoc(doc(db, 'course_outlines', freshDefault[0].id), freshDefault[0]);
        } catch (err) {
          console.error("Firestore create default course outline failed:", err);
        }
      }
      setOutlineToDeleteId(null);
      showToast('Outline deleted successfully', 'success');
    });
  };

  const handleResetTagParameters = async (idToReset: string) => {
    let updatedItem: CourseOutline | null = null;
    const updated = outlines.map(o => {
      if (o.id === idToReset) {
        const copy = { ...o };
        delete copy.taggedRepId;
        delete copy.taggedRepName;
        delete copy.tagNote;
        delete copy.taggedBy;
        delete copy.isCompleted;
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

  const handleAddNewOutline = async () => {
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

    const query = outlineSearchQuery.toLowerCase().trim();
    if (!query) return true;
    return (
      (o.courseTitle || '').toLowerCase().includes(query) ||
      (o.refNumber || '').toLowerCase().includes(query) ||
      (o.category || '').toLowerCase().includes(query)
    );
  }).sort((a, b) => {
    if (outlineSortBy === 'title') {
      return (a.courseTitle || '').localeCompare(b.courseTitle || '');
    }
    return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
  });

  // Module Row Management
  const handleAddModuleRow = () => {
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
    showToast('Module added successfully', 'success');
  };

  const handleRemoveModuleRow = (id: string) => {
    const filtered = items.filter(m => m.id !== id).map((m, idx) => ({
      ...m,
      no: idx + 1
    }));
    setItems(filtered);
    showToast('Module removed', 'success');
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

  // Print function
  const handlePrintOutline = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Pop-up blocker is enabled. Please allow pop-ups for printing.');
      return;
    }

    const outlineHtml = `
      <html>
        <head>
          <title>${courseTitle} - Course Outline</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=JetBrains+Mono:wght@400;700&display=swap');
            body {
              font-family: 'Inter', sans-serif;
              color: #1e293b;
              margin: 40px;
              line-height: 1.6;
            }
            .header-table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 30px;
            }
            .header-logo {
              font-size: 24px;
              font-weight: 800;
              letter-spacing: -0.5px;
              color: #2563eb;
            }
            .header-tagline {
              font-size: 10px;
              font-weight: bold;
              color: #64748b;
              text-transform: uppercase;
              letter-spacing: 1px;
            }
            .header-meta {
              text-align: right;
              font-size: 12px;
              color: #475569;
            }
            .doc-title {
              font-size: 28px;
              font-weight: 800;
              color: #0f172a;
              letter-spacing: -0.75px;
              margin-top: 20px;
              margin-bottom: 5px;
              border-bottom: 3px solid #3b82f6;
              padding-bottom: 10px;
            }
            .grid-container {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 20px;
              margin-bottom: 25px;
              background-color: #f8fafc;
              border: 1px solid #e2e8f0;
              padding: 15px;
              border-radius: 8px;
              font-size: 13px;
            }
            .grid-item {
              margin-bottom: 5px;
            }
            .grid-label {
              font-weight: bold;
              color: #64748b;
              text-transform: uppercase;
              font-size: 10px;
              letter-spacing: 0.5px;
            }
            .grid-value {
              font-weight: 600;
              color: #0f172a;
            }
            h3 {
              font-size: 16px;
              font-weight: 800;
              color: #1e3a8a;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              border-bottom: 1px solid #cbd5e1;
              padding-bottom: 6px;
              margin-top: 30px;
              margin-bottom: 12px;
            }
            p.overview, p.text-block {
              font-size: 14px;
              color: #334155;
              text-align: justify;
              margin-bottom: 15px;
            }
            ul.outcomes {
              padding-left: 20px;
              margin-bottom: 20px;
              font-size: 14px;
              color: #334155;
            }
            ul.outcomes li {
              margin-bottom: 8px;
            }
            .module-table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 15px;
              font-size: 13px;
            }
            .module-table th {
              background-color: #1e293b;
              color: #ffffff;
              font-weight: bold;
              text-transform: uppercase;
              font-size: 11px;
              letter-spacing: 0.5px;
              text-align: left;
              padding: 10px 12px;
              border: 1px solid #334155;
            }
            .module-table td {
              padding: 12px;
              border: 1px solid #e2e8f0;
              vertical-align: top;
            }
            .module-table tr:nth-child(even) {
              background-color: #f8fafc;
            }
            .footer-info {
              margin-top: 50px;
              border-top: 1px solid #e2e8f0;
              padding-top: 15px;
              font-size: 11px;
              color: #94a3b8;
              text-align: center;
            }
            .badge-level {
              display: inline-block;
              background-color: #ebf5ff;
              color: #1e40af;
              padding: 2px 8px;
              border-radius: 4px;
              font-weight: bold;
              font-size: 11px;
            }
            @media print {
              body { margin: 20px; }
              button { display: none; }
            }
          </style>
        </head>
        <body onload="window.print()">
          <table class="header-table">
            <tr>
              <td>
                <div class="header-logo">NEXT ACADEMY</div>
                <div class="header-tagline">Empowering Next-Gen Technical Leaders</div>
              </td>
              <td class="header-meta">
                <strong>Outline Code:</strong> ${refNumber || 'N/A'}<br/>
                <strong>Date:</strong> ${date}<br/>
                <strong>Prepared By:</strong> ${preparedBy || 'Academic Board'}
              </td>
            </tr>
          </table>

          <div class="doc-title">${courseTitle}</div>

          <div class="grid-container">
            <div class="grid-item">
              <span class="grid-label">Category:</span>
              <div class="grid-value">${category}</div>
            </div>
            <div class="grid-item">
              <span class="grid-label">Duration & Hours:</span>
              <div class="grid-value">${durationDays} Days (${totalHours} Hours)</div>
            </div>
            <div class="grid-item">
              <span class="grid-label">Target Audience:</span>
              <div class="grid-value">${audience || 'Open enrollment'}</div>
            </div>
            <div class="grid-item">
              <span class="grid-label">Difficulty Level:</span>
              <div><span class="badge-level">${level}</span></div>
            </div>
          </div>

          <h3>Course Overview</h3>
          <p class="overview">${overview || 'No overview available.'}</p>

          ${prerequisites ? `
            <h3>Prerequisites</h3>
            <p class="text-block">${prerequisites}</p>
          ` : ''}

          ${outcomes.length > 0 ? `
            <h3>Learning Outcomes</h3>
            <ul class="outcomes">
              ${outcomes.map(out => `<li>${out}</li>`).join('')}
            </ul>
          ` : ''}

          <h3>Weekly / Modular Breakdown</h3>
          <table class="module-table">
            <thead>
              <tr>
                <th style="width: 5%">No</th>
                <th style="width: 30%">Module Title</th>
                <th style="width: 45%">Topics Covered</th>
                <th style="width: 10%">Duration</th>
                <th style="width: 10%">Methodology</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(m => `
                <tr>
                  <td style="font-weight: bold;">${m.no}</td>
                  <td style="font-weight: bold; color: #1e3a8a;">${m.moduleTitle}</td>
                  <td style="white-space: pre-wrap;">${m.topics}</td>
                  <td><strong>${m.duration}</strong></td>
                  <td style="font-style: italic; color: #475569;">${m.methodology}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="footer-info">
            © 2026 NEXT Academy. All Rights Reserved. This syllabus outline is proprietary information.
          </div>
        </body>
      </html>
    `;

    printWindow.document.write(outlineHtml);
    printWindow.document.close();
  };

  return (
    <div className="space-y-6">
      
      {/* Undo Banner / Alerts */}
      {undoMessage && (
        <div className="bg-amber-500 text-white p-3 rounded-xl flex items-center justify-between shadow-md text-xs font-bold animate-pulse">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 animate-spin" />
            <span>{undoMessage}</span>
          </div>
          <button 
            onClick={handleUndo}
            className="bg-white text-slate-800 hover:bg-slate-100 font-extrabold uppercase px-3 py-1 rounded-lg text-[10px] transition-all cursor-pointer"
          >
            Undo Change
          </button>
        </div>
      )}

      {/* Main Grid split: Outlines directory left, workspace right */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        
        {/* Outline Directory Menu Column */}
        <div className="xl:col-span-4 space-y-4">
          
          <div className="bg-slate-900 text-white rounded-xl p-4 border border-slate-800 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 font-mono">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  Syllabus Library
                </h3>
                <span className="text-[10px] text-slate-500 font-medium">
                  Persisted under your account
                </span>
              </div>
              <button
                onClick={handleAddNewOutline}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold uppercase text-[10px] px-3 py-1.5 rounded-lg tracking-wider flex items-center gap-1 transition-all cursor-pointer shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                CREATE NEW
              </button>
            </div>

            {/* Search/Sort */}
            <div className="space-y-2 pt-1.5 border-t border-slate-800">
              <input 
                type="text"
                placeholder="Search catalog by title..."
                value={outlineSearchQuery}
                onChange={(e) => setOutlineSearchQuery(e.target.value)}
                className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-bold"
              />
              <div className="flex items-center justify-between gap-1 text-[10px] font-bold text-slate-400">
                <span className="uppercase text-slate-500 font-mono">Sort By:</span>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setOutlineSortBy('date')} 
                    className={`uppercase font-mono ${outlineSortBy === 'date' ? 'text-emerald-400 font-black' : 'text-slate-400 hover:text-white'}`}
                  >
                    Latest
                  </button>
                  <button 
                    onClick={() => setOutlineSortBy('title')} 
                    className={`uppercase font-mono ${outlineSortBy === 'title' ? 'text-emerald-400 font-black' : 'text-slate-400 hover:text-white'}`}
                  >
                    Title
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Directory Listings */}
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {filteredOutlines.length === 0 ? (
              <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-8 text-center text-xs text-slate-400 italic">
                No course outlines found matching filters.
              </div>
            ) : (
              filteredOutlines.map(o => {
                const isSelected = o.id === selectedId;
                const isTagged = o.taggedRepId === rep.id;
                const hasBeenTagged = !!o.taggedRepId;
                
                return (
                  <div 
                    key={o.id}
                    className={`border rounded-xl p-3.5 transition-all relative group ${
                      isSelected 
                        ? 'bg-emerald-50/50 border-emerald-300 ring-2 ring-emerald-500/10' 
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-xs'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-1.5">
                      <button
                        onClick={() => setSelectedId(o.id)}
                        className="flex-1 text-left min-w-0"
                      >
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[9px] font-black font-mono uppercase bg-slate-100 text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded">
                            {o.refNumber || 'Draft'}
                          </span>
                          
                          {isTagged && (
                            <span className="text-[9px] font-black uppercase tracking-wider bg-purple-100 border border-purple-200 text-purple-700 px-1.5 py-0.5 rounded animate-bounce">
                              TAGGED FOR YOU
                            </span>
                          )}

                          {hasBeenTagged && !isTagged && (
                            <span className="text-[9px] font-black uppercase tracking-wider bg-slate-100 border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded">
                              Tagged to {o.taggedRepName}
                            </span>
                          )}
                        </div>

                        <h4 className="text-[11px] font-black text-slate-800 uppercase mt-1.5 line-clamp-2">
                          {o.courseTitle || 'Untitled Course Outline'}
                        </h4>
                        
                        <div className="flex items-center gap-1 text-[9px] text-slate-400 font-bold font-mono uppercase mt-1">
                          <span>{o.category}</span>
                          <span>•</span>
                          <span>{o.durationDays} Days</span>
                          <span>•</span>
                          <span>{o.level}</span>
                        </div>
                      </button>

                      {/* Item Controls */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setTaggingRowId(taggingRowId === o.id ? null : o.id)}
                          className="p-1.5 text-slate-400 hover:text-purple-600 rounded-lg hover:bg-slate-50 transition-colors"
                          title="Tag or share outline with other representative"
                        >
                          <Tag className="w-3.5 h-3.5" />
                        </button>
                        
                        <button
                          onClick={() => setOutlineToDeleteId(o.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-50 transition-colors"
                          title="Delete this outline"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Tagging Sub-Panel */}
                    {taggingRowId === o.id && (
                      <div className="mt-3 pt-3 border-t border-slate-100 bg-purple-50/50 p-2.5 rounded-lg space-y-2 text-xs">
                        <span className="block text-[10px] font-black text-purple-700 uppercase tracking-wider">
                          Tag Representatives:
                        </span>
                        
                        <div className="grid grid-cols-2 gap-1.5">
                          {reps.filter(r => r.id !== rep.id).map(r => {
                            const activeTags = tagTargetRepIds.includes(r.id);
                            return (
                              <label key={r.id} className="flex items-center gap-1.5 text-[10px] font-black text-slate-600 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={activeTags}
                                  onChange={() => {
                                    if (activeTags) {
                                      setTagTargetRepIds(tagTargetRepIds.filter(id => id !== r.id));
                                    } else {
                                      setTagTargetRepIds([...tagTargetRepIds, r.id]);
                                    }
                                  }}
                                  className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                                />
                                {r.name}
                              </label>
                            );
                          })}
                        </div>

                        <div>
                          <input
                            type="text"
                            placeholder="Optional instructions for rep..."
                            value={tagNoteText}
                            onChange={(e) => setTagNoteText(e.target.value)}
                            className="w-full text-[10px] bg-white border border-slate-200 rounded px-2 py-1 text-slate-700"
                          />
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => handleTagOutlineMultiple(o)}
                            disabled={tagTargetRepIds.length === 0}
                            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-extrabold uppercase text-[9px] py-1 rounded transition-all cursor-pointer disabled:opacity-40"
                          >
                            CONFIRM TAG
                          </button>
                          <button
                            onClick={() => setTaggingRowId(null)}
                            className="px-2 py-1 border border-slate-200 bg-white text-slate-500 text-[9px] uppercase font-bold rounded"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Tag Reset Banner */}
                    {hasBeenTagged && !isTagged && (
                      <div className="mt-2.5 bg-slate-50 border border-slate-200 p-1.5 rounded text-[9px] flex items-center justify-between">
                        <span className="text-slate-500 font-medium italic">
                          Tagged to: <strong>{o.taggedRepName}</strong>
                        </span>
                        <button
                          onClick={() => handleResetTagParameters(o.id)}
                          className="text-[9px] font-black text-rose-500 hover:text-rose-700 uppercase"
                        >
                          Clear Tag
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

        </div>

        {/* Course Outline Editor & Preview Workspace */}
        <div className="xl:col-span-8 space-y-5">
          
          <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
            
            {/* Header Control Tabs */}
            <div className="p-4 bg-slate-800 text-white flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-emerald-400" />
                <div>
                  <h2 className="text-xs font-black uppercase tracking-wider font-display">
                    Syllabus Syllabus Builder
                  </h2>
                  <p className="text-[10px] text-slate-400 font-mono">
                    ACTIVE: {courseTitle || 'Untitled Syllabus Outline'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrintOutline}
                  className="bg-slate-700 hover:bg-slate-600 text-white font-extrabold text-[10px] uppercase tracking-wider px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer transition-all border border-slate-600"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print / Download PDF
                </button>
                
                <button
                  onClick={handleSaveOutline}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase tracking-wider px-4 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer transition-all shadow-sm"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save Draft
                </button>
              </div>
            </div>

            {/* Split Screen View */}
            <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
              
              {/* Form Input Section */}
              <div className="p-5 space-y-5 max-h-[800px] overflow-y-auto">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono border-b pb-1.5">
                  General Syllabus Parameters
                </h3>

                <div className="space-y-3.5">
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 tracking-wider">
                      Course Title
                    </label>
                    <input
                      type="text"
                      value={courseTitle}
                      onChange={(e) => setCourseTitle(e.target.value)}
                      placeholder="e.g. UX Design Foundations Mastery"
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 font-bold"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 tracking-wider">
                        Outline Reference Code
                      </label>
                      <input
                        type="text"
                        value={refNumber}
                        onChange={(e) => setRefNumber(e.target.value)}
                        placeholder="e.g. CO-2026-UX01"
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 tracking-wider">
                        Issue Date
                      </label>
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 font-bold"
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

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 tracking-wider">
                        Category / Area
                      </label>
                      <input
                        type="text"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        placeholder="e.g. Digital Marketing, Team Building"
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 tracking-wider">
                        Prepared By
                      </label>
                      <input
                        type="text"
                        value={preparedBy}
                        onChange={(e) => setPreparedBy(e.target.value)}
                        placeholder="Academic Board Coordinator"
                        className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 font-bold"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 tracking-wider">
                      Outline Owner <span className="text-[9px] text-blue-500 font-normal lowercase">(has library copy)</span>
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

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 tracking-wider">
                      Target Audience
                    </label>
                    <textarea
                      rows={2}
                      value={audience}
                      onChange={(e) => setAudience(e.target.value)}
                      placeholder="Identify the targeted user persona or background..."
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 tracking-wider">
                      Prerequisites
                    </label>
                    <input
                      type="text"
                      value={prerequisites}
                      onChange={(e) => setPrerequisites(e.target.value)}
                      placeholder="e.g. Basic math, no previous coding experience required."
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 tracking-wider">
                      Course Overview / Description
                    </label>
                    <textarea
                      rows={3}
                      value={overview}
                      onChange={(e) => setOverview(e.target.value)}
                      placeholder="Describe the overall scope, curriculum focus, and value proposition..."
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                {/* Outcomes Section */}
                <div className="space-y-3 pt-3 border-t border-slate-100">
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono">
                    Learning Outcomes
                  </h3>
                  
                  <div className="space-y-2">
                    {outcomes.map((out, idx) => (
                      <div key={idx} className="flex gap-2 items-center bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                        <span className="text-[10px] text-emerald-500 font-extrabold font-mono">✓</span>
                        <p className="text-xs text-slate-700 flex-1 font-semibold">{out}</p>
                        <button 
                          type="button" 
                          onClick={() => handleRemoveOutcome(idx)}
                          className="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Add learning outcome (e.g. Deploy custom server routing...)"
                      value={newOutcome}
                      onChange={(e) => setNewOutcome(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddOutcome()}
                      className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 font-medium"
                    />
                    <button
                      type="button"
                      onClick={handleAddOutcome}
                      className="bg-slate-700 hover:bg-slate-800 text-white font-extrabold text-xs px-3.5 rounded-lg transition-all"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Modular Breakdown Builder */}
                <div className="space-y-3 pt-3 border-t border-slate-100">
                  <div className="flex justify-between items-center">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono">
                      Module / Syllabus Builder
                    </h3>
                    <span className="text-[10px] bg-slate-100 border border-slate-200 text-slate-600 font-black px-2 py-0.5 rounded font-mono">
                      Total: {items.length} Modules
                    </span>
                  </div>

                  {/* Added Modules */}
                  <div className="space-y-3">
                    {items.map((m, idx) => (
                      <div key={m.id} className="bg-slate-50/70 border border-slate-200 rounded-xl p-3 space-y-2 relative">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] bg-emerald-600 text-white font-black px-2 py-0.5 rounded font-mono uppercase">
                            Module #{m.no}
                          </span>
                          <button
                            onClick={() => handleRemoveModuleRow(m.id)}
                            className="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        <div>
                          <p className="text-xs font-black text-slate-800 uppercase">{m.moduleTitle}</p>
                          <p className="text-[10.5px] text-slate-500 whitespace-pre-wrap font-mono mt-1 bg-white border border-slate-100 p-2 rounded-lg">{m.topics}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[10px] font-bold text-slate-500 pt-1 border-t border-slate-100/50">
                          <div>
                            <span className="uppercase text-slate-400 font-mono">Duration:</span> {m.duration}
                          </div>
                          <div className="text-right">
                            <span className="uppercase text-slate-400 font-mono">Methodology:</span> {m.methodology}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Add Module Input form */}
                  <div className="bg-emerald-50/20 border border-emerald-100 p-3.5 rounded-xl space-y-3">
                    <span className="text-[10px] font-black text-emerald-700 uppercase tracking-wider block font-mono">
                      ✙ ADD NEW MODULE ROW
                    </span>

                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="Module Title (e.g. Module 3: Advanced UI Styling)"
                        value={newItemModuleTitle}
                        onChange={(e) => setNewItemModuleTitle(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 bg-white font-bold"
                      />

                      <textarea
                        rows={3}
                        placeholder="Topics covered (use bullet points like: • Topic A\n• Topic B)"
                        value={newItemTopics}
                        onChange={(e) => setNewItemTopics(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 bg-white font-mono"
                      />

                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder="Duration (e.g. 4 Hours)"
                          value={newItemDuration}
                          onChange={(e) => setNewItemDuration(e.target.value)}
                          className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 bg-white font-bold"
                        />
                        <input
                          type="text"
                          placeholder="Methodology (e.g. Practical Lab)"
                          value={newItemMethodology}
                          onChange={(e) => setNewItemMethodology(e.target.value)}
                          className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 bg-white font-semibold"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={handleAddModuleRow}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-[10px] tracking-wider py-2 rounded-lg transition-all cursor-pointer shadow-sm flex items-center justify-center gap-1"
                      >
                        <Plus className="w-4 h-4" /> Add Module Row
                      </button>
                    </div>
                  </div>

                </div>

              </div>

              {/* Real-time PDF Live Preview Section */}
              <div className="p-5 space-y-4 bg-slate-50/50 max-h-[800px] overflow-y-auto">
                <div className="flex justify-between items-center border-b pb-2">
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5 text-blue-500" />
                    LIVE SILLABUS PREVIEW
                  </h3>
                  <span className="text-[9px] text-slate-400 font-mono italic">
                    Fits on A4 page
                  </span>
                </div>

                {/* Printable Frame mockup */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-lg space-y-6 text-slate-800 font-sans leading-relaxed text-xs">
                  
                  {/* Print Header */}
                  <div className="flex justify-between items-start border-b pb-4 border-slate-100">
                    <div>
                      <div className="text-sm font-black text-blue-600 tracking-tight">NEXT ACADEMY</div>
                      <div className="text-[8px] text-slate-400 uppercase font-black tracking-widest font-mono">
                        Empowering Tech Leaders
                      </div>
                    </div>
                    <div className="text-right text-[9px] text-slate-500 font-mono space-y-0.5">
                      <div><strong>Ref Code:</strong> {refNumber || 'DRAFT'}</div>
                      <div><strong>Date:</strong> {date || 'N/A'}</div>
                      <div><strong>By:</strong> {preparedBy || 'Academic Team'}</div>
                    </div>
                  </div>

                  {/* Course Title display */}
                  <div className="space-y-1">
                    <h1 className="text-base font-extrabold text-slate-900 uppercase tracking-tight leading-tight">
                      {courseTitle || 'UNTITLED SYLLABUS COURSE'}
                    </h1>
                    <div className="h-1.5 w-16 bg-blue-600 rounded" />
                  </div>

                  {/* Meta Specs Grid */}
                  <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-150 font-sans text-[11px]">
                    <div>
                      <span className="text-[9px] uppercase text-slate-400 font-black block tracking-wider">
                        Syllabus Area:
                      </span>
                      <strong className="text-slate-800 font-bold">{category}</strong>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase text-slate-400 font-black block tracking-wider">
                        Duration Specifications:
                      </span>
                      <strong className="text-slate-800 font-bold">{durationDays} Days ({totalHours} Hours)</strong>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase text-slate-400 font-black block tracking-wider">
                        Level Matrix:
                      </span>
                      <span className="inline-block bg-blue-50 border border-blue-200 text-blue-700 font-black text-[9px] uppercase px-1.5 py-0.5 rounded">
                        {level}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase text-slate-400 font-black block tracking-wider">
                        Outline Version:
                      </span>
                      <strong className="text-slate-800 font-mono">v1.1-Production</strong>
                    </div>
                  </div>

                  {/* Overview details */}
                  <div className="space-y-1.5">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono border-b pb-0.5">
                      Course Synopsis
                    </h3>
                    <p className="text-[11px] text-slate-600 text-justify leading-relaxed">
                      {overview || 'Provide course Overview details in the left editor panel...'}
                    </p>
                  </div>

                  {audience && (
                    <div className="space-y-1">
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono">
                        Target Audience
                      </h3>
                      <p className="text-[11px] text-slate-600 italic">
                        {audience}
                      </p>
                    </div>
                  )}

                  {prerequisites && (
                    <div className="space-y-1 bg-slate-50 p-2 rounded border border-slate-150">
                      <h3 className="text-[9px] font-black text-slate-500 uppercase tracking-widest font-mono">
                        Course Prerequisites
                      </h3>
                      <p className="text-[10.5px] text-slate-600 font-medium">
                        {prerequisites}
                      </p>
                    </div>
                  )}

                  {/* Outcomes */}
                  {outcomes.length > 0 && (
                    <div className="space-y-1.5">
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono border-b pb-0.5">
                        Key Competency Outcomes
                      </h3>
                      <ul className="space-y-1 list-disc pl-4 text-[11px] text-slate-600 font-medium">
                        {outcomes.map((out, idx) => (
                          <li key={idx}>{out}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Modular Breakdown List */}
                  <div className="space-y-2">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono border-b pb-0.5">
                      Curriculum Path
                    </h3>
                    
                    <div className="space-y-2.5">
                      {items.map((m) => (
                        <div key={m.id} className="border-l-2 border-blue-500 pl-3.5 space-y-1">
                          <div className="flex justify-between items-center text-[11px]">
                            <strong className="text-slate-900 font-black uppercase">
                              Module {m.no}: {m.moduleTitle}
                            </strong>
                            <span className="text-[9px] font-mono bg-slate-100 text-slate-500 px-1.5 rounded font-black">
                              {m.duration}
                            </span>
                          </div>
                          <p className="text-[10.5px] text-slate-500 whitespace-pre-wrap font-mono leading-normal">
                            {m.topics}
                          </p>
                          <div className="text-[9.5px] text-slate-400 italic">
                            Methodology: {m.methodology}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>

              </div>

            </div>

          </div>

        </div>

      </div>

      {/* Confirmation Modals */}
      {outlineToDeleteId && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-4">
            <h4 className="font-extrabold text-slate-900 text-xs uppercase tracking-wider">
              Delete Course Outline?
            </h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              Are you absolutely sure you want to permanently delete this course outline from NEXT Academy's syllabus library? This action is irreversible.
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                onClick={() => setOutlineToDeleteId(null)}
                className="px-3.5 py-2 border border-slate-200 text-slate-600 font-bold text-[10px] uppercase rounded-xl hover:bg-slate-50 cursor-pointer"
              >
                No, Keep
              </button>
              <button
                onClick={() => handleDeleteOutline(outlineToDeleteId)}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-[10px] uppercase rounded-xl transition-all cursor-pointer"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
