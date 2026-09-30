import { env } from '../env';
import { one, q } from '../db';
import { Params } from './filters';

export interface CampaignStats {
  id: number;
  slug: string;
  name: string;
  channel: 'email' | 'whatsapp';
  brand: string | null;
  status: string;
  description: string | null;
  startedAt: Date | null;
  config: Record<string, unknown>;
  // leads
  leadsLoaded: number;
  eligible: number;
  queued: number;
  contacted: number;
  remaining: number;
  invalid: number;
  duplicates: number;
  duplicatesPrevented: number;
  excluded: number;
  // sends
  originalsSent: number;
  followupsSent: number;
  followupsByStep: Record<string, number>;
  sendsUnknownDate: number;
  failedNeverAccepted: number;
  // outcomes (unique leads)
  repliedLeads: number;
  replyMessages: number;
  positiveLeads: number;
  notInterestedLeads: number;
  classifiedLeads: number;
  bouncedLeads: number;
  unsubscribedLeads: number;
  receivedFollowup: number;
  repliedAfterFollowup: number;
  // business results recorded by hand (contacted leads only, so rates share one denominator)
  qualifiedLeads: number;
  meetingLeads: number;
  wonLeads: number;
  lostLeads: number;
  wonValue: number;
  wonCurrencies: string[];
  mailboxes: string[];
  lastSendAt: Date | null;
  // WhatsApp Control Center: dashboard-owned pause/cap, independent of the auto-derived `status`.
  controlPausedAt: Date | null;
  controlPausedBy: string | null;
  controlPauseReason: string | null;
  dailyCap: number | null;
  templateId: number | null;
  sendWindow: { days?: number[]; startLocal?: string; endLocal?: string };
}

export interface CampaignQuery {
  /** Optional cohort: only leads whose first contact falls in [from, to] (dashboard timezone). */
  from?: string | null;
  to?: string | null;
  slug?: string | null;
}

/**
 * Rates are always "unique leads with outcome / unique leads contacted", so campaigns of any
 * size compare fairly. With a period, the cohort is leads first contacted in that period.
 */
