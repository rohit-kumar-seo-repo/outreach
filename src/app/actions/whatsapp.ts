'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { assertSameOrigin, requireSession } from '@/lib/auth/session';
import { one, q } from '@/lib/db';
import { deriveLeads } from '@/lib/sync/derive';
import { reconcileWhatsApp } from '@/lib/sync/wa-store';
import { controlSession, createSession, deleteSession, type SessionAction } from '@/lib/whatsapp/accounts';
import { sendWaReply, type ReplyResult } from '@/lib/whatsapp/reply';
import { MEDIA_LIMITS, deleteMedia, renderTemplate, saveMedia } from '@/lib/whatsapp/templates';
import { env } from '@/lib/env';

async function guard(): Promise<string> {
  await assertSameOrigin();
  return (await requireSession()).email;
}

async function audit(actor: string, action: string, target: string, detail: Record<string, unknown> = {}) {
  await q('insert into audit_log (actor, action, target, detail) values ($1,$2,$3,$4)', [actor, action, target, JSON.stringify(detail)]);
}

const WA_PATH = '/whatsapp';

// ---------------------------------------------------------------------------------------------
// Campaign controls

export async function pauseCampaign(form: FormData): Promise<void> {
  const actor = await guard();
  const slug = String(form.get('slug') ?? '');
  const reason = String(form.get('reason') ?? '').slice(0, 500) || null;
  const row = await one<{ id: number }>(
    `update campaigns set control_paused_at = now(), control_paused_by = $2, control_pause_reason = $3 where slug = $1 and control_paused_at is null returning id`,
    [slug, actor, reason],
  );
  if (row) await audit(actor, 'pause_wa_campaign', slug, { reason });
  revalidatePath(WA_PATH);
  revalidatePath(`${WA_PATH}/campaigns`);
  revalidatePath(`${WA_PATH}/campaigns/${slug}`);
}

export async function resumeCampaign(form: FormData): Promise<void> {
  const actor = await guard();
  const slug = String(form.get('slug') ?? '');
  const row = await one<{ id: number }>(`update campaigns set control_paused_at = null, control_paused_by = null, control_pause_reason = null where slug = $1 and control_paused_at is not null returning id`, [slug]);
  if (row) await audit(actor, 'resume_wa_campaign', slug);
  revalidatePath(WA_PATH);
  revalidatePath(`${WA_PATH}/campaigns`);
  revalidatePath(`${WA_PATH}/campaigns/${slug}`);
}

export async function saveCampaignSettings(form: FormData): Promise<void> {
  const actor = await guard();
  const slug = String(form.get('slug') ?? '');
  const capRaw = String(form.get('dailyCap') ?? '').trim();
  const dailyCap = capRaw === '' ? null : Math.min(1000, Math.max(1, Math.round(Number(capRaw))));
  if (capRaw !== '' && !Number.isFinite(Number(capRaw))) return;
  const templateIdRaw = String(form.get('templateId') ?? '');
  const templateId = templateIdRaw === '' ? null : Number(templateIdRaw);
  const days = form.getAll('sendDay').map(String).map(Number).filter((d) => d >= 1 && d <= 7);
  const startLocal = String(form.get('startLocal') ?? '').trim();
  const endLocal = String(form.get('endLocal') ?? '').trim();
  const window = days.length || startLocal || endLocal ? { days, startLocal: startLocal || '09:00', endLocal: endLocal || '18:00' } : {};
  await q(`update campaigns set daily_cap = $2, template_id = $3, send_window = $4 where slug = $1`, [slug, dailyCap, templateId, JSON.stringify(window)]);
  await audit(actor, 'save_wa_campaign_settings', slug, { dailyCap, templateId, window });
  revalidatePath(`${WA_PATH}/campaigns/${slug}`);
  revalidatePath(`${WA_PATH}/campaigns`);
}

// ---------------------------------------------------------------------------------------------
// Templates & media

