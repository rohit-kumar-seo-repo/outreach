import { one, q } from '../db';
import { redact } from '../errors';

export async function startRun(job: string, sourceKey: string | null = null): Promise<number> {
  const row = await one<{ id: number }>('insert into sync_runs (job, source_key) values ($1,$2) returning id', [job, sourceKey]);
  return row!.id;
}

export async function finishRun(
  id: number,
  status: 'success' | 'partial' | 'error' | 'skipped',
  counts: { seen?: number; written?: number } = {},
  error: string | null = null,
  detail: Record<string, unknown> | null = null,
): Promise<void> {
  await q(
    `update sync_runs set finished_at = now(), status = $2, items_seen = $3, items_written = $4, error = $5, detail = $6 where id = $1`,
    [id, status, counts.seen ?? 0, counts.written ?? 0, error ? redact(error).slice(0, 2000) : null, detail ? JSON.stringify(detail) : null],
  );
  // Keep the run log bounded.
  await q(`delete from sync_runs where started_at < now() - interval '45 days'`);
}

export async function markSource(
  key: string,
  ok: boolean,
  error: string | null = null,
  extra: { rowCount?: number; columns?: string[] } = {},
): Promise<void> {
  await q(
    `update sources set last_sync_at = now(),
        last_success_at = case when $2 then now() else last_success_at end,
        last_status = case when $2 then 'ok' else 'error' end,
        last_error = $3,
        row_count = coalesce($4, row_count),
        columns = coalesce($5, columns)
     where key = $1`,
    [key, ok, error ? redact(error).slice(0, 1000) : null, extra.rowCount ?? null, extra.columns ?? null],
  );
}
