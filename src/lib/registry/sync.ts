import { q, tx } from '../db';
import { registry } from './index';

/** Upsert campaigns, sources and known mailboxes from config/registry.json. Idempotent. */
export async function syncRegistry(): Promise<void> {
  const reg = registry();
  await tx(async (c) => {
    for (const camp of reg.campaigns) {
      await q(
        `insert into campaigns (slug, name, channel, brand, description, config)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (slug) do update set name = excluded.name, channel = excluded.channel, brand = excluded.brand,
           description = excluded.description, config = excluded.config, updated_at = now()`,
        [camp.slug, camp.name, camp.channel, camp.brand, camp.description ?? null, JSON.stringify(camp)],
        c,
      );
    }
    for (const src of reg.sources) {
      const campaignSlug = typeof src.campaign === 'string' ? src.campaign : src.campaign.default;
      await q(
        `insert into sources (key, kind, name, campaign_id, config)
         values ($1,$2,$3,(select id from campaigns where slug = $4),$5)
         on conflict (key) do update set kind = excluded.kind, name = excluded.name,
           campaign_id = excluded.campaign_id, config = excluded.config`,
        [src.key, src.kind, src.name, campaignSlug, JSON.stringify(src)],
        c,
      );
    }
    const fixed: [string, string, string][] = [
      ['n8n:executions', 'n8n_workflow', 'n8n execution history (send events)'],
      ['n8n:bridge', 'n8n_workflow', 'n8n Data Bridge (spreadsheets & data tables)'],
      ['n8n:workflows', 'n8n_workflow', 'n8n workflow scan (untracked senders)'],
      ['waha', 'waha', 'WhatsApp (WAHA)'],
      ['ingest:push', 'ingest', 'Push ingest endpoint (/api/ingest/n8n)'],
    ];
    for (const [key, kind, name] of fixed) {
      await q(
        `insert into sources (key, kind, name) values ($1,$2,$3) on conflict (key) do update set name = excluded.name`,
        [key, kind, name],
        c,
      );
    }
    for (const mb of reg.mailboxes) {
      const address = mb.address.toLowerCase();
      await q(
        `insert into mailboxes (address, domain, provider)
         values ($1, split_part($1,'@',2), 'none')
         on conflict (address) do nothing`,
        [address],
        c,
      );
    }
    // Retired addresses disappear from every mailbox list, filter and status panel. Their send
    // history stays (send_attempts keep the sender address; mailbox_id is cleared by the FK).
    const retired = reg.retiredMailboxes.map((a) => a.toLowerCase());
    if (retired.length) {
      await q(`delete from send_limits where scope = 'mailbox' and key = any($1)`, [retired], c);
      await q(`update alerts set resolved_at = now() where resolved_at is null and context->>'mailbox' = any($1)`, [retired], c);
      await q(`delete from mailboxes where address = any($1) and not exists (select 1 from mail_replies r where r.mailbox_id = mailboxes.id)`, [retired], c);
    }
  });
}
