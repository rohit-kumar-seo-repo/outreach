import { q } from '../db';

export async function waSessions() {
  return q<{ name: string; status: string | null; phone: string | null; lastSyncAt: Date | null }>(
    `select name, status, phone, last_sync_at as "lastSyncAt" from wa_sessions order by name`,
  );
}

export interface WaConversation {
  chatId: string;
  leadId: number | null;
  leadName: string | null;
  campaignName: string | null;
  session: string;
  lastAt: Date;
  lastBody: string | null;
  lastFromMe: boolean;
  inbound: number;
  outbound: number;
}

export async function waConversations(limit = 100): Promise<WaConversation[]> {
  return q<WaConversation>(
    `with c as (
       select chat_id, session, max(sent_at) as last_at, count(*) filter (where not from_me)::int as inbound,
              count(*) filter (where from_me)::int as outbound,
              (array_agg(lead_id order by sent_at desc) filter (where lead_id is not null))[1] as lead_id
         from wa_messages group by chat_id, session)
     select c.chat_id as "chatId", c.lead_id as "leadId", l.name as "leadName", cp.name as "campaignName", c.session, c.last_at as "lastAt",
            x.body as "lastBody", x.from_me as "lastFromMe", c.inbound, c.outbound
       from c
       join lateral (select body, from_me from wa_messages w where w.chat_id = c.chat_id and w.session = c.session order by sent_at desc limit 1) x on true
       left join leads l on l.id = c.lead_id left join campaigns cp on cp.id = l.campaign_id
      order by c.inbound > 0 desc, c.last_at desc limit $1`,
    [limit],
  );
}

export async function waChat(chatId: string) {
  return q<{ id: number; fromMe: boolean; body: string | null; sentAt: Date; ack: number | null; session: string; hasMedia: boolean }>(
    `select id, from_me as "fromMe", body, sent_at as "sentAt", ack, session, has_media as "hasMedia" from wa_messages where chat_id = $1 order by sent_at`,
    [chatId],
  );
}
