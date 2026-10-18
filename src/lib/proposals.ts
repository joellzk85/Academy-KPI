// Proposal files on a deal (2026-10-18; Joel: "users drop their proposals here, kept as a copy and backed up").
// - The file itself is in Firebase Storage at proposals/{dealId}/{fileId}_{name} (rules: storage.rules).
// - Each file has a record in proposal_files/{fileId}: dealId, name, size, type, path, at, byId, byName.
//   The backup copies these records as the "Proposal files" tab; Admin work → Backup can download every file as a ZIP.
// - Uploading at New marks the deal "Proposal sent" (DealsBoard). Older versions are kept.
// - Anyone on the team can open them; only the uploader or Management can delete one.

export interface ProposalFile {
  id: string;
  dealId: string;
  name: string;
  size: number;
  type: string;
  path: string;
  at: string;
  byId: string;
  byName: string;
}

export const MAX_PROPOSAL_BYTES = 20 * 1024 * 1024;

// Allowed files by extension, with the type stored (browsers sometimes leave the type blank).
const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
export const PROPOSAL_ACCEPT = Object.keys(TYPES).map(e => `.${e}`).join(',');

export const extOf = (name: string) => (name.split('.').pop() || '').toLowerCase();

// Why this file can't be uploaded, or '' if it's fine.
export function proposalFileProblem(name: string, size: number): string {
  if (!TYPES[extOf(name)]) return `"${name}" isn't a PDF, Word or PowerPoint file.`;
  if (size > MAX_PROPOSAL_BYTES) return `"${name}" is ${(size / 1024 / 1024).toFixed(1)} MB. Files can be up to 20 MB.`;
  if (size === 0) return `"${name}" is empty.`;
  return '';
}

export const proposalType = (name: string) => TYPES[extOf(name)] || 'application/octet-stream';

// A name that's safe in a storage path, a ZIP and on Windows.
export const safeFileName = (name: string, max = 120) => {
  const clean = String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean || 'file';
  const ext = extOf(clean);
  return `${clean.slice(0, max - ext.length - 1)}.${ext}`;
};

export const sizeText = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