export async function saveTemplate(form: FormData): Promise<{ error?: string; id?: number }> {
  const actor = await guard();
  const idRaw = String(form.get('id') ?? '');
  const name = String(form.get('name') ?? '').trim().slice(0, 200);
  const kind = ['text', 'image', 'document', 'video'].includes(String(form.get('kind'))) ? String(form.get('kind')) : 'text';
  const bodyText = String(form.get('bodyText') ?? '').slice(0, 4096);
  const mediaUrl = String(form.get('mediaUrl') ?? '').trim().slice(0, 1000) || null;
  if (!name) return { error: 'Give the template a name.' };
  if (kind !== 'text' && !mediaUrl) {
    // A media kind needs either an uploaded file (handled below, before this is called) or a URL.
    const hasMediaId = String(form.get('mediaId') ?? '') !== '';
    if (!hasMediaId) return { error: `A ${kind} template needs a file or a URL.` };
  }
  const mediaId = String(form.get('mediaId') ?? '') || null;
  if (idRaw) {
    const id = Number(idRaw);
    const row = await one<{ media_id: string | null }>('select media_id from wa_templates where id = $1', [id]);
    await q(`update wa_templates set name = $2, kind = $3, body_text = $4, media_id = $5, media_url = $6, updated_at = now(), updated_by = $7 where id = $1`, [
      id,
      name,
      kind,
      bodyText,
      mediaId,
      mediaUrl,
      actor,
    ]);
    if (row?.media_id && row.media_id !== mediaId) await deleteMedia(row.media_id).catch(() => undefined);
    await audit(actor, 'update_wa_template', String(id));
    revalidatePath(`${WA_PATH}/templates`);
    return { id };
  }
  const created = await one<{ id: number }>(
    `insert into wa_templates (name, kind, body_text, media_id, media_url, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$6) returning id`,
    [name, kind, bodyText, mediaId, mediaUrl, actor],
  );
  await audit(actor, 'create_wa_template', String(created!.id));
  revalidatePath(`${WA_PATH}/templates`);
  return { id: created!.id };
}

export async function deleteTemplate(form: FormData): Promise<void> {
  const actor = await guard();
  const id = Number(form.get('id'));
  if (!Number.isInteger(id)) return;
  const used = await one<{ n: number }>('select count(*)::int as n from campaigns where template_id = $1', [id]);
  if (used?.n) return; // still used by a campaign; the page shows this and refuses the delete client-side too
  const row = await one<{ media_id: string | null }>('delete from wa_templates where id = $1 returning media_id', [id]);
  if (row?.media_id) await deleteMedia(row.media_id).catch(() => undefined);
  await audit(actor, 'delete_wa_template', String(id));
  revalidatePath(`${WA_PATH}/templates`);
}

