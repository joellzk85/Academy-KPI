import React, { useState, useEffect } from 'react';
import { Representative, Client } from '../types';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query } from 'firebase/firestore';
import {
  Plus, Trash2, Edit3, Search, X, Building2, User,
  Phone, Mail, MapPin, Briefcase, CheckCircle, RotateCcw,
  Users, ShieldCheck, CalendarPlus, Save, Eye, TrendingUp,
  FileText, BookOpen, ClipboardList, CalendarClock, Wallet
} from 'lucide-react';

interface ClientManagerProps {
  rep: Representative;
  reps: Representative[];
  requestManagerPermission: (actionToExecute: () => void) => void;
}

const LOCAL_STORAGE_KEY = 'next_clients_shared';

export default function ClientManager({ rep, reps, requestManagerPermission }: ClientManagerProps) {
  const [clients, setClients] = useState<Client[]>(() => {
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
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'az'>('newest');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);
  const [previousClients, setPreviousClients] = useState<Client[] | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);

  // Form fields
  const [formCompanyName, setFormCompanyName] = useState('');
  const [formContactName, setFormContactName] = useState('');
  const [formDesignation, setFormDesignation] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formIndustry, setFormIndustry] = useState('');
  const [formHrdc, setFormHrdc] = useState(false);
  const [formNotes, setFormNotes] = useState('');

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Real-time Firestore sync for Clients (shared collection, not per-rep)
  useEffect(() => {
    if (!db) return;

    const q = query(collection(db, 'clients'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const firestoreClients: Client[] = [];
      snapshot.forEach((docSnap) => {
        firestoreClients.push({ ...(docSnap.data() as Client), id: docSnap.id });
      });

      firestoreClients.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setClients(firestoreClients);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(firestoreClients));
    });

    return () => unsubscribe();
  }, []);

  // Read-only live sync of every other collection linked to clients, powering
  // the Client 360 view below (pipeline deals, quotations, outlines, admin
  // records, appointments, and payments tied to a given client).
  const [pipelineDirectory, setPipelineDirectory] = useState<any[]>([]);
  const [quotationDirectory, setQuotationDirectory] = useState<any[]>([]);
  const [outlineDirectory, setOutlineDirectory] = useState<any[]>([]);
  const [adminRecordDirectory, setAdminRecordDirectory] = useState<any[]>([]);
  const [appointmentDirectory, setAppointmentDirectory] = useState<any[]>([]);
  const [paymentDirectory, setPaymentDirectory] = useState<any[]>([]);

  useEffect(() => {
    if (!db) return;
    const unsubs = [
      onSnapshot(query(collection(db, 'pipelines')), (snap) => {
        const list: any[] = [];
        snap.forEach(d => list.push({ ...d.data(), id: d.id }));
        setPipelineDirectory(list);
      }),
      onSnapshot(query(collection(db, 'quotations')), (snap) => {
        const list: any[] = [];
        snap.forEach(d => list.push({ ...d.data(), id: d.id }));
        setQuotationDirectory(list);
      }),
      onSnapshot(query(collection(db, 'course_outlines')), (snap) => {
        const list: any[] = [];
        snap.forEach(d => list.push({ ...d.data(), id: d.id }));
        setOutlineDirectory(list);
      }),
      onSnapshot(query(collection(db, 'admin_records')), (snap) => {
        const list: any[] = [];
        snap.forEach(d => list.push({ ...d.data(), id: d.id }));
        setAdminRecordDirectory(list);
      }),
      onSnapshot(query(collection(db, 'appointments')), (snap) => {
        const list: any[] = [];
        snap.forEach(d => list.push({ ...d.data(), id: d.id }));
        setAppointmentDirectory(list);
      }),
      onSnapshot(query(collection(db, 'client_payments')), (snap) => {
        const list: any[] = [];
        snap.forEach(d => list.push({ ...d.data(), id: d.id }));
        setPaymentDirectory(list);
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, []);

  // Client 360 view state
  const [view360ClientId, setView360ClientId] = useState<string | null>(null);
  const view360Client = clients.find(c => c.id === view360ClientId);

  // Every record type is matched to a client either by a direct clientId link,
  // or (for records created before that client existed in the database) by
  // company name text match, so nothing is missed just because it predates linking.
  const getClientRecords = (c: Client) => {
    const nameMatch = (val?: string) => (val || '').trim().toLowerCase() === c.companyName.trim().toLowerCase();
    return {
      deals: pipelineDirectory.filter(p => p.clientId === c.id || nameMatch(p.client)),
      quotations: quotationDirectory.filter(q => q.clientId === c.id || nameMatch(q.company)),
      outlines: outlineDirectory.filter(o => o.clientId === c.id || nameMatch(o.preparedForCompany)),
      adminRecords: adminRecordDirectory.filter(r => r.clientId === c.id || nameMatch(r.client)),
      appointments: appointmentDirectory.filter(a => a.clientId === c.id || nameMatch(a.clientName)),
      payments: paymentDirectory.filter(p => p.clientId === c.id || nameMatch(p.clientName)),
    };
  };

  const resetForm = () => {
    setFormCompanyName('');
    setFormContactName('');
    setFormDesignation('');
    setFormPhone('');
    setFormEmail('');
    setFormAddress('');
    setFormIndustry('');
    setFormHrdc(false);
    setFormNotes('');
    setEditingClientId(null);
  };

  const handleOpenAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const handleOpenEditModal = (client: Client) => {
    setEditingClientId(client.id);
    setFormCompanyName(client.companyName || '');
    setFormContactName(client.contactName || '');
    setFormDesignation(client.designation || '');
    setFormPhone(client.phone || '');
    setFormEmail(client.email || '');
    setFormAddress(client.address || '');
    setFormIndustry(client.industry || '');
    setFormHrdc(!!client.hrdcRegistered);
    setFormNotes(client.notes || '');
    setShowModal(true);
  };

  const handleSaveClient = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formCompanyName.trim() || !formContactName.trim()) {
      showToast('Company name and contact name are required.', 'error');
      return;
    }

    let newClient: Client;

    if (editingClientId) {
      const existing = clients.find(c => c.id === editingClientId);
      newClient = {
        ...existing,
        id: editingClientId,
        companyName: formCompanyName.trim(),
        contactName: formContactName.trim(),
        designation: formDesignation.trim(),
        phone: formPhone.trim(),
        email: formEmail.trim(),
        address: formAddress.trim(),
        industry: formIndustry.trim(),
        hrdcRegistered: formHrdc,
        notes: formNotes.trim(),
      } as Client;

      const updated = clients.map(c => c.id === editingClientId ? newClient : c);
      setClients(updated);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      showToast('Client updated.', 'success');
    } else {
      newClient = {
        id: `client_${Date.now()}`,
        companyName: formCompanyName.trim(),
        contactName: formContactName.trim(),
        designation: formDesignation.trim(),
        phone: formPhone.trim(),
        email: formEmail.trim(),
        address: formAddress.trim(),
        industry: formIndustry.trim(),
        hrdcRegistered: formHrdc,
        notes: formNotes.trim(),
        createdAt: Date.now(),
        createdBy: rep.id,
        createdByName: rep.name,
      };

      const updated = [newClient, ...clients];
      setClients(updated);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      showToast('Client added.', 'success');
    }

    try {
      if (db) {
        await setDoc(doc(db, 'clients', newClient.id), newClient);
      }
    } catch (err) {
      console.error('Firestore save client failed:', err);
    }

    setShowModal(false);
    resetForm();
  };

  const handleDeleteClient = (id: string) => {
    requestManagerPermission(async () => {
      setPreviousClients(JSON.parse(JSON.stringify(clients)));
      setUndoMessage('Client record deleted.');
      const remaining = clients.filter(c => c.id !== id);
      setClients(remaining);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(remaining));
      showToast('Client deleted.', 'success');

      try {
        if (db) {
          await deleteDoc(doc(db, 'clients', id));
        }
      } catch (err) {
        console.error('Firestore delete client failed:', err);
      }
    });
  };

  const handleUndoChange = async () => {
    if (previousClients) {
      setClients(previousClients);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(previousClients));
      showToast('Action reverted.', 'success');
      try {
        if (db) {
          for (const c of previousClients) {
            await setDoc(doc(db, 'clients', c.id), c);
          }
        }
      } catch (err) {
        console.error('Firestore undo failed:', err);
      }
      setPreviousClients(null);
      setUndoMessage(null);
    }
  };

  const filteredClients = clients
    .filter(c => {
      const q = searchQuery.toLowerCase();
      return (
        (c.companyName || '').toLowerCase().includes(q) ||
        (c.contactName || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.industry || '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortOrder === 'az') return (a.companyName || '').localeCompare(b.companyName || '');
      if (sortOrder === 'oldest') return (a.createdAt || 0) - (b.createdAt || 0);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

  const totalClients = clients.length;
  const hrdcCount = clients.filter(c => c.hrdcRegistered).length;
  const thisMonthCount = clients.filter(c => {
    if (!c.createdAt) return false;
    const now = new Date();
    const created = new Date(c.createdAt);
    return created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear();
  }).length;
  const industryCount = new Set(clients.map(c => c.industry).filter(Boolean)).size;

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
            Total Clients
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900">{totalClients}</span>
            <div className="p-1.5 bg-violet-50 text-violet-600 rounded-lg">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Shared record across all staff</p>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            HRDC Registered
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-emerald-600">{hrdcCount}</span>
            <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Eligible for HRDC claimable training</p>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Added This Month
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-blue-600">{thisMonthCount}</span>
            <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
              <CalendarPlus className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">New client acquisitions this month</p>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Industries Covered
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-amber-600">{industryCount}</span>
            <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
              <Briefcase className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Distinct industry sectors served</p>
        </div>
      </div>

      {/* Control Panel */}
      <div className="bg-slate-900 border border-slate-800 text-white rounded-xl p-4 space-y-4 shadow-lg">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div>
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 font-display">
              <Users className="w-4 h-4 text-violet-400" />
              Client Database (Shared CRM)
            </h2>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              One shared list, visible and editable by every rep
            </p>
          </div>

          <button
            onClick={handleOpenAddModal}
            className="bg-violet-600 hover:bg-violet-700 text-white font-extrabold text-[10px] uppercase tracking-wider px-4 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md"
          >
            <Plus className="w-4 h-4" />
            Add New Client
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-800">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search company, contact, phone, email, industry..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500 font-semibold"
            />
          </div>

          <div>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest' | 'az')}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-violet-500 font-bold"
            >
              <option value="newest">Sort: Newest First</option>
              <option value="oldest">Sort: Oldest First</option>
              <option value="az">Sort: Company A-Z</option>
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
                <th className="p-3 whitespace-nowrap min-w-[180px]">Company</th>
                <th className="p-3 whitespace-nowrap">Contact Person</th>
                <th className="p-3 whitespace-nowrap">Phone</th>
                <th className="p-3 whitespace-nowrap">Email</th>
                <th className="p-3 whitespace-nowrap">Industry</th>
                <th className="p-3 text-center">HRDC</th>
                <th className="p-3 whitespace-nowrap">Added By</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans font-medium">
              {filteredClients.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400 italic bg-slate-50/50">
                    {clients.length === 0
                      ? 'No clients yet. Click "Add New Client" to log the first record.'
                      : 'No clients found matching your search.'}
                  </td>
                </tr>
              ) : (
                filteredClients.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-3 font-bold text-slate-900">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
                        {c.companyName}
                      </div>
                      {c.address && (
                        <div className="flex items-start gap-1 mt-1 text-[10px] text-slate-400 font-normal">
                          <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          <span className="line-clamp-1">{c.address}</span>
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        {c.contactName}
                      </div>
                      {c.designation && (
                        <div className="text-[10px] text-slate-400 mt-0.5">{c.designation}</div>
                      )}
                    </td>
                    <td className="p-3">
                      {c.phone ? (
                        <div className="flex items-center gap-1.5 font-mono">
                          <Phone className="w-3.5 h-3.5 text-slate-400" />
                          {c.phone}
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      {c.email ? (
                        <div className="flex items-center gap-1.5 font-mono">
                          <Mail className="w-3.5 h-3.5 text-slate-400" />
                          {c.email}
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      {c.industry || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="p-3 text-center">
                      {c.hrdcRegistered ? (
                        <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-extrabold px-2 py-0.5 rounded font-mono">
                          <ShieldCheck className="w-3 h-3" />
                          YES
                        </span>
                      ) : (
                        <span className="text-[10px] bg-slate-50 text-slate-400 border border-slate-200 font-bold px-2 py-0.5 rounded font-mono">
                          NO
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-[10px] text-slate-400 font-mono whitespace-nowrap">
                      {c.createdByName || '—'}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setView360ClientId(c.id)}
                          className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors cursor-pointer"
                          title="View 360: all activity for this client"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleOpenEditModal(c)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          title="Edit client"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteClient(c.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="Delete client"
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
                <Users className="w-4 h-4 text-violet-600" />
                {editingClientId ? 'Edit Client' : 'Add New Client'}
              </h3>
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveClient} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Company Name *
                  </label>
                  <input
                    type="text"
                    value={formCompanyName}
                    onChange={(e) => setFormCompanyName(e.target.value)}
                    placeholder="e.g. Petronas Digital Sdn Bhd"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-violet-500 text-slate-800"
                    required
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Contact Name *
                  </label>
                  <input
                    type="text"
                    value={formContactName}
                    onChange={(e) => setFormContactName(e.target.value)}
                    placeholder="e.g. Ahmad Razak"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-violet-500 text-slate-800"
                    required
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Designation
                  </label>
                  <input
                    type="text"
                    value={formDesignation}
                    onChange={(e) => setFormDesignation(e.target.value)}
                    placeholder="e.g. Head of Learning"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-violet-500 text-slate-800"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Phone
                  </label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="e.g. +6012-3456789"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-violet-500 text-slate-800"
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
                    placeholder="e.g. contact@company.com"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-violet-500 text-slate-800"
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Address
                  </label>
                  <input
                    type="text"
                    value={formAddress}
                    onChange={(e) => setFormAddress(e.target.value)}
                    placeholder="Company address"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-violet-500 text-slate-800"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Industry
                  </label>
                  <input
                    type="text"
                    value={formIndustry}
                    onChange={(e) => setFormIndustry(e.target.value)}
                    placeholder="e.g. Oil & Gas"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-violet-500 text-slate-800"
                  />
                </div>

                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formHrdc}
                      onChange={(e) => setFormHrdc(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                    />
                    HRDC Registered
                  </label>
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Notes
                  </label>
                  <textarea
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Any additional context about this client..."
                    rows={2}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-violet-500 text-slate-800 resize-none"
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
                  className="flex-1 bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  {editingClientId ? 'Save Changes' : 'Add Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Client 360 View */}
      {view360Client && (() => {
        const records = getClientRecords(view360Client);
        const wonDeals = records.deals.filter((d: any) => d.status === 'Won');
        const totalWonValue = wonDeals.reduce((sum: number, d: any) => sum + (d.proposalValue || 0), 0);
        const totalReceived = records.payments.reduce((sum: number, p: any) => sum + (p.amountReceived || 0), 0);
        const totalOutstanding = records.payments.reduce((sum: number, p: any) => sum + ((p.invoiceAmount || 0) - (p.amountReceived || 0)), 0);

        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl max-w-3xl w-full shadow-2xl border border-slate-150 max-h-[92vh] overflow-y-auto">

              {/* Header */}
              <div className="sticky top-0 bg-white border-b border-slate-150 p-5 flex items-start justify-between z-10">
                <div>
                  <div className="flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-violet-600" />
                    <h2 className="text-lg font-black text-slate-900">{view360Client.companyName}</h2>
                    {view360Client.hrdcRegistered && (
                      <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-extrabold px-2 py-0.5 rounded font-mono">
                        <ShieldCheck className="w-3 h-3" />
                        HRDC
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px] text-slate-500">
                    {view360Client.contactName && view360Client.contactName !== 'N/A' && (
                      <span className="flex items-center gap-1"><User className="w-3 h-3" />{view360Client.contactName}{view360Client.designation ? ` (${view360Client.designation})` : ''}</span>
                    )}
                    {view360Client.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{view360Client.phone}</span>}
                    {view360Client.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{view360Client.email}</span>}
                    {view360Client.industry && <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" />{view360Client.industry}</span>}
                  </div>
                </div>
                <button
                  onClick={() => setView360ClientId(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg transition-colors cursor-pointer flex-shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-6">

                {/* Summary stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-slate-50 border border-slate-150 rounded-xl p-3">
                    <div className="text-[9px] text-slate-400 font-black uppercase tracking-wider font-mono">Won Deals Value</div>
                    <div className="text-lg font-black text-emerald-600 mt-1">RM {totalWonValue.toLocaleString()}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-150 rounded-xl p-3">
                    <div className="text-[9px] text-slate-400 font-black uppercase tracking-wider font-mono">Received</div>
                    <div className="text-lg font-black text-green-600 mt-1">RM {totalReceived.toLocaleString()}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-150 rounded-xl p-3">
                    <div className="text-[9px] text-slate-400 font-black uppercase tracking-wider font-mono">Outstanding</div>
                    <div className="text-lg font-black text-amber-600 mt-1">RM {totalOutstanding.toLocaleString()}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-150 rounded-xl p-3">
                    <div className="text-[9px] text-slate-400 font-black uppercase tracking-wider font-mono">Total Deals</div>
                    <div className="text-lg font-black text-slate-800 mt-1">{records.deals.length}</div>
                  </div>
                </div>

                {/* Pipeline Deals */}
                <div>
                  <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                    Pipeline Deals ({records.deals.length})
                  </h3>
                  {records.deals.length === 0 ? (
                    <p className="text-[11px] text-slate-400 italic">No pipeline deals logged for this client yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {records.deals.map((d: any) => (
                        <div key={d.id} className="flex items-center justify-between bg-white border border-slate-150 rounded-lg px-3 py-2 text-[11px]">
                          <span className="font-bold text-slate-700">{d.courseName || 'Untitled deal'}</span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-slate-500">RM {(d.proposalValue || 0).toLocaleString()}</span>
                            <span className={`px-1.5 py-0.5 rounded font-black text-[9px] uppercase ${
                              d.status === 'Won' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                              d.status === 'Lost' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                              'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}>{d.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quotations */}
                <div>
                  <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                    <FileText className="w-3.5 h-3.5 text-blue-500" />
                    Quotations ({records.quotations.length})
                  </h3>
                  {records.quotations.length === 0 ? (
                    <p className="text-[11px] text-slate-400 italic">No quotations sent to this client yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {records.quotations.map((q: any) => {
                        const itemsTotal = (q.items || []).reduce((sum: number, it: any) => sum + (it.totalFee || 0), 0);
                        const sst = q.applySST ? (itemsTotal * (q.sstRate || 8) / 100) : 0;
                        return (
                          <div key={q.id} className="flex items-center justify-between bg-white border border-slate-150 rounded-lg px-3 py-2 text-[11px]">
                            <span className="font-mono font-bold text-slate-700">{q.refNumber}</span>
                            <span className="font-mono text-slate-500">RM {(itemsTotal + sst).toLocaleString()}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Course Outlines */}
                <div>
                  <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                    <BookOpen className="w-3.5 h-3.5 text-emerald-500" />
                    Course Outlines ({records.outlines.length})
                  </h3>
                  {records.outlines.length === 0 ? (
                    <p className="text-[11px] text-slate-400 italic">No course outlines prepared for this client yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {records.outlines.map((o: any) => (
                        <div key={o.id} className="flex items-center justify-between bg-white border border-slate-150 rounded-lg px-3 py-2 text-[11px]">
                          <span className="font-bold text-slate-700">{o.courseTitle}</span>
                          <span className="font-mono text-slate-400">{o.refNumber}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Admin Records (Jobs) */}
                <div>
                  <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                    <ClipboardList className="w-3.5 h-3.5 text-slate-500" />
                    Confirmed Jobs / Admin Records ({records.adminRecords.length})
                  </h3>
                  {records.adminRecords.length === 0 ? (
                    <p className="text-[11px] text-slate-400 italic">No confirmed jobs logged for this client yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {records.adminRecords.map((r: any) => (
                        <div key={r.id} className="flex items-center justify-between bg-white border border-slate-150 rounded-lg px-3 py-2 text-[11px]">
                          <span className="font-bold text-slate-700">{r.programmeName || 'Untitled programme'}</span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-slate-500">{r.trainingDate}</span>
                            <span className={`px-1.5 py-0.5 rounded font-black text-[9px] uppercase ${
                              r.completed ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-50 text-slate-500 border border-slate-200'
                            }`}>{r.completed ? 'Done' : 'In Progress'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Appointments */}
                <div>
                  <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                    <CalendarClock className="w-3.5 h-3.5 text-amber-500" />
                    Appointments ({records.appointments.length})
                  </h3>
                  {records.appointments.length === 0 ? (
                    <p className="text-[11px] text-slate-400 italic">No appointments logged for this client yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {records.appointments.map((a: any) => (
                        <div key={a.id} className="flex items-center justify-between bg-white border border-slate-150 rounded-lg px-3 py-2 text-[11px]">
                          <span className="font-bold text-slate-700">{a.type} — {a.date} {a.time || ''}</span>
                          <span className={`px-1.5 py-0.5 rounded font-black text-[9px] uppercase ${
                            a.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                            a.status === 'No-Show' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                            'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>{a.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Payments */}
                <div>
                  <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                    <Wallet className="w-3.5 h-3.5 text-green-600" />
                    Payments ({records.payments.length})
                  </h3>
                  {records.payments.length === 0 ? (
                    <p className="text-[11px] text-slate-400 italic">No payments logged for this client yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {records.payments.map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between bg-white border border-slate-150 rounded-lg px-3 py-2 text-[11px]">
                          <span className="font-mono text-slate-500">Invoiced RM {(p.invoiceAmount || 0).toLocaleString()}</span>
                          <span className={`px-1.5 py-0.5 rounded font-black text-[9px] uppercase ${
                            p.status === 'Paid' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                            p.status === 'Overdue' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                            'bg-slate-50 text-slate-500 border border-slate-200'
                          }`}>{p.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
