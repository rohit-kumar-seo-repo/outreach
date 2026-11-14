'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface Tab {
  href: string;
  label: string;
  /** Active only on this exact path (a section's home tab); otherwise on the path and everything under it. */
  exact?: boolean;
}

/** Pill tabs for a section with several pages (WhatsApp, Results). `tone` colours the active pill. */
export function TabNav({ tabs, label, tone = 'brand' }: { tabs: Tab[]; label: string; tone?: 'brand' | 'whatsapp' }) {
  const path = usePathname();
  const pill = tone === 'whatsapp' ? 'bg-[#128c7e]' : 'bg-gradient-to-r from-[#111827] to-[#312e81]';
  return (
    <nav className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label={label}>
      <div className="flex gap-1 rounded-2xl bg-white p-1 shadow-[var(--shadow-card)] ring-1 ring-line">
        {tabs.map((t) => {
          const active = t.exact ? path === t.href : path === t.href || path.startsWith(`${t.href}/`);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={`relative whitespace-nowrap rounded-xl px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${active ? 'text-white' : 'text-ink-2 hover:text-ink'}`}
            >
              {active && <motion.span layoutId={`tab-active-${label}`} className={`absolute inset-0 rounded-xl ${pill}`} transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
              <span className="relative">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
