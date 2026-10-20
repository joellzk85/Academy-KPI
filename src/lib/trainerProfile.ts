// More trainer details (Joel, 2026-10-20): gender, address, emergency contact, languages, type of training
// (Team building / Soft skills), other certificates, LinkedIn / YouTube / other social media, several topics,
// and four uploads (Accredited TTT form, biodata, trainer profile, professional photo). Nothing is compulsory;
// the trainer's form encourages them to fill in as much as possible (profileGaps).
// Used by the trainer's link page (TrainerLinkPage.tsx), the server (serverTrainerLinks.ts) and Trainers.
// Pure, so it can be tested.
//
// Files:
// - From the trainer's link: Firebase Storage trainer_uploads/{token}/{kind}_{time}_{name}. No login: storage.rules
//   lets anyone holding a live profile link upload there (the 32-character token is the key).
// - From the team (Trainers → Edit): trainer_files/{trainerId}/{kind}_{time}_{name}.
// - The trainer record keeps one file per kind in `docs` (the latest); older files stay in storage.
// - The photo is the trainer's photoUrl (also shown on teambuilding proposals).

export type Gender = '' | 'Male' | 'Female';
export const GENDERS: Gender[] = ['Male', 'Female'];

export const LANGUAGES = ['English', 'Chinese', 'Bahasa Malaysia'] as const;

export type TrainingType = 'teambuilding' | 'softskills';
export const TRAINING_TYPES: { id: TrainingType; label: string }[] = [
  { id: 'teambuilding', label: 'Team building' },
  { id: 'softskills', label: 'Soft skills' },
];
export const trainingTypeLabel = (id: string) => TRAINING_TYPES.find(t => t.id === id)?.label || id;

export type DocKind = 'ttt' | 'biodata' | 'profile';
export const DOC_KINDS: { id: DocKind; label: string; hint: string }[] = [
  { id: 'ttt', label: 'Accredited TTT form', hint: 'Your HRD Corp Train the Trainer certificate or form' },
  { id: 'biodata', label: 'Biodata', hint: 'Your trainer biodata' },
  { id: 'profile', label: 'Trainer profile', hint: 'Your full trainer profile or CV' },
];

export interface TrainerFile {
  name: string;
  size: number;
  type: string;
  path: string;
  url: string;
  at: number;
  byName: string;
}

export interface EmergencyContact { name: string; relationship: string; phone: string }

// HRDC's "Standard trainer biodata" (Joel, 2026-10-20): four lists, each with "Add another".
// The IC / passport number is NOT here: it's kept apart, for Admin and Management only (trainer_private).
export type BioRow = Record<string, string>;
export type BioListKey = 'academic' | 'professional' | 'career' | 'trainingExp';
export const BIO_LISTS: { key: BioListKey; title: string; add: string; cols: { k: string; label: string; ph?: string; year?: boolean }[] }[] = [
  { key: 'academic', title: 'Academic qualification', add: 'Add another qualification', cols: [
    { k: 'qualification', label: 'Qualification', ph: 'e.g. Bachelor of Business Administration' },
    { k: 'institute', label: 'Name of academic institute', ph: 'e.g. Universiti Malaya' },
    { k: 'year', label: 'Year awarded', year: true },
    { k: 'otherInstitute', label: 'Other academic institute' },
  ] },
  { key: 'professional', title: 'Professional qualification', add: 'Add another certification', cols: [
    { k: 'certification', label: 'Professional certification', ph: 'e.g. Certified NLP Practitioner' },
    { k: 'body', label: 'Certification body' },
    { k: 'year', label: 'Year awarded', year: true },
  ] },
  { key: 'career', title: 'Career experience', add: 'Add another job', cols: [
    { k: 'company', label: 'Previous company' },
    { k: 'position', label: 'Position' },
    { k: 'from', label: 'Year from', year: true },
    { k: 'to', label: 'Year to', year: true, ph: 'e.g. 2020 or Present' },
  ] },
  { key: 'trainingExp', title: 'Training experience', add: 'Add another programme', cols: [
    { k: 'programme', label: 'Training programme conducted' },
    { k: 'from', label: 'Year from', year: true },
    { k: 'to', label: 'Year to', year: true, ph: 'e.g. 2024 or Present' },
  ] },
];
export const rowFilled = (r?: BioRow) => !!r && Object.values(r).some(v => String(v || '').trim());

// The extra details, the same shape on the trainer record and in what a trainer submits.
export interface TrainerExtras {
  gender: Gender;
  address: string;
  nationality: string;
  race: string;
  tttNumber: string;            // TTT certification / exemption number
  academic: BioRow[];
  professional: BioRow[];
  career: BioRow[];
  trainingExp: BioRow[];
  emergencyContact: EmergencyContact;
  languages: string[];          // from LANGUAGES
  languagesOther: string;       // anything else, typed
  trainingTypes: TrainingType[];
  otherCerts: string;
  linkedin: string;
  youtube: string;
  otherSocial: string;
  photoUrl: string;
  docs: Partial<Record<DocKind, TrainerFile>>;
}

