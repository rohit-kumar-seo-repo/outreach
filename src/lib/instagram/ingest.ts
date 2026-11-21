// Instagram leads (2026-11-21). The n8n Instagram bots push every comment, every message we send and every reply.
// Each person becomes one lead per page (campaign ig-rohit-kumar-seo / ig-ai-automation), keyed by username, and
// every event is one ig_messages row (idempotent on ext_id, so n8n retries never double up).
import { z } from 'zod';
import { tx, type Queryable } from '@/lib/db';
import { digitsOnly } from '@/lib/normalize';

export const IG_PAGES = { rohit_kumar_seo: 'ig-rohit-kumar-seo', ai_automation_by_rohit: 'ig-ai-automation' } as const;

export const igEvent = z.object({
  page: z.enum(['rohit_kumar_seo', 'ai_automation_by_rohit']),
  extId: z.string().min(1).max(300),
  username: z.string().min(1).max(100).transform((u) => u.replace(/^@/, '').toLowerCase()),
  igUserId: z.string().max(100).optional(),
  threadId: z.string().max(300).optional(),
  fromMe: z.boolean(),
  kind: z.enum(['comment', 'comment_reply', 'dm']),
  body: z.string().max(5000).optional(),
  at: z.string().datetime({ offset: true }).optional(),
  // the bot step this message belongs to: gate, q1, q2, q3, close, ask_number, qualified, handoff ...
  stage: z.string().max(40).optional(),
  // true on the lead's message that asked for a call back / WhatsApp: puts them in "waiting on you"
  needsYou: z.boolean().optional(),
  reel: z.object({ id: z.string().max(100).optional(), keyword: z.string().max(40).optional() }).optional(),
  answers: z
    .object({ business: z.string().max(500).optional(), problem: z.string().max(500).optional(), volume: z.string().max(200).optional(), phone: z.string().max(40).optional() })
    .optional(),
});
export type IgEvent = z.infer<typeof igEvent>;

const RANK: Record<string, number> = { new: 0, contacted: 1, interested: 2, meeting: 3, proposal: 4, won: 5, lost: 5 };

/** Pipeline stage this event earns: our first message = contacted, their answers / ask for a call = interested. */
export function stageFor(e: Pick<IgEvent, 'fromMe' | 'needsYou' | 'stage'>): 'contacted' | 'interested' | null {
  if (e.needsYou || (!e.fromMe && e.stage && ['q2', 'q3', 'close', 'ask_number', 'qualified', 'handoff', 'qualifying'].includes(e.stage))) return 'interested';
  if (e.fromMe) return 'contacted';
  return null;
}

/** Indian 10-digit numbers get +91; anything with a country code is kept. */
export function phoneDigits(v: string | undefined): string | null {
  const d = digitsOnly(v);
  if (d.length === 10) return `91${d}`;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

export async function ingestIg(e: IgEvent): Promise<{ leadId: number; inserted: boolean }> {
  return tx(async (c) => {
    const camp = await c.query<{ id: number }>('select id from campaigns where slug = $1', [IG_PAGES[e.page]]);
    if (!camp.rows[0]) throw new Error(`campaign ${IG_PAGES[e.page]} missing (registry not synced yet)`);
    const campaignId = camp.rows[0].id;
    const leadId = await upsertLead(c, campaignId, e);
    const at = e.at ? new Date(e.at) : new Date();
    const ins = await c.query<{ id: number }>(
      `insert into ig_messages (page, ext_id, thread_id, username, ig_user_id, from_me, kind, body, stage, needs_you, reel_id, reel_keyword, sent_at, lead_id, campaign_id, raw)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       on conflict (ext_id) do nothing returning id`,
      [e.page, e.extId, e.threadId ?? null, e.username, e.igUserId ?? null, e.fromMe, e.kind, e.body ?? null, e.stage ?? null, !!e.needsYou,
        e.reel?.id ?? null, e.reel?.keyword ?? null, at, leadId, campaignId, JSON.stringify({ answers: e.answers ?? null })],
    );
    return { leadId, inserted: ins.rows.length > 0 };
  });
}

async function upsertLead(c: Queryable, campaignId: number, e: IgEvent): Promise<number> {
  const key = `ig:${e.username}`;
  const phone = phoneDigits(e.answers?.phone);
  const found = await c.query<{ id: number; stage: string | null; stage_source: string | null }>(
    'select id, stage, stage_source from leads where campaign_id = $1 and source_row_key = $2 for update',
    [campaignId, key],
  );
  // answers arrive one per message (business, then problem, then volume + phone): merged below, never replaced
  const info = { page: e.page, reel_id: e.reel?.id, reel_keyword: e.reel?.keyword, ...(e.kind === 'comment' && !e.fromMe ? { first_comment: e.body } : {}) };
  const answers = JSON.stringify(e.answers ?? {});
  let id: number;
  if (found.rows[0]) {
    id = found.rows[0].id;
    await c.query(
      `update leads set
         ig_username = $2,
         phone = coalesce($3, phone), phone_norm = coalesce($4, phone_norm),
         category = coalesce(category, $5),
         raw = jsonb_set(raw, '{instagram}',
                 (coalesce(raw->'instagram', '{}'::jsonb) - 'first_comment' || jsonb_strip_nulls($6::jsonb)
                   || jsonb_build_object('first_comment', coalesce(raw->'instagram'->'first_comment', ($6::jsonb)->'first_comment')))
                 || jsonb_build_object('answers', coalesce(raw->'instagram'->'answers', '{}'::jsonb) || jsonb_strip_nulls($7::jsonb))),
         last_activity_at = now(), updated_at = now()
       where id = $1`,
      [id, e.username, phone ? `+${phone}` : null, phone, e.answers?.business ?? null, JSON.stringify(info), answers],
    );
  } else {
    const r = await c.query<{ id: number }>(
      `insert into leads (campaign_id, source_row_key, name, ig_username, phone, phone_norm, category, raw, last_activity_at)
       values ($1, $2, $3, $4, $5, $6, $7, jsonb_build_object('instagram', jsonb_strip_nulls($8::jsonb) || jsonb_build_object('answers', jsonb_strip_nulls($9::jsonb))), now()) returning id`,
      [campaignId, key, `@${e.username}`, e.username, phone ? `+${phone}` : null, phone, e.answers?.business ?? null, JSON.stringify(info), answers],
    );
    id = r.rows[0].id;
  }
  // pipeline stage: only moves forward, and never overrides a stage a person set
  const want = stageFor(e);
  const cur = found.rows[0];
  const curRank = cur?.stage ? RANK[cur.stage] ?? 0 : -1;
  if (want && (!cur || cur.stage_source === null || cur.stage_source === 'instagram') && RANK[want] > curRank) {
    await c.query(`update leads set stage = $2, stage_source = 'instagram', stage_changed_at = now() where id = $1 and (stage is distinct from $2)`, [id, want]);
  }
  // a call-back number = a reminder due now, so it shows under "reminders due" on Today
  if (phone && e.needsYou) await c.query('update leads set manual_followup_at = coalesce(manual_followup_at, now()) where id = $1', [id]);
  return id;
}
