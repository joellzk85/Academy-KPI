// Management can delete a client, trainer, venue or programme even while it's in use (Joel, 2026-10-20:
// "managers can delete anything at any time"). Before the record goes, its name (and the other details the
// documents read live from it) is copied onto every deal, quotation, course outline, teambuilding proposal and
// admin checklist that uses it, as typed text, so nothing goes blank. Then the record is deleted (can't be undone).
// Reads every list fresh (deleted and old unlinked records included), so nothing is missed.
import { collection, deleteDoc, doc, DocumentReference, getDocs, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { dealContact } from './contacts';
import { venuePhotos } from './teambuilding';

type Viewer = { id: string; name: string; role: string };
type Update = { ref: DocumentReference; data: Record<string, any> };

const all = async (name: string) => (await getDocs(collection(db, name))).docs.map(d => ({ ...(d.data() as any), id: d.id, _ref: d.ref }));
const historyEntry = (viewer: Viewer, action: string) => ({ at: new Date().toISOString(), byId: viewer.id, byName: viewer.name, action });
const addHistory = (deal: any, viewer: Viewer, text: string) => [...(deal.history || []), historyEntry(viewer, text)];

// Up to 450 writes per batch (Firestore allows 500); the record itself is deleted last.
async function commitThenDelete(updates: Update[], target: DocumentReference): Promise<void> {
  for (let i = 0; i < updates.length; i += 450) {
    const batch = writeBatch(db);
    updates.slice(i, i + 450).forEach(u => batch.update(u.ref, u.data));
    await batch.commit();
  }
  await deleteDoc(target);
}

export async function deleteClientEverywhere(c: any, viewer: Viewer): Promise<number> {
  const [deals, quotes, tbs] = await Promise.all([all('pipelines'), all('quotations'), all('teambuilding_proposals')]);
  const name = c.companyName || '';
  const ups: Update[] = [];
  const dealIds = new Set<string>();
  deals.filter(d => d.clientId === c.id).forEach(d => {
    dealIds.add(d.id);
    ups.push({ ref: d._ref, data: {
      clientId: '', client: d.client || name, contactId: '', contactName: dealContact(d, c)?.name || d.contactName || '',
      history: addHistory(d, viewer, `Client ${name} deleted from the client list; its name is kept on this deal`),
    } });
  });
  quotes.filter(q => q.clientId === c.id || (q.pipelineId && dealIds.has(q.pipelineId))).forEach(q => {
    const employer = (c.employerName || '').trim();
    const company = q.addressTo === 'employer' && employer ? employer : name;
    ups.push({ ref: q._ref, data: {
      clientId: '', company: q.status === 'sent' ? q.company || company : company,
      address: q.address || c.address || '', attn: q.attn || q.attnOverride || dealContact(deals.find(d => d.id === q.pipelineId), c)?.name || '',
    } });
  });
  tbs.filter(t => t.clientId === c.id || (t.pipelineId && dealIds.has(t.pipelineId))).forEach(t => {
    ups.push({ ref: t._ref, data: { preparedForCompany: t.preparedForCompany || name } });
  });
  await commitThenDelete(ups, doc(db, 'clients', c.id));
  return ups.length;
}

export async function deleteTrainerEverywhere(t: any): Promise<number> {
  const [quotes, checklists, outlines, tbs] = await Promise.all([all('quotations'), all('deal_checklists'), all('course_outlines'), all('teambuilding_proposals')]);
  const name = t.name || '';
  const ups: Update[] = [];
  quotes.filter(q => (q.items || []).some((it: any) => it.trainerId === t.id)).forEach(q => {
    ups.push({ ref: q._ref, data: { items: q.items.map((it: any) => it.trainerId === t.id ? { ...it, trainerId: '', trainer: it.trainer || name } : it) } });
  });
  checklists.filter(c => (c.tasks || []).some((x: any) => x.trainerId === t.id)).forEach(c => {
    ups.push({ ref: c._ref, data: { tasks: c.tasks.map((x: any) => x.trainerId === t.id ? { ...x, trainerId: '', trainerName: x.trainerName || name } : x) } });
  });
  outlines.filter(o => o.trainerId === t.id).forEach(o => ups.push({ ref: o._ref, data: { trainerId: '' } }));
  tbs.filter(p => (p.trainers || []).some((x: any) => x.trainerId === t.id)).forEach(p => {
    ups.push({ ref: p._ref, data: { trainers: p.trainers.map((x: any) => x.trainerId === t.id
      ? { ...x, trainerId: '', name: x.name || name, photo: x.photo || t.photoUrl || '', bio: x.bio !== undefined ? x.bio : t.bio || '' } : x) } });
  });
  await commitThenDelete(ups, doc(db, 'trainers_directory', t.id));
  return ups.length;
}

export async function deleteVenueEverywhere(v: any): Promise<number> {
  const [quotes, checklists, tbs] = await Promise.all([all('quotations'), all('deal_checklists'), all('teambuilding_proposals')]);
  const name = v.name || '';
  const ups: Update[] = [];
  quotes.filter(q => q.venueId === v.id).forEach(q => ups.push({ ref: q._ref, data: { venueId: '', venue: q.venue || name } }));
  checklists.filter(c => (c.tasks || []).some((x: any) => x.venueId === v.id)).forEach(c => {
    ups.push({ ref: c._ref, data: { tasks: c.tasks.map((x: any) => x.venueId === v.id ? { ...x, venueId: '', venueName: x.venueName || name } : x) } });
  });
  tbs.filter(p => (p.venues || []).some((x: any) => x.venueId === v.id)).forEach(p => {
    ups.push({ ref: p._ref, data: { venues: p.venues.map((x: any) => x.venueId === v.id
      ? { ...x, venueId: '', name: x.name || name, photos: (x.photos || []).length ? x.photos : venuePhotos(v) } : x) } });
  });
  await commitThenDelete(ups, doc(db, 'venues_directory', v.id));
  return ups.length;
}

export async function deleteProgrammeEverywhere(p: any, viewer: Viewer): Promise<number> {
  const [deals, quotes, outlines, trainers] = await Promise.all([all('pipelines'), all('quotations'), all('course_outlines'), all('trainers_directory')]);
  const name = p.name || '';
  const ups: Update[] = [];
  deals.filter(d => d.programmeId === p.id).forEach(d => ups.push({ ref: d._ref, data: {
    programmeId: '', courseName: d.courseName || name,
    history: addHistory(d, viewer, `Programme ${name} deleted from the programme list; its name is kept on this deal`),
  } }));
  quotes.filter(q => (q.items || []).some((it: any) => it.programmeId === p.id)).forEach(q => {
    ups.push({ ref: q._ref, data: { items: q.items.map((it: any) => it.programmeId === p.id
      ? { ...it, programmeId: '', program: it.program || name, code: it.code || p.hrdcCode || '' } : it) } });
  });
  // Outlines that follow the programme's name (their own programme, or their deal's) keep it as typed.
  const dealProg = new Map(deals.map(d => [d.id, d.programmeId]));
  outlines.filter(o => o.programmeId === p.id || (!o.programmeId && o.pipelineId && dealProg.get(o.pipelineId) === p.id)).forEach(o => {
    ups.push({ ref: o._ref, data: { programmeId: '', useProgrammeName: false, courseTitle: o.useProgrammeName ? name : o.courseTitle || name } });
  });
  trainers.filter(t => (t.programmeIds || []).includes(p.id)).forEach(t => {
    ups.push({ ref: t._ref, data: { programmeIds: t.programmeIds.filter((x: string) => x !== p.id) } });
  });
  await commitThenDelete(ups, doc(db, 'programmes', p.id));
  return ups.length;
}
