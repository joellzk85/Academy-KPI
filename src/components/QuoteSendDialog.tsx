import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { AlertTriangle, CheckCircle2, Download, FileText, Link2, Loader2, Mail, MessageCircle, Send, X } from 'lucide-react';
import { callServer, db, friendlyError } from '../lib/firebase';
import { pdfErrorText } from '../lib/oldTab';
import { CourseOutline, Quotation, QuoteSendEntry } from '../types';
import { clientContacts, dealContact } from '../lib/contacts';
import { blobToBase64, downloadBlob, makeOutlinePdf, makeQuotationPdf, outlinePdfFileName, pdfFileName } from '../lib/quotePdf';
import { waPhone, onPhone } from '../lib/whatsapp';
import DocLinkBox, { LimitsPicker, MakeLinkButton, openLinkOf, useDocLinks, useLinkSettings } from './DocLinkBox';
import { defaultExpiry, opensProblem } from '../lib/linkLimits';
import { canSeeTracking, expiryProblem, plusDaysMY } from '../lib/proposalTracking';
import { useProposalSettings } from '../lib/useProposalSettings';
import { DocKind } from '../lib/docLinks';

// Send a quotation (2026-10-18): 1) Email from my own Outlook mailbox with the PDF attached (serverMail.ts),
// 2) WhatsApp (phones: the share menu with the PDF; computers: the PDF downloads and the client's chat opens
// with the message typed), 3) Download PDF (and "Mark as sent" when it was sent another way).
// Email and WhatsApp mark the quotation sent and add a line to its sendLog.
// Course outlines use the same window (2026-10-19): sending an outline is sending the proposal (CourseOutlinesPage.tsx).
// Since 2026-10-19 (Joel) the window shows only "Client link" (a private web page, DocLinkBox.tsx / serverDocLinks.ts)
// and Download PDF; Email and WhatsApp are hidden by SHOW_EMAIL_WHATSAPP, their code kept for later.

type Viewer = { id: string; name: string; role: 'rep' | 'admin' | 'management' };
type Channel = 'link' | 'email' | 'whatsapp' | 'pdf';

// Joel (2026-10-19): send by private client link or Download PDF only for now. Email (Outlook) and WhatsApp are
// hidden, not removed: set this to true to bring their tabs back.
const SHOW_EMAIL_WHATSAPP = false;

const input =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';
const label = 'mb-1 block text-sm font-semibold text-ink';
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0B5A50] disabled:opacity-60';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60';

const sizeText = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

type CommonProps = {
  locked: boolean;                   // already sent (this is a resend)
  issues: string[];                  // missing details
  deal: any; client: any; ownerId: string; me: Viewer;
  ensureSaved: () => Promise<boolean>;
  onSent: (entry: QuoteSendEntry) => Promise<boolean>;   // locks it as sent and logs the entry
  onClose: () => void;
};

// What's being sent (exactly what prints now): a quotation, or a course outline (the proposal).
type SendDoc = {
  kind: 'quotation' | 'outline' | 'teambuilding'; id: string; refNumber: string; company: string; attn: string;
  programmes: string[]; fileName: string; makePdf: () => Promise<Blob>;
};

export default function QuoteSendDialog({ shownQ, ...rest }: CommonProps & { shownQ: Quotation }) {
  const doc: SendDoc = {
    kind: 'quotation', id: shownQ.id, refNumber: shownQ.refNumber, company: shownQ.company || '', attn: shownQ.attn || '',
    programmes: (shownQ.items || []).filter(i => i.kind !== 'item').map(i => i.program).filter(Boolean),
    fileName: pdfFileName(shownQ), makePdf: () => makeQuotationPdf(shownQ),
  };
  return <SendDocDialog doc={doc} {...rest} />;
}

