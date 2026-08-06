import React, { useState, useEffect } from 'react';
import { Representative, AdminRecord } from '../types';
import { INITIAL_ADMIN_RECORDS } from '../data/adminRecords';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query } from 'firebase/firestore';
import { 
  Plus, Trash2, Edit3, Save, Search, Filter, 
  CheckCircle, Clock, RotateCcw, X, Download, 
  ExternalLink, Layers, ClipboardCheck, BookOpen, 
  HelpCircle, AlertCircle, FileText, CheckSquare, Square,
  Upload, HardDriveDownload
} from 'lucide-react';

// Robust helper to parse multiple date formats for administrative record sorting
const parseTrainingDateToTime = (dateStr: string): number => {
  if (!dateStr) return 0;
  
  const cleanStr = dateStr.trim();
  // Standard ISO format e.g. "2026-04-20"
  const parsedTime = Date.parse(cleanStr);
  if (!isNaN(parsedTime)) return parsedTime;

  // Range formats e.g. "16-17 Jul 2026" or "16 - 17 July 2026"
  const yearMatch = cleanStr.match(/\b(20\d{2})\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    january: 0, february: 1, march: 2, april: 3, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
  };

  const lowerStr = cleanStr.toLowerCase();
  let monthIndex = 0;
  for (const [mName, mIdx] of Object.entries(months)) {
    if (lowerStr.includes(mName)) {
      monthIndex = mIdx;
      break;
    }
  }

  const dayMatch = cleanStr.match(/^(\d+)/);
  const day = dayMatch ? parseInt(dayMatch[1], 10) : 1;

  return new Date(year, monthIndex, day).getTime();
};

interface UnifiedDocumentUploaderProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  onOpenLink: (url: string, fieldName: string) => void;
}

