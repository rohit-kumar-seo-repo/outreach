// The single source of truth for "is this WhatsApp campaign allowed to send right now" — read
// by the campaign controls in the dashboard AND by the n8n send workflows themselves (via
// /api/ingest/waha-gate), so a pause or a daily cap set here has one real effect everywhere,
// not just a label on a card. See docs/WHATSAPP.md for how the n8n side is wired.
import { one } from '../db';
import { env } from '../env';
import { localDate } from '../time';

export interface GateResult {
  allowed: boolean;
  reason: 'ok' | 'paused' | 'daily_cap_reached' | 'outside_send_window' | 'not_found';
  campaignSlug: string | null;
  paused: boolean;
  dailyCap: number | null;
  sentToday: number;
  message: string;
}

interface SendWindow {
  days?: number[]; // 1=Mon .. 7=Sun
  startLocal?: string; // "HH:MM"
  endLocal?: string;
}

/** True when `now` (in APP_TIMEZONE) falls inside the configured send window, or when no window
 *  is configured at all (nothing to restrict). */
async function withinSendWindow(win: SendWindow): Promise<boolean> {
  if (!win.days?.length && !win.startLocal && !win.endLocal) return true;
  const row = await one<{ dow: number; hm: string }>(
    `select extract(isodow from now() at time zone $1)::int as dow, to_char(now() at time zone $1, 'HH24:MI') as hm`,
    [env.timezone],
  );
  if (!row) return true;
  if (win.days?.length && !win.days.includes(row.dow)) return false;
  if (win.startLocal && row.hm < win.startLocal) return false;
  if (win.endLocal && row.hm > win.endLocal) return false;
  return true;
}

export async function checkGate(campaignSlug: string): Promise<GateResult> {
  const camp = await one<{ id: number; control_paused_at: Date | null; daily_cap: number | null; send_window: SendWindow }>(
    `select id, control_paused_at, daily_cap, send_window from campaigns where slug = $1`,
    [campaignSlug],
  );
  if (!camp) return { allowed: false, reason: 'not_found', campaignSlug, paused: false, dailyCap: null, sentToday: 0, message: `No campaign named "${campaignSlug}".` };
  const paused = camp.control_paused_at !== null;
  const sentToday = (
    await one<{ n: number }>(
      `select count(*)::int as n from send_attempts
        where campaign_id = $1 and channel = 'whatsapp' and result = 'accepted'
          and (coalesce(occurred_at, now()) at time zone $3)::date = $2::date`,
      [camp.id, localDate(), env.timezone],
    )
  )?.n ?? 0;
  if (paused) {
    return { allowed: false, reason: 'paused', campaignSlug, paused, dailyCap: camp.daily_cap, sentToday, message: 'This campaign is paused from the dashboard.' };
  }
  if (camp.daily_cap !== null && sentToday >= camp.daily_cap) {
    return {
      allowed: false,
      reason: 'daily_cap_reached',
      campaignSlug,
      paused,
      dailyCap: camp.daily_cap,
      sentToday,
      message: `Today's cap of ${camp.daily_cap} has been reached (${sentToday} sent).`,
    };
  }
  if (!(await withinSendWindow(camp.send_window ?? {}))) {
    return { allowed: false, reason: 'outside_send_window', campaignSlug, paused, dailyCap: camp.daily_cap, sentToday, message: 'Outside the configured send window.' };
  }
  return { allowed: true, reason: 'ok', campaignSlug, paused, dailyCap: camp.daily_cap, sentToday, message: 'Sending is allowed.' };
}
