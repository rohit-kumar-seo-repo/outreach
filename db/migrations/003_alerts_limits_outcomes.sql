-- Alerts, daily sending limits, business outcomes and n8n failure details.

-- Alerts raised by the worker's "alerts" job. One open alert per fingerprint: it is updated while
-- the condition holds and resolves itself when the condition clears. Acknowledging only hides it
-- from the sidebar badge; it still resolves on its own.
create table alerts (
  id               bigserial primary key,
  kind             text not null,          -- n8n_failed_run | sync_failed | followups_overdue | bounce_spike | volume_limit
  severity         text not null,          -- warning | critical
  fingerprint      text not null,
  title            text not null,
  detail           text,
  context          jsonb not null default '{}',
  link             text,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  checks           int not null default 1,
  acknowledged_at  timestamptz,
  acknowledged_by  text,
  resolved_at      timestamptz,
  notified_at      timestamptz
);
create unique index alerts_open_fp on alerts (fingerprint) where resolved_at is null;
create index alerts_recent on alerts (first_seen_at desc);

-- Daily volume limits for one sending mailbox, or for a whole domain (all its mailboxes together).
create table send_limits (
  id           serial primary key,
  scope        text not null check (scope in ('mailbox', 'domain')),
  key          text not null,              -- mailbox address or domain, lowercase
  daily_limit  int not null check (daily_limit > 0),
  warn_pct     int not null default 80 check (warn_pct between 1 and 100),
  updated_at   timestamptz not null default now(),
  updated_by   text,
  unique (scope, key)
);

-- Business results recorded by hand. A lead can move through several stages over time
-- (qualified → meeting booked → won / lost); every step is kept.
create table lead_outcomes (
  id           bigserial primary key,
  lead_id      bigint not null references leads(id) on delete cascade,
  campaign_id  int references campaigns(id) on delete set null,
  outcome      text not null check (outcome in ('qualified', 'meeting_booked', 'won', 'lost')),
  occurred_on  date not null,
  value        numeric(14, 2) check (value is null or value >= 0),
  currency     text,
  note         text,
  recorded_at  timestamptz not null default now(),
  recorded_by  text
);
create index lead_outcomes_lead on lead_outcomes (lead_id, occurred_on desc, recorded_at desc);
create index lead_outcomes_campaign on lead_outcomes (campaign_id, outcome);

-- Latest recorded outcome, maintained by deriveLeads().
alter table leads add column outcome text;
alter table leads add column outcome_on date;

-- Why an n8n run failed (the first error n8n reports), for alerts.
alter table n8n_executions add column error_message text;