export async function uploadWaMedia(form: FormData): Promise<{ error?: string; mediaId?: string; url?: string }> {
  const actor = await guard();
  const kind = String(form.get('kind') ?? '');
  if (!['image', 'document', 'video'].includes(kind)) return { error: 'Unknown media kind.' };
  const file = form.get('file');
  if (!(file instanceof File)) return { error: 'No file received.' };
  if (file.size > MEDIA_LIMITS[kind as 'image' | 'document' | 'video'].maxBytes + 1024) return { error: 'File is too large.' };
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const id = await saveMedia(kind as 'image' | 'document' | 'video', file.name, file.type || 'application/octet-stream', bytes, actor);
    await audit(actor, 'upload_wa_media', id, { filename: file.name, kind, bytes: bytes.length });
    return { mediaId: id, url: `${env.publicUrl}/api/whatsapp/media/${id}` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function previewTemplateAction(form: FormData): Promise<{ text: string; missing: string[]; unknown: string[] }> {
  await guard();
  const bodyText = String(form.get('bodyText') ?? '');
  const fields: Record<string, string | null> = {
    firstName: String(form.get('firstName') ?? '') || null,
    name: String(form.get('name') ?? '') || null,
    business: String(form.get('business') ?? '') || null,
    city: String(form.get('city') ?? '') || null,
    category: String(form.get('category') ?? '') || null,
    phone: String(form.get('phone') ?? '') || null,
  };
  return renderTemplate(bodyText, fields);
}

// ---------------------------------------------------------------------------------------------
// Inbox: replies & classification

export interface WaReplyState extends Partial<ReplyResult> {
  nextKey: string;
}

export async function sendWaReplyAction(_prev: WaReplyState, form: FormData): Promise<WaReplyState> {
  const actor = await guard();
  const res = await sendWaReply({ idempotencyKey: String(form.get('key') ?? ''), chatId: String(form.get('chatId') ?? ''), body: String(form.get('body') ?? '') }, actor);
  if (res.status === 'sent' || res.status === 'unknown') {
    await q(`update wa_threads set handled_at = null, last_read_at = now(), updated_at = now(), updated_by = $3 where session = $1 and chat_id = $2`, [
      String(form.get('session') ?? ''),
      String(form.get('chatId') ?? ''),
      actor,
    ]);
  }
  revalidatePath(`${WA_PATH}/inbox`);
  return { ...res, nextKey: res.replyId ? randomUUID() : String(form.get('key') ?? randomUUID()) };
}

function threadOf(form: FormData): { session: string; chatId: string } {
  const session = String(form.get('session') ?? '');
  const chatId = String(form.get('chatId') ?? '');
  if (!session || !chatId) throw new Error('Missing conversation.');
  return { session, chatId };
}

export async function markWaHandled(form: FormData): Promise<void> {
  const actor = await guard();
  const { session, chatId } = threadOf(form);
  const undo = form.get('undo') === '1';
  await q(
    `insert into wa_threads (session, chat_id, handled_at, updated_by) values ($1,$2, case when $3 then null else now() end, $4)
     on conflict (session, chat_id) do update set handled_at = excluded.handled_at, updated_at = now(), updated_by = excluded.updated_by`,
    [session, chatId, undo, actor],
  );
  await audit(actor, undo ? 'reopen_wa_thread' : 'mark_wa_handled', `${session}:${chatId}`);
  revalidatePath(`${WA_PATH}/inbox`);
}

export async function markWaRead(session: string, chatId: string): Promise<void> {
  await guard();
  if (!session || !chatId) return;
  await q(
    `insert into wa_threads (session, chat_id, last_read_at) values ($1,$2,now())
     on conflict (session, chat_id) do update set last_read_at = now()`,
    [session, chatId],
  );
}

const SENTIMENTS = new Set(['positive', 'not_interested', 'unsubscribe', 'auto_reply', 'not_auto', 'needs_followup', '']);

/** One classification action for a conversation: sets the latest inbound message's sentiment
 *  (feeding the same lead-status logic email replies use), corrects the auto-reply flag, marks
 *  a follow-up due, or records an opt-out — whichever the picked value means. */
export async function classifyWaThread(form: FormData): Promise<void> {
  const actor = await guard();
  const { session, chatId } = threadOf(form);
  const value = String(form.get('classification') ?? '');
  if (!SENTIMENTS.has(value)) return;
  const latestInbound = await one<{ id: number; lead_id: number | null }>(
    `select id, lead_id from wa_messages where session = $1 and chat_id = $2 and not from_me order by sent_at desc limit 1`,
    [session, chatId],
  );
  if (value === 'auto_reply' || value === 'not_auto') {
    await q(`update wa_messages set is_auto = $3, auto_override = true, classified_at = now(), classified_by = $4 where session = $1 and chat_id = $2 and not from_me and sent_at = (select max(sent_at) from wa_messages where session = $1 and chat_id = $2 and not from_me)`, [
      session,
      chatId,
      value === 'auto_reply',
      actor,
    ]);
  } else if (value === 'needs_followup') {
    if (latestInbound?.lead_id) await q(`update leads set manual_followup_at = now() + interval '1 day' where id = $1`, [latestInbound.lead_id]);
  } else if (value === 'unsubscribe') {
    const digits = chatId.replace(/@.*$/, '');
    await q(
      `insert into suppressions (channel, value_norm, reason, source, note, created_by) values ('whatsapp', $1, 'unsubscribed', 'wa_inbox', 'Marked from the WhatsApp inbox', $2)
       on conflict (channel, value_norm) do update set reason = 'unsubscribed'`,
      [digits, actor],
    );
    if (latestInbound) await q(`update wa_messages set sentiment = 'unsubscribe', classified_at = now(), classified_by = $2 where id = $1`, [latestInbound.id, actor]);
  } else if (latestInbound) {
    await q(`update wa_messages set sentiment = $2, classified_at = now(), classified_by = $3 where id = $1`, [latestInbound.id, value || null, actor]);
  }
  await audit(actor, 'classify_wa_thread', `${session}:${chatId}`, { value });
  await deriveLeads();
  revalidatePath(`${WA_PATH}/inbox`);
}

// ---------------------------------------------------------------------------------------------
// Accounts (WAHA sessions)

export async function sessionControlAction(form: FormData): Promise<{ error?: string }> {
  const actor = await guard();
  const name = String(form.get('name') ?? '');
  const action = String(form.get('action') ?? '') as SessionAction;
  if (!name || !['start', 'stop', 'restart', 'logout'].includes(action)) return { error: 'Invalid request.' };
  const res = await controlSession(name, action);
  await audit(actor, `wa_session_${action}`, name, res.ok ? {} : { error: res.error });
  revalidatePath(`${WA_PATH}/accounts`);
  return res.ok ? {} : { error: res.error };
}

export async function addSessionAction(form: FormData): Promise<{ error?: string }> {
  const actor = await guard();
  const name = String(form.get('name') ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!name || name.length > 60) return { error: 'Give the account a short name (letters, numbers, - or _ only).' };
  const webhookUrl = `${env.n8nBaseUrl}/webhook/waha-incoming`;
  const res = await createSession(name, env.n8nBaseUrl ? webhookUrl : null);
  await audit(actor, 'wa_session_create', name, res.ok ? {} : { error: res.error });
  revalidatePath(`${WA_PATH}/accounts`);
  return res.ok ? {} : { error: res.error };
}

export async function removeSessionAction(form: FormData): Promise<{ error?: string }> {
  const actor = await guard();
  const name = String(form.get('name') ?? '');
  if (!name) return { error: 'Missing account.' };
  const used = await one<{ n: number }>(`select count(*)::int as n from campaigns where channel = 'whatsapp' and config->>'waSession' = $1`, [name]);
  if (used?.n) return { error: `${name} is still used by ${used.n} campaign(s). Move them to another account first.` };
  const res = await deleteSession(name);
  if (res.ok) await q('delete from wa_sessions where name = $1', [name]);
  await audit(actor, 'wa_session_delete', name, res.ok ? {} : { error: res.error });
  revalidatePath(`${WA_PATH}/accounts`);
  return res.ok ? {} : { error: res.error };
}

export async function saveCampaignDraft(form: FormData): Promise<{ error?: string; id?: number }> {
  const actor = await guard();
  const name = String(form.get('name') ?? '').trim().slice(0, 200);
  if (!name) return { error: 'Give the campaign a name.' };
  const sheetUrl = String(form.get('sheetUrl') ?? '').trim().slice(0, 500) || null;
  const sheetTab = String(form.get('sheetTab') ?? '').trim().slice(0, 200) || null;
  const session = String(form.get('session') ?? '').trim().slice(0, 100) || null;
  const templateIdRaw = String(form.get('templateId') ?? '');
  const templateId = templateIdRaw ? Number(templateIdRaw) : null;
  const capRaw = String(form.get('dailyCap') ?? '').trim();
  const dailyCap = capRaw === '' ? null : Math.max(1, Math.round(Number(capRaw)));
  const days = form.getAll('sendDay').map(String).map(Number).filter((d) => d >= 1 && d <= 7);
  const startLocal = String(form.get('startLocal') ?? '').trim();
  const endLocal = String(form.get('endLocal') ?? '').trim();
  const window = days.length || startLocal || endLocal ? { days, startLocal: startLocal || '09:00', endLocal: endLocal || '18:00' } : {};
  const notes = String(form.get('notes') ?? '').trim().slice(0, 2000) || null;
  const row = await one<{ id: number }>(
    `insert into wa_campaign_drafts (name, sheet_url, sheet_tab, session, template_id, daily_cap, send_window, notes, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [name, sheetUrl, sheetTab, session, templateId, dailyCap, JSON.stringify(window), notes, actor],
  );
  await audit(actor, 'save_wa_campaign_draft', String(row!.id), { name });
  revalidatePath(`${WA_PATH}/campaigns`);
  return { id: row!.id };
}

export async function discardCampaignDraft(form: FormData): Promise<void> {
  const actor = await guard();
  const id = Number(form.get('id'));
  if (!Number.isInteger(id)) return;
  await q(`update wa_campaign_drafts set status = 'discarded' where id = $1`, [id]);
  await audit(actor, 'discard_wa_campaign_draft', String(id));
  revalidatePath(`${WA_PATH}/campaigns`);
}

export async function requestWaSync(): Promise<void> {
  const actor = await guard();
  await reconcileWhatsApp();
  await deriveLeads();
  await q(
    `insert into app_state (key, value) values ('sync_request', '{"jobs":["waha"]}')
     on conflict (key) do update set value = jsonb_build_object('jobs', (select jsonb_agg(distinct j) from jsonb_array_elements_text(coalesce(app_state.value->'jobs', '[]'::jsonb) || '["waha"]'::jsonb) j)), updated_at = now()`,
  );
  await audit(actor, 'request_wa_sync', '');
  revalidatePath(WA_PATH);
}
