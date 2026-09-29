import fs from 'node:fs';
import path from 'node:path';
import { addSuppression, removeSuppression, signOutEverywhere } from '@/app/actions/data';
import { Card, EmptyState, Notice, PageHeader, Pill } from '@/components/ui';
import { q } from '@/lib/db';
import { env } from '@/lib/env';
import { formatDateTime } from '@/lib/time';

export const metadata = { title: 'Settings' };

function backups(): { name: string; size: number; at: Date }[] | null {
  const dir = process.env.BACKUP_DIR ?? '/backups';
  try {
    return fs
      .readdirSync(/*turbopackIgnore: true*/ dir)
      .filter((f) => f.endsWith('.dump'))
      .map((f) => {
        const st = fs.statSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, f));
        return { name: f, size: st.size, at: st.mtime };
      })
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 10);
  } catch {
    return null;
  }
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [supp, sessions, audit] = await Promise.all([
    q<{ id: number; channel: string; value_norm: string; reason: string; source: string; note: string | null; created_at: Date }>(
      `select id, channel, value_norm, reason, source, note, created_at from suppressions
        where $1::text is null or value_norm ilike '%' || $1 || '%' order by created_at desc limit 200`,
      [sp.sq ?? null],
    ),
    q<{ created_at: Date; last_seen_at: Date; ip: string | null; user_agent: string | null }>(
      `select created_at, last_seen_at, ip, user_agent from sessions where revoked_at is null and expires_at > now() order by last_seen_at desc limit 20`,
    ),
    q<{ at: Date; actor: string; action: string; target: string | null }>(`select at, actor, action, target from audit_log order by at desc limit 40`),
  ]);
  const files = backups();
  return (
    <>
      <PageHeader title="Settings" subtitle="Suppression list, security and backups." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Suppression list" subtitle="Unsubscribed, do-not-contact and hard-bounced contacts. Leads on this list show as Unsubscribed/Bounced and are flagged if re-queued.">
          <form action={addSuppression} className="mb-3 flex flex-wrap gap-2 text-[13px]">
            <select name="channel" className="field" aria-label="Channel">
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp number</option>
            </select>
            <input name="value" required placeholder="address@example.com or phone" className="field min-w-56 flex-1" />
            <select name="reason" className="field" aria-label="Reason">
              <option value="do_not_contact">Do not contact</option>
              <option value="unsubscribed">Unsubscribed</option>
              <option value="complaint">Complaint</option>
            </select>
            <input name="note" placeholder="Note (optional)" className="field" />
            <button className="btn btn-primary">Add</button>
          </form>
          <Notice>
            The dashboard never sends messages, so it cannot stop an n8n workflow by itself. Suppressed leads that are still Approved / Drafted in a sheet are listed as
            “Unsubscribed” on the Leads page; change their sheet status so the workflow skips them.
          </Notice>
          <form method="get" className="mt-3 flex gap-2">
            <input name="sq" defaultValue={sp.sq ?? ''} placeholder="Search list" className="field flex-1" />
            <button className="btn">Search</button>
          </form>
          {supp.length === 0 ? (
            <EmptyState title="Suppression list is empty" />
          ) : (
            <table className="table-compact mt-3 w-full">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Reason</th>
                  <th>Added</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {supp.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.value_norm}
                      <div className="text-[11px] text-ink-3">{s.channel}</div>
                    </td>
                    <td>
                      <Pill tone={s.reason === 'hard_bounce' ? 'critical' : 'warn'}>{s.reason.replace('_', ' ')}</Pill>
                      {s.note && <div className="mt-0.5 text-[11px] text-ink-3">{s.note}</div>}
                    </td>
                    <td className="whitespace-nowrap text-[12px] text-ink-2">
                      {formatDateTime(s.created_at)}
                      <div className="text-ink-3">{s.source}</div>
                    </td>
                    <td>
                      <form action={removeSuppression}>
                        <input type="hidden" name="id" value={s.id} />
                        <button className="btn btn-sm">Remove</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Security">
            <ul className="space-y-1.5 text-[13px]">
              <li>
                Two-factor login: {env.totpSecret ? <Pill tone="good">On</Pill> : <Pill tone="warn">Off — run npm run totp-setup and set ADMIN_TOTP_SECRET</Pill>}
              </li>
              <li>Session lifetime: {env.sessionTtlHours} hours · cookies are HttpOnly, Secure, SameSite=Lax</li>
              <li>Login rate limit: 5 failures per address / 10 per IP per 15 minutes</li>
            </ul>
            <h3 className="mt-4 text-[13px] font-semibold">Active sessions ({sessions.length})</h3>
            <ul className="mt-1 space-y-1 text-[12px] text-ink-2">
              {sessions.map((s, i) => (
                <li key={i}>
                  {s.ip ?? 'unknown IP'} · last seen {formatDateTime(s.last_seen_at)} · {s.user_agent?.slice(0, 60)}
                </li>
              ))}
            </ul>
            <form action={signOutEverywhere} className="mt-3">
              <button className="btn btn-sm">Sign out all sessions</button>
            </form>
          </Card>
          <Card title="Backups" subtitle="Nightly pg_dump by the backup container (14-day retention)">
            {files === null ? (
              <p className="text-[13px] text-ink-3">Backup folder is not mounted into this container.</p>
            ) : files.length === 0 ? (
              <p className="text-[13px] text-ink-3">No backups yet. The first one runs at 02:30 dashboard time.</p>
            ) : (
              <ul className="space-y-1 text-[12.5px]">
                {files.map((f) => (
                  <li key={f.name} className="flex justify-between gap-2">
                    <span>{f.name}</span>
                    <span className="text-ink-3">
                      {(f.size / 1024 / 1024).toFixed(1)} MB · {formatDateTime(f.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Audit log" subtitle="Latest 40 actions">
            <ul className="max-h-72 space-y-1 overflow-y-auto text-[12px] text-ink-2">
              {audit.map((a, i) => (
                <li key={i}>
                  {formatDateTime(a.at)} · {a.action}
                  {a.target ? ` · ${a.target.slice(0, 60)}` : ''}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
