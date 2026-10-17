// Contact persons (PICs) per client (Joel, 2026-10-17: the deal's attention person is chosen separately
// from the company, from a drop list or typed).
// - clients/{id}.contacts: [{ id, name, designation, phone, email }]. The first is the main contact, and is
//   also copied to the client's old single fields (contactName, designation, phone, email) for older screens.
// - Clients saved before this have only the single fields; they read as one contact with id 'main'.
// - A deal stores contactId (one of its client's contacts), or contactName when typed and not saved to the client.

export interface Contact { id: string; name: string; designation?: string; phone?: string; email?: string }

const real = (v: any) => typeof v === 'string' && v.trim() !== '' && v.trim().toUpperCase() !== 'N/A';

export function clientContacts(c: any): Contact[] {
  if (Array.isArray(c?.contacts) && c.contacts.length) {
    return c.contacts.filter((x: any) => real(x?.name)).map((x: any) => ({
      id: String(x.id || ''), name: String(x.name).trim(), designation: x.designation || '', phone: x.phone || '', email: x.email || '',
    }));
  }
  return real(c?.contactName)
    ? [{ id: 'main', name: String(c.contactName).trim(), designation: c.designation || '', phone: real(c.phone) ? c.phone : '', email: real(c.email) ? c.email : '' }]
    : [];
}

// The old single fields, kept in step with the first contact.
export function mainContactFields(list: Contact[]) {
  const m = list[0];
  return { contactName: m?.name || '', designation: m?.designation || '', phone: m?.phone || '', email: m?.email || '' };
}

export const newContactId = () => `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// The deal's attention person: the chosen contact (read live), else the typed name, else the client's main contact.
export function dealContact(deal: any, client: any): Contact | null {
  const list = clientContacts(client);
  if (deal?.contactId) {
    const hit = list.find(x => x.id === deal.contactId);
    if (hit) return hit;
  }
  if (real(deal?.contactName)) return { id: '', name: String(deal.contactName).trim() };
  return list[0] || null;
}
