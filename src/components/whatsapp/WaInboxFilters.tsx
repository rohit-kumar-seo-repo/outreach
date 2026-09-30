'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

export function WaInboxFilters({ accounts, campaigns }: { accounts: string[]; campaigns: { slug: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

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
      <select className="field py-1 text-[12.5px]" value={sp.get('account') ?? ''} onChange={(e) => go({ account: e.target.value })}>
        <option value="">All accounts</option>
        {accounts.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <select className="field py-1 text-[12.5px]" value={sp.get('campaign') ?? ''} onChange={(e) => go({ campaign: e.target.value })}>
        <option value="">All campaigns</option>
        {campaigns.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.name}
          </option>
        ))}
      </select>
      <input type="date" className="field py-1 text-[12.5px]" value={sp.get('from') ?? ''} onChange={(e) => go({ from: e.target.value })} />
      <input type="date" className="field py-1 text-[12.5px]" value={sp.get('to') ?? ''} onChange={(e) => go({ to: e.target.value })} />
      <input
        type="search"
        placeholder="Search name, number, message…"
        className="field min-w-0 flex-1 py-1 text-[12.5px]"
        defaultValue={sp.get('q') ?? ''}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go({ q: (e.target as HTMLInputElement).value });
        }}
      />
      {[...sp.keys()].some((k) => k !== 'view') && (
        <button type="button" className="btn btn-sm" onClick={() => start(() => router.push(pathname))}>
          Reset
        </button>
      )}
    </div>
  );
}
