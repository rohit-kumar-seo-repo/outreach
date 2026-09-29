'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

interface Option {
  value: string;
  label: string;
}

const PRESETS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'mtd', label: 'Month to date' },
  { value: 'custom', label: 'Custom range' },
];

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** One filter row above everything it scopes. State lives in the URL so views are shareable/bookmarkable. */
export function FilterBar({
  today,
  campaigns,
  domains,
  mailboxes,
  show = { campaign: true, domain: true, mailbox: true, channel: true, range: true },
}: {
  today: string;
  campaigns: Option[];
  domains: string[];
  mailboxes: string[];
  show?: Partial<Record<'campaign' | 'domain' | 'mailbox' | 'channel' | 'range', boolean>>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '' || v === 'all') next.delete(k);
      else next.set(k, v);
    }
    start(() => router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false }));
  };

  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const preset = sp.get('range') ?? (from || to ? 'custom' : '30');

  const applyPreset = (v: string) => {
    const t = new Date(`${today}T00:00:00Z`);
    if (v === 'custom') return set({ range: 'custom' });
    let f: Date;
    if (v === 'mtd') f = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
    else f = new Date(t.getTime() - (Number(v) - 1) * 86400_000);
    set({ range: v === '30' ? null : v, from: v === '30' ? null : iso(f), to: v === '30' ? null : today });
  };

  return (
    <div className={`card mb-5 flex flex-wrap items-end gap-3 px-4 py-3 ${pending ? 'opacity-70' : ''}`} aria-busy={pending}>
      {show.range !== false && (
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
          Date range
          <select className="field" value={preset} onChange={(e) => applyPreset(e.target.value)}>
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {show.range !== false && preset === 'custom' && (
        <>
          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
            From
            <input type="date" className="field" defaultValue={from} max={today} onChange={(e) => set({ from: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
            To
            <input type="date" className="field" defaultValue={to || today} max={today} onChange={(e) => set({ to: e.target.value })} />
          </label>
        </>
      )}
      {show.campaign !== false && (
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
          Campaign
          <select className="field max-w-64" value={sp.get('campaign') ?? ''} onChange={(e) => set({ campaign: e.target.value })}>
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {show.domain !== false && (
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
          Domain
          <select className="field" value={sp.get('domain') ?? ''} onChange={(e) => set({ domain: e.target.value, mailbox: null })}>
            <option value="">All domains</option>
            {domains.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      )}
      {show.mailbox !== false && (
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
          Mailbox
          <select className="field max-w-64" value={sp.get('mailbox') ?? ''} onChange={(e) => set({ mailbox: e.target.value })}>
            <option value="">All mailboxes</option>
            {mailboxes
              .filter((m) => !sp.get('domain') || m.endsWith(`@${sp.get('domain')}`))
              .map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
          </select>
        </label>
      )}
      {show.channel !== false && (
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
          Channel
          <select className="field" value={sp.get('channel') ?? 'all'} onChange={(e) => set({ channel: e.target.value })}>
            <option value="all">Email + WhatsApp</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </label>
      )}
      {[...sp.keys()].length > 0 && (
        <button type="button" className="btn btn-sm ml-auto" onClick={() => start(() => router.replace(pathname, { scroll: false }))}>
          Reset filters
        </button>
      )}
    </div>
  );
}
