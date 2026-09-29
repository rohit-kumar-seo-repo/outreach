'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

export interface MailboxOption {
  address: string;
  domain: string;
  ok: boolean;
}

/** Domain and mailbox selectors. Picking a domain narrows the mailbox list to that domain. */
export function ScopePicker({ mailboxes, compact = false }: { mailboxes: MailboxOption[]; compact?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const domain = sp.get('domain') ?? '';
  const mailbox = sp.get('mailbox') ?? '';
  const domains = [...new Set(mailboxes.map((m) => m.domain))].sort();
  const visible = domain ? mailboxes.filter((m) => m.domain === domain) : mailboxes;

  function go(patch: Record<string, string>) {
    const u = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) u.set(k, v);
      else u.delete(k);
    }
    u.delete('page');
    u.delete('thread');
    start(() => router.push(`${pathname}?${u.toString()}`));
  }

  const field = `field w-full py-1.5 text-[13px] ${domain || mailbox ? 'border-brand/60' : ''}`;
  return (
    <div className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-1'}`} aria-busy={pending}>
      <label className="block">
        <span className={compact ? 'sr-only' : 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-3'}>Domain</span>
        <select
          className={field}
          value={domain}
          onChange={(e) => {
            const d = e.target.value;
            const keep = mailbox && d && mailboxes.find((m) => m.address === mailbox)?.domain === d;
            go({ domain: d, mailbox: keep ? mailbox : '' });
          }}
        >
          <option value="">All domains</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={compact ? 'sr-only' : 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-3'}>Mailbox</span>
        <select
          className={field}
          value={mailbox}
          onChange={(e) => {
            const a = e.target.value;
            go({ mailbox: a, domain: a ? (mailboxes.find((m) => m.address === a)?.domain ?? domain) : domain });
          }}
        >
          <option value="">{domain ? `All mailboxes on ${domain}` : 'All mailboxes'}</option>
          {visible.map((m) => (
            <option key={m.address} value={m.address}>
              {m.address}
              {m.ok ? '' : ' (not syncing)'}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
