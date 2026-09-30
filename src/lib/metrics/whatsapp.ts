import { one, q } from '../db';
import { env } from '../env';
import { Params } from './filters';
import { registry } from '../registry';
import type { LeadStatus } from '../sync/derive';
import { needsReplyCount } from '../whatsapp/inbox';
import { localDate } from '../time';

export async function waSessions() {
  return q<{ name: string; status: string | null; phone: string | null; lastSyncAt: Date | null; detail: Record<string, unknown> | null }>(
    `select name, status, phone, last_sync_at as "lastSyncAt", detail from wa_sessions order by name`,
  );
}

export interface WaConversation {
  chatId: string;
  /** Digits of the business's real WhatsApp number, when known. */
  phone: string | null;
  /** WhatsApp addressed this chat by a privacy ID and the number is not known yet. */
  hiddenNumber: boolean;
  leadId: number | null;
  leadName: string | null;
  contactName: string | null;
  campaignName: string | null;
  session: string;
  lastAt: Date;
  lastBody: string | null;
  lastFromMe: boolean;
  lastIsAuto: boolean;
  inbound: number;
  autoReplies: number;
  outbound: number;
}

const CONTACT = `
  left join lateral (
    select wc.phone, wc.name from wa_contacts wc
     where wc.chat_id = c.chat_id or (c.chat_id like '%@c.us' and wc.phone = replace(c.chat_id, '@c.us', ''))
     order by (wc.name is not null) desc, wc.updated_at desc limit 1) ct on true`;

export async function waConversations(limit = 100): Promise<WaConversation[]> {
  return q<WaConversation>(
    `with c as (
       select chat_id, session, max(sent_at) as last_at,
              count(*) filter (where not from_me and not is_auto)::int as inbound,
              count(*) filter (where not from_me and is_auto)::int as auto_replies,
              count(*) filter (where from_me)::int as outbound,
              (array_agg(lead_id order by sent_at desc) filter (where lead_id is not null))[1] as lead_id
         from wa_messages group by chat_id, session)
     select c.chat_id as "chatId",
            coalesce(case when c.chat_id like '%@c.us' then replace(c.chat_id, '@c.us', '') end, ct.phone) as phone,
            (c.chat_id like '%@lid' and ct.phone is null) as "hiddenNumber",
            c.lead_id as "leadId", l.name as "leadName", ct.name as "contactName", cp.name as "campaignName", c.session, c.last_at as "lastAt",
            x.body as "lastBody", x.from_me as "lastFromMe", x.is_auto as "lastIsAuto", c.inbound, c.auto_replies as "autoReplies", c.outbound
       from c
       join lateral (select body, from_me, is_auto from wa_messages w where w.chat_id = c.chat_id and w.session = c.session order by sent_at desc limit 1) x on true
       ${CONTACT}
       left join leads l on l.id = c.lead_id left join campaigns cp on cp.id = l.campaign_id
      order by c.inbound > 0 desc, c.last_at desc limit $1`,
    [limit],
  );
}

export async function waChat(chatId: string) {
  return q<{ id: number; fromMe: boolean; body: string | null; sentAt: Date; ack: number | null; session: string; hasMedia: boolean; isAuto: boolean }>(
    `select id, from_me as "fromMe", body, sent_at as "sentAt", ack, session, has_media as "hasMedia", is_auto as "isAuto"
       from wa_messages where chat_id = $1 order by sent_at`,
    [chatId],
  );
}

// ---------------------------------------------------------------------------------------------
// Lead-funnel reconciliation: every lead loaded from the sheet is in exactly one bucket below,
// so the buckets always sum to "loaded" — there is no leftover to explain away.

export const FUNNEL_BUCKETS = ['contacted', 'queued', 'needs_message', 'failed', 'duplicate', 'invalid', 'opted_out', 'excluded', 'other'] as const;
export type FunnelBucket = (typeof FUNNEL_BUCKETS)[number];

export const FUNNEL_LABELS: Record<FunnelBucket, string> = {
  contacted: 'Contacted (sent at least once)',
  queued: 'Queued to send now',
  needs_message: 'Needs a message drafted',
  failed: 'Failed to send (never delivered to WAHA)',
  duplicate: 'Duplicate contact',
  invalid: 'Invalid contact (bad/missing number)',
  opted_out: 'Opted out / do not contact',
  excluded: 'Excluded in the sheet',
  other: 'Unknown / unclassified',
};

