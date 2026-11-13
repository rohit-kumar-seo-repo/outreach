-- "Needs you" (the Focus list on Today): which leads are actually waiting on a person.
--
-- needs_reply_at:       their latest message that needs a person (interested, a question, wants a call,
--                       later, or anything substantive). Greetings, "thanks", auto-replies and no's never set it.
-- last_outbound_at:     the latest thing we sent them after they replied, on any channel (email reply from
--                       the dashboard or webmail, WhatsApp message or reply).
-- attention_cleared_at: a person said "done" (Focus, inbox Done, WhatsApp Done) without writing back.
-- Filled by the derive job; attention_cleared_at is written by the dashboard.
alter table leads add column needs_reply_at timestamptz;
alter table leads add column last_outbound_at timestamptz;
alter table leads add column attention_cleared_at timestamptz;

create index leads_needs_reply on leads (needs_reply_at) where needs_reply_at is not null;

-- Conversations already marked Done in the email or WhatsApp inbox stay done.
update leads l set attention_cleared_at = x.at
  from (
    select lead_id, max(at) as at from (
      select m.lead_id, t.handled_at as at
        from inbox_threads t join mail_messages m on m.thread_key = t.thread_key
       where t.handled_at is not null and m.lead_id is not null
      union all
      select w.lead_id, t.handled_at
        from wa_threads t join wa_messages w on w.session = t.session and w.chat_id = t.chat_id
       where t.handled_at is not null and w.lead_id is not null) y
    group by lead_id) x
 where l.id = x.lead_id;
