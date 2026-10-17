import React from 'react';

// One box for "pick from the list or type your own" (venue, programme, trainer).
// Typing a name that's in the list links it (read live afterwards); anything else is kept as typed.
export default function PickOrType({ id, options, linkedId, text, onChange, onBlur, placeholder, className, ariaLabel, note, disabled }: {
  id: string; options: { id: string; name: string }[]; linkedId: string; text: string;
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
        {options.map(o => <option key={o.id} value={o.name} />)}
      </datalist>
      {label && <span className={`mt-0.5 block text-xs ${linked && !note ? 'text-accent' : 'text-ink-soft'}`}>{label}</span>}
    </div>
  );
}

// List choices for the boxes, A–Z, skipping entries with no name.
export function nameOptions(list: any[]): { id: string; name: string }[] {
  return list.filter(x => String(x.name || '').trim())
    .map(x => ({ id: x.id, name: String(x.name).trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
