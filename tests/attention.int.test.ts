// "Needs you" (Focus) against a real Postgres (set TEST_DATABASE_URL; skipped otherwise).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/session', () => ({
  assertSameOrigin: async () => undefined,
  requireSession: async () => ({ email: 'owner@example.com' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

d('needs you', () => {
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

  it('shows only leads waiting on you, with a reminder due, or going quiet', async () => {
    const { q, one } = db;
    const { deriveLeads } = await import('@/lib/sync/derive');
    const { focusCounts, listPipeline } = await import('@/lib/crm/queries');
    const { markDone } = await import('@/app/actions/crm');
    const camp = (await one<{ id: number }>(`select id from campaigns where slug = 'builders-outreach-rkd'`))!.id;
    const src = (await one<{ id: number }>(`select id from sources where key = 'builders_outreach_sheet'`))!.id;
    let n = 0;
    const lead = async (key: string) =>
      (await one<{ id: number }>(
        `insert into leads (campaign_id, source_id, source_row_key, name, email, email_norm, email_valid, phone, phone_norm, wa_chat_id, sheet_state)
         values ($1, $2, $3, $3, $4, $4, true, $5, $6, $7, 'sent') returning id`,
        [camp, src, key, `${key}@builder.example`, `98765 4321${n}`, `919876543210${n}`, `919876543210${n++}@c.us`],
      ))!.id;
    const email = async (leadId: number, body: string, minutesAgo: number) =>
      q(
        `insert into mail_messages (mailbox_id, folder, uid, direction, sent_at, lead_id, campaign_id, is_outreach_reply, body_text, thread_key)
         values ((select id from mailboxes limit 1), 'INBOX', (select coalesce(max(uid), 0) + 1 from mail_messages), 'inbound', now() - ($2 || ' minutes')::interval, $1::bigint, $3, true, $4, 't' || $1::text)`,
        [leadId, String(minutesAgo), camp, body],
      );
    const wa = async (leadId: number, fromMe: boolean, body: string, minutesAgo: number) =>
      q(
        `insert into wa_messages (session, message_id, chat_id, from_me, body, sent_at, source, lead_id, campaign_id)
         values ('default', 'm' || (select count(*) from wa_messages) || '-' || $1::text, (select wa_chat_id from leads where id = $1::bigint), $2, $3, now() - ($4 || ' minutes')::interval, 'n8n_webhook', $1::bigint, $5)`,
        [leadId, fromMe, body, String(minutesAgo), camp],
      );

    const asked = await lead('asked'); // asked a question by email, nobody answered
    const thanks = await lead('thanks'); // only said thanks
    const answered = await lead('answered'); // asked on WhatsApp, we answered
    const burst = await lead('burst'); // "send prices" then "thanks" with no answer in between
    const due = await lead('due'); // reminder due today
    const parked = await lead('parked'); // asked, but parked behind tomorrow's reminder
    const quiet = await lead('quiet'); // interested, nothing for 10 days
    const declined = await lead('declined'); // said no

    await email(asked, 'Can you send me the price list?', 30);
    await email(thanks, 'Thanks', 30);
    await wa(answered, false, 'How much does it cost?', 60);
    await wa(answered, true, 'It starts at 15,000 a month.', 50);
    await wa(burst, false, 'Please send the prices', 40);
    await wa(burst, false, 'Thanks', 39);
    await email(parked, 'Call me next week please', 30);
    await email(quiet, 'Interested, tell me more', 60 * 24 * 10);
    await email(declined, 'Not interested, thanks.', 30);
    await deriveLeads();
    await q(`update leads set manual_followup_at = now() - interval '1 hour' where id = $1`, [due]);
    await q(`update leads set manual_followup_at = now() + interval '2 days' where id = $1`, [parked]);
    await q(`update leads set stage = 'interested', stage_source = 'manual', stage_changed_at = last_reply_at + interval '1 hour', last_activity_at = last_reply_at + interval '1 hour' where id = $1`, [quiet]);

    const focus = async () => Object.fromEntries((await listPipeline({ view: 'focus', limit: 50 })).rows.map((r) => [r.id, r.attention]));
    expect(await focus()).toEqual({ [asked]: 'reply', [burst]: 'reply', [due]: 'due', [quiet]: 'cold' });
    // Replies come first, then reminders, then quiet leads.
    expect((await listPipeline({ view: 'focus', limit: 50 })).rows.map((r) => r.attention)).toEqual(['reply', 'reply', 'due', 'cold']);
    const c = await focusCounts();
    expect(c).toMatchObject({ reply: 2, due: 1, cold: 1, total: 4, parked: 1 });
    expect(c.waitingOnThem).toBeGreaterThanOrEqual(1); // answered
    expect(c.screened).toBeGreaterThanOrEqual(2); // thanks, declined

    // Done: the question leaves Focus and the lead moves from New to Contacted.
    expect(await markDone(asked)).toEqual({ ok: true });
    expect(await markDone(due)).toEqual({ ok: true });
    expect(await focus()).toEqual({ [burst]: 'reply', [quiet]: 'cold' });
    const row = await one<{ stage: string; rem: Date | null }>(`select stage, manual_followup_at as rem from leads where id = $1`, [asked]);
    expect(row?.stage).toBe('contacted');
    expect((await one<{ rem: Date | null }>(`select manual_followup_at as rem from leads where id = $1`, [due]))?.rem).toBeNull();

    // They write again: back in Focus.
    await email(asked, 'Thanks. One more question: do you do Google Ads too?', 0);
    await deriveLeads();
    expect((await focus())[asked]).toBe('reply');

    // Our WhatsApp answer (synced) clears the burst lead.
    await wa(burst, true, 'Sending the price list now.', 0);
    await deriveLeads();
    expect((await focus())[burst]).toBeUndefined();
  });
});
