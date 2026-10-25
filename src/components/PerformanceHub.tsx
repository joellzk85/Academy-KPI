import React, { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Gauge, Settings2 } from 'lucide-react';
import Appraisal, { ReliabilitySettingsDialog, ScorecardSources, useReliabilitySettings } from './Appraisal';
import AppraisalRound from './AppraisalRound';
import KpiSetEditor from './KpiSetEditor';
import KpiLibraryPanel from './KpiLibraryPanel';
import { ItemsForm, useRatingItems } from './Rating360';
import { Fold, SkillsForm, useScorecard, WeightsForm } from './Scorecard';
import { db } from '../lib/firebase';
import { defaultTemplateIdFor, hasKpis, metricsFor, RepLike, templateById } from '../lib/kpi';
import { TeamMember } from '../types';

// KPI & appraisal (Joel, 2026-10-25): one Management tab for everything about KPIs and the appraisal. It starts
// in the private room (owner only); the owner can untick it there to bring it back to Management (lib/privateScreens.ts).
// - Scorecards: each person's performance scorecard for a period (Appraisal.tsx).
// - Appraisal round: Commence appraisal, deadline, progress, close and release (AppraisalRound.tsx).
// - Settings, each folding away: KPIs for each person and the KPI library (moved here from Team), weights and
//   levels, competency skills (one fold per group), HEART values, reliability score.

type Tab = 'scorecards' | 'round' | 'settings';
const TABS: [Tab, string][] = [['scorecards', 'Scorecards'], ['round', 'Appraisal round'], ['settings', 'Settings']];
const secondaryBtn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-50';

export default function PerformanceHub({ currentMember, teamMembers, settingsOf, kpiOf, deals }: {
  currentMember: TeamMember;
  teamMembers: TeamMember[];
  settingsOf: (memberId: string) => RepLike;
  kpiOf: (memberId: string, month: string) => any;
  deals: any[];
}) {
  const [tab, setTab] = useState<Tab>('scorecards');
  const viewer = { id: currentMember.id, name: currentMember.name, role: currentMember.role };
  const active = teamMembers.filter(m => m.active);
  const people = active.map(m => ({ id: m.id, name: m.name, role: m.role }));
  const settings = useScorecard();
  const src: ScorecardSources = { people, settings, settingsOf, kpiOf, deals };
  return (
    <div className="space-y-5 font-sans text-ink">
      <div>
        <h2 className="text-xl font-bold">KPI & appraisal</h2>
        <p className="mt-0.5 text-[15px] text-ink-soft">KPIs, scorecards, the appraisal round and every setting for them, in one place.</p>
      </div>
      <div className="inline-flex max-w-full flex-wrap rounded-lg border border-line bg-white p-0.5" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-md px-3.5 py-1.5 text-sm font-semibold ${tab === k ? 'bg-accent text-white' : 'text-ink-soft hover:text-ink'}`}>{l}</button>
        ))}
      </div>
      {tab === 'scorecards' && <Appraisal viewer={viewer} {...src} />}
      {tab === 'round' && <AppraisalRound viewer={viewer} src={src} />}
      {tab === 'settings' && <SettingsTab currentMember={currentMember} members={active} viewer={viewer} people={people} />}
    </div>
  );
}

function SettingsTab({ currentMember, members, viewer, people }: {
  currentMember: TeamMember; members: TeamMember[]; viewer: { id: string; name: string; role: TeamMember['role'] }; people: { id: string; name: string; role: string }[];
}) {
  const settings = useScorecard();
  const ratingItems = useRatingItems();
  const reliability = useReliabilitySettings();
  const [kpiDocs, setKpiDocs] = useState<Record<string, any>>({});
  useEffect(() => onSnapshot(collection(db, 'reps'), snap => {
    const next: Record<string, any> = {};
    snap.forEach(d => { next[d.id] = d.data(); });
    setKpiDocs(next);
  }, () => {}), []);
  const [kpiPerson, setKpiPerson] = useState<TeamMember | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [relOpen, setRelOpen] = useState(false);
  const [notice, setNotice] = useState('');
  // Management have no KPIs unless a KPI set is chosen for them (Joel, 2026-10-17).
  const kpiSummary = (m: TeamMember) => {
    const saved = kpiDocs[m.id];
    if (!hasKpis(saved, m.role)) return 'None';
    if (saved?.kpiSet?.items?.length) {
      const n = metricsFor({ id: m.id, role: m.role, kpiSet: saved.kpiSet }).length;
      return `Own set, ${n} KPI${n === 1 ? '' : 's'}`;
    }
    const chosen = templateById(saved?.kpiTemplate);
    return chosen ? chosen.name : `${templateById(defaultTemplateIdFor(m.role))!.name} (default)`;
  };
  const usedBy = (kpiId: string) => members
    .filter(m => (kpiDocs[m.id]?.kpiSet?.items || []).some((i: any) => i.kpiId === kpiId))
    .map(m => m.name);
  return (
    <div className="space-y-3">
      {notice && <p role="status" className="rounded-lg bg-accent-soft px-4 py-3 text-[15px] text-accent">{notice}</p>}
      <Fold open title="KPIs for each person" note="Each person's KPI set, targets and colour bands, and the KPI library they are picked from.">
        <button type="button" className={secondaryBtn} onClick={() => setLibraryOpen(true)}><Gauge className="h-3.5 w-3.5" /> KPI library</button>
        <ul className="divide-y divide-line">
          {members.map(m => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span><span className="block font-semibold">{m.name}</span><span className="block text-sm text-ink-soft">{kpiSummary(m)}</span></span>
              <button type="button" className={secondaryBtn} onClick={() => setKpiPerson(m)}><Gauge className="h-3.5 w-3.5" /> KPIs</button>
            </li>
          ))}
        </ul>
      </Fold>
      <Fold title="Weights and levels" note="How much Performance, Competency and Behavioural count for each level, and each person's level.">
        <WeightsForm viewer={viewer} people={people} settings={settings} />
      </Fold>
      <Fold title="Competency skills" note="Role skills, Growth and Leadership, each folding away.">
        <SkillsForm viewer={viewer} settings={settings} />
      </Fold>
      <Fold title="HEART values" note="The values rated in the 360, the manager review and the self review.">
        <ItemsForm viewer={viewer} items={ratingItems} />
      </Fold>
      <Fold title="Reliability score" note="How days in the Login log turn into the 1 to 5 reliability score.">
        <p className="text-[15px] text-ink-soft">
          5 / 5 when at least {reliability.s5}% of days are green or amber, 4 / 5 from {reliability.s4}%, 3 / 5 from {reliability.s3}%, 2 / 5 from {reliability.s2}%; minus {reliability.incidentDeduction} for each incident.
        </p>
        <button type="button" className={secondaryBtn} onClick={() => setRelOpen(true)}><Settings2 className="h-4 w-4" /> Change the reliability score</button>
      </Fold>
      {kpiPerson && (
        <KpiSetEditor member={kpiPerson} viewer={currentMember} saved={kpiDocs[kpiPerson.id]}
          onClose={() => setKpiPerson(null)} onSaved={text => { setNotice(text); setKpiPerson(null); }} />
      )}
      {libraryOpen && (
        <KpiLibraryPanel viewer={currentMember} usedBy={usedBy}
          onClose={() => setLibraryOpen(false)} onSaved={text => { setNotice(text); setLibraryOpen(false); }} />
      )}
      {relOpen && <ReliabilitySettingsDialog viewer={viewer} settings={reliability} onClose={() => setRelOpen(false)} />}
    </div>
  );
}
