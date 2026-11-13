// What a reply to outreach means, decided from its text: does it need you (interested, a question,
// wants a call, later, or something worth reading) or can it be screened out (no, unsubscribe,
// a bare greeting, "thanks", an automatic reply)? Rule-based so every decision is explainable
// and testable; a person's own classification always overrides it. Pure: safe on client and server.

export const INTENTS = ['interested', 'question', 'callback', 'later', 'other', 'not_interested', 'unsubscribe', 'greeting', 'ack', 'auto'] as const;
export type Intent = (typeof INTENTS)[number];

/** Bump when the rules change: stored classifications with an older version are redone. */
export const INTENT_VERSION = 1;

export const NEEDS_YOU: Intent[] = ['interested', 'question', 'callback', 'later', 'other'];
export const SCREENED: Intent[] = ['not_interested', 'unsubscribe', 'greeting', 'ack', 'auto'];

export const INTENT_META: Record<Intent, { label: string; chip: string; dot: string; avatar: string }> = {
  interested: { label: 'Interested', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500', avatar: 'bg-emerald-100 text-emerald-700' },
  question: { label: 'Asked a question', chip: 'bg-sky-50 text-sky-700 ring-sky-200', dot: 'bg-sky-500', avatar: 'bg-sky-100 text-sky-700' },
  callback: { label: 'Wants a call', chip: 'bg-violet-50 text-violet-700 ring-violet-200', dot: 'bg-violet-500', avatar: 'bg-violet-100 text-violet-700' },
  later: { label: 'Wants it later', chip: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-500', avatar: 'bg-amber-100 text-amber-800' },
  other: { label: 'Replied', chip: 'bg-indigo-50 text-indigo-700 ring-indigo-200', dot: 'bg-indigo-500', avatar: 'bg-indigo-100 text-indigo-700' },
  not_interested: { label: 'Not interested', chip: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500', avatar: 'bg-rose-100 text-rose-700' },
  unsubscribe: { label: 'Unsubscribe', chip: 'bg-red-50 text-red-700 ring-red-200', dot: 'bg-red-500', avatar: 'bg-red-100 text-red-700' },
  greeting: { label: 'Just a greeting', chip: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400', avatar: 'bg-slate-100 text-slate-600' },
  ack: { label: 'Thanks / OK', chip: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400', avatar: 'bg-slate-100 text-slate-600' },
  auto: { label: 'Auto-reply', chip: 'bg-zinc-100 text-zinc-600 ring-zinc-200', dot: 'bg-zinc-400', avatar: 'bg-zinc-100 text-zinc-600' },
};

/** Gradient tint class (globals.css .tint-*) for an intent's avatar. */
export const INTENT_TINT: Record<Intent, string> = {
  interested: 'tint-won',
  question: 'tint-new',
  callback: 'tint-proposal',
  later: 'tint-interested',
  other: 'tint-contacted',
  not_interested: 'tint-rose',
  unsubscribe: 'tint-red',
  greeting: 'tint-none',
  ack: 'tint-none',
  auto: 'tint-lost',
};

export function isIntent(v: unknown): v is Intent {
  return typeof v === 'string' && (INTENTS as readonly string[]).includes(v);
}

export function needsYou(intent: string | null | undefined): boolean {
  return !intent || (NEEDS_YOU as string[]).includes(intent);
}

/** SQL: effective intent of an inbound email (manual classification, then auto-reply kind, then the stored automatic intent). */
export function emailIntentSql(a: string): string {
  return `(case when ${a}.sentiment = 'positive' then 'interested' when ${a}.sentiment = 'not_interested' then 'not_interested'
    when ${a}.sentiment = 'unsubscribe' then 'unsubscribe' when ${a}.sentiment = 'auto_reply' or ${a}.kind = 'auto_reply' then 'auto'
    when ${a}.sentiment = 'neutral' then 'other' else coalesce(${a}.intent, 'other') end)`;
}

/** SQL: effective intent of an inbound WhatsApp message. */
export function waIntentSql(a: string): string {
  return `(case when ${a}.sentiment = 'positive' then 'interested' when ${a}.sentiment = 'not_interested' then 'not_interested'
    when ${a}.sentiment = 'unsubscribe' then 'unsubscribe' when ${a}.is_auto then 'auto' else coalesce(${a}.intent, 'other') end)`;
}

export const NEEDS_YOU_SQL = `(${NEEDS_YOU.map((i) => `'${i}'`).join(', ')})`;

/** The person's own words: drops quoted history ("On … wrote:", "> …", forwarded headers). */
export function stripQuoted(text: string): string {
  const out: string[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^>/.test(t)) break;
    if (/^on .{3,200}wrote:?$/i.test(t) || /wrote:$/i.test(t)) break;
    if (/^-{2,}\s*(original message|forwarded)/i.test(t) || /^_{5,}$/.test(t)) break;
    if (/^from:\s/i.test(t) && /^(sent|date|to):\s/i.test(lines[i + 1]?.trim() ?? '') && out.length > 0) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

const AUTO =
  /(this is an auto(mated|matic)|auto-?reply|automatic reply|out of (the )?office|i am (currently )?(out|away|on leave)|currently (unavailable|away|out of)|(will|shall) (respond|reply|get back)( to you)? (as soon as|shortly|at the earliest)|outside (of )?(our )?(business|working|office) hours|(thank(s| you) for (contacting|messaging|choosing|reaching out to|connecting with|your (message|email|enquiry|inquiry))|welcome to)[\s\S]{0,200}(how (can|may) (we|i) (help|assist)|how (we|i) (can|may) (help|assist)|our team will|we will (get back|respond|reply|contact)|someone will))/;

const UNSUB =
  /\b(unsubscribe|unsubcribe|opt[\s-]?out|stop (messag|msg|mail|email|send|contact|spam|this)|remove (me|my|us|our)|take (me|us) off|don'?t (message|msg|text|email|mail|contact|send|disturb)|do not (contact|message|email|send|disturb)|reported? (as )?spam|mat bhejo|message mat|msg mat|band karo|disturb mat)\b|^\s*stop\W*$|\bspam\b|\bblock(ed)?\b/;

const NOT_INTERESTED =
  /\b(not interested|not intrested|not intersted|not interseted|n'?t interested|no interest|no thanks|no thank ?you|no thanku|no thx|not required|not needed|don'?t need|do not need|no need|no requirement|not looking|we('re| are) (good|fine|ok|okay|sorted|covered|all set)|already (have|got|using|working|doing|tied|with|hired|done)|(own|in[- ]?house) (team|agency|developer|designer|seo|marketing)|wrong (number|person|no)|not the (right person|owner)|no budget|not (possible|at all)|don'?t (want|call)|do not (want|call)|nahi chahiye|nahin chahiye|nhi chahiye|nahi chaiye|nhi chaiye|interest nahi|interested nahi|zarurat nahi|zaroorat nahi|jarurat nahi|jarurat nhi|zarurat nhi|koi zarurat|mat karo|no sir|no mam|no ma'?am|no bro|no ji)\b/;

const NO_SHORT = /^(no+|nope|nah|na|nahi+|nahin|nhi|nai|nahi ji|nhi ji|never|not now thanks|not interested)$/;

const GREETING =
  /^((hi+|hello+|hey+|helo+|hlo+|hy|hai|hiii+|good (morning|afternoon|evening|day|night)|gm|gn|namaste|namaskar|namaskaram|salaam|salam|assalamu ?alaikum|ram ram|jai shree ram|radhe radhe|hola|yo|dear)( (sir|mam|maam|ma'am|ji|there|bro|dear|team|everyone|all))*)$/;

const ACK =
  /^((ok(ay)?|okk|k) )?(thanks?|thank ?you|thanku|thankyou|thx|ty|tq|noted|received|got it|dhanyavad|dhanyawad|shukriya)( (so much|a lot|very much))?( (sir|mam|maam|ma'am|ji|bro|dear))*$|^no (problem|issue|worries)$/;

const CALLBACK =
  /\b(call me|call (now|later|tomorrow|after|back|on|at|kar|karo|kariye|kijiye|karna)|give (me )?a call|ring me|phone me|contact me|reach me|whatsapp me|message me|msg me|baat kar|baat karo|talk (to|with) (me|you|my)|let'?s (talk|connect|discuss|speak)|(can|could) (we|you) (talk|speak|connect|discuss)|my (number|no|contact|mobile) (is|:)|call kar)\b|(\+?\d[\d\s-]{8,}\d)/;

const LATER =
  /\b(later|after (diwali|holi|eid|dussehra|festival|new year|the (holidays|festival|weekend))|next (week|month|year|time)|(in|after) (a )?(few|couple( of)?|some) (days|weeks|months)|busy (now|right now|currently|today|at the moment)|abhi busy|baad mein|baad me|bad me|kal\b|tomorrow|some ?time|not right now|not now|will (get back|revert|let you know|contact|check|see|think|discuss|call)|get back to you|let you know|think about it|dekhte|sochenge|revert)\b/;

const QUESTION =
  /\?|\b(price|pricing|prices|cost|costs|charges?|charging|fees?|rates?|quote|quotation|budget|package|plans?|how much|kitna|kitne|kya rate|kya charge|details?|more info|information|info|brochure|portfolio|samples?|examples?|case stud(y|ies)|what (is|are|do|does|will|kind)|how (do|does|will|can|long|many)|which|who are you|who is this|kaun|kya hai|kaise)\b/;

const INTERESTED =
  /\b(interested|intrested|interseted|yes|yeah|yep|yup|yah|ya|sure|ok|okay|okk|okey|k|alright|fine|go ahead|proceed|please (send|share|call|contact|explain)|send|share|tell me|tell more|let me know|sounds good|good idea|great|nice|haan|han|ha|haa|ji|ji haan|bilkul|theek|thik|chalega|kar do|bhejo|bhej do|batao|bataiye|demo|trial|meeting|appointment|schedule|book|available)\b/;

/**
 * Classifies one inbound reply. `hasMedia` marks a voice note / image / document: with no text,
 * it needs you (it may well be a voice note saying "call me").
 */
export function classifyReply(text: string | null | undefined, opts: { hasMedia?: boolean } = {}): Intent {
  const raw = stripQuoted(String(text ?? '')).replace(/[​-‍﻿]/g, '');
  const t = raw.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  if (!t) return opts.hasMedia ? 'other' : 'ack';
  // Letters, digits and "?" only; emoji and punctuation dropped.
  const compact = t.replace(/[^\p{L}\p{N}?'+\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!compact.replace(/\?/g, '').trim()) {
    if (compact.includes('?')) return 'question';
    return /👋/u.test(t) ? 'greeting' : opts.hasMedia ? 'other' : 'ack';
  }
  const words = compact.replace(/\?/g, ' ').trim();
  if (AUTO.test(t)) return 'auto';
  if (UNSUB.test(t)) return 'unsubscribe';
  if (NOT_INTERESTED.test(t)) return 'not_interested';
  if (!compact.includes('?') && GREETING.test(words)) return 'greeting';
  if (ACK.test(words)) return 'ack';
  if (NO_SHORT.test(words) || (/^(no|nahi|nhi|nope|nah)\b/.test(words) && words.split(' ').length <= 4 && !CALLBACK.test(t) && !QUESTION.test(t))) {
    return 'not_interested';
  }
  const call = CALLBACK.test(t);
  const later = LATER.test(t);
  if (call && later && !/\bnow\b/.test(t)) return 'later';
  if (call) return 'callback';
  if (later) return 'later';
  if (QUESTION.test(t)) return 'question';
  if (INTERESTED.test(words)) return 'interested';
  return 'other';
}
