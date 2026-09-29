// End-to-end pipeline test against a real Postgres (set TEST_DATABASE_URL; skipped otherwise).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

d('pipeline: sheets + n8n + mailbox → leads, replies, bounces, metrics', () => {
  let db: typeof import('@/lib/db');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.APP_TIMEZONE = 'Asia/Kolkata';
    process.env.N8N_BRIDGE_URL = 'https://bridge.test/webhook/outreach-dashboard-bridge';
    process.env.N8N_BRIDGE_KEY = 'test-key';
    db = await import('@/lib/db');
    await db.q('drop schema public cascade');
    await db.q('create schema public');
    const { migrate } = await import('@/lib/migrate');
    await migrate(() => undefined);
    const { syncRegistry } = await import('@/lib/registry/sync');
    await syncRegistry();
    const rows: Record<string, Record<string, unknown>[]> = {
      agency_india_tracker: [
        { row_number: 2, Agency: 'Alpha Ads', Email: 'alpha@alpha.example', Status: 'Sent', 'Date Sent': today, Notes: 'Sent via agency@adssuspensionrecovery.com, msg <alpha-1@adssuspensionrecovery.com>' },
        { row_number: 3, Agency: 'Beta Media', Email: 'beta@beta.example', Status: 'Drafted (pending send)', 'Send Date': tomorrow },
        { row_number: 4, Agency: 'Broken', Email: 'not an email', Status: 'Drafted (pending send)', 'Send Date': tomorrow },
        { row_number: 5, Agency: 'Beta again', Email: 'BETA@beta.example', Status: 'Drafted (pending send)', 'Send Date': tomorrow },
        { row_number: 6, Agency: 'Echo', Email: 'echo@echo.example', Status: 'Sent', 'Date Sent': today },
      ],
      dubai_real_estate_sheet: [{ row_number: 2, Company: 'Realty', Email: 'r@realty.example', Status: 'Sent', 'Send-from mailbox': 'hello@rohitkumarseo.tech' }],
    };
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const { source } = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ok: true, source, rows: rows[source] ?? [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await db?.pool().end();
  });

  it('runs the whole pipeline and counts every event exactly once', async () => {
    const { registry } = await import('@/lib/registry');
    const { syncOneSource } = await import('@/lib/sync/sheets-sync');
    const { recordSendAttempt } = await import('@/lib/sync/record');
    const { extractFromExecution } = await import('@/lib/sync/n8n-extract');
    const { runMatching } = await import('@/lib/sync/matching');
    const { deriveLeads } = await import('@/lib/sync/derive');
    const { campaignStats, rate } = await import('@/lib/metrics/campaigns');
    const { capacity } = await import('@/lib/metrics/capacity');
    const { overviewKpis, dailyActivity } = await import('@/lib/metrics/overview');
    const { parseFilters } = await import('@/lib/metrics/filters');
    const src = (k: string) => registry().sources.find((s) => s.key === k)!;

    await syncOneSource(src('agency_india_tracker'));
    await syncOneSource(src('dubai_real_estate_sheet'));

    // n8n reports the same agency send as the sheet (same Message-ID) — processed twice (retry).
    const sentAt = Date.now() - 3600_000;
    const exec = {
      id: '9001',
      workflowId: 'DXQsMGCz7F6Rfay0',
      data: {
        resultData: {
          runData: {
            'Route By Mailbox': [{ data: { main: [[{ json: { email: 'alpha@alpha.example', subject: 'Hi Alpha' } }]] } }],
            'Send from agency@': [
              {
                startTime: sentAt,
                source: [{ previousNode: 'Route By Mailbox', previousNodeOutput: 0, previousNodeRun: 0 }],
                data: { main: [[{ json: { accepted: ['alpha@alpha.example'], rejected: [], response: '250 2.0.0 Ok', messageId: '<alpha-1@adssuspensionrecovery.com>' }, pairedItem: { item: 0 } }], []] },
              },
            ],
          },
        },
      },
    };
    for (let i = 0; i < 2; i++) {
      for (const a of extractFromExecution(exec, registry().workflows.find((w) => w.id === 'DXQsMGCz7F6Rfay0')!).attempts) await recordSendAttempt(a);
    }
    const n8nRows = await db.q<{ n: number }>(`select count(*)::int as n from send_attempts where source = 'n8n_execution'`);
    expect(n8nRows[0].n).toBe(1);

    // A Hostinger API send (no Message-ID from the API) for the Dubai campaign.
    const dubaiAt = new Date(Date.now() - 7200_000);
    await recordSendAttempt({
      idempotencyKey: 'n8n:9002:Send via Hostinger:0:0:0',
      channel: 'email',
      campaignSlug: 'dubai-real-estate',
      sourceKey: 'dubai_real_estate_sheet',
      leadRowKey: 'r@realty.example',
      sender: 'hello@rohitkumarseo.tech',
      recipient: 'r@realty.example',
      step: 0,
      result: 'accepted',
      provider: 'hostinger_api',
      source: 'n8n_execution',
      occurredAt: dubaiAt,
      timeQuality: 'exact',
    });

    // Mailboxes: Sent copy of the Dubai send, a reply to it, a reply from Alpha, a bounce for Echo, a stranger.
    const mb = async (addr: string) => (await db.one<{ id: number }>(`select id from mailboxes where address = $1`, [addr]))!.id;
    const hello = await mb('hello@rohitkumarseo.tech');
    const agency = await mb('agency@adssuspensionrecovery.com');
    const ins = `insert into mail_messages (mailbox_id, folder, uid, message_id, in_reply_to, direction, from_addr, to_addrs, counterpart, subject, sent_at, kind, thread_key)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`;
    await db.q(ins, [hello, 'INBOX.Sent', 1, '<dubai-sent@rohitkumarseo.tech>', null, 'outbound', 'hello@rohitkumarseo.tech', ['r@realty.example'], 'r@realty.example', 'Dubai', new Date(dubaiAt.getTime() + 40_000), 'message', 's:r@realty.example|dubai']);
    await db.q(ins, [hello, 'INBOX', 5, '<reply-dubai@realty.example>', '<dubai-sent@rohitkumarseo.tech>', 'inbound', 'r@realty.example', ['hello@rohitkumarseo.tech'], 'r@realty.example', 'Re: Dubai', new Date(), 'message', 's:r@realty.example|dubai']);
    await db.q(ins, [agency, 'INBOX', 7, '<reply-alpha@alpha.example>', null, 'inbound', 'alpha@alpha.example', ['agency@adssuspensionrecovery.com'], 'alpha@alpha.example', 'Re: Hi Alpha', new Date(), 'message', 's:alpha@alpha.example|hi alpha']);
    await db.q(ins, [agency, 'INBOX', 8, '<stranger@else.example>', null, 'inbound', 'someone@else.example', ['agency@adssuspensionrecovery.com'], 'someone@else.example', 'Question', new Date(), 'message', 's:someone@else.example|question']);
    const bounceMsg = await db.one<{ id: number }>(ins, [agency, 'INBOX', 9, '<dsn@mx>', null, 'inbound', 'mailer-daemon@mx.example', ['agency@adssuspensionrecovery.com'], 'mailer-daemon@mx.example', 'Undelivered Mail Returned to Sender', new Date(), 'bounce', 's:mailer|undelivered']);
    await db.q(`insert into bounces (mail_message_id, recipient_norm, bounce_type, status_code, occurred_at) values ($1,'echo@echo.example','hard','5.1.1', now())`, [bounceMsg!.id]);

    await runMatching();
    await deriveLeads();

    // Hostinger send got its Message-ID from the Sent folder; the reply matched by thread header.
    const dubai = await db.one<{ message_id: string; time_quality: string }>(`select message_id, time_quality from send_attempts where idempotency_key = 'n8n:9002:Send via Hostinger:0:0:0'`);
    expect(dubai).toEqual({ message_id: '<dubai-sent@rohitkumarseo.tech>', time_quality: 'exact' });
    const replies = await db.q<{ from_addr: string; match_method: string; is_outreach_reply: boolean }>(
      `select from_addr, match_method, is_outreach_reply from mail_messages where direction = 'inbound' and kind = 'message' order by uid`,
    );
    expect(replies).toEqual([
      { from_addr: 'r@realty.example', match_method: 'in_reply_to', is_outreach_reply: true },
      { from_addr: 'alpha@alpha.example', match_method: 'sender_email', is_outreach_reply: true },
      { from_addr: 'someone@else.example', match_method: null, is_outreach_reply: false },
    ]);

    const statuses = Object.fromEntries(
      (await db.q<{ k: string; status: string }>(`select source_row_key as k, l.status from leads l join campaigns c on c.id = l.campaign_id where c.slug = 'agency-outreach-india'`)).map((r) => [r.k, r.status]),
    );
    expect(statuses).toEqual({
      'alpha@alpha.example': 'replied',
      'beta@beta.example': 'queued',
      'not an email': 'invalid',
      'beta@beta.example#row5': 'duplicate',
      'echo@echo.example': 'bounced',
    });
    const supp = await db.q<{ value_norm: string; reason: string }>(`select value_norm, reason from suppressions`);
    expect(supp).toEqual([{ value_norm: 'echo@echo.example', reason: 'hard_bounce' }]);

    // Campaign metrics: sheet + n8n reports of Alpha's email count as ONE send.
    const [ag] = await campaignStats({ slug: 'agency-outreach-india' });
    expect(ag).toMatchObject({ originalsSent: 2, contacted: 2, repliedLeads: 1, bouncedLeads: 1, duplicatesPrevented: 1, queued: 1, invalid: 1 });
    expect(rate(ag.repliedLeads, ag.contacted)).toBe(0.5);

    const cap = (await capacity()).find((c) => c.key === 'agency_india_tracker')!;
    expect(cap).toMatchObject({ totalRows: 5, contacted: 2, contactedVerified: 1, contactedSheetOnly: 1, duplicates: 1, invalid: 1, remaining: 1 });

    const kpis = await overviewKpis(parseFilters({}));
    expect(kpis.scheduledTomorrow).toBe(1); // Beta; the invalid row and the duplicate are not counted
    expect(kpis.repliesToday).toBe(2);
    expect(kpis.unmatchedInbound).toBe(1);

    const act = await dailyActivity(parseFilters({ campaign: 'agency-outreach-india' }));
    expect(act.points.at(-1)).toMatchObject({ day: today, sent: 2, replies: 1, bounces: 1 });
  });
});
