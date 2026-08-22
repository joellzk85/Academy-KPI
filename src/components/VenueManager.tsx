import React, { useState, useEffect } from 'react';
import { Representative, Venue } from '../types';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query } from 'firebase/firestore';
import {
  Plus, Trash2, Edit3, Search, X, MapPin, Phone,
  DollarSign, CheckCircle, RotateCcw, Building, Save, Image as ImageIcon
} from 'lucide-react';

interface VenueManagerProps {
  rep: Representative;
  reps: Representative[];
  requestManagerPermission: (actionToExecute: () => void) => void;
}

const LOCAL_STORAGE_KEY = 'next_venues_shared';

export default function VenueManager({ rep, reps, requestManagerPermission }: VenueManagerProps) {
  const [venues, setVenues] = useState<Venue[]>(() => {
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
  const [filterStatus, setFilterStatus] = useState<'all' | 'Available' | 'Booked' | 'Under Renovation'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'az'>('newest');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);
  const [previousVenues, setPreviousVenues] = useState<Venue[] | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingVenueId, setEditingVenueId] = useState<string | null>(null);

  // Form fields
  const [formName, setFormName] = useState('');
  const [formDistance, setFormDistance] = useState('');
  const [formMeetingPackagePrice, setFormMeetingPackagePrice] = useState('');
  const [formRoomPackagePrice, setFormRoomPackagePrice] = useState('');
  const [formDinnerPackage, setFormDinnerPackage] = useState('');
  const [formFacilities, setFormFacilities] = useState('');
  const [formContact, setFormContact] = useState('');
  const [formRemarks, setFormRemarks] = useState('');
  const [formPictures, setFormPictures] = useState('');
  const [formStatus, setFormStatus] = useState<'Available' | 'Booked' | 'Under Renovation'>('Available');

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Real-time Firestore sync for Venues (shared collection, not per-rep)
  useEffect(() => {
    if (!db) return;

    const q = query(collection(db, 'venues_directory'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const firestoreVenues: Venue[] = [];
      snapshot.forEach((docSnap) => {
        firestoreVenues.push({ ...(docSnap.data() as Venue), id: docSnap.id });
      });

      firestoreVenues.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setVenues(firestoreVenues);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(firestoreVenues));
    });

    return () => unsubscribe();
  }, []);

  const resetForm = () => {
    setFormName('');
    setFormDistance('');
    setFormMeetingPackagePrice('');
    setFormRoomPackagePrice('');
    setFormDinnerPackage('');
    setFormFacilities('');
    setFormContact('');
    setFormRemarks('');
    setFormPictures('');
    setFormStatus('Available');
    setEditingVenueId(null);
  };

  const handleOpenAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const handleOpenEditModal = (venue: Venue) => {
    setEditingVenueId(venue.id);
    setFormName(venue.name || '');
    setFormDistance(venue.distance || '');
    setFormMeetingPackagePrice(venue.meetingPackagePrice || '');
    setFormRoomPackagePrice(venue.roomPackagePrice || '');
    setFormDinnerPackage(venue.dinnerPackage || '');
    setFormFacilities(venue.facilities || '');
    setFormContact(venue.contact || '');
    setFormRemarks(venue.remarks || '');
    setFormPictures(venue.pictures || '');
    setFormStatus(venue.status || 'Available');
    setShowModal(true);
  };

  const handleSaveVenue = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formName.trim()) {
      showToast('Venue name is required.', 'error');
      return;
    }

    let newVenue: Venue;

    if (editingVenueId) {
      const existing = venues.find(v => v.id === editingVenueId);
      newVenue = {
        ...existing,
        id: editingVenueId,
        name: formName.trim(),
        distance: formDistance.trim(),
        meetingPackagePrice: formMeetingPackagePrice.trim(),
        roomPackagePrice: formRoomPackagePrice.trim(),
        dinnerPackage: formDinnerPackage.trim(),
        facilities: formFacilities.trim(),
        contact: formContact.trim(),
        remarks: formRemarks.trim(),
        pictures: formPictures.trim(),
        status: formStatus,
      } as Venue;

      const updated = venues.map(v => v.id === editingVenueId ? newVenue : v);
      setVenues(updated);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      showToast('Venue updated.', 'success');
    } else {
      newVenue = {
        id: `venue_${Date.now()}`,
        name: formName.trim(),
        distance: formDistance.trim(),
        meetingPackagePrice: formMeetingPackagePrice.trim(),
        roomPackagePrice: formRoomPackagePrice.trim(),
        dinnerPackage: formDinnerPackage.trim(),
        facilities: formFacilities.trim(),
        contact: formContact.trim(),
        remarks: formRemarks.trim(),
        pictures: formPictures.trim(),
        status: formStatus,
        createdAt: Date.now(),
        createdBy: rep.id,
        createdByName: rep.name,
      };

      const updated = [newVenue, ...venues];
      setVenues(updated);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      showToast('Venue added.', 'success');
    }

    try {
      if (db) {
        await setDoc(doc(db, 'venues_directory', newVenue.id), newVenue);
      }
    } catch (err) {
      console.error('Firestore save venue failed:', err);
    }

    setShowModal(false);
    resetForm();
  };

  const handleDeleteVenue = (id: string) => {
    requestManagerPermission(async () => {
      setPreviousVenues(JSON.parse(JSON.stringify(venues)));
      setUndoMessage('Venue record deleted.');
      const remaining = venues.filter(v => v.id !== id);
      setVenues(remaining);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(remaining));
      showToast('Venue deleted.', 'success');

      try {
        if (db) {
          await deleteDoc(doc(db, 'venues_directory', id));
        }
      } catch (err) {
        console.error('Firestore delete venue failed:', err);
      }
    });
  };

  const handleUndoChange = async () => {
    if (previousVenues) {
      setVenues(previousVenues);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(previousVenues));
      showToast('Action reverted.', 'success');
      try {
        if (db) {
          for (const v of previousVenues) {
            await setDoc(doc(db, 'venues_directory', v.id), v);
          }
        }
      } catch (err) {
        console.error('Firestore undo failed:', err);
      }
      setPreviousVenues(null);
      setUndoMessage(null);
    }
  };

  const filteredVenues = venues
    .filter(v => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        (v.name || '').toLowerCase().includes(q) ||
        (v.facilities || '').toLowerCase().includes(q) ||
        (v.contact || '').toLowerCase().includes(q);
      const matchesStatus = filterStatus === 'all' || v.status === filterStatus;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      if (sortOrder === 'az') return (a.name || '').localeCompare(b.name || '');
      if (sortOrder === 'oldest') return (a.createdAt || 0) - (b.createdAt || 0);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

  const totalVenues = venues.length;
  const availableCount = venues.filter(v => v.status === 'Available').length;
  const bookedCount = venues.filter(v => v.status === 'Booked').length;
  const renovationCount = venues.filter(v => v.status === 'Under Renovation').length;

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
            Total Venues
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900">{totalVenues}</span>
            <div className="p-1.5 bg-teal-50 text-teal-600 rounded-lg">
              <Building className="w-4 h-4" />
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
          <p className="text-[10px] text-slate-500">Ready to be booked for a job</p>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Currently Booked
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-amber-600">{bookedCount}</span>
            <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
              <MapPin className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Reserved for an upcoming training</p>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-2xs space-y-2">
          <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block font-mono">
            Under Renovation
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-rose-600">{renovationCount}</span>
            <div className="p-1.5 bg-rose-50 text-rose-600 rounded-lg">
              <Building className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[10px] text-slate-500">Temporarily unavailable</p>
        </div>
      </div>

      {/* Control Panel */}
      <div className="bg-slate-900 border border-slate-800 text-white rounded-xl p-4 space-y-4 shadow-lg">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div>
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 font-display">
              <Building className="w-4 h-4 text-teal-400" />
              Venue Database (Shared Directory)
            </h2>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              One shared list, visible and editable by every rep
            </p>
          </div>

          <button
            onClick={handleOpenAddModal}
            className="bg-teal-600 hover:bg-teal-700 text-white font-extrabold text-[10px] uppercase tracking-wider px-4 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md"
          >
            <Plus className="w-4 h-4" />
            Add New Venue
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-800">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search name, facilities, contact..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-teal-500 font-semibold"
            />
          </div>

          <div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-teal-500 font-bold"
            >
              <option value="all">All Statuses</option>
              <option value="Available">Available</option>
              <option value="Booked">Booked</option>
              <option value="Under Renovation">Under Renovation</option>
            </select>
          </div>

          <div>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest' | 'az')}
              className="w-full text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-teal-500 font-bold"
            >
              <option value="newest">Sort: Newest First</option>
              <option value="oldest">Sort: Oldest First</option>
              <option value="az">Sort: Name A-Z</option>
            </select>
          </div>
        </div>
      </div>

      {/* Venue Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredVenues.length === 0 ? (
          <div className="md:col-span-2 p-8 text-center text-slate-400 italic bg-white border border-slate-200 rounded-xl">
            {venues.length === 0
              ? 'No venues yet. Click "Add New Venue" to log the first record.'
              : 'No venues found matching your search/filter.'}
          </div>
        ) : (
          filteredVenues.map(v => (
            <div key={v.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              {v.pictures ? (
                <div className="w-full h-36 bg-slate-100 overflow-hidden">
                  <img src={v.pictures} alt={v.name} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-full h-36 bg-slate-100 flex items-center justify-center text-slate-300">
                  <ImageIcon className="w-8 h-8" />
                </div>
              )}
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-black text-slate-900">{v.name}</h4>
                    {v.distance && (
                      <p className="text-[10px] text-slate-400 font-mono flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3" />
                        {v.distance}
                      </p>
                    )}
                  </div>
                  {v.status === 'Available' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 font-black text-[9px] uppercase tracking-wider flex-shrink-0">
                      Available
                    </span>
                  ) : v.status === 'Booked' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 font-black text-[9px] uppercase tracking-wider flex-shrink-0">
                      Booked
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-700 font-black text-[9px] uppercase tracking-wider flex-shrink-0">
                      Renovation
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  <div className="bg-slate-50 rounded-lg p-2">
                    <div className="text-slate-400 font-black uppercase tracking-wider">Meeting</div>
                    <div className="font-bold text-slate-700 mt-0.5">{v.meetingPackagePrice || '—'}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2">
                    <div className="text-slate-400 font-black uppercase tracking-wider">Room</div>
                    <div className="font-bold text-slate-700 mt-0.5">{v.roomPackagePrice || '—'}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2">
                    <div className="text-slate-400 font-black uppercase tracking-wider">Dinner</div>
                    <div className="font-bold text-slate-700 mt-0.5">{v.dinnerPackage || '—'}</div>
                  </div>
                </div>

                {v.facilities && (
                  <p className="text-[10px] text-slate-500">
                    <span className="font-bold text-slate-600">Facilities: </span>
                    {v.facilities}
                  </p>
                )}

                {v.contact && (
                  <p className="text-[10px] text-slate-500 flex items-center gap-1">
                    <Phone className="w-3 h-3 text-slate-400" />
                    {v.contact}
                  </p>
                )}

                {v.remarks && (
                  <p className="text-[10px] text-slate-400 italic">{v.remarks}</p>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <span className="text-[10px] text-slate-400 font-mono">
                    Added by {v.createdByName || '—'}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleOpenEditModal(v)}
                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                      title="Edit venue"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteVenue(v.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      title="Delete venue"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-slate-150 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Building className="w-4 h-4 text-teal-600" />
                {editingVenueId ? 'Edit Venue' : 'Add New Venue'}
              </h3>
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveVenue} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Venue Name *
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Happi Village, Janda Baik"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-teal-500 text-slate-800"
                    required
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Distance from HQ
                  </label>
                  <input
                    type="text"
                    value={formDistance}
                    onChange={(e) => setFormDistance(e.target.value)}
                    placeholder="e.g. 45 km from HQ"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-teal-500 text-slate-800"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Status
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as 'Available' | 'Booked' | 'Under Renovation')}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-teal-500 text-slate-800"
                  >
                    <option value="Available">Available</option>
                    <option value="Booked">Booked</option>
                    <option value="Under Renovation">Under Renovation</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Meeting Package Price
                  </label>
                  <input
                    type="text"
                    value={formMeetingPackagePrice}
                    onChange={(e) => setFormMeetingPackagePrice(e.target.value)}
                    placeholder="e.g. RM 150/pax/day"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-teal-500 text-slate-800"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Room Package Price
                  </label>
                  <input
                    type="text"
                    value={formRoomPackagePrice}
                    onChange={(e) => setFormRoomPackagePrice(e.target.value)}
                    placeholder="e.g. RM 280/pax"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-teal-500 text-slate-800"
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Dinner Package
                  </label>
                  <input
                    type="text"
                    value={formDinnerPackage}
                    onChange={(e) => setFormDinnerPackage(e.target.value)}
                    placeholder="e.g. RM 120/pax (BBQ Buffet)"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-teal-500 text-slate-800"
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Facilities
                  </label>
                  <input
                    type="text"
                    value={formFacilities}
                    onChange={(e) => setFormFacilities(e.target.value)}
                    placeholder="e.g. WiFi, Projector, Sound System"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-teal-500 text-slate-800"
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Contact
                  </label>
                  <input
                    type="text"
                    value={formContact}
                    onChange={(e) => setFormContact(e.target.value)}
                    placeholder="e.g. Ms. Wong (+6019-2223344)"
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-teal-500 text-slate-800"
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Picture URL
                  </label>
                  <input
                    type="text"
                    value={formPictures}
                    onChange={(e) => setFormPictures(e.target.value)}
                    placeholder="https://..."
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-teal-500 text-slate-800"
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    Remarks
                  </label>
                  <textarea
                    value={formRemarks}
                    onChange={(e) => setFormRemarks(e.target.value)}
                    placeholder="Any additional context about this venue..."
                    rows={2}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-teal-500 text-slate-800 resize-none"
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
                  className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  {editingVenueId ? 'Save Changes' : 'Add Venue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
