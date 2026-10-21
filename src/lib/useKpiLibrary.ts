// Live KPI library from config/kpi_library (see src/lib/kpiLibrary.ts). App.tsx runs it once, so every screen
// (KPI page, Team, Project P&L, the Costing estimator) uses the same KPIs, bands and GP setting.
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { activeKpiLibrary, KpiLibrary, readKpiLibrary, setActiveKpiLibrary } from './kpiLibrary';

export function useKpiLibrary(): { library: KpiLibrary; loaded: boolean } {
  const [state, setState] = useState<{ library: KpiLibrary; loaded: boolean }>({ library: activeKpiLibrary(), loaded: false });
  useEffect(() => onSnapshot(doc(db, 'config', 'kpi_library'), s => {
    const library = readKpiLibrary(s.exists() ? s.data() : null);
    setActiveKpiLibrary(library);
    setState({ library, loaded: true });
  }, () => setState(x => ({ ...x, loaded: true }))), []);
  return state;
}
