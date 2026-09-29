// Loading message bodies without changing the mailbox's read state.
// IMAP uses BODY.PEEK. The Hostinger API's /source endpoint is not documented to set \Seen (its /text
// endpoint is), but for unread messages we check the flag afterwards anyway: if the server marked the
// message read, the flag is restored and the behaviour is remembered. If restoring ever fails, unread
// bodies are no longer loaded automatically and the inbox asks before loading one.
import { one, q } from '../db';
import { recordIntegrationError } from '../errors';
import type { MailProvider } from '../sync/mail-types';

export interface BodyPolicy {
  /** The provider was seen marking messages read when their body was fetched. */
  marksRead: boolean;
  /** …and putting the unread flag back failed, so unread bodies need an explicit click. */
  askBeforeUnread: boolean;
}

export async function bodyPolicy(): Promise<BodyPolicy> {
  const row = await one<{ value: Partial<BodyPolicy> }>(`select value from app_state where key = 'mail_body_policy'`);
  return { marksRead: !!row?.value.marksRead, askBeforeUnread: !!row?.value.askBeforeUnread };
}

async function savePolicy(patch: Partial<BodyPolicy>): Promise<void> {
  await q(
    `insert into app_state (key, value) values ('mail_body_policy', $1::jsonb)
     on conflict (key) do update set value = app_state.value || excluded.value, updated_at = now()`,
    [JSON.stringify(patch)],
  );
}

export interface BodyTarget {
  id: number;
  folder: string;
  uid: number;
  unseen: boolean;
}

/** Fetches and stores the body. Returns false when the unread flag was lost and could not be restored. */
export async function loadBody(provider: MailProvider, m: BodyTarget): Promise<boolean> {
  const body = await provider.fetchBody(m.folder, m.uid);
  await q(`update mail_messages set body_text = $2, body_html = $3, body_fetched_at = now() where id = $1`, [
    m.id,
    body.text.slice(0, 200_000),
    body.html.slice(0, 500_000),
  ]);
  if (!m.unseen || !provider.isUnseen || !provider.markUnseen) return true;
  if (await provider.isUnseen(m.folder, m.uid)) return true;
  await savePolicy({ marksRead: true });
  try {
    await provider.markUnseen(m.folder, m.uid);
    return true;
  } catch (err) {
    await savePolicy({ askBeforeUnread: true });
    await recordIntegrationError(
      `mailbox:${provider.address}:unread`,
      `Loading a message marked it read in ${provider.address} and the unread flag could not be restored: ${(err as Error).message}`,
      { messageRow: m.id },
      'warning',
    );
    return false;
  }
}

/**
 * Prefetches bodies of recent conversation mail so the inbox can show snippets and open threads
 * instantly: inbound human/internal mail and our own replies from the last 21 days, not spam or trash.
 */
export async function prefetchBodies(provider: MailProvider, mailboxId: number, limit = 40): Promise<void> {
  const policy = await bodyPolicy();
  const rows = await q<BodyTarget>(
    `select id, folder, uid, unseen from mail_messages
      where mailbox_id = $1 and body_fetched_at is null and sent_at > now() - interval '21 days'
        and folder !~* '(^|[./])(spam|junk|trash|deleted)'
        and ((direction = 'inbound' and kind in ('message', 'internal', 'auto_reply'))
             or (direction = 'outbound' and send_attempt_id is null and in_reply_to is not null))
        and ($2::boolean = false or not unseen)
      order by sent_at desc limit $3`,
    [mailboxId, policy.askBeforeUnread, limit],
  );
  for (const r of rows) {
    try {
      if (!(await loadBody(provider, r))) break;
    } catch (err) {
      await recordIntegrationError(`mailbox:${provider.address}:bodies`, `Could not load a message body: ${(err as Error).message}`, { messageRow: r.id }, 'warning');
      break;
    }
  }
}
