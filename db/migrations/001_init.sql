-- Rohit Kumar SEO Outreach — core schema.
-- All timestamps are stored as timestamptz (UTC on disk) and rendered in APP_TIMEZONE.

-- ---------------------------------------------------------------- auth ----
create table sessions (
  id            text primary key,                 -- sha256(token); the raw token only lives in the cookie
  user_email    text not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  ip            text,
  user_agent    text,
  revoked_at    timestamptz
);

create table login_attempts (
  id       bigserial primary key,
  ip       text,
  email    text,
  success  boolean not null,
  at       timestamptz not null default now()
);
create index login_attempts_ip_at on login_attempts (ip, at);
create index login_attempts_email_at on login_attempts (email, at);

create table audit_log (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  actor   text not null,
  action  text not null,
  target  text,
  detail  jsonb
);

-- ------------------------------------------------------------ registry ----
create table campaigns (
  id           serial primary key,
  slug         text not null unique,
  name         text not null,
  channel      text not null check (channel in ('email', 'whatsapp')),
  brand        text,
  status       text not null default 'unknown',    -- active | paused | unknown (follows the n8n workflows' active flag)
  description  text,
  config       jsonb not null default '{}',
  started_at   timestamptz,                         -- first accepted send (derived)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table mailboxes (
  id               serial primary key,
  address          text not null unique,            -- lowercase
  domain           text not null,
  display_name     text,
  provider         text not null default 'none',    -- hostinger_api | imap | none
  provider_ref     text,                            -- e.g. Hostinger mailbox resourceId
  sync_enabled     boolean not null default true,
  last_sync_at     timestamptz,
  last_success_at  timestamptz,
  last_status      text,
  last_error       text,
  created_at       timestamptz not null default now()
);

create table mail_folders (
  id             serial primary key,
  mailbox_id     int not null references mailboxes(id) on delete cascade,
  path           text not null,
  name           text not null,
  special_use    text,
  message_count  int,
  unread_count   int,
  last_uid       bigint not null default 0,
  uid_validity   bigint,
  last_sync_at   timestamptz,
  unique (mailbox_id, path)
);

create table sources (
  id               serial primary key,
  key              text not null unique,
  kind             text not null,       -- google_sheet | n8n_data_table | n8n_workflow | mailbox | waha | ingest
  name             text not null,
  campaign_id      int references campaigns(id) on delete set null,
  external_url     text,
  config           jsonb not null default '{}',
  enabled          boolean not null default true,
  last_sync_at     timestamptz,
  last_success_at  timestamptz,
  last_status      text,
  last_error       text,
  row_count        int,
  columns          text[],
  created_at       timestamptz not null default now()
);

create table sync_runs (
  id             bigserial primary key,
  job            text not null,
  source_key     text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running',   -- running | success | partial | error | skipped
  items_seen     int not null default 0,
  items_written  int not null default 0,
  error          text,
  detail         jsonb
);
create index sync_runs_job_started on sync_runs (job, started_at desc);
create index sync_runs_source_started on sync_runs (source_key, started_at desc);

create table integration_errors (
  id            bigserial primary key,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  source_key    text not null,
  severity      text not null default 'error',      -- warning | error
  message       text not null,
  context       jsonb,
  fingerprint   text not null,
  occurrences   int not null default 1,
  resolved_at   timestamptz
);
create unique index integration_errors_open_fp on integration_errors (fingerprint) where resolved_at is null;

create table app_state (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- --------------------------------------------------------------- leads ----
create table leads (
  id                     bigserial primary key,
  campaign_id            int not null references campaigns(id) on delete cascade,
  source_id              int references sources(id) on delete set null,
  source_row_key         text not null,
  source_row_number      int,
  row_key_stable         boolean not null default true,  -- false when keyed by row number
  name                   text,
  email                  text,
  email_norm             text,
  email_valid            boolean,
  phone                  text,
  phone_norm             text,
  wa_chat_id             text,
  website                text,
  city                   text,
  country                text,
  category               text,
  sheet_status           text,                 -- raw status text, exactly as in the source
  sheet_state            text,                 -- normalized: new | ready | queued | sent | failed | replied | completed | bounced | excluded | unknown
  scheduled_send_at      timestamptz,
  scheduled_date         date,
  planned_sender         text,
  touch_number           int,
  max_touches            int,
  source_next_touch_at   timestamptz,
  raw                    jsonb not null default '{}',
  present_in_source      boolean not null default true,
  -- derived (recomputed by the derive job; never hand-edited)
  status                 text not null default 'ready',
  is_duplicate           boolean not null default false,
  duplicate_of           bigint references leads(id) on delete set null,
  suppressed             boolean not null default false,
  suppression_reason     text,
  first_contacted_at     timestamptz,
  last_contacted_at      timestamptz,
  sends_accepted         int not null default 0,
  followups_accepted     int not null default 0,
  last_step              int,
  send_failures          int not null default 0,
  bounced_at             timestamptz,
  last_reply_at          timestamptz,
  reply_sentiment        text,
  next_followup_at       timestamptz,
  -- manual
  manual_followup_at     timestamptz,
  notes                  text,
  first_seen_at          timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (source_id, source_row_key)
);
create index leads_campaign_status on leads (campaign_id, status);
create index leads_email_norm on leads (email_norm);
create index leads_phone_norm on leads (phone_norm);
create index leads_wa_chat on leads (wa_chat_id);
create index leads_next_followup on leads (next_followup_at);

create table suppressions (
  id          bigserial primary key,
  channel     text not null default 'email',     -- email | whatsapp
  value_norm  text not null,                     -- normalized email or phone digits
  reason      text not null,                     -- unsubscribed | do_not_contact | hard_bounce | complaint
  source      text not null default 'manual',    -- manual | inbox | bounce | sheet
  note        text,
  created_by  text,
  created_at  timestamptz not null default now(),
  unique (channel, value_norm)
);

-- --------------------------------------------------------- send events ----
-- One row per send attempt. idempotency_key makes every writer (n8n sync, push
-- ingest, sheet import, Sent-folder reconciliation) safe to retry.
create table send_attempts (
  id                bigserial primary key,
  idempotency_key   text not null unique,
  channel           text not null,               -- email | whatsapp
  campaign_id       int references campaigns(id) on delete set null,
  lead_id           bigint references leads(id) on delete set null,
  mailbox_id        int references mailboxes(id) on delete set null,
  sender            text,
  recipient         text not null,
  recipient_norm    text not null,
  step              int not null default 0,      -- 0 = original email, n = follow-up n
  result            text not null,               -- accepted | failed | unknown
  provider          text,                        -- hostinger_api | smtp | waha | unknown
  provider_status   text,                        -- e.g. "250 2.0.0 Ok: queued as X" / "HTTP 204"
  error_message     text,
  message_id        text,
  subject           text,
  source            text not null,               -- n8n_execution | n8n_push | sheet_status | mailbox_sent | manual
  n8n_workflow_id   text,
  n8n_execution_id  text,
  n8n_node          text,
  n8n_run_index     int,
  n8n_item_index    int,
  occurred_at       timestamptz,
  time_quality      text not null default 'exact',  -- exact | date_only | unknown
  wa_ack            int,                         -- WhatsApp ack: 1 server, 2 device (delivered), 3 read, 4 played
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index send_attempts_campaign_time on send_attempts (campaign_id, occurred_at);
create index send_attempts_recipient on send_attempts (recipient_norm);
create index send_attempts_lead on send_attempts (lead_id);
create index send_attempts_message_id on send_attempts (message_id);
create index send_attempts_execution on send_attempts (n8n_execution_id);

-- ---------------------------------------------------------------- mail ----
create table mail_messages (
  id                  bigserial primary key,
  mailbox_id          int not null references mailboxes(id) on delete cascade,
  folder              text not null,
  uid                 bigint not null,
  message_id          text,
  in_reply_to         text,
  references_ids      text[] not null default '{}',
  thread_key          text,
  direction           text not null,             -- inbound | outbound
  from_addr           text,
  from_name           text,
  to_addrs            text[] not null default '{}',
  cc_addrs            text[] not null default '{}',
  counterpart         text,
  subject             text,
  sent_at             timestamptz,
  flags               text[] not null default '{}',
  unseen              boolean not null default false,
  size                int,
  has_attachments     boolean not null default false,
  kind                text not null default 'message',  -- message | bounce | auto_reply | system
  body_text           text,
  body_html           text,
  body_fetched_at     timestamptz,
  lead_id             bigint references leads(id) on delete set null,
  campaign_id         int references campaigns(id) on delete set null,
  send_attempt_id     bigint references send_attempts(id) on delete set null,
  match_method        text,                      -- in_reply_to | references | sender_email | manual | sent_reconcile
  match_confidence    text,                      -- high | medium | low
  suggested_lead_id   bigint references leads(id) on delete set null,  -- weak (domain-only) match, never counted
  is_outreach_reply   boolean not null default false,
  sentiment           text,                      -- positive | neutral | not_interested | unsubscribe | auto_reply
  needs_followup      boolean not null default false,
  followup_due_at     timestamptz,
  followup_note       text,
  gone_from_server    boolean not null default false,
  synced_at           timestamptz not null default now(),
  unique (mailbox_id, folder, uid)
);
create index mail_messages_message_id on mail_messages (message_id);
create index mail_messages_thread on mail_messages (thread_key);
create index mail_messages_counterpart on mail_messages (counterpart);
create index mail_messages_lead on mail_messages (lead_id);
create index mail_messages_box_folder_date on mail_messages (mailbox_id, folder, sent_at desc);

create table bounces (
  id               bigserial primary key,
  mail_message_id  bigint not null unique references mail_messages(id) on delete cascade,
  recipient_norm   text not null,
  bounce_type      text not null,                -- hard | soft | unknown
  status_code      text,
  diagnostic       text,
  send_attempt_id  bigint references send_attempts(id) on delete set null,
  lead_id          bigint references leads(id) on delete set null,
  campaign_id      int references campaigns(id) on delete set null,
  occurred_at      timestamptz not null
);
create index bounces_recipient on bounces (recipient_norm);

-- ------------------------------------------------------------ whatsapp ----
create table wa_sessions (
  name          text primary key,
  status        text,
  phone         text,
  last_sync_at  timestamptz,
  detail        jsonb
);

create table wa_messages (
  id           bigserial primary key,
  session      text not null,
  message_id   text not null,
  chat_id      text not null,
  from_me      boolean not null,
  body         text,
  has_media    boolean not null default false,
  ack          int,
  sent_at      timestamptz not null,
  lead_id      bigint references leads(id) on delete set null,
  campaign_id  int references campaigns(id) on delete set null,
  source       text not null,                    -- waha_api | n8n_webhook
  unique (session, message_id)
);
create index wa_messages_chat on wa_messages (chat_id, sent_at desc);

-- ------------------------------------------------------------ n8n meta ----
create table n8n_executions (
  execution_id        text primary key,
  workflow_id         text not null,
  status              text,
  mode                text,
  started_at          timestamptz,
  stopped_at          timestamptz,
  processed_at        timestamptz,
  attempts_extracted  int not null default 0,
  parse_error         text,
  final               boolean not null default false
);
create index n8n_executions_wf_started on n8n_executions (workflow_id, started_at desc);

create table n8n_workflows (
  id                 text primary key,
  name               text,
  active             boolean,
  tracked            boolean not null default false,
  looks_like_sender  boolean not null default false,
  sender_nodes       text[] not null default '{}',
  updated_at         timestamptz,
  last_checked_at    timestamptz
);