const BUCKET_OF: Record<LeadStatus, FunnelBucket> = {
  ready: 'queued',
  awaiting_approval: 'queued',
  queued: 'queued',
  needs_draft: 'needs_message',
  sent: 'contacted',
  followup_due: 'contacted',
  replied: 'contacted',
  in_conversation: 'contacted',
  positive: 'contacted',
  not_interested: 'contacted',
  completed: 'contacted',
  bounced: 'contacted',
  failed: 'failed',
  invalid: 'invalid',
  duplicate: 'duplicate',
  excluded: 'excluded',
  unsubscribed: 'opted_out',
  unknown: 'other',
};

export interface CampaignFunnel {
  loaded: number;
  buckets: { bucket: FunnelBucket; label: string; count: number }[];
  byStatus: { status: string; count: number }[];
}

export async function campaignFunnel(campaignId: number): Promise<CampaignFunnel> {
  const rows = await q<{ status: string; n: number }>(`select status, count(*)::int as n from leads where campaign_id = $1 and present_in_source group by status`, [campaignId]);
  const counts = new Map<FunnelBucket, number>();
  for (const b of FUNNEL_BUCKETS) counts.set(b, 0);
  for (const r of rows) {
    const bucket = BUCKET_OF[r.status as LeadStatus] ?? 'other';
    counts.set(bucket, (counts.get(bucket) ?? 0) + r.n);
  }
  const loaded = rows.reduce((n, r) => n + r.n, 0);
  return {
    loaded,
    buckets: FUNNEL_BUCKETS.map((bucket) => ({ bucket, label: FUNNEL_LABELS[bucket], count: counts.get(bucket) ?? 0 })),
    byStatus: rows.map((r) => ({ status: r.status, count: r.n })).sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------------------------------------
// Overview / "what needs my attention today"

export interface WaAttentionCampaign {
  slug: string;
  name: string;
  reason: 'paused' | 'stuck' | 'low_leads';
  detail: string;
}

export interface WaVolumeRow {
  campaignSlug: string;
  campaignName: string;
  session: string;
  sentToday: number;
  dailyCap: number | null;
}

export interface WaAttention {
  needsReply: number;
  autoRepliesToday: number;
  followupsDueToday: number;
  followupsOverdue: number;
  failedSendsToday: number;
  workflowErrors: { workflowId: string; name: string | null; failures: number; lastError: string | null }[];
  disconnectedSessions: { name: string; status: string | null; phone: string | null }[];
  campaigns: WaAttentionCampaign[];
  volume: WaVolumeRow[];
  total: number;
}

export async function waAttention(): Promise<WaAttention> {
  const today = localDate();
  const [needsReply, autoToday, followups, failedToday, sessions, campaigns, volume, workflowErrors] = await Promise.all([
    needsReplyCount(),
    one<{ n: number }>(
      `select count(*)::int as n from wa_messages where not from_me and is_auto and (sent_at at time zone $1)::date = $2::date`,
      [env.timezone, today],
    ),
    one<{ due: number; overdue: number }>(
      `select count(*) filter (where (next_followup_at at time zone $1)::date = $2::date)::int as due,
              count(*) filter (where (next_followup_at at time zone $1)::date < $2::date)::int as overdue
         from leads l join campaigns c on c.id = l.campaign_id where c.channel = 'whatsapp' and l.status = 'followup_due'`,
      [env.timezone, today],
    ),
    one<{ n: number }>(
      `select count(*)::int as n from send_attempts where channel = 'whatsapp' and result = 'failed' and (coalesce(occurred_at, now()) at time zone $1)::date = $2::date`,
      [env.timezone, today],
    ),
    q<{ name: string; status: string | null; phone: string | null }>(`select name, status, phone from wa_sessions where status is distinct from 'WORKING' order by name`),
    q<{ slug: string; name: string; controlPausedAt: Date | null; remaining: number; contacted: number }>(
      `select c.slug, c.name, c.control_paused_at as "controlPausedAt",
              (select count(*)::int from leads l where l.campaign_id = c.id and l.present_in_source and l.status in ('ready','queued','awaiting_approval','needs_draft')) as remaining,
              (select count(*)::int from leads l where l.campaign_id = c.id and l.sends_accepted > 0) as contacted
         from campaigns c where c.channel = 'whatsapp' order by c.name`,
    ),
    q<{ campaignSlug: string; campaignName: string; session: string; sentToday: number; dailyCap: number | null }>(
      `select c.slug as "campaignSlug", c.name as "campaignName", coalesce(c.config->>'waSession','—') as session,
              count(*) filter (where sa.result = 'accepted' and (coalesce(sa.occurred_at, now()) at time zone $1)::date = $2::date)::int as "sentToday",
              c.daily_cap as "dailyCap"
         from campaigns c left join send_attempts sa on sa.campaign_id = c.id and sa.channel = 'whatsapp'
        where c.channel = 'whatsapp' group by c.slug, c.name, c.config, c.daily_cap order by c.name`,
      [env.timezone, today],
    ),
    q<{ workflow_id: string; name: string | null; failures: number; last_error: string | null }>(
      `with f as (
         select e.workflow_id, count(*)::int as failures,
                (array_agg(e.error_message order by e.started_at desc) filter (where coalesce(e.error_message,'') <> ''))[1] as last_error
           from n8n_executions e
          where e.status in ('error','crashed') and e.started_at > now() - interval '24 hours' and e.workflow_id = any($1)
          group by e.workflow_id)
       select f.*, w.name from f left join n8n_workflows w on w.id = f.workflow_id`,
      [registry().campaigns.filter((c) => c.channel === 'whatsapp').flatMap((c) => c.workflowIds)],
    ),
  ]);
  const attentionCampaigns: WaAttentionCampaign[] = [];
  for (const c of campaigns) {
    if (c.controlPausedAt) attentionCampaigns.push({ slug: c.slug, name: c.name, reason: 'paused', detail: 'Paused from the dashboard.' });
    else if (c.remaining === 0 && c.contacted > 0) attentionCampaigns.push({ slug: c.slug, name: c.name, reason: 'stuck', detail: 'No eligible leads left to send to.' });
    else if (c.remaining > 0 && c.remaining < 20) attentionCampaigns.push({ slug: c.slug, name: c.name, reason: 'low_leads', detail: `Only ${c.remaining} eligible lead(s) remaining.` });
  }
  const total = needsReply + attentionCampaigns.length + sessions.length;
  return {
    needsReply,
    autoRepliesToday: autoToday?.n ?? 0,
    followupsDueToday: followups?.due ?? 0,
    followupsOverdue: followups?.overdue ?? 0,
    failedSendsToday: failedToday?.n ?? 0,
    workflowErrors: workflowErrors.map((w) => ({ workflowId: w.workflow_id, name: w.name, failures: w.failures, lastError: w.last_error })),
    disconnectedSessions: sessions,
    campaigns: attentionCampaigns,
    volume,
    total,
  };
}

// ---------------------------------------------------------------------------------------------
// Accounts (sessions): who else is using them.

export interface WaAccount {
  name: string;
  status: string | null;
  phone: string | null;
  lastSyncAt: Date | null;
  pushName: string | null;
  campaigns: { slug: string; name: string }[];
}

export interface WaCampaignDraft {
  id: number;
  name: string;
  sheetUrl: string | null;
  sheetTab: string | null;
  session: string | null;
  templateId: number | null;
  dailyCap: number | null;
  notes: string | null;
  createdAt: Date;
  createdBy: string | null;
}

export async function listCampaignDrafts(): Promise<WaCampaignDraft[]> {
  return q<WaCampaignDraft>(
    `select id, name, sheet_url as "sheetUrl", sheet_tab as "sheetTab", session, template_id as "templateId", daily_cap as "dailyCap", notes,
            created_at as "createdAt", created_by as "createdBy"
       from wa_campaign_drafts where status = 'draft' order by created_at desc`,
  );
}

// ---------------------------------------------------------------------------------------------
// Reports & scale warnings

export interface WaReportFilters {
  campaign?: string | null;
  session?: string | null;
  from: string;
  to: string;
}

export interface WaDailyRow {
  day: string;
  accepted: number;
  failed: number;
  replies: number;
}

export interface WaReport {
  daily: WaDailyRow[];
  totals: { accepted: number; failed: number; replies: number; autoReplies: number; optedOut: number };
  ackBreakdown: { ack: number; label: string; n: number }[];
  responseTimeHours: { median: number | null; sampleSize: number };
  outcomes: { qualified: number; meeting: number; won: number; lost: number };
  warnings: { level: 'warn' | 'critical'; text: string }[];
}

const ACK_LABELS = ['Pending', 'Sent to server', 'Delivered to device', 'Read', 'Played'];

export async function waReport(f: WaReportFilters): Promise<WaReport> {
  // Each query below builds its own isolated Params instance — simpler and safer than sharing
  // placeholder numbering across queries with different shapes.
  const sends = (result: 'accepted' | 'failed') => {
    const p = new Params();
    const camp = f.campaign ? `and c.slug = ${p.add(f.campaign)}` : '';
    const sess = f.session ? `and coalesce(c.config->>'waSession', sa.sender) = ${p.add(f.session)}` : '';
    const tz = p.add(env.timezone);
    const day = `(coalesce(sa.occurred_at, now()) at time zone ${tz})::date`;
    return { camp, sess, day, p, from: p.add(f.from), to: p.add(f.to) };
  };

  const acceptedQ = sends('accepted');
  const failedQ = sends('failed');
  const repliesP = new Params();
  const repliesCamp = f.campaign ? `and c.slug = ${repliesP.add(f.campaign)}` : '';
  const repliesSess = f.session ? `and w.session = ${repliesP.add(f.session)}` : '';
  const repliesTz = repliesP.add(env.timezone);
  const repliesFrom = repliesP.add(f.from);
  const repliesTo = repliesP.add(f.to);

  const ackP = new Params();
  const ackCamp = f.campaign ? `and c.slug = ${ackP.add(f.campaign)}` : '';
  const ackSess = f.session ? `and w.session = ${ackP.add(f.session)}` : '';
  const ackTz = ackP.add(env.timezone);
  const ackFrom = ackP.add(f.from);
  const ackTo = ackP.add(f.to);

  const respP = new Params();
  const respCamp = f.campaign ? `and c.slug = ${respP.add(f.campaign)}` : '';

  const outcomeP = new Params();
  const outcomeCamp = f.campaign ? `and c.slug = ${outcomeP.add(f.campaign)}` : '';

  const [accepted, failed, replies, ackRows, response, outcomeRow, optOuts, recentFail, priorFail] = await Promise.all([
    q<{ day: string; n: number }>(
      `select ${acceptedQ.day} as day, count(*)::int as n from send_attempts sa join campaigns c on c.id = sa.campaign_id
        where sa.channel = 'whatsapp' and sa.result = 'accepted' ${acceptedQ.camp} ${acceptedQ.sess}
          and ${acceptedQ.day} between ${acceptedQ.from}::date and ${acceptedQ.to}::date
        group by 1`,
      acceptedQ.p.values,
    ),
    q<{ day: string; n: number }>(
      `select ${failedQ.day} as day, count(*)::int as n from send_attempts sa join campaigns c on c.id = sa.campaign_id
        where sa.channel = 'whatsapp' and sa.result = 'failed' ${failedQ.camp} ${failedQ.sess}
          and ${failedQ.day} between ${failedQ.from}::date and ${failedQ.to}::date
        group by 1`,
      failedQ.p.values,
    ),
    q<{ day: string; n: number }>(
      `select (w.sent_at at time zone ${repliesTz})::date as day, count(*)::int as n from wa_messages w left join campaigns c on c.id = w.campaign_id
        where not w.from_me and not w.is_auto ${repliesCamp} ${repliesSess}
          and (w.sent_at at time zone ${repliesTz})::date between ${repliesFrom}::date and ${repliesTo}::date
        group by 1`,
      repliesP.values,
    ),
    q<{ ack: number; n: number }>(
      `select ack, count(*)::int as n from wa_messages w left join campaigns c on c.id = w.campaign_id
        where w.from_me and w.ack is not null ${ackCamp} ${ackSess}
          and (w.sent_at at time zone ${ackTz})::date between ${ackFrom}::date and ${ackTo}::date
        group by ack`,
      ackP.values,
    ).catch(() => []),
    one<{ median_hours: number | null; n: number }>(
      `select percentile_cont(0.5) within group (order by extract(epoch from (fr.first_reply - l.first_contacted_at)) / 3600.0) as median_hours, count(*)::int as n
         from leads l join campaigns c on c.id = l.campaign_id
         join lateral (select min(sent_at) as first_reply from wa_messages w where w.lead_id = l.id and not w.from_me and not w.is_auto) fr on fr.first_reply is not null
        where c.channel = 'whatsapp' and l.first_contacted_at is not null and fr.first_reply > l.first_contacted_at ${respCamp}`,
      respP.values,
    ),
    one<{ qualified: number; meeting: number; won: number; lost: number }>(
      `select count(*) filter (where o.outcome = 'qualified')::int as qualified, count(*) filter (where o.outcome = 'meeting_booked')::int as meeting,
              count(*) filter (where o.outcome = 'won')::int as won, count(*) filter (where o.outcome = 'lost')::int as lost
         from lead_outcomes o join campaigns c on c.id = o.campaign_id where c.channel = 'whatsapp' ${outcomeCamp}`,
      outcomeP.values,
    ),
    one<{ n: number }>(`select count(*)::int as n from suppressions where channel = 'whatsapp' and created_at::date between $1::date and $2::date`, [f.from, f.to]),
    one<{ n: number }>(`select count(*)::int as n from send_attempts where channel = 'whatsapp' and result = 'failed' and occurred_at > now() - interval '7 days'`),
    one<{ n: number }>(`select count(*)::int as n from send_attempts where channel = 'whatsapp' and result = 'failed' and occurred_at <= now() - interval '7 days' and occurred_at > now() - interval '14 days'`),
  ]);
  const byDay = new Map<string, WaDailyRow>();
  for (let d = new Date(`${f.from}T00:00:00Z`); d.getTime() <= new Date(`${f.to}T00:00:00Z`).getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    byDay.set(day, { day, accepted: 0, failed: 0, replies: 0 });
  }
  for (const r of accepted) {
    const row = byDay.get(String(r.day));
    if (row) row.accepted = r.n;
  }
  for (const r of failed) {
    const row = byDay.get(String(r.day));
    if (row) row.failed = r.n;
  }
  for (const r of replies) {
    const row = byDay.get(String(r.day));
    if (row) row.replies = r.n;
  }
  const daily = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  const totals = daily.reduce(
    (a, d) => ({ accepted: a.accepted + d.accepted, failed: a.failed + d.failed, replies: a.replies + d.replies, autoReplies: a.autoReplies, optedOut: a.optedOut }),
    { accepted: 0, failed: 0, replies: 0, autoReplies: 0, optedOut: optOuts?.n ?? 0 },
  );
  const warnings: WaReport['warnings'] = [];
  if ((recentFail?.n ?? 0) > (priorFail?.n ?? 0) * 1.5 && (recentFail?.n ?? 0) >= 5) {
    warnings.push({ level: 'warn', text: `Failed sends rose from ${priorFail?.n ?? 0} to ${recentFail?.n ?? 0} over the last two 7-day periods.` });
  }
  const disconnected = await q<{ name: string }>(`select name from wa_sessions where status is distinct from 'WORKING'`);
  for (const s of disconnected) warnings.push({ level: 'critical', text: `Account "${s.name}" is disconnected.` });
  return {
    daily,
    totals,
    ackBreakdown: ackRows.map((r) => ({ ack: r.ack, label: ACK_LABELS[r.ack] ?? String(r.ack), n: r.n })).sort((a, b) => a.ack - b.ack),
    responseTimeHours: { median: response?.median_hours ?? null, sampleSize: response?.n ?? 0 },
    outcomes: outcomeRow ?? { qualified: 0, meeting: 0, won: 0, lost: 0 },
    warnings,
  };
}

export async function waAccounts(): Promise<WaAccount[]> {
  const sessions = await waSessions();
  const camps = await q<{ session: string; slug: string; name: string }>(
    `select config->>'waSession' as session, slug, name from campaigns where channel = 'whatsapp' and config->>'waSession' is not null`,
  );
  return sessions.map((s) => ({
    name: s.name,
    status: s.status,
    phone: s.phone,
    lastSyncAt: s.lastSyncAt,
    pushName: (s.detail?.pushName as string | undefined) ?? null,
    campaigns: camps.filter((c) => c.session === s.name).map((c) => ({ slug: c.slug, name: c.name })),
  }));
}
