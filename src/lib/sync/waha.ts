// WAHA (WhatsApp HTTP API) — read-only sync. Only chats that belong to outreach leads are
// pulled, so personal WhatsApp conversations never enter the dashboard.
import { env } from '../env';
import { q } from '../db';
import { recordIntegrationError, resolveIntegrationErrors } from '../errors';
import { fetchJson } from './http';
import { finishRun, markSource, startRun } from './runs';
import { phoneFromJid, recordWaMessage, rememberContact } from './wa-store';

interface WahaSession {
  name: string;
  status: string;
  me?: { id?: string; pushName?: string } | null;
}
interface WahaMessage {
  id: string;
  timestamp: number;
  from?: string;
  to?: string;
  fromMe: boolean;
  body?: string | null;
  hasMedia?: boolean;
  ack?: number | null;
}

function headers(): Record<string, string> {
  return { 'X-Api-Key': env.wahaApiKey, accept: 'application/json' };
}

export function wahaConfigured(): boolean {
  return !!env.wahaBaseUrl && !!env.wahaApiKey;
}

/**
 * Chats WhatsApp addressed by a privacy ID (…@lid) whose number is still unknown: ask WAHA for the
 * number (GET /api/{session}/lids/{lid}), and for the profile name of numbers without a lead.
 * Best effort: a WAHA version without these endpoints just leaves the privacy ID in place.
 */
async function resolveHiddenNumbers(live: Set<string>): Promise<void> {
  const lids = await q<{ chat_id: string; session: string }>(
    `select distinct on (w.chat_id) w.chat_id, w.session from wa_messages w left join wa_contacts c on c.chat_id = w.chat_id
      where w.chat_id like '%@lid' and (c.chat_id is null or (c.phone is null and c.updated_at < now() - interval '1 day'))
      order by w.chat_id, w.sent_at desc limit 100`,
  );
  for (const r of lids) {
    if (!live.has(r.session)) continue;
    try {
      const res = await fetchJson<{ lid?: string; pn?: string | null }>(
        `${env.wahaBaseUrl}/api/${encodeURIComponent(r.session)}/lids/${encodeURIComponent(r.chat_id)}`,
        { headers: headers(), retries: 0, timeoutMs: 10_000 },
      );
      await rememberContact(r.chat_id, phoneFromJid(res.pn), null, 'waha_lookup');
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404 || status === 405) {
        await recordIntegrationError('waha:lids', 'This WAHA version cannot look up hidden WhatsApp numbers; chats that arrived with a privacy ID keep it until the number appears in a webhook event.', {}, 'warning');
        break;
      }
    }
  }
  const unnamed = await q<{ phone: string; session: string }>(
    `select distinct on (replace(w.chat_id, '@c.us', '')) replace(w.chat_id, '@c.us', '') as phone, w.session
       from wa_messages w
      where w.chat_id like '%@c.us' and w.lead_id is null and not w.from_me
        and not exists (select 1 from wa_contacts c where c.phone = replace(w.chat_id, '@c.us', '') and c.name is not null)
      order by replace(w.chat_id, '@c.us', ''), w.sent_at desc limit 30`,
  );
  for (const r of unnamed) {
    if (!live.has(r.session)) continue;
    try {
      const c = await fetchJson<{ name?: string | null; pushname?: string | null; shortName?: string | null }>(
        `${env.wahaBaseUrl}/api/contacts?session=${encodeURIComponent(r.session)}&contactId=${encodeURIComponent(`${r.phone}@c.us`)}`,
        { headers: headers(), retries: 0, timeoutMs: 10_000 },
      );
      await rememberContact(`${r.phone}@c.us`, r.phone, c.name || c.pushname || c.shortName || null, 'waha_lookup');
    } catch {
      /* optional */
    }
  }
}

export async function syncWaha(): Promise<void> {
  const runId = await startRun('waha', 'waha');
  if (!wahaConfigured()) {
    await finishRun(runId, 'skipped', {}, 'WAHA_BASE_URL / WAHA_API_KEY not configured');
    await markSource('waha', false, 'Not connected: set WAHA_BASE_URL and WAHA_API_KEY on the server.');
    return;
  }
  let seen = 0;
  let written = 0;
  try {
    const sessions = await fetchJson<WahaSession[]>(`${env.wahaBaseUrl}/api/sessions?all=true`, { headers: headers() });
    for (const s of sessions) {
      const phone = s.me?.id ? s.me.id.replace(/@.*$/, '') : null;
      await q(
        `insert into wa_sessions (name, status, phone, last_sync_at, detail) values ($1,$2,$3,now(),$4)
         on conflict (name) do update set status = excluded.status, phone = excluded.phone, last_sync_at = now(), detail = excluded.detail`,
        [s.name, s.status, phone, JSON.stringify({ pushName: s.me?.pushName ?? null })],
      );
    }
    // Chats worth syncing: every WhatsApp lead that has been contacted or has a chat id,
    // limited to the session its campaign sends from.
    const chats = await q<{ chat: string; session: string }>(
      `select distinct l.wa_chat_id as chat, c.config->>'waSession' as session
         from leads l join campaigns c on c.id = l.campaign_id
        where c.channel = 'whatsapp' and l.wa_chat_id is not null and c.config->>'waSession' is not null
          and (l.sends_accepted > 0 or exists (select 1 from send_attempts sa where sa.lead_id = l.id))`,
    );
    const live = new Set(sessions.filter((s) => s.status === 'WORKING').map((s) => s.name));
    for (const { chat, session } of chats) {
      if (!live.has(session)) continue;
      const url = `${env.wahaBaseUrl}/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(chat)}/messages?limit=50&downloadMedia=false`;
      try {
        const msgs = await fetchJson<WahaMessage[]>(url, { headers: headers() });
        for (const m of msgs) {
          seen++;
          await recordWaMessage({
            session,
            messageId: m.id,
            chatId: chat,
            fromMe: m.fromMe,
            body: m.body ?? null,
            hasMedia: !!m.hasMedia,
            ack: typeof m.ack === 'number' ? m.ack : null,
            sentAt: new Date(m.timestamp * 1000),
            source: 'waha_api',
          });
          written++;
        }
      } catch (err) {
        await recordIntegrationError('waha', `Reading chat history failed for one chat in session ${session}: ${(err as Error).message}`, {}, 'warning');
      }
    }
    await resolveHiddenNumbers(live);
    // Copy delivery acks onto our send attempts (WAHA ack 2 = delivered to device, 3 = read).
    await q(
      `update send_attempts sa set wa_ack = greatest(sa.wa_ack, w.ack), updated_at = now()
         from wa_messages w
        where sa.channel = 'whatsapp' and sa.message_id is not null and w.ack is not null
          and (w.message_id = sa.message_id or w.message_id like '%\_' || sa.message_id)
          and (sa.wa_ack is null or w.ack > sa.wa_ack)`,
    );
    const down = sessions.filter((s) => s.status !== 'WORKING').map((s) => `${s.name}=${s.status}`);
    if (down.length) {
      await recordIntegrationError('waha:sessions', `WhatsApp sessions not working: ${down.join(', ')}`, {}, 'warning');
    } else {
      await resolveIntegrationErrors('waha:sessions');
    }
    await finishRun(runId, 'success', { seen, written });
    await markSource('waha', true, null, { rowCount: sessions.length });
    await resolveIntegrationErrors('waha');
  } catch (err) {
    await finishRun(runId, 'error', { seen, written }, (err as Error).message);
    await markSource('waha', false, (err as Error).message);
    await recordIntegrationError('waha', `WAHA sync failed: ${(err as Error).message}`);
  }
}
