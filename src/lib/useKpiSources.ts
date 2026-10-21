import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query } from 'firebase/firestore';
import { callServer, db } from './firebase';
import { GpFigure, KpiSources, metricsFor, monthPrefix, RepLike } from './kpi';
import { withoutDeleted } from './linked';
import { DEFAULT_MONEY_SETTINGS, MoneySettings, readMoneySettings } from './money';
import { DEFAULT_FORECAST, ForecastSettings, readForecastSettings } from './forecast';
import { isGpMeasure } from './kpiLibrary';

// Live lists for the KPIs that aren't counted from deals (lib/kpi.ts): money_in (HRDC claims, client invoices and
// payments), the venue list, the admin checklists, the money and forecast settings, training reports and teambuilding
// activities (trainer KPIs), and, when one of `people` has a
// gross profit KPI, the GP % of `months` ('OCT-26' style) from the server (serverKpi.ts).
export function useKpiSources(opts: { months?: string[]; people?: RepLike[] } = {}): KpiSources {
  const [claims, setClaims] = useState<any[]>([]);
  const [venues, setVenues] = useState<any[]>([]);
  const [checklists, setChecklists] = useState<Record<string, any[]>>({});
  const [moneySettings, setMoneySettings] = useState<MoneySettings>(DEFAULT_MONEY_SETTINGS);
  const [forecast, setForecast] = useState<ForecastSettings>(DEFAULT_FORECAST);
  const [gp, setGp] = useState<Record<string, Record<string, GpFigure>>>({});
  const [trainingReports, setTrainingReports] = useState<Record<string, any>>({});
  const [activities, setActivities] = useState<any[]>([]);
  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, 'money_in')), s => setClaims(withoutDeleted(s.docs.map(d => ({ ...d.data(), id: d.id })))), () => setClaims([])),
      onSnapshot(query(collection(db, 'venues_directory')), s => setVenues(s.docs.map(d => ({ ...d.data(), id: d.id }))), () => setVenues([])),
      onSnapshot(query(collection(db, 'deal_checklists')), s => setChecklists(Object.fromEntries(s.docs.map(d => [d.id, (d.data() as any).tasks || []]))), () => setChecklists({})),
      onSnapshot(doc(db, 'config', 'money_settings'), d => setMoneySettings(readMoneySettings(d.data())), () => {}),
      onSnapshot(doc(db, 'config', 'forecast_settings'), d => setForecast(readForecastSettings(d.data())), () => {}),
      // Trainer KPIs: training reports (by deal) and teambuilding activities (approval).
      onSnapshot(query(collection(db, 'training_reports')), s => setTrainingReports(Object.fromEntries(s.docs.map(d => [d.id, d.data()]))), () => setTrainingReports({})),
      onSnapshot(query(collection(db, 'tb_activities')), s => setActivities(s.docs.map(d => ({ ...d.data(), id: d.id }))), () => setActivities([])),
    ];
    return () => subs.forEach(u => u());
  }, []);

  const needGp = (opts.people || []).some(p => metricsFor(p).some(m => m.auto && isGpMeasure(m.auto)));
  const monthKey = (opts.months || []).map(monthPrefix).filter(Boolean).sort().join(',');
  useEffect(() => {
    if (!needGp || !monthKey) return;
    let live = true;
    callServer<{ gp: Record<string, Record<string, GpFigure>> }>('/api/kpi/gp', { months: monthKey.split(',') }, true)
      .then(r => { if (live) setGp(g => ({ ...g, ...(r.gp || {}) })); })
      .catch(() => {});
    return () => { live = false; };
  }, [needGp, monthKey]);

  return useMemo(() => ({ claims, venues, checklists, moneySettings, forecast, gp, trainingReports, activities }),
    [claims, venues, checklists, moneySettings, forecast, gp, trainingReports, activities]);
}