export function OutlineSendDialog({ shownO, ...rest }: CommonProps & { shownO: CourseOutline }) {
  const doc: SendDoc = {
    kind: 'outline', id: shownO.id, refNumber: shownO.refNumber, company: shownO.preparedForCompany || '', attn: '',
    programmes: shownO.courseTitle ? [shownO.courseTitle] : [],
    fileName: outlinePdfFileName(shownO), makePdf: () => makeOutlinePdf(shownO),
  };
  return <SendDocDialog doc={doc} {...rest} />;
}

// Teambuilding proposals (2026-10-19) use the same window: sending one is sending the proposal (TeambuildingPage.tsx).
export function TeambuildingSendDialog({ sendDoc, ...rest }: CommonProps & { sendDoc: Omit<SendDoc, 'kind'> }) {
  return <SendDocDialog doc={{ ...sendDoc, kind: 'teambuilding' }} {...rest} />;
}

function SendDocDialog({ doc: shownQ, locked, issues, deal, client, ownerId, me, ensureSaved, onSent, onClose }: CommonProps & { doc: SendDoc }) {
  const isQuote = shownQ.kind === 'quotation';
  const isTb = shownQ.kind === 'teambuilding';
  const noun = isQuote ? 'quotation' : isTb ? 'teambuilding proposal' : 'course outline';
  const Noun = isQuote ? 'Quotation' : isTb ? 'Teambuilding proposal' : 'Course outline';
  const [channel, setChannel] = useState<Channel>('link');
  // Every link's limits (2026-10-19): how long it works and how many opens, starting from Management's defaults.
  const linkSettings = useLinkSettings();
  const [expires, setExpires] = useState('');
  const [opens, setOpens] = useState('');
  useEffect(() => { setExpires(defaultExpiry(linkSettings)); setOpens(String(linkSettings.opens)); }, [linkSettings.days, linkSettings.opens]);
  const proposalSettings = useProposalSettings();
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [pdfError, setPdfError] = useState('');
  const [mail, setMail] = useState<{ configured: boolean; myEmail: string } | null>(null);
  const [workEmails, setWorkEmails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const contact = dealContact(deal, client);
  const attn = shownQ.attn || contact?.name || '';
  const programmes = shownQ.programmes;
  const progText = !programmes.length ? 'the training programme'
    : programmes.length === 1 ? programmes[0]
    : programmes.length === 2 ? `${programmes[0]} and ${programmes[1]}`
    : `${programmes[0]} and ${programmes.length - 1} other programmes`;
  const fileName = shownQ.fileName;
  const signOff = `${me.name}\nNEXT Academy`;

  // Email fields
  const contacts = clientContacts(client).filter(c => c.email);
  const [to, setTo] = useState(contact?.email || '');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(isQuote
    ? `Quotation ${shownQ.refNumber}${programmes[0] ? `: ${programmes[0]}` : ''}${shownQ.company ? ` for ${shownQ.company}` : ''}`
    : isTb ? `Teambuilding proposal${programmes[0] ? `: ${programmes[0]}` : ''}${shownQ.company ? ` for ${shownQ.company}` : ''}`
    : `Training proposal${programmes[0] ? `: ${programmes[0]}` : ''}${shownQ.company ? ` for ${shownQ.company}` : ''}`);
  const [body, setBody] = useState(isQuote
    ? `Dear ${attn || 'Sir/Madam'},\n\nThank you for your interest in ${progText}. Please find attached our quotation ${shownQ.refNumber} for your review.\n\nShould you have any questions, please feel free to contact me.\n\nThank you.\n\nBest regards,\n${signOff}`
    : `Dear ${attn || 'Sir/Madam'},\n\nThank you for your interest in ${progText}. Please find attached our proposed ${isTb ? 'teambuilding programme' : 'course outline'} for your review.\n\nShould you have any questions, or would like any changes, please feel free to contact me.\n\nThank you.\n\nBest regards,\n${signOff}`,
  );
  // WhatsApp fields
  const [phone, setPhone] = useState(contact?.phone || '');
  const [waText, setWaText] = useState(
    `Dear ${attn || 'Sir/Madam'}, thank you for your interest in ${progText}. Attached is our ${isQuote ? `quotation ${shownQ.refNumber}` : isTb ? 'teambuilding proposal' : 'proposed course outline'} for your review. Please let me know if you have any questions.\n\n${me.name}, NEXT Academy`,
  );

  // Client link (2026-10-19): a private web page of the sent copy. Making it locks the document and logs the send.
  const links = useDocLinks(shownQ.id);
  const [linkMade, setLinkMade] = useState('');   // the token just made (shown even before the live list has it)
  const docKind = shownQ.kind as DocKind;
  const openLink = openLinkOf(links, docKind)
    || (linkMade ? { token: linkMade, kind: docKind, docId: shownQ.id, dealId: '', refNumber: shownQ.refNumber, company: shownQ.company, status: 'open' as const, createdAt: Date.now(), byId: me.id, byName: me.name } : null);
  const linkMsg = isTb ? `Dear ${attn || 'Sir/Madam'}, thank you for your interest in our teambuilding programme. We've prepared a proposal especially for ${shownQ.company || 'your team'}: the programme, activities, venue options and packages. You can view it at the link below. Please let me know if you have any questions.` : `Dear ${attn || 'Sir/Madam'}, thank you for your interest in ${progText}. Please find our ${isQuote ? `quotation ${shownQ.refNumber}` : 'proposed course outline'} for your review at the link below. You can also download it as a PDF there. Please let me know if you have any questions.

${me.name}, NEXT Academy`;
  const makeLink = async () => {
    setError('');
    setBusy(true);
    try {
      if (!(await ensureSaved())) return setError(`Save the ${noun} first (see the message on the ${noun}).`);
      const problem = expiryProblem(expires) || opensProblem(Number(opens));
      if (problem) return setError(problem);
      const r = await callServer<{ token: string }>('/api/doc-link/create', { kind: docKind, id: shownQ.id, expires, opens: Number(opens) }, true);
      const ok = await onSent({ at: new Date().toISOString(), byId: me.id, byName: me.name, channel: 'link' });
      if (!ok) return setError(`The link was made, but the CRM could not mark the ${noun} as sent. Try again.`);
      setLinkMade(r.token);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  // Make the PDF as soon as the window opens, so Send / WhatsApp work in one click.
  useEffect(() => {
    let live = true;
    shownQ.makePdf().then(b => { if (live) setPdf(b); }).catch(e => { if (live) setPdfError(pdfErrorText(e)); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    callServer<{ configured: boolean; myEmail: string }>('/api/mail/status', {}, true)
      .then(s => setMail({ configured: !!s.configured, myEmail: s.myEmail || '' }))
      .catch(() => setMail({ configured: false, myEmail: '' }));
    return onSnapshot(collection(db, 'team_emails'), snap => {
      const next: Record<string, string> = {};
      snap.forEach(d => { next[d.id] = String(d.data().email || ''); });
      setWorkEmails(next);
    }, () => {});
  }, []);
  // CC the deal owner when someone else sends it.
  useEffect(() => {
    if (ownerId && ownerId !== me.id && workEmails[ownerId] && !cc) setCc(workEmails[ownerId]);
  }, [workEmails]);

  const finish = async (entry: Omit<QuoteSendEntry, 'at' | 'byId' | 'byName'>, message: string) => {
    const ok = await onSent({ at: new Date().toISOString(), byId: me.id, byName: me.name, ...entry });
    if (ok) setDone(message);
    else setError(`It was sent, but the CRM could not mark the ${noun} as sent. Use "Mark as sent" under Download PDF to try again.`);
  };

  const sendEmail = async () => {
    setError('');
    if (!to.trim()) return setError('Add the client\'s email address in To.');
    if (!pdf) return setError(pdfError || 'The PDF is still being made. Try again in a moment.');
    setBusy(true);
    try {
      if (!(await ensureSaved())) { setBusy(false); return setError(`Save the ${noun} first (see the message on the ${noun}).`); }
      const r = await callServer<{ to: string[]; cc: string[] }>('/api/mail/send', {
        [isQuote ? 'quotationId' : isTb ? 'tbProposalId' : 'outlineId']: shownQ.id, to, cc, subject, body, fileName, pdfBase64: await blobToBase64(pdf),
      }, true);
      await finish({ channel: 'email', to: r.to.join(', '), cc: r.cc.join(', ') }, `Emailed to ${r.to.join(', ')}. It's in your Outlook Sent Items.`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const phoneDigits = waPhone(phone);
  const shareOnPhone = useMemo(() => {
    if (!pdf || !onPhone()) return false;
    try { return !!navigator.canShare?.({ files: [new File([pdf], fileName, { type: 'application/pdf' })] }); } catch { return false; }
  }, [pdf]);

  const sendWhatsApp = async () => {
    setError('');
    if (!pdf) return setError(pdfError || 'The PDF is still being made. Try again in a moment.');
    if (shareOnPhone) {
      try {
        await navigator.share({ files: [new File([pdf], fileName, { type: 'application/pdf' })], text: waText, title: `${Noun} ${shownQ.refNumber}` });
      } catch (e: any) {
        if (e?.name === 'AbortError') return;   // closed the share menu
        return setError('Your phone could not open the share menu. Use Download PDF instead.');
      }
      setBusy(true);
      await finish({ channel: 'whatsapp', to: phoneDigits ? `+${phoneDigits}` : '' }, 'Shared. Check it went to the right chat in WhatsApp.');
      setBusy(false);
      return;
    }
    if (!phoneDigits) return setError('Add the client\'s WhatsApp number.');
    // Computer: open the chat first (straight from the click, so it isn't blocked), then download the PDF.
    window.open(`https://wa.me/${phoneDigits}?text=${encodeURIComponent(waText)}`, '_blank', 'noopener');
    downloadBlob(pdf, fileName);
    setBusy(true);
    await finish({ channel: 'whatsapp', to: `+${phoneDigits}` }, `WhatsApp opened for +${phoneDigits} and the PDF was downloaded. ${onPhone() ? 'Attach it in the chat (📎, Document)' : `Drag "${fileName}" into the chat`}, then press send.`);
    setBusy(false);
  };

  const download = () => { if (pdf) downloadBlob(pdf, fileName); };
  const markSent = async () => {
    setBusy(true);
    setError('');
    await finish({ channel: 'manual' }, 'Marked as sent and locked.');
    setBusy(false);
  };

  const tabs: [Channel, string, React.ReactNode][] = ([
    ['link', 'Client link', <Link2 className="h-4 w-4" />],
    ['email', 'Email', <Mail className="h-4 w-4" />],
    ['whatsapp', 'WhatsApp', <MessageCircle className="h-4 w-4" />],
    ['pdf', 'Download PDF', <Download className="h-4 w-4" />],
  ] as [Channel, string, React.ReactNode][]).filter(([k]) => (SHOW_EMAIL_WHATSAPP || (k !== 'email' && k !== 'whatsapp')));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-10" role="dialog" aria-modal="true" aria-labelledby="send-title" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-xl rounded-2xl bg-white p-5 font-sans text-ink shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 id="send-title" className="text-lg font-bold">{locked ? 'Send again' : isQuote ? 'Send quotation' : isTb ? 'Send teambuilding proposal' : 'Send course outline'}</h3>
            <p className="text-sm text-ink-soft">{shownQ.refNumber}{shownQ.company ? ` · ${shownQ.company}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md p-1 text-ink-soft hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        {done ? (
          <div className="space-y-4">
            <p role="status" className="flex items-start gap-2 rounded-xl bg-accent-soft px-4 py-3 text-[15px] text-accent"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />{done}</p>
            {channel === 'whatsapp' && !shareOnPhone && <button type="button" className={btnSecondary} onClick={download}><Download className="h-4 w-4" /> Download the PDF again</button>}
            <div className="flex justify-end"><button type="button" className={btnPrimary} onClick={onClose}>Close</button></div>
          </div>
        ) : (
          <>
            <div className="mb-4 grid gap-1 rounded-xl border border-line bg-surface p-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }} role="tablist">
              {tabs.map(([k, t, icon]) => (
                <button key={k} type="button" role="tab" aria-selected={channel === k} onClick={() => { setChannel(k); setError(''); }}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold ${channel === k ? 'bg-white text-ink shadow-sm' : 'text-ink-soft hover:text-ink'}`}>
                  {icon}{k === 'pdf' ? <><span className="sm:hidden">PDF</span><span className="hidden sm:inline">{t}</span></> : t}
                </button>
              ))}
            </div>

            {!locked && issues.length > 0 && (
              <div className="mb-4 rounded-xl bg-attention-soft px-4 py-3 text-sm text-attention">
                <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Some details are missing on the {noun}:</p>
                <ul className="mt-1 list-disc pl-6">{issues.map(i => <li key={i}>{i}</li>)}</ul>
              </div>
            )}

            {channel !== 'link' && <div className="mb-4 flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate">{fileName}</span>
              {pdf ? <span className="text-ink-soft">{sizeText(pdf.size)}</span>
                : pdfError ? <span className="text-danger">Couldn't make the PDF</span>
                : <span className="flex items-center gap-1 text-ink-soft"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Making PDF…</span>}
            </div>}
            {pdfError && channel !== 'link' && <p className="mb-4 text-sm text-danger">{pdfError}</p>}

            {channel === 'link' && (
              <div className="space-y-3">
                {openLink ? (
                  <>
                    {linkMade && <p role="status" className="flex items-start gap-2 rounded-xl bg-accent-soft px-4 py-3 text-[15px] text-accent"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />Link ready{locked ? '' : ` and the ${noun} is locked`}. Copy it and send it to the client (WhatsApp, email…).</p>}
                    {!linkMade && <p className="text-[15px] text-ink-soft">This {noun} already has a client link. Send it again any way you like.</p>}
                    <DocLinkBox link={openLink} message={linkMsg} showViews={!isTb || canSeeTracking(me.role, proposalSettings)} />
                  </>
                ) : (
                  <>
                    <p className="text-[15px] text-ink-soft">{isTb
                      ? 'Makes the private website of this proposal that the client opens in their browser, with no login. They can change the number of participants, compare the packages and accept it there. It always shows the latest saved version. Copy the link and send it any way you like.'
                      : `Makes a private web page of this ${noun} that the client opens in their browser, with no login, and can download as a PDF. Copy the link and send it any way you like. You'll see when the client opens it.`}{locked ? '' : ` Making it locks the ${noun}${deal ? ', and the deal moves on as with any send' : ''}.`}</p>
                    <div className="rounded-xl bg-surface p-3"><LimitsPicker date={expires} onDate={setExpires} opens={opens} onOpens={setOpens} settings={linkSettings} /></div>
                    <div className="flex justify-end"><MakeLinkButton busy={busy} onClick={makeLink} /></div>
                  </>
                )}
              </div>
            )}

            {channel === 'email' && (
              mail && !mail.configured ? (
                <p className="rounded-xl bg-surface px-4 py-3 text-[15px] text-ink-soft">Email sending isn't set up yet. Management can connect Outlook in Management → Team → Outlook email. Meanwhile, use Download PDF and send it from Outlook.</p>
              ) : mail && !mail.myEmail ? (
                <p className="rounded-xl bg-surface px-4 py-3 text-[15px] text-ink-soft">Your work email isn't in the CRM yet. Ask Management to add it in Team (Work email). Meanwhile, use Download PDF and send it from Outlook.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-ink-soft">From <strong className="text-ink">{mail ? mail.myEmail : '…'}</strong> (your Outlook; it'll be in your Sent Items)</p>
                  <div>
                    <label className={label} htmlFor="se-to">To</label>
                    <input id="se-to" value={to} onChange={e => setTo(e.target.value)} className={input} placeholder="client@company.com" autoComplete="off" />
                    {contacts.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {contacts.map(c => {
                          const on = to.toLowerCase().includes(String(c.email).toLowerCase());
                          return (
                            <button key={c.id} type="button" onClick={() => setTo(on ? to.split(/[,;]\s*/).filter(x => x.trim().toLowerCase() !== String(c.email).toLowerCase()).join(', ') : [to.trim(), c.email].filter(Boolean).join(', '))}
                              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-surface'}`}>
                              {c.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className={label} htmlFor="se-cc">CC <span className="font-normal text-ink-soft">(optional)</span></label>
                    <input id="se-cc" value={cc} onChange={e => setCc(e.target.value)} className={input} placeholder="Separate several with commas" autoComplete="off" />
                  </div>
                  <div>
                    <label className={label} htmlFor="se-subj">Subject</label>
                    <input id="se-subj" value={subject} onChange={e => setSubject(e.target.value)} className={input} />
                  </div>
                  <div>
                    <label className={label} htmlFor="se-body">Message</label>
                    <textarea id="se-body" value={body} onChange={e => setBody(e.target.value)} className={`${input} min-h-[200px]`} />
                  </div>
                  <div className="flex justify-end">
                    <button type="button" className={btnPrimary} disabled={busy || !mail || !pdf} onClick={sendEmail}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send email
                    </button>
                  </div>
                </div>
              )
            )}

            {channel === 'whatsapp' && (
              <div className="space-y-3">
                {!shareOnPhone && (
                  <div>
                    <label className={label} htmlFor="se-wa">Client's WhatsApp number</label>
                    <input id="se-wa" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} className={input} placeholder="012-345 6789" autoComplete="off" />
                    {phone.trim() && <p className="mt-1 text-sm text-ink-soft">{phoneDigits ? `Opens the chat with +${phoneDigits}` : "That doesn't look like a phone number."}</p>}
                  </div>
                )}
                <div>
                  <label className={label} htmlFor="se-watext">Message</label>
                  <textarea id="se-watext" value={waText} onChange={e => setWaText(e.target.value)} className={`${input} min-h-[120px]`} />
                </div>
                <p className="text-sm text-ink-soft">
                  {shareOnPhone
                    ? 'Your phone\'s share menu opens with the PDF attached. Choose WhatsApp, then the client\'s chat.'
                    : onPhone()
                      ? 'WhatsApp opens at the client\'s chat with the message typed, and the PDF downloads. Attach it in the chat (📎, Document), then press send.'
                      : 'WhatsApp opens (the app, or WhatsApp Web) at the client\'s chat with the message typed, and the PDF downloads. Drag the PDF into the chat, then press send.'}
                </p>
                <div className="flex justify-end">
                  <button type="button" className={btnPrimary} disabled={busy || !pdf} onClick={sendWhatsApp}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}{shareOnPhone ? 'Share to WhatsApp' : 'Open WhatsApp'}
                  </button>
                </div>
              </div>
            )}

            {channel === 'pdf' && (
              <div className="space-y-3">
                <p className="text-[15px] text-ink-soft">Download the PDF to send it yourself. When it's sent, click "Mark as sent" so the {noun} is locked and the deal moves on.</p>
                <div className="flex flex-wrap justify-end gap-2">
                  {!locked && <button type="button" className={btnSecondary} disabled={busy} onClick={markSent}><Send className="h-4 w-4" /> Mark as sent</button>}
                  <button type="button" className={btnPrimary} disabled={!pdf} onClick={download}><Download className="h-4 w-4" /> Download PDF</button>
                </div>
              </div>
            )}

            {error && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
