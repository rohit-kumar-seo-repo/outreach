'use client';

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
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-[13.5px] font-medium transition-colors ${
              active ? 'border-brand text-brand' : 'border-transparent text-ink-2 hover:border-line-strong hover:text-ink'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
