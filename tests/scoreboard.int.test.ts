// "What we got" against a real Postgres (set TEST_DATABASE_URL; skipped otherwise).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

d('scoreboard', () => {
  let db: typeof import('@/lib/db');

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.APP_TIMEZONE = 'Asia/Kolkata';
    db = await import('@/lib/db');
    await db.q('drop schema public cascade');
    await db.q('create schema public');
    const { migrate } = await import('@/lib/migrate');
    await migrate(() => undefined);
    const { syncRegistry } = await import('@/lib/registry/sync');
    await syncRegistry();
  });

  afterAll(async () => {
    await db?.pool().end();
  });

  it('counts what each source got in a period, and reads its health', async () => {
    const { q, one } = db;
    const { deriveLeads } = await import('@/lib/sync/derive');
    const { scoreboard, sourceStates } = await import('@/lib/metrics/scoreboard');
    const camp = (await one<{ id: number }>(`select id from campaigns where slug = 'builders-outreach-rkd'`))!.id;
    const src = (await one<{ id: number }>(`select id from sources where key = 'builders_outreach_sheet'`))!.id;
    const lead = async (key: string, state = 'sent') =>
      (await one<{ id: number }>(
        `insert into leads (campaign_id, source_id, source_row_key, name, email, email_norm, email_valid, sheet_state)
         values ($1, $2, $3, $3, $4, $4, true, $5) returning id`,
        [camp, src, key, `${key}@builder.example`, state],
      ))!.id;
    const send = async (leadId: number, key: string, step: number, daysAgo: number) =>
      q(
        `insert into send_attempts (idempotency_key, channel, campaign_id, lead_id, recipient, recipient_norm, step, result, source, occurred_at, time_quality)
         values ($1, 'email', $2, $3, $4, $4, $5, 'accepted', 'n8n_push', now() - ($6 || ' days')::interval, 'exact')`,
        [`${key}-${step}`, camp, leadId, `${key}@builder.example`, step, String(daysAgo)],
      );
    const reply = async (leadId: number, body: string, daysAgo: number) =>
      q(
        `insert into mail_messages (mailbox_id, folder, uid, direction, sent_at, lead_id, campaign_id, is_outreach_reply, body_text, thread_key)
         values ((select id from mailboxes limit 1), 'INBOX', (select coalesce(max(uid), 0) + 1 from mail_messages), 'inbound', now() - ($2 || ' days')::interval, $1::bigint, $3, true, $4, 't' || $1::text)`,
        [leadId, String(daysAgo), camp, body],
      );

    const a = await lead('a'); // asked a question 2 days ago, then booked a meeting
    const b = await lead('b'); // said thanks 3 days ago
    const c = await lead('c'); // said no 1 day ago
    const old = await lead('old'); // interested 20 days ago, won 10 days ago
    const silent = await lead('silent'); // contacted, never replied
    for (const [id, key, days] of [[a, 'a', 5], [b, 'b', 5], [c, 'c', 4], [silent, 'silent', 2]] as const) await send(id, key, 0, days);
    await send(silent, 'silent', 1, 1); // a follow-up
    await send(old, 'old', 0, 25);
    await reply(a, 'How much does it cost?', 2);
    await reply(b, 'Thanks', 3);
    await reply(c, 'Not interested, thanks.', 1);
    await reply(old, 'Interested, tell me more', 20);
    await deriveLeads();
    await q(`insert into lead_outcomes (lead_id, campaign_id, outcome, occurred_on, recorded_by) values ($1, $2, 'meeting_booked', current_date - 1, 'test')`, [a, camp]);
    await q(`insert into lead_outcomes (lead_id, campaign_id, outcome, occurred_on, value, currency, recorded_by) values ($1, $2, 'won', current_date - 10, 45000, 'INR', 'test')`, [old, camp]);
    await q(`update leads set outcome = 'won', stage = 'won', stage_source = 'manual', stage_changed_at = now() - interval '10 days' where id = $1`, [old]);

    const of = async (range: 'today' | '7d' | '30d') => (await scoreboard(range)).sources.find((s) => s.slug === 'builders-outreach-rkd')!;
    const week = await of('7d');
    // 4 first messages + 1 follow-up in the last 7 days; the 25-day-old send is outside.
    expect(week).toMatchObject({ sent: 5, reached: 4, replies: 3, interested: 1, meetings: 1, won: 0 });
    expect(week.health).toBe('sending');
    expect(week.needYou).toBe(1); // only the unanswered question

    const month = await of('30d');
    expect(month).toMatchObject({ sent: 6, reached: 5, replies: 4, interested: 2, meetings: 1, won: 1, wonValue: 45000, wonCurrency: 'INR' });

    const board = await scoreboard('30d');
    expect(board.totals).toMatchObject({ sent: 6, replies: 4, interested: 2, meetings: 1, won: 1, wonValue: 45000, wonCurrency: 'INR' });
    // Best results first.
    expect(board.sources[0].slug).toBe('builders-outreach-rkd');

    // A source that stopped sending while leads wait reads as idle.
    await lead('waiting', 'ready');
    await q(`update leads set status = 'ready', present_in_source = true where source_row_key = 'waiting'`);
    await q(`update send_attempts set occurred_at = occurred_at - interval '6 days' where campaign_id = $1`, [camp]);
    const state = (await sourceStates()).find((s) => s.slug === 'builders-outreach-rkd')!;
    expect(state.health).toBe('idle');
    expect(state.remaining).toBeGreaterThanOrEqual(1);
  });
});
