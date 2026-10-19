// Files on admin checklist steps (2026-10-19; Joel: "JD14 / T3 / Output assessment should have an upload / drop here option").
// - A step has a drop box when "Has a file upload" is on for it (Admin work → Checklist tasks). Built in: JD14,
//   Verify T3 attendance, Output assessment.
// - Uploading a file ticks the step done; such a step can't be ticked without a file (Joel, 2026-10-19).
//   Deleting its last file reopens it.
// - The file itself is in Firebase Storage at checklist_files/{dealId}/{fileId}_{name} (rules: storage.rules).
// - Each file has a record in checklist_files/{fileId}: dealId, taskId, taskLabel, name, size, type, path, at, byId, byName.
//   The backup copies these records as the "Checklist files" tab; Admin work → Backup's ZIP includes the files.
// - Admin and Management upload; everyone on the team can open them; only the uploader or Management can delete.

import { extOf, safeFileName, sizeText } from './proposals';

export { safeFileName, sizeText };

export interface ChecklistFile {
  id: string;
  dealId: string;
  taskId: string;
  taskLabel: string;
  name: string;
  size: number;
  type: string;
  path: string;
  at: string;
  byId: string;
  byName: string;
}

export const MAX_CHECKLIST_FILE_BYTES = 100 * 1024 * 1024;

// Signed JD14s and attendance lists are often scans or phone photos, so pictures are allowed too.
const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};
export const CHECKLIST_FILE_ACCEPT = Object.keys(TYPES).map(e => `.${e}`).join(',');
export const CHECKLIST_FILE_KINDS = 'PDF, Word, Excel or a photo (JPG, PNG)';

// Why this file can't be uploaded, or '' if it's fine.
export function checklistFileProblem(name: string, size: number): string {
  if (!TYPES[extOf(name)]) return `"${name}" isn't a ${CHECKLIST_FILE_KINDS}.`;
  if (size > MAX_CHECKLIST_FILE_BYTES) return `"${name}" is ${(size / 1024 / 1024).toFixed(1)} MB. Files can be up to 100 MB.`;
  if (size === 0) return `"${name}" is empty.`;
  return '';
}

export const checklistFileType = (name: string) => TYPES[extOf(name)] || 'application/octet-stream';
