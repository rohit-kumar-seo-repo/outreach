// Classifies inbound replies (email + WhatsApp) that have no up-to-date automatic intent yet.
import { q } from '../db';
import { classifyReply, INTENT_VERSION } from '../crm/intent';

const BATCH = 2000;

export async function classifyReplies(): Promise<number> {
  let done = 0;
  for (;;) {
    const rows = await q<{ id: number; body: string | null; subject: string | null; kind: string; has_body: boolean }>(
      `select id, left(body_text, 4000) as body, subject, kind, body_text is not null as has_body
         from mail_messages
        where direction = 'inbound' and kind in ('message', 'auto_reply')
          and (intent_v is distinct from $1 or (body_text is not null and not coalesce(intent_had_body, false)))
        order by id limit $2`,
      [INTENT_VERSION, BATCH],
    );
    if (rows.length === 0) break;
    const intents = rows.map((r) => (r.kind === 'auto_reply' ? 'auto' : classifyReply(r.body ?? r.subject)));
    await q(
      `update mail_messages m set intent = x.intent, intent_v = $3, intent_had_body = x.had_body
         from unnest($1::bigint[], $2::text[], $4::boolean[]) as x(id, intent, had_body) where m.id = x.id`,
      [rows.map((r) => r.id), intents, INTENT_VERSION, rows.map((r) => r.has_body)],
    );
    done += rows.length;
    if (rows.length < BATCH) break;
  }
  for (;;) {
    const rows = await q<{ id: number; body: string | null; has_media: boolean }>(
      `select id, left(body, 4000) as body, has_media from wa_messages
        where not from_me and intent_v is distinct from $1 order by id limit $2`,
      [INTENT_VERSION, BATCH],
    );
    if (rows.length === 0) break;
    const intents = rows.map((r) => classifyReply(r.body, { hasMedia: r.has_media }));
    await q(
      `update wa_messages w set intent = x.intent, intent_v = $3 from unnest($1::bigint[], $2::text[]) as x(id, intent) where w.id = x.id`,
      [rows.map((r) => r.id), intents, INTENT_VERSION],
    );
    done += rows.length;
    if (rows.length < BATCH) break;
  }
  return done;
}
