import pg from 'pg';
import { env } from './env';

// Keep one pool per process (survives Next.js dev hot reloads).
const globalForPool = globalThis as unknown as { __rksPool?: pg.Pool };

// Return timestamptz as Date, bigint counts as numbers (they stay far below 2^53 here).
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));
pg.types.setTypeParser(1700, (v) => Number.parseFloat(v));
// `date` columns stay plain 'YYYY-MM-DD' strings so no timezone shift happens.
pg.types.setTypeParser(1082, (v) => v);

export function pool(): pg.Pool {
  if (!globalForPool.__rksPool) {
    globalForPool.__rksPool = new pg.Pool({
      connectionString: env.databaseUrl,
      max: Number.parseInt(process.env.PG_POOL_MAX ?? '10', 10),
      idleTimeoutMillis: 30_000,
    });
    globalForPool.__rksPool.on('error', (err) => {
      console.error('[db] idle client error', err.message);
    });
  }
  return globalForPool.__rksPool;
}

export type Queryable = pg.Pool | pg.PoolClient;

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client: Queryable = pool(),
): Promise<T[]> {
  const res = await client.query<T>(text, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client: Queryable = pool(),
): Promise<T | null> {
  const rows = await q<T>(text, params, client);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Run fn only if no other process holds the named advisory lock (prevents overlapping syncs). */
export async function withAdvisoryLock<T>(name: string, fn: () => Promise<T>): Promise<T | 'locked'> {
  const client = await pool().connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>('select pg_try_advisory_lock(hashtext($1)) as ok', [name]);
    if (!rows[0]?.ok) return 'locked';
    try {
      return await fn();
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [name]);
    }
  } finally {
    client.release();
  }
}
