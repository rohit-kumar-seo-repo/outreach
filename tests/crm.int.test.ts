// Lead pipeline against a real Postgres (set TEST_DATABASE_URL; skipped otherwise).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

d('lead pipeline', () => {
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

  it('derives stages from replies and the sheet, ranks the call queue and lists the pipeline', async () => {
    const { q, one } = db;
    const { deriveLeads } = await import('@/lib/sync/derive');
    const { listPipeline, stageCounts, callQueueIds } = await import('@/lib/crm/queries');
    const camp = (await one<{ id: number }>(`select id from campaigns where slug = 'builders-outreach-rkd'`))!.id;
    const src = (await one<{ id: number }>(`select id from sources where key = 'builders_outreach_sheet'`))!.id;
    const lead = async (key: string, raw: Record<string, string> = {}, phone: string | null = '98765 4321' + key.slice(-1)) =>
      (await one<{ id: number }>(
        `insert into leads (campaign_id, source_id, source_row_key, name, email, email_norm, email_valid, phone, phone_norm, raw, sheet_state)
         values ($1, $2, $3, $3, $4, $4, true, $5, regexp_replace(coalesce($5, ''), '\\D', '', 'g'), $6, 'sent') returning id`,
        [camp, src, key, `${key}@builder.example`, phone, JSON.stringify(raw)],
      ))!.id;
    const reply = async (leadId: number, sentiment: string | null, minutesAgo: number) => {
      await q(
        `insert into mail_messages (mailbox_id, folder, uid, direction, sent_at, lead_id, campaign_id, is_outreach_reply, sentiment, body_text)
         values ((select id from mailboxes limit 1), 'INBOX', $1, 'inbound', now() - ($2 || ' minutes')::interval, $1, $3, true, $4, 'Tell me more')`,
        [leadId, String(minutesAgo), camp, sentiment],
      );
    };

    const fresh = await lead('fresh1');
    const declined = await lead('declined2');
    const booked = await lead('booked3', { 'Lead Stage': 'Booked - Rohit handling' });
    const manual = await lead('manual4', { 'Lead Stage': 'Booked - Rohit handling' });
    const silent = await lead('silent5');
    const noPhone = await lead('nophone6', {}, null);
    await reply(fresh, null, 10);
    await reply(declined, 'not_interested', 20);
    await reply(booked, null, 30);
    await reply(manual, null, 40);
    await reply(noPhone, null, 5);
    await q(`update leads set stage = 'interested', stage_source = 'manual' where id = $1`, [manual]);
    await deriveLeads();

    const stageOf = async (id: number) => (await listPipeline({ view: 'all', limit: 100 })).rows.find((r) => r.id === id)?.stage ?? null;
    expect(await stageOf(fresh)).toBe('new');
    expect(await stageOf(declined)).toBe('lost');
    expect(await stageOf(booked)).toBe('meeting'); // from the sheet's Lead Stage
    expect(await stageOf(manual)).toBe('interested'); // a person's choice is never overwritten
    expect(await stageOf(silent)).toBeNull(); // never replied, never staged: not in the pipeline
    expect((await one<{ s: string }>('select stage_source as s from leads where id = $1', [booked]))!.s).toBe('sheet');

    const counts = await stageCounts({});
    expect(counts).toMatchObject({ new: 2, meeting: 1, interested: 1, lost: 1 });
    expect((await listPipeline({ view: 'open', limit: 100 })).total).toBe(4);
    expect((await listPipeline({ view: 'open', search: '43211', limit: 10 })).rows.map((r) => r.id)).toEqual([fresh]);

    // Call queue: a due reminder first, then new replies (newest first); no number → not callable.
    await q(`update leads set manual_followup_at = now() - interval '1 hour' where id = $1`, [booked]);
    let queue = await callQueueIds();
    expect(queue[0]).toBe(booked);
    expect(queue.indexOf(fresh)).toBeGreaterThan(0);
    expect(queue).not.toContain(noPhone);
    expect(queue).not.toContain(declined);

    // After a call on the due lead it drops out (called after its reminder), the rest stay.
    await q(`update leads set last_call_at = now(), last_call_outcome = 'connected' where id = $1`, [booked]);
    queue = await callQueueIds();
    expect(queue).not.toContain(booked);
    expect(queue[0]).toBe(fresh);

    // A future reminder parks a lead until then.
    await q(`update leads set manual_followup_at = now() + interval '1 day' where id = $1`, [fresh]);
    expect(await callQueueIds()).not.toContain(fresh);
    expect((await listPipeline({ view: 'contacts', due: true, limit: 10 })).rows.map((r) => r.id)).not.toContain(fresh);
  });
});
