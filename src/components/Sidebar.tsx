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

function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-[13px] font-bold text-white shadow-[0_6px_16px_-6px_rgba(139,92,246,0.8)] ring-1 ring-white/20">
        RK
      </span>
      <span className="leading-tight">
        <span className={`block text-[14px] font-semibold ${dark ? 'text-white' : 'text-ink'}`}>Outreach</span>
        <span className={`block text-[11px] ${dark ? 'text-slate-400' : 'text-ink-3'}`}>Rohit Kumar SEO</span>
      </span>
    </Link>
  );
}

/** Midnight panel with a soft aurora at the top (desktop sidebar and the phone menu). */
const PANEL_BG =
  'bg-[#0a0e1f] [background-image:radial-gradient(22rem_16rem_at_0%_0%,rgba(99,102,241,0.32),transparent_70%),radial-gradient(18rem_14rem_at_100%_18%,rgba(217,70,239,0.14),transparent_70%),radial-gradient(20rem_16rem_at_20%_100%,rgba(6,182,212,0.1),transparent_70%)]';

function NavLink({ item, path, badge, onNavigate }: { item: Item; path: string; badge?: number; onNavigate?: () => void }) {
  const active = isActive(path, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-[13.5px] ${active ? 'font-semibold text-white' : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'}`}
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          className="absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-500/30 via-violet-500/20 to-fuchsia-500/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ring-1 ring-white/10"
          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
        >
          <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-indigo-400 to-fuchsia-400" />
        </motion.span>
      )}
      <Icon size={17} aria-hidden className={`relative z-10 ${active ? 'text-indigo-200' : 'text-slate-400'}`} />
      <span className="relative z-10 flex-1">{item.label}</span>
      {badge ? (
        <span
          className={`relative z-10 min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10.5px] font-semibold text-white tabular ${item.href === '/alerts' ? 'bg-critical' : 'bg-gradient-to-r from-indigo-500 to-fuchsia-500 shadow-[0_4px_10px_-4px_rgba(217,70,239,0.8)]'}`}
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
            className="mb-1 flex w-full items-center justify-between px-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300"
            aria-expanded={open}
          >
            <span className="flex items-center gap-1.5">
              {title}
              {!open && total > 0 && <span className="h-1.5 w-1.5 rounded-full bg-critical" aria-label="needs attention" />}
            </span>
            <ChevronDown size={14} className={`transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden />
          </button>
        ) : (
          <div className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</div>
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
    <div className="border-t border-white/10 px-4 py-3">
      <div className="truncate text-[12px] text-slate-400" title={email}>
        {email}
      </div>
      <form action={logout}>
        <button type="submit" className="mt-1.5 flex items-center gap-2 text-[12px] font-medium text-slate-300 hover:text-white">
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
              className={`fixed inset-y-0 right-0 z-50 flex w-[82%] max-w-80 flex-col shadow-2xl lg:hidden ${PANEL_BG}`}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              aria-label="Menu"
            >
              <div className="flex items-center justify-between px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
                <Brand dark />
                <button type="button" onClick={() => setOpen(false)} className="icon-btn text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Close menu">
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
      <aside className={`hidden h-full w-60 shrink-0 flex-col lg:flex ${PANEL_BG}`} aria-label="Sidebar">
        <div className="px-5 pb-5 pt-5">
          <Brand dark />
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/60 bg-white/80 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_-12px_rgba(49,46,129,0.25)] backdrop-blur-xl backdrop-saturate-150 lg:hidden"
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
                  <span className="grad-call btn-shine flex h-14 w-14 items-center justify-center rounded-full ring-4 ring-white transition-transform active:scale-95">
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
                {active && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500" aria-hidden />}
                <span className="relative">
                  <Icon size={22} aria-hidden className={active ? 'text-brand' : 'text-ink-3'} strokeWidth={active ? 2.3 : 1.9} />
                  {badge > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 min-w-[18px] rounded-full bg-gradient-to-r from-rose-500 to-fuchsia-500 px-1 text-center text-[10px] font-semibold leading-[18px] text-white ring-2 ring-white tabular">
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
