'use server';

import { revalidatePath } from 'next/cache';
import { assertSameOrigin, requireSession, revokeAllSessions } from '@/lib/auth/session';
import { one, q, tx } from '@/lib/db';
import { digitsOnly, normalizeEmail } from '@/lib/normalize';
import { providerFor } from '@/lib/sync/mail-sync';
import { deriveLeads } from '@/lib/sync/derive';
import { DEFAULT_ALERT_SETTINGS, evaluateAlerts, type AlertSettings } from '@/lib/alerts';
import { localDate } from '@/lib/time';

async function guard(): Promise<string> {
  await assertSameOrigin();
  return (await requireSession()).email;
}

async function audit(actor: string, action: string, target: string, detail: Record<string, unknown> = {}) {
  await q('insert into audit_log (actor, action, target, detail) values ($1,$2,$3,$4)', [actor, action, target, JSON.stringify(detail)]);
}

const SENTIMENTS = new Set(['positive', 'neutral', 'not_interested', 'unsubscribe', 'auto_reply', '']);

/** Manually attach an inbox thread to a lead (and its campaign). */
export async function assignThread(form: FormData): Promise<void> {
  const actor = await guard();
  const thread = String(form.get('thread') ?? '');
  const leadId = Number(form.get('leadId'));
  if (!thread || !Number.isInteger(leadId)) return;
  const lead = await one<{ id: number; campaign_id: number }>('select id, campaign_id from leads where id = $1', [leadId]);
  if (!lead) return;
  await q(
    `update mail_messages set lead_id = $2, campaign_id = $3, match_method = 'manual', match_confidence = 'high',
        is_outreach_reply = (direction = 'inbound' and kind = 'message')
      where thread_key = $1`,
    [thread, lead.id, lead.campaign_id],
  );
  await audit(actor, 'assign_thread', thread, { leadId });
  await deriveLeads();
  revalidatePath('/inbox');
}

/** Mark a thread as not related to outreach (it stays Unmatched and is never auto-matched again). */
export async function unassignThread(form: FormData): Promise<void> {
  const actor = await guard();
  const thread = String(form.get('thread') ?? '');
  await q(
    `update mail_messages set lead_id = null, campaign_id = null, match_method = 'manual_none', match_confidence = null,
        is_outreach_reply = false, suggested_lead_id = null
      where thread_key = $1 and direction = 'inbound'`,
    [thread],
  );
  await audit(actor, 'unassign_thread', thread);
  await deriveLeads();
  revalidatePath('/inbox');
}

export async function setSentiment(form: FormData): Promise<void> {
  const actor = await guard();
  const messageId = Number(form.get('messageId'));
  const sentiment = String(form.get('sentiment') ?? '');
  if (!Number.isInteger(messageId) || !SENTIMENTS.has(sentiment)) return;
  const msg = await one<{ from_addr: string | null; lead_id: number | null }>(
    `update mail_messages set sentiment = nullif($2, '') where id = $1 returning from_addr, lead_id`,
    [messageId, sentiment],
  );
  if (sentiment === 'unsubscribe' && msg?.from_addr) {
    await q(
      `insert into suppressions (channel, value_norm, reason, source, note, created_by) values ('email', $1, 'unsubscribed', 'inbox', 'Marked from inbox', $2)
       on conflict (channel, value_norm) do update set reason = 'unsubscribed'`,
      [msg.from_addr, actor],
    );
  }
  await audit(actor, 'set_sentiment', String(messageId), { sentiment });
  await deriveLeads();
  revalidatePath('/inbox');
}

export async function setThreadFollowup(form: FormData): Promise<void> {
  const actor = await guard();
  const thread = String(form.get('thread') ?? '');
  const clear = form.get('clear') === '1';
  const due = String(form.get('due') ?? '');
  const note = String(form.get('note') ?? '').slice(0, 500) || null;
  const dueAt = /^\d{4}-\d{2}-\d{2}$/.test(due) ? `${due} 09:00` : null;
  await tx(async (c) => {
    await q(
      `update mail_messages set needs_followup = $2, followup_due_at = case when $2 then ($3::timestamp at time zone $5) end, followup_note = case when $2 then $4 end
        where id = (select id from mail_messages where thread_key = $1 order by sent_at desc nulls last limit 1)`,
      [thread, !clear, dueAt, note, process.env.APP_TIMEZONE ?? 'Asia/Kolkata'],
      c,
    );
    if (clear) await q('update mail_messages set needs_followup = false where thread_key = $1', [thread], c);
    await q(
      `update leads set manual_followup_at = case when $2 then ($3::timestamp at time zone $4) end
        where id in (select lead_id from mail_messages where thread_key = $1 and lead_id is not null)`,
      [thread, !clear, dueAt ?? new Date().toISOString().slice(0, 10), process.env.APP_TIMEZONE ?? 'Asia/Kolkata'],
      c,
    );
  });
  await audit(actor, clear ? 'clear_followup' : 'flag_followup', thread, { due });
  await deriveLeads();
  revalidatePath('/inbox');
}

