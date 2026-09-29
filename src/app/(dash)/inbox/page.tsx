import Link from 'next/link';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Bot, Flag, Paperclip } from 'lucide-react';
import { assignThread, loadBody, setSentiment, setThreadFollowup, unassignThread } from '@/app/actions/data';
import { StepLabel } from '@/components/status';
import { Card, EmptyState, fmt, Notice, PageHeader, Pill } from '@/components/ui';
import { one, q } from '@/lib/db';
import { campaignOptions, mailboxOptions } from '@/lib/metrics/campaigns';
import { folderOptions, leadSearch, listThreads, threadMessages, type ThreadQuery } from '@/lib/metrics/inbox';
import { formatDateTime, relativeTime } from '@/lib/time';

export const metadata = { title: 'Inbox' };

type SP = Record<string, string | undefined>;

const SENTIMENTS = [
  ['positive', 'Positive'],
  ['neutral', 'Neutral'],
  ['not_interested', 'Not interested'],
  ['unsubscribe', 'Unsubscribe request'],
  ['auto_reply', 'Auto-reply'],
] as const;

function href(sp: SP, patch: SP): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) u.set(k, v);
  return `/inbox?${u.toString()}`;
}

function emailDoc(html: string): string {
  // Rendered inside a sandboxed iframe (no scripts, no same-origin). Remote images are blocked
  // so opening an email never fires a sender's tracking pixel.
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:"><base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;color:#0f172a;margin:12px;word-break:break-word}img{max-width:100%}</style></head><body>${html}</body></html>`;
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const query: ThreadQuery = {
    mailbox: sp.mailbox ?? null,
    domain: sp.domain ?? null,
    folder: sp.folder ?? null,
    unread: sp.unread === '1',
    campaign: sp.campaign ?? null,
    lead: sp.lead ? Number(sp.lead) : null,
    match: sp.match === 'matched' || sp.match === 'unmatched' ? sp.match : 'all',
    kind: sp.kind === 'replies' || sp.kind === 'bounces' ? sp.kind : 'all',
    flagged: sp.flagged === '1',
    search: sp.q ?? null,
    page: Number(sp.page ?? 1) || 1,
  };
  const [threads, mailboxes, campaigns, folders, mailboxCount] = await Promise.all([
    listThreads(query),
    mailboxOptions(),
    campaignOptions(),
    folderOptions(sp.mailbox ?? null),
    one<{ connected: number; total: number }>(`select count(*) filter (where last_status = 'ok')::int as connected, count(*)::int as total from mailboxes`),
  ]);
  const thread = sp.thread ? await threadMessages(sp.thread) : [];
  const leadIds = [...new Set(thread.map((m) => m.leadId ?? m.suggestedLeadId).filter((x): x is number => !!x))];
  const leads = leadIds.length
    ? await q<{ id: number; name: string | null; email: string | null; campaign: string; slug: string; status: string }>(
        `select l.id, l.name, l.email_norm as email, c.name as campaign, c.slug, l.status from leads l join campaigns c on c.id = l.campaign_id where l.id = any($1)`,
        [leadIds],
      )
    : [];
  const matchedLead = leads.find((l) => thread.some((m) => m.leadId === l.id));
  const suggested = leads.find((l) => thread.some((m) => m.suggestedLeadId === l.id));
  const searchResults = sp.thread && sp.leadq ? await leadSearch(sp.leadq) : [];
  const flagged = thread.find((m) => m.needsFollowup);
  const domains = [...new Set(mailboxes.map((m) => m.domain))];

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle={`All connected mailboxes in one place · ${mailboxCount?.connected ?? 0} of ${mailboxCount?.total ?? 0} mailboxes connected`}
      />
      {(mailboxCount?.connected ?? 0) === 0 && (
        <div className="mb-4">
          <Notice tone="warn" title="No mailbox is connected yet">
            Add a Hostinger Email API token (HOSTINGER_MAIL_TOKENS) or IMAP credentials on the server. See Integrations for the exact steps.
          </Notice>
        </div>
      )}
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-2 px-3 py-3 text-[13px]">
        <select name="domain" defaultValue={sp.domain ?? ''} className="field" aria-label="Domain">
          <option value="">All domains</option>
          {domains.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select name="mailbox" defaultValue={sp.mailbox ?? ''} className="field" aria-label="Mailbox">
          <option value="">All mailboxes</option>
          {mailboxes.map((m) => (
            <option key={m.address}>{m.address}</option>
          ))}
        </select>
        <select name="folder" defaultValue={sp.folder ?? ''} className="field" aria-label="Folder">
          <option value="">All folders</option>
          {[...new Set(folders.map((f) => f.path))].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select name="campaign" defaultValue={sp.campaign ?? ''} className="field" aria-label="Campaign">
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="match" defaultValue={query.match} className="field" aria-label="Match">
          <option value="all">Matched + unmatched</option>
          <option value="matched">Matched to a lead</option>
          <option value="unmatched">Unmatched</option>
        </select>
        <select name="kind" defaultValue={query.kind} className="field" aria-label="Type">
          <option value="all">All messages</option>
          <option value="replies">Outreach replies</option>
          <option value="bounces">Bounces</option>
        </select>
        <label className="flex items-center gap-1.5 px-1">
          <input type="checkbox" name="unread" value="1" defaultChecked={query.unread} /> Unread
        </label>
        <label className="flex items-center gap-1.5 px-1">
          <input type="checkbox" name="flagged" value="1" defaultChecked={query.flagged} /> Needs follow-up
        </label>
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Search subject or sender" className="field min-w-48 flex-1" />
        <button className="btn btn-primary" type="submit">
          Apply
        </button>
        <Link className="btn" href="/inbox">
          Reset
        </Link>
      </form>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
        <Card title={`Conversations (${fmt(threads.total)})`} pad={false}>
          {threads.rows.length === 0 ? (
            <EmptyState title="No conversations match these filters" />
          ) : (
            <ul className="max-h-[72vh] divide-y divide-line overflow-y-auto">
              {threads.rows.map((t) => {
                const active = sp.thread === t.threadKey;
                return (
                  <li key={t.threadKey}>
                    <Link href={href(sp, { thread: t.threadKey, leadq: undefined })} className={`block px-4 py-3 hover:bg-slate-50 ${active ? 'bg-brand-50' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`truncate text-[13px] ${t.unread ? 'font-semibold text-ink' : 'text-ink'}`}>{t.fromName || t.counterpart || '(unknown)'}</span>
                        <span className="shrink-0 text-[11px] text-ink-3">{t.lastAt ? relativeTime(t.lastAt) : ''}</span>
                      </div>
                      <div className={`truncate text-[12.5px] ${t.unread ? 'font-medium text-ink' : 'text-ink-2'}`}>{t.subject || '(no subject)'}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {t.hasBounce ? <Pill tone="critical">Bounce</Pill> : null}
                        {t.leadId ? (
                          <Pill tone={t.hasReply ? 'good' : 'teal'}>{t.campaignName ?? 'Matched'}</Pill>
                        ) : t.kind === 'message' && t.direction === 'inbound' ? (
                          <Pill tone="warn">Unmatched</Pill>
                        ) : null}
                        {t.flagged ? (
                          <Pill tone="warn">
                            <Flag size={11} aria-hidden /> Follow up
                          </Pill>
                        ) : null}
                        {t.unread ? <Pill tone="brand">{t.unread} unread</Pill> : null}
                        <span className="truncate text-[11px] text-ink-3">
                          {t.mailbox} · {t.folder}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {threads.total > 50 && (
            <div className="flex justify-between border-t border-line px-4 py-2 text-xs">
              {query.page! > 1 ? <Link href={href(sp, { page: String(query.page! - 1) })} className="link">← Newer</Link> : <span />}
              {query.page! * 50 < threads.total ? <Link href={href(sp, { page: String(query.page! + 1) })} className="link">Older →</Link> : <span />}
            </div>
          )}
        </Card>

        <div>
          {thread.length === 0 ? (
            <Card>
              <EmptyState title="Select a conversation">Choose a conversation to see its full history, its lead and campaign, and to classify or assign it.</EmptyState>
            </Card>
          ) : (
            <div className="space-y-3">
              <Card
                title={thread.at(-1)?.subject || '(no subject)'}
                subtitle={`${thread.length} message${thread.length === 1 ? '' : 's'} · ${thread[0].mailbox}`}
                actions={
                  <form action={setThreadFollowup} className="flex flex-wrap items-center gap-1.5">
                    <input type="hidden" name="thread" value={sp.thread} />
                    {flagged ? (
                      <>
                        <span className="text-xs text-warn">
                          <Flag size={12} className="inline" aria-hidden /> Follow up{flagged.followupDueAt ? ` by ${formatDateTime(flagged.followupDueAt)}` : ''}
                        </span>
                        <button className="btn btn-sm" name="clear" value="1">
                          Clear
                        </button>
                      </>
                    ) : (
                      <>
                        <input type="date" name="due" className="field py-0.5 text-xs" aria-label="Follow-up date" />
                        <input name="note" placeholder="Note" className="field w-32 py-0.5 text-xs" />
                        <button className="btn btn-sm">
                          <Flag size={12} aria-hidden /> Needs follow-up
                        </button>
                      </>
                    )}
                  </form>
                }
              >
                {matchedLead ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                    <div>
                      Linked to{' '}
                      <Link href={`/leads/${matchedLead.id}`} className="link font-medium">
                        {matchedLead.name ?? matchedLead.email}
                      </Link>{' '}
                      in{' '}
                      <Link href={`/campaigns/${matchedLead.slug}`} className="link">
                        {matchedLead.campaign}
                      </Link>
                      <span className="ml-2 text-xs text-ink-3">
                        matched by {thread.find((m) => m.leadId)?.matchMethod?.replaceAll('_', ' ')} ({thread.find((m) => m.leadId)?.matchConfidence ?? '—'} confidence)
                      </span>
                    </div>
                    <form action={unassignThread}>
                      <input type="hidden" name="thread" value={sp.thread} />
                      <button className="btn btn-sm">Not outreach — unlink</button>
                    </form>
                  </div>
                ) : (
                  <div className="space-y-2 text-[13px]">
                    <div className="flex items-center gap-2">
                      <Pill tone="warn">Unmatched</Pill>
                      <span className="text-ink-2">This conversation could not be reliably matched to a lead or campaign. It is not counted as a reply.</span>
                    </div>
                    {suggested && (
                      <form action={assignThread} className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 px-3 py-2">
                        <input type="hidden" name="thread" value={sp.thread} />
                        <input type="hidden" name="leadId" value={suggested.id} />
                        <span>
                          Possible match (same company domain): <b>{suggested.name ?? suggested.email}</b> · {suggested.campaign}
                        </span>
                        <button className="btn btn-sm btn-primary">Assign</button>
                      </form>
                    )}
                    <form method="get" className="flex flex-wrap items-center gap-2">
                      {Object.entries(sp)
                        .filter(([k]) => k !== 'leadq')
                        .map(([k, v]) => (
                          <input key={k} type="hidden" name={k} value={v} />
                        ))}
                      <input name="leadq" defaultValue={sp.leadq ?? ''} placeholder="Find lead by name, email or ID" className="field min-w-64" />
                      <button className="btn btn-sm">Search leads</button>
                    </form>
                    {searchResults.length > 0 && (
                      <ul className="divide-y divide-line rounded-md border border-line">
                        {searchResults.map((r) => (
                          <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                            <span>
                              {r.name ?? '(no name)'} <span className="text-ink-3">{r.email}</span> · <span className="text-ink-2">{r.campaignName}</span>
                            </span>
                            <form action={assignThread}>
                              <input type="hidden" name="thread" value={sp.thread} />
                              <input type="hidden" name="leadId" value={r.id} />
                              <button className="btn btn-sm btn-primary">Assign</button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    )}
                    {sp.leadq && searchResults.length === 0 && <p className="text-xs text-ink-3">No leads found for &ldquo;{sp.leadq}&rdquo;.</p>}
                  </div>
                )}
              </Card>

              {thread.map((m) => (
                <article key={m.id} className={`card ${m.direction === 'outbound' ? 'border-l-4 border-l-brand' : m.kind === 'bounce' ? 'border-l-4 border-l-critical' : ''}`}>
                  <header className="flex flex-col gap-1 border-b border-line px-4 py-2.5 text-[12.5px] sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0 break-words">
                      <div className="flex items-center gap-1.5 font-medium text-ink">
                        {m.direction === 'outbound' ? <ArrowUpRight size={14} className="text-brand" aria-label="Sent" /> : <ArrowDownLeft size={14} className="text-good-text" aria-label="Received" />}
                        {m.fromName ? `${m.fromName} <${m.fromAddr}>` : m.fromAddr}
                      </div>
                      <div className="text-ink-3">to {m.toAddrs.join(', ')}</div>
                    </div>
                    <div className="shrink-0 text-ink-3 sm:text-right">
                      <div>{formatDateTime(m.sentAt)}</div>
                      <div>
                        {m.mailbox} · {m.folder}
                      </div>
                    </div>
                  </header>
                  <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2">
                    {m.kind === 'bounce' && (
                      <Pill tone="critical">
                        <AlertTriangle size={11} aria-hidden /> Bounce report
                      </Pill>
                    )}
                    {m.kind === 'auto_reply' && (
                      <Pill>
                        <Bot size={11} aria-hidden /> Auto-reply (not counted as a reply)
                      </Pill>
                    )}
                    {m.direction === 'outbound' && m.sendAttemptId && (
                      <Pill tone="teal">
                        Outreach send · <StepLabel step={m.step ?? 0} />
                      </Pill>
                    )}
                    {m.hasAttachments && (
                      <Pill>
                        <Paperclip size={11} aria-hidden /> Attachment
                      </Pill>
                    )}
                    {m.unseen && m.direction === 'inbound' && <Pill tone="brand">Unread</Pill>}
                  </div>
                  <div className="px-4 py-3">
                    {m.bodyHtml ? (
                      <iframe title={`Message ${m.id}`} sandbox="" srcDoc={emailDoc(m.bodyHtml)} className="h-72 w-full rounded border border-line bg-white" />
                    ) : m.bodyText ? (
                      <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-sans text-[13px] text-ink">{m.bodyText}</pre>
                    ) : (
                      <form action={loadBody} className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                        <input type="hidden" name="messageId" value={m.id} />
                        <span>Only headers are synced. Loading the body marks the message as read in the mailbox.</span>
                        <button className="btn btn-sm">Load message</button>
                      </form>
                    )}
                  </div>
                  {m.direction === 'inbound' && m.kind !== 'bounce' && (
                    <footer className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-2 text-xs">
                      <span className="mr-1 text-ink-3">Classify reply:</span>
                      {SENTIMENTS.map(([value, label]) => (
                        <form key={value} action={setSentiment}>
                          <input type="hidden" name="messageId" value={m.id} />
                          <input type="hidden" name="sentiment" value={m.sentiment === value ? '' : value} />
                          <button className={`btn btn-sm ${m.sentiment === value ? 'btn-primary' : ''}`} aria-pressed={m.sentiment === value}>
                            {label}
                          </button>
                        </form>
                      ))}
                    </footer>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
