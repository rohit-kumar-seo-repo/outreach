import { env } from '../env';
import { one, q } from '../db';
import { addDays, localDate } from '../time';
import { Params, scopeSql, type Filters } from './filters';

export interface DailyPoint {
  day: string;
  sent: number;
  followups: number;
  replies: number;
  bounces: number;
  failed: number;
}

/** Daily counts in the dashboard timezone. Sends with an unknown date are not plotted (see unknownDated). */
export async function dailyActivity(f: Filters): Promise<{ points: DailyPoint[]; unknownDated: number }> {
  const p = new Params();
  const tz = p.add(env.timezone);
  const from = p.add(f.from);
  const to = p.add(f.to);
  const sendScope = scopeSql(f, p, 'v');
  const replyScope = scopeSql(f, p, 'v');
  const bounceScope = scopeSql(f, p, 'v', { channelCol: f.channel === 'whatsapp' ? `'email'` : null });
  const failScope = scopeSql(f, p, 'a');
  const rows = await q<DailyPoint>(
    `with days as (select d::date as day from generate_series(${from}::date, ${to}::date, interval '1 day') d),
     s as (select (v.occurred_at at time zone ${tz})::date as day,
                  count(*) filter (where v.step = 0)::int as sent, count(*) filter (where v.step > 0)::int as followups
             from v_sends v left join campaigns c on c.id = v.campaign_id left join mailboxes mb on mb.id = v.mailbox_id
            where v.occurred_at is not null and v.time_quality <> 'unknown'
              and (v.occurred_at at time zone ${tz})::date between ${from}::date and ${to}::date ${sendScope}
            group by 1),
     r as (select (v.at at time zone ${tz})::date as day, count(*)::int as replies
             from v_replies v left join campaigns c on c.id = v.campaign_id left join mailboxes mb on mb.id = v.mailbox_id
            where (v.at at time zone ${tz})::date between ${from}::date and ${to}::date ${replyScope}
            group by 1),
     b as (select (v.occurred_at at time zone ${tz})::date as day, count(*)::int as bounces
             from v_bounces v left join campaigns c on c.id = v.campaign_id left join mailboxes mb on mb.id = v.mailbox_id
            where (v.occurred_at at time zone ${tz})::date between ${from}::date and ${to}::date ${bounceScope}
            group by 1),
     fa as (select (a.occurred_at at time zone ${tz})::date as day, count(*)::int as failed
              from send_attempts a left join campaigns c on c.id = a.campaign_id left join mailboxes mb on mb.id = a.mailbox_id
             where a.result = 'failed' and a.time_quality = 'exact'
               and (a.occurred_at at time zone ${tz})::date between ${from}::date and ${to}::date ${failScope}
             group by 1)
     select to_char(days.day, 'YYYY-MM-DD') as day, coalesce(s.sent, 0) as sent, coalesce(s.followups, 0) as followups,
            coalesce(r.replies, 0) as replies, coalesce(b.bounces, 0) as bounces, coalesce(fa.failed, 0) as failed
       from days left join s using (day) left join r using (day) left join b using (day) left join fa using (day)
      order by days.day`,
    p.values,
  );
  const p2 = new Params();
  const unknown = await one<{ n: number }>(
    `select count(*)::int as n from v_sends v left join campaigns c on c.id = v.campaign_id left join mailboxes mb on mb.id = v.mailbox_id
      where (v.occurred_at is null or v.time_quality = 'unknown') ${scopeSql(f, p2, 'v')}`,
    p2.values,
  );
  return { points: rows, unknownDated: unknown?.n ?? 0 };
}

export interface OverviewKpis {
  today: string;
  sentToday: number;
  followupsToday: number;
  repliesToday: number;
  repliesTodayWhatsapp: number;
  scheduledTomorrow: number;
  scheduledTomorrowFollowups: number;
  followupsDueToday: number;
  followupsOverdue: number;
  flaggedThreadsDue: number;
  bouncesToday: number;
  failedToday: number;
  activeCampaigns: number;
  campaignsWithSends7d: number;
  campaignStatusUnknown: number;
  readyLeads: number;
  queuedLeads: number;
  awaitingApproval: number;
  needsDraft: number;
  remainingLeads: number;
  unmatchedInbound: number;
}

