// Alerts, sending limits, outcomes and data coverage against a real Postgres (set TEST_DATABASE_URL; skipped otherwise).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

d('alerts, sending volume, outcomes and coverage', () => {
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

  it('counts volume, raises and resolves alerts, and reports outcomes and coverage', async () => {
    const { q, one } = db;
    const { recordSendAttempt } = await import('@/lib/sync/record');
    const { deriveLeads } = await import('@/lib/sync/derive');
    const { dailyVolumes } = await import('@/lib/metrics/sending');
    const { evaluateAlerts, openAlerts } = await import('@/lib/alerts');
    const { campaignStats } = await import('@/lib/metrics/campaigns');
    const { coverageGrid } = await import('@/lib/metrics/coverage');
    const { localDate, addDays } = await import('@/lib/time');
    const today = localDate();
    const now = new Date();
    const cid = async (slug: string) => (await one<{ id: number }>('select id from campaigns where slug = $1', [slug]))!.id;
    const box = async (address: string) => (await one<{ id: number }>('select id from mailboxes where address = $1', [address]))!.id;

    // A contacted lead, 5 outreach sends from ads@ today, 2 other Sent-folder messages.
    const gads = await cid('google-ads-services-intl');
    const lead = (await one<{ id: number }>(
      `insert into leads (campaign_id, source_row_key, email, email_norm, email_valid, status) values ($1, 'p0', 'p0@prospect.example', 'p0@prospect.example', true, 'sent') returning id`,
      [gads],
    ))!.id;
    for (let i = 0; i < 5; i++) {
      await recordSendAttempt({
        idempotencyKey: `t:${i}`,
        channel: 'email',
        campaignSlug: 'google-ads-services-intl',
        leadId: i === 0 ? lead : null,
        sender: 'ads@rohitkumarseo.tech',
        recipient: `p${i}@prospect.example`,
        step: 0,
        result: 'accepted',
        source: 'n8n_execution',
        occurredAt: now,
        timeQuality: 'exact',
      });
    }
    const ads = await box('ads@rohitkumarseo.tech');
    for (let i = 1; i <= 2; i++) {
      await q(
        `insert into mail_messages (mailbox_id, folder, uid, message_id, direction, sent_at) values ($1, 'INBOX.Sent', $2, $3, 'outbound', now())`,
        [ads, i, `<digest-${i}@rohitkumarseo.tech>`],
      );
    }

    const vol = await dailyVolumes(3);
    const adsRow = vol.mailboxes.find((m) => m.key === 'ads@rohitkumarseo.tech')!;
    expect(adsRow.today).toMatchObject({ outreach: 5, other: 2, total: 7 });
    expect(vol.domains.find((x) => x.key === 'rohitkumarseo.tech')!.today.total).toBe(7);
    expect(adsRow.days.map((x) => x.day)).toEqual([addDays(today, -2), addDays(today, -1), today]);

    // Limits: mailbox over (7 > 6), domain near (7 ≥ 60% of 10).
    await q(`insert into send_limits (scope, key, daily_limit, warn_pct) values ('mailbox', 'ads@rohitkumarseo.tech', 6, 80), ('domain', 'rohitkumarseo.tech', 10, 60)`);

    // n8n: the dispatcher's latest run failed.
    await q(`insert into n8n_workflows (id, name, tracked) values ('NJLi3kOJRaoB5Bu7', 'Outreach Send Dispatcher', true)`);
    await q(
      `insert into n8n_executions (execution_id, workflow_id, status, started_at, final, error_message) values
         ('1', 'NJLi3kOJRaoB5Bu7', 'success', now() - interval '1 day', true, null),
         ('2', 'NJLi3kOJRaoB5Bu7', 'error', now() - interval '1 hour', true, 'Send via Hostinger: 401 Unauthorized')`,
    );
    await q(`update sources set last_status = 'ok', last_success_at = now() where key = 'n8n:executions'`);

    // Sync failure on one mailbox; "not connected" on another must not alert.
    await q(`update mailboxes set last_status = 'error', last_error = 'Invalid token', last_success_at = now() - interval '1 hour' where address = 'seo@rohitkumarseo.tech'`);
    await q(`update mailboxes set last_status = 'not_connected', last_error = 'Not connected: no token' where address = 'hello@rohitkumarseo.tech'`);

    // An overdue follow-up.
    await q(
      `insert into leads (campaign_id, source_row_key, email_norm, status, next_followup_at) values ($1, 'late', 'late@x.example', 'followup_due', now() - interval '3 days')`,
      [await cid('agency-outreach-india')],
    );

    // Bounce spike: 6 bounces in 24 h for rohitkumarseo.tech against 5 sends.
    for (let i = 0; i < 6; i++) {
      const m = await one<{ id: number }>(
        `insert into mail_messages (mailbox_id, folder, uid, direction, kind, sent_at) values ($1, 'INBOX', $2, 'inbound', 'bounce', now()) returning id`,
        [ads, 100 + i],
      );
      await q(`insert into bounces (mail_message_id, recipient_norm, bounce_type, occurred_at) values ($1, $2, 'hard', now())`, [m!.id, `gone${i}@x.example`]);
    }

    const first = await evaluateAlerts();
    const open = await openAlerts();
    const byKind = (k: string) => open.filter((a) => a.kind === k);
    expect(byKind('volume_limit').map((a) => a.severity).sort()).toEqual(['critical', 'warning']);
    expect(byKind('n8n_failed_run')).toHaveLength(1);
    expect(byKind('n8n_failed_run')[0].detail).toContain('401 Unauthorized');
    expect(byKind('sync_failed').map((a) => a.title)).toEqual(['Mailbox sync failing: seo@rohitkumarseo.tech']);
    expect(byKind('followups_overdue')[0].title).toBe('1 follow-up overdue');
    expect(byKind('bounce_spike')[0]).toMatchObject({ severity: 'critical', title: 'Bounce spike on rohitkumarseo.tech' });
    expect(first.opened).toBe(open.length);

    // Re-evaluating keeps the same alerts (no duplicates); fixing a problem resolves its alert.
    const again = await evaluateAlerts();
    expect(again.opened).toBe(0);
    await q(`insert into n8n_executions (execution_id, workflow_id, status, started_at, final) values ('3', 'NJLi3kOJRaoB5Bu7', 'success', now(), true)`);
    await q(`update mailboxes set last_status = 'ok', last_error = null where address = 'seo@rohitkumarseo.tech'`);
    await evaluateAlerts();
    const after = await openAlerts();
    expect(after.some((a) => a.kind === 'n8n_failed_run' || a.kind === 'sync_failed')).toBe(false);
    expect((await one<{ n: number }>(`select count(*)::int as n from alerts where resolved_at is not null`))!.n).toBe(2);

    // Outcomes: meeting booked then won, with a value; campaign results count them.
    await q(
      `insert into lead_outcomes (lead_id, campaign_id, outcome, occurred_on, value, currency) values
         ($1, $2, 'meeting_booked', $3, null, null), ($1, $2, 'won', $4, 50000, 'INR')`,
      [lead, gads, addDays(today, -2), today],
    );
    await deriveLeads();
    expect(await one(`select outcome, outcome_on::text as on from leads where id = $1`, [lead])).toEqual({ outcome: 'won', on: today });
    const [g] = await campaignStats({ slug: 'google-ads-services-intl' });
    expect(g).toMatchObject({ contacted: 1, qualifiedLeads: 1, meetingLeads: 1, wonLeads: 1, lostLeads: 0, wonValue: 50000, wonCurrencies: ['INR'] });

    // Coverage: n8n history starts yesterday. A sheet-dated send two days ago is approximate; an undated one is counted apart.
    await recordSendAttempt({
      idempotencyKey: 'sheet:dubai:1',
      channel: 'email',
      campaignSlug: 'dubai-real-estate',
      sender: 'hello@rohitkumarseo.tech',
      recipient: 'r@realty.example',
      step: 0,
      result: 'accepted',
      source: 'sheet_status',
      occurredAt: new Date(`${addDays(today, -2)}T06:30:00Z`),
      timeQuality: 'date_only',
    });
    await recordSendAttempt({
      idempotencyKey: 'sheet:dubai:2',
      channel: 'email',
      campaignSlug: 'dubai-real-estate',
      recipient: 'undated@realty.example',
      step: 0,
      result: 'accepted',
      source: 'sheet_status',
      occurredAt: null,
      timeQuality: 'unknown',
    });
    const cov = await coverageGrid(3);
    const dubai = cov.campaigns.find((c) => c.slug === 'dubai-real-estate')!;
    expect(dubai.cells.map((c) => c.status)).toEqual(['approximate', 'complete', 'complete']);
    expect(dubai.cells[0]).toMatchObject({ sends: 1, dateOnly: 1, via: 'sheet' });
    expect(dubai.undated).toBe(1);
    expect(dubai.completeFrom).toBe(addDays(today, -1));
    const agency = cov.campaigns.find((c) => c.slug === 'agency-outreach-india')!;
    expect(agency.cells[0].status).toBe('unknown');
  });
});
