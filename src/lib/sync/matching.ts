// Reconciles mailbox data with send events:
//  * threads messages (In-Reply-To / References),
//  * links Sent-folder copies to n8n send attempts (fills Message-IDs the Hostinger API does not return),
//  * records outreach sends that exist only in a Sent folder,
//  * matches inbound replies and bounces to leads/campaigns.
// Only reliable signals set lead_id; a domain-only match is stored as a suggestion and never counted.
import { env } from '../env';
import { q, tx } from '../db';
import { classifyInternal } from './internal';
import { recordSendAttempt } from './record';

const FREE_MAIL = ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'aol.com', 'rediffmail.com', 'proton.me', 'protonmail.com', 'zoho.com', 'gmx.com', 'mail.com', 'yandex.com'];

async function propagateThreads(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const rows = await q(
      `update mail_messages c set thread_key = p.thread_key
         from mail_messages p
        where p.message_id is not null and c.id <> p.id and c.thread_key is distinct from p.thread_key
          and (c.in_reply_to = p.message_id or c.references_ids[1] = p.message_id)
          and p.sent_at <= coalesce(c.sent_at, p.sent_at)
        returning c.id`,
    );
    if (rows.length === 0) break;
  }
}

async function linkSentByMessageId(): Promise<void> {
  await q(
    `update mail_messages m set send_attempt_id = sa.id, lead_id = coalesce(m.lead_id, sa.lead_id),
        campaign_id = coalesce(m.campaign_id, sa.campaign_id),
        match_method = coalesce(m.match_method, 'sent_reconcile'), match_confidence = coalesce(m.match_confidence, 'high')
       from send_attempts sa
      where m.direction = 'outbound' and m.send_attempt_id is null and m.message_id is not null and sa.message_id = m.message_id`,
  );
}

/** Hostinger API sends return no Message-ID; pair them with their Sent-folder copy by mailbox + recipient + time. */
async function linkSentByTime(): Promise<void> {
  const cands = await q<{ mid: number; message_id: string | null; sent_at: Date; said: number }>(
    `select m.id as mid, m.message_id, m.sent_at, sa.id as said
       from mail_messages m
       join send_attempts sa on sa.channel = 'email' and sa.result = 'accepted' and sa.message_id is null
        and sa.mailbox_id = m.mailbox_id and sa.recipient_norm = any(m.to_addrs) and sa.occurred_at is not null
        and ((sa.time_quality = 'exact' and abs(extract(epoch from (sa.occurred_at - m.sent_at))) <= 1800)
          or (sa.time_quality = 'date_only' and (sa.occurred_at at time zone $1)::date = (m.sent_at at time zone $1)::date))
      where m.direction = 'outbound' and m.send_attempt_id is null and m.sent_at is not null
      order by abs(extract(epoch from (sa.occurred_at - m.sent_at)))`,
    [env.timezone],
  );
  const usedM = new Set<number>();
  const usedA = new Set<number>();
  await tx(async (c) => {
    for (const cand of cands) {
      if (usedM.has(cand.mid) || usedA.has(cand.said)) continue;
      usedM.add(cand.mid);
      usedA.add(cand.said);
      await q(
        `update send_attempts set message_id = coalesce(message_id, $2),
            occurred_at = case when time_quality = 'exact' then occurred_at else $3 end,
            time_quality = 'exact', updated_at = now()
          where id = $1`,
        [cand.said, cand.message_id, cand.sent_at],
        c,
      );
      await q(
        `update mail_messages m set send_attempt_id = sa.id, lead_id = coalesce(m.lead_id, sa.lead_id), campaign_id = coalesce(m.campaign_id, sa.campaign_id),
            match_method = coalesce(m.match_method, 'sent_reconcile'), match_confidence = coalesce(m.match_confidence, 'high')
           from send_attempts sa where m.id = $1 and sa.id = $2`,
        [cand.mid, cand.said],
        c,
      );
    }
  });
}

/**
 * Outreach emails visible only in a Sent folder (older than n8n's execution history, or sent by
 * hand) become verified send events. Replies you typed to a lead's reply are conversation, not
 * outreach, so messages answering an inbound email are skipped.
 */
