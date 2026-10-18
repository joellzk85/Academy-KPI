import React, { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { ArrowDown, ArrowUp, ArrowUpDown, BarChart3, BookOpen, Building2, ChevronsLeft, ChevronsRight, ClipboardCheck, FileText, GraduationCap, ListTodo, MapPin, TrendingUp } from 'lucide-react';

// The workspace's left menu. It can be collapsed to a slim strip of icons (remembered per browser).
// On small screens it becomes a row of buttons that scrolls sideways.
// "Arrange menu" lets each person reorder the items (Joel, 2026-10-17), saved on their own prefs
// (user_prefs/{their id}.menuOrder), so a manager opening someone's workspace sees their own order.
// Only the order changes: which items appear is still decided by the person's role.

export type MenuKey = 'kpi' | 'pipeline' | 'quotation' | 'course_outline' | 'client' | 'trainerList' | 'venue' | 'admin_work' | 'tasks';

export interface MenuItem { key: MenuKey; label: string; alert?: string }

const ICONS: Record<MenuKey, React.ComponentType<{ className?: string }>> = {
  kpi: BarChart3,
  pipeline: TrendingUp,
  quotation: FileText,
  course_outline: BookOpen,
  client: Building2,
  trainerList: GraduationCap,
  venue: MapPin,
  admin_work: ClipboardCheck,
  tasks: ListTodo,
};

const STORE_KEY = 'next_menu_collapsed';

export default function WorkspaceMenu({ items: allowedItems, active, onSelect, prefsId, ownerLabel }: {
  items: MenuItem[]; active: string; onSelect: (k: MenuKey) => void; prefsId?: string;
  ownerLabel?: string;   // shown only when viewing someone else's workspace, e.g. "Alif's workspace"
}) {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(STORE_KEY) === '1'; } catch { return false; } });
  const toggle = () => setCollapsed(c => { try { localStorage.setItem(STORE_KEY, c ? '0' : '1'); } catch { /* private window */ } return !c; });

  // The person's own order. Items they may see but haven't placed yet keep their usual place at the end.
  const [order, setOrder] = useState<MenuKey[] | null>(null);
  const [arranging, setArranging] = useState(false);
  useEffect(() => {
    if (!prefsId) return;
    return onSnapshot(doc(db, 'user_prefs', prefsId), s => { const o = s.data()?.menuOrder; setOrder(Array.isArray(o) ? o : null); }, () => setOrder(null));
  }, [prefsId]);
  const items = order
    ? [...order.map(k => allowedItems.find(it => it.key === k)).filter((x): x is MenuItem => !!x), ...allowedItems.filter(it => !order.includes(it.key))]
    : allowedItems;
  const saveOrder = (next: MenuKey[] | null) => {
    setOrder(next);
    if (prefsId) setDoc(doc(db, 'user_prefs', prefsId), { menuOrder: next, updatedAt: Date.now() }, { merge: true }).catch(() => { /* kept on screen; retried next change */ });
  };
  const move = (k: MenuKey, by: number) => {
    const keys = items.map(it => it.key);
    const i = keys.indexOf(k), j = i + by;
    if (i < 0 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    saveOrder(keys);
  };

  return (
    <nav aria-label="Workspace menu" className={`shrink-0 font-sans text-ink lg:sticky lg:top-24 ${collapsed ? 'lg:w-16' : 'lg:w-56'}`}>
      {ownerLabel && <p className="mb-2 truncate text-sm font-semibold text-accent lg:hidden">{ownerLabel}</p>}
      {/* Phone and tablet: one scrolling row */}
      <div className="flex gap-2 overflow-x-auto pb-1 lg:hidden">
        {items.map(it => {
          const Icon = ICONS[it.key];
          const on = active === it.key;
          return (
            <button key={it.key} type="button" onClick={() => onSelect(it.key)}
              className={`relative flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-ink-soft'}`}>
              <Icon className="h-4 w-4" />{it.label}
              {it.alert && <span className="h-2 w-2 rounded-full bg-danger" aria-label={it.alert} />}
            </button>
          );
        })}
      </div>

      {/* Desktop: side menu */}
      <div className="hidden rounded-2xl border border-line bg-white p-2 lg:block">
        {ownerLabel && !collapsed && <p className="mb-1 truncate border-b border-line px-2.5 pb-2 pt-1 text-sm font-semibold text-accent" title={ownerLabel}>{ownerLabel}</p>}
        <button type="button" onClick={toggle} className="mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold text-ink-soft hover:bg-surface"
          aria-label={collapsed ? 'Show menu' : 'Hide menu'} title={collapsed ? 'Show menu' : 'Hide menu'}>
          {collapsed ? <ChevronsRight className="mx-auto h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Hide menu</>}
        </button>
        <ul className="space-y-0.5">
          {items.map((it, i) => {
            const Icon = ICONS[it.key];
            const on = active === it.key;
            if (arranging && !collapsed) return (
              <li key={it.key} className="flex items-center gap-1 rounded-lg border border-line px-2 py-1.5 text-[15px] font-semibold">
                <Icon className="h-[18px] w-[18px] shrink-0 text-ink-soft" />
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                <button type="button" disabled={i === 0} onClick={() => move(it.key, -1)} aria-label={`Move ${it.label} up`} className="rounded p-1 text-ink-soft hover:bg-surface disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                <button type="button" disabled={i === items.length - 1} onClick={() => move(it.key, 1)} aria-label={`Move ${it.label} down`} className="rounded p-1 text-ink-soft hover:bg-surface disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
              </li>
            );
            return (
              <li key={it.key}>
                <button type="button" onClick={() => onSelect(it.key)} title={collapsed ? `${it.label}${it.alert ? ` (${it.alert})` : ''}` : it.alert}
                  aria-current={on ? 'page' : undefined}
                  className={`relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[15px] font-semibold transition-colors ${on ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-surface'} ${collapsed ? 'justify-center' : ''}`}>
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  {!collapsed && <span className="min-w-0 flex-1 truncate">{it.label}</span>}
                  {it.alert && <span className={`h-2 w-2 shrink-0 rounded-full bg-danger ${collapsed ? 'absolute right-2 top-2' : ''}`} />}
                </button>
              </li>
            );
          })}
        </ul>
        {prefsId && !collapsed && (
          <div className="mt-1 border-t border-line pt-1">
            <button type="button" onClick={() => setArranging(a => !a)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold text-ink-soft hover:bg-surface">
              <ArrowUpDown className="h-4 w-4" /> {arranging ? 'Done arranging' : 'Arrange menu'}
            </button>
            {arranging && order && (
              <button type="button" onClick={() => saveOrder(null)} className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm font-semibold text-accent hover:underline">Reset order</button>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}

// Plain names for each menu item (also used for the page header).
export const MENU_LABELS: Record<MenuKey, string> = {
  kpi: 'KPI', pipeline: 'Deals', quotation: 'Quotations', course_outline: 'Course outlines', client: 'Clients',
  trainerList: 'Trainers', venue: 'Venues', admin_work: 'Admin work', tasks: 'To-do',
};
