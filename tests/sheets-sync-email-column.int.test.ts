// Regression test: syncOneSource() treated the email column as required for every sheet, so a
// WhatsApp sheet with no Email column (normal — leads are contacted by phone) logged a false
// "expected column(s) not found: Email" warning on every sync. Against a real Postgres (set
// TEST_DATABASE_URL; skipped otherwise).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

d('a WhatsApp sheet with no Email column is not flagged as missing one', () => {
  let db: typeof import('@/lib/db');

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
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const { source } = JSON.parse(String(init.body));
      const rows =
        source === 'wa_indian_business_sheet'
          ? [{ row_number: 2, Name: 'Clinic A', 'Mobile Number': '9871530594', City: 'Delhi', Category: 'Dental', 'Draft Message': 'Hi there', 'WhatsApp Outreach Status': '' }]
          : [];
      return new Response(JSON.stringify({ ok: true, source, rows }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await db?.pool().end();
  });

  it('does not record an "expected column(s) not found: Email" warning for a WhatsApp source', async () => {
    const { one } = db;
    const { registry } = await import('@/lib/registry');
    const { syncOneSource } = await import('@/lib/sync/sheets-sync');
    const src = registry().sources.find((s) => s.key === 'wa_indian_business_sheet')!;
    await syncOneSource(src);
    const err = await one(`select 1 from integration_errors where source_key = 'sheet:wa_indian_business_sheet:columns' and resolved_at is null`);
    expect(err).toBeNull();
  });
});
