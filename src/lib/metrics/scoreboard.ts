// "What we got": one simple scoreboard across every outreach source (each email and WhatsApp
// campaign) for a period: messages sent, people who replied, replies that need you, meetings and
// wins. Counts are by when the thing happened (not cohorts), so "7 days" means the last 7 days.
// The detailed, cohort-based comparison stays on the campaigns table (src/lib/metrics/campaigns.ts).
import { attentionSql } from '../crm/attention';
import { NEEDS_YOU_SQL, emailIntentSql, waIntentSql } from '../crm/intent';
import { q } from '../db';
import { env } from '../env';
import { addDays, localDate } from '../time';

export const RANGES = {
  today: { label: 'Today', days: 1 },
  '7d': { label: '7 days', days: 7 },
  '30d': { label: '30 days', days: 30 },
} as const;
export type Range = keyof typeof RANGES;

export function parseRange(v: string | undefined | null, fallback: Range = '7d'): Range {
  return v && v in RANGES ? (v as Range) : fallback;
}

/**
 * Is the source doing its job?
 *   sending   sent something in the last 3 days
 *   paused    switched off (in the dashboard or in n8n)
 *   idle      has leads left to contact but has not sent for 3+ days: worth a look
 *   finished  everyone on its list has been contacted
 *   new       nothing sent yet
 */
export type SourceHealth = 'sending' | 'paused' | 'idle' | 'finished' | 'new';
const RECENT_MS = 3 * 86400_000;

export interface SourceState {
  id: number;
  slug: string;
  name: string;
  channel: 'email' | 'whatsapp';
  /** Leads still waiting for their first message. */
  remaining: number;
  contacted: number;
  lastSendAt: Date | null;
  health: SourceHealth;
  /** Leads from this source that need you right now (same rule as Today). */
  needYou: number;
}

export interface SourceScore extends SourceState {
  /** Messages sent in the period (first messages and follow-ups). */
  sent: number;
  /** First messages in the period: new people reached. */
  reached: number;
  /** People who replied in the period (auto-replies excluded). */
  replies: number;
  /** Of those, people whose reply needs you: interested, a question, wants a call, later. */
  interested: number;
  meetings: number;
  won: number;
  wonValue: number;
  wonCurrency: string | null;
}

export interface Scoreboard {
  range: Range;
  from: string;
  to: string;
  totals: Pick<SourceScore, 'sent' | 'reached' | 'replies' | 'interested' | 'meetings' | 'won' | 'wonValue' | 'wonCurrency' | 'needYou'>;
  sources: SourceScore[];
}

export function healthOf(c: { paused: boolean; remaining: number; contacted: number; lastSendAt: Date | null }, now = new Date()): SourceHealth {
  if (c.paused) return 'paused';
  if (c.lastSendAt && now.getTime() - c.lastSendAt.getTime() < RECENT_MS) return 'sending';
  if (c.contacted === 0) return 'new';
  return c.remaining > 0 ? 'idle' : 'finished';
}

/** Every source with its current state (no period): health, leads left, and who needs you. */
export async function sourceStates(): Promise<SourceState[]> {
  const rows = await q<Omit<SourceState, 'health'> & { paused: boolean }>(
    `with lc as (
       select campaign_id,
              count(*) filter (where present_in_source and status in ('ready', 'queued', 'awaiting_approval', 'needs_draft', 'failed'))::int as remaining,
              count(*) filter (where sends_accepted > 0)::int as contacted
         from leads group by campaign_id),
     ls as (select campaign_id, max(occurred_at) as at from send_attempts where result = 'accepted' and not is_internal group by campaign_id),
     ny as (
       select l.campaign_id, count(*)::int as n from leads l
        where (l.last_reply_at is not null or l.manual_followup_at is not null or l.stage is not null) and ${attentionSql()} is not null
        group by l.campaign_id)
     select c.id, c.slug, c.name, c.channel,
            (c.control_paused_at is not null or c.status = 'paused') as paused,
            coalesce(lc.remaining, 0) as remaining, coalesce(lc.contacted, 0) as contacted,
            ls.at as "lastSendAt", coalesce(ny.n, 0) as "needYou"
       from campaigns c
       left join lc on lc.campaign_id = c.id
       left join ls on ls.campaign_id = c.id
       left join ny on ny.campaign_id = c.id
      order by c.channel, c.name`,
  );
  const now = new Date();
  return rows.map(({ paused, ...r }) => ({ ...r, health: healthOf({ paused, ...r }, now) }));
}

