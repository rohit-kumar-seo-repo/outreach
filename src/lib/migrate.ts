import fs from 'node:fs';
import path from 'node:path';
import { pool } from './db';

export function migrationsDir(): string {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(process.cwd(), 'db/migrations'),
    path.resolve(process.cwd(), '../db/migrations'),
  ].filter(Boolean) as string[];
  const found = candidates.find((d) => fs.existsSync(d));
  if (!found) throw new Error(`migrations directory not found (looked in ${candidates.join(', ')})`);
  return found;
}

export async function migrate(log: (m: string) => void = console.log): Promise<string[]> {
  const client = await pool().connect();
  const applied: string[] = [];
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', ['rks-migrate']);
    await client.query(
      'create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())',
    );
    const done = new Set((await client.query<{ version: string }>('select version from schema_migrations')).rows.map((r) => r.version));
    const dir = migrationsDir();
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations(version) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
        log(`[migrate] applied ${file}`);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
    }
    return applied;
  } finally {
    await client.query('select pg_advisory_unlock(hashtext($1))', ['rks-migrate']).catch(() => undefined);
    client.release();
  }
}
