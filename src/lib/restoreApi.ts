// Restore, from the browser (2026-10-24). The CRM server does the work (serverRestore.ts); owner only.

import { callServer } from './firebase';
import type { FieldDiff, RecordRow, RestoreSource } from './restore';

export interface RestorePoints {
  copies: { name: string; at: number; size: number }[];
  storageError: string;
  keepDays: number;
  lastCopyAt: number;
  copyError: string;
  copyErrorAt: number;
}
export interface RestoreList { id: string; name: string; changed: number; gone: number; added: number; total: number }
export interface RestoreLogItem {
  id: string; at: number; byName: string; source: string; what: string; put: number; removed: number; undone: boolean; undoneAt?: number;
}

export const restorePoints = () => callServer<RestorePoints>('/api/restore/points', {}, true);
export const saveKeepDays = (keepDays: number) => callServer<{ keepDays: number }>('/api/restore/settings', { keepDays }, true);
export const saveCopyNow = () => callServer<{ name: string; records: number }>('/api/restore/copy', {}, true);
export const restoreLists = (source: RestoreSource) => callServer<{ lists: RestoreList[]; label: string }>('/api/restore/lists', { source }, true);
export const restoreRecords = (source: RestoreSource, list: string, search: string, showSame: boolean) =>
  callServer<{ rows: RecordRow[]; more: number }>('/api/restore/records', { source, list, search, showSame }, true);
export const restoreRecord = (source: RestoreSource, list: string, id: string) =>
  callServer<{ label: string; existedThen: boolean; existsNow: boolean; fields: FieldDiff[] }>('/api/restore/record', { source, list, id }, true);
export const applyRestore = (source: RestoreSource, list: string, ids?: string[]) =>
  callServer<{ put: number; removed: number; note?: string }>('/api/restore/apply', { source, list, ...(ids ? { ids } : {}) }, true);
export const restoreHistory = () => callServer<{ items: RestoreLogItem[] }>('/api/restore/history', {}, true);
export const undoRestore = (restoreId: string) => callServer('/api/restore/undo', { restoreId }, true);
