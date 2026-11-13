// "Needs you": which leads are actually waiting on a person right now. Everything else (people who
// only said hi / thanks, auto-replies, no's, leads you already answered and are waiting on, leads
// parked behind a future reminder, closed deals) stays out of the way.
//
// Server-only (reads the app timezone). The reasons, in the order they are checked:
//   due   a reminder you set is due today (or overdue), whatever the stage;
//   (a reminder later than today parks the lead: it is not shown until then);
//   reply they wrote something that needs you (interested, a question, wants a call, …) after
//         the last thing you did: a reply on any channel, a call, a note, a stage change or Done;
//   cold  an interested / meeting / proposal lead with no touch from either side for COLD_DAYS.
import { env } from '../env';
import { STAGE_SQL } from './stages';

export const ATTENTION = ['reply', 'due', 'cold'] as const;
export type Attention = (typeof ATTENTION)[number];
export const COLD_DAYS = 5;

export function isAttention(v: unknown): v is Attention {
  return typeof v === 'string' && (ATTENTION as readonly string[]).includes(v);
}

export const ATTENTION_META: Record<Attention, { label: string; title: string; help: string }> = {
  reply: { label: 'Waiting on you', title: 'Waiting on you', help: 'They replied and nobody has answered yet.' },
  due: { label: 'Reminder due', title: 'Reminders due', help: 'Reminders you set for today or earlier.' },
  cold: { label: 'Going quiet', title: 'Going quiet', help: `Hot leads with no touch from either side for ${COLD_DAYS}+ days.` },
};

function tzLiteral(): string {
  return `'${env.timezone.replace(/'/g, "''")}'`;
}

/** SQL: end of today in the app timezone (a timestamptz). */
export function endOfTodaySqlLiteral(): string {
  const tz = tzLiteral();
  return `((((now() at time zone ${tz})::date + 1)::timestamp) at time zone ${tz})`;
}

/** SQL: the last time anyone on your side touched the lead (never null). Leads table aliased `l`. */
export const LAST_TOUCH_SQL = `coalesce(greatest(l.last_outbound_at, l.last_activity_at, l.stage_changed_at, l.attention_cleared_at), '-infinity'::timestamptz)`;

/** SQL: 'reply' | 'due' | 'cold' | null for a lead (leads table aliased `l`). */
export function attentionSql(): string {
  return `(case
    when l.manual_followup_at is not null and l.manual_followup_at < ${endOfTodaySqlLiteral()} then 'due'
    when l.manual_followup_at is not null then null
    when l.is_duplicate and l.stage is null then null
    when l.needs_reply_at > ${LAST_TOUCH_SQL} and ${STAGE_SQL} is not null and (l.stage is not null or ${STAGE_SQL} <> 'lost') then 'reply'
    when ${STAGE_SQL} in ('interested', 'meeting', 'proposal') and greatest(l.last_reply_at, ${LAST_TOUCH_SQL}) < now() - interval '${COLD_DAYS} days' then 'cold'
  end)`;
}

/** SQL order for a list of attention leads: replies first (newest), then reminders (earliest), then going quiet (hottest stage). */
export function attentionOrderSql(): string {
  const a = attentionSql();
  return `case ${a} when 'reply' then 0 when 'due' then 1 else 2 end,
    case when ${a} = 'due' then l.manual_followup_at end asc nulls last,
    case when ${a} = 'reply' then l.needs_reply_at end desc nulls last,
    case ${STAGE_SQL} when 'proposal' then 0 when 'meeting' then 1 when 'interested' then 2 else 3 end,
    l.starred desc, l.id desc`;
}
