import { env } from '../env';
import { q } from '../db';

export async function openErrors() {
  return q<{ id: number; sourceKey: string; severity: string; message: string; occurrences: number; firstSeenAt: Date; lastSeenAt: Date }>(
    `select id, source_key as "sourceKey", severity, message, occurrences, first_seen_at as "firstSeenAt", last_seen_at as "lastSeenAt"
       from integration_errors where resolved_at is null order by (severity = 'error') desc, last_seen_at desc limit 100`,
  );
}

export async function recentRuns() {
  return q<{ id: number; job: string; startedAt: Date; finishedAt: Date | null; status: string; itemsSeen: number; itemsWritten: number; error: string | null }>(
    `select id, job, started_at as "startedAt", finished_at as "finishedAt", status, items_seen as "itemsSeen", items_written as "itemsWritten", error
       from sync_runs order by started_at desc limit 40`,
  );
}

export async function workflowCoverage() {
  return q<{
    id: string;
    name: string;
    active: boolean | null;
    tracked: boolean;
    looksLikeSender: boolean;
    senderNodes: string[];
    lastCheckedAt: Date | null;
    lastRunStatus: string | null;
    lastRunAt: Date | null;
  }>(
    `select w.id, w.name, w.active, w.tracked, w.looks_like_sender as "looksLikeSender", w.sender_nodes as "senderNodes",
            w.last_checked_at as "lastCheckedAt", le.status as "lastRunStatus", le.started_at as "lastRunAt"
       from n8n_workflows w
       left join lateral (
         select status, started_at from n8n_executions e where e.workflow_id = w.id order by e.started_at desc limit 1
       ) le on true
      -- Tracked and sender-like workflows always show; any other workflow only shows up here once it is
      -- actually failing (its full history lives on the Alerts page once that happens).
      where w.tracked or w.looks_like_sender or le.status in ('error', 'crashed')
      order by (le.status in ('error', 'crashed')) desc, w.tracked desc, w.active desc nulls last, w.name`,
  );
}

/** Which server settings are present. Booleans only: secret values are never read out here. */
export function configChecklist() {
  return [
    { key: 'ADMIN_EMAIL + ADMIN_PASSWORD(_HASH)', ok: !!env.adminEmail && (!!env.adminPasswordHash || env.adminPassword.length >= 12), purpose: 'Dashboard login' },
    { key: 'ADMIN_TOTP_SECRET', ok: !!env.totpSecret, purpose: 'Two-factor login (recommended)' },
    { key: 'N8N_BASE_URL + N8N_API_KEY', ok: !!env.n8nBaseUrl && !!env.n8nApiKey, purpose: 'Send events from n8n execution history' },
    { key: 'N8N_BRIDGE_URL + N8N_BRIDGE_KEY', ok: !!env.bridgeUrl && !!env.bridgeKey, purpose: 'Spreadsheet and data-table rows' },
    { key: 'HOSTINGER_MAIL_TOKENS', ok: env.hostingerMailTokens.length > 0, purpose: `Mailbox sync via Hostinger Email API (${env.hostingerMailTokens.length} token(s))` },
    { key: 'IMAP_ACCOUNTS_JSON', ok: env.imapAccounts.length > 0, purpose: `Mailbox sync via IMAP (${env.imapAccounts.length} account(s))` },
    { key: 'WAHA_BASE_URL + WAHA_API_KEY', ok: !!env.wahaBaseUrl && !!env.wahaApiKey, purpose: 'WhatsApp sessions, chat history and delivery ticks' },
    { key: 'INGEST_KEY', ok: !!env.ingestKey, purpose: 'Optional push endpoint for n8n (/api/ingest/n8n)' },
  ];
}