export async function overviewKpis(f: Filters): Promise<OverviewKpis> {
  const today = localDate();
  const tomorrow = addDays(today, 1);
  const p = new Params();
  const tz = p.add(env.timezone);
  const t = p.add(today);
  const tm = p.add(tomorrow);
  const scope = scopeSql(f, p, 'v');
  const leadScope = (() => {
    const parts: string[] = [];
    if (f.campaign) parts.push(`c.slug = ${p.add(f.campaign)}`);
    if (f.channel !== 'all') parts.push(`c.channel = ${p.add(f.channel)}`);
    return parts.length ? ` and ${parts.join(' and ')}` : '';
  })();
  const aScope = scopeSql(f, p, 'a');
  const row = await one<Omit<OverviewKpis, 'today'>>(
    `select
      (select count(*)::int from v_sends v left join campaigns c on c.id = v.campaign_id left join mailboxes mb on mb.id = v.mailbox_id
        where v.step = 0 and v.time_quality <> 'unknown' and (v.occurred_at at time zone ${tz})::date = ${t}::date ${scope}) as "sentToday",
      (select count(*)::int from v_sends v left join campaigns c on c.id = v.campaign_id left join mailboxes mb on mb.id = v.mailbox_id
        where v.step > 0 and v.time_quality <> 'unknown' and (v.occurred_at at time zone ${tz})::date = ${t}::date ${scope}) as "followupsToday",
      (select count(*)::int from v_replies v left join campaigns c on c.id = v.campaign_id left join mailboxes mb on mb.id = v.mailbox_id
        where v.channel = 'email' and (v.at at time zone ${tz})::date = ${t}::date ${scope}) as "repliesToday",
      (select count(*)::int from v_replies v left join campaigns c on c.id = v.campaign_id left join mailboxes mb on mb.id = v.mailbox_id
        where v.channel = 'whatsapp' and (v.at at time zone ${tz})::date = ${t}::date ${scope}) as "repliesTodayWhatsapp",
      (select count(*)::int from leads l join campaigns c on c.id = l.campaign_id
        where l.status = 'queued' and coalesce(l.touch_number, 1) <= 1 and l.present_in_source
          and coalesce((l.scheduled_send_at at time zone ${tz})::date, l.scheduled_date) = ${tm}::date ${leadScope}) as "scheduledTomorrow",
      (select count(*)::int from leads l join campaigns c on c.id = l.campaign_id
        where l.status in ('queued', 'sent', 'followup_due') and coalesce(l.touch_number, 1) > 1 and l.present_in_source
          and (l.scheduled_send_at at time zone ${tz})::date = ${tm}::date ${leadScope}) as "scheduledTomorrowFollowups",
      (select count(*)::int from leads l join campaigns c on c.id = l.campaign_id
        where l.next_followup_at is not null and (l.next_followup_at at time zone ${tz})::date = ${t}::date
          and l.status in ('followup_due', 'sent', 'queued') ${leadScope}) as "followupsDueToday",
      (select count(*)::int from leads l join campaigns c on c.id = l.campaign_id
        where l.next_followup_at is not null and (l.next_followup_at at time zone ${tz})::date < ${t}::date
          and l.status in ('followup_due', 'sent', 'queued') ${leadScope}) as "followupsOverdue",
      (select count(distinct coalesce(m.thread_key, m.id::text))::int from mail_messages m
        where m.needs_followup and (m.followup_due_at is null or (m.followup_due_at at time zone ${tz})::date <= ${t}::date)) as "flaggedThreadsDue",
      (select count(*)::int from v_bounces v left join campaigns c on c.id = v.campaign_id left join mailboxes mb on mb.id = v.mailbox_id
        where (v.occurred_at at time zone ${tz})::date = ${t}::date ${f.channel === 'whatsapp' ? 'and false' : scopeSql({ ...f, channel: 'all' }, p, 'v')}) as "bouncesToday",
      (select count(*)::int from send_attempts a left join campaigns c on c.id = a.campaign_id left join mailboxes mb on mb.id = a.mailbox_id
        where a.result = 'failed' and a.time_quality = 'exact' and (a.occurred_at at time zone ${tz})::date = ${t}::date ${aScope}) as "failedToday",
      (select count(*)::int from campaigns c where c.status = 'active' ${leadScope}) as "activeCampaigns",
      (select count(distinct v.campaign_id)::int from v_sends v join campaigns c on c.id = v.campaign_id
        where v.occurred_at > now() - interval '7 days' ${leadScope}) as "campaignsWithSends7d",
      (select count(*)::int from campaigns c where c.status = 'unknown' ${leadScope}) as "campaignStatusUnknown",
      (select count(*)::int from leads l join campaigns c on c.id = l.campaign_id where l.status = 'ready' and l.present_in_source ${leadScope}) as "readyLeads",
      (select count(*)::int from leads l join campaigns c on c.id = l.campaign_id where l.status = 'queued' and l.present_in_source ${leadScope}) as "queuedLeads",
      (select count(*)::int from leads l join campaigns c on c.id = l.campaign_id where l.status = 'awaiting_approval' and l.present_in_source ${leadScope}) as "awaitingApproval",
      (select count(*)::int from leads l join campaigns c on c.id = l.campaign_id where l.status = 'needs_draft' and l.present_in_source ${leadScope}) as "needsDraft",
      (select count(*)::int from leads l join campaigns c on c.id = l.campaign_id
        where l.present_in_source and l.status in ('ready', 'queued', 'awaiting_approval', 'needs_draft', 'failed') ${leadScope}) as "remainingLeads",
      (select count(*)::int from mail_messages m where m.direction = 'inbound' and m.kind = 'message' and m.lead_id is null
        and m.sent_at > now() - interval '30 days' and m.folder !~* '(spam|junk|trash)') as "unmatchedInbound"`,
    p.values,
  );
  return { today, ...(row as Omit<OverviewKpis, 'today'>) };
}