/** Loads a message body from the mailbox. On the Hostinger Email API this marks the message as read. */
export async function loadBody(form: FormData): Promise<void> {
  await guard();
  const id = Number(form.get('messageId'));
  const row = await one<{ address: string; folder: string; uid: number }>(
    `select mb.address, m.folder, m.uid from mail_messages m join mailboxes mb on mb.id = m.mailbox_id where m.id = $1`,
    [id],
  );
  if (!row) return;
  const provider = await providerFor(row.address);
  if (!provider) throw new Error('This mailbox is not connected, so the message body cannot be loaded.');
  try {
    const body = await provider.fetchBody(row.folder, row.uid);
    await q(`update mail_messages set body_text = $2, body_html = $3, body_fetched_at = now() where id = $1`, [
      id,
      body.text.slice(0, 200_000),
      body.html.slice(0, 500_000),
    ]);
  } finally {
    await provider.close();
  }
  revalidatePath('/inbox');
}

export async function updateLeadNotes(form: FormData): Promise<void> {
  const actor = await guard();
  const id = Number(form.get('leadId'));
  const notes = String(form.get('notes') ?? '').slice(0, 5000);
  const due = String(form.get('followup') ?? '');
  await q(
    `update leads set notes = nullif($2, ''), manual_followup_at = case when $3 = '' then null else ($3::timestamp at time zone $4) end where id = $1`,
    [id, notes, /^\d{4}-\d{2}-\d{2}$/.test(due) ? `${due} 09:00` : '', process.env.APP_TIMEZONE ?? 'Asia/Kolkata'],
  );
  await audit(actor, 'update_lead', String(id));
  await deriveLeads();
  revalidatePath(`/leads/${id}`);
}

export async function addSuppression(form: FormData): Promise<void> {
  const actor = await guard();
  const channel = form.get('channel') === 'whatsapp' ? 'whatsapp' : 'email';
  const raw = String(form.get('value') ?? '');
  const value = channel === 'email' ? normalizeEmail(raw) : digitsOnly(raw);
  const reason = ['unsubscribed', 'do_not_contact', 'complaint'].includes(String(form.get('reason'))) ? String(form.get('reason')) : 'do_not_contact';
  if (!value) return;
  await q(
    `insert into suppressions (channel, value_norm, reason, source, note, created_by) values ($1,$2,$3,'manual',$4,$5)
     on conflict (channel, value_norm) do update set reason = excluded.reason, note = excluded.note`,
    [channel, value, reason, String(form.get('note') ?? '').slice(0, 300) || null, actor],
  );
  await audit(actor, 'add_suppression', `${channel}:${value}`, { reason });
  await deriveLeads();
  revalidatePath('/settings');
}

export async function removeSuppression(form: FormData): Promise<void> {
  const actor = await guard();
  const id = Number(form.get('id'));
  const row = await one<{ value_norm: string }>('delete from suppressions where id = $1 returning value_norm', [id]);
  if (row) await audit(actor, 'remove_suppression', row.value_norm);
  await deriveLeads();
  revalidatePath('/settings');
}

export async function requestSync(form: FormData): Promise<void> {
  const actor = await guard();
  const job = String(form.get('job') ?? 'all');
  const allowed = ['all', 'sheets', 'n8n-executions', 'mailboxes', 'waha', 'n8n-workflows', 'derive', 'alerts'];
  if (!allowed.includes(job)) return;
  await q(
    `insert into app_state (key, value) values ('sync_request', $1)
     on conflict (key) do update set value = jsonb_build_object('jobs', (select jsonb_agg(distinct j) from jsonb_array_elements_text(app_state.value->'jobs' || $1->'jobs') j)), updated_at = now()`,
    [JSON.stringify({ jobs: [job] })],
  );
  await audit(actor, 'request_sync', job);
  revalidatePath('/integrations');
}

export async function resolveError(form: FormData): Promise<void> {
  const actor = await guard();
  const id = Number(form.get('id'));
  await q('update integration_errors set resolved_at = now() where id = $1', [id]);
  await audit(actor, 'resolve_error', String(id));
  revalidatePath('/integrations');
}

export async function signOutEverywhere(): Promise<void> {
  const actor = await guard();
  const n = await revokeAllSessions();
  await audit(actor, 'revoke_all_sessions', '', { n });
  revalidatePath('/settings');
}

// ---------------------------------------------------------------------------------------------
// Business outcomes

const OUTCOMES = new Set(['qualified', 'meeting_booked', 'won', 'lost']);