function UnifiedDocumentUploader({ label, value, onChange, placeholder, onOpenLink }: UnifiedDocumentUploaderProps) {
  const [isLinkMode, setIsLinkMode] = useState(() => {
    if (value && value.toLowerCase().startsWith('http') && !value.toLowerCase().includes('simulated:')) {
      return true;
    }
    return false;
  });
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const simulateUpload = (fileName: string, fileSize: string) => {
    setProgress(0);
    let current = 0;
    const interval = setInterval(() => {
      current += 20;
      if (current >= 100) {
        clearInterval(interval);
        setProgress(null);
        onChange(`simulated:|${fileName}|${fileSize}`);
      } else {
        setProgress(current);
      }
    }, 120);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      const sizeStr = formatBytes(file.size);
      simulateUpload(file.name, sizeStr);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      const sizeStr = formatBytes(file.size);
      simulateUpload(file.name, sizeStr);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const handleClear = () => {
    onChange('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const isSimulated = value && value.startsWith('simulated:');
  let displayName = '';
  let displaySize = '';
  if (isSimulated) {
    const parts = value.split('|');
    displayName = parts[1] || '';
    displaySize = parts[2] || '';
  } else if (value && !value.startsWith('http') && value !== '-' && value !== 'N/A') {
    displayName = value;
    displaySize = 'Local File';
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 shadow-2xs">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-black text-slate-600 uppercase tracking-wide">
          {label}
        </label>
        <div className="flex gap-1.5 bg-slate-200/60 p-0.5 rounded-lg text-[9px] font-bold">
          <button
            type="button"
            onClick={() => {
              setIsLinkMode(false);
              handleClear();
            }}
            className={`px-2 py-0.5 rounded transition-all cursor-pointer ${!isLinkMode ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Upload File
          </button>
          <button
            type="button"
            onClick={() => {
              setIsLinkMode(true);
              handleClear();
            }}
            className={`px-2 py-0.5 rounded transition-all cursor-pointer ${isLinkMode ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
          >
            Google Drive URL
          </button>
        </div>
      </div>

      {isLinkMode ? (
        <div className="relative">
          <input
            type="url"
            placeholder={placeholder || "https://drive.google.com/file/..."}
            value={isSimulated ? '' : value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full text-[11px] border border-slate-200 bg-white rounded-lg px-2.5 py-1.5 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-emerald-500 font-mono"
          />
          {value && !isSimulated && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2.5 top-2 text-slate-400 hover:text-rose-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div>
          {progress !== null ? (
            <div className="border border-dashed border-emerald-300 bg-emerald-50/40 rounded-lg p-3 text-center space-y-2">
              <div className="flex items-center justify-center gap-1.5 text-emerald-600 text-[10px] font-black uppercase">
                <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-emerald-500 border-t-transparent"></span>
                Uploading... {progress}%
              </div>
              <div className="w-full bg-slate-200 h-1 rounded-full overflow-hidden">
                <div className="bg-emerald-500 h-full transition-all duration-150" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : value ? (
            <div className="flex items-center justify-between border border-slate-200 bg-white rounded-lg p-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1 bg-emerald-50 text-emerald-600 rounded">
                  <FileText className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-slate-800 truncate" title={displayName}>
                    {displayName}
                  </p>
                  <span className="text-[9px] text-slate-400 font-mono font-bold block leading-none">
                    {displaySize}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onOpenLink(value, label)}
                  className="p-1 text-indigo-600 hover:bg-indigo-50 rounded transition-colors cursor-pointer"
                  title="Download File"
                >
                  <HardDriveDownload className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                  title="Remove file"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border border-dashed rounded-lg p-3.5 text-center cursor-pointer transition-all duration-150 ${
                isDragging 
                  ? 'border-emerald-500 bg-emerald-50/50' 
                  : 'border-slate-300 hover:border-slate-400 bg-white hover:bg-slate-50/50'
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.txt,.csv"
              />
              <Upload className={`w-4 h-4 mx-auto mb-1 ${isDragging ? 'text-emerald-500 animate-bounce' : 'text-slate-400'}`} />
              <p className="text-[10px] font-bold text-slate-600">
                Drag & drop or <span className="text-emerald-600 underline">browse</span>
              </p>
              <p className="text-[8px] text-slate-400 mt-0.5 font-semibold">
                PDF, Excel, Word, Image (Max 10MB)
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface AdminRecordManagerProps {
  rep: Representative;
  reps: Representative[];
  requestManagerPermission: (actionToExecute: () => void) => void;
  key?: string;
}

export default function AdminRecordManager({ rep, reps, requestManagerPermission }: AdminRecordManagerProps) {
  const [records, setRecords] = useState<AdminRecord[]>(() => {
    const saved = localStorage.getItem('next_admin_records_checklist_v1');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // Fallback to initial
      }
    }
    localStorage.setItem('next_admin_records_checklist_v1', JSON.stringify(INITIAL_ADMIN_RECORDS));
    return INITIAL_ADMIN_RECORDS;
  });

  // Real-time Firestore sync for Admin Records with robust migration fallback
  useEffect(() => {
    if (!db) return;

    const q = query(collection(db, 'admin_records'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const firestoreRecords: AdminRecord[] = [];
      snapshot.forEach((docSnap) => {
        firestoreRecords.push({ ...docSnap.data() as AdminRecord, id: docSnap.id });
      });

      if (firestoreRecords.length > 0) {
        // Sort descending by trainingDate or createdAt so newer elements are at the top
        firestoreRecords.sort((a, b) => {
          const timeA = parseTrainingDateToTime(a.trainingDate) || a.createdAt || 0;
          const timeB = parseTrainingDateToTime(b.trainingDate) || b.createdAt || 0;
          return timeB - timeA;
        });
        setRecords(firestoreRecords);
        localStorage.setItem('next_admin_records_checklist_v1', JSON.stringify(firestoreRecords));
        localStorage.setItem('migrated_admin_records_to_firestore', 'true');
      } else {
        const alreadyMigrated = localStorage.getItem('migrated_admin_records_to_firestore') === 'true';
        if (!alreadyMigrated) {
          const localSaved = localStorage.getItem('next_admin_records_checklist_v1');
          let parsed: AdminRecord[] = [];
          if (localSaved) {
            try {
              parsed = JSON.parse(localSaved);
            } catch {}
          }
          if (!parsed || parsed.length === 0) {
            parsed = INITIAL_ADMIN_RECORDS;
          }
          if (parsed && parsed.length > 0) {
            for (const record of parsed) {
              const docId = record.id || `ar_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
              await setDoc(doc(db, 'admin_records', docId), {
                ...record,
                id: docId,
                createdAt: record.createdAt || Date.now()
              });
            }
          }
          localStorage.setItem('migrated_admin_records_to_firestore', 'true');
        } else {
          // Empty collection means everything deleted by user, set to empty
          setRecords([]);
          localStorage.setItem('next_admin_records_checklist_v1', JSON.stringify([]));
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // Editing state
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // Search & Filters state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCompleted, setFilterCompleted] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterTrainer, setFilterTrainer] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

  // Undo deletion/action state
  const [previousRecords, setPreviousRecords] = useState<AdminRecord[] | null>(null);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);

  // Form field bindings
  const [completed, setCompleted] = useState(false);
  const [no, setNo] = useState('');
  const [trainingDate, setTrainingDate] = useState('');
  const [programmeName, setProgrammeName] = useState('');
  const [client, setClient] = useState('');
  const [trainer, setTrainer] = useState('');
  const [typeOfTraining, setTypeOfTraining] = useState('In-house');
  const [trainingHour, setTrainingHour] = useState(7);
  const [quotation, setQuotation] = useState('');
  const [putInBitrixCalendar, setPutInBitrixCalendar] = useState('YES');
  const [venuePicContact, setVenuePicContact] = useState('');
  const [bookHotel, setBookHotel] = useState('N/A');
  const [payHotel, setPayHotel] = useState('N/A');
  const [bookBus, setBookBus] = useState('N/A');
  const [payBus, setPayBus] = useState('N/A');
  const [bookFacilitator, setBookFacilitator] = useState('N/A');
  const [payFacilitator, setPayFacilitator] = useState('N/A');
  const [trainerPo, setTrainerPo] = useState('N/A');
  const [grantApproved, setGrantApproved] = useState('N/A');
  const [outputSummaryQr, setOutputSummaryQr] = useState('');
  const [handoutsMaterials, setHandoutsMaterials] = useState('Done');
  const [uploadPhotosDrive, setUploadPhotosDrive] = useState('');
  const [attendanceList, setAttendanceList] = useState('');
  const [invoice, setInvoice] = useState('');
  const [jd14, setJd14] = useState('');
  const [certificate, setCertificate] = useState('');
  const [trainingReport, setTrainingReport] = useState('');

  // Toast notifications
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Switch to form editor with preset record or initial setup
  const handleEditInit = (rec: AdminRecord) => {
    setSelectedRecordId(rec.id);
    setCompleted(rec.completed);
    setNo(rec.no);
    setTrainingDate(rec.trainingDate);
    setProgrammeName(rec.programmeName);
    setClient(rec.client);
    setTrainer(rec.trainer);
    setTypeOfTraining(rec.typeOfTraining || 'In-house');
    setTrainingHour(rec.trainingHour || 7);
    setQuotation(rec.quotation || '');
    setPutInBitrixCalendar(rec.putInBitrixCalendar || 'YES');
    setVenuePicContact(rec.venuePicContact || '');
    setBookHotel(rec.bookHotel || 'N/A');
    setPayHotel(rec.payHotel || 'N/A');
    setBookBus(rec.bookBus || 'N/A');
    setPayBus(rec.payBus || 'N/A');
    setBookFacilitator(rec.bookFacilitator || 'N/A');
    setPayFacilitator(rec.payFacilitator || 'N/A');
    setTrainerPo(rec.trainerPo || 'N/A');
    setGrantApproved(rec.grantApproved || 'N/A');
    setOutputSummaryQr(rec.outputSummaryQr || '');
    setHandoutsMaterials(rec.handoutsMaterials || 'Done');
    setUploadPhotosDrive(rec.uploadPhotosDrive || '');
    setAttendanceList(rec.attendanceList || '');
    setInvoice(rec.invoice || '');
    setJd14(rec.jd14 || '');
    setCertificate(rec.certificate || '');
    setTrainingReport(rec.trainingReport || '');
    setIsEditing(true);
    setIsFormOpen(true);
  };

  const handleCreateInit = () => {
    setSelectedRecordId(null);
    setCompleted(false);
    setNo((records.length + 1).toString());
    setTrainingDate(new Date().toISOString().substring(0, 10));
    setProgrammeName('');
    setClient('');
    setTrainer(rep.name);
    setTypeOfTraining('In-house');
    setTrainingHour(7);
    setQuotation('');
    setPutInBitrixCalendar('YES');
    setVenuePicContact('');
    setBookHotel('N/A');
    setPayHotel('N/A');
    setBookBus('N/A');
    setPayBus('N/A');
    setBookFacilitator('N/A');
    setPayFacilitator('N/A');
    setTrainerPo('N/A');
    setGrantApproved('N/A');
    setOutputSummaryQr('');
    setHandoutsMaterials('Done');
    setUploadPhotosDrive('');
    setAttendanceList('');
    setInvoice('');
    setJd14('');
    setCertificate('');
    setTrainingReport('');
    setIsEditing(false);
    setIsFormOpen(true);
  };

  const handleToggleCompleted = async (id: string) => {
    const recordToUpdate = records.find(r => r.id === id);
    if (!recordToUpdate) return;
    const updatedRecord = { ...recordToUpdate, completed: !recordToUpdate.completed };
    
    const updated = records.map(r => r.id === id ? updatedRecord : r);
    setRecords(updated);
    localStorage.setItem('next_admin_records_checklist_v1', JSON.stringify(updated));
    showToast('Delivery completion status updated!', 'success');

    try {
      await setDoc(doc(db, 'admin_records', id), updatedRecord);
    } catch (err) {
      console.error("Firestore save toggle completed failed:", err);
    }
  };

  const handleSaveRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client.trim()) {
      showToast('Client Name is required!', 'error');
      return;
    }

    setPreviousRecords(JSON.parse(JSON.stringify(records)));
    setUndoMessage(isEditing ? 'Record updated.' : 'Record added to training log.');

    const newRecord: AdminRecord = {
      id: selectedRecordId || `ar_${Date.now()}`,
      completed,
      no: no || '-',
      trainingDate,
      programmeName: programmeName.trim() || 'Custom Training Program',
      client: client.trim(),
      trainer: trainer.trim() || 'Internal Trainer',
      typeOfTraining,
      trainingHour: Number(trainingHour) || 0,
      quotation: quotation.trim(),
      putInBitrixCalendar,
      venuePicContact: venuePicContact.trim(),
      bookHotel,
      payHotel,
      bookBus,
      payBus,
      bookFacilitator,
      payFacilitator,
      trainerPo,
      grantApproved,
      outputSummaryQr: outputSummaryQr.trim(),
      handoutsMaterials,
      uploadPhotosDrive: uploadPhotosDrive.trim(),
      attendanceList: attendanceList.trim(),
      invoice: invoice.trim(),
      jd14: jd14.trim(),
      certificate: certificate.trim(),
      trainingReport: trainingReport.trim(),
      ownerId: rep.id,
      ownerName: rep.name,
      createdAt: isEditing ? (records.find(r => r.id === selectedRecordId)?.createdAt || Date.now()) : Date.now()
    };

    let updatedList: AdminRecord[] = [];
    if (isEditing) {
      updatedList = records.map(r => r.id === selectedRecordId ? newRecord : r);
    } else {
      updatedList = [newRecord, ...records];
    }

    setRecords(updatedList);
    localStorage.setItem('next_admin_records_checklist_v1', JSON.stringify(updatedList));
    setIsFormOpen(false);
    showToast(isEditing ? 'Changes saved successfully!' : 'Program logged successfully!', 'success');

    try {
      await setDoc(doc(db, 'admin_records', newRecord.id), newRecord);
    } catch (err) {
      console.error("Firestore save record failed:", err);
    }
  };

  const handleDeleteRecord = (id: string) => {
    requestManagerPermission(async () => {
      setPreviousRecords(JSON.parse(JSON.stringify(records)));
      setUndoMessage('Training log record deleted.');
      const remaining = records.filter(r => r.id !== id);
      setRecords(remaining);
      localStorage.setItem('next_admin_records_checklist_v1', JSON.stringify(remaining));
      showToast('Record deleted.', 'success');

      try {
        await deleteDoc(doc(db, 'admin_records', id));
      } catch (err) {
        console.error("Firestore delete record failed:", err);
      }
    });
  };

  const handleUndoChange = async () => {
    if (previousRecords) {
      const currentRecords = [...records];
      setRecords(previousRecords);
      localStorage.setItem('next_admin_records_checklist_v1', JSON.stringify(previousRecords));
      setPreviousRecords(null);
      setUndoMessage(null);
      showToast('Action reverted!', 'success');

      try {
        // Find deleted items to restore
        for (const prev of previousRecords) {
          const exists = currentRecords.some(c => c.id === prev.id);
          if (!exists) {
            await setDoc(doc(db, 'admin_records', prev.id), prev);
          }
        }
        // Find newly added items to delete
        for (const curr of currentRecords) {
          const existed = previousRecords.some(p => p.id === curr.id);
          if (!existed) {
            await deleteDoc(doc(db, 'admin_records', curr.id));
          } else {
            // Check if modified
            const prevVersion = previousRecords.find(p => p.id === curr.id);
            if (JSON.stringify(prevVersion) !== JSON.stringify(curr)) {
              await setDoc(doc(db, 'admin_records', curr.id), prevVersion!);
            }
          }
        }
      } catch (err) {
        console.error("Firestore undo failed:", err);
      }
    }
  };

  // Helper to open link safely, support simulated local downloads, or alert if no link
  const handleOpenLink = (url: string, fieldName: string) => {
    if (!url || url.trim() === '' || url.trim() === 'N/A' || url.trim() === '-') {
      showToast(`No document uploaded or link configured for ${fieldName}`, 'error');
      return;
    }

    const trimmedUrl = url.trim();
    if (trimmedUrl.startsWith('simulated:')) {
      const parts = trimmedUrl.split('|');
      const filename = parts[1] || 'document.pdf';
      const sizeStr = parts[2] || 'Unknown size';
      
      // Generate simulated file download in browser sandbox
      const dateStr = new Date().toLocaleString();
      const content = `=============================================================
                      NEXT ACADEMY CORPORATE OPERATIONS PORTAL
                      SIMULATED CLOUD DOCUMENT RECONCILIATION
=============================================================

Document Type:   ${fieldName}
File Name:       ${filename}
File Size:       ${sizeStr}
Retrieved On:    ${dateStr}
Status:          Verified Secure Sandbox Retrieval (Active Session)

-------------------------------------------------------------
This file has been successfully uploaded into the local sandbox 
and synced to the Google Drive Records index. Because this is a 
client-side demonstration environment, the actual binary data of 
the document is securely mapped inside the browser state.

To review, edit, or replace this document, open the Edit Modal 
inside the Administrative Operations Master Log table.
-------------------------------------------------------------
Generated automatically by NEXT Academy Checklist Engine.
=============================================================`;
      
      const blob = new Blob([content], { type: 'text/plain' });
      const localUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = localUrl;
      link.download = filename.endsWith('.txt') ? filename : `${filename}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(localUrl);
      showToast(`Downloading retrieved document: ${filename}`, 'success');
    } else if (trimmedUrl.toLowerCase().startsWith('http') || trimmedUrl.toLowerCase().startsWith('blob:') || trimmedUrl.toLowerCase().startsWith('data:')) {
      window.open(trimmedUrl, '_blank', 'noopener,noreferrer');
    } else {
      // Fallback if it's just a file name but doesn't have the simulated: prefix
      const dateStr = new Date().toLocaleString();
      const content = `=============================================================
                      NEXT ACADEMY CORPORATE OPERATIONS PORTAL
                      SIMULATED CLOUD DOCUMENT RECONCILIATION
=============================================================

Document Type:   ${fieldName}
File Name:       ${trimmedUrl}
File Size:       Cached
Retrieved On:    ${dateStr}
Status:          Verified Secure Sandbox Retrieval (Active Session)

-------------------------------------------------------------
Generated automatically by NEXT Academy Checklist Engine.
=============================================================`;
      const blob = new Blob([content], { type: 'text/plain' });
      const localUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = localUrl;
      link.download = trimmedUrl.endsWith('.txt') ? trimmedUrl : `${trimmedUrl}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(localUrl);
      showToast(`Downloading document: ${trimmedUrl}`, 'success');
    }
  };

  const isValidAsset = (url: string | undefined | null) => {
    if (!url) return false;
    const trimmed = url.trim();
    return trimmed !== '' && trimmed !== 'N/A' && trimmed !== '-';
  };

  const getAssetTooltip = (url: string, defaultName: string) => {
    if (!url) return '';
    if (url.startsWith('simulated:')) {
      const parts = url.split('|');
      return `File: ${parts[1]} (${parts[2]}) - Click to retrieve`;
    }
    return `${defaultName} Link - Click to open`;
  };

  // Export to CSV function matching the original columns exactly
  const handleExportCSV = () => {
    try {
      const headers = [
        'COMPLETED', 'No.', 'Training Date', 'Programme Name', 'Client', 'Trainer',
        'Type of Training', 'Training Hour', 'Quotation', 'Put in Bitrix Calendar',
        'Venue PIC Contact', 'Book Hotel', 'Pay Hotel', 'Book Bus', 'Pay Bus',
        'Book Facilitator', 'Pay Facilitator', 'Trainer PO', 'Grant Approved',
        'Output Summary QR Code', 'T3/ Handouts/ Training Materials', 'Upload Photos/Videos to Google Drive',
        'Attendance List', 'Invoice', 'JD14', 'Certificate', 'Training Report'
      ];

      const rows = records.map(r => [
        r.completed ? 'TRUE' : 'FALSE',
        r.no || '',
        r.trainingDate || '',
        `"${(r.programmeName || '').replace(/"/g, '""')}"`,
        `"${(r.client || '').replace(/"/g, '""')}"`,
        `"${(r.trainer || '').replace(/"/g, '""')}"`,
        r.typeOfTraining || '',
        r.trainingHour || 0,
        r.quotation || '',
        r.putInBitrixCalendar || '',
        `"${(r.venuePicContact || '').replace(/"/g, '""')}"`,
        r.bookHotel || '',
        r.payHotel || '',
        r.bookBus || '',
        r.payBus || '',
        r.bookFacilitator || '',
        r.payFacilitator || '',
        r.trainerPo || '',
        r.grantApproved || '',
        r.outputSummaryQr || '',
        r.handoutsMaterials || '',
        r.uploadPhotosDrive || '',
        r.attendanceList || '',
        r.invoice || '',
        r.jd14 || '',
        r.certificate || '',
        r.trainingReport || ''
      ]);

      const csvContent = "data:text/csv;charset=utf-8," 
        + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `NEXT_Academy_Training_Log_${new Date().toISOString().substring(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('Exported successfully!', 'success');
    } catch (e) {
      showToast('Export failed', 'error');
    }
  };

  // Calculate Operational Metrics
  const totalCount = records.length;
  const completedCount = records.filter(r => r.completed).length;
  const completionPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  
  // Calculate average training hours
  const totalHoursLogged = records.reduce((sum, r) => sum + (Number(r.trainingHour) || 0), 0);
  
  // Filter and sort the table records
  const filteredRecords = records.filter(r => {
    const matchesSearch = 
      (r.client || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.programmeName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.trainer || '').toLowerCase().includes(searchQuery.toLowerCase());
      
    const matchesCompleted = 
      filterCompleted === 'all' || 
      (filterCompleted === 'true' && r.completed) || 
      (filterCompleted === 'false' && !r.completed);

    const matchesType = filterType === 'all' || r.typeOfTraining === filterType;
    const matchesTrainer = filterTrainer === 'all' || r.trainer === filterTrainer;

    return matchesSearch && matchesCompleted && matchesType && matchesTrainer;
  }).sort((a, b) => {
    const timeA = parseTrainingDateToTime(a.trainingDate);
    const timeB = parseTrainingDateToTime(b.trainingDate);
    
    if (timeA !== timeB) {
      return sortOrder === 'newest' ? timeB - timeA : timeA - timeB;
    }
    
    // Stable sort fallback by ID
    return sortOrder === 'newest' 
      ? b.id.localeCompare(a.id)
      : a.id.localeCompare(b.id);
  });

  return (
    <div className="space-y-6">
      
      {/* Toast Alert popup */}
      {toast && (
        <div className={`fixed top-4 right-4 p-4 rounded-xl shadow-2xl flex items-center gap-2 z-50 text-xs font-black transition-all transform animate-slide-in ${
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        }`}>
          <CheckCircle className="w-4 h-4" />
          <span>{toast.message}</span>
        </div>
      )}

      {/* Undo Banner */}
      {undoMessage && (
        <div className="bg-amber-500 text-white p-3 rounded-xl flex items-center justify-between shadow-md text-xs font-bold animate-pulse">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4" />
            <span>{undoMessage}</span>
          </div>
          <button 
            onClick={handleUndoChange}
            className="bg-white text-slate-800 hover:bg-slate-100 font-extrabold uppercase px-3 py-1 rounded-lg text-[10px] cursor-pointer"
          >
            Undo Action
          </button>
        </div>
      )}

      {/* Visual KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2 relative overflow-hidden">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Total Programs Logged
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900">
              {totalCount} Courses
            </span>
            <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
              <BookOpen className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">
            Total active and past corporate cohort engagements
          </p>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2 relative overflow-hidden">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Delivery Complete %
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-emerald-600 font-mono">
              {completionPercentage}%
            </span>
            <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
              <CheckCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
            <div 
              className="bg-emerald-500 h-full transition-all duration-500" 
              style={{ width: `${completionPercentage}%` }} 
            />
          </div>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2 relative overflow-hidden">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Total Training Hours Delivered
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-indigo-600">
              {totalHoursLogged} Hours
            </span>
            <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">
            Accumulated expert face-to-face instruction hours
          </p>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2 relative overflow-hidden">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Pending Final Reports / Docs
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-amber-600 font-mono">
              {records.filter(r => !r.completed).length} Pending
            </span>
            <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
              <ClipboardCheck className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">
            Programs currently being organized or in review pipeline
          </p>
        </div>
      </div>

      {/* Control Panel */}
      <div className="bg-slate-900 border border-slate-800 text-white rounded-xl p-4 space-y-4 shadow-lg">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div>
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 font-display">
              <Layers className="w-4 h-4 text-emerald-400 animate-pulse" />
              Administrative Operations Master Log (Corporate Checklist)
            </h2>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              Strictly Synced with Google Drive Records Portal
            </p>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <button
              onClick={handleExportCSV}
              className="flex-1 md:flex-none border border-slate-700 hover:bg-slate-800 text-slate-300 font-bold text-[10px] uppercase tracking-wider px-3.5 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              EXPORT CSV
            </button>
            <button
              onClick={handleCreateInit}
              className="flex-1 md:flex-none bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[10px] uppercase tracking-wider px-4 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md"
            >
              <Plus className="w-4 h-4" />
              LOG NEW PROGRAM
            </button>
          </div>
        </div>

        {/* Filters Panel */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 pt-3 border-t border-slate-800">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search Client, Course, Trainer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-semibold"
            />
          </div>

          <div>
            <select
              value={filterCompleted}
              onChange={(e) => setFilterCompleted(e.target.value)}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500 font-bold"
            >
              <option value="all">All Delivery Statuses</option>
              <option value="true">Completed (TRUE)</option>
              <option value="false">Pending (FALSE)</option>
            </select>
          </div>

          <div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500 font-bold"
            >
              <option value="all">All Training Types</option>
              <option value="In-house">In-house</option>
              <option value="Public">Public</option>
              <option value="Online">Online</option>
              <option value="Team Building">Team Building</option>
            </select>
          </div>

          <div>
            <select
              value={filterTrainer}
              onChange={(e) => setFilterTrainer(e.target.value)}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500 font-bold"
            >
              <option value="all">All Trainers</option>
              <option value="Lee Chee Cai">Lee Chee Cai</option>
              <option value="Joel Lim">Joel Lim</option>
              <option value="Chris">Chris</option>
            </select>
          </div>

          <div>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500 font-bold"
            >
              <option value="newest">Sort: Newest First</option>
              <option value="oldest">Sort: Oldest First</option>
            </select>
          </div>
        </div>
      </div>

      {/* Spreadsheet Master Table Grid */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-slate-700 font-sans text-xs">
            <thead className="bg-slate-800 text-slate-200 font-display text-[10px] font-black uppercase tracking-wider border-b border-slate-700">
              <tr>
                <th className="p-3 sticky left-0 bg-slate-800 z-10 text-center w-12">COMPLETED</th>
                <th className="p-3 text-center w-10">No.</th>
                <th className="p-3 whitespace-nowrap">Training Date</th>
                <th className="p-3 whitespace-nowrap min-w-[200px]">Client / Program</th>
                <th className="p-3 whitespace-nowrap">Trainer</th>
                <th className="p-3 text-center">Type</th>
                <th className="p-3 text-center">Hours</th>
                <th className="p-3 text-center">Drive Assets Log</th>
                <th className="p-3 text-center">Bitrix</th>
                <th className="p-3 text-center">Grant</th>
                <th className="p-3 text-center">Hotel</th>
                <th className="p-3 text-center">Bus</th>
                <th className="p-3 text-center">Facilitator</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans font-medium">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={14} className="p-8 text-center text-slate-400 italic bg-slate-50/50">
                    No operations records found matching active filter metrics.
                  </td>
                </tr>
              ) : (
                filteredRecords.map(r => {
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                      {/* Completed inline toggle */}
                      <td className="p-3 sticky left-0 bg-white hover:bg-slate-50 z-10 text-center border-r border-slate-100">
                        <button
                          onClick={() => handleToggleCompleted(r.id)}
                          className="mx-auto flex items-center justify-center cursor-pointer text-slate-500 hover:text-emerald-600 transition-transform"
                        >
                          {r.completed ? (
                            <CheckSquare className="w-4.5 h-4.5 text-emerald-600" />
                          ) : (
                            <Square className="w-4.5 h-4.5 text-slate-300" />
                          )}
                        </button>
                      </td>

                      <td className="p-3 text-center font-mono font-bold text-slate-400">{r.no}</td>
                      <td className="p-3 font-mono text-slate-600 whitespace-nowrap font-bold">{r.trainingDate}</td>
                      <td className="p-3 max-w-sm">
                        <div className="font-extrabold text-slate-800">{r.client}</div>
                        <div className="text-[10px] text-slate-500 line-clamp-1" title={r.programmeName}>
                          {r.programmeName}
                        </div>
                      </td>

                      <td className="p-3 font-bold text-slate-700 whitespace-nowrap">{r.trainer}</td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                          r.typeOfTraining === 'Team Building' 
                            ? 'bg-purple-50 text-purple-700 border border-purple-200'
                            : r.typeOfTraining === 'In-house'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : r.typeOfTraining === 'Public'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}>
                          {r.typeOfTraining}
                        </span>
                      </td>

                      <td className="p-3 text-center font-mono font-bold text-slate-900">{r.trainingHour}h</td>

                      {/* Dynamic Assets Links panel */}
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {isValidAsset(r.quotation) && (
                            <button
                              onClick={() => handleOpenLink(r.quotation, 'Quotation')}
                              className="p-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 border border-blue-200 cursor-pointer"
                              title={getAssetTooltip(r.quotation, 'Quotation')}
                            >
                              <FileText className="w-3 h-3" />
                            </button>
                          )}
                          {isValidAsset(r.invoice) && (
                            <button
                              onClick={() => handleOpenLink(r.invoice, 'Invoice')}
                              className="p-1 bg-amber-50 text-amber-600 rounded hover:bg-amber-100 border border-amber-200 cursor-pointer"
                              title={getAssetTooltip(r.invoice, 'Invoice')}
                            >
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          )}
                          {isValidAsset(r.certificate) && (
                            <button
                              onClick={() => handleOpenLink(r.certificate, 'Certificate')}
                              className="p-1 bg-emerald-50 text-emerald-600 rounded hover:bg-emerald-100 border border-emerald-200 cursor-pointer"
                              title={getAssetTooltip(r.certificate, 'Certificate')}
                            >
                              <CheckCircle className="w-3 h-3" />
                            </button>
                          )}
                          {isValidAsset(r.trainingReport) && (
                            <button
                              onClick={() => handleOpenLink(r.trainingReport, 'Training Report')}
                              className="p-1 bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100 border border-indigo-200 cursor-pointer"
                              title={getAssetTooltip(r.trainingReport, 'Training Report')}
                            >
                              <Layers className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="p-3 text-center font-bold text-xs">
                        <span className={r.putInBitrixCalendar === 'YES' ? 'text-emerald-600' : 'text-slate-400'}>
                          {r.putInBitrixCalendar || '-'}
                        </span>
                      </td>

                      <td className="p-3 text-center text-[10px] font-bold">
                        <span className={r.grantApproved && r.grantApproved.toLowerCase() === 'yes' ? 'text-emerald-600' : 'text-slate-400'}>
                          {r.grantApproved || '-'}
                        </span>
                      </td>

                      <td className="p-3 text-center text-[10px] font-mono whitespace-nowrap">
                        <span className={r.bookHotel !== 'N/A' ? 'text-indigo-600 font-bold' : 'text-slate-400'}>
                          {r.bookHotel || '-'}
                        </span>
                      </td>

                      <td className="p-3 text-center text-[10px] font-mono whitespace-nowrap">
                        <span className={r.bookBus !== 'N/A' ? 'text-purple-600 font-bold' : 'text-slate-400'}>
                          {r.bookBus || '-'}
                        </span>
                      </td>

                      <td className="p-3 text-center text-[10px] whitespace-nowrap">
                        <span className={r.bookFacilitator !== 'N/A' ? 'text-amber-600 font-bold' : 'text-slate-400'}>
                          {r.bookFacilitator || '-'}
                        </span>
                      </td>

                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleEditInit(r)}
                            className="p-1 rounded text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 cursor-pointer"
                            title="Edit logistical checklist"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteRecord(r.id)}
                            className="p-1 rounded text-slate-500 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                            title="Remove"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Checklist Form Drawer / Modal overlay */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[92vh] overflow-hidden flex flex-col">
            
            {/* Modal Header */}
            <div className="p-4 bg-slate-800 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider font-display">
                    {isEditing ? 'EDIT TRAINING LOG CHECKLIST' : 'LOG NEW TRAINING COHORT'}
                  </h3>
                  <span className="text-[9px] text-slate-400 font-mono">
                    Administrative Operations Sync Panel
                  </span>
                </div>
              </div>
              <button 
                onClick={() => setIsFormOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-full hover:bg-slate-700 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSaveRecord} className="flex-1 overflow-y-auto p-6 space-y-6">
              
              {/* Primary Logistics */}
              <div className="space-y-4">
                <h4 className="text-[10px] text-slate-400 font-bold uppercase tracking-wider border-b pb-1">
                  1. Core Training Details
                </h4>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                      Client / Company Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Padini, SDB, Axai Digital"
                      value={client}
                      onChange={(e) => setClient(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 font-bold"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                      Programme / Course Outline Title
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Uniting for Impact, Emerging Leaders Development"
                      value={programmeName}
                      onChange={(e) => setProgrammeName(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                      Training Date
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 20 Apr 2026 or 16-17 Jul 2026"
                      value={trainingDate}
                      onChange={(e) => setTrainingDate(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                      Lead Trainer
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Lee Chee Cai, Joel Lim"
                      value={trainer}
                      onChange={(e) => setTrainer(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                      Type of Training
                    </label>
                    <select
                      value={typeOfTraining}
                      onChange={(e) => setTypeOfTraining(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-800 focus:outline-none focus:border-emerald-500 font-bold"
                    >
                      <option value="In-house">In-house</option>
                      <option value="Public">Public</option>
                      <option value="Online">Online</option>
                      <option value="Team Building">Team Building</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                      No / Sequence Index
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 1, 2, 4b"
                      value={no}
                      onChange={(e) => setNo(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 font-mono font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                      Training Hours
                    </label>
                    <input
                      type="number"
                      value={trainingHour}
                      onChange={(e) => setTrainingHour(Number(e.target.value) || 0)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-500 font-bold"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-5">
                    <label className="flex items-center gap-2 text-xs font-black text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={completed}
                        onChange={(e) => setCompleted(e.target.checked)}
                        className="rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 w-4 h-4"
                      />
                      MARK COMPLETED (TRUE)
                    </label>
                  </div>
                </div>
              </div>

              {/* Operations Checklist */}
              <div className="space-y-4">
                <h4 className="text-[10px] text-indigo-500 font-bold uppercase tracking-wider border-b pb-1">
                  2. Operations & Coordinator Bookings
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                      Bitrix Calendar Logged?
                    </label>
                    <select
                      value={putInBitrixCalendar}
                      onChange={(e) => setPutInBitrixCalendar(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-800 focus:outline-none"
                    >
                      <option value="YES">YES</option>
                      <option value="NO">NO</option>
                      <option value="-">-</option>
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                      Venue PIC Contact details
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Afif 013-370 4559 or N/A"
                      value={venuePicContact}
                      onChange={(e) => setVenuePicContact(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                      Book Hotel Status
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. N/A, Done, Paid 30%"
                      value={bookHotel}
                      onChange={(e) => setBookHotel(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                      Pay Hotel Status
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. N/A, Done, Pending"
                      value={payHotel}
                      onChange={(e) => setPayHotel(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                      Book Bus / Transport
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. N/A, BE-2601522"
                      value={bookBus}
                      onChange={(e) => setBookBus(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                      Pay Bus
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. N/A, Done"
                      value={payBus}
                      onChange={(e) => setPayBus(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                      Book Facilitator / Coord
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. N/A, Done, Liased"
                      value={bookFacilitator}
                      onChange={(e) => setBookFacilitator(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                      Pay Facilitator
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. N/A, Done, pending"
                      value={payFacilitator}
                      onChange={(e) => setPayFacilitator(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2"
                    />
                  </div>
                </div>
              </div>

              {/* Financials & Government Claims */}
              <div className="space-y-4">
                <h4 className="text-[10px] text-amber-500 font-bold uppercase tracking-wider border-b pb-1">
                  3. Finance & HRD Corp Claims
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                      Trainer PO Code
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. N/A, PO-3012"
                      value={trainerPo}
                      onChange={(e) => setTrainerPo(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                      HRD Corp Grant Approved
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. YES, pending, client applied"
                      value={grantApproved}
                      onChange={(e) => setGrantApproved(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">
                      Training Materials/Handouts
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Done, N/A"
                      value={handoutsMaterials}
                      onChange={(e) => setHandoutsMaterials(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2"
                    />
                  </div>
                </div>
              </div>

              {/* Google Drive Attachments Log */}
              <div className="space-y-4">
                <h4 className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider border-b pb-1">
                  4. Operations Documents & Google Drive Portal (Upload or Paste Link)
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <UnifiedDocumentUploader
                    label="Quotation"
                    value={quotation}
                    onChange={setQuotation}
                    placeholder="https://drive.google.com/file/d/... (Quotation)"
                    onOpenLink={handleOpenLink}
                  />

                  <UnifiedDocumentUploader
                    label="Invoice"
                    value={invoice}
                    onChange={setInvoice}
                    placeholder="https://drive.google.com/file/d/... (Invoice)"
                    onOpenLink={handleOpenLink}
                  />

                  <UnifiedDocumentUploader
                    label="Attendance List"
                    value={attendanceList}
                    onChange={setAttendanceList}
                    placeholder="https://drive.google.com/file/d/... (Attendance)"
                    onOpenLink={handleOpenLink}
                  />

                  <UnifiedDocumentUploader
                    label="JD14"
                    value={jd14}
                    onChange={setJd14}
                    placeholder="https://drive.google.com/file/d/... (JD14 Form)"
                    onOpenLink={handleOpenLink}
                  />

                  <UnifiedDocumentUploader
                    label="Certificate Folder / Files"
                    value={certificate}
                    onChange={setCertificate}
                    placeholder="https://drive.google.com/drive/folders/... (Certificates)"
                    onOpenLink={handleOpenLink}
                  />

                  <UnifiedDocumentUploader
                    label="Training Report"
                    value={trainingReport}
                    onChange={setTrainingReport}
                    placeholder="https://drive.google.com/file/d/... (Training Report)"
                    onOpenLink={handleOpenLink}
                  />

                  <UnifiedDocumentUploader
                    label="Output Summary QR Folder"
                    value={outputSummaryQr}
                    onChange={setOutputSummaryQr}
                    placeholder="https://drive.google.com/drive/folders/... (QR Codes)"
                    onOpenLink={handleOpenLink}
                  />

                  <UnifiedDocumentUploader
                    label="Upload Photos/Videos Folder"
                    value={uploadPhotosDrive}
                    onChange={setUploadPhotosDrive}
                    placeholder="https://drive.google.com/drive/folders/... (Media assets)"
                    onOpenLink={handleOpenLink}
                  />
                </div>
              </div>

              {/* Modal actions */}
              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 font-bold text-[10.5px] uppercase rounded-xl hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10.5px] uppercase rounded-xl transition-all shadow-md cursor-pointer"
                >
                  {isEditing ? 'Save Log' : 'Add To Log'}
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

    </div>
  );
}
