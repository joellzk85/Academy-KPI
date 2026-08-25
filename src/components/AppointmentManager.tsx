import React, { useState, useEffect } from 'react';
import { Representative, Appointment, Client } from '../types';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query } from 'firebase/firestore';
import {
  Plus, Trash2, Edit3, Search, X, User, Calendar, Clock,
  CheckCircle, RotateCcw, CalendarClock, Save, Link2, PhoneCall
} from 'lucide-react';

interface AppointmentManagerProps {
  rep: Representative;
  reps: Representative[];
  requestManagerPermission: (actionToExecute: () => void) => void;
}

const LOCAL_STORAGE_KEY = 'next_appointments_shared';

export default function AppointmentManager({ rep, reps, requestManagerPermission }: AppointmentManagerProps) {
  const [appointments, setAppointments] = useState<Appointment[]>(() => {
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

  const [clientDirectory, setClientDirectory] = useState<Client[]>([]);
  const [pipelineDirectory, setPipelineDirectory] = useState<any[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'Scheduled' | 'Completed' | 'No-Show' | 'Cancelled'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);
  const [previousAppointments, setPreviousAppointments] = useState<Appointment[] | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingAppointmentId, setEditingAppointmentId] = useState<string | null>(null);

  // Form fields
  const [formClientName, setFormClientName] = useState('');
  const [formPipelineId, setFormPipelineId] = useState('');
  const [formRepId, setFormRepId] = useState(rep.id);
  const [formDate, setFormDate] = useState(new Date().toISOString().substring(0, 10));
  const [formTime, setFormTime] = useState('');
  const [formType, setFormType] = useState<Appointment['type']>('Discovery Call');
  const [formStatus, setFormStatus] = useState<Appointment['status']>('Scheduled');
  const [formNotes, setFormNotes] = useState('');

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Real-time Firestore sync for Appointments (shared collection, not per-rep)
  useEffect(() => {
    if (!db) return;

    const q = query(collection(db, 'appointments'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Appointment[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ ...(docSnap.data() as Appointment), id: docSnap.id });
      });
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setAppointments(list);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list));
    });

    return () => unsubscribe();
  }, []);

  // Read-only live sync of Client Database and Pipeline, to power the pickers below
  useEffect(() => {
    if (!db) return;
    const unsubClients = onSnapshot(query(collection(db, 'clients')), (snap) => {
      const list: Client[] = [];
      snap.forEach(d => list.push({ ...(d.data() as Client), id: d.id }));
      setClientDirectory(list);
    });
    const unsubPipelines = onSnapshot(query(collection(db, 'pipelines')), (snap) => {
      const list: any[] = [];
      snap.forEach(d => list.push({ ...d.data(), id: d.id }));
      setPipelineDirectory(list);
    });
    return () => {
      unsubClients();
      unsubPipelines();
    };
  }, []);

  const matchedClient = clientDirectory.find(
    c => c.companyName.trim().toLowerCase() === formClientName.trim().toLowerCase()
  );

  const resetForm = () => {
    setFormClientName('');
    setFormPipelineId('');
    setFormRepId(rep.id);
    setFormDate(new Date().toISOString().substring(0, 10));
    setFormTime('');
    setFormType('Discovery Call');
    setFormStatus('Scheduled');
    setFormNotes('');
    setEditingAppointmentId(null);
  };

  const handleOpenAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const handleOpenEditModal = (appt: Appointment) => {
    setEditingAppointmentId(appt.id);
    setFormClientName(appt.clientName || '');
    setFormPipelineId(appt.pipelineId || '');
    setFormRepId(appt.repId || rep.id);
    setFormDate(appt.date || new Date().toISOString().substring(0, 10));
    setFormTime(appt.time || '');
    setFormType(appt.type || 'Discovery Call');
    setFormStatus(appt.status || 'Scheduled');
    setFormNotes(appt.notes || '');
    setShowModal(true);
  };

  const handleQuickAddClient = async () => {
    if (!formClientName.trim()) return;
    const newClient: Client = {
      id: `client_${Date.now()}`,
      companyName: formClientName.trim(),
      contactName: 'N/A',
      createdAt: Date.now(),
      createdBy: rep.id,
      createdByName: rep.name,
    };
    try {
      if (db) await setDoc(doc(db, 'clients', newClient.id), newClient);
    } catch (err) {
      console.error('Quick-add client failed:', err);
    }
  };

  const handleSaveAppointment = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formClientName.trim()) {
      showToast('Client name is required.', 'error');
      return;
    }

    const repObj = reps.find(r => r.id === formRepId) || rep;
    let newAppt: Appointment;

    if (editingAppointmentId) {
      const existing = appointments.find(a => a.id === editingAppointmentId);
      newAppt = {
        ...existing,
        id: editingAppointmentId,
        clientName: formClientName.trim(),
        clientId: matchedClient ? matchedClient.id : '',
        pipelineId: formPipelineId || '',
        repId: formRepId,
        repName: repObj.name,
        date: formDate,
        time: formTime,
        type: formType,
        status: formStatus,
        notes: formNotes.trim(),
      } as Appointment;

      const updated = appointments.map(a => a.id === editingAppointmentId ? newAppt : a);
      setAppointments(updated);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      showToast('Appointment updated.', 'success');
    } else {
      newAppt = {
        id: `appt_${Date.now()}`,
        clientName: formClientName.trim(),
        clientId: matchedClient ? matchedClient.id : '',
        pipelineId: formPipelineId || '',
        repId: formRepId,
        repName: repObj.name,
        date: formDate,
        time: formTime,
        type: formType,
        status: formStatus,
        notes: formNotes.trim(),
        createdAt: Date.now(),
        createdBy: rep.id,
        createdByName: rep.name,
      };

      const updated = [newAppt, ...appointments];
      setAppointments(updated);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      showToast('Appointment logged.', 'success');
    }

    try {
      if (db) {
        await setDoc(doc(db, 'appointments', newAppt.id), newAppt);
        // Two-way tie: if this appointment is linked to a pipeline deal,
        // make sure that deal's "Appointment Scheduled" checkbox is ticked too,
        // so KPI (which reads off the pipeline checkbox) stays in sync either way.
        if (newAppt.pipelineId) {
          await setDoc(doc(db, 'pipelines', newAppt.pipelineId), { appointmentTicked: true }, { merge: true });
        }
      }
    } catch (err) {
      console.error('Firestore save appointment failed:', err);
    }

    setShowModal(false);
    resetForm();
  };

  const handleDeleteAppointment = (id: string) => {
    requestManagerPermission(async () => {
      setPreviousAppointments(JSON.parse(JSON.stringify(appointments)));
      setUndoMessage('Appointment deleted.');
      const remaining = appointments.filter(a => a.id !== id);
      setAppointments(remaining);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(remaining));
      showToast('Appointment deleted.', 'success');

      try {
        if (db) {
          await deleteDoc(doc(db, 'appointments', id));
        }
      } catch (err) {
        console.error('Firestore delete appointment failed:', err);
      }
    });
  };

  const handleUndoChange = async () => {
    if (previousAppointments) {
      setAppointments(previousAppointments);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(previousAppointments));
      showToast('Action reverted.', 'success');
      try {
        if (db) {
          for (const a of previousAppointments) {
            await setDoc(doc(db, 'appointments', a.id), a);
          }
        }
      } catch (err) {
        console.error('Firestore undo failed:', err);
      }
      setPreviousAppointments(null);
      setUndoMessage(null);
    }
  };

  const handleQuickStatusChange = async (appt: Appointment, newStatus: Appointment['status']) => {
    const updatedAppt = { ...appt, status: newStatus };
    const updated = appointments.map(a => a.id === appt.id ? updatedAppt : a);
    setAppointments(updated);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
    try {
      if (db) await setDoc(doc(db, 'appointments', appt.id), updatedAppt);
    } catch (err) {
      console.error('Firestore quick status update failed:', err);
    }
  };

  const filteredAppointments = appointments
    .filter(a => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        (a.clientName || '').toLowerCase().includes(q) ||
        (a.repName || '').toLowerCase().includes(q) ||
        (a.notes || '').toLowerCase().includes(q);
      const matchesStatus = filterStatus === 'all' || a.status === filterStatus;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      const aTime = new Date(a.date + 'T' + (a.time || '00:00')).getTime();
      const bTime = new Date(b.date + 'T' + (b.time || '00:00')).getTime();
      return sortOrder === 'newest' ? bTime - aTime : aTime - bTime;
    });

  const totalAppointments = appointments.length;
  const scheduledCount = appointments.filter(a => a.status === 'Scheduled').length;
  const completedCount = appointments.filter(a => a.status === 'Completed').length;
  const todayCount = appointments.filter(a => a.date === new Date().toISOString().substring(0, 10)).length;

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

      {/* Info banner explaining relationship to pipeline KPI checkbox */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800 flex items-start gap-2">
        <CalendarClock className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          Appointments logged here and linked to a pipeline deal automatically tick that deal's "Appointment Scheduled"
          checkbox, so KPI stays accurate no matter which place you log from. Standalone appointments (no pipeline link)
          don't affect KPI, since KPI is counted per pipeline deal.
        </span>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Total Appointments
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900">{totalAppointments}</span>
            <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
              <CalendarClock className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Shared log across all staff</p>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Today
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-blue-600">{todayCount}</span>
            <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Appointments scheduled for today</p>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Scheduled
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-amber-600">{scheduledCount}</span>
            <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Upcoming, not yet done</p>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Completed
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-emerald-600">{completedCount}</span>
            <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
              <CheckCircle className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Appointments held</p>
        </div>
      </div>

      {/* Control Panel */}
      <div className="bg-slate-900 border border-slate-800 text-white rounded-xl p-4 space-y-4 shadow-lg">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div>
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 font-display">
              <CalendarClock className="w-4 h-4 text-amber-400" />
              Appointment Log (Shared)
            </h2>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              Track client meetings and calls, linked to a client and optionally a pipeline deal
            </p>
          </div>

          <button
            onClick={handleOpenAddModal}
            className="bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-[10px] uppercase tracking-wider px-4 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md"
          >
            <Plus className="w-4 h-4" />
            Log New Appointment
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-800">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search client, rep, notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 font-semibold"
            />
          </div>

          <div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500 font-bold"
            >
              <option value="all">All Statuses</option>
              <option value="Scheduled">Scheduled</option>
              <option value="Completed">Completed</option>
              <option value="No-Show">No-Show</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>

          <div>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500 font-bold"
            >
              <option value="newest">Sort: Soonest/Newest First</option>
              <option value="oldest">Sort: Oldest First</option>
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
                <th className="p-3 whitespace-nowrap">Date / Time</th>
                <th className="p-3 whitespace-nowrap min-w-[160px]">Client</th>
                <th className="p-3 whitespace-nowrap">Type</th>
                <th className="p-3 whitespace-nowrap">Rep</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans font-medium">
              {filteredAppointments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400 italic bg-slate-50/50">
                    {appointments.length === 0
                      ? 'No appointments logged yet. Click "Log New Appointment" to add the first one.'
                      : 'No appointments found matching your search/filter.'}
                  </td>
                </tr>
              ) : (
                filteredAppointments.map(a => (
                  <tr key={a.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-3 font-mono">
                      <div className="font-bold text-slate-800">{a.date}</div>
                      {a.time && <div className="text-[10px] text-slate-400">{a.time}</div>}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5 font-bold text-slate-900">
                        <User className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                        {a.clientName}
                        {a.clientId && (
                          <span title="Linked to Client Database" className="text-violet-500">
                            <Link2 className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                      {a.notes && <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{a.notes}</div>}
                    </td>
                    <td className="p-3 text-[10px] font-mono text-slate-500">{a.type}</td>
                    <td className="p-3 text-[10px] font-mono text-slate-500">{a.repName}</td>
                    <td className="p-3 text-center">
                      <select
                        value={a.status}
                        onChange={(e) => handleQuickStatusChange(a, e.target.value as Appointment['status'])}
                        className={`text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded border cursor-pointer ${
                          a.status === 'Completed' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                          a.status === 'Scheduled' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                          a.status === 'No-Show' ? 'bg-rose-50 border-rose-200 text-rose-700' :
                          'bg-slate-50 border-slate-200 text-slate-500'
                        }`}
                      >
                        <option value="Scheduled">Scheduled</option>
                        <option value="Completed">Completed</option>
                        <option value="No-Show">No-Show</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenEditModal(a)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          title="Edit appointment"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteAppointment(a.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="Delete appointment"
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
                <PhoneCall className="w-4 h-4 text-amber-600" />
                {editingAppointmentId ? 'Edit Appointment' : 'Log New Appointment'}
              </h3>
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAppointment} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1 flex items-center gap-1.5">
                    Client Name *
                    {matchedClient && (
                      <span className="inline-flex items-center gap-0.5 text-violet-600 font-mono normal-case text-[9px] bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded">
                        <CheckCircle className="w-2.5 h-2.5" />
                        Linked
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    list="appointment-client-suggestions"
                    value={formClientName}
                    onChange={(e) => setFormClientName(e.target.value)}
                    placeholder="Search existing client, or type a new one"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500 text-slate-800"
                    required
                  />
                  <datalist id="appointment-client-suggestions">
                    {clientDirectory.map(c => (
                      <option key={c.id} value={c.companyName} />
                    ))}
                  </datalist>
                  {formClientName.trim() && !matchedClient && (
                    <button
                      type="button"
                      onClick={handleQuickAddClient}
                      className="mt-1 text-[10px] text-violet-600 hover:text-violet-700 font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      Save "{formClientName.trim()}" to Client Database
                    </button>
                  )}
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Link to Pipeline Deal (Optional)
                  </label>
                  <select
                    value={formPipelineId}
                    onChange={(e) => setFormPipelineId(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500 text-slate-800"
                  >
                    <option value="">No pipeline deal (standalone appointment)</option>
                    {pipelineDirectory.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.client} — {p.courseName} ({p.status})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500 text-slate-800"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Time
                  </label>
                  <input
                    type="time"
                    value={formTime}
                    onChange={(e) => setFormTime(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500 text-slate-800"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Type
                  </label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as Appointment['type'])}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500 text-slate-800"
                  >
                    <option value="Discovery Call">Discovery Call</option>
                    <option value="Site Visit">Site Visit</option>
                    <option value="Proposal Meeting">Proposal Meeting</option>
                    <option value="Follow-up">Follow-up</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Status
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as Appointment['status'])}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500 text-slate-800"
                  >
                    <option value="Scheduled">Scheduled</option>
                    <option value="Completed">Completed</option>
                    <option value="No-Show">No-Show</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Assigned Rep
                  </label>
                  <select
                    value={formRepId}
                    onChange={(e) => setFormRepId(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500 text-slate-800"
                  >
                    {reps.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Notes
                  </label>
                  <textarea
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="What to prepare, what was discussed, next steps..."
                    rows={2}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-amber-500 text-slate-800 resize-none"
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
                  className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  {editingAppointmentId ? 'Save Changes' : 'Log Appointment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
