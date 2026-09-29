import { q } from '../db';

export interface WaMessageInput {
  session: string;
  messageId: string;
  chatId: string;
  fromMe: boolean;
  body: string | null;
  hasMedia: boolean;
  ack: number | null;
  sentAt: Date;
  source: 'waha_api' | 'n8n_webhook';
}

/** Idempotent on (session, message_id). Links to the WhatsApp lead with the same chat id. */
export async function recordWaMessage(m: WaMessageInput): Promise<void> {
  await q(
    `insert into wa_messages (session, message_id, chat_id, from_me, body, has_media, ack, sent_at, source, lead_id, campaign_id)
     select $1,$2,$3,$4,$5,$6,$7,$8,$9, l.id, l.campaign_id
       from (select 1) x
       left join lateral (
         select l.id, l.campaign_id from leads l join campaigns c on c.id = l.campaign_id
          where l.wa_chat_id = $3 and c.channel = 'whatsapp'
          order by (c.config->>'waSession' = $1) desc nulls last, l.is_duplicate, l.id limit 1) l on true
     on conflict (session, message_id) do update set
       ack = greatest(wa_messages.ack, excluded.ack),
       body = coalesce(wa_messages.body, excluded.body),
       lead_id = coalesce(wa_messages.lead_id, excluded.lead_id),
       campaign_id = coalesce(wa_messages.campaign_id, excluded.campaign_id)`,
    [m.session, m.messageId, m.chatId, m.fromMe, m.body?.slice(0, 5000) ?? null, m.hasMedia, m.ack, m.sentAt, m.source],
  );
}