export async function campaignStats(opts: CampaignQuery = {}): Promise<CampaignStats[]> {
  const p = new Params();
  const cohort =
    opts.from && opts.to
      ? `and l.first_contacted_at is not null and (l.first_contacted_at at time zone ${p.add(env.timezone)})::date between ${p.add(opts.from)}::date and ${p.add(opts.to)}::date`
      : '';
  const slugFilter = opts.slug ? `where c.slug = ${p.add(opts.slug)}` : '';
  const rows = await q<CampaignStats & { followupsByStepJson: Record<string, number> | null }>(
    `with lc as (
       select l.*, (l.sends_accepted > 0) as contacted_flag from leads l where true ${cohort}),
     rep as (
       select v.lead_id, bool_or(v.sentiment = 'positive') as pos, bool_or(v.sentiment = 'not_interested') as neg,
              bool_or(v.sentiment is not null) as classified, count(*)::int as msgs, min(v.at) as first_reply
         from v_replies v group by v.lead_id),
     oc as (
       select lead_id, bool_or(outcome in ('qualified', 'meeting_booked', 'won')) as qualified,
              bool_or(outcome in ('meeting_booked', 'won')) as meeting
         from lead_outcomes group by lead_id),
     won as (
       select distinct on (lead_id) lead_id, value, currency from lead_outcomes
        where outcome = 'won' order by lead_id, occurred_on desc, recorded_at desc, id desc),
     fu as (select lead_id, min(occurred_at) as first_fu from v_sends
             where step > 0 and occurred_at is not null and time_quality <> 'unknown' group by lead_id),
     s as (select v.campaign_id, v.step, count(*)::int as n, count(*) filter (where v.occurred_at is null or v.time_quality = 'unknown')::int as unknown_n,
                  max(v.occurred_at) as last_at
             from v_sends v where ${cohort ? 'v.lead_id in (select id from lc)' : 'true'} group by v.campaign_id, v.step)
     select c.id, c.slug, c.name, c.channel, c.brand, c.status, c.description, c.started_at as "startedAt", c.config,
       c.control_paused_at as "controlPausedAt", c.control_paused_by as "controlPausedBy", c.control_pause_reason as "controlPauseReason",
       c.daily_cap as "dailyCap", c.template_id as "templateId", c.send_window as "sendWindow",
       (select count(*)::int from lc where lc.campaign_id = c.id and lc.present_in_source) as "leadsLoaded",
       (select count(*)::int from lc where lc.campaign_id = c.id and lc.present_in_source
           and lc.status not in ('invalid', 'duplicate', 'excluded', 'unsubscribed')) as eligible,
       (select count(*)::int from lc where lc.campaign_id = c.id and lc.status = 'queued' and lc.present_in_source) as queued,
       (select count(*)::int from lc where lc.campaign_id = c.id and lc.contacted_flag) as contacted,
       (select count(*)::int from lc where lc.campaign_id = c.id and lc.present_in_source
           and lc.status in ('ready', 'queued', 'awaiting_approval', 'needs_draft', 'failed')) as remaining,
       (select count(*)::int from lc where lc.campaign_id = c.id and lc.status = 'invalid' and lc.present_in_source) as invalid,
       (select count(*)::int from lc where lc.campaign_id = c.id and lc.is_duplicate) as duplicates,
       (select count(*)::int from lc where lc.campaign_id = c.id and lc.is_duplicate and not lc.contacted_flag) as "duplicatesPrevented",
       (select count(*)::int from lc where lc.campaign_id = c.id and lc.status = 'excluded') as excluded,
       coalesce((select sum(n)::int from s where s.campaign_id = c.id and s.step = 0), 0) as "originalsSent",
       coalesce((select sum(n)::int from s where s.campaign_id = c.id and s.step > 0), 0) as "followupsSent",
       (select json_object_agg(step, n) from s where s.campaign_id = c.id and s.step > 0) as "followupsByStepJson",
       coalesce((select sum(unknown_n)::int from s where s.campaign_id = c.id), 0) as "sendsUnknownDate",
       (select count(*)::int from v_failed_sends f where f.campaign_id = c.id and ${cohort ? 'f.lead_id in (select id from lc)' : 'true'}) as "failedNeverAccepted",
       (select count(*)::int from lc join rep on rep.lead_id = lc.id where lc.campaign_id = c.id and lc.contacted_flag) as "repliedLeads",
       coalesce((select sum(rep.msgs)::int from lc join rep on rep.lead_id = lc.id where lc.campaign_id = c.id), 0) as "replyMessages",
       (select count(*)::int from lc join rep on rep.lead_id = lc.id where lc.campaign_id = c.id and lc.contacted_flag and rep.pos) as "positiveLeads",
       (select count(*)::int from lc join rep on rep.lead_id = lc.id where lc.campaign_id = c.id and lc.contacted_flag and rep.neg) as "notInterestedLeads",
       (select count(*)::int from lc join rep on rep.lead_id = lc.id where lc.campaign_id = c.id and lc.contacted_flag and rep.classified) as "classifiedLeads",
       (select count(*)::int from lc where lc.campaign_id = c.id and lc.contacted_flag and lc.bounced_at is not null) as "bouncedLeads",
       (select count(*)::int from lc where lc.campaign_id = c.id and lc.suppressed) as "unsubscribedLeads",
       (select count(*)::int from lc join fu on fu.lead_id = lc.id where lc.campaign_id = c.id) as "receivedFollowup",
       (select count(*)::int from lc join fu on fu.lead_id = lc.id join rep on rep.lead_id = lc.id
          where lc.campaign_id = c.id and rep.first_reply >= fu.first_fu) as "repliedAfterFollowup",
       (select count(*)::int from lc join oc on oc.lead_id = lc.id where lc.campaign_id = c.id and lc.contacted_flag and oc.qualified) as "qualifiedLeads",
       (select count(*)::int from lc join oc on oc.lead_id = lc.id where lc.campaign_id = c.id and lc.contacted_flag and oc.meeting) as "meetingLeads",
       (select count(*)::int from lc where lc.campaign_id = c.id and lc.contacted_flag and lc.outcome = 'won') as "wonLeads",
       (select count(*)::int from lc where lc.campaign_id = c.id and lc.contacted_flag and lc.outcome = 'lost') as "lostLeads",
       coalesce((select sum(won.value)::float8 from lc join won on won.lead_id = lc.id
                  where lc.campaign_id = c.id and lc.contacted_flag and lc.outcome = 'won'), 0) as "wonValue",
       coalesce((select array_agg(distinct won.currency) from lc join won on won.lead_id = lc.id
                  where lc.campaign_id = c.id and lc.contacted_flag and lc.outcome = 'won' and won.currency is not null), '{}') as "wonCurrencies",
       coalesce((select array_agg(distinct coalesce(mb.address, sa.sender) order by coalesce(mb.address, sa.sender))
                   from send_attempts sa left join mailboxes mb on mb.id = sa.mailbox_id
                  where sa.campaign_id = c.id and coalesce(mb.address, sa.sender) is not null), '{}') as mailboxes,
       (select max(last_at) from s where s.campaign_id = c.id) as "lastSendAt"
     from campaigns c ${slugFilter}
     order by c.channel, c.name`,
    p.values,
  );
  return rows.map(({ followupsByStepJson, ...r }) => ({ ...r, followupsByStep: followupsByStepJson ?? {} }));
}

