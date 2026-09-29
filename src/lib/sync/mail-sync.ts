import { env } from '../env';
import { one, q } from '../db';
import { prefetchBodies } from '../mail/body';
import { recordIntegrationError, resolveIntegrationErrors } from '../errors';
import { normalizeSubject } from '../normalize';
import { classifyInbound, parseBounce } from './bounce';
import { discoverHostingerMailboxes, HostingerProvider } from './mail-hostinger';
import { ImapProvider } from './mail-imap';
import type { HeaderMsg, MailProvider } from './mail-types';
import { runMatching } from './matching';
import { finishRun, startRun } from './runs';

const SKIP_FOLDER = /(^|[./])(drafts?|templates)$/i;

export function subjectThreadKey(counterpart: string | null, subject: string | null): string {
  return `s:${counterpart ?? 'unknown'}|${normalizeSubject(subject)}`;
}

async function storeHeaders(mailboxId: number, address: string, folder: string, specialUse: string | null, headers: HeaderMsg[]): Promise<number> {
  let n = 0;
  for (const h of headers) {
    const fromAddr = h.from?.address ?? null;
    const outbound = fromAddr === address || specialUse === '\\Sent' || /(^|\.)sent( items| mail)?$/i.test(folder);
    const counterpart = outbound ? (h.to.find((a) => a !== address) ?? h.to[0] ?? null) : fromAddr;
    const kind = outbound ? 'message' : classifyInbound(fromAddr, h.from?.name ?? null, h.subject);
    await q(
      `insert into mail_messages (mailbox_id, folder, uid, message_id, in_reply_to, references_ids, thread_key, direction, from_addr, from_name,
          to_addrs, cc_addrs, counterpart, subject, sent_at, flags, unseen, size, has_attachments, kind)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       on conflict (mailbox_id, folder, uid) do update set flags = excluded.flags, unseen = excluded.unseen,
          message_id = coalesce(mail_messages.message_id, excluded.message_id), synced_at = now(), gone_from_server = false`,
      [
        mailboxId,
        folder,
        h.uid,
        h.messageId,
        h.inReplyTo,
        h.references,
        subjectThreadKey(counterpart, h.subject),
        outbound ? 'outbound' : 'inbound',
        fromAddr,
        h.from?.name ?? null,
        h.to,
        h.cc,
        counterpart,
        h.subject?.slice(0, 998) ?? null,
        h.date,
        h.flags,
        h.unseen,
        h.size,
        h.hasAttachments,
        kind,
      ],
    );
    n++;
  }
  return n;
}

async function parsePendingBounces(provider: MailProvider, mailboxId: number): Promise<void> {
  const pending = await q<{ id: number; folder: string; uid: number; sent_at: Date | null }>(
    `select m.id, m.folder, m.uid, m.sent_at from mail_messages m
      where m.mailbox_id = $1 and m.kind = 'bounce' and m.body_fetched_at is null
      order by m.sent_at desc nulls last limit 50`,
    [mailboxId],
  );
  for (const b of pending) {
    try {
      const source = await provider.fetchSource(b.folder, b.uid);
      const info = await parseBounce(source);
      await q('update mail_messages set body_text = $2, body_fetched_at = now() where id = $1', [b.id, info.text]);
      for (const r of info.recipients) {
        await q(
          `insert into bounces (mail_message_id, recipient_norm, bounce_type, status_code, diagnostic, occurred_at, send_attempt_id)
           values ($1,$2,$3,$4,$5,$6,(select id from send_attempts where message_id = $7 limit 1))
           on conflict (mail_message_id) do nothing`,
          [b.id, r.email, r.type, r.status, r.diagnostic?.slice(0, 1000) ?? null, b.sent_at ?? new Date(), info.originalMessageId],
        );
      }
      if (info.recipients.length === 0) {
        await recordIntegrationError(`mailbox:${mailboxId}:bounce-parse`, 'A bounce message was found but no failed recipient could be parsed from it.', { messageRow: b.id }, 'warning');
      }
    } catch (err) {
      await recordIntegrationError(`mailbox:${mailboxId}:bounce-parse`, `Could not read a bounce message: ${(err as Error).message}`, { messageRow: b.id }, 'warning');
    }
  }
}

