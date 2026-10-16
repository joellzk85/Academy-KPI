import React, { useState } from 'react';
import { BarChart3, BookOpen, Building2, ChevronsLeft, ChevronsRight, FileText, FolderOpen, GraduationCap, ListTodo, MapPin, TrendingUp } from 'lucide-react';

// The workspace's left menu. It can be collapsed to a slim strip of icons (remembered per browser).
// On small screens it becomes a row of buttons that scrolls sideways.

export type MenuKey = 'kpi' | 'pipeline' | 'quotation' | 'course_outline' | 'client' | 'trainerList' | 'venue' | 'admin_record' | 'tasks';

export interface MenuItem { key: MenuKey; label: string; alert?: string }

const ICONS: Record<MenuKey, React.ComponentType<{ className?: string }>> = {
  kpi: BarChart3,
  pipeline: TrendingUp,
  quotation: FileText,
  course_outline: BookOpen,
  client: Building2,
  trainerList: GraduationCap,
  venue: MapPin,
  admin_record: FolderOpen,
  tasks: ListTodo,
};

const STORE_KEY = 'next_menu_collapsed';

export default function WorkspaceMenu({ items, active, onSelect }: { items: MenuItem[]; active: string; onSelect: (k: MenuKey) => void }) {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(STORE_KEY) === '1'; } catch { return false; } });
  const toggle = () => setCollapsed(c => { try { localStorage.setItem(STORE_KEY, c ? '0' : '1'); } catch { /* private window */ } return !c; });

  return (
    <nav aria-label="Workspace menu" className={`shrink-0 font-sans text-ink lg:sticky lg:top-24 ${collapsed ? 'lg:w-16' : 'lg:w-56'}`}>
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
        <button type="button" onClick={toggle} className="mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold text-ink-soft hover:bg-surface"
          aria-label={collapsed ? 'Show menu' : 'Hide menu'} title={collapsed ? 'Show menu' : 'Hide menu'}>
          {collapsed ? <ChevronsRight className="mx-auto h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Hide menu</>}
        </button>
        <ul className="space-y-0.5">
          {items.map(it => {
            const Icon = ICONS[it.key];
            const on = active === it.key;
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
      </div>
    </nav>
  );
}

// Plain names for each menu item (also used for the page header).
export const MENU_LABELS: Record<MenuKey, string> = {
  kpi: 'KPI', pipeline: 'Deals', quotation: 'Quotations', course_outline: 'Course outlines', client: 'Clients',
  trainerList: 'Trainers', venue: 'Venues', admin_record: 'Admin records', tasks: 'Pending tasks',
};