export function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export async function campaignBySlug(slug: string): Promise<CampaignStats | null> {
  const rows = await campaignStats({ slug });
  return rows[0] ?? null;
}

export interface ContactHistoryRow {
  id: number;
  occurredAt: Date | null;
  timeQuality: string;
  recipient: string;
  leadId: number | null;
  leadName: string | null;
  step: number;
  result: string;
  provider: string | null;
  providerStatus: string | null;
  errorMessage: string | null;
  sender: string | null;
  source: string;
  executionId: string | null;
  workflowId: string | null;
}

export async function contactHistory(campaignId: number, limit = 200): Promise<ContactHistoryRow[]> {
  return q<ContactHistoryRow>(
    `select sa.id, sa.occurred_at as "occurredAt", sa.time_quality as "timeQuality", sa.recipient_norm as recipient,
            sa.lead_id as "leadId", l.name as "leadName", sa.step, sa.result, sa.provider, sa.provider_status as "providerStatus",
            sa.error_message as "errorMessage", sa.sender, sa.source, sa.n8n_execution_id as "executionId", sa.n8n_workflow_id as "workflowId"
       from send_attempts sa left join leads l on l.id = sa.lead_id
      where sa.campaign_id = $1
      order by sa.occurred_at desc nulls last, sa.id desc
      limit $2`,
    [campaignId, limit],
  );
}

export async function campaignOptions(): Promise<{ slug: string; name: string; channel: string }[]> {
  return q('select slug, name, channel from campaigns order by channel, name');
}

export async function mailboxOptions(): Promise<{ address: string; domain: string }[]> {
  return q('select address, domain from mailboxes order by domain, address');
}

export async function statusCounts(campaignId: number): Promise<Record<string, number>> {
  const rows = await q<{ status: string; n: number }>(
    `select status, count(*)::int as n from leads where campaign_id = $1 and present_in_source group by status`,
    [campaignId],
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export async function lastSendByCampaign(): Promise<Map<number, Date | null>> {
  const rows = await q<{ campaign_id: number; at: Date | null }>('select campaign_id, max(occurred_at) as at from v_sends group by campaign_id');
  return new Map(rows.map((r) => [r.campaign_id, r.at]));
}

export async function oneCampaignId(slug: string): Promise<number | null> {
  return (await one<{ id: number }>('select id from campaigns where slug = $1', [slug]))?.id ?? null;
}