export interface DeliveryFunnel {
  scheduledUpcoming: number;
  attempted: number;
  accepted: number;
  failed: number;
  bounced: number;
  confirmedByReply: number;
  confirmedWhatsappAck: number;
  unverified: number;
}

/** Scheduled → attempted → accepted → bounced / confirmed for sends in the filter range. */
export async function deliveryFunnel(f: Filters): Promise<DeliveryFunnel> {
  const p = new Params();
  const tz = p.add(env.timezone);
  const from = p.add(f.from);
  const to = p.add(f.to);
  const scope = scopeSql(f, p, 'x');
  const inRange = (col: string) => `${col} is not null and (${col} at time zone ${tz})::date between ${from}::date and ${to}::date`;
  const row = await one<DeliveryFunnel>(
    `with attempted as (
        select distinct x.campaign_id, x.recipient_norm, x.step from send_attempts x
          left join campaigns c on c.id = x.campaign_id left join mailboxes mb on mb.id = x.mailbox_id
         where x.time_quality <> 'unknown' and ${inRange('x.occurred_at')} ${scope}),
      acc as (select x.* from v_sends x left join campaigns c on c.id = x.campaign_id left join mailboxes mb on mb.id = x.mailbox_id
               where x.time_quality <> 'unknown' and ${inRange('x.occurred_at')} ${scope}),
      bounced as (select distinct acc.id from acc join bounces b on b.recipient_norm = acc.recipient_norm
                   and b.occurred_at >= acc.occurred_at and b.occurred_at < acc.occurred_at + interval '14 days'),
      replied as (select distinct acc.id from acc join v_replies r on r.lead_id = acc.lead_id and r.at >= acc.occurred_at and acc.channel = 'email')
     select
       (select count(*)::int from leads l join campaigns c on c.id = l.campaign_id
         where l.status = 'queued' and l.present_in_source
           and coalesce(l.scheduled_send_at, (l.scheduled_date::timestamp at time zone ${tz})) >= date_trunc('day', now() at time zone ${tz}) at time zone ${tz}
           ${f.campaign ? `and c.slug = ${p.add(f.campaign)}` : ''}) as "scheduledUpcoming",
       (select count(*)::int from attempted) as attempted,
       (select count(*)::int from acc) as accepted,
       (select count(*)::int from attempted a where not exists (
          select 1 from send_attempts s where s.result = 'accepted' and s.campaign_id is not distinct from a.campaign_id
            and s.recipient_norm = a.recipient_norm and s.step = a.step)) as failed,
       (select count(*)::int from bounced) as bounced,
       (select count(*)::int from replied where id not in (select id from bounced)) as "confirmedByReply",
       (select count(*)::int from acc where channel = 'whatsapp' and coalesce(wa_ack, 0) >= 2) as "confirmedWhatsappAck",
       0 as unverified`,
    p.values,
  );
  const r = row!;
  r.unverified = Math.max(0, r.accepted - r.bounced - r.confirmedByReply - r.confirmedWhatsappAck);
  return r;
}

export interface IntegrationStatus {
  key: string;
  name: string;
  kind: string;
  status: 'ok' | 'error' | 'not_connected' | 'never';
  lastSuccessAt: Date | null;
  lastSyncAt: Date | null;
  lastError: string | null;
  detail: string | null;
}

export async function integrationStatuses(): Promise<IntegrationStatus[]> {
  const sources = await q<{ key: string; name: string; kind: string; last_status: string | null; last_success_at: Date | null; last_sync_at: Date | null; last_error: string | null; row_count: number | null }>(
    `select key, name, kind, last_status, last_success_at, last_sync_at, last_error, row_count from sources
      where kind <> 'ingest' or last_sync_at is not null order by kind, name`,
  );
  const out: IntegrationStatus[] = sources.map((s) => ({
    key: s.key,
    name: s.name,
    kind: s.kind,
    status: !s.last_sync_at ? 'never' : s.last_status === 'ok' ? 'ok' : s.last_error?.startsWith('Not connected') ? 'not_connected' : 'error',
    lastSuccessAt: s.last_success_at,
    lastSyncAt: s.last_sync_at,
    lastError: s.last_error,
    detail: s.row_count !== null ? `${s.row_count} rows` : null,
  }));
  const boxes = await q<{ address: string; provider: string; last_status: string | null; last_success_at: Date | null; last_sync_at: Date | null; last_error: string | null }>(
    `select address, provider, last_status, last_success_at, last_sync_at, last_error from mailboxes order by domain, address`,
  );
  for (const b of boxes) {
    out.push({
      key: `mailbox:${b.address}`,
      name: b.address,
      kind: 'mailbox',
      status: b.last_status === 'ok' ? 'ok' : b.last_status === 'error' ? 'error' : b.last_status === 'not_connected' ? 'not_connected' : 'never',
      lastSuccessAt: b.last_success_at,
      lastSyncAt: b.last_sync_at,
      lastError: b.last_error,
      detail: b.provider === 'hostinger_api' ? 'Hostinger Email API' : b.provider === 'imap' ? 'IMAP' : null,
    });
  }
  return out;
}
