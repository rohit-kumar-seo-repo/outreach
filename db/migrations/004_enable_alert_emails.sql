-- Alert emails switched on at the owner's request (29 Sep 2026), after the n8n workflow
-- "Outreach Dashboard — Alerts" was activated. Runs once; the Alerts page can switch it off again.
insert into app_state (key, value) values ('alert_settings', '{"notifyN8n": true}'::jsonb)
on conflict (key) do update set value = app_state.value || '{"notifyN8n": true}'::jsonb, updated_at = now();

insert into audit_log (actor, action, target, detail)
values ('deploy', 'alert_settings', '', '{"notifyN8n": true, "reason": "requested by the owner; migration 004"}'::jsonb);
