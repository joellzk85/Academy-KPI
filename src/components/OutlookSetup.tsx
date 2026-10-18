import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, Mail } from 'lucide-react';
import { callServer, friendlyError } from '../lib/firebase';

// Management → Team: connect the CRM to the company's Microsoft 365, so quotations can be emailed from each
// person's own Outlook mailbox (serverMail.ts). The secret is sent to the server once and never shown again.

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

type Status = { configured: boolean; tenantId?: string; clientId?: string; secretSet?: boolean; checkedAt?: number; lastError?: string };

export default function OutlookSetup() {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = async () => {
    try {
      const s = await callServer<Status>('/api/mail/status', {}, true);
      setStatus(s);
      setTenantId(s.tenantId || '');
      setClientId(s.clientId || '');
    } catch (e) {
      setStatus({ configured: false });
      setError(friendlyError(e));
    }
  };
  useEffect(() => { load(); }, []);

  const save = async (disconnect = false) => {
    if (disconnect && !window.confirm('Disconnect Outlook? Nobody will be able to send quotations by email until it is set up again.')) return;
    setBusy(true);
    setError('');
    setNote('');
    try {
      const body = disconnect ? { tenantId: '', clientId: '', clientSecret: '' } : { tenantId, clientId, clientSecret: secret };
      const r = await callServer<{ configured: boolean }>('/api/mail/settings', body, true);
      setSecret('');
      setNote(r.configured ? 'Connected. Microsoft accepted the codes and the app is allowed to send email.' : 'Disconnected.');
      if (r.configured) setOpen(false);
      await load();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="h-fit rounded-2xl border border-line bg-white p-5">
      <h3 className="flex items-center gap-2 font-bold"><Mail className="h-4 w-4 text-accent" /> Outlook email</h3>
      {!status ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Checking…</p>
      ) : status.configured ? (
        <p className="mt-2 flex items-start gap-2 text-[15px] text-accent"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> Connected. People with a work email can send quotations from their own Outlook.</p>
      ) : (
        <p className="mt-2 text-[15px] text-ink-soft">Not set up yet. Connect the company's Microsoft 365 so the team can email quotations from the CRM.</p>
      )}
      {status?.lastError && <p className="mt-2 rounded-lg bg-attention-soft px-3 py-2 text-sm text-attention">Last problem: {status.lastError}</p>}
      {note && <p role="status" className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">{note}</p>}

      <button type="button" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}{status?.configured ? 'Change the connection' : 'Set it up'}
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-ink-soft">
            <li>Open <strong className="text-ink">entra.microsoft.com</strong> and sign in as a Microsoft 365 admin.</li>
            <li>Go to <strong className="text-ink">Applications → App registrations → New registration</strong>. Name it "NEXT Academy CRM", keep "this organizational directory only", leave Redirect URI empty, click <strong className="text-ink">Register</strong>.</li>
            <li>On its Overview page, copy the <strong className="text-ink">Directory (tenant) ID</strong> and the <strong className="text-ink">Application (client) ID</strong> into the boxes below.</li>
            <li><strong className="text-ink">API permissions → Add a permission → Microsoft Graph → Application permissions</strong>, tick <strong className="text-ink">Mail.Send</strong>, click Add. Then click <strong className="text-ink">Grant admin consent</strong> and Yes.</li>
            <li><strong className="text-ink">Certificates &amp; secrets → New client secret</strong>, choose 24 months, click Add, and copy its <strong className="text-ink">Value</strong> straight away (it's only shown once). Put a reminder in your calendar to renew it before it expires.</li>
            <li>Click <strong className="text-ink">Save and test</strong>. Then give each person their <strong className="text-ink">Work email</strong> in the list on the left.</li>
          </ol>
          <div>
            <label className={label} htmlFor="ol-tenant">Directory (tenant) ID</label>
            <input id="ol-tenant" value={tenantId} onChange={e => setTenantId(e.target.value)} className={input} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoComplete="off" spellCheck={false} />
          </div>
          <div>
            <label className={label} htmlFor="ol-client">Application (client) ID</label>
            <input id="ol-client" value={clientId} onChange={e => setClientId(e.target.value)} className={input} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoComplete="off" spellCheck={false} />
          </div>
          <div>
            <label className={label} htmlFor="ol-secret">Client secret Value</label>
            <input id="ol-secret" type="password" value={secret} onChange={e => setSecret(e.target.value)} className={input}
              placeholder={status?.secretSet ? 'Saved. Leave blank to keep it' : 'Paste the Value'} autoComplete="new-password" spellCheck={false} />
            <p className="mt-1 text-sm text-ink-soft">Kept on the CRM server only. Nobody can read it back, not even Management.</p>
          </div>
          {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap justify-between gap-2">
            {status?.configured ? <button type="button" className={`${btnSecondary} text-danger hover:bg-danger-soft`} disabled={busy} onClick={() => save(true)}>Disconnect</button> : <span />}
            <button type="button" className={btnPrimary} disabled={busy || !tenantId.trim() || !clientId.trim() || (!secret.trim() && !status?.secretSet)} onClick={() => save(false)}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}Save and test
            </button>
          </div>
        </div>
      )}
      {!open && error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
    </section>
  );
}
