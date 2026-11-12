'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function TabNav({ tabs }: { tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="WhatsApp sections">
      <div className="flex gap-1 rounded-2xl bg-white p-1 shadow-[var(--shadow-card)] ring-1 ring-line">
        {tabs.map((t) => {
          const active = t.href === '/whatsapp' ? path === '/whatsapp' : path.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={`relative whitespace-nowrap rounded-xl px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${active ? 'text-white' : 'text-ink-2 hover:text-ink'}`}
            >
              {active && <motion.span layoutId="wa-tab-active" className="absolute inset-0 rounded-xl bg-[#128c7e]" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
              <span className="relative">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
