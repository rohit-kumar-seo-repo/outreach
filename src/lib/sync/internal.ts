// Internal / automation mail: reports, alerts and tests exchanged with our own addresses.
// Such messages are labelled kind = 'internal' and such sends is_internal, so they never count
// as outreach replies or sends. The patterns are shared by Postgres (~*) and JavaScript.
import { env } from '../env';
import { q } from '../db';

/** Subjects of reports and alerts our own automations send (the digest, dashboard alerts, run pings). */
export const REPORT_SUBJECT = '^\\s*((re|fwd?)\\s*:\\s*)*(daily outreach summary|\\[outreach alert\\]|outreach (run|batch) (complete|finished|report)|outreach (daily |weekly )?report($|[^a-z]))';
/** Test messages: "Test", "test email", "Testing 2", "TEST - dispatcher"… but not "Test results for your site". */
export const TEST_SUBJECT = '^\\s*((re|fwd?)\\s*:\\s*)*test(ing)?( (email|message|mail|send))?\\s*($|[-:#(0-9!.])';

export function isInternalSubject(subject: string | null): boolean {
  const s = subject ?? '';
  return new RegExp(REPORT_SUBJECT, 'i').test(s) || new RegExp(TEST_SUBJECT, 'i').test(s);
}

/**
 * Internal addresses = our mailboxes, anything on our mailbox domains, the admin login address,
 * and whoever receives our automated reports (learned from the report subjects above).
 */
export async function classifyInternal(): Promise<void> {
  const params = [env.adminEmail ?? '', REPORT_SUBJECT, TEST_SUBJECT];
  const internal = `
    with own_domains as (select distinct domain from mailboxes),
         internal_addrs as (
           select address as a from mailboxes
           union select lower($1) where $1 <> ''
           union select distinct counterpart from mail_messages where direction = 'outbound' and counterpart is not null and subject ~* $2)`;
  await q(
    `${internal}
     update mail_messages m set kind = 'internal'
      where m.kind = 'message'
        and (m.counterpart in (select a from internal_addrs)
             or split_part(m.counterpart, '@', 2) in (select domain from own_domains)
             or ((m.subject ~* $2 or m.subject ~* $3)
                 and not exists (select 1 from send_attempts sa where sa.message_id is not null and sa.message_id = m.in_reply_to and not sa.is_internal)))`,
    params,
  );
  await q(
    `${internal}
     update send_attempts sa set is_internal = true, updated_at = now()
      where not sa.is_internal and sa.channel = 'email'
        and (sa.recipient_norm in (select a from internal_addrs) or split_part(sa.recipient_norm, '@', 2) in (select domain from own_domains))`,
    params.slice(0, 2),
  );
}
