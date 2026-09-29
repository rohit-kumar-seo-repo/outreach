import { q } from '../db';

export async function waSessions() {
  return q<{ name: string; status: string | null; phone: string | null; lastSyncAt: Date | null }>(
    `select name, status, phone, last_sync_at as "lastSyncAt" from wa_sessions order by name`,
  );
}

export interface WaConversation {
  chatId: string;
  /** Digits of the business's real WhatsApp number, when known. */
  phone: string | null;
  /** WhatsApp addressed this chat by a privacy ID and the number is not known yet. */
  hiddenNumber: boolean;
  leadId: number | null;
  leadName: string | null;
  contactName: string | null;
  campaignName: string | null;
  session: string;
  lastAt: Date;
  lastBody: string | null;
  lastFromMe: boolean;
  lastIsAuto: boolean;
  inbound: number;
  autoReplies: number;
  outbound: number;
}

const CONTACT = `
  left join lateral (
    select wc.phone, wc.name from wa_contacts wc
     where wc.chat_id = c.chat_id or (c.chat_id like '%@c.us' and wc.phone = replace(c.chat_id, '@c.us', ''))
     order by (wc.name is not null) desc, wc.updated_at desc limit 1) ct on true`;

export async function waConversations(limit = 100): Promise<WaConversation[]> {
  return q<WaConversation>(
    `with c as (
       select chat_id, session, max(sent_at) as last_at,
              count(*) filter (where not from_me and not is_auto)::int as inbound,
              count(*) filter (where not from_me and is_auto)::int as auto_replies,
              count(*) filter (where from_me)::int as outbound,
              (array_agg(lead_id order by sent_at desc) filter (where lead_id is not null))[1] as lead_id
         from wa_messages group by chat_id, session)
     select c.chat_id as "chatId",
            coalesce(case when c.chat_id like '%@c.us' then replace(c.chat_id, '@c.us', '') end, ct.phone) as phone,
            (c.chat_id like '%@lid' and ct.phone is null) as "hiddenNumber",
            c.lead_id as "leadId", l.name as "leadName", ct.name as "contactName", cp.name as "campaignName", c.session, c.last_at as "lastAt",
            x.body as "lastBody", x.from_me as "lastFromMe", x.is_auto as "lastIsAuto", c.inbound, c.auto_replies as "autoReplies", c.outbound
       from c
       join lateral (select body, from_me, is_auto from wa_messages w where w.chat_id = c.chat_id and w.session = c.session order by sent_at desc limit 1) x on true
       ${CONTACT}
       left join leads l on l.id = c.lead_id left join campaigns cp on cp.id = l.campaign_id
      order by c.inbound > 0 desc, c.last_at desc limit $1`,
    [limit],
  );
}

export async function waChat(chatId: string) {
  return q<{ id: number; fromMe: boolean; body: string | null; sentAt: Date; ack: number | null; session: string; hasMedia: boolean; isAuto: boolean }>(
    `select id, from_me as "fromMe", body, sent_at as "sentAt", ack, session, has_media as "hasMedia", is_auto as "isAuto"
       from wa_messages where chat_id = $1 order by sent_at`,
    [chatId],
  );
}
