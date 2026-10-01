// Regression test: scanN8nWorkflows() recorded an integration error on failure but never
// resolved it on a later success, so a transient n8n API outage stayed "open" on the
// Integrations page forever. Against a real Postgres (set TEST_DATABASE_URL; skipped otherwise).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

d('n8n workflow scan self-heals its own integration error', () => {
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

  it('clears the "n8n:workflows" error once the scan succeeds again', async () => {
    const { one } = db;
    const { scanN8nWorkflows } = await import('@/lib/sync/n8n-sync');

    vi.stubGlobal('fetch', async () => new Response('unauthorized', { status: 401 }));
    await scanN8nWorkflows();
    const failed = await one<{ resolved_at: Date | null }>(`select resolved_at from integration_errors where source_key = 'n8n:workflows'`);
    expect(failed?.resolved_at).toBeNull();

    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: [], nextCursor: null }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await scanN8nWorkflows();
    const healed = await one<{ resolved_at: Date | null }>(`select resolved_at from integration_errors where source_key = 'n8n:workflows'`);
    expect(healed?.resolved_at).not.toBeNull();
  });
});
