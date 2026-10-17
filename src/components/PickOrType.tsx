import React from 'react';

// One box for "pick from the list or type your own" (venue, programme, trainer).
// Typing a name that's in the list links it (read live afterwards); anything else is kept as typed.
export default function PickOrType({ id, options, linkedId, text, onChange, onBlur, placeholder, className, ariaLabel, note, disabled }: {
  id: string; options: { id: string; name: string; hint?: string }[]; linkedId: string; text: string;
  onChange: (v: { id: string; text: string }) => void; onBlur?: () => void;
  placeholder?: string; className: string; ariaLabel?: string;
  note?: string;          // replaces the "From list" / "Typed" label, e.g. "From quotation"
  disabled?: boolean;
}) {
  const linked = linkedId ? options.find(o => o.id === linkedId) : undefined;
  const value = linked ? linked.name : text;
  const pick = (v: string) => {
    const hit = v.trim() ? options.find(o => o.name.trim().toLowerCase() === v.trim().toLowerCase()) : undefined;
    onChange(hit ? { id: hit.id, text: hit.name } : { id: '', text: v });
  };
  const label = note || (linked ? 'From list' : value.trim() ? 'Typed' : '');
  return (
    <div>
      <input id={id} list={`${id}-list`} value={value} onChange={e => pick(e.target.value)} onBlur={onBlur} disabled={disabled}
        placeholder={placeholder} className={className} aria-label={ariaLabel} autoComplete="off" />
      <datalist id={`${id}-list`}>
        {options.map(o => <option key={o.id} value={o.name} label={o.hint} />)}
      </datalist>
      {label && <span className={`mt-0.5 block text-xs ${linked && !note ? 'text-accent' : 'text-ink-soft'}`}>{label}</span>}
    </div>
  );
}

// Trainers for a programme: those who teach it first, marked "Teaches this programme" (Joel, 2026-10-17).
export function trainerOptions(trainers: any[], programmeId?: string): { id: string; name: string; hint?: string }[] {
  const teaches = (t: any) => !!programmeId && (t.programmeIds || []).includes(programmeId);
  const byId = new Map(trainers.map(t => [t.id, t]));
  return nameOptions(trainers)
    .map((o): { id: string; name: string; hint?: string } => (teaches(byId.get(o.id)) ? { ...o, hint: 'Teaches this programme' } : o))
    .sort((a, b) => Number(!!b.hint) - Number(!!a.hint) || a.name.localeCompare(b.name));
}

// List choices for the boxes, A–Z, skipping entries with no name.
export function nameOptions(list: any[]): { id: string; name: string }[] {
  return list.filter(x => String(x.name || '').trim())
    .map(x => ({ id: x.id, name: String(x.name).trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
