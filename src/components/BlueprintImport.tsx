import React, { useState } from 'react';
import { arrayUnion, collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { AlertTriangle, Check, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { callServer, db, friendlyError } from '../lib/firebase';
import { BlueprintRows, BpProgramme, Change, ImportPlan, planImport, resolveProgrammeRef } from '../lib/blueprint';

// Management → Data tools → Import from Blueprint (2026-10-20). Pick the Blueprint Excel file; the server reads it
// (serverBlueprint.ts), this screen shows what would change, and nothing is written until Import is clicked.
// Programmes, venues and trainers' "Programmes they teach" are updated ("spreadsheet wins", Joel); the Sales sheet's
// lines go to Management → Payment tracking. Course outlines and the client list are not touched (Joel).

type Viewer = { id: string; name: string };
type Op = (b: ReturnType<typeof writeBatch>) => void;

const btnPrimary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-60';

async function commitInChunks(ops: Op[]) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach(op => op(batch));
    await batch.commit();
  }
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error("The file couldn't be opened."));
    r.readAsDataURL(file);
  });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function BlueprintImport({ viewer }: { viewer: Viewer }) {
  const [fileName, setFileName] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setMsg(null); setPlan(null); setFileName(file.name);
    if (!/\.xlsx$/i.test(file.name)) return setMsg({ ok: false, text: 'Choose the Excel file (.xlsx). In Google Sheets: File → Download → Microsoft Excel (.xlsx).' });
    if (file.size > 10 * 1024 * 1024) return setMsg({ ok: false, text: 'That file is over 10 MB. Check you picked the Blueprint file.' });
    setReading(true);
    try {
      const { rows } = await callServer<{ rows: BlueprintRows }>('/api/blueprint/read', { file: await toBase64(file) }, true);
      const [programmes, venues, trainers, payments] = await Promise.all(
        ['programmes', 'venues_directory', 'trainers_directory', 'payment_records'].map(c => getDocs(collection(db, c))),
      );
      setPlan(planImport(rows, {
        programmes: programmes.docs.map(d => ({ ...d.data(), id: d.id })),
        venues: venues.docs.map(d => ({ ...d.data(), id: d.id })),
        trainers: trainers.docs.map(d => ({ ...d.data(), id: d.id })) as any[],
        paymentIds: payments.docs.map(d => d.id),
      }));
    } catch (err) {
      setMsg({ ok: false, text: friendlyError(err) });
    } finally {
      setReading(false);
    }
  };

  const total = plan ? plan.programmes.add.length + plan.programmes.update.length + plan.trainers.tick.length + plan.venues.add.length + plan.venues.update.length + plan.payments.add.length : 0;

  const runImport = async () => {
    if (!plan) return;
    setImporting(true); setMsg(null);
    const now = Date.now();
    const by = { importedFrom: 'blueprint', updatedAt: now, updatedById: viewer.id, updatedByName: viewer.name };
    const ops: Op[] = [];
    const newIds = new Map<BpProgramme, string>();
    plan.programmes.add.forEach((p, i) => {
      const id = `prog_${now}_${i}`;
      newIds.set(p, id);
      ops.push(b => b.set(doc(db, 'programmes', id), {
        id, name: p.name, category: p.category, ...(p.days ? { days: p.days } : {}),
        hrdcStatus: p.registered ? 'approved' : 'not_registered', hrdcCode: p.hrdcCode, submittedDate: '', approvedDate: '', notes: '',
        createdAt: now, createdById: viewer.id, createdByName: viewer.name, ...by,
      }));
    });
    plan.programmes.update.forEach(u => ops.push(b => b.set(doc(db, 'programmes', u.id), { ...u.data, ...by }, { merge: true })));
    plan.trainers.tick.forEach(t => {
      const ids = t.add.map(ref => resolveProgrammeRef(ref, plan, newIds)).filter(Boolean);
      if (ids.length) ops.push(b => b.update(doc(db, 'trainers_directory', t.id), { programmeIds: arrayUnion(...ids) }));
    });
    plan.venues.add.forEach((v, i) => {
      const id = `venue_${now}_${i}`;
      // Not credited to anyone's "Venue database" KPI: no createdBy (the KPI counts venues a person added).
      ops.push(b => b.set(doc(db, 'venues_directory', id), { id, ...v, pictures: '', photos: [], status: 'Available', createdAt: now, createdBy: '', createdByName: 'Blueprint import', ...by }));
    });
    plan.venues.update.forEach(u => ops.push(b => b.set(doc(db, 'venues_directory', u.id), { ...u.data, ...by }, { merge: true })));
    // Payment lines go last, on their own, so programmes and venues are saved even if the payment_records rule isn't published yet.
    const payOps: Op[] = plan.payments.add.map(l => (b: ReturnType<typeof writeBatch>) => b.set(doc(db, 'payment_records', l.id), { ...l, importedAt: now, importedById: viewer.id, importedByName: viewer.name }));
    let stage = 'lists';
    try {
      await commitInChunks(ops);
      stage = 'payments';
      await commitInChunks(payOps);
      const parts = [
        plan.programmes.add.length || plan.programmes.update.length ? `programmes: ${plan.programmes.add.length} added, ${plan.programmes.update.length} updated` : '',
        plan.trainers.tick.length ? `${plural(plan.trainers.tick.length, 'trainer')} given their programmes` : '',
        plan.venues.add.length || plan.venues.update.length ? `venues: ${plan.venues.add.length} added, ${plan.venues.update.length} updated` : '',
        plan.payments.add.length ? `${plural(plan.payments.add.length, 'payment line')} added to Payment tracking` : '',
      ].filter(Boolean);
      setMsg({ ok: true, text: `Done. ${parts.join('; ')}.` });
      setPlan(null);
    } catch (err) {
      setMsg({ ok: false, text: stage === 'payments'
        ? `Programmes, trainers and venues were saved, but the payment lines weren't: ${friendlyError(err)} If the database rules for Payment tracking aren't published yet, publish them, then choose the file again.`
        : `${friendlyError(err)} Some of it may have been saved; choose the file again to see what's left.` });
      if (stage === 'payments') setPlan(null);
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <h3 className="flex items-center gap-2 font-bold"><FileSpreadsheet className="h-4 w-4 text-accent" /> Import from the Blueprint spreadsheet</h3>
      <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">
        Updates the <b>Programme list</b> (category, HRDC code, number of days, and the trainers who teach each one), the <b>Venue list</b> (with region)
        and <b>Payment tracking</b> (the Sales sheet) from the "Next Academy Blueprint" Excel file. Where something is already in the CRM, the spreadsheet's
        details win; photos and anything the spreadsheet leaves blank stay. Course outlines and the client list are not touched. You'll see what would change first.
      </p>
      <label className={`${btnSecondary} mt-4 cursor-pointer`}>
        {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {reading ? `Reading ${fileName}…` : plan ? 'Choose another file' : 'Choose the Excel file'}
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={reading || importing}
          onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      </label>

      {plan && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-ink-soft">From {fileName}:</p>
          <Group title="Programmes" summary={`${plan.programmes.add.length} new · ${plan.programmes.update.length} updated · ${plan.programmes.same} already the same`}>
            {plan.programmes.add.length > 0 && <Sub title="New">{plan.programmes.add.map(p => (
              <li key={p.name}>{p.name} <span className="text-ink-soft">· {[p.category, p.registered ? `HRDC ${p.hrdcCode}` : 'Not registered', p.days ? `${p.days} day${p.days === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</span></li>
            ))}</Sub>}
            {plan.programmes.update.length > 0 && <Sub title="Updated">{plan.programmes.update.map(u => <ChangeRow key={u.id} name={u.name} changes={u.changes} />)}</Sub>}
            {plan.programmes.kept.length > 0 && <Sub title="Kept as in the CRM">{plan.programmes.kept.map(k => <li key={k}>{k}</li>)}</Sub>}
          </Group>
          <Group title="Trainers" summary={`${plan.trainers.tick.length} trainer${plan.trainers.tick.length === 1 ? '' : 's'} get programmes ticked · ${plan.trainers.unmatched.length} name${plan.trainers.unmatched.length === 1 ? '' : 's'} not in the Trainers list`}>
            {plan.trainers.tick.length > 0 && <Sub title="Programmes they teach (added, none removed)">{plan.trainers.tick.map(t => (
              <li key={t.id}><b>{t.name}</b> <span className="text-ink-soft">· {t.programmeNames.join(', ')}</span></li>
            ))}</Sub>}
            {plan.trainers.unmatched.length > 0 && <Sub title="Not found in Trainers (nothing is created; add them in Trainers, then import again)"><li>{plan.trainers.unmatched.join(', ')}</li></Sub>}
          </Group>
          <Group title="Venues" summary={`${plan.venues.add.length} new · ${plan.venues.update.length} updated · ${plan.venues.same} already the same`}>
            {plan.venues.add.length > 0 && <Sub title="New">{plan.venues.add.map(v => <li key={v.name}>{v.name} <span className="text-ink-soft">· {v.region}</span></li>)}</Sub>}
            {plan.venues.update.length > 0 && <Sub title="Updated">{plan.venues.update.map(u => <ChangeRow key={u.id} name={u.name} changes={u.changes} />)}</Sub>}
          </Group>
          <Group title="Payment tracking" summary={`${plan.payments.add.length} new line${plan.payments.add.length === 1 ? '' : 's'} · ${plan.payments.existing} already imported (kept as they are in the CRM)`}>
            {plan.payments.add.length > 0 && <Sub title="New lines by month">{Object.entries(plan.payments.add.reduce((m: Record<string, number>, l) => { m[l.month] = (m[l.month] || 0) + 1; return m; }, {})).map(([m, n]) => (
              <li key={m}>{new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}: {n}</li>
            ))}</Sub>}
          </Group>
          {plan.warnings.length > 0 && (
            <div className="rounded-xl border border-attention/30 bg-attention-soft p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-attention"><AlertTriangle className="h-4 w-4" /> Please check</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">{plan.warnings.map(w => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={btnSecondary} disabled={importing} onClick={() => setPlan(null)}>Cancel</button>
            <button type="button" className={btnPrimary} disabled={importing || total === 0} onClick={runImport}>
              {importing && <Loader2 className="h-4 w-4 animate-spin" />} {total === 0 ? 'Nothing to import' : 'Import'}
            </button>
          </div>
        </div>
      )}
      {msg && <p role="status" className={`mt-3 flex items-start gap-2 rounded-lg px-4 py-3 text-[15px] ${msg.ok ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'}`}>{msg.ok && <Check className="mt-0.5 h-4 w-4 shrink-0" />}{msg.text}</p>}
    </section>
  );
}

function Group({ title, summary, children }: { title: string; summary: string; children: React.ReactNode }) {
  return (
    <details className="rounded-xl border border-line">
      <summary className="cursor-pointer px-4 py-3 text-[15px]"><b>{title}</b> <span className="text-ink-soft">· {summary}</span></summary>
      <div className="space-y-3 border-t border-line px-4 py-3">{children}</div>
    </details>
  );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-semibold text-ink-soft">{title}</p>
      <ul className="mt-1 max-h-72 space-y-1 overflow-y-auto text-sm">{children}</ul>
    </div>
  );
}

function ChangeRow({ name, changes }: { name: string; changes: Change[] }) {
  const short = (s: string) => (s.length > 70 ? `${s.slice(0, 70).replace(/\n/g, ' ')}…` : s.replace(/\n/g, ' '));
  return (
    <li>
      <b>{name}</b>
      <ul className="ml-4 text-ink-soft">{changes.map(c => <li key={c.field}>{c.field}: {short(c.from)} → <span className="text-ink">{short(c.to)}</span></li>)}</ul>
    </li>
  );
}
