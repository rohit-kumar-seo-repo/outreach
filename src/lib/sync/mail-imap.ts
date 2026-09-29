// IMAP provider for mailboxes that have no Hostinger Email API token (e.g. other plans).
// Every folder is opened read-only (EXAMINE) and bodies are fetched with BODY.PEEK, so the
// dashboard never changes read/unread state on the server.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { ImapAccount } from '../env';
import { normalizeEmail, normalizeMessageId, parseReferences } from '../normalize';
import type { FolderInfo, HeaderMsg, MailProvider } from './mail-types';

export class ImapProvider implements MailProvider {
  readonly kind = 'imap' as const;
  private client: ImapFlow | null = null;
  constructor(
    readonly address: string,
    private readonly account: ImapAccount,
  ) {}

  private async conn(): Promise<ImapFlow> {
    if (this.client) return this.client;
    const c = new ImapFlow({
      host: this.account.host,
      port: this.account.port,
      secure: this.account.secure,
      auth: { user: this.account.user, pass: this.account.password },
      logger: false,
      socketTimeout: 60_000,
    });
    await c.connect();
    this.client = c;
    return c;
  }

  async listFolders(): Promise<FolderInfo[]> {
    const c = await this.conn();
    const boxes = await c.list({ statusQuery: { messages: true, unseen: true } });
    return boxes
      .filter((b) => !b.flags?.has('\\Noselect'))
      .map((b) => ({
        path: b.path,
        name: b.name,
        specialUse: b.specialUse ?? null,
        messageCount: b.status?.messages ?? null,
        unreadCount: b.status?.unseen ?? null,
      }));
  }

  async fetchHeaders(folder: string, afterUid: number, since: Date, max: number): Promise<HeaderMsg[]> {
    const c = await this.conn();
    const lock = await c.getMailboxLock(folder, { readOnly: true });
    try {
      const criteria = afterUid > 0 ? { uid: `${afterUid + 1}:*` } : { since };
      const uids = ((await c.search(criteria, { uid: true })) || []).filter((u) => u > afterUid).sort((a, b) => b - a).slice(0, max);
      if (uids.length === 0) return [];
      const out: HeaderMsg[] = [];
      for await (const msg of c.fetch(
        uids.join(','),
        { uid: true, envelope: true, flags: true, size: true, bodyStructure: true, headers: ['references', 'in-reply-to'] },
        { uid: true },
      )) {
        const env = msg.envelope;
        const hdr = msg.headers ? msg.headers.toString('utf8') : '';
        const refs = parseReferences(hdr.match(/^references:\s*([\s\S]*?)(?:\r?\n\S|$)/im)?.[1] ?? '');
        const flags = Array.from(msg.flags ?? []);
        const structure = JSON.stringify(msg.bodyStructure ?? {});
        out.push({
          uid: msg.uid,
          messageId: normalizeMessageId(env?.messageId),
          inReplyTo: normalizeMessageId(env?.inReplyTo),
          references: refs,
          from: env?.from?.[0] ? { name: env.from[0].name || null, address: normalizeEmail(env.from[0].address) } : null,
          to: (env?.to ?? []).map((a) => normalizeEmail(a.address)).filter((a): a is string => !!a),
          cc: (env?.cc ?? []).map((a) => normalizeEmail(a.address)).filter((a): a is string => !!a),
          subject: env?.subject ?? null,
          date: env?.date ? new Date(env.date) : null,
          flags,
          unseen: !flags.includes('\\Seen'),
          size: msg.size ?? null,
          hasAttachments: /"disposition":"attachment"/i.test(structure),
        });
      }
      return out.sort((a, b) => b.uid - a.uid);
    } finally {
      lock.release();
    }
  }

  async recentFlags(folder: string, limit: number): Promise<{ uid: number; flags: string[]; unseen: boolean }[]> {
    const c = await this.conn();
    const lock = await c.getMailboxLock(folder, { readOnly: true });
    try {
      const status = c.mailbox && typeof c.mailbox === 'object' ? c.mailbox.exists : 0;
      if (!status) return [];
      const start = Math.max(1, status - limit + 1);
      const out: { uid: number; flags: string[]; unseen: boolean }[] = [];
      for await (const msg of c.fetch(`${start}:*`, { uid: true, flags: true })) {
        const flags = Array.from(msg.flags ?? []);
        out.push({ uid: msg.uid, flags, unseen: !flags.includes('\\Seen') });
      }
      return out;
    } finally {
      lock.release();
    }
  }

  async fetchSource(folder: string, uid: number): Promise<string> {
    const c = await this.conn();
    const lock = await c.getMailboxLock(folder, { readOnly: true });
    try {
      const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
      return msg && msg.source ? msg.source.toString('utf8') : '';
    } finally {
      lock.release();
    }
  }

  async fetchBody(folder: string, uid: number): Promise<{ text: string; html: string }> {
    const source = await this.fetchSource(folder, uid);
    const parsed = await simpleParser(source);
    return { text: parsed.text ?? '', html: typeof parsed.html === 'string' ? parsed.html : '' };
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.logout().catch(() => undefined);
      this.client = null;
    }
  }
}