async function recordSentFolderOnlySends(): Promise<void> {
  const rows = await q<{
    id: number;
    message_id: string;
    sent_at: Date;
    subject: string | null;
    counterpart: string;
    sender: string;
    domain: string;
    mailbox_id: number;
    campaigns: { id: number; slug: string; brand: string | null; used_mailbox: boolean }[];
  }>(
    `select m.id, m.message_id, m.sent_at, m.subject, m.counterpart, mb.address as sender, mb.domain, mb.id as mailbox_id,
            json_agg(distinct jsonb_build_object('id', c.id, 'slug', c.slug, 'brand', c.brand,
              'used_mailbox', exists (select 1 from send_attempts sa where sa.campaign_id = c.id and sa.mailbox_id = m.mailbox_id))) as campaigns
       from mail_messages m
       join mailboxes mb on mb.id = m.mailbox_id
       join leads l on l.email_norm = m.counterpart
       join campaigns c on c.id = l.campaign_id and c.channel = 'email'
      where m.direction = 'outbound' and m.send_attempt_id is null and m.message_id is not null and m.sent_at is not null
        and m.kind <> 'internal'
        and not exists (select 1 from mail_replies r where r.mail_message_id = m.id)
        and (m.in_reply_to is null or exists (select 1 from mail_messages p where p.message_id = m.in_reply_to and p.direction = 'outbound'))
      group by m.id, mb.address, mb.domain, mb.id
      limit 5000`,
  );
  for (const r of rows) {
    let pick = r.campaigns.length === 1 ? r.campaigns[0] : null;
    if (!pick) pick = r.campaigns.filter((c) => c.used_mailbox).length === 1 ? r.campaigns.find((c) => c.used_mailbox)! : null;
    if (!pick) pick = r.campaigns.filter((c) => c.brand === r.domain).length === 1 ? r.campaigns.find((c) => c.brand === r.domain)! : null;
    if (!pick) continue; // ambiguous: leave it unmatched rather than guess
    const prior = await q<{ n: number }>(
      `select count(*)::int as n from mail_messages o join mailboxes ob on ob.id = o.mailbox_id
        where o.direction = 'outbound' and o.counterpart = $1 and ob.domain = $2 and o.sent_at < $3
          and (o.in_reply_to is null or exists (select 1 from mail_messages p where p.message_id = o.in_reply_to and p.direction = 'outbound'))`,
      [r.counterpart, r.domain, r.sent_at],
    );
    const attempt = await recordSendAttempt({
      idempotencyKey: `mbx:${r.message_id}:${r.counterpart}`,
      channel: 'email',
      campaignSlug: pick.slug,
      sender: r.sender,
      recipient: r.counterpart,
      step: prior[0].n,
      result: 'accepted',
      provider: 'mailbox',
      providerStatus: 'Copy found in the Sent folder',
      messageId: r.message_id,
      subject: r.subject,
      source: 'mailbox_sent',
      occurredAt: r.sent_at,
      timeQuality: 'exact',
    });
    await q(
      `update mail_messages m set send_attempt_id = $2, lead_id = coalesce(m.lead_id, sa.lead_id), campaign_id = coalesce(m.campaign_id, sa.campaign_id),
          match_method = coalesce(m.match_method, 'sent_reconcile'), match_confidence = coalesce(m.match_confidence, 'high')
         from send_attempts sa where m.id = $1 and sa.id = $2`,
      [r.id, attempt.id],
    );
  }
}

async function matchInbound(): Promise<void> {
  // (a) Thread headers point at one of our sends: high confidence.
  await q(
    `update mail_messages m set lead_id = p.lead_id, campaign_id = p.campaign_id, match_method = 'in_reply_to', match_confidence = 'high'
       from (select message_id, lead_id, campaign_id from mail_messages where direction = 'outbound' and lead_id is not null and message_id is not null
             union all
             select message_id, lead_id, campaign_id from send_attempts where message_id is not null and lead_id is not null) p
      where m.direction = 'inbound' and m.kind in ('message', 'auto_reply')
        and (m.match_method is null or m.match_method = 'sender_email')
        and (m.in_reply_to = p.message_id or p.message_id = any(m.references_ids))`,
  );
  // (b) Sender address is a lead we had already emailed before this message arrived: medium confidence.
  await q(
    `with cand as (
       select distinct on (m.id) m.id as mid, l.id as lead_id, l.campaign_id
         from mail_messages m
         join leads l on l.email_norm = m.from_addr
         join campaigns c on c.id = l.campaign_id and c.channel = 'email'
         join lateral (select max(sa.occurred_at) as last_at, count(*) as n from send_attempts sa
                        where sa.lead_id = l.id and sa.result = 'accepted' and (sa.occurred_at is null or sa.occurred_at <= m.sent_at)) s on s.n > 0
        where m.direction = 'inbound' and m.kind in ('message', 'auto_reply') and m.match_method is null
        order by m.id, s.last_at desc nulls last, l.is_duplicate, l.id)
     update mail_messages m set lead_id = cand.lead_id, campaign_id = cand.campaign_id, match_method = 'sender_email', match_confidence = 'medium'
       from cand where m.id = cand.mid`,
  );
  // (c) Same company domain only: stored as a suggestion, shown as Unmatched, never counted.
  await q(
    `with cand as (
       select distinct on (m.id) m.id as mid, l.id as lead_id
         from mail_messages m
         join leads l on l.email_norm is not null and split_part(l.email_norm, '@', 2) = split_part(m.from_addr, '@', 2)
        where m.direction = 'inbound' and m.kind = 'message' and m.lead_id is null and m.suggested_lead_id is null
          and not (split_part(m.from_addr, '@', 2) = any($1))
          and exists (select 1 from send_attempts sa where sa.lead_id = l.id and sa.result = 'accepted')
        order by m.id, l.id)
     update mail_messages m set suggested_lead_id = cand.lead_id from cand where m.id = cand.mid`,
    [FREE_MAIL],
  );
  await q(
    `update mail_messages set is_outreach_reply = (direction = 'inbound' and kind = 'message' and lead_id is not null)
      where is_outreach_reply is distinct from (direction = 'inbound' and kind = 'message' and lead_id is not null)`,
  );
}

