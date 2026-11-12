'use client';

import { AlarmClock, LayoutGrid, List, Loader2, Search, Star, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

/** Search box + quick filters for /leads. Everything lives in the URL so views can be bookmarked. */
export function LeadFilters({
  campaigns,
  showModeToggle,
}: {
  campaigns: { value: string; label: string }[];
  showModeToggle: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [term, setTerm] = useState(sp.get('q') ?? '');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sp.get('focus') === '1') input.current?.focus();
  }, [sp]);

  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    next.delete('focus');
    start(() => router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false }));
  };

  // Search as you type, debounced.
  useEffect(() => {
    if ((sp.get('q') ?? '') === term) return;
    const t = setTimeout(() => push({ q: term.trim() || null }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const due = sp.get('due') === '1';
  const starred = sp.get('starred') === '1';
  const mode = sp.get('mode') === 'board' ? 'board' : 'list';

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search leads</span>
          <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            ref={input}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            type="search"
            enterKeyHint="search"
            placeholder="Search name, phone, email, city…"
            className="field h-11 w-full rounded-xl pl-10 pr-10 shadow-[var(--shadow-card)]"
          />
          {pending ? (
            <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-ink-3" aria-label="Loading" />
          ) : term ? (
            <button type="button" onClick={() => setTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-3 hover:text-ink" aria-label="Clear search">
              <X size={15} aria-hidden />
            </button>
          ) : null}
        </label>
        {showModeToggle && (
          <div className="hidden rounded-xl bg-white p-1 shadow-[var(--shadow-card)] ring-1 ring-line md:flex" role="group" aria-label="Layout">
            <button type="button" onClick={() => push({ mode: null })} aria-pressed={mode === 'list'} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium ${mode === 'list' ? 'bg-ink text-white' : 'text-ink-2 hover:bg-slate-100'}`}>
              <List size={15} aria-hidden /> List
            </button>
            <button type="button" onClick={() => push({ mode: 'board' })} aria-pressed={mode === 'board'} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium ${mode === 'board' ? 'bg-ink text-white' : 'text-ink-2 hover:bg-slate-100'}`}>
              <LayoutGrid size={15} aria-hidden /> Board
            </button>
          </div>
        )}
      </div>
      <div className="no-scrollbar -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <button type="button" className="chip" aria-pressed={due} onClick={() => push({ due: due ? null : '1' })}>
          <AlarmClock size={14} aria-hidden /> Reminders due
        </button>
        <button type="button" className="chip" aria-pressed={starred} onClick={() => push({ starred: starred ? null : '1' })}>
          <Star size={14} aria-hidden /> Starred
        </button>
        <select
          className="chip appearance-none pr-7"
          style={{ backgroundImage: 'linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)', backgroundPosition: 'calc(100% - 14px) 55%, calc(100% - 10px) 55%', backgroundSize: '4px 4px', backgroundRepeat: 'no-repeat' }}
          value={sp.get('campaign') ?? ''}
          onChange={(e) => push({ campaign: e.target.value || null })}
          aria-label="Campaign"
        >
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          className="chip appearance-none pr-7"
          style={{ backgroundImage: 'linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)', backgroundPosition: 'calc(100% - 14px) 55%, calc(100% - 10px) 55%', backgroundSize: '4px 4px', backgroundRepeat: 'no-repeat' }}
          value={sp.get('channel') ?? ''}
          onChange={(e) => push({ channel: e.target.value || null })}
          aria-label="Channel"
        >
          <option value="">Email + WhatsApp</option>
          <option value="email">Email only</option>
          <option value="whatsapp">WhatsApp only</option>
        </select>
      </div>
    </div>
  );
}