export const emptyExtras = (): TrainerExtras => ({
  gender: '', address: '', nationality: '', race: '', tttNumber: '', academic: [], professional: [], career: [], trainingExp: [], emergencyContact: { name: '', relationship: '', phone: '' }, languages: [], languagesOther: '',
  trainingTypes: [], otherCerts: '', linkedin: '', youtube: '', otherSocial: '', photoUrl: '', docs: {},
});

// The extra details of a saved trainer (missing ones blank).
export const extrasFrom = (t: any): TrainerExtras => ({
  gender: t?.gender || '', address: t?.address || '',
  nationality: t?.nationality || '', race: t?.race || '', tttNumber: t?.tttNumber || '',
  academic: [...(t?.academic || [])], professional: [...(t?.professional || [])], career: [...(t?.career || [])], trainingExp: [...(t?.trainingExp || [])],
  emergencyContact: { name: t?.emergencyContact?.name || '', relationship: t?.emergencyContact?.relationship || '', phone: t?.emergencyContact?.phone || '' },
  languages: t?.languages || [], languagesOther: t?.languagesOther || '', trainingTypes: t?.trainingTypes || [],
  otherCerts: t?.otherCerts || '', linkedin: t?.linkedin || '', youtube: t?.youtube || '', otherSocial: t?.otherSocial || '',
  photoUrl: t?.photoUrl || '', docs: { ...(t?.docs || {}) },
});

// Ready to save on a trainer record: text trimmed. Empty uploads are left out.
export const extrasToSave = (x: TrainerExtras) => ({
  gender: x.gender, address: x.address.trim(),
  nationality: x.nationality.trim(), race: x.race.trim(), tttNumber: x.tttNumber.trim(),
  academic: cleanRows(x.academic, 'academic'), professional: cleanRows(x.professional, 'professional'),
  career: cleanRows(x.career, 'career'), trainingExp: cleanRows(x.trainingExp, 'trainingExp'),
  emergencyContact: { name: x.emergencyContact.name.trim(), relationship: x.emergencyContact.relationship.trim(), phone: x.emergencyContact.phone.trim() },
  languages: x.languages, languagesOther: x.languagesOther.trim(), trainingTypes: x.trainingTypes,
  otherCerts: x.otherCerts.trim(), linkedin: x.linkedin.trim(), youtube: x.youtube.trim(), otherSocial: x.otherSocial.trim(),
  docs: x.docs,
});

// "Topics you teach": one per line in suggestedTopics (kept as text so older records read the same).
export const topicList = (s?: string) => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
export const topicText = (list: string[]) => list.map(x => x.trim()).filter(Boolean).join('\n');

// ---------- Uploads ----------
export const MAX_TRAINER_FILE_BYTES = 20 * 1024 * 1024;
const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};
const extOf = (name: string) => (name.split('.').pop() || '').toLowerCase();
export const TRAINER_FILE_ACCEPT = Object.keys(TYPES).map(e => `.${e}`).join(',');
export const TRAINER_FILE_KINDS = 'PDF, Word, JPG or PNG';
export const trainerFileType = (name: string) => TYPES[extOf(name)] || 'application/octet-stream';
export function trainerFileProblem(name: string, size: number): string {
  if (!TYPES[extOf(name)]) return `"${name}" isn't a ${TRAINER_FILE_KINDS} file.`;
  if (size > MAX_TRAINER_FILE_BYTES) return `"${name}" is ${(size / 1024 / 1024).toFixed(1)} MB. Files can be up to 20 MB.`;
  if (size === 0) return `"${name}" is empty.`;
  return '';
}
export const safeName = (name: string) => String(name || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(-80) || 'file';

// ---------- Cleaning (the server keeps only this) ----------
// A biodata list: known columns only, up to 30 rows, empty rows left out.
export function cleanRows(list: any, key: BioListKey): BioRow[] {
  const cols = BIO_LISTS.find(l => l.key === key)!.cols;
  return (Array.isArray(list) ? list : []).slice(0, 30)
    .map((r: any) => Object.fromEntries(cols.map(c => [c.k, String(r?.[c.k] ?? '').trim().slice(0, c.year ? 20 : 200)])))
    .filter(rowFilled);
}
// IC / passport number: letters, numbers, dashes and spaces only.
export const cleanIc = (v: any) => String(v ?? '').replace(/[^A-Za-z0-9 -]/g, '').trim().slice(0, 30);
const str = (v: any, max: number) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const FIREBASE_FILE = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?]+)\?alt=media&token=[A-Za-z0-9-]+$/;

