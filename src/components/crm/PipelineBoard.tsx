'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { setStage } from '@/app/actions/crm';
import type { LeadCardView } from '@/lib/crm/present';
import { STAGE_META, STAGES, type Stage } from '@/lib/crm/stages';
import { AttentionBadge, ContactButtons, ReminderBadge, StarMark } from './LeadBits';

type Columns = Partial<Record<Stage, LeadCardView[]>>;

/** Kanban board: drag a card to another column (desktop) or use its stage menu (any device). */
export function PipelineBoard({ columns, totals, stages }: { columns: Columns; totals: Partial<Record<Stage, number>>; stages: Stage[] }) {
  const [cols, setCols] = useState<Columns>(columns);
  const [over, setOver] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  useEffect(() => setCols(columns), [columns]);

  const move = (id: number, to: Stage) => {
    const from = stages.find((s) => cols[s]?.some((c) => c.id === id));
    if (!from || from === to) return;
    const card = cols[from]!.find((c) => c.id === id)!;
    const before = cols;
    setCols({ ...cols, [from]: cols[from]!.filter((c) => c.id !== id), [to]: [{ ...card, stage: to }, ...(cols[to] ?? [])] });
    setError(null);
    start(async () => {
      const res = await setStage(id, to).catch(() => ({ ok: false as const, error: 'Could not save. Check your connection.' }));
      if (!res.ok) {
        setCols(before);
        setError(res.error);
      }
    });
  };

  return (
    <div>
      {error && (
        <p className="mb-2 text-[13px] text-critical" role="alert">
          {error}
        </p>
      )}
      <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
        {stages.map((s) => {
          const m = STAGE_META[s];
          const list = cols[s] ?? [];
          const total = totals[s] ?? list.length;
          return (
            <section
              key={s}
              aria-label={m.label}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(s);
              }}
              onDragLeave={() => setOver((o) => (o === s ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = Number(e.dataTransfer.getData('text/lead-id'));
                if (id) move(id, s);
              }}
              className={`flex w-[280px] shrink-0 snap-start flex-col rounded-2xl bg-slate-100/70 p-2 transition-colors ${over === s ? 'bg-brand-50 ring-2 ring-brand/40' : ''}`}
            >
              <header className="flex items-center justify-between px-1.5 pb-2 pt-1">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                  <span className={`tint-${s} h-2.5 w-2.5 rounded-full bg-gradient-to-br from-[var(--g1)] to-[var(--g2)]`} aria-hidden />
                  {m.label}
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11.5px] font-semibold text-ink-2 tabular ring-1 ring-line">{total}</span>
              </header>
              <ul className="flex max-h-[calc(100vh-260px)] min-h-24 flex-col gap-2 overflow-y-auto">
                {list.map((l) => {
                  const name = l.name || l.email || l.links.phoneLabel || `Lead #${l.id}`;
                  return (
                    <li
                      key={l.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/lead-id', String(l.id));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      className={`group accent-bar tint-${s} relative cursor-grab rounded-xl bg-white p-3 shadow-[var(--shadow-card)] ring-1 ring-line active:cursor-grabbing ${l.attention ? `ring-grad attn-${l.attention}` : ''}`}
                    >
                      <Link href={`/leads/${l.id}`} className="block">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[13.5px] font-semibold text-ink group-hover:text-brand">{name}</span>
                          <StarMark on={l.starred} />
                        </span>
                        <span className="block truncate text-[11.5px] text-ink-3">{[l.category, l.city].filter(Boolean).join(' · ') || l.campaignName}</span>
                        {l.replyText && <span className="mt-1.5 line-clamp-2 block text-[12.5px] leading-snug text-ink-2">&ldquo;{l.replyText}&rdquo;</span>}
                      </Link>
                      {(l.reminderLabel || l.attentionLabel) && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <AttentionBadge attention={l.attention} label={l.attentionLabel} />
                          <ReminderBadge label={l.reminderLabel} tone={l.reminderTone} />
                        </div>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-ink-3">{l.whenLabel}</span>
                        <ContactButtons links={l.links} size="sm" name={name} />
                      </div>
                      <label className="mt-2 block">
                        <span className="sr-only">Move {name} to stage</span>
                        <select value={s} onChange={(e) => move(l.id, e.target.value as Stage)} className="w-full rounded-lg border border-line bg-slate-50 px-2 py-1 text-[12px] text-ink-2">
                          {STAGES.map((x) => (
                            <option key={x} value={x}>
                              {STAGE_META[x].label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </li>
                  );
                })}
                {list.length === 0 && <li className="rounded-xl border border-dashed border-line-strong px-3 py-6 text-center text-[12px] text-ink-3">Drop a lead here</li>}
                {total > list.length && (
                  <li className="px-1 text-center">
                    <Link href={`/leads?view=${s}`} className="text-[12px] font-medium text-brand hover:underline">
                      +{total - list.length} more
                    </Link>
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
