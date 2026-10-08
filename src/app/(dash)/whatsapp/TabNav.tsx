'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function TabNav({ tabs }: { tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="WhatsApp sections">
      {tabs.map((t) => {
        const active = t.href === '/whatsapp' ? path === '/whatsapp' : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`relative whitespace-nowrap px-3 py-2.5 text-[13.5px] font-medium transition-colors ${active ? 'text-brand' : 'text-ink-2 hover:text-ink'}`}
          >
            {t.label}
            <span className="absolute inset-x-3 bottom-0 h-0.5">
              {active && <motion.span layoutId="wa-tab-active" className="block h-full rounded-full bg-brand" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
