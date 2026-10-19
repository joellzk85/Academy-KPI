import React, { useEffect, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { Loader2, Plus, RotateCcw, X } from 'lucide-react';
import { db, friendlyError } from '../lib/firebase';
import {
  DEFAULT_FOLLOW_UP_RULES, FollowUpRules, RULE_STAGES, RULE_STAGE_FROM, RULE_STAGE_LABELS, RuleStage, cleanDays, ordinal,
} from '../lib/followUps';
import { useFollowUpRules } from '../lib/useFollowUpRules';
import { useContactLimits } from '../lib/useClientHistory';
import { DEFAULT_CONTACT_LIMITS } from '../lib/touchPoints';
import { ContactDot } from './ClientContactDot';
import { useProposalSettings } from '../lib/useProposalSettings';

// Management → Follow-up rules (Joel, 2026-10-18). Checkpoints in days per stage, saved in config/follow_up_rules
// (Management only). When a deal passes a checkpoint with no follow-up note since, it raises an alert.

type Viewer = { id: string; name: string };

const card = 'rounded-2xl border border-line bg-white p-5';
const input =
  'w-24 rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

export default function FollowUpRulesPage({ viewer }: { viewer: Viewer }) {
  const { rules, loaded, meta } = useFollowUpRules();
  const [draft, setDraft] = useState<FollowUpRules>(rules);
  const [adding, setAdding] = useState<Record<RuleStage, string>>({ lead: '', proposal: '', quoted: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { if (!dirty) setDraft(rules); }, [rules, dirty]);

  const change = (st: RuleStage, next: Partial<FollowUpRules[RuleStage]>) => {
    setDraft(d => ({ ...d, [st]: { ...d[st], ...next } }));
    setDirty(true);
    setMsg(null);
  };
  const addDay = (st: RuleStage) => {
    const n = Math.round(Number(adding[st]));
    if (!Number.isFinite(n) || n < 1 || n > 365) return setMsg({ ok: false, text: 'Type a number of days from 1 to 365.' });
    if (draft[st].days.includes(n)) return setMsg({ ok: false, text: `${n} days is already a checkpoint.` });
    change(st, { days: cleanDays([...draft[st].days, n]) });
    setAdding(a => ({ ...a, [st]: '' }));
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const data: any = { updatedAt: new Date().toISOString(), updatedById: viewer.id, updatedByName: viewer.name };
      RULE_STAGES.forEach(st => { data[st] = { on: draft[st].on, days: cleanDays(draft[st].days) }; });
      await setDoc(doc(db, 'config', 'follow_up_rules'), data);
      setDirty(false);
      setMsg({ ok: true, text: 'Follow-up rules saved. Alerts use them straight away.' });
    } catch (e) {
      setMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 font-sans text-ink">
      <div>
        <h2 className="text-xl font-bold">Follow-up rules</h2>
        <p className="mt-0.5 max-w-3xl text-[15px] text-ink-soft">
          When a deal passes a checkpoint and nobody has logged a follow-up since, the rep gets an alert ("1st follow-up due", and so on).
          After the last checkpoint they must decide: keep the deal open (with a reason) or mark it lost. Each stage's clock starts on the day the deal reached it;
          logging a note doesn't restart it. "Client approved" has no checkpoints.
        </p>
      </div>

      {!loaded ? (
        <p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {RULE_STAGES.map(st => {
            const r = draft[st];
            return (
              <section key={st} className={`${card} ${r.on ? '' : 'bg-surface'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold">{RULE_STAGE_LABELS[st]}</h3>
                    <p className="text-sm text-ink-soft">Counted from {RULE_STAGE_FROM[st]}</p>
                  </div>
                  <label className="flex shrink-0 items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" checked={r.on} onChange={e => change(st, { on: e.target.checked })} className="h-4 w-4 accent-[#0E6E62]" />
                    {r.on ? 'On' : 'Off'}
                  </label>
                </div>
                <ul className="mt-4 space-y-2">
                  {r.days.map((d, i) => (
                    <li key={d} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[15px]">
                      <span><strong>{d} days</strong> <span className="text-ink-soft">· {i === r.days.length - 1 ? 'decision: keep open or mark lost' : `${ordinal(i + 1)} follow-up due`}</span></span>
                      <button type="button" onClick={() => change(st, { days: r.days.filter(x => x !== d) })} className="rounded-md p-1 text-ink-soft hover:bg-danger-soft hover:text-danger" aria-label={`Remove the ${d}-day checkpoint`}>
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                  {r.days.length === 0 && <li className="text-sm text-ink-soft">No checkpoints, so no alerts at this stage.</li>}
                </ul>
                <div className="mt-3 flex items-center gap-2">
                  <input inputMode="numeric" value={adding[st]} onChange={e => setAdding(a => ({ ...a, [st]: e.target.value.replace(/[^0-9]/g, '') }))}
                    onKeyDown={e => { if (e.key === 'Enter') addDay(st); }} placeholder="Days" aria-label={`New checkpoint for ${RULE_STAGE_LABELS[st]}, in days`} className={input} />
                  <button type="button" className={btnSecondary} onClick={() => addDay(st)}><Plus className="h-4 w-4" /> Add checkpoint</button>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2.5 text-sm ${msg.ok ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'}`}>{msg.text}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !dirty} className={btnPrimary} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save rules</button>
        {dirty && <button type="button" className={btnSecondary} onClick={() => { setDraft(rules); setDirty(false); setMsg(null); }}>Cancel changes</button>}
        <button type="button" className={btnSecondary} onClick={() => { setDraft(JSON.parse(JSON.stringify(DEFAULT_FOLLOW_UP_RULES))); setDirty(true); setMsg(null); }}>
          <RotateCcw className="h-4 w-4" /> Back to 15, 30, 45 days
        </button>
        {meta?.updatedByName && <span className="text-sm text-ink-soft">Last changed by {meta.updatedByName}, {new Date(meta.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
      </div>

      <ContactColourLimits viewer={viewer} />
      <ProposalTrackingSwitch viewer={viewer} />
    </div>
  );
}

// Teambuilding proposal tracking (push B, Joel 2026-10-19: "reps can see tracking or not, to be determined by
// management"). Saved in config/proposal_settings (Management only; the database rule for proposal_views reads it).
function ProposalTrackingSwitch({ viewer }: { viewer: Viewer }) {
  const settings = useProposalSettings();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const toggle = async (on: boolean) => {
    setBusy(true); setMsg(null);
    try {
      await setDoc(doc(db, 'config', 'proposal_settings'), { repsSeeTracking: on, updatedAt: new Date().toISOString(), updatedById: viewer.id, updatedByName: viewer.name }, { merge: true });
      setMsg({ ok: true, text: on ? 'Reps now see how clients use their own proposal links.' : 'Reps now see only whether a link is live and whether it was accepted.' });
    } catch (e) { setMsg({ ok: false, text: friendlyError(e) }); } finally { setBusy(false); }
  };
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <h3 className="font-bold">Proposal tracking</h3>
      <p className="mt-0.5 text-[15px] text-ink-soft">How clients use teambuilding proposal links: views, time per section, visits and possible screenshot attempts. Admin and Management always see it.</p>
      <label className="mt-3 flex items-center gap-3 text-[15px]">
        <input type="checkbox" checked={settings.repsSeeTracking} disabled={busy} onChange={e => toggle(e.target.checked)} className="h-5 w-5 accent-[#0E6E62]" />
        <span><strong>Reps can see proposal tracking</strong> on their own deals{settings.repsSeeTracking ? '' : ' (now off: they see only whether the link is live and whether it was accepted)'}</span>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      </label>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'}`}>{msg.text}</p>}
    </section>
  );
}

// Client contact colours (Joel, 2026-10-18): days since a client's last touch point. Saved in
// config/client_contact_colours (Management only; everyone reads it).
function ContactColourLimits({ viewer }: { viewer: Viewer }) {
  const { limits, meta } = useContactLimits();
  const [green, setGreen] = useState(String(limits.green));
  const [amber, setAmber] = useState(String(limits.amber));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (!dirty) { setGreen(String(limits.green)); setAmber(String(limits.amber)); } }, [limits, dirty]);
  const g = Math.round(Number(green)), a = Math.round(Number(amber));

  const save = async () => {
    setMsg(null);
    if (!Number.isFinite(g) || g < 1 || g > 365) return setMsg({ ok: false, text: 'Green: type a number of days from 1 to 365.' });
    if (!Number.isFinite(a) || a <= g || a > 730) return setMsg({ ok: false, text: 'Amber must be more days than green (and at most 730).' });
    setBusy(true);
    try {
      await setDoc(doc(db, 'config', 'client_contact_colours'), { green: g, amber: a, updatedAt: new Date().toISOString(), updatedById: viewer.id, updatedByName: viewer.name });
      setDirty(false);
      setMsg({ ok: true, text: 'Saved. The client colours use it straight away.' });
    } catch (e) {
      setMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };
  const edit = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { set(e.target.value.replace(/[^0-9]/g, '')); setDirty(true); setMsg(null); };

  return (
    <section className={`${card} space-y-4`}>
      <div>
        <h3 className="font-bold">Client contact colours</h3>
        <p className="text-sm text-ink-soft">The dot next to each client, from the days since its last touch point. Shown on the client list, the client page and deal panels.</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[15px]">
        <label className="flex items-center gap-2"><ContactDot colour="green" /> Green up to
          <input inputMode="numeric" value={green} onChange={edit(setGreen)} className={input} aria-label="Green: up to this many days" /> days</label>
        <label className="flex items-center gap-2"><ContactDot colour="amber" /> Amber up to
          <input inputMode="numeric" value={amber} onChange={edit(setAmber)} className={input} aria-label="Amber: up to this many days" /> days</label>
        <span className="flex items-center gap-2"><ContactDot colour="red" /> Red after {Number.isFinite(a) && a > 0 ? a : '…'} days</span>
        <span className="flex items-center gap-2"><ContactDot colour="never" /> Grey: never contacted</span>
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2.5 text-sm ${msg.ok ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'}`}>{msg.text}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !dirty} className={btnPrimary} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save colours</button>
        <button type="button" className={btnSecondary} onClick={() => { setGreen(String(DEFAULT_CONTACT_LIMITS.green)); setAmber(String(DEFAULT_CONTACT_LIMITS.amber)); setDirty(true); setMsg(null); }}>
          <RotateCcw className="h-4 w-4" /> Back to 30 and 90 days
        </button>
        {meta?.updatedByName && <span className="text-sm text-ink-soft">Last changed by {meta.updatedByName}, {new Date(meta.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
      </div>
    </section>
  );
}
