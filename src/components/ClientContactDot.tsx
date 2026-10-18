import React from 'react';
import { COLOUR_LABELS, ContactColour, agoText, summariseClient } from '../lib/touchPoints';
import { useContactLimits, useTouchPoints } from '../lib/useClientHistory';
import { todayIso } from '../lib/deals';

// The client contact colour (Joel, 2026-10-18): always a dot plus words ("12 days ago", "Never"), never colour alone.
const DOT: Record<ContactColour, string> = {
  green: 'bg-[#15803D]',
  amber: 'bg-[#D97706]',
  red: 'bg-danger',
  never: 'bg-[#A3ABB8]',
};
const TEXT: Record<ContactColour, string> = {
  green: 'text-[#15803D]',
  amber: 'text-attention',
  red: 'text-danger',
  never: 'text-ink-soft',
};

export function ContactDot({ colour, className = '' }: { colour: ContactColour; className?: string }) {
  return <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[colour]} ${className}`} />;
}

// "● 12 days ago"; the screen-reader text names the colour too.
export function ContactBadge({ colour, text, className = '' }: { colour: ContactColour; text: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${TEXT[colour]} ${className}`}>
      <ContactDot colour={colour} />
      <span className="sr-only">{COLOUR_LABELS[colour]}: </span>{text}
    </span>
  );
}

// The dot next to a client's name in deal panels (Deals and the work queue): days since the last touch point.
export function ClientLastTouch({ client, deals, quotes }: { client: any; deals: any[]; quotes: any[] }) {
  const touchPoints = useTouchPoints();
  const { limits } = useContactLimits();
  if (!client?.id) return null;
  const today = todayIso();
  const s = summariseClient(client, { deals, quotes, outlines: [], files: [], touchPoints, tasks: [] }, () => '', today, limits);
  return <ContactBadge colour={s.colour} text={s.last ? `Last touch point ${agoText(s.last.date, today).toLowerCase()}` : 'Never contacted'} className="font-medium" />;
}
