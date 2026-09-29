import { one, q } from '../db';

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
  /** The real number when WhatsApp addressed the chat by a privacy ID (…@lid). */
  phone?: string | null;
  /** The other side's WhatsApp profile / verified business name (inbound messages only). */
  contactName?: string | null;
}

/** "919871530594@s.whatsapp.net", "919871530594:12@c.us" → "919871530594"; privacy IDs and groups → null. */
export function phoneFromJid(jid: unknown): string | null {
  if (typeof jid !== 'string') return null;
  const m = jid.trim().match(/^\+?(\d{7,15})(?::\d+)?@(s\.whatsapp\.net|c\.us)$/);
  return m ? m[1] : null;
}

export async function rememberContact(chatId: string, phone: string | null, name: string | null, source: 'webhook' | 'waha_lookup'): Promise<void> {
  await q(
    `insert into wa_contacts (chat_id, phone, name, source) values ($1, $2, $3, $4)
     on conflict (chat_id) do update set phone = coalesce(excluded.phone, wa_contacts.phone), name = coalesce(excluded.name, wa_contacts.name),
       source = case when excluded.phone is not null then excluded.source else wa_contacts.source end, updated_at = now()`,
    [chatId, phone, name?.trim().slice(0, 200) || null, source],
  );
}

/**
 * Idempotent on (session, message_id). Chats addressed by a privacy ID are stored under the real
 * number ("<digits>@c.us") once it is known, so a conversation is one chat and links to its lead.
 */
export async function recordWaMessage(m: WaMessageInput): Promise<void> {
  let chatId = m.chatId;
  if (m.phone || m.contactName) await rememberContact(m.chatId, m.phone ?? null, m.fromMe ? null : (m.contactName ?? null), 'webhook');
  if (chatId.endsWith('@lid')) {
    const phone = m.phone ?? (await one<{ phone: string }>(`select phone from wa_contacts where chat_id = $1 and phone is not null`, [chatId]))?.phone;
    if (phone) chatId = `${phone}@c.us`;
  }
  // The same WhatsApp message can arrive under both address forms; ids end with the same message key.
  const key = m.messageId.replace(/^.*_/, '');
  const same = await one<{ id: number }>(
    `select id from wa_messages where session = $1 and message_id <> $2 and length($3) >= 8 and right(message_id, length($3) + 1) = '_' || $3 limit 1`,
    [m.session, m.messageId, key],
  );
  if (same) {
    await q(`update wa_messages set ack = greatest(ack, $2), body = coalesce(body, $3) where id = $1`, [same.id, m.ack, m.body?.slice(0, 5000) ?? null]);
    return;
  }
  const digits = chatId.endsWith('@c.us') ? chatId.replace(/@c\.us$/, '') : null;
  await q(
    `insert into wa_messages (session, message_id, chat_id, from_me, body, has_media, ack, sent_at, source, lead_id, campaign_id)
     select $1,$2,$3,$4,$5,$6,$7,$8,$9, l.id, l.campaign_id
       from (select 1) x
       left join lateral (
         select l.id, l.campaign_id from leads l join campaigns c on c.id = l.campaign_id
          where c.channel = 'whatsapp' and (l.wa_chat_id = $3 or ($10::text is not null and l.phone_norm = $10))
          order by (c.config->>'waSession' = $1) desc nulls last, (l.wa_chat_id = $3) desc, l.is_duplicate, l.id limit 1) l on true
     on conflict (session, message_id) do update set
       chat_id = excluded.chat_id,
       ack = greatest(wa_messages.ack, excluded.ack),
       body = coalesce(wa_messages.body, excluded.body),
       lead_id = coalesce(wa_messages.lead_id, excluded.lead_id),
       campaign_id = coalesce(wa_messages.campaign_id, excluded.campaign_id)`,
    [m.session, m.messageId, chatId, m.fromMe, m.body?.slice(0, 5000) ?? null, m.hasMedia, m.ack, m.sentAt, m.source, digits],
  );
}

/** Away messages ("we're unavailable right now…"): automatic whenever they arrive. */
export const WA_AWAY = `((we|i)( a|['’])(re|m)|we are|i am) (currently |not |temporarily )*(unavailable|away|closed|out of (the )?office|not available|busy)|outside (of )?(our )?(business|working|office|opening) hours|(will|shall) (respond|reply|get back)( to you)?( as soon as| shortly| soon| at the earliest)|this is an auto(mated|matic)|auto-?reply`;
/** Greetings ("Thank you for contacting…", "Welcome to…"): automatic when they arrive within 3 minutes of our message. */
export const WA_GREETING = `thank(s| you) for (contacting|reaching out|your (message|interest|enquiry|inquiry)|messaging|getting in touch|writing)|welcome to|how (can|may) (we|i) (help|assist)`;

/**
 * Keeps WhatsApp data consistent after any sync: moves privacy-ID chats to their real number once
 * known, links messages to leads, and flags automatic greetings/away messages (never counted as replies).
 */
export async function reconcileWhatsApp(): Promise<void> {
  // Duplicates first (same message key already stored under the number), then move the rest.
  await q(
    `delete from wa_messages w using wa_contacts c, wa_messages k
      where w.chat_id = c.chat_id and c.chat_id like '%@lid' and c.phone is not null
        and k.session = w.session and k.chat_id = c.phone || '@c.us' and k.id <> w.id
        and regexp_replace(k.message_id, '^.*_', '') = regexp_replace(w.message_id, '^.*_', '')`,
  );
  await q(
    `update wa_messages w set chat_id = c.phone || '@c.us'
       from wa_contacts c where w.chat_id = c.chat_id and c.chat_id like '%@lid' and c.phone is not null`,
  );
  await q(
    `update wa_messages w set lead_id = x.lead_id, campaign_id = x.campaign_id
       from (select distinct on (w2.id) w2.id, l.id as lead_id, l.campaign_id
               from wa_messages w2
               join leads l on (l.wa_chat_id = w2.chat_id or (w2.chat_id like '%@c.us' and l.phone_norm = replace(w2.chat_id, '@c.us', '')))
               join campaigns c on c.id = l.campaign_id and c.channel = 'whatsapp'
              where w2.lead_id is null
              order by w2.id, (c.config->>'waSession' = w2.session) desc nulls last, (l.wa_chat_id = w2.chat_id) desc, l.is_duplicate, l.id) x
      where w.id = x.id`,
  );
  await q(
    `update wa_messages w set is_auto = true
      where not w.from_me and not w.is_auto and w.body is not null
        and (w.body ~* $1
             or (w.body ~* $2 and (
                   exists (select 1 from wa_messages o where o.session = w.session and o.chat_id = w.chat_id and o.from_me
                            and o.sent_at <= w.sent_at and o.sent_at > w.sent_at - interval '3 minutes')
                   or exists (select 1 from send_attempts sa where sa.channel = 'whatsapp' and w.lead_id is not null and sa.lead_id = w.lead_id
                               and sa.result = 'accepted' and sa.occurred_at <= w.sent_at and sa.occurred_at > w.sent_at - interval '3 minutes'))))`,
    [WA_AWAY, WA_GREETING],
  );
}
