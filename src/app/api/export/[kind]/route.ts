import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { toCsv } from '@/lib/csv';
import { q } from '@/lib/db';
import { env } from '@/lib/env';
import { campaignStats } from '@/lib/metrics/campaigns';
import { parseFilters } from '@/lib/metrics/filters';
import { listLeads } from '@/lib/metrics/leads';
import { localDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { kind } = await params;
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const f = parseFilters(sp, 30);
  const tz = env.timezone;
  let rows: Record<string, unknown>[] = [];

  if (kind === 'campaigns' || kind === 'campaign') {
    const stats = await campaignStats(sp.campaign ? { slug: sp.campaign } : {});
    rows = stats.map((c) => ({
      campaign: c.name,
      slug: c.slug,
      channel: c.channel,
      status: c.status,
      started_at: c.startedAt,
      sending_mailboxes: c.mailboxes,
      leads_loaded: c.leadsLoaded,
      eligible: c.eligible,
      queued: c.queued,
      contacted: c.contacted,
      remaining: c.remaining,
      original_sent: c.originalsSent,
      followups_sent: c.followupsSent,
      followups_by_step: Object.entries(c.followupsByStep).map(([s, n]) => `FU${s}=${n}`),
      replied_leads: c.repliedLeads,
      reply_rate: c.contacted ? (c.repliedLeads / c.contacted).toFixed(4) : '',
      positive_leads: c.positiveLeads,
      positive_rate: c.contacted ? (c.positiveLeads / c.contacted).toFixed(4) : '',
      followup_recipients: c.receivedFollowup,
      replied_after_followup: c.repliedAfterFollowup,
      bounced_leads: c.bouncedLeads,
      failed_never_accepted: c.failedNeverAccepted,
      unsubscribed: c.unsubscribedLeads,
      duplicates_prevented: c.duplicatesPrevented,
      sends_unknown_date: c.sendsUnknownDate,
      qualified_leads: c.qualifiedLeads,
      meetings_booked: c.meetingLeads,
      meeting_rate: c.contacted ? (c.meetingLeads / c.contacted).toFixed(4) : '',
      won: c.wonLeads,
      won_value: c.wonValue || '',
      won_currencies: c.wonCurrencies,
      lost: c.lostLeads,
    }));
  } else if (kind === 'activity') {
    rows = await q(
      `with d as (select generate_series($2::date, $3::date, interval '1 day')::date as day)
       select to_char(d.day, 'YYYY-MM-DD') as day, c.slug as campaign,
         (select count(*) from v_sends v where v.campaign_id = c.id and v.step = 0 and v.time_quality <> 'unknown' and (v.occurred_at at time zone $1)::date = d.day) as original_sent,
         (select count(*) from v_sends v where v.campaign_id = c.id and v.step > 0 and v.time_quality <> 'unknown' and (v.occurred_at at time zone $1)::date = d.day) as followups_sent,
         (select count(*) from v_replies r where r.campaign_id = c.id and (r.at at time zone $1)::date = d.day) as replies,
         (select count(*) from v_bounces b where b.campaign_id = c.id and (b.occurred_at at time zone $1)::date = d.day) as bounces,
         (select count(*) from send_attempts a where a.campaign_id = c.id and a.result = 'failed' and a.time_quality = 'exact' and (a.occurred_at at time zone $1)::date = d.day) as failed_attempts
       from d cross join campaigns c order by d.day, c.slug`,
      [tz, f.from, f.to],
    );
  } else if (kind === 'attempts') {
    rows = await q(
      `select sa.occurred_at, sa.time_quality, c.slug as campaign, sa.channel, sa.sender, sa.recipient_norm as recipient, sa.step, sa.result,
              sa.provider, sa.provider_status, sa.error_message, sa.message_id, sa.subject, sa.source, sa.n8n_workflow_id, sa.n8n_execution_id, sa.lead_id
         from send_attempts sa left join campaigns c on c.id = sa.campaign_id
        where sa.occurred_at is null or (sa.occurred_at at time zone $1)::date between $2::date and $3::date
        order by sa.occurred_at nulls first, sa.id`,
      [tz, f.from, f.to],
    );
  } else if (kind === 'replies') {
    rows = await q(
      `select m.sent_at as received_at, c.slug as campaign, l.id as lead_id, l.name as lead, m.from_addr, mb.address as mailbox, m.folder, m.subject,
              m.match_method, m.match_confidence, m.sentiment
         from mail_messages m join mailboxes mb on mb.id = m.mailbox_id left join leads l on l.id = m.lead_id left join campaigns c on c.id = m.campaign_id
        where m.is_outreach_reply and (m.sent_at at time zone $1)::date between $2::date and $3::date order by m.sent_at`,
      [tz, f.from, f.to],
    );
  } else if (kind === 'leads') {
    const all: Record<string, unknown>[] = [];
    for (let page = 1; page <= 200; page++) {
      const { rows: r } = await listLeads({ campaign: sp.campaign, status: sp.status, outcome: sp.outcome, search: sp.q, page, pageSize: 200 });
      all.push(...(r as unknown as Record<string, unknown>[]));
      if (r.length < 200) break;
    }
    rows = all;
  } else if (kind === 'outcomes') {
    rows = await q(
      `select o.occurred_on, c.slug as campaign, l.id as lead_id, l.name as lead, l.email_norm as email, o.outcome, o.value, o.currency, o.note,
              o.recorded_at, o.recorded_by
         from lead_outcomes o join leads l on l.id = o.lead_id left join campaigns c on c.id = coalesce(o.campaign_id, l.campaign_id)
        order by o.occurred_on, o.id`,
    );
  } else if (kind === 'sending') {
    rows = await q(
      `with s as (
         select coalesce(mb.address, lower(v.sender)) as mailbox, coalesce(mb.domain, split_part(lower(v.sender), '@', 2)) as domain,
                (v.occurred_at at time zone $1)::date as day, count(*)::int as outreach
           from v_sends v left join mailboxes mb on mb.id = v.mailbox_id
          where v.channel = 'email' and v.occurred_at is not null and v.time_quality <> 'unknown'
            and (v.occurred_at at time zone $1)::date between $2::date and $3::date
          group by 1, 2, 3),
       o as (
         select mb.address as mailbox, mb.domain, (m.sent_at at time zone $1)::date as day,
                count(distinct coalesce(m.message_id, m.folder || ':' || m.uid))::int as other
           from mail_messages m join mailboxes mb on mb.id = m.mailbox_id
          where m.direction = 'outbound' and m.send_attempt_id is null and m.folder ~* 'sent' and m.sent_at is not null
            and (m.sent_at at time zone $1)::date between $2::date and $3::date
          group by 1, 2, 3)
       select to_char(coalesce(s.day, o.day), 'YYYY-MM-DD') as day, coalesce(s.domain, o.domain) as domain, coalesce(s.mailbox, o.mailbox) as mailbox,
              coalesce(s.outreach, 0) as outreach_sends, coalesce(o.other, 0) as other_sent_mail, coalesce(s.outreach, 0) + coalesce(o.other, 0) as total
         from s full join o on o.mailbox = s.mailbox and o.day = s.day
        order by 1, 2, 3`,
      [tz, f.from, f.to],
    );
  } else {
    return NextResponse.json({ error: 'unknown export' }, { status: 404 });
  }
  await q(`insert into audit_log (actor, action, target) values ($1, 'export', $2)`, [session.email, kind]);
  return new NextResponse(toCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="rks-outreach-${kind}-${localDate()}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
