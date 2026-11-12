'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Check, Loader2, Mail, MessageCircle, Phone, Star, Trash2 } from 'lucide-react';
import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { addNote, deleteActivity, logCall, setDeal, setReminder, setStage, toggleStar, type ActionResult } from '@/app/actions/crm';
import { CALL_OUTCOMES, REMINDER_PICKS, STAGES, STAGE_META, type CallOutcome, type ReminderPick, type Stage } from '@/lib/crm/stages';
import type { ContactLinks } from '@/lib/crm/contact';

const CALL_EVENT = 'crm:call-started';

function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn().catch(() => ({ ok: false as const, error: 'Could not save. Check your connection and try again.' }));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(true);
      setTimeout(() => setDone(false), 1800);
      after?.();
    });
  return { pending, error, done, run };
}

function Saved({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-emerald-700" role="status">
          <Check size={14} aria-hidden /> Saved
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="text-[12.5px] text-critical" role="alert">
      {error}
    </p>
  );
}

// ------------------------------------------------------------------- action bar ----

export function LeadActionBar({ links, waHref, emailHref, name }: { links: ContactLinks; waHref: string | null; emailHref: string | null; name: string }) {
  const onCall = () => window.dispatchEvent(new CustomEvent(CALL_EVENT));
  const wa = waHref ?? links.wa;
  const mail = emailHref ?? links.mailto;
  const tile = 'flex min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-2.5 text-[13px] font-semibold transition-transform active:scale-[0.97]';
  const off = `${tile} cursor-not-allowed bg-slate-100 text-ink-3`;
  return (
    <div className="grid grid-cols-3 gap-2">
      {links.tel ? (
        <a href={links.tel} onClick={onCall} className={`${tile} bg-emerald-600 text-white shadow-sm shadow-emerald-700/20 hover:bg-emerald-700`} aria-label={`Call ${name}`}>
          <Phone size={21} aria-hidden /> Call
        </a>
      ) : (
        <span className={off} aria-disabled="true" title="No phone number in the sheet">
          <Phone size={21} aria-hidden /> No phone
        </span>
      )}
      {wa ? (
        <a
          href={wa}
          {...(wa.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className={`${tile} bg-[#25d366] text-[#06371b] shadow-sm shadow-green-700/20 hover:bg-[#1fbd5a]`}
          aria-label={`WhatsApp ${name}`}
        >
          <MessageCircle size={21} aria-hidden /> WhatsApp
        </a>
      ) : (
        <span className={off} aria-disabled="true" title="No international number known">
          <MessageCircle size={21} aria-hidden /> WhatsApp
        </span>
      )}
      {mail ? (
        <a href={mail} className={`${tile} bg-brand text-white shadow-sm shadow-indigo-700/25 hover:bg-brand-600`} aria-label={`Email ${name}`}>
          <Mail size={21} aria-hidden /> Email
        </a>
      ) : (
        <span className={off} aria-disabled="true">
          <Mail size={21} aria-hidden /> No email
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ stage picker ----

export function StagePicker({ leadId, stage }: { leadId: number; stage: Stage | null }) {
  const [optimistic, setOptimistic] = useOptimistic(stage);
  const { pending, error, done, run } = useAction();
  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Pipeline stage">
        {STAGES.map((s) => {
          const m = STAGE_META[s];
          const on = optimistic === s;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={pending}
              title={m.help}
              onClick={() =>
                run(() => {
                  setOptimistic(s);
                  return setStage(leadId, s);
                })
              }
              className={`chip ${on ? `ring-2 ${m.ring} ${m.chip} !shadow-none` : ''}`}
            >
              <span className={`h-2 w-2 rounded-full ${m.dot}`} aria-hidden />
              {m.short}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex min-h-5 items-center gap-2">
        {pending && <Loader2 size={14} className="animate-spin text-ink-3" aria-label="Saving" />}
        <Saved show={done} />
        <ErrorText error={error} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- reminders ----

function ReminderChips({ value, onChange, includeNone = true }: { value: string; onChange: (v: string) => void; includeNone?: boolean }) {
  const dateRef = useRef<HTMLInputElement>(null);
  const isDate = value.startsWith('date:');
  return (
    <div className="flex flex-wrap gap-1.5">
      {includeNone && (
        <button type="button" className="chip" aria-pressed={value === 'keep'} onClick={() => onChange('keep')}>
          No reminder
        </button>
      )}
      {(Object.keys(REMINDER_PICKS) as ReminderPick[]).map((k) => (
        <button key={k} type="button" className="chip" aria-pressed={value === k} onClick={() => onChange(k)}>
          {REMINDER_PICKS[k]}
        </button>
      ))}
      <label className="chip relative cursor-pointer" aria-pressed={isDate}>
        {isDate ? value.slice(5) : 'Pick date'}
        <input
          ref={dateRef}
          type="date"
          className="absolute inset-0 cursor-pointer opacity-0"
          min={new Date().toISOString().slice(0, 10)}
          onChange={(e) => e.target.value && onChange(`date:${e.target.value}`)}
          aria-label="Pick a reminder date"
        />
      </label>
    </div>
  );
}

export function ReminderPicker({ leadId, current }: { leadId: number; current: string | null }) {
  const { pending, error, done, run } = useAction();
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[13px] text-ink-2">{current ? <>Reminder: <strong className="font-semibold text-ink">{current}</strong></> : 'No reminder set'}</span>
        {current && (
          <button type="button" className="text-[12.5px] font-medium text-ink-3 hover:text-critical" disabled={pending} onClick={() => run(() => setReminder(leadId, 'clear'))}>
            Clear
          </button>
        )}
      </div>
      <ReminderChips value="" includeNone={false} onChange={(v) => run(() => setReminder(leadId, v))} />
      <div className="mt-1 flex min-h-5 items-center gap-2">
        {pending && <Loader2 size={14} className="animate-spin text-ink-3" aria-label="Saving" />}
        <Saved show={done} />
        <ErrorText error={error} />
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- log call ----

const DEFAULT_REMINDER: Record<CallOutcome, string> = { connected: 'keep', no_answer: 'tomorrow', busy: 'later', wrong_number: 'keep' };

export function LogCallPanel({
  leadId,
  stage,
  onSaved,
  autoOpenOnCall = true,
  big = false,
}: {
  leadId: number;
  stage: Stage | null;
  onSaved?: () => void;
  autoOpenOnCall?: boolean;
  big?: boolean;
}) {
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [nextStage, setNextStage] = useState<Stage | null>(null);
  const [reminder, setReminderPick] = useState('keep');
  const [note, setNote] = useState('');
  const [prompted, setPrompted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pending, error, done, run } = useAction();

  useEffect(() => {
    if (!autoOpenOnCall) return;
    const onCall = () => {
      setPrompted(true);
      setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 400);
    };
    window.addEventListener(CALL_EVENT, onCall);
    return () => window.removeEventListener(CALL_EVENT, onCall);
  }, [autoOpenOnCall]);

  const choose = (o: CallOutcome) => {
    setOutcome(o);
    setReminderPick(DEFAULT_REMINDER[o]);
    if (o === 'connected' && (stage === null || stage === 'new')) setNextStage('contacted');
    else setNextStage(null);
  };

  const save = () =>
    outcome &&
    run(
      () => logCall({ leadId, outcome, note, reminder: reminder as never, stage: nextStage }),
      () => {
        setOutcome(null);
        setNote('');
        setNextStage(null);
        setPrompted(false);
        onSaved?.();
      },
    );

  return (
    <div ref={ref} className={prompted ? 'rounded-2xl ring-2 ring-emerald-400 ring-offset-2 ring-offset-white transition-shadow' : ''}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-ink">{prompted ? 'How did the call go?' : 'Log a call'}</h3>
        <Saved show={done} />
      </div>
      <div className={`grid grid-cols-2 gap-2 ${big ? '' : 'sm:grid-cols-4'}`}>
        {(Object.keys(CALL_OUTCOMES) as CallOutcome[]).map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={outcome === o}
            onClick={() => choose(o)}
            className={`rounded-xl border px-3 text-left transition-colors active:scale-[0.98] ${big ? 'py-4 text-[15px]' : 'py-2.5 text-[13.5px]'} font-semibold ${
              outcome === o ? 'border-ink bg-ink text-white' : 'border-line-strong bg-white text-ink hover:bg-slate-50'
            }`}
          >
            {CALL_OUTCOMES[o].label}
          </button>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {outcome && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
            <div className="space-y-3 pt-3">
              <div>
                <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Move to stage</div>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className="chip" aria-pressed={nextStage === null} onClick={() => setNextStage(null)}>
                    Keep {stage ? STAGE_META[stage].short : 'as is'}
                  </button>
                  {STAGES.filter((s) => s !== stage).map((s) => (
                    <button key={s} type="button" className="chip" aria-pressed={nextStage === s} onClick={() => setNextStage(s)}>
                      <span className={`h-2 w-2 rounded-full ${STAGE_META[s].dot}`} aria-hidden />
                      {STAGE_META[s].short}
                    </button>
                  ))}
                </div>
              </div>
              {nextStage !== 'won' && nextStage !== 'lost' && (
                <div>
                  <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Remind me</div>
                  <ReminderChips value={reminder} onChange={setReminderPick} />
                </div>
              )}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={4000}
                placeholder="What did they say? (optional)"
                className="field w-full resize-none"
              />
              <div className="flex items-center gap-3">
                <button type="button" onClick={save} disabled={pending} className={`btn btn-primary ${big ? 'btn-lg w-full justify-center' : ''}`}>
                  {pending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />}
                  {onSaved ? 'Save & next' : 'Save call'}
                </button>
                {!big && (
                  <button type="button" className="text-[13px] text-ink-3 hover:text-ink" onClick={() => setOutcome(null)}>
                    Cancel
                  </button>
                )}
              </div>
              <ErrorText error={error} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ------------------------------------------------------------------------ notes ----

export function NoteComposer({ leadId }: { leadId: number }) {
  const [text, setText] = useState('');
  const { pending, error, done, run } = useAction();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addNote(leadId, text), () => setText(''));
      }}
    >
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4000} placeholder="Add a note: who you spoke to, what they need, next step…" className="field w-full resize-y" />
      <div className="mt-2 flex items-center gap-3">
        <button type="submit" disabled={pending || !text.trim()} className="btn btn-primary">
          {pending && <Loader2 size={15} className="animate-spin" aria-hidden />}
          Add note
        </button>
        <Saved show={done} />
        <ErrorText error={error} />
      </div>
    </form>
  );
}

export function DeleteActivityButton({ id }: { id: number }) {
  const { pending, run } = useAction();
  return (
    <button
      type="button"
      onClick={() => {
        if (confirm('Remove this entry? It stays in the audit log.')) run(() => deleteActivity(id));
      }}
      disabled={pending}
      className="rounded-md p-1 text-ink-3 opacity-60 hover:bg-slate-100 hover:text-critical hover:opacity-100"
      aria-label="Remove entry"
    >
      {pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Trash2 size={14} aria-hidden />}
    </button>
  );
}

// ------------------------------------------------------------------- star / deal ----

export function StarButton({ leadId, starred }: { leadId: number; starred: boolean }) {
  const [on, setOn] = useOptimistic(starred);
  const { pending, run } = useAction();
  return (
    <button
      type="button"
      className="icon-btn"
      aria-pressed={on}
      aria-label={on ? 'Unstar lead' : 'Star lead (hot)'}
      disabled={pending}
      onClick={() =>
        run(() => {
          setOn(!on);
          return toggleStar(leadId);
        })
      }
    >
      <Star size={20} className={on ? 'fill-amber-400 text-amber-400' : ''} aria-hidden />
    </button>
  );
}

export function DealEditor({ leadId, value, currency }: { leadId: number; value: number | null; currency: string | null }) {
  const [v, setV] = useState(value === null ? '' : String(value));
  const [cur, setCur] = useState(currency ?? 'INR');
  const { pending, error, done, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setDeal(leadId, v, cur));
      }}
    >
      <select value={cur} onChange={(e) => setCur(e.target.value)} className="field w-24" aria-label="Currency">
        {['INR', 'USD', 'AED', 'GBP', 'EUR', 'CAD', 'AUD'].map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <input value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" placeholder="Deal value" className="field w-36 flex-1" aria-label="Deal value" />
      <button type="submit" disabled={pending} className="btn">
        Save
      </button>
      <Saved show={done} />
      <ErrorText error={error} />
    </form>
  );
}
