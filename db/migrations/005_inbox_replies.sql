-- Inbox triage and replies.

-- Read state kept by the dashboard. null = follow the mailbox's own \Seen flag; the dashboard
-- never changes read flags in the mailbox.
alter table mail_messages add column read_override boolean;
create index mail_messages_thread_time on mail_messages (thread_key, sent_at desc);

-- Per-conversation triage state.
create table inbox_threads (
  thread_key     text primary key,
  snoozed_until  timestamptz,
  snoozed_at     timestamptz,
  handled_at     timestamptz,          -- "No reply needed": hides the thread from Needs reply until a newer message arrives
  updated_at     timestamptz not null default now(),
  updated_by     text
);

-- Replies sent from the dashboard. One row per submit; the idempotency key makes a double submit
-- return the first result instead of sending twice.
create table mail_replies (
  id                 bigserial primary key,
  idempotency_key    text not null unique,
  thread_key         text not null,
  source_message_id  bigint references mail_messages(id) on delete set null,  -- the message answered (threading)
  mailbox_id         int not null references mailboxes(id),
  from_addr          text not null,
  to_addrs           text[] not null,
  cc_addrs           text[] not null default '{}',
  subject            text not null,
  body_text          text not null,
  body_hash          text not null,
  lead_id            bigint references leads(id) on delete set null,
  campaign_id        int references campaigns(id) on delete set null,
  status             text not null default 'sending' check (status in ('sending', 'sent', 'failed', 'unknown')),
  provider           text not null,
  provider_status    text,
  error_message      text,
  mail_message_id    bigint references mail_messages(id) on delete set null,  -- its Sent-folder copy, once synced
  created_by         text not null,
  created_at         timestamptz not null default now(),
  sent_at            timestamptz
);
create index mail_replies_thread on mail_replies (thread_key, created_at desc);
create index mail_replies_lead on mail_replies (lead_id);

-- Our latest reply to a lead after they replied (dashboard or webmail). Drives the "In conversation" status.
alter table leads add column last_response_at timestamptz;

-- Sends to our own mailboxes/domains or to internal report recipients (tests) are not outreach.
alter table send_attempts add column is_internal boolean not null default false;

create or replace view v_sends as
select distinct on (campaign_id, recipient_norm, step)
       id, campaign_id, lead_id, mailbox_id, channel, sender, recipient_norm, step,
       occurred_at, time_quality, source, message_id, wa_ack
  from send_attempts
 where result = 'accepted' and not is_internal
 order by campaign_id, recipient_norm, step,
          (time_quality = 'exact') desc, (time_quality = 'date_only') desc, occurred_at nulls last, id;

create or replace view v_failed_sends as
select distinct on (f.campaign_id, f.recipient_norm, f.step)
       f.id, f.campaign_id, f.lead_id, f.mailbox_id, f.channel, f.recipient_norm, f.step,
       f.occurred_at, f.time_quality, f.error_message, f.provider_status
  from send_attempts f
 where f.result = 'failed' and not f.is_internal
   and not exists (select 1 from send_attempts a
                    where a.result = 'accepted' and a.campaign_id is not distinct from f.campaign_id
                      and a.recipient_norm = f.recipient_norm and a.step = f.step)
 order by f.campaign_id, f.recipient_norm, f.step, f.occurred_at desc nulls last;
