import { one, q } from '../db';

const WINDOW_MIN = 15;
const MAX_FAILS_PER_IP = 10;
const MAX_FAILS_PER_EMAIL = 5;

export async function loginBlocked(ip: string | null, email: string): Promise<boolean> {
  const row = await one<{ by_ip: number; by_email: number }>(
    `select
       count(*) filter (where ip is not distinct from $1)::int as by_ip,
       count(*) filter (where email = $2)::int as by_email
     from login_attempts
     where success = false and at > now() - make_interval(mins => $3)`,
    [ip, email, WINDOW_MIN],
  );
  return (row?.by_ip ?? 0) >= MAX_FAILS_PER_IP || (row?.by_email ?? 0) >= MAX_FAILS_PER_EMAIL;
}

export async function recordLoginAttempt(ip: string | null, email: string, success: boolean): Promise<void> {
  await q('insert into login_attempts (ip, email, success) values ($1,$2,$3)', [ip, email, success]);
  if (success) {
    await q(`delete from login_attempts where email = $1 and success = false`, [email]);
  }
  await q(`delete from login_attempts where at < now() - interval '30 days'`);
}
