-- WhatsApp Outreach Control Center: campaign controls, templates, media, and manual
-- classification. Nothing here changes what n8n sends on its own; it only gives the
-- dashboard state that n8n can be asked to respect (see docs/WHATSAPP.md).

-- Dashboard-owned campaign controls. `campaigns.status` stays as the auto-derived
-- (from n8n's active flag) value it always was; these columns are the ones a person
-- controls from the dashboard, and they take priority when they disagree.
alter table campaigns add column if not exists control_paused_at timestamptz;
alter table campaigns add column if not exists control_paused_by text;
alter table campaigns add column if not exists control_pause_reason text;
-- Daily cap enforced at the n8n "final send step" gate (see /api/ingest/waha-gate). Seeded
-- below to match each workflow's current hardcoded limit, so nothing changes until edited.
alter table campaigns add column if not exists daily_cap int;
-- {"days": [1..7] (Mon=1), "startLocal": "HH:MM", "endLocal": "HH:MM"} in APP_TIMEZONE. Advisory
-- until an n8n workflow's own trigger/gate is changed to respect it (see docs/WHATSAPP.md).
alter table campaigns add column if not exists send_window jsonb not null default '{}'::jsonb;
alter table campaigns add column if not exists template_id bigint;

update campaigns set daily_cap = 10 where slug = 'wa-dental-india' and daily_cap is null;
update campaigns set daily_cap = 10 where slug = 'wa-dental-webdev' and daily_cap is null;
update campaigns set daily_cap = 5 where slug = 'wa-dubai-car-recovery' and daily_cap is null;

-- Reusable WhatsApp message templates (text + optional media), with {{field}} placeholders
-- filled in from lead data at send/preview time (see src/lib/whatsapp/templates.ts).
create table wa_templates (
  id           bigserial primary key,
  name         text not null,
  kind         text not null default 'text' check (kind in ('text', 'image', 'document', 'video')),
  body_text    text not null default '',
  media_id     text,               -- references wa_media(id); not a FK so a template survives a deleted upload
  media_url    text,               -- alternative to an uploaded file: a link you host yourself
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   text,
  updated_by   text
);

alter table campaigns add constraint campaigns_template_id_fkey foreign key (template_id) references wa_templates(id) on delete set null;

-- Uploaded media (images/documents/video) for templates. Stored in Postgres, not on the
-- app container's disk, because the production release volume is read-only (see Dockerfile /
-- deploy/hostinger/docker-compose.yml) and this way a restore of the database restores the
-- media too. Served back at a public, unguessable URL (/api/whatsapp/media/{id}) so WAHA
-- (running outside this app's network) can fetch it, the same way the current n8n workflows
-- already point WAHA at a public image URL.
create table wa_media (
  id          text primary key,
  filename    text not null,
  mime_type   text not null,
  kind        text not null check (kind in ('image', 'document', 'video')),
  byte_size   int not null,
  data        bytea not null,
  created_at  timestamptz not null default now(),
  created_by  text
);

-- Manual classification of a WhatsApp conversation. `sentiment` feeds the same lead-status
-- logic email replies already use (see src/lib/sync/derive.ts and v_replies below); `is_auto`
-- is the same automatic-reply flag reconcileWhatsApp() sets, now correctable by hand.
-- `auto_override` remembers that a human decided this message's is_auto value, so the
-- automatic heuristic in reconcileWhatsApp() never overwrites a manual correction.
alter table wa_messages add column if not exists sentiment text check (sentiment in ('positive', 'not_interested', 'unsubscribe'));
alter table wa_messages add column if not exists auto_override boolean not null default false;
alter table wa_messages add column if not exists classified_at timestamptz;
alter table wa_messages add column if not exists classified_by text;

-- Manual replies sent from the WhatsApp inbox, mirroring mail_replies: one row per attempt,
-- keyed by an idempotency key so a double click or a resubmitted form never sends twice.
create table wa_replies (
  id                bigserial primary key,
  idempotency_key   text not null unique,
  session           text not null,
  chat_id           text not null,
  body_text         text not null,
  body_hash         text not null,
  lead_id           bigint references leads(id) on delete set null,
  campaign_id       int references campaigns(id) on delete set null,
  status            text not null default 'sending' check (status in ('sending', 'sent', 'failed', 'unknown')),
  provider_status   text,
  error_message     text,
  wa_message_id     text,
  created_by        text,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz
);
create index wa_replies_chat on wa_replies (session, chat_id, created_at desc);

-- Per-conversation dashboard state (handled / needs-follow-up marker), mirroring inbox_threads
-- for email. Keyed by (session, chat_id) since the same phone number could in principle be
-- reached from more than one of your WhatsApp accounts.
create table wa_threads (
  session           text not null,
  chat_id           text not null,
  handled_at        timestamptz,
  needs_followup_at timestamptz,
  last_read_at      timestamptz,
  updated_at        timestamptz not null default now(),
  updated_by        text,
  primary key (session, chat_id)
);

-- WhatsApp replies now carry a real sentiment when classified, so campaignStats()'s existing
-- positive/not_interested counts (driven off v_replies) start covering WhatsApp too.
create or replace view v_replies as
(select distinct on (coalesce(m.message_id, 'row:' || m.id))
        'email'::text as channel, m.lead_id, m.campaign_id, m.mailbox_id, m.sent_at as at, m.sentiment, m.id as ref_id
   from mail_messages m
  where m.is_outreach_reply
  order by coalesce(m.message_id, 'row:' || m.id), m.sent_at)
union all
(select 'whatsapp'::text, w.lead_id, w.campaign_id, null::int, w.sent_at, w.sentiment, w.id
   from wa_messages w
  where not w.from_me and not w.is_auto and w.lead_id is not null
    and exists (select 1 from send_attempts sa where sa.lead_id = w.lead_id and sa.result = 'accepted'
                 and (sa.occurred_at is null or sa.occurred_at <= w.sent_at)));

-- New-campaign requests from the setup wizard. Campaigns and their spreadsheet column mapping are
-- defined in config/registry.json (checked into git, validated at startup) so every existing
-- campaign's lead rules are known and safe; the wizard cannot create a live, sending campaign by
-- itself. It saves the request here instead, for a person (or Claude, asked) to turn into a
-- registry entry and an n8n workflow — see docs/WHATSAPP.md.
create table wa_campaign_drafts (
  id             bigserial primary key,
  name           text not null,
  sheet_url      text,
  sheet_tab      text,
  session        text,
  template_id    bigint references wa_templates(id) on delete set null,
  daily_cap      int,
  send_window    jsonb not null default '{}'::jsonb,
  notes          text,
  status         text not null default 'draft' check (status in ('draft', 'requested', 'built', 'discarded')),
  created_at     timestamptz not null default now(),
  created_by     text
);

insert into audit_log (actor, action, target, detail)
values ('deploy', 'migration', '007_whatsapp_control_center', '{"reason": "WhatsApp Outreach Control Center: campaign pause/cap, templates, media, manual classification"}'::jsonb);