export async function recordOutcome(form: FormData): Promise<void> {
  const actor = await guard();
  const leadId = Number(form.get('leadId'));
  const outcome = String(form.get('outcome') ?? '');
  const date = String(form.get('date') ?? '') || localDate();
  const valueRaw = String(form.get('value') ?? '').replace(/[, ]/g, '');
  const value = valueRaw === '' ? null : Number(valueRaw);
  const currency = String(form.get('currency') ?? '').toUpperCase();
  const note = String(form.get('note') ?? '').trim().slice(0, 1000) || null;
  if (!Number.isInteger(leadId) || !OUTCOMES.has(outcome) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > localDate()) return;
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1e12)) return;
  const lead = await one<{ campaign_id: number }>('select campaign_id from leads where id = $1', [leadId]);
  if (!lead) return;
  await q(
    `insert into lead_outcomes (lead_id, campaign_id, outcome, occurred_on, value, currency, note, recorded_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [leadId, lead.campaign_id, outcome, date, value, value !== null && /^[A-Z]{3}$/.test(currency) ? currency : null, note, actor],
  );
  await audit(actor, 'record_outcome', String(leadId), { outcome, date, value });
  await deriveLeads();
  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/campaigns');
}

export async function deleteOutcome(form: FormData): Promise<void> {
  const actor = await guard();
  const id = Number(form.get('id'));
  if (!Number.isInteger(id)) return;
  const row = await one<{ lead_id: number; outcome: string }>('delete from lead_outcomes where id = $1 returning lead_id, outcome', [id]);
  if (!row) return;
  await audit(actor, 'delete_outcome', String(row.lead_id), { outcome: row.outcome });
  await deriveLeads();
  revalidatePath(`/leads/${row.lead_id}`);
  revalidatePath('/campaigns');
}

// ---------------------------------------------------------------------------------------------
// Daily sending limits

export async function saveSendLimit(form: FormData): Promise<void> {
  const actor = await guard();
  const scope = form.get('scope') === 'domain' ? 'domain' : 'mailbox';
  const key = String(form.get('key') ?? '').trim().toLowerCase();
  const limitRaw = String(form.get('dailyLimit') ?? '').trim();
  const warnPct = Math.min(100, Math.max(1, Number(form.get('warnPct')) || 80));
  if (!key || key.length > 200 || (scope === 'mailbox' ? !/^[^@\s]+@[^@\s]+$/.test(key) : !/^[a-z0-9.-]+$/.test(key))) return;
  if (limitRaw === '' || limitRaw === '0') {
    await q('delete from send_limits where scope = $1 and key = $2', [scope, key]);
    await audit(actor, 'clear_send_limit', `${scope}:${key}`);
  } else {
    const limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) return;
    await q(
      `insert into send_limits (scope, key, daily_limit, warn_pct, updated_by) values ($1, $2, $3, $4, $5)
       on conflict (scope, key) do update set daily_limit = excluded.daily_limit, warn_pct = excluded.warn_pct, updated_at = now(), updated_by = excluded.updated_by`,
      [scope, key, limit, warnPct, actor],
    );
    await audit(actor, 'set_send_limit', `${scope}:${key}`, { limit, warnPct });
  }
  await evaluateAlerts().catch(() => undefined);
  revalidatePath('/sending');
  revalidatePath('/alerts');
}

// ---------------------------------------------------------------------------------------------
// Alerts

export async function acknowledgeAlert(form: FormData): Promise<void> {
  const actor = await guard();
  const id = Number(form.get('id'));
  if (!Number.isInteger(id)) return;
  await q('update alerts set acknowledged_at = now(), acknowledged_by = $2 where id = $1 and acknowledged_at is null', [id, actor]);
  await audit(actor, 'acknowledge_alert', String(id));
  revalidatePath('/alerts');
}

export async function checkAlertsNow(): Promise<void> {
  const actor = await guard();
  await evaluateAlerts();
  await audit(actor, 'check_alerts', '');
  revalidatePath('/alerts');
}

export async function saveAlertSettings(form: FormData): Promise<void> {
  const actor = await guard();
  const num = (name: string, min: number, max: number, fallback: number) => {
    const n = Number(form.get(name));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const d = DEFAULT_ALERT_SETTINGS;
  const settings: AlertSettings = {
    bounceMinCount: Math.round(num('bounceMinCount', 1, 1000, d.bounceMinCount)),
    bounceRatePct: num('bounceRatePct', 0.5, 100, d.bounceRatePct),
    bounceSpikeMultiplier: num('bounceSpikeMultiplier', 1.5, 50, d.bounceSpikeMultiplier),
    overdueGraceDays: Math.round(num('overdueGraceDays', 0, 30, d.overdueGraceDays)),
    notifyN8n: form.get('notifyN8n') === 'on',
  };
  await q(
    `insert into app_state (key, value) values ('alert_settings', $1) on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [JSON.stringify(settings)],
  );
  await audit(actor, 'alert_settings', '', settings as unknown as Record<string, unknown>);
  await evaluateAlerts().catch(() => undefined);
  revalidatePath('/alerts');
}
