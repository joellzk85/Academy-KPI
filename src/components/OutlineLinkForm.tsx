import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Eye, Loader2 } from 'lucide-react';
import CourseOutlineDocument from './CourseOutlineDocument';
import OutlineSections, { newModule } from './OutlineSections';
import { CourseOutline } from '../types';
import { OutlineSubmission, cleanOutline, outlineFieldsFrom, outlineProblem, previewOutline } from '../lib/trainerLinks';
import { outlineTypeFields, outlineTypeOf, programmeTypeOf } from '../lib/outlineTb';

// The trainer's course outline form on a private link (/t/<token>) and in the trainer portal, with a Preview of the
// outline as NEXT Academy prints it (Joel, 2026-10-20). Since 2026-10-26 it shows the CRM outline editor's own parts
// (OutlineSections.tsx: type, course details, overview, modules, agenda, extras); the deal, terms and sharing stay in
// the CRM. Talks only to the CRM server. No download or print: the team sends the finished outline.

const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-60';
const NO_PRINT = '@media print { html { display: none !important; } }';

/** The form's outline from what was saved: the trainer's parts, the title and its type. */
function toOutline(s: OutlineSubmission | null, programmeId: string, programmeName: string, programme?: any): CourseOutline {
  const f = s ? outlineFieldsFrom(s) : {};
  const title = (s?.courseTitle || '').trim();
  const items = f.items?.length ? f.items : [newModule()];
  return {
    id: 'trainer', refNumber: '', date: '', category: '', level: 'Beginner', kind: 'training',
    durationDays: 1, totalHours: 8, audience: '', prerequisites: '', overview: '', outcomes: [], methods: [], agenda: [],
    ...f, items,
    // A new outline takes its title's type, as in the CRM; a saved one keeps its own.
    ...outlineTypeFields(s?.type || programmeTypeOf(programme)),
    programmeId, courseTitle: title,
    useProgrammeName: !!programmeName && (!title || title.toUpperCase() === programmeName.trim().toUpperCase()),
  } as CourseOutline;
}

// The trainer portal (2026-10-21) uses the same form for a trainer's own outlines: onData gets every change (saved as
// they type) with the title picked from the list, and actions replaces the Submit button.
export default function OutlineLinkForm({ info, token = '', post, onDone, onData, actions, programmes = [], programmeId = '' }: {
  info: any; token?: string; post?: (path: string, body: any) => Promise<any>; onDone?: (sent: OutlineSubmission, res?: any) => void;
  onData?: (data: OutlineSubmission, programmeId: string) => void; actions?: React.ReactNode;
  programmes?: any[];   // the portal: titles to pick from (the link's title is set by NEXT Academy)
  programmeId?: string;
}) {
  const progOf = (id: string) => programmes.find(p => p.id === id);
  const [o, setO] = useState<CourseOutline>(() => {
    const s = info.prefill ? cleanOutline(info.prefill) : null;
    return toOutline(s, programmeId, programmes.length ? String(progOf(programmeId)?.name || '') : info.title || '', progOf(programmeId));
  });
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const progId = programmes.length ? o.programmeId || '' : programmeId;
  const progName = programmes.length ? String(progOf(progId)?.name || '') : String(info.title || '');
  // What is saved: the title empty when it's the one from the list (the link keeps sending it, as before).
  const data = useMemo(() => cleanOutline({
    ...o, type: outlineTypeOf(o), level: undefined,
    courseTitle: o.useProgrammeName && progName ? (programmes.length ? '' : progName) : o.courseTitle,
  }), [o, progName]);
  useEffect(() => { onData?.(data, progId); }, [data, progId]);
  const shown = useMemo(() => (preview ? previewOutline(data, progName) : null), [preview, data, progName]);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setProblem('');
    const p = outlineProblem(data);
    if (p) { setPreview(false); setProblem(p); return; }
    setBusy(true);
    try {
      // stamp: the outline as it was when the link opened (the server refuses a submit on top of a newer change).
      const res = await post?.('/api/trainer-link/submit', { token, data, ...(info.stamp ? { stamp: info.stamp } : {}) });
      onDone?.(data, res);
      window.scrollTo(0, 0);
    } catch (err: any) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitBar = (
    <>
      {problem && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{problem}</p>}
      <div className="flex flex-wrap justify-end gap-2 pb-10">
        {preview
          ? <button type="button" className={btnSecondary} onClick={() => { setPreview(false); window.scrollTo(0, 0); }}><ArrowLeft className="h-4 w-4" /> Back to edit</button>
          : <button type="button" className={btnSecondary} onClick={() => { setPreview(true); window.scrollTo(0, 0); }}><Eye className="h-4 w-4" /> Preview</button>}
        {actions ?? <button type="button" disabled={busy} className={btnPrimary} onClick={() => submit()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Submit</button>}
      </div>
    </>
  );

  if (preview && shown) {
    return (
      <div className="space-y-4">
        <style dangerouslySetInnerHTML={{ __html: NO_PRINT }} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={btnSecondary} onClick={() => { setPreview(false); window.scrollTo(0, 0); }}><ArrowLeft className="h-4 w-4" /> Back to edit</button>
          <p className="text-sm text-ink-soft">How your outline will look when NEXT Academy sends it. The client's name goes on the cover.</p>
        </div>
        <CourseOutlineDocument o={shown} />
        {submitBar}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <OutlineSections o={o} setO={setO} programmes={programmes} programmeId={progId} programmeName={progName} firstNo={1} />
      {submitBar}
    </form>
  );
}
