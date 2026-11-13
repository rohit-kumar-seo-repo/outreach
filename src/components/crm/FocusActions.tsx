'use client';

// One-tap triage for leads that need you: "Done" (dealt with it) or "Later" (remind me). The card
// folds away at once; if the server says no, it comes back with the reason.
import { AnimatePresence, motion } from 'motion/react';
import { Check, Clock } from 'lucide-react';
import { createContext, useContext, useState, useTransition, type ReactNode } from 'react';
import { markDone, setReminder, type ActionResult } from '@/app/actions/crm';
import { REMINDER_PICKS } from '@/lib/crm/stages';

type Ctx = { hide: () => void; restore: (error: string) => void };
const ItemCtx = createContext<Ctx | null>(null);

/** A list item that collapses away as soon as its lead is dealt with, before the server re-renders. */
export function DismissableItem({ children, className }: { children: ReactNode; className?: string }) {
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AnimatePresence initial={false}>
      {!gone && (
        <motion.li exit={{ opacity: 0, height: 0, scale: 0.97 }} transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }} className={className}>
          <ItemCtx.Provider
            value={{
              hide: () => {
                setError(null);
                setGone(true);
              },
              restore: (e) => {
                setError(e);
                setGone(false);
              },
            }}
          >
            {children}
            {error && (
              <p role="alert" className="relative z-10 px-4 pb-3 text-[12.5px] text-critical">
                {error}
              </p>
            )}
          </ItemCtx.Provider>
        </motion.li>
      )}
    </AnimatePresence>
  );
}

const DONE_TITLE = {
  reply: 'Dealt with it: hide until they write again',
  due: 'Reminder done',
  cold: 'Still on it: hide for a few days',
} as const;

export function FocusActions({ leadId, attention, tone = 'light' }: { leadId: number; attention: 'reply' | 'due' | 'cold'; tone?: 'light' | 'plain' }) {
  const item = useContext(ItemCtx);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    item?.hide();
    start(async () => {
      let r: ActionResult;
      try {
        r = await fn();
      } catch {
        r = { ok: false, error: 'Could not save. Check your connection and try again.' };
      }
      if (!r.ok) {
        if (item) item.restore(r.error);
        else setError(r.error);
      }
    });
  }

  const base =
    tone === 'plain'
      ? 'inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white px-3 text-[13px] font-semibold text-ink ring-1 ring-line-strong'
      : 'inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white/90 px-3 text-[13px] font-semibold text-ink shadow-sm ring-1 ring-line';
  return (
    <div className="pointer-events-auto relative z-10 flex flex-wrap items-center gap-2" aria-busy={pending}>
      <button type="button" disabled={pending} onClick={() => run(() => markDone(leadId))} className={`${base} transition-transform active:scale-95 disabled:opacity-60`} title={DONE_TITLE[attention]}>
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white">
          <Check size={12} strokeWidth={3} aria-hidden />
        </span>
        Done
      </button>
      <label className={`${base} relative cursor-pointer transition-transform active:scale-95`}>
        <Clock size={15} className="text-amber-600" aria-hidden />
        Later
        <select
          aria-label="Remind me later"
          disabled={pending}
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v) run(() => setReminder(leadId, v));
          }}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          <option value="">Remind me…</option>
          {Object.entries(REMINDER_PICKS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <span role="alert" className="text-[12px] text-critical">
          {error}
        </span>
      )}
    </div>
  );
}
