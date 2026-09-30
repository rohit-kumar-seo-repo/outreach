// WhatsApp Outreach Control Center: lead-funnel reconciliation, the pause/cap/window send gate,
// safe manual replies, and manual classification — against a real Postgres (set
// TEST_DATABASE_URL; skipped otherwise).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

d('WhatsApp control center', () => {
  let db: typeof import('@/lib/db');
  let campaignId: number;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.APP_TIMEZONE = 'Asia/Kolkata';
    process.env.WAHA_BASE_URL = 'https://waha.test';
    process.env.WAHA_API_KEY = 'test-waha-key';
    db = await import('@/lib/db');
    await db.q('drop schema public cascade');
    await db.q('create schema public');
    const { migrate } = await import('@/lib/migrate');
    await migrate(() => undefined);
    const { syncRegistry } = await import('@/lib/registry/sync');
    await syncRegistry();
    campaignId = (await db.one<{ id: number }>(`select id from campaigns where slug = 'wa-dental-india'`))!.id;
    await db.q(`insert into wa_sessions (name, status, phone) values ('default', 'WORKING', '917011852449')`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await db?.pool().end();
  });

  it('reconciles every lead status into exactly one funnel bucket, summing to the loaded count', async () => {
    const { q } = db;
    const rows: [string, string, boolean, boolean][] = [
      ['ready', 'ready', false, false],
      ['needs_draft', 'new', false, false],
      ['sent', 'sent', false, false],
      ['duplicate', 'ready', true, false],
      ['invalid', 'new', false, false],
      ['excluded', 'excluded', false, false],
      ['unsubscribed', 'sent', false, true],
    ];
    for (const [i, [status, sheetState, isDup, suppressed]] of rows.entries()) {
      await q(
        `insert into leads (campaign_id, source_row_key, name, phone, phone_norm, wa_chat_id, status, sheet_state, is_duplicate, suppressed, present_in_source)
         values ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,true)`,
        [campaignId, `funnel-${i}`, `Lead ${i}`, `98700000${i}`, `9187000000${i}@c.us`, status, sheetState, isDup, suppressed],
      );
    }
    const { campaignFunnel } = await import('@/lib/metrics/whatsapp');
    const funnel = await campaignFunnel(campaignId);
    expect(funnel.loaded).toBe(rows.length);
    const sum = funnel.buckets.reduce((n, b) => n + b.count, 0);
    expect(sum).toBe(funnel.loaded);
    const byBucket = Object.fromEntries(funnel.buckets.map((b) => [b.bucket, b.count]));
    expect(byBucket).toMatchObject({ queued: 1, needs_message: 1, contacted: 1, duplicate: 1, invalid: 1, excluded: 1, opted_out: 1 });
  });

  it('the send gate blocks on pause, on the daily cap, and on the send window — and reflects the reason', async () => {
    const { q } = db;
    const { checkGate } = await import('@/lib/whatsapp/gate');

    let gate = await checkGate('wa-dental-india');
    expect(gate).toMatchObject({ allowed: true, reason: 'ok' });

    await q(`update campaigns set control_paused_at = now(), control_paused_by = 'tester' where id = $1`, [campaignId]);
    gate = await checkGate('wa-dental-india');
    expect(gate).toMatchObject({ allowed: false, reason: 'paused' });
    await q(`update campaigns set control_paused_at = null, control_paused_by = null where id = $1`, [campaignId]);

    await q(`update campaigns set daily_cap = 1 where id = $1`, [campaignId]);
    await q(
      `insert into send_attempts (idempotency_key, channel, campaign_id, recipient, recipient_norm, step, result, source, occurred_at, time_quality)
       values ('gate-test-1','whatsapp',$1,'919871500001@c.us','919871500001@c.us',0,'accepted','manual', now(), 'exact')`,
      [campaignId],
    );
    gate = await checkGate('wa-dental-india');
    expect(gate).toMatchObject({ allowed: false, reason: 'daily_cap_reached', sentToday: 1 });
    await q(`update campaigns set daily_cap = null where id = $1`, [campaignId]);

    // An impossible ISO weekday (8) never matches "now", so this is a deterministic way to
    // exercise the send-window branch without depending on the time the test happens to run.
    await q(`update campaigns set send_window = '{"days":[8]}'::jsonb where id = $1`, [campaignId]);
    gate = await checkGate('wa-dental-india');
    expect(gate).toMatchObject({ allowed: false, reason: 'outside_send_window' });
    await q(`update campaigns set send_window = '{}'::jsonb where id = $1`, [campaignId]);

    gate = await checkGate('not-a-real-campaign');
    expect(gate).toMatchObject({ allowed: false, reason: 'not_found' });
  });

  it('sends a manual reply once, dedupes a resubmitted form, and refuses a repeat within 10 minutes', async () => {
    const { q, one } = db;
    const lead = (await one<{ id: number }>(
      `insert into leads (campaign_id, source_row_key, name, phone, phone_norm, wa_chat_id, status) values ($1,'reply-lead','Reply Lead','9812345678','9812345678','919812345678@c.us','sent') returning id`,
      [campaignId],
    ))!.id;
    await q(
      `insert into wa_messages (session, message_id, chat_id, from_me, body, has_media, ack, sent_at, source, lead_id, campaign_id)
       values ('default','in-1','919812345678@c.us',false,'Hi, tell me more',false,null,now(),'waha_api',$1,$2)`,
      [lead, campaignId],
    );
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return new Response(JSON.stringify({ key: { id: 'true_919812345678@c.us_OUT1' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const { sendWaReply } = await import('@/lib/whatsapp/reply');
    const key1 = 'a'.repeat(20);
    const first = await sendWaReply({ idempotencyKey: key1, chatId: '919812345678@c.us', body: 'Sure, here is our pricing.' }, 'owner@test.example');
    expect(first.status).toBe('sent');
    expect(calls).toBe(1);

    // Resubmitting the exact same form (same key) returns the stored result without calling WAHA again.
    const again = await sendWaReply({ idempotencyKey: key1, chatId: '919812345678@c.us', body: 'Sure, here is our pricing.' }, 'owner@test.example');
    expect(again).toEqual(first);
    expect(calls).toBe(1);

    // Same text, new key, within 10 minutes: rejected as a likely accidental duplicate.
    const key2 = 'b'.repeat(20);
    const dup = await sendWaReply({ idempotencyKey: key2, chatId: '919812345678@c.us', body: 'Sure, here is our pricing.' }, 'owner@test.example');
    expect(dup.status).toBe('rejected');
    expect(calls).toBe(1);

    const stored = await one<{ from_me: boolean; body: string }>(`select from_me, body from wa_messages where message_id = 'true_919812345678@c.us_OUT1'`);
    expect(stored).toEqual({ from_me: true, body: 'Sure, here is our pricing.' });
  });

  it('refuses to reply to a number that opted out, and to a disconnected account', async () => {
    const { q } = db;
    await q(
      `insert into wa_messages (session, message_id, chat_id, from_me, body, has_media, ack, sent_at, source)
       values ('default','in-optout','919800000099@c.us',false,'stop messaging me',false,null,now(),'waha_api')`,
    );
    await q(`insert into suppressions (channel, value_norm, reason, source) values ('whatsapp','919800000099','unsubscribed','manual')`);
    const { sendWaReply } = await import('@/lib/whatsapp/reply');
    const optOut = await sendWaReply({ idempotencyKey: 'c'.repeat(20), chatId: '919800000099@c.us', body: 'Following up!' }, 'owner@test.example');
    expect(optOut.status).toBe('rejected');
    expect(optOut.message).toMatch(/unsubscribed/);

    await q(
      `insert into wa_sessions (name, status) values ('outreach2', 'FAILED') on conflict (name) do update set status = excluded.status`,
    );
    await q(
      `insert into wa_messages (session, message_id, chat_id, from_me, body, has_media, ack, sent_at, source)
       values ('outreach2','in-down','919800000088@c.us',false,'hello',false,null,now(),'waha_api')`,
    );
    const down = await sendWaReply({ idempotencyKey: 'd'.repeat(20), chatId: '919800000088@c.us', body: 'Hi!' }, 'owner@test.example');
    expect(down.status).toBe('rejected');
    expect(down.message).toMatch(/not connected/);
  });

  it('a manual "not an auto-reply" correction survives the automatic heuristic re-running', async () => {
    const { q } = db;
    const { reconcileWhatsApp } = await import('@/lib/sync/wa-store');
    await q(
      `insert into wa_messages (session, message_id, chat_id, from_me, body, has_media, ack, sent_at, source)
       values ('default','auto-1','919800000077@c.us',false,'Thank you for contacting us! We will respond shortly.',false,null,now(),'waha_api')`,
    );
    await reconcileWhatsApp();
    expect((await db.one<{ is_auto: boolean }>(`select is_auto from wa_messages where message_id = 'auto-1'`))!.is_auto).toBe(true);

    // A human decides this one was not actually automatic.
    await q(`update wa_messages set is_auto = false, auto_override = true where message_id = 'auto-1'`);
    await reconcileWhatsApp();
    expect((await db.one<{ is_auto: boolean }>(`select is_auto from wa_messages where message_id = 'auto-1'`))!.is_auto).toBe(false);
  });

  it('classifying a WhatsApp reply as not interested feeds the same lead-status logic email replies use', async () => {
    const { q, one } = db;
    const { deriveLeads } = await import('@/lib/sync/derive');
    const lead = (await one<{ id: number }>(
      `insert into leads (campaign_id, source_row_key, name, phone, phone_norm, wa_chat_id, status, sends_accepted, first_contacted_at)
       values ($1,'classify-lead','Classify Lead','9822233344','9822233344','919822233344@c.us','sent',1, now()) returning id`,
      [campaignId],
    ))!.id;
    const msg = (await one<{ id: number }>(
      `insert into wa_messages (session, message_id, chat_id, from_me, body, has_media, ack, sent_at, source, lead_id, campaign_id)
       values ('default','ni-1','919822233344@c.us',false,'Not interested, thanks',false,null,now(),'waha_api',$1,$2) returning id`,
      [lead, campaignId],
    ))!.id;
    await deriveLeads();
    expect((await one<{ status: string }>(`select status from leads where id = $1`, [lead]))!.status).toBe('replied');

    await q(`update wa_messages set sentiment = 'not_interested', classified_at = now(), classified_by = 'owner@test.example' where id = $1`, [msg]);
    await deriveLeads();
    expect((await one<{ status: string }>(`select status from leads where id = $1`, [lead]))!.status).toBe('not_interested');
  });
});
