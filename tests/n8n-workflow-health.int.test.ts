// Feature: the dashboard only pulled n8n execution history for workflows listed in
// config/registry.json, so a brand-new workflow outside the registry could fail on every run
// forever and nothing in the dashboard would notice. syncUntrackedWorkflowExecutions() closes that
// gap by pulling health-only execution history (status + n8n's own error text, no send extraction)
// for every OTHER active workflow, so the existing "n8n workflow failing" alert and the Integrations
// page cover it too. Against a real Postgres (set TEST_DATABASE_URL; skipped otherwise).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

d('untracked n8n workflows get health-only execution sync', () => {
  let db: typeof import('@/lib/db');

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.APP_TIMEZONE = 'Asia/Kolkata';
    process.env.N8N_BASE_URL = 'https://n8n.test';
    process.env.N8N_API_KEY = 'test-n8n-key';
    db = await import('@/lib/db');
    await db.q('drop schema public cascade');
    await db.q('create schema public');
    const { migrate } = await import('@/lib/migrate');
    await migrate(() => undefined);
    const { syncRegistry } = await import('@/lib/registry/sync');
    await syncRegistry();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await db?.pool().end();
  });

  it('records execution status for an active workflow outside the registry, without extracting any send attempt', async () => {
    const { q, one } = db;
    const { registry } = await import('@/lib/registry');
    const reg = registry();
    const untrackedId = 'newWorkflow123';
    expect(reg.workflows.some((w) => w.id === untrackedId)).toBe(false);

    // A workflow the hourly scan already discovered but the registry does not track — exactly the
    // state "Google Ads Outreach Send Dispatcher Workflow" was found in during the live audit.
    await q(
      `insert into n8n_workflows (id, name, active, tracked, looks_like_sender) values ($1, 'New Pipeline Dispatcher', true, false, true)`,
      [untrackedId],
    );

    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('/api/v1/executions')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: '999001',
                workflowId: untrackedId,
                status: 'error',
                mode: 'trigger',
                startedAt: new Date().toISOString(),
                stoppedAt: new Date().toISOString(),
                finished: true,
                data: { resultData: { error: { message: 'Sending paused by the bounce brake: 3 of 22 emails bounced in the last 2 days (13.6%, limit 3%).' } } },
              },
            ],
            nextCursor: null,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { syncUntrackedWorkflowExecutions } = await import('@/lib/sync/n8n-sync');
    await syncUntrackedWorkflowExecutions();

    const exec = await one<{ status: string; error_message: string; attempts_extracted: number }>(
      `select status, error_message, attempts_extracted from n8n_executions where execution_id = '999001'`,
    );
    expect(exec?.status).toBe('error');
    expect(exec?.error_message).toContain('bounce brake');
    expect(exec?.attempts_extracted).toBe(0);

    // The generic "n8n workflow failing" alert rule (alerts.ts) needs nothing registry-specific —
    // it just reads n8n_executions, so this untracked workflow is now visible to it too.
    const { evaluateAlerts, openAlerts } = await import('@/lib/alerts');
    await evaluateAlerts();
    const alerts = await openAlerts();
    expect(alerts.some((a) => a.kind === 'n8n_failed_run' && a.title.includes('New Pipeline Dispatcher'))).toBe(true);
  });

  it('does not re-fetch a workflow that is already tracked by the registry', async () => {
    const { q } = db;
    const { registry } = await import('@/lib/registry');
    const reg = registry();
    const trackedId = reg.workflows[0]!.id;

    let calledWithTrackedId = false;
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes(trackedId)) calledWithTrackedId = true;
      return new Response(JSON.stringify({ data: [], nextCursor: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    await q(`update n8n_workflows set active = true where id = $1`, [trackedId]);
    const { syncUntrackedWorkflowExecutions } = await import('@/lib/sync/n8n-sync');
    await syncUntrackedWorkflowExecutions();
    expect(calledWithTrackedId).toBe(false);
  });
});
