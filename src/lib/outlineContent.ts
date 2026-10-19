// Course outline content helpers (Joel, 2026-10-19): the standard terms, Bloom's levels and small formatters
// shared by the printed outline (CourseOutlineDocument) and the editor (CourseOutlinesPage).

// Joel's standard terms, from his "Discover Your Office Persona" outline. Each outline starts with these and can
// change them. Format: "1. Heading" lines, "- " bullet lines ("Label: text" prints the label in bold), else paragraphs.
export const DEFAULT_OUTLINE_TERMS = `1. Cancellation and rescheduling policy
- Cancellation by client: Cancellations made 14 days or more before the training date will incur no additional charges. Cancellations within 7-13 days of the training date will incur a cancellation fee of 50%. Cancellations within 6 days of the training date will incur a cancellation fee of 100%.
- Rescheduling: Rescheduling requests made at least 7 days before the training date will be accommodated based on trainer availability. Rescheduling within 6 days may incur an additional fee.
- Cancellation by provider: In case of unforeseen circumstances requiring cancellation by the provider, the client will be offered alternative dates or a full refund of any fees paid.
2. Participant requirements
- Minimum/maximum participants: A minimum of 5 participants is required for the training. The maximum number of participants per session is 35 (subject to change based on different topics).
- Attendance: Participants are expected to attend the entire training session to receive any certifications or completion acknowledgments.
3. Training materials and intellectual property
- All training materials provided by Next Academy are proprietary and intended for the client's internal use only (1 time use only).
- Usage restriction: These materials may not be reproduced, distributed, or sold without prior written consent from Next Academy.
4. Confidentiality and data protection
- Both parties agree to maintain the confidentiality of any proprietary information shared during the training program.
- Personal information collected for the training will be used solely for the purpose of training logistics and will comply with data protection regulations.`;

export const BLOOM_LEVELS = ['Remember', 'Understand', 'Apply', 'Analyse', 'Evaluate', 'Create'];
export const bloomText = (n?: number) => (n && n >= 1 && n <= 6 ? `Level ${n}: ${BLOOM_LEVELS[n - 1]}` : '');

export const DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced'];

// "0.5 day", "1 day", "2 days", with "(16 hours)" when hours are set.
export function durationText(days?: number, hours?: number): string {
  const d = Number(days) || 0;
  const h = Number(hours) || 0;
  const dayPart = d ? `${d} day${d > 1 ? 's' : ''}` : '';
  const hourPart = h ? `${h} hour${h === 1 ? '' : 's'}` : '';
  return dayPart && hourPart ? `${dayPart} (${hourPart})` : dayPart || hourPart;
}

// Text typed one item per line → the non-empty lines (bullets and numbers typed in front are dropped).
export const lines = (v?: string | string[]) =>
  (Array.isArray(v) ? v : String(v || '').split('\n')).map(x => String(x).replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '').trim()).filter(Boolean);

export type TermsLine = { kind: 'heading' | 'bullet' | 'text'; no?: string; label?: string; text: string };

export function parseTerms(text: string): TermsLine[] {
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const h = l.match(/^(\d+)[.)]\s+(.*)$/);
    if (h) return { kind: 'heading', no: h[1], text: h[2].replace(/:$/, '') };
    const b = l.match(/^[-•*]\s+(.*)$/);
    if (b) {
      const lab = b[1].match(/^([^:]{2,45}):\s+(.*)$/);
      return lab ? { kind: 'bullet', label: lab[1], text: lab[2] } : { kind: 'bullet', text: b[1] };
    }
    return { kind: 'text', text: l };
  });
}

// "Module 3: Introduction" → bold "Module 3" in the agenda.
export function splitModuleLabel(text: string): { label: string; rest: string } {
  const m = String(text || '').match(/^(Module\s*\d+)\s*:?\s*(.*)$/i);
  return m ? { label: m[1], rest: m[2] } : { label: '', rest: String(text || '') };
}

// The training days the modules are spread over (1-based), or [] when the outline isn't split by day
// (a course of a day or less, or no module given a day).
export function moduleDays(days: number | undefined, items: { day?: number }[]): number[] {
  const n = Math.ceil(Number(days) || 0);
  if (n <= 1 || !items.some(m => m.day)) return [];
  return Array.from({ length: n }, (_, i) => i + 1);
}
