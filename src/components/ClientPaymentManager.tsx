import React, { useState, useEffect } from 'react';
import { Representative, ClientPayment, Client } from '../types';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query } from 'firebase/firestore';
import {
  Plus, Trash2, Edit3, Search, X, User, DollarSign, Calendar,
  CheckCircle, RotateCcw, Wallet, Save, AlertCircle, FileText
} from 'lucide-react';

interface ClientPaymentManagerProps {
  rep: Representative;
  reps: Representative[];
  requestManagerPermission: (actionToExecute: () => void) => void;
}

const LOCAL_STORAGE_KEY = 'next_client_payments_shared';

const getQuotationTotal = (q: any): number => {
  const itemsTotal = (q.items || []).reduce((sum: number, item: any) => sum + (item.totalFee || 0), 0);
  const sst = q.applySST ? (itemsTotal * (q.sstRate || 8) / 100) : 0;
  return itemsTotal + sst;
};

export default function ClientPaymentManager({ rep, reps, requestManagerPermission }: ClientPaymentManagerProps) {
  // Only Ying and Atiqa can log/edit/delete client payments. Everyone else can
  // view this tab so reps can check whether their own closed deals got paid.
  const isPaymentEditor = rep.id === 'xin-ying' || rep.id === 'atiqa';

  const [payments, setPayments] = useState<ClientPayment[]>(() => {
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
  const [quotationDirectory, setQuotationDirectory] = useState<any[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'Unpaid' | 'Partial' | 'Paid' | 'Overdue'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);
  const [previousPayments, setPreviousPayments] = useState<ClientPayment[] | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);

  // Form fields
  const [formClientName, setFormClientName] = useState('');
  const [formQuotationId, setFormQuotationId] = useState('');
  const [formInvoiceAmount, setFormInvoiceAmount] = useState('');
  const [formAmountReceived, setFormAmountReceived] = useState('0');
  const [formPaymentDate, setFormPaymentDate] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formStatus, setFormStatus] = useState<ClientPayment['status']>('Unpaid');
  const [formNotes, setFormNotes] = useState('');

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Real-time Firestore sync for Client Payments (shared collection, not per-rep)
  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, 'client_payments'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: ClientPayment[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ ...(docSnap.data() as ClientPayment), id: docSnap.id });
      });
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setPayments(list);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list));
    });
    return () => unsubscribe();
  }, []);

  // Read-only live sync of Client Database and Quotations, to power pickers below
  useEffect(() => {
    if (!db) return;
    const unsubClients = onSnapshot(query(collection(db, 'clients')), (snap) => {
      const list: Client[] = [];
      snap.forEach(d => list.push({ ...(d.data() as Client), id: d.id }));
      setClientDirectory(list);
    });
    const unsubQuotations = onSnapshot(query(collection(db, 'quotations')), (snap) => {
      const list: any[] = [];
      snap.forEach(d => list.push({ ...d.data(), id: d.id }));
      setQuotationDirectory(list);
    });
    return () => {
      unsubClients();
      unsubQuotations();
    };
  }, []);

  const matchedClient = clientDirectory.find(
    c => c.companyName.trim().toLowerCase() === formClientName.trim().toLowerCase()
  );

  // Quotations that don't yet have a client payment record logged against them
  const quotationsWithoutPayment = quotationDirectory.filter(
    q => !payments.some(p => p.quotationId === q.id)
  );

  const resetForm = () => {
    setFormClientName('');
    setFormQuotationId('');
    setFormInvoiceAmount('');
    setFormAmountReceived('0');
    setFormPaymentDate('');
    setFormDueDate('');
    setFormStatus('Unpaid');
    setFormNotes('');
    setEditingPaymentId(null);
  };

  const handleOpenAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const handleOpenEditModal = (p: ClientPayment) => {
    setEditingPaymentId(p.id);
    setFormClientName(p.clientName || '');
    setFormQuotationId(p.quotationId || '');
    setFormInvoiceAmount(String(p.invoiceAmount || ''));
    setFormAmountReceived(String(p.amountReceived || 0));
    setFormPaymentDate(p.paymentDate || '');
    setFormDueDate(p.dueDate || '');
    setFormStatus(p.status || 'Unpaid');
    setFormNotes(p.notes || '');
    setShowModal(true);
  };

  // Selecting a quotation auto-fills client name and invoice amount from its grand total
  const handleSelectQuotation = (quotationId: string) => {
    setFormQuotationId(quotationId);
    const q = quotationDirectory.find(qq => qq.id === quotationId);
    if (q) {
      setFormClientName(q.company || '');
      setFormInvoiceAmount(String(getQuotationTotal(q).toFixed(2)));
    }
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

  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPaymentEditor) {
      showToast('Only Ying and Atiqa can log client payments.', 'error');
      return;
    }
    if (!formClientName.trim() || !formInvoiceAmount.trim()) {
      showToast('Client name and invoice amount are required.', 'error');
      return;
    }

    const selectedQuote = quotationDirectory.find(q => q.id === formQuotationId);
    let newPayment: ClientPayment;

    const base = {
      clientName: formClientName.trim(),
      clientId: matchedClient ? matchedClient.id : '',
      quotationId: formQuotationId || '',
      quotationRef: selectedQuote?.refNumber || '',
      pipelineId: selectedQuote?.pipelineId || '',
      invoiceAmount: parseFloat(formInvoiceAmount) || 0,
      amountReceived: parseFloat(formAmountReceived) || 0,
      paymentDate: formPaymentDate,
      dueDate: formDueDate,
      status: formStatus,
      notes: formNotes.trim(),
    };

    if (editingPaymentId) {
      newPayment = { ...base, id: editingPaymentId } as ClientPayment;
      const updated = payments.map(p => p.id === editingPaymentId ? newPayment : p);
      setPayments(updated);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      showToast('Payment record updated.', 'success');
    } else {
      newPayment = {
        ...base,
        id: `pay_${Date.now()}`,
        createdAt: Date.now(),
        createdBy: rep.id,
        createdByName: rep.name,
      } as ClientPayment;
      const updated = [newPayment, ...payments];
      setPayments(updated);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      showToast('Payment record logged.', 'success');
    }

    try {
      if (db) await setDoc(doc(db, 'client_payments', newPayment.id), newPayment);
    } catch (err) {
      console.error('Firestore save client payment failed:', err);
    }

    setShowModal(false);
    resetForm();
  };

  const handleDeletePayment = (id: string) => {
    if (!isPaymentEditor) {
      showToast('Only Ying and Atiqa can delete client payments.', 'error');
      return;
    }
    requestManagerPermission(async () => {
      setPreviousPayments(JSON.parse(JSON.stringify(payments)));
      setUndoMessage('Payment record deleted.');
      const remaining = payments.filter(p => p.id !== id);
      setPayments(remaining);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(remaining));
      showToast('Payment record deleted.', 'success');
      try {
        if (db) await deleteDoc(doc(db, 'client_payments', id));
      } catch (err) {
        console.error('Firestore delete client payment failed:', err);
      }
    });
  };

  const handleUndoChange = async () => {
    if (previousPayments) {
      setPayments(previousPayments);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(previousPayments));
      showToast('Action reverted.', 'success');
      try {
        if (db) {
          for (const p of previousPayments) {
            await setDoc(doc(db, 'client_payments', p.id), p);
          }
        }
      } catch (err) {
        console.error('Firestore undo failed:', err);
      }
      setPreviousPayments(null);
      setUndoMessage(null);
    }
  };

  const filteredPayments = payments
    .filter(p => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        (p.clientName || '').toLowerCase().includes(q) ||
        (p.quotationRef || '').toLowerCase().includes(q) ||
        (p.notes || '').toLowerCase().includes(q);
      const matchesStatus = filterStatus === 'all' || p.status === filterStatus;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => sortOrder === 'newest' ? (b.createdAt || 0) - (a.createdAt || 0) : (a.createdAt || 0) - (b.createdAt || 0));

  const totalInvoiced = payments.reduce((sum, p) => sum + (p.invoiceAmount || 0), 0);
  const totalReceived = payments.reduce((sum, p) => sum + (p.amountReceived || 0), 0);
  const totalOutstanding = totalInvoiced - totalReceived;
  const overdueCount = payments.filter(p => p.status === 'Overdue').length;

  return (
    <div className="space-y-6">

      {toast && (
        <div className={`fixed top-4 right-4 p-4 rounded-xl shadow-2xl flex items-center gap-2 z-50 text-xs font-black transition-all transform animate-slide-in ${
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        }`}>
          <CheckCircle className="w-4 h-4" />
          <span>{toast.message}</span>
        </div>
      )}

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

      {!isPaymentEditor && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Client payments can only be logged or edited by Ying and Atiqa. You can view payment status for your deals here.
          </span>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Total Invoiced
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-black text-slate-900">RM {totalInvoiced.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
              <FileText className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Across all logged client payments</p>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Total Received
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-black text-emerald-600">RM {totalReceived.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
              <CheckCircle className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Cash confirmed in hand</p>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Outstanding
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-black text-amber-600">RM {totalOutstanding.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Still to be collected</p>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Overdue
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-black text-rose-600">{overdueCount}</span>
            <div className="p-1.5 bg-rose-50 text-rose-600 rounded-lg">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Payments past due date</p>
        </div>
      </div>

      {/* Control Panel */}
      <div className="bg-slate-900 border border-slate-800 text-white rounded-xl p-4 space-y-4 shadow-lg">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div>
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 font-display">
              <Wallet className="w-4 h-4 text-green-400" />
              Client Payments (Money Received)
            </h2>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              Not the same as "Raise Payment" — that's staff expense claims. This tracks money coming IN from clients.
            </p>
          </div>

          {isPaymentEditor && (
            <div className="flex items-center gap-2 w-full md:w-auto">
              {quotationsWithoutPayment.length > 0 && (
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      handleSelectQuotation(e.target.value);
                      setShowModal(true);
                      e.target.value = '';
                    }
                  }}
                  className="flex-1 md:flex-none bg-blue-900/40 hover:bg-blue-900/60 text-blue-200 font-bold text-[10px] uppercase tracking-wider px-3.5 py-2 rounded-lg border border-blue-700 transition-all cursor-pointer"
                  title="Create a payment record pre-filled from a quotation"
                >
                  <option value="" disabled>+ From Quotation</option>
                  {quotationsWithoutPayment.map(q => (
                    <option key={q.id} value={q.id}>
                      {q.company} — {q.refNumber}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={handleOpenAddModal}
                className="flex-1 md:flex-none bg-green-600 hover:bg-green-700 text-white font-extrabold text-[10px] uppercase tracking-wider px-4 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md"
              >
                <Plus className="w-4 h-4" />
                Log Payment
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-800">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search client, quotation ref, notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-green-500 font-semibold"
            />
          </div>
          <div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-green-500 font-bold"
            >
              <option value="all">All Statuses</option>
              <option value="Unpaid">Unpaid</option>
              <option value="Partial">Partial</option>
              <option value="Paid">Paid</option>
              <option value="Overdue">Overdue</option>
            </select>
          </div>
          <div>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-green-500 font-bold"
            >
              <option value="newest">Sort: Newest First</option>
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
                <th className="p-3 whitespace-nowrap min-w-[160px]">Client</th>
                <th className="p-3 whitespace-nowrap">Quotation Ref</th>
                <th className="p-3 text-right whitespace-nowrap">Invoiced</th>
                <th className="p-3 text-right whitespace-nowrap">Received</th>
                <th className="p-3 text-right whitespace-nowrap">Balance</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans font-medium">
              {filteredPayments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400 italic bg-slate-50/50">
                    {payments.length === 0
                      ? (isPaymentEditor ? 'No payments logged yet. Click "Log Payment" to add the first one.' : 'No payment records yet.')
                      : 'No payments found matching your search/filter.'}
                  </td>
                </tr>
              ) : (
                filteredPayments.map(p => {
                  const balance = (p.invoiceAmount || 0) - (p.amountReceived || 0);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-3 font-bold text-slate-900">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                          {p.clientName}
                        </div>
                      </td>
                      <td className="p-3 font-mono text-[10px] text-slate-500">{p.quotationRef || '—'}</td>
                      <td className="p-3 text-right font-mono font-bold text-slate-800">
                        RM {(p.invoiceAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-emerald-600">
                        RM {(p.amountReceived || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-amber-600">
                        RM {balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-black text-[9px] uppercase tracking-wider border ${
                          p.status === 'Paid' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                          p.status === 'Partial' ? 'bg-blue-50 border-blue-200 text-blue-700' :
                          p.status === 'Overdue' ? 'bg-rose-50 border-rose-200 text-rose-700' :
                          'bg-slate-50 border-slate-200 text-slate-500'
                        }`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {isPaymentEditor ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleOpenEditModal(p)}
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                              title="Edit payment"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeletePayment(p.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              title="Delete payment"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-300 text-[10px]" title="Only Ying and Atiqa can edit">🔒</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {showModal && isPaymentEditor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-slate-150 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Wallet className="w-4 h-4 text-green-600" />
                {editingPaymentId ? 'Edit Payment' : 'Log Client Payment'}
              </h3>
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePayment} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Link to Quotation (Optional)
                  </label>
                  <select
                    value={formQuotationId}
                    onChange={(e) => e.target.value ? handleSelectQuotation(e.target.value) : setFormQuotationId('')}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-green-500 text-slate-800"
                  >
                    <option value="">No quotation link</option>
                    {quotationDirectory.map(q => (
                      <option key={q.id} value={q.id}>{q.company} — {q.refNumber}</option>
                    ))}
                  </select>
                </div>

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
                    list="payment-client-suggestions"
                    value={formClientName}
                    onChange={(e) => setFormClientName(e.target.value)}
                    placeholder="Search existing client, or type a new one"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-green-500 text-slate-800"
                    required
                  />
                  <datalist id="payment-client-suggestions">
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

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Invoice Amount (RM) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formInvoiceAmount}
                    onChange={(e) => setFormInvoiceAmount(e.target.value)}
                    placeholder="e.g. 5184.00"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-green-500 text-slate-800 font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Amount Received (RM)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formAmountReceived}
                    onChange={(e) => setFormAmountReceived(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-green-500 text-slate-800 font-mono"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Payment Date
                  </label>
                  <input
                    type="date"
                    value={formPaymentDate}
                    onChange={(e) => setFormPaymentDate(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-green-500 text-slate-800"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={formDueDate}
                    onChange={(e) => setFormDueDate(e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-green-500 text-slate-800"
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Status
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as ClientPayment['status'])}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-green-500 text-slate-800"
                  >
                    <option value="Unpaid">Unpaid</option>
                    <option value="Partial">Partial</option>
                    <option value="Paid">Paid</option>
                    <option value="Overdue">Overdue</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Notes
                  </label>
                  <textarea
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Payment method, reference number, reminders sent..."
                    rows={2}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-green-500 text-slate-800 resize-none"
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
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold text-xs py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  {editingPaymentId ? 'Save Changes' : 'Log Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
