// WhatsApp helpers (2026-10-18). Pure, so they can be tested.

// A phone number as WhatsApp wants it: digits only with the country code, no + or leading 0.
// Malaysian numbers typed locally ("012-345 6789", "03-1234 5678") get 60 in front. '' if it isn't a number.
export function waPhone(raw: string): string {
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `60${d.slice(1)}`;
  else if (/^1\d{8,9}$/.test(d)) d = `60${d}`;      // 12-345 6789 typed without the 0
  d = d.replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? d : '';
}

// A phone or tablet (touch screen as the main pointer), where the share menu can hand the PDF to WhatsApp.
export function onPhone(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches && (navigator.maxTouchPoints || 0) > 0;
  } catch {
    return false;
  }
}
