-- WhatsApp contacts: newer WhatsApp versions address chats by a privacy ID ("…@lid") instead of the
-- phone number. Webhook events carry the real number next to it (key.remoteJidAlt), and WAHA can
-- look it up; the mapping is kept here so chats show the business's number and link to their lead.
create table wa_contacts (
  chat_id     text primary key,       -- as WhatsApp reported it: "<privacy id>@lid" or "<digits>@c.us"
  phone       text,                   -- digits in international format, no "+"
  name        text,                   -- WhatsApp profile or verified business name, when known
  source      text not null,          -- webhook | waha_lookup
  updated_at  timestamptz not null default now()
);
create index wa_contacts_phone on wa_contacts (phone);

-- Re-read the "WAHA - Incoming Message Webhook" executions n8n still keeps (about 6 days), so chats
-- already stored under a privacy ID pick up their real number.
update n8n_executions set final = false where workflow_id = '8UXe0Mx8X3VG1Xfq';

-- Automatic WhatsApp Business greetings / away messages are not replies.
alter table wa_messages add column is_auto boolean not null default false;

create or replace view v_replies as
(select distinct on (coalesce(m.message_id, 'row:' || m.id))
        'email'::text as channel, m.lead_id, m.campaign_id, m.mailbox_id, m.sent_at as at, m.sentiment, m.id as ref_id
   from mail_messages m
  where m.is_outreach_reply
  order by coalesce(m.message_id, 'row:' || m.id), m.sent_at)
union all
(select 'whatsapp'::text, w.lead_id, w.campaign_id, null::int, w.sent_at, null::text, w.id
   from wa_messages w
  where not w.from_me and not w.is_auto and w.lead_id is not null
    and exists (select 1 from send_attempts sa where sa.lead_id = w.lead_id and sa.result = 'accepted'
                 and (sa.occurred_at is null or sa.occurred_at <= w.sent_at)));
