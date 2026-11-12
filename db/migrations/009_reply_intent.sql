-- What each reply means (see src/lib/crm/intent.ts): interested, question, callback, later, other
-- (these need you) or not_interested, unsubscribe, greeting, ack, auto (screened out). Filled in
-- automatically by the sync; a person's classification (`sentiment`) always overrides it.
alter table mail_messages add column intent text;
alter table mail_messages add column intent_v int;
-- Classified from the full body (false: only the subject was synced yet, so it is redone once the body arrives).
alter table mail_messages add column intent_had_body boolean;
alter table wa_messages add column intent text;
alter table wa_messages add column intent_v int;

-- The lead's reply intent: its latest substantive reply (a greeting or "thanks" after a real answer
-- does not hide that answer). Drives the pipeline: screened-out replies never land in "New".
alter table leads add column reply_intent text;