async function syncOneMailbox(mailboxId: number, provider: MailProvider): Promise<number> {
  const since = new Date(Date.now() - env.mailInitialDays * 86400_000);
  let written = 0;
  const folders = await provider.listFolders();
  for (const f of folders) {
    await q(
      `insert into mail_folders (mailbox_id, path, name, special_use, message_count, unread_count)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (mailbox_id, path) do update set name = excluded.name, special_use = excluded.special_use,
         message_count = excluded.message_count, unread_count = excluded.unread_count`,
      [mailboxId, f.path, f.name, f.specialUse, f.messageCount, f.unreadCount],
    );
  }
  for (const f of folders) {
    if (f.specialUse === '\\Drafts' || SKIP_FOLDER.test(f.path)) continue;
    const state = await one<{ last_uid: number }>('select last_uid from mail_folders where mailbox_id = $1 and path = $2', [mailboxId, f.path]);
    let afterUid = state?.last_uid ?? 0;
    let headers = await provider.fetchHeaders(f.path, afterUid, since, env.mailMaxPerFolder);
    if (headers.length === 0 && afterUid > 0 && (f.messageCount ?? 0) > 0) {
      // UIDs restarted (folder recreated on the server): resync from scratch.
      const newest = (await provider.recentFlags(f.path, 1))[0];
      if (newest && newest.uid < afterUid) {
        afterUid = 0;
        headers = await provider.fetchHeaders(f.path, 0, since, env.mailMaxPerFolder);
      }
    }
    written += await storeHeaders(mailboxId, provider.address, f.path, f.specialUse, headers);
    const maxUid = headers.reduce((m, h) => Math.max(m, h.uid), afterUid);
    await q('update mail_folders set last_uid = $3, last_sync_at = now() where mailbox_id = $1 and path = $2', [mailboxId, f.path, maxUid]);
    // Refresh read/unread for the newest messages (flags change after the first sync).
    if (afterUid > 0) {
      for (const fl of await provider.recentFlags(f.path, 100)) {
        await q('update mail_messages set flags = $4, unseen = $5 where mailbox_id = $1 and folder = $2 and uid = $3', [mailboxId, f.path, fl.uid, fl.flags, fl.unseen]);
      }
    }
  }
  await parsePendingBounces(provider, mailboxId);
  await prefetchBodies(provider, mailboxId);
  return written;
}

export async function providerFor(address: string): Promise<MailProvider | null> {
  const { found } = await discoverHostingerMailboxes();
  const ref = found.find((m) => m.address === address);
  if (ref) return new HostingerProvider(address, ref);
  const imap = env.imapAccounts.find((a) => a.address === address);
  return imap ? new ImapProvider(address, imap) : null;
}

export async function syncMailboxes(): Promise<void> {
  const runId = await startRun('mailboxes', 'mailboxes');
  const { found, errors } = await discoverHostingerMailboxes();
  for (const e of errors) await recordIntegrationError('mailboxes:hostinger-token', e);
  if (errors.length === 0) await resolveIntegrationErrors('mailboxes:hostinger-token');
  // Mailboxes the token can see but the registry does not list are still synced (inbox coverage).
  for (const m of found) {
    await q(`insert into mailboxes (address, domain) values ($1, split_part($1,'@',2)) on conflict (address) do nothing`, [m.address]);
  }
  const imap = new Map(env.imapAccounts.map((a) => [a.address, a]));
  const boxes = await q<{ id: number; address: string; sync_enabled: boolean }>('select id, address, sync_enabled from mailboxes order by address');
  let written = 0;
  let ok = 0;
  let failed = 0;
  let notConnected = 0;
  for (const box of boxes) {
    const ref = found.find((m) => m.address === box.address);
    const acct = imap.get(box.address);
    if (!box.sync_enabled) continue;
    if (!ref && !acct) {
      notConnected++;
      await q(
        `update mailboxes set provider = 'none', last_status = 'not_connected',
           last_error = 'Not connected: no Hostinger Email API token covers this mailbox and no IMAP credentials are configured.' where id = $1`,
        [box.id],
      );
      continue;
    }
    const provider: MailProvider = ref ? new HostingerProvider(box.address, ref) : new ImapProvider(box.address, acct!);
    await q('update mailboxes set provider = $2, provider_ref = $3, last_sync_at = now() where id = $1', [box.id, provider.kind, ref?.resourceId ?? null]);
    try {
      written += await syncOneMailbox(box.id, provider);
      ok++;
      await q(`update mailboxes set last_status = 'ok', last_error = null, last_success_at = now() where id = $1`, [box.id]);
      await resolveIntegrationErrors(`mailbox:${box.address}`);
    } catch (err) {
      failed++;
      const msg = (err as Error).message;
      await q(`update mailboxes set last_status = 'error', last_error = $2 where id = $1`, [box.id, msg.slice(0, 1000)]);
      await recordIntegrationError(`mailbox:${box.address}`, `${box.address}: ${msg}`);
    } finally {
      await provider.close();
    }
  }
  try {
    await runMatching();
  } catch (err) {
    await recordIntegrationError('matching', `Reply/bounce matching failed: ${(err as Error).message}`);
  }
  const status = ok === 0 && failed === 0 ? 'skipped' : failed === 0 ? 'success' : ok > 0 ? 'partial' : 'error';
  await finishRun(runId, status, { seen: boxes.length, written }, failed ? `${failed} mailbox(es) failed` : ok === 0 ? 'No mailbox credentials configured' : null, {
    ok,
    failed,
    notConnected,
  });
}
