'use client';

import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Bell,
  CalendarCheck,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Gauge,
  Home,
  Inbox,
  LineChart,
  LogOut,
  Megaphone,
  Menu,
  MessageCircle,
  Phone,
  PlugZap,
  Search,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { logout } from '@/app/actions/auth';

type Item = { href: string; label: string; icon: typeof Home };

const WORK: Item[] = [
  { href: '/', label: 'Today', icon: Home },
  { href: '/leads', label: 'Leads', icon: Users },
  { href: '/call', label: 'Call mode', icon: Phone },
  { href: '/inbox', label: 'Email inbox', icon: Inbox },
  { href: '/whatsapp', label: 'WhatsApp', icon: MessageCircle },
];
const OUTREACH: Item[] = [
  { href: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/overview', label: 'Performance', icon: LineChart },
  { href: '/sending', label: 'Sending volume', icon: Gauge },
  { href: '/reports', label: 'Reports & exports', icon: Download },
];
const ADMIN: Item[] = [
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/integrations', label: 'Integrations', icon: PlugZap },
  { href: '/spreadsheets', label: 'Spreadsheets', icon: FileSpreadsheet },
  { href: '/coverage', label: 'Data coverage', icon: CalendarCheck },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const TABS: Item[] = [
  { href: '/', label: 'Today', icon: Home },
  { href: '/leads', label: 'Leads', icon: Users },
  { href: '/call', label: 'Call', icon: Phone },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/whatsapp', label: 'WhatsApp', icon: MessageCircle },
];

function isActive(path: string, href: string) {
  return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand to-indigo-600 text-[13px] font-bold text-white shadow-sm">
        RK
      </span>
      <span className="leading-tight">
        <span className="block text-[14px] font-semibold text-ink">Outreach</span>
        <span className="block text-[11px] text-ink-3">Rohit Kumar SEO</span>
      </span>
    </Link>
  );
}

function NavLink({ item, path, badge, onNavigate }: { item: Item; path: string; badge?: number; onNavigate?: () => void }) {
  const active = isActive(path, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] ${active ? 'font-semibold text-ink' : 'text-ink-2 hover:bg-slate-100 hover:text-ink'}`}
    >
      {active && (
        <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-white shadow-[0_1px_2px_rgba(16,24,40,0.08)] ring-1 ring-line" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />
      )}
      <Icon size={17} aria-hidden className={`relative z-10 ${active ? 'text-brand' : 'text-ink-3'}`} />
      <span className="relative z-10 flex-1">{item.label}</span>
      {badge ? (
        <span
          className={`relative z-10 min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10.5px] font-semibold text-white tabular ${item.href === '/alerts' ? 'bg-critical' : 'bg-brand'}`}
          aria-label={`${badge} need attention`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  );
}

function Group({ title, items, path, attention, onNavigate, collapsible }: { title?: string; items: Item[]; path: string; attention: Record<string, number>; onNavigate?: () => void; collapsible?: boolean }) {
  const hasActive = items.some((i) => isActive(path, i.href));
  const total = items.reduce((n, i) => n + (attention[i.href] ?? 0), 0);
  const [open, setOpen] = useState(!collapsible || hasActive);
  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);
  return (
    <div className="mt-5 first:mt-0">
      {title &&
        (collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mb-1 flex w-full items-center justify-between px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3 hover:text-ink-2"
            aria-expanded={open}
          >
            <span className="flex items-center gap-1.5">
              {title}
              {!open && total > 0 && <span className="h-1.5 w-1.5 rounded-full bg-critical" aria-label="needs attention" />}
            </span>
            <ChevronDown size={14} className={`transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden />
          </button>
        ) : (
          <div className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{title}</div>
        ))}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="space-y-0.5 overflow-hidden">
            {items.map((item) => (
              <NavLink key={item.href} item={item} path={path} badge={attention[item.href]} onNavigate={onNavigate} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Sidebar({ email, attention }: { email: string; attention: Record<string, number> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
  }, [open]);

  const nav = (onNavigate?: () => void) => (
    <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
      <Group items={WORK} path={path} attention={attention} onNavigate={onNavigate} />
      <Group title="Outreach" items={OUTREACH} path={path} attention={attention} onNavigate={onNavigate} />
      <Group title="Admin" items={ADMIN} path={path} attention={attention} onNavigate={onNavigate} collapsible />
    </nav>
  );
  const footer = (
    <div className="border-t border-line px-4 py-3">
      <div className="truncate text-[12px] text-ink-3" title={email}>
        {email}
      </div>
      <form action={logout}>
        <button type="submit" className="mt-1.5 flex items-center gap-2 text-[12px] font-medium text-ink-2 hover:text-ink">
          <LogOut size={14} aria-hidden /> Sign out
        </button>
      </form>
    </div>
  );

  return (
    <>
      {/* Phone / tablet top bar. */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-line/70 bg-white/85 px-4 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur-lg lg:hidden">
        <Brand />
        <div className="flex items-center gap-1">
          <Link href="/leads?view=contacts&focus=1" className="icon-btn" aria-label="Search leads">
            <Search size={19} aria-hidden />
          </Link>
          <button type="button" onClick={() => setOpen(true)} className="icon-btn relative" aria-label="Open menu" aria-expanded={open}>
            <Menu size={20} aria-hidden />
            {(attention['/alerts'] ?? 0) + (attention['/integrations'] ?? 0) > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-critical ring-2 ring-white" />}
          </button>
        </div>
      </header>

      {/* Phone / tablet menu drawer (everything, including admin pages). */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-[2px] lg:hidden" onClick={() => setOpen(false)} aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.aside
              className="fixed inset-y-0 right-0 z-50 flex w-[82%] max-w-80 flex-col bg-canvas shadow-2xl lg:hidden"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              aria-label="Menu"
            >
              <div className="flex items-center justify-between px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
                <Brand />
                <button type="button" onClick={() => setOpen(false)} className="icon-btn" aria-label="Close menu">
                  <X size={20} aria-hidden />
                </button>
              </div>
              {nav(() => setOpen(false))}
              <div className="pb-[env(safe-area-inset-bottom)]">{footer}</div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop sidebar. */}
      <aside className="hidden h-full w-60 shrink-0 flex-col border-r border-line bg-canvas lg:flex" aria-label="Sidebar">
        <div className="px-5 pb-5 pt-5">
          <Brand />
        </div>
        {nav()}
        {footer}
      </aside>
    </>
  );
}

/** Phone bottom tab bar: the five things used every day, with Call mode in the middle. */
export function BottomNav({ attention }: { attention: Record<string, number> }) {
  const path = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line/80 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden"
      aria-label="Primary"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {TABS.map((t) => {
          const active = isActive(path, t.href);
          const Icon = t.icon;
          const badge = attention[t.href] ?? 0;
          if (t.href === '/call') {
            return (
              <li key={t.href} className="flex justify-center">
                <Link href={t.href} aria-current={active ? 'page' : undefined} className="-mt-5 flex flex-col items-center gap-0.5" aria-label="Call mode">
                  <span className={`flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-600/30 ring-4 ring-white transition-transform active:scale-95`}>
                    <Icon size={24} aria-hidden />
                  </span>
                  <span className={`text-[10.5px] font-medium ${active ? 'text-emerald-700' : 'text-ink-3'}`}>{t.label}</span>
                </Link>
              </li>
            );
          }
          return (
            <li key={t.href}>
              <Link href={t.href} aria-current={active ? 'page' : undefined} className="relative flex flex-col items-center gap-0.5 pb-1.5 pt-2">
                <span className="relative">
                  <Icon size={22} aria-hidden className={active ? 'text-brand' : 'text-ink-3'} strokeWidth={active ? 2.3 : 1.9} />
                  {badge > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 min-w-[18px] rounded-full bg-critical px-1 text-center text-[10px] font-semibold leading-[18px] text-white ring-2 ring-white tabular">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </span>
                <span className={`text-[10.5px] ${active ? 'font-semibold text-brand' : 'text-ink-3'}`}>{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
