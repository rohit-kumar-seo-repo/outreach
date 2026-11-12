'use client';

import { SlidersHorizontal } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

export function WaInboxFilters({ accounts, campaigns }: { accounts: string[]; campaigns: { slug: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const active = ['account', 'campaign', 'from', 'to'].filter((k) => sp.get(k)).length;
  // On a phone the extra filters fold away behind one button; they are always shown on wider screens.
  const [open, setOpen] = useState(active > 0);

  function go(patch: Record<string, string>) {
    const u = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) u.set(k, v);
      else u.delete(k);
    }
    u.delete('openChat');
    u.delete('openSession');
    start(() => router.push(`${pathname}?${u.toString()}`));
  }

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <input
        type="search"
        placeholder="Search name, number, message…"
        className="field min-w-0 flex-1 py-1 text-[12.5px] sm:order-last"
        defaultValue={sp.get('q') ?? ''}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go({ q: (e.target as HTMLInputElement).value });
        }}
      />
      <button type="button" className="btn sm:hidden" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <SlidersHorizontal size={15} aria-hidden /> Filters{active ? ` (${active})` : ''}
      </button>
      <div className={`${open ? 'flex' : 'hidden'} w-full flex-wrap items-center gap-2 sm:flex sm:w-auto`}>
        <select className="field py-1 text-[12.5px]" value={sp.get('account') ?? ''} onChange={(e) => go({ account: e.target.value })} aria-label="Account">
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select className="field py-1 text-[12.5px]" value={sp.get('campaign') ?? ''} onChange={(e) => go({ campaign: e.target.value })} aria-label="Campaign">
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <input type="date" className="field py-1 text-[12.5px]" value={sp.get('from') ?? ''} onChange={(e) => go({ from: e.target.value })} aria-label="From date" />
        <input type="date" className="field py-1 text-[12.5px]" value={sp.get('to') ?? ''} onChange={(e) => go({ to: e.target.value })} aria-label="To date" />
      </div>
      {[...sp.keys()].some((k) => k !== 'view') && (
        <button type="button" className="btn btn-sm" onClick={() => start(() => router.push(pathname))}>
          Reset
        </button>
      )}
    </div>
  );
}
