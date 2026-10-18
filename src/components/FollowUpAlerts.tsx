import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { STAGE_LABELS, dealOwnerId, dealStage, formatDate, todayIso } from '../lib/deals';
import { FollowUpAlert, followUpAlert, followUpNotes } from '../lib/followUps';

// "Follow-up alerts" for Management (Joel, 2026-10-18): every open deal that has passed a follow-up checkpoint
// with no note since, or needs a keep-open / mark-lost decision. Used as a My home card and on the
// Management dashboard. Filter by rep and by alert level.

type Row = { p: any; a: FollowUpAlert };

const select = 'rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink focus:border-accent focus:outline-none';

export function followUpAlertRows(deals: any[], today = todayIso()): Row[] {
  return deals
    .map(p => ({ p, a: followUpAlert(p, today) }))
    .filter((r): r is Row => !!r.a)
    // Decisions first, then the highest level, then the longest in stage.
    .sort((x, y) => Number(y.a.decision) - Number(x.a.decision) || y.a.level - x.a.level || y.a.daysInStage - x.a.daysInStage);
}

export default function FollowUpAlerts({ deals, nameOf, clientName, onOpen, compact }: {
  deals: any[]; nameOf: (id: string) => string; clientName: (p: any) => string; onOpen?: (p: any) => void; compact?: boolean;
}) {
  const [rep, setRep] = useState('');
  const [level, setLevel] = useState('');
  const rows = useMemo(() => followUpAlertRows(deals), [deals]);
  const reps = [...new Set(rows.map(r => dealOwnerId(r.p)))].map(id => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name));
  const levels = [...new Set(rows.map(r => r.a.short))].sort((a, b) => (a === 'Decision' ? 1 : b === 'Decision' ? -1 : a.localeCompare(b)));
  const shown = rows.filter(r => (!rep || dealOwnerId(r.p) === rep) && (!level || r.a.short === level));

  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <select value={rep} onChange={e => setRep(e.target.value)} className={select} aria-label="Filter by rep">
            <option value="">Everyone ({rows.length})</option>
            {reps.map(r => <option key={r.id} value={r.id}>{r.name} ({rows.filter(x => dealOwnerId(x.p) === r.id).length})</option>)}
          </select>
          <select value={level} onChange={e => setLevel(e.target.value)} className={select} aria-label="Filter by alert level">
            <option value="">All alert levels</option>
            {levels.map(l => <option key={l} value={l}>{l === 'Decision' ? 'Decision needed' : `${l} follow-up due`} ({rows.filter(x => x.a.short === l).length})</option>)}
          </select>
        </div>
      )}
      {rows.length === 0 ? <p className="text-[15px] text-ink-soft">No follow-up alerts. Every open deal has been followed up on time.</p>
        : shown.length === 0 ? <p className="text-[15px] text-ink-soft">No alerts match these filters.</p> : (
        <ul className="divide-y divide-line">
          {shown.map(({ p, a }) => {
            const last = followUpNotes(p)[0];
            return (
              <li key={p.id}>
                <button type="button" disabled={!onOpen} onClick={() => onOpen?.(p)} className="flex w-full items-start gap-2 py-2 text-left enabled:hover:bg-surface">
                  <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${a.decision || a.level > 1 ? 'text-danger' : 'text-attention'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <span className="truncate font-semibold">{clientName(p)}</span>
                      <span className={`text-sm font-semibold ${a.decision || a.level > 1 ? 'text-danger' : 'text-attention'}`}>{a.label}</span>
                    </span>
                    <span className="block text-sm text-ink-soft">{nameOf(dealOwnerId(p))} · {STAGE_LABELS[dealStage(p)]} · {a.daysInStage} days in stage</span>
                    <span className={`block text-sm text-ink-soft ${compact ? 'truncate' : ''}`}>
                      {last ? `Last note ${formatDate(last.date)} (${last.byName}): ${last.text}` : 'No follow-up notes yet'}
                    </span>
                  </span>
                  {onOpen && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
