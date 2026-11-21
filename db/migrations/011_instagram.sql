-- Instagram leads (2026-11-21). The Instagram comment + DM bots in n8n push every comment, every message we
-- send and every reply to /api/ingest/instagram. Each person becomes a lead in the page's campaign
-- (ig-rohit-kumar-seo / ig-ai-automation), keyed by their Instagram username, with the whole thread here.
alter table campaigns drop constraint if exists campaigns_channel_check;
alter table campaigns add constraint campaigns_channel_check check (channel in ('email', 'whatsapp', 'instagram'));

alter table leads add column if not exists ig_username text;
create index if not exists leads_ig_username on leads (ig_username) where ig_username is not null;

create table if not exists ig_messages (
  id           bigserial primary key,
  page         text not null,                 -- rohit_kumar_seo | ai_automation_by_rohit
  ext_id       text not null unique,          -- comment id or DM message id (idempotent re-sends)
  thread_id    text,                          -- Instagram conversation id, when known
  username     text not null,                 -- the lead's Instagram username (lower case)
  ig_user_id   text,
  from_me      boolean not null,
  kind         text not null check (kind in ('comment', 'comment_reply', 'dm')),
  body         text,
  stage        text,                          -- bot step this message belongs to (gate, q1 ... qualified, handoff)
  needs_you    boolean not null default false, -- set on the message where the lead asked for a call / WhatsApp
  reel_id      text,
  reel_keyword text,
  sent_at      timestamptz not null,
  lead_id      bigint references leads(id) on delete set null,
  campaign_id  int references campaigns(id) on delete set null,
  raw          jsonb not null default '{}',
  received_at  timestamptz not null default now()
);
create index if not exists ig_messages_lead_time on ig_messages (lead_id, sent_at desc) where lead_id is not null;
create index if not exists ig_messages_user on ig_messages (page, username, sent_at desc);
