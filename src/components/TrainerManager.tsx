import React, { useState, useEffect } from 'react';
import { Representative, Trainer } from '../types';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query } from 'firebase/firestore';
import {
  Plus, Trash2, Edit3, Search, X, User, Phone, Mail,
  DollarSign, CheckCircle, RotateCcw, Users, GraduationCap, Save
} from 'lucide-react';

interface TrainerManagerProps {
  rep: Representative;
  reps: Representative[];
  requestManagerPermission: (actionToExecute: () => void) => void;
}

const LOCAL_STORAGE_KEY = 'next_trainers_shared';

export default function TrainerManager({ rep, reps, requestManagerPermission }: TrainerManagerProps) {
  const [trainers, setTrainers] = useState<Trainer[]>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // fallback to empty
      }
    }
    return [];
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'Available' | 'Booked' | 'On Leave'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'az'>('newest');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);
  const [previousTrainers, setPreviousTrainers] = useState<Trainer[] | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingTrainerId, setEditingTrainerId] = useState<string | null>(null);

  // Form fields
  const [formName, setFormName] = useState('');
  const [formSpecialization, setFormSpecialization] = useState('React & AI Integration');
  const [formContact, setFormContact] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRate, setFormRate] = useState('');
  const [formStatus, setFormStatus] = useState<'Available' | 'Booked' | 'On Leave'>('Available');
  const [formNotes, setFormNotes] = useState('');

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Real-time Firestore sync for Trainers (shared collection, not per-rep)
  useEffect(() => {
    if (!db) return;

    const q = query(collection(db, 'trainers_directory'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const firestoreTrainers: Trainer[] = [];
      snapshot.forEach((docSnap) => {
        firestoreTrainers.push({ ...(docSnap.data() as Trainer), id: docSnap.id });
      });

      firestoreTrainers.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setTrainers(firestoreTrainers);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(firestoreTrainers));
    });

    return () => unsubscribe();
  }, []);

  const resetForm = () => {
    setFormName('');
    setFormSpecialization('React & AI Integration');
    setFormContact('');
    setFormEmail('');
    setFormRate('');
    setFormStatus('Available');
    setFormNotes('');
    setEditingTrainerId(null);
  };

  const handleOpenAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const handleOpenEditModal = (trainer: Trainer) => {
    setEditingTrainerId(trainer.id);
    setFormName(trainer.name || '');
    setFormSpecialization(trainer.specialization || 'React & AI Integration');
    setFormContact(trainer.contact || '');
    setFormEmail(trainer.email || '');
    setFormRate(trainer.rate ? String(trainer.rate) : '');
    setFormStatus(trainer.status || 'Available');
    setFormNotes(trainer.notes || '');
    setShowModal(true);
  };

  const handleSaveTrainer = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formName.trim()) {
      showToast('Trainer name is required.', 'error');
      return;
    }

    let newTrainer: Trainer;

    if (editingTrainerId) {
      const existing = trainers.find(t => t.id === editingTrainerId);
      newTrainer = {
        ...existing,
        id: editingTrainerId,
        name: formName.trim(),
        specialization: formSpecialization,
        contact: formContact.trim(),
        email: formEmail.trim(),
        rate: parseFloat(formRate) || 0,
        status: formStatus,
        notes: formNotes.trim(),
      } as Trainer;

      const updated = trainers.map(t => t.id === editingTrainerId ? newTrainer : t);
      setTrainers(updated);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      showToast('Trainer updated.', 'success');
    } else {
      newTrainer = {
        id: `trainer_${Date.now()}`,
        name: formName.trim(),
        specialization: formSpecialization,
        contact: formContact.trim(),
        email: formEmail.trim(),
        rate: parseFloat(formRate) || 0,
        status: formStatus,
        notes: formNotes.trim(),
        createdAt: Date.now(),
        createdBy: rep.id,
        createdByName: rep.name,
      };

      const updated = [newTrainer, ...trainers];
      setTrainers(updated);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      showToast('Trainer added.', 'success');
    }

    try {
      if (db) {
        await setDoc(doc(db, 'trainers_directory', newTrainer.id), newTrainer);
      }
    } catch (err) {
      console.error('Firestore save trainer failed:', err);
    }

    setShowModal(false);
    resetForm();
  };

  const handleDeleteTrainer = (id: string) => {
    requestManagerPermission(async () => {
      setPreviousTrainers(JSON.parse(JSON.stringify(trainers)));
      setUndoMessage('Trainer record deleted.');
      const remaining = trainers.filter(t => t.id !== id);
      setTrainers(remaining);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(remaining));
      showToast('Trainer deleted.', 'success');

      try {
        if (db) {
          await deleteDoc(doc(db, 'trainers_directory', id));
        }
      } catch (err) {
        console.error('Firestore delete trainer failed:', err);
      }
    });
  };

  const handleUndoChange = async () => {
    if (previousTrainers) {
      setTrainers(previousTrainers);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(previousTrainers));
      showToast('Action reverted.', 'success');
      try {
        if (db) {
          for (const t of previousTrainers) {
            await setDoc(doc(db, 'trainers_directory', t.id), t);
          }
        }
      } catch (err) {
        console.error('Firestore undo failed:', err);
      }
      setPreviousTrainers(null);
      setUndoMessage(null);
    }
  };

  const filteredTrainers = trainers
    .filter(t => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        (t.name || '').toLowerCase().includes(q) ||
        (t.specialization || '').toLowerCase().includes(q) ||
        (t.contact || '').toLowerCase().includes(q) ||
        (t.email || '').toLowerCase().includes(q);
      const matchesStatus = filterStatus === 'all' || t.status === filterStatus;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      if (sortOrder === 'az') return (a.name || '').localeCompare(b.name || '');
      if (sortOrder === 'oldest') return (a.createdAt || 0) - (b.createdAt || 0);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

  const totalTrainers = trainers.length;
  const availableCount = trainers.filter(t => t.status === 'Available').length;
  const bookedCount = trainers.filter(t => t.status === 'Booked').length;
  const avgRate = trainers.length > 0
    ? Math.round(trainers.reduce((sum, t) => sum + (t.rate || 0), 0) / trainers.length)
    : 0;

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

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Total Trainers
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900">{totalTrainers}</span>
            <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
              <GraduationCap className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Shared record across all staff</p>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Available Now
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-emerald-600">{availableCount}</span>
            <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
              <CheckCircle className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Ready to be assigned to a job</p>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Currently Booked
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-amber-600">{bookedCount}</span>
            <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Engaged on an active training</p>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Average Daily Rate
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-indigo-600">RM {avgRate.toLocaleString()}</span>
            <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Across all registered trainers</p>
        </div>
      </div>

      {/* Control Panel */}
      <div className="bg-slate-900 border border-slate-800 text-white rounded-xl p-4 space-y-4 shadow-lg">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div>
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 font-display">
              <GraduationCap className="w-4 h-4 text-blue-400" />
              Trainer Database (Shared Directory)
            </h2>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              One shared list, visible and editable by every rep
            </p>
          </div>

          <button
            onClick={handleOpenAddModal}
            className="bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-[10px] uppercase tracking-wider px-4 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md"
          >
            <Plus className="w-4 h-4" />
            Register New Trainer
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-800">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search name, specialization, contact..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 font-semibold"
            />
          </div>

          <div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500 font-bold"
            >
              <option value="all">All Statuses</option>
              <option value="Available">Available</option>
              <option value="Booked">Booked</option>
              <option value="On Leave">On Leave</option>
            </select>
          </div>

          <div>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest' | 'az')}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500 font-bold"
            >
              <option value="newest">Sort: Newest First</option>
              <option value="oldest">Sort: Oldest First</option>
              <option value="az">Sort: Name A-Z</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-slate-700 font-sans text-xs">
            <thead className="bg-slate-800 text-slate-200 font-display text-[10px] font-black uppercase tracking-wider border-b border-slate-700">
              <tr>
                <th className="p-3 whitespace-nowrap min-w-[160px]">Trainer Name</th>
                <th className="p-3 whitespace-nowrap">Specialization</th>
                <th className="p-3 whitespace-nowrap">Contact</th>
                <th className="p-3 text-right whitespace-nowrap">Daily Rate</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 whitespace-nowrap">Added By</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans font-medium">
              {filteredTrainers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400 italic bg-slate-50/50">
                    {trainers.length === 0
                      ? 'No trainers yet. Click "Register New Trainer" to log the first record.'
                      : 'No trainers found matching your search/filter.'}
                  </td>
                </tr>
              ) : (
                filteredTrainers.map(t => (
                  <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-3 font-bold text-slate-900">
                      <div className="flex items-center gap-2">
                        <User className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                        {t.name}
                      </div>
                    </td>
                    <td className="p-3 font-mono text-[10px] text-slate-500">
                      {t.specialization}
                    </td>
                    <td className="p-3">
                      <div className="space-y-0.5">
                        {t.contact && (
                          <div className="flex items-center gap-1.5 font-mono text-[10px]">
                            <Phone className="w-3 h-3 text-slate-400" />
                            {t.contact}
                          </div>
                        )}
                        {t.email && (
                          <div className="flex items-center gap-1.5 font-mono text-[10px]">
                            <Mail className="w-3 h-3 text-slate-400" />
                            {t.email}
                          </div>
                        )}
                        {!t.contact && !t.email && <span className="text-slate-300">—</span>}
                      </div>
                    </td>
                    <td className="p-3 text-right font-mono font-black text-slate-800">
                      RM {(t.rate || 0).toLocaleString()}
                    </td>
                    <td className="p-3 text-center">
                      {t.status === 'Available' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 font-black text-[9px] uppercase tracking-wider">
                          Available
                        </span>
                      ) : t.status === 'Booked' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 font-black text-[9px] uppercase tracking-wider">
                          Booked
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-700 font-black text-[9px] uppercase tracking-wider">
                          On Leave
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-[10px] text-slate-400 font-mono whitespace-nowrap">
                      {t.createdByName || '—'}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenEditModal(t)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          title="Edit trainer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteTrainer(t.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="Delete trainer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-slate-150 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <GraduationCap className="w-4 h-4 text-blue-600" />
                {editingTrainerId ? 'Edit Trainer' : 'Register New Trainer'}
              </h3>
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTrainer} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Trainer Name *
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Dr. Jane Smith"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800"
                    required
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Specialization
                  </label>
                  <select
                    value={formSpecialization}
                    onChange={(e) => setFormSpecialization(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800"
                  >
                    <option value="React & AI Integration">React & AI Integration</option>
                    <option value="Design Thinking & Soft Skills">Design Thinking & Soft Skills</option>
                    <option value="Full-Stack Web Development">Full-Stack Web Development</option>
                    <option value="Leadership & Corporate">Leadership & Corporate</option>
                    <option value="Sales Mastery">Sales Mastery</option>
                    <option value="Technical QA">Technical QA</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Contact Number
                  </label>
                  <input
                    type="text"
                    value={formContact}
                    onChange={(e) => setFormContact(e.target.value)}
                    placeholder="e.g. +6011-1234567"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 font-mono"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="e.g. trainer@email.com"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Daily Rate (RM)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-slate-400 text-xs font-black font-mono">RM</span>
                    <input
                      type="number"
                      value={formRate}
                      onChange={(e) => setFormRate(e.target.value)}
                      placeholder="e.g. 2000"
                      className="w-full text-xs pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Status
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as 'Available' | 'Booked' | 'On Leave')}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800"
                  >
                    <option value="Available">Available</option>
                    <option value="Booked">Booked</option>
                    <option value="On Leave">On Leave</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Notes
                  </label>
                  <textarea
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Any additional context about this trainer..."
                    rows={2}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-slate-800 resize-none"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); resetForm(); }}
                  className="flex-1 border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold text-xs py-2 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  {editingTrainerId ? 'Save Changes' : 'Add Trainer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