export async function scoreboard(range: Range): Promise<Scoreboard> {
  const to = localDate();
  const from = addDays(to, -(RANGES[range].days - 1));
  const inRange = (col: string) => `(${col} at time zone $1)::date between $2::date and $3::date`;
  const [states, rows] = await Promise.all([
    sourceStates(),
    q<{ id: number; sent: number; reached: number; replies: number; interested: number; meetings: number; won: number; wonValue: number; wonCurrency: string | null }>(
      `with s as (
         select v.campaign_id, count(*)::int as sent, count(*) filter (where v.step = 0)::int as reached
           from v_sends v
          where v.occurred_at is not null and v.time_quality <> 'unknown' and ${inRange('v.occurred_at')}
          group by v.campaign_id),
       r as (
         select l.campaign_id, x.lead_id, bool_or(x.it in ${NEEDS_YOU_SQL}) as interested
           from (
             select m.lead_id, m.sent_at as at, ${emailIntentSql('m')} as it from mail_messages m where m.is_outreach_reply and m.lead_id is not null
             union all
             select w.lead_id, w.sent_at, ${waIntentSql('w')} from wa_messages w where not w.from_me and w.lead_id is not null) x
           join leads l on l.id = x.lead_id
          where x.it <> 'auto' and ${inRange('x.at')}
          group by l.campaign_id, x.lead_id),
       ra as (select campaign_id, count(*)::int as replies, count(*) filter (where interested)::int as interested from r group by campaign_id),
       -- Meetings and wins: recorded in the dashboard (lead_outcomes), or read from a sheet's own
       -- stage column (dated by the reply that led to it, the best date the sheet gives us).
       ev as (
         select l.campaign_id, l.id as lead_id, lo.outcome as what
           from lead_outcomes lo join leads l on l.id = lo.lead_id
          where lo.outcome in ('meeting_booked', 'won') and lo.occurred_on between $2::date and $3::date
            and (lo.outcome <> 'won' or l.outcome = 'won')
         union
         select l.campaign_id, l.id, case l.stage when 'meeting' then 'meeting_booked' else 'won' end
           from leads l
          where l.stage_source = 'sheet' and l.stage in ('meeting', 'won') and ${inRange('coalesce(l.last_reply_at, l.stage_changed_at)')}),
       oa as (
         select ev.campaign_id,
                count(distinct ev.lead_id) filter (where ev.what = 'meeting_booked')::int as meetings,
                count(distinct ev.lead_id) filter (where ev.what = 'won')::int as won
           from ev group by ev.campaign_id),
       wv as (
         select x.campaign_id, sum(x.value)::float8 as value, case when count(distinct x.currency) = 1 then min(x.currency) end as currency
           from (select distinct ev.campaign_id, ev.lead_id,
                        coalesce(l.deal_value, (select lo.value from lead_outcomes lo where lo.lead_id = l.id and lo.outcome = 'won' order by lo.occurred_on desc, lo.id desc limit 1)) as value,
                        coalesce(l.deal_currency, (select lo.currency from lead_outcomes lo where lo.lead_id = l.id and lo.outcome = 'won' order by lo.occurred_on desc, lo.id desc limit 1)) as currency
                   from ev join leads l on l.id = ev.lead_id where ev.what = 'won') x
          where x.value is not null group by x.campaign_id)
       select c.id, coalesce(s.sent, 0) as sent, coalesce(s.reached, 0) as reached,
              coalesce(ra.replies, 0) as replies, coalesce(ra.interested, 0) as interested,
              coalesce(oa.meetings, 0) as meetings, coalesce(oa.won, 0) as won,
              coalesce(wv.value, 0) as "wonValue", wv.currency as "wonCurrency"
         from campaigns c
         left join s on s.campaign_id = c.id
         left join ra on ra.campaign_id = c.id
         left join oa on oa.campaign_id = c.id
         left join wv on wv.campaign_id = c.id`,
      [env.timezone, from, to],
    ),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const zero = { sent: 0, reached: 0, replies: 0, interested: 0, meetings: 0, won: 0, wonValue: 0, wonCurrency: null as string | null };
  const sources: SourceScore[] = states.map((st) => {
    const { id: _id, ...m } = byId.get(st.id) ?? { id: st.id, ...zero };
    return { ...st, ...m };
  });
  // Best results first; sources with nothing in the period sink to the bottom.
  sources.sort(
    (a, b) => b.won - a.won || b.meetings - a.meetings || b.interested - a.interested || b.replies - a.replies || b.sent - a.sent || b.needYou - a.needYou || a.name.localeCompare(b.name),
  );
  const currencies = new Set(sources.filter((s) => s.wonValue > 0).map((s) => s.wonCurrency));
  const sum = (k: 'sent' | 'reached' | 'replies' | 'interested' | 'meetings' | 'won' | 'wonValue' | 'needYou') => sources.reduce((n, s) => n + s[k], 0);
  return {
    range,
    from,
    to,
    totals: {
      sent: sum('sent'),
      reached: sum('reached'),
      replies: sum('replies'),
      interested: sum('interested'),
      meetings: sum('meetings'),
      won: sum('won'),
      // A money total only makes sense in one currency.
      wonValue: currencies.size === 1 && !currencies.has(null) ? sum('wonValue') : 0,
      wonCurrency: currencies.size === 1 ? ([...currencies][0] ?? null) : null,
      needYou: sum('needYou'),
    },
    sources,
  };
}

/** A source "had activity" in the period, or needs something from you now. */
export function isActive(s: SourceScore): boolean {
  return s.sent + s.replies + s.meetings + s.won + s.needYou > 0 || s.health === 'sending' || s.health === 'idle';
}
