// Pipeline stages: shared by server queries and client components (no server imports here).

export const STAGES = ['new', 'contacted', 'interested', 'meeting', 'proposal', 'won', 'lost'] as const;
export type Stage = (typeof STAGES)[number];
/** Stages that still need work; won/lost are closed. */
export const OPEN_STAGES: Stage[] = ['new', 'contacted', 'interested', 'meeting', 'proposal'];

export const STAGE_META: Record<Stage, { label: string; short: string; help: string; dot: string; chip: string; ring: string }> = {
  new: {
    label: 'New reply',
    short: 'New',
    help: 'Replied to outreach and nobody has worked it yet.',
    dot: 'bg-sky-500',
    chip: 'bg-sky-50 text-sky-700 ring-sky-200',
    ring: 'ring-sky-500',
  },
  contacted: {
    label: 'Contacted',
    short: 'Contacted',
    help: 'You called or messaged them; the conversation is open.',
    dot: 'bg-indigo-500',
    chip: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    ring: 'ring-indigo-500',
  },
  interested: {
    label: 'Interested',
    short: 'Interested',
    help: 'Showed real interest: asked for prices, details or a trial.',
    dot: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-800 ring-amber-200',
    ring: 'ring-amber-500',
  },
  meeting: {
    label: 'Meeting',
    short: 'Meeting',
    help: 'A call or meeting is booked.',
    dot: 'bg-teal-500',
    chip: 'bg-teal-50 text-teal-700 ring-teal-200',
    ring: 'ring-teal-500',
  },
  proposal: {
    label: 'Proposal sent',
    short: 'Proposal',
    help: 'You sent a proposal or quote and are waiting on a decision.',
    dot: 'bg-violet-500',
    chip: 'bg-violet-50 text-violet-700 ring-violet-200',
    ring: 'ring-violet-500',
  },
  won: {
    label: 'Won',
    short: 'Won',
    help: 'Became a paying client.',
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    ring: 'ring-emerald-500',
  },
  lost: {
    label: 'Lost',
    short: 'Lost',
    help: 'Not interested, went cold or chose someone else.',
    dot: 'bg-slate-400',
    chip: 'bg-slate-100 text-slate-600 ring-slate-200',
    ring: 'ring-slate-400',
  },
};

export function isStage(v: unknown): v is Stage {
  return typeof v === 'string' && (STAGES as readonly string[]).includes(v);
}

/** Stage changes that also count as a business outcome in campaign results (lead_outcomes). */
export const STAGE_OUTCOME: Partial<Record<Stage, 'qualified' | 'meeting_booked' | 'won' | 'lost'>> = {
  interested: 'qualified',
  meeting: 'meeting_booked',
  proposal: 'qualified',
  won: 'won',
  lost: 'lost',
};

export const CALL_OUTCOMES = {
  connected: { label: 'Spoke', help: 'You talked to them.' },
  no_answer: { label: 'No answer', help: 'Rang out or switched off.' },
  busy: { label: 'Busy / call back', help: 'They asked you to call later, or the line was busy.' },
  wrong_number: { label: 'Wrong number', help: 'Number is wrong or not theirs.' },
} as const;
export type CallOutcome = keyof typeof CALL_OUTCOMES;
export function isCallOutcome(v: unknown): v is CallOutcome {
  return typeof v === 'string' && v in CALL_OUTCOMES;
}

export const REMINDER_PICKS = {
  later: 'In 3 hours',
  tomorrow: 'Tomorrow',
  in3: 'In 3 days',
  week: 'Next week',
} as const;
export type ReminderPick = keyof typeof REMINDER_PICKS;

/**
 * SQL for a lead's pipeline stage. Explicit stage wins; otherwise a lead that replied is "new",
 * and a reply classified as not interested / unsubscribe is "lost". Leads that never replied and
 * were never staged are not in the pipeline (null). Expects the leads table aliased as `l`.
 */
export const STAGE_SQL = `(case
  when l.stage is not null then l.stage
  when l.last_reply_at is null then null
  when l.suppressed or l.reply_sentiment in ('not_interested', 'unsubscribe') then 'lost'
  when l.reply_sentiment = 'auto_reply' then null
  else 'new' end)`;

/**
 * Maps the free text a sheet keeps in its "Lead Stage" column (written by the reply-handling
 * workflows or by hand, e.g. "Booked - Rohit handling", "Interested - link sent (manual)") to a
 * pipeline stage. Unknown text (e.g. "ignored" for auto-replies) maps to null and changes nothing.
 * Kept in sync with the SQL in src/lib/sync/derive.ts.
 */
export function stageFromSheetText(text: string | null | undefined, meetingTime?: string | null): Stage | null {
  const s = (text ?? '').toLowerCase();
  if ((meetingTime ?? '').trim()) return 'meeting';
  if (/booked|meeting|call scheduled|demo/.test(s)) return 'meeting';
  if (/not interested|opt.?out|unsubscrib|declin|\blost\b/.test(s)) return 'lost';
  if (/\bwon\b|signed|paid|converted/.test(s)) return 'won';
  if (/proposal|quote sent/.test(s)) return 'proposal';
  if (/interest|link sent|pricing|price/.test(s)) return 'interested';
  if (/handl|contacted|in talks|spoke|called/.test(s)) return 'contacted';
  return null;
}