// A file from storage, accepted only when it's inside `prefix` (e.g. trainer_uploads/<token>/).
function cleanFile(f: any, prefix: string): TrainerFile | null {
  if (!f || typeof f !== 'object') return null;
  const url = str(f.url, 2000);
  const m = url.match(FIREBASE_FILE);
  const path = str(f.path, 300);
  if (!m || decodeURIComponent(m[1]) !== path || !path.startsWith(prefix)) return null;
  return {
    name: str(f.name, 200) || 'file', size: Math.max(0, Number(f.size) || 0), type: str(f.type, 120),
    path, url, at: Number(f.at) || Date.now(), byName: str(f.byName, 100),
  };
}

// `prefixes`: the storage folders files may come from (the trainer's link folder; the team's also the trainer's folder).
export function cleanExtras(d: any, prefixes: string[]): TrainerExtras {
  const ok = (url: string) => {
    const m = url.match(FIREBASE_FILE);
    return !!m && prefixes.some(p => decodeURIComponent(m[1]).startsWith(p));
  };
  const docs: TrainerExtras['docs'] = {};
  for (const k of DOC_KINDS) {
    for (const p of prefixes) {
      const f = cleanFile(d?.docs?.[k.id], p);
      if (f) { docs[k.id] = f; break; }
    }
  }
  const photo = str(d?.photoUrl, 2000);
  const ec = d?.emergencyContact || {};
  return {
    gender: (GENDERS as string[]).includes(d?.gender) ? d.gender : '',
    address: str(d?.address, 500),
    nationality: str(d?.nationality, 60), race: str(d?.race, 60), tttNumber: str(d?.tttNumber, 60),
    academic: cleanRows(d?.academic, 'academic'), professional: cleanRows(d?.professional, 'professional'),
    career: cleanRows(d?.career, 'career'), trainingExp: cleanRows(d?.trainingExp, 'trainingExp'),
    emergencyContact: { name: str(ec.name, 100), relationship: str(ec.relationship, 60), phone: str(ec.phone, 40) },
    languages: (Array.isArray(d?.languages) ? d.languages : []).map(String).filter((x: string) => (LANGUAGES as readonly string[]).includes(x)),
    languagesOther: str(d?.languagesOther, 200),
    trainingTypes: (Array.isArray(d?.trainingTypes) ? d.trainingTypes : []).map(String).filter((x: string) => TRAINING_TYPES.some(t => t.id === x)) as TrainingType[],
    otherCerts: str(d?.otherCerts, 1500),
    linkedin: str(d?.linkedin, 300), youtube: str(d?.youtube, 300), otherSocial: str(d?.otherSocial, 600),
    photoUrl: photo && ok(photo) ? photo : '',
    docs,
  };
}

// Languages as one line: "English, Bahasa Malaysia, Tamil".
export const languagesText = (x: { languages?: string[]; languagesOther?: string }) =>
  [...(x.languages || []), ...String(x.languagesOther || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean)].join(', ');

// What's still empty, in plain words (nothing is compulsory; the form just encourages filling these in).
export function profileGaps(p: any): string[] {
  const has = (v: any) => (Array.isArray(v) ? v.length > 0 : !!String(v ?? '').trim() && v !== 0);
  const gaps: [boolean, string][] = [
    [has(p.name), 'your name'],
    [has(p.contact) || has(p.email), 'phone or email'],
    [has(p.gender), 'gender'],
    [has(p.address), 'address'],
    [has(p.icNumber) || !!p.icOnFile, 'IC / passport number'],
    [has(p.nationality) && has(p.race), 'nationality and race'],
    [has(p.tttNumber), 'TTT certification / exemption number'],
    [has(p.emergencyContact?.name) && has(p.emergencyContact?.phone), 'emergency contact'],
    [has(p.languages) || has(p.languagesOther), 'languages'],
    [has(p.trainingTypes), 'Team building / Soft skills'],
    [has(p.programmeIds) || has(p.suggestedTopics), 'what you teach'],
    [has(p.experienceYears), 'years of experience'],
    [has(p.bio), 'short bio'],
    [(p.academic || []).some(rowFilled), 'academic qualification'],
    [(p.professional || []).some(rowFilled), 'professional qualification'],
    [(p.career || []).some(rowFilled), 'career experience'],
    [(p.trainingExp || []).some(rowFilled), 'training experience'],
    [has(p.linkedin) || has(p.youtube) || has(p.otherSocial), 'LinkedIn, YouTube or other social media'],
    [has(p.photoUrl), 'professional photo'],
    ...DOC_KINDS.map(k => [!!p.docs?.[k.id], k.label] as [boolean, string]),
  ];
  return gaps.filter(([done]) => !done).map(([, what]) => what);
}
export const PROFILE_PARTS = 22;

// A link typed without https:// still opens.
export const linkHref = (s: string) => (/^https?:\/\//i.test(s.trim()) ? s.trim() : `https://${s.trim()}`);
