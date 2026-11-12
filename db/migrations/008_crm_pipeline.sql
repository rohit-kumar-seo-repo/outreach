-- Sales pipeline worked from the dashboard. The sheets and n8n keep driving outreach; this is the
-- layer for the leads that respond: the stage a person puts them in, reminders, and a timeline of
-- calls and notes.

-- `stage` is what a person (or the sheet's own "Lead Stage" column, until a person changes it)
-- says about the deal. Leads that replied but have no stage yet show as "new" in the pipeline;
-- that is computed in queries (see src/lib/crm/stages.ts), never stored.
alter table leads add column stage text
  check (stage in ('new', 'contacted', 'interested', 'meeting', 'proposal', 'won', 'lost'));
alter table leads add column stage_changed_at timestamptz;
-- manual | sheet | outcome. Only 'sheet' stages are kept in step with the sheet; anything a
-- person set is never overwritten by a sync.
alter table leads add column stage_source text;
alter table leads add column starred boolean not null default false;
alter table leads add column deal_value numeric(14, 2) check (deal_value is null or deal_value >= 0);
alter table leads add column deal_currency text;
alter table leads add column last_activity_at timestamptz;
alter table leads add column last_call_at timestamptz;
alter table leads add column last_call_outcome text;
alter table leads add column call_count int not null default 0;

create table lead_activities (
  id           bigserial primary key,
  lead_id      bigint not null references leads(id) on delete cascade,
  kind         text not null check (kind in ('call', 'note', 'stage', 'reminder')),
  -- call: connected | no_answer | busy | wrong_number; stage: the new stage; reminder: 'set' | 'cleared'
  outcome      text,
  body         text,
  occurred_at  timestamptz not null default now(),
  created_by   text
);
create index lead_activities_lead on lead_activities (lead_id, occurred_at desc);
create index leads_stage on leads (stage) where stage is not null;
create index leads_last_reply on leads (last_reply_at desc) where last_reply_at is not null;
create index leads_manual_followup on leads (manual_followup_at) where manual_followup_at is not null;
-- Lead cards show each lead's latest reply on either channel.
create index wa_messages_lead_time on wa_messages (lead_id, sent_at desc) where lead_id is not null;
create index lead_activities_kind_time on lead_activities (kind, occurred_at desc);

-- Outcomes recorded before the pipeline existed become the starting stage.
update leads
   set stage = case outcome when 'qualified' then 'interested' when 'meeting_booked' then 'meeting' when 'won' then 'won' when 'lost' then 'lost' end,
       stage_changed_at = outcome_on::timestamptz,
       stage_source = 'outcome'
 where outcome is not null and stage is null;

-- The single free-text note per lead becomes the first note on its timeline.
insert into lead_activities (lead_id, kind, body, occurred_at, created_by)
select id, 'note', notes, updated_at, 'migrated'
  from leads where coalesce(btrim(notes), '') <> '';
