'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BarChart3,
  Bell,
  CalendarCheck,
  Gauge,
  FileSpreadsheet,
  Inbox,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageCircle,
  PlugZap,
  Settings,
  Users,
  Download,
  Menu,
  X,
} from 'lucide-react';
import { logout } from '@/app/actions/auth';

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/leads', label: 'Leads & follow-ups', icon: Users },
  { href: '/sending', label: 'Sending volume', icon: Gauge },
  { href: '/spreadsheets', label: 'Spreadsheets', icon: FileSpreadsheet },
  { href: '/whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { href: '/coverage', label: 'Data coverage', icon: CalendarCheck },
  { href: '/reports', label: 'Reports & exports', icon: Download },
  { href: '/integrations', label: 'Integrations', icon: PlugZap },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar({ email, attention }: { email: string; attention: Record<string, number> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const brand = (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">
        <BarChart3 size={18} aria-hidden />
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold text-white">Rohit Kumar SEO</div>
        <div className="text-xs text-navy-300">Outreach</div>
      </div>
    </div>
  );
  return (
    <>
      {/* Phone / tablet: compact top bar with a slide-in navigation drawer. */}
      <div className="sticky top-0 z-40 flex items-center justify-between bg-navy-900 px-4 py-3 lg:hidden">
        {brand}
        <button type="button" onClick={() => setOpen(true)} className="rounded-md p-2 text-white hover:bg-navy-800" aria-label="Open navigation" aria-expanded={open}>
          <Menu size={20} aria-hidden />
        </button>
      </div>
      {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col bg-navy-900 text-navy-300 transition-transform lg:static lg:z-auto lg:h-full lg:w-60 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Sidebar"
      >
        <div className="flex items-center justify-between px-5 pb-6 pt-6">
          {brand}
          <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-navy-300 hover:text-white lg:hidden" aria-label="Close navigation">
            <X size={18} aria-hidden />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? path === '/' : path.startsWith(href);
            const badge = attention[href];
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                  active ? 'bg-navy-700 font-medium text-white' : 'hover:bg-navy-800 hover:text-white'
                }`}
              >
                <Icon size={17} aria-hidden className={active ? 'text-white' : 'text-navy-300'} />
                <span className="flex-1">{label}</span>
                {badge ? (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white tabular ${href === '/alerts' ? 'bg-critical' : 'bg-brand'}`} aria-label={`${badge} need attention`}>
                    {badge > 99 ? '99+' : badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-navy-800 px-4 py-4">
          <div className="truncate text-xs text-navy-300" title={email}>
            {email}
          </div>
          <form action={logout}>
            <button type="submit" className="mt-2 flex items-center gap-2 text-xs text-navy-300 hover:text-white">
              <LogOut size={14} aria-hidden /> Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
