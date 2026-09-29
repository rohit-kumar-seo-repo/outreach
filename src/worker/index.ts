// Background sync worker: runs every integration on its own cadence. Jobs are guarded by
// Postgres advisory locks so a slow run is never overlapped by the next tick (or a second worker).
import { env } from '../lib/env';
import { pool, withAdvisoryLock } from '../lib/db';
import { recordIntegrationError } from '../lib/errors';
import { migrate } from '../lib/migrate';
import { syncRegistry } from '../lib/registry/sync';
import { deriveLeads } from '../lib/sync/derive';
import { syncMailboxes } from '../lib/sync/mail-sync';
import { scanN8nWorkflows, syncN8nExecutions } from '../lib/sync/n8n-sync';
import { syncSheets } from '../lib/sync/sheets-sync';
import { syncWaha } from '../lib/sync/waha';

interface Job {
  name: string;
  everySec: number;
  run: () => Promise<void>;
}

const log = (...a: unknown[]) => console.log(new Date().toISOString(), '[worker]', ...a);

async function runJob(job: Job): Promise<void> {
  const started = Date.now();
  const res = await withAdvisoryLock(`job:${job.name}`, async () => {
    try {
      await job.run();
    } catch (err) {
      log(`${job.name} failed:`, (err as Error).message);
      await recordIntegrationError(`job:${job.name}`, `${job.name} job crashed: ${(err as Error).message}`).catch(() => undefined);
    }
  });
  if (res === 'locked') log(`${job.name} skipped (previous run still active)`);
  else log(`${job.name} finished in ${Math.round((Date.now() - started) / 1000)}s`);
}

async function main(): Promise<void> {
  if (env.previewMode) {
    log('PREVIEW_MODE=true: sync worker disabled (sample data only).');
    return;
  }
  await migrate(log);
  await syncRegistry();
  const i = env.intervals;
  const jobs: Job[] = [
    { name: 'n8n-workflows', everySec: i.workflows, run: scanN8nWorkflows },
    { name: 'sheets', everySec: i.sheets, run: syncSheets },
    { name: 'n8n-executions', everySec: i.n8n, run: syncN8nExecutions },
    { name: 'mailboxes', everySec: i.mail, run: syncMailboxes },
    { name: 'waha', everySec: i.waha, run: syncWaha },
    { name: 'derive', everySec: i.derive, run: deriveLeads },
  ];
  // First pass in dependency order: leads (sheets) before send events so events link to leads.
  for (const job of jobs) await runJob(job);
  const next = new Map(jobs.map((j) => [j.name, Date.now() + j.everySec * 1000]));
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    log('shutting down');
    await pool().end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  // Manual "sync now" requests from the dashboard are stored in app_state.
  for (;;) {
    const now = Date.now();
    const requested = await pool()
      .query<{ value: { jobs: string[] } }>(`delete from app_state where key = 'sync_request' returning value`)
      .then((r) => r.rows[0]?.value.jobs ?? [])
      .catch(() => [] as string[]);
    for (const job of jobs) {
      if (stopping) return;
      if (now >= next.get(job.name)! || requested.includes(job.name) || requested.includes('all')) {
        await runJob(job);
        if (job.name !== 'derive') await runJob(jobs.find((j) => j.name === 'derive')!);
        next.set(job.name, Date.now() + job.everySec * 1000);
      }
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

main().catch((err) => {
  console.error('[worker] fatal', err);
  process.exit(1);
});
