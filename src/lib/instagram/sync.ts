// Instagram pull (2026-11-21): the n8n Instagram bots log every comment and every DM step in two n8n data tables.
// The Data Bridge serves them as sources ig_comment_leads and ig_dm_log; this job turns each row into ig events and
// feeds them through ingestIg (idempotent on extId, so every run can re-read the whole tables safely).
// Needs no new key: it uses the bridge's existing N8N_BRIDGE_URL / N8N_BRIDGE_KEY.
import { recordIntegrationError } from '@/lib/errors';
import { bridgeConfigured, fetchSource } from '@/lib/sync/sheets-sync';
import { markSource } from '@/lib/sync/runs';
import { igEvent, ingestIg, type IgEvent } from './ingest';

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
const iso = (v: unknown, plusMs = 0) => {
  const d = new Date(s(v));
  return Number.isNaN(d.getTime()) ? undefined : new Date(d.getTime() + plusMs).toISOString();
};

/** "Instagram Keyword Leads": one row per comment (main + AI page) or per AI-page DM ("dm:<id>"). */
export function commentRowEvents(r: Row): unknown[] {
  const id = s(r.comment_id), user = s(r.username), gate = s(r.gate);
  if (!id || !user) return [];
  const page = gate.startsWith('ai_') ? 'ai_automation_by_rohit' : 'rohit_kumar_seo';
  const base = { page, username: user, reel: { id: s(r.media_id) || undefined, keyword: s(r.keyword) || undefined } };
  const at = iso(r.commented_at) ?? iso(r.createdAt);
  const ours = iso(r.createdAt) ?? at;
  const out: unknown[] = [];
  if (id.startsWith('dm:')) {
    // AI page: they DMed AUTOMATE, the bot answered with the plan
    out.push({ ...base, extId: `in:${id}`, fromMe: false, kind: 'dm', body: s(r.comment_text), at });
    if (s(r.resource_text) && s(r.dm_status) === 'sent') out.push({ ...base, extId: `out:${id}`, fromMe: true, kind: 'dm', body: s(r.resource_text), stage: 'plan', at: iso(r.createdAt, 1000) });
    return out;
  }
  out.push({ ...base, extId: `c:${id}`, fromMe: false, kind: 'comment', body: s(r.comment_text), at });
  if (s(r.reply_text)) out.push({ ...base, extId: `cr:${id}`, fromMe: true, kind: 'comment_reply', body: s(r.reply_text), at: ours });
  if (s(r.dm_status) === 'sent' && page === 'rohit_kumar_seo') {
    const body = gate === 'waiting' ? 'DM sent: asked them to follow @rohit_kumar_seo and reply DONE' : s(r.resource_text);
    out.push({ ...base, extId: `cd:${id}`, fromMe: true, kind: 'dm', body, stage: gate === 'waiting' ? 'gate' : gate || 'q1', at: iso(r.createdAt, 1000) });
  }
  return out;
}

// 2026-11-28 flow: comment DM = free resource + Q1 (their situation), q2 = business + city (skipped when Q1 asked it),
// close = call back / WhatsApp / cal.com. The logged stage is the step the bot moved TO after their message.
const ANSWER: Record<string, keyof NonNullable<IgEvent['answers']>> = { q2: 'problem', q3: 'problem', close: 'business' };
const pageOf = (r: Row) => (s(r.page) === 'ai' ? 'ai_automation_by_rohit' : 'rohit_kumar_seo');

/** Rohit 2026-11-28: only people who answered at least one DM question reach the CRM; likes, emojis and silent commenters stay out. */
const ANSWERED = new Set(['q2', 'q3', 'close', 'ask_number', 'qualified', 'handoff']);
export function engagedKeys(dmRows: Row[]): Set<string> {
  const out = new Set<string>();
  for (const r of dmRows) if (s(r.send_status) !== 'dry' && ANSWERED.has(s(r.stage)) && s(r.username)) out.add(`${pageOf(r)}:${s(r.username).toLowerCase()}`);
  return out;
}

/** "Instagram DM AI Log": one row per bot step; user_text is what they wrote, reply_text what the bot answered. */
export function dmRowEvents(r: Row): unknown[] {
  const mid = s(r.user_msg_id), user = s(r.username), stage = s(r.stage);
  if (!mid || !user || s(r.send_status) === 'dry') return [];
  const base = { page: pageOf(r), username: user, threadId: s(r.thread_id) || undefined };
  const at = iso(r.createdAt);
  const text = s(r.user_text);
  const answers: Record<string, string> = {};
  if (ANSWER[stage]) answers[ANSWER[stage]] = text;
  // rows from the earlier AI DM bot (Oct-Nov 2026) carry what it learned in separate fields
  const where = [s(r.business), s(r.city)].filter(Boolean).join(', ');
  if (where && !answers.business) answers.business = where;
  if (s(r.service) && s(r.service) !== 'unknown' && !answers.problem) answers.problem = `Wants: ${s(r.service)}`;
  const phone = s(r.website).replace(/^phone:\s*/i, '');
  if (stage === 'qualified' && phone) answers.phone = phone;
  const sent = s(r.send_status) === 'sent';
  const out: unknown[] = [
    { ...base, extId: `m:${mid}`, fromMe: false, kind: 'dm', body: text, stage, needsYou: sent && (stage === 'qualified' || stage === 'handoff'), at: iso(r.createdAt, -1000), answers: Object.keys(answers).length ? answers : undefined },
  ];
  if (sent && s(r.reply_text)) out.push({ ...base, extId: `r:${mid}`, fromMe: true, kind: 'dm', body: s(r.reply_text), stage, at });
  return out;
}

export async function syncInstagram(): Promise<void> {
  if (!bridgeConfigured()) return;
  let ok = true;
  let n = 0;
  let engaged: Set<string>;
  try {
    engaged = engagedKeys((await fetchSource('ig_dm_log')).rows);
  } catch (err) {
    await recordIntegrationError('ingest:instagram', `Instagram pull (ig_dm_log) failed: ${(err as Error).message}`, {}, 'warning');
    await markSource('ingest:instagram', false, 'Instagram pull failed (see alerts)', {});
    return;
  }
  for (const [key, toEvents] of [['ig_comment_leads', commentRowEvents], ['ig_dm_log', dmRowEvents]] as const) {
    try {
      const res = await fetchSource(key);
      // oldest first, so a lead's first comment is recorded before the answers
      const rows = [...res.rows].sort((a, b) => s(a.createdAt).localeCompare(s(b.createdAt)));
      for (const row of rows) {
        for (const raw of toEvents(row)) {
          const parsed = igEvent.safeParse(raw);
          if (!parsed.success) continue;
          if (!engaged.has(`${parsed.data.page}:${parsed.data.username}`)) continue;
          const r = await ingestIg(parsed.data);
          if (r.inserted) n++;
        }
      }
    } catch (err) {
      ok = false;
      await recordIntegrationError('ingest:instagram', `Instagram pull (${key}) failed: ${(err as Error).message}`, {}, 'warning');
    }
  }
  await markSource('ingest:instagram', ok, ok ? null : 'Instagram pull failed (see alerts)', { rowCount: n || undefined });
}
