import React from 'react';
import { Share2, Users } from 'lucide-react';
import { ShareLog, shareLogAfter } from '../lib/sharedInbox';

// "Share with teammates" on quotations and course outlines. Admin people are listed first (Joel, 2026-10-18:
// reps share with Admin when they want Admin to work on it). Ticking someone records who shared it and when
// (sharedLog), which gives them a "Shared with me" alert until they open it.
export default function ShareWithBox({ people, ownerId, shared, log, me, onChange }: {
  people: { id: string; name: string; role?: string }[];
  ownerId: string;
  shared: string[];
  log?: ShareLog;
  me: { id: string; name: string };
  onChange: (c: { sharedWithIds: string[]; sharedLog: ShareLog }) => void;
}) {
  const list = people.filter(p => p.id !== ownerId);
  const admins = list.filter(p => p.role === 'admin');
  const others = list.filter(p => p.role !== 'admin');
  const chip = (p: { id: string; name: string }) => {
    const on = shared.includes(p.id);
    return (
      <button key={p.id} type="button" aria-pressed={on}
        onClick={() => onChange({ sharedWithIds: on ? shared.filter(x => x !== p.id) : [...shared, p.id], sharedLog: shareLogAfter(log, p.id, !on, me) })}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-surface'}`}>
        {on ? <Users className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}{p.name}
      </button>
    );
  };
  return (
    <div className="space-y-2">
      {admins.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-semibold text-ink-soft">Admin</p>
          <div className="flex flex-wrap gap-2">{admins.map(chip)}</div>
        </div>
      )}
      {others.length > 0 && (
        <div>
          {admins.length > 0 && <p className="mb-1 text-sm font-semibold text-ink-soft">Others</p>}
          <div className="flex flex-wrap gap-2">{others.map(chip)}</div>
        </div>
      )}
    </div>
  );
}

// Red count for files shared with you that you haven't opened yet.
export function NewCount({ n }: { n: number }) {
  return <span className="min-w-[1.25rem] rounded-full bg-danger px-1.5 text-center text-xs font-bold leading-5 text-white" aria-label={`${n} new`}>{n}</span>;
}
