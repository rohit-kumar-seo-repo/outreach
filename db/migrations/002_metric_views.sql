-- Canonical counting rules. Every dashboard number is built on these views.

-- One "send" = one (campaign, recipient, step) that a server accepted. The same send may be
-- reported by several writers (n8n execution, sheet status, Sent-folder copy); it counts once,
-- timed by the most precise source available.
create view v_sends as
select distinct on (campaign_id, recipient_norm, step)
       id, campaign_id, lead_id, mailbox_id, channel, sender, recipient_norm, step,
       occurred_at, time_quality, source, message_id, wa_ack
  from send_attempts
 where result = 'accepted'
 order by campaign_id, recipient_norm, step,
          (time_quality = 'exact') desc, (time_quality = 'date_only') desc, occurred_at nulls last, id;

-- Attempts that failed and were never accepted for the same (campaign, recipient, step).
create view v_failed_sends as
select distinct on (f.campaign_id, f.recipient_norm, f.step)
       f.id, f.campaign_id, f.lead_id, f.mailbox_id, f.channel, f.recipient_norm, f.step,
       f.occurred_at, f.time_quality, f.error_message, f.provider_status
  from send_attempts f
 where f.result = 'failed'
   and not exists (select 1 from send_attempts a
                    where a.result = 'accepted' and a.campaign_id is not distinct from f.campaign_id
                      and a.recipient_norm = f.recipient_norm and a.step = f.step)
 order by f.campaign_id, f.recipient_norm, f.step, f.occurred_at desc nulls last;

-- A reply = an inbound message matched to a contacted lead. Email copies of the same message in
-- several folders/mailboxes count once. WhatsApp replies only count after the first outreach message.
create view v_replies as
(select distinct on (coalesce(m.message_id, 'row:' || m.id))
        'email'::text as channel, m.lead_id, m.campaign_id, m.mailbox_id, m.sent_at as at, m.sentiment, m.id as ref_id
   from mail_messages m
  where m.is_outreach_reply
  order by coalesce(m.message_id, 'row:' || m.id), m.sent_at)
union all
(select 'whatsapp'::text, w.lead_id, w.campaign_id, null::int, w.sent_at, null::text, w.id
   from wa_messages w
  where not w.from_me and w.lead_id is not null
    and exists (select 1 from send_attempts sa where sa.lead_id = w.lead_id and sa.result = 'accepted'
                 and (sa.occurred_at is null or sa.occurred_at <= w.sent_at)));

-- One bounce per recipient per day (servers often send several DSNs for one failure).
create view v_bounces as
select distinct on (b.recipient_norm, (b.occurred_at at time zone 'UTC')::date)
       b.id, b.recipient_norm, b.bounce_type, b.status_code, b.diagnostic, b.lead_id, b.campaign_id,
       b.occurred_at, m.mailbox_id
  from bounces b join mail_messages m on m.id = b.mail_message_id
 order by b.recipient_norm, (b.occurred_at at time zone 'UTC')::date, b.occurred_at;