async function linkBounces(): Promise<void> {
  await q(
    `update bounces b set send_attempt_id = coalesce(b.send_attempt_id, x.said), lead_id = coalesce(x.lead_id, b.lead_id), campaign_id = coalesce(x.campaign_id, b.campaign_id)
       from (select distinct on (b2.id) b2.id as bid, sa.id as said, sa.lead_id, sa.campaign_id
               from bounces b2
               join mail_messages m on m.id = b2.mail_message_id
               join send_attempts sa on sa.channel = 'email' and sa.result = 'accepted'
                and (sa.id = b2.send_attempt_id or (b2.send_attempt_id is null and sa.recipient_norm = b2.recipient_norm))
                and (sa.occurred_at is null or sa.occurred_at <= b2.occurred_at + interval '1 hour')
              where b2.lead_id is null
              order by b2.id, (sa.id = b2.send_attempt_id) desc, (sa.mailbox_id = m.mailbox_id) desc, sa.occurred_at desc nulls last) x
      where b.id = x.bid`,
  );
  await q(
    `update mail_messages m set lead_id = b.lead_id, campaign_id = b.campaign_id, match_method = coalesce(m.match_method, 'bounce'), match_confidence = coalesce(m.match_confidence, 'high')
       from bounces b where b.mail_message_id = m.id and m.lead_id is null and b.lead_id is not null`,
  );
  await q(
    `insert into suppressions (channel, value_norm, reason, source, note)
     select distinct on (recipient_norm) 'email', recipient_norm, 'hard_bounce', 'bounce', left(coalesce(status_code || ' ', '') || coalesce(diagnostic, ''), 300)
       from bounces where bounce_type = 'hard'
     on conflict (channel, value_norm) do nothing`,
  );
}

/**
 * Replies sent from the dashboard: pair each with its Sent-folder copy (the API returns no Message-ID),
 * confirm replies whose outcome was unknown, and put the copy in the reply's thread, lead and campaign.
 */
export async function linkDashboardReplies(): Promise<void> {
  await q(
    `with c as (
       select distinct on (r.id) r.id as rid, m.id as mid, m.sent_at
         from mail_replies r
         join mail_messages m on m.mailbox_id = r.mailbox_id and m.direction = 'outbound' and m.to_addrs && r.to_addrs
          and lower(coalesce(m.subject, '')) = lower(r.subject)
          and m.sent_at between coalesce(r.sent_at, r.created_at) - interval '10 minutes' and coalesce(r.sent_at, r.created_at) + interval '2 hours'
        where r.mail_message_id is null and r.status in ('sent', 'sending', 'unknown')
          and not exists (select 1 from mail_replies r2 where r2.mail_message_id = m.id)
        order by r.id, abs(extract(epoch from (m.sent_at - coalesce(r.sent_at, r.created_at)))))
     update mail_replies r set mail_message_id = c.mid, sent_at = coalesce(r.sent_at, c.sent_at),
            status = 'sent',
            provider_status = case when r.status = 'sent' then r.provider_status else 'Confirmed by its copy in the Sent folder' end
       from c where r.id = c.rid`,
  );
  await q(
    `update mail_messages m set thread_key = r.thread_key, lead_id = coalesce(m.lead_id, r.lead_id), campaign_id = coalesce(m.campaign_id, r.campaign_id),
            match_method = coalesce(m.match_method, 'dashboard_reply'), match_confidence = coalesce(m.match_confidence, 'high')
       from mail_replies r
      where r.mail_message_id = m.id and (m.thread_key is distinct from r.thread_key or m.match_method is null)`,
  );
}

export async function runMatching(): Promise<void> {
  await classifyInternal();
  await propagateThreads();
  await linkDashboardReplies();
  await linkSentByMessageId();
  await linkSentByTime();
  await recordSentFolderOnlySends();
  await matchInbound();
  await linkBounces();
  await propagateThreads();
}
