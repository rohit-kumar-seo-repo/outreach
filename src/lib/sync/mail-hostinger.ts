// Hostinger Email API provider (https://api.mail.hostinger.com). One bearer token covers
// every mailbox in one Hostinger email order; several tokens may be configured.
import { simpleParser } from 'mailparser';
import { env } from '../env';
import { normalizeEmail, normalizeMessageId } from '../normalize';
import { fetchJson } from './http';
import type { FolderInfo, HeaderMsg, MailProvider } from './mail-types';

interface ApiAddress {
  name: string;
  address: string;
}
interface ApiMessage {
  uid: number;
  path: string;
  date: string;
  flags: string[];
  unseen: boolean;
  size: number;
  subject: string | null;
  from: ApiAddress | null;
  to: ApiAddress[];
  cc: ApiAddress[];
  messageId: string | null;
  inReplyTo: string | null;
  attachments: { inline: boolean }[];
}
interface Page<T> {
  data: T[];
  pagination: { page: number; perPage: number; total: number; totalPages: number };
}

export interface HostingerMailboxRef {
  address: string;
  resourceId: string;
  token: string;
}

export async function discoverHostingerMailboxes(): Promise<{ found: HostingerMailboxRef[]; errors: string[] }> {
  const found: HostingerMailboxRef[] = [];
  const errors: string[] = [];
  for (const [i, token] of env.hostingerMailTokens.entries()) {
    try {
      const me = await fetchJson<{ data: { mailboxes: { resourceId: string; address: string }[] } }>(`${env.hostingerMailBaseUrl}/api/v1/me`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      });
      for (const mb of me.data.mailboxes ?? []) {
        found.push({ address: mb.address.toLowerCase(), resourceId: mb.resourceId, token });
      }
    } catch (err) {
      errors.push(`Hostinger token #${i + 1}: ${(err as Error).message}`);
    }
  }
  return { found, errors };
}

function toHeader(m: ApiMessage): HeaderMsg {
  return {
    uid: m.uid,
    messageId: normalizeMessageId(m.messageId),
    inReplyTo: normalizeMessageId(m.inReplyTo),
    references: [],
    from: m.from ? { name: m.from.name || null, address: normalizeEmail(m.from.address) } : null,
    to: (m.to ?? []).map((a) => normalizeEmail(a.address)).filter((a): a is string => !!a),
    cc: (m.cc ?? []).map((a) => normalizeEmail(a.address)).filter((a): a is string => !!a),
    subject: m.subject,
    date: m.date ? new Date(m.date) : null,
    flags: m.flags ?? [],
    unseen: !!m.unseen,
    size: m.size ?? null,
    hasAttachments: (m.attachments ?? []).some((a) => !a.inline),
  };
}

export class HostingerProvider implements MailProvider {
  readonly kind = 'hostinger_api' as const;
  constructor(
    readonly address: string,
    private readonly ref: HostingerMailboxRef,
  ) {}

  private url(path: string, query: Record<string, string | number> = {}): string {
    const u = new URL(`${env.hostingerMailBaseUrl}/api/v1/mailboxes/${encodeURIComponent(this.ref.resourceId)}${path}`);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, String(v));
    return u.toString();
  }

  private get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    return fetchJson<T>(this.url(path, query), { headers: { authorization: `Bearer ${this.ref.token}`, accept: 'application/json' } });
  }

  async listFolders(): Promise<FolderInfo[]> {
    const out: FolderInfo[] = [];
    for (let page = 1; page <= 10; page++) {
      const res = await this.get<Page<{ path: string; name: string; specialUse: string | null; messageCount: number; unreadCount: number }>>(
        '/folders',
        { page, perPage: 100 },
      );
      out.push(...res.data.map((f) => ({ path: f.path, name: f.name, specialUse: f.specialUse, messageCount: f.messageCount, unreadCount: f.unreadCount })));
      if (page >= res.pagination.totalPages) break;
    }
    return out;
  }

  async fetchHeaders(folder: string, afterUid: number, since: Date, max: number): Promise<HeaderMsg[]> {
    const out: HeaderMsg[] = [];
    for (let page = 1; out.length < max; page++) {
      const res = await this.get<Page<ApiMessage>>(`/folders/${encodeURIComponent(folder)}/messages`, { page, perPage: 100, sort: '-uid' });
      let done = res.data.length === 0;
      for (const m of res.data) {
        if (m.uid <= afterUid) {
          done = true;
          break;
        }
        const h = toHeader(m);
        if (afterUid === 0 && h.date && h.date < since) {
          done = true;
          break;
        }
        out.push(h);
      }
      if (done || page >= res.pagination.totalPages) break;
    }
    return out;
  }

  async recentFlags(folder: string, limit: number): Promise<{ uid: number; flags: string[]; unseen: boolean }[]> {
    const res = await this.get<Page<ApiMessage>>(`/folders/${encodeURIComponent(folder)}/messages`, { page: 1, perPage: Math.min(limit, 100), sort: '-uid' });
    return res.data.map((m) => ({ uid: m.uid, flags: m.flags ?? [], unseen: !!m.unseen }));
  }

  /**
   * Parsed from the raw source rather than the API's /text endpoint, which marks the
   * message \Seen: opening a message in the dashboard must not change the mailbox.
   */
  async fetchBody(folder: string, uid: number): Promise<{ text: string; html: string }> {
    const parsed = await simpleParser(await this.fetchSource(folder, uid));
    return { text: parsed.text ?? '', html: typeof parsed.html === 'string' ? parsed.html : '' };
  }

  async fetchSource(folder: string, uid: number): Promise<string> {
    const res = await fetch(this.url(`/folders/${encodeURIComponent(folder)}/messages/${uid}/source`), {
      headers: { authorization: `Bearer ${this.ref.token}`, accept: 'message/rfc822, text/plain, application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching message source`);
    const ct = res.headers.get('content-type') ?? '';
    const body = await res.text();
    if (ct.includes('application/json')) {
      try {
        const j = JSON.parse(body) as { data?: { source?: string } | string };
        if (typeof j.data === 'string') return j.data;
        if (j.data && typeof j.data.source === 'string') return j.data.source;
      } catch {
        /* fall through to raw body */
      }
    }
    return body;
  }

  async close(): Promise<void> {}
}
