// Reusable WhatsApp templates: {{field}} placeholders filled in from real lead data, with a
// preview that shows exactly what would go out — including which fields are missing, rather
// than ever sending a broken "{{firstName}}" to a real number.
import { one, q } from '../db';
import { formatPhone } from '../normalize';

// A few convenience aliases on top of whatever columns your sheets actually have. "name" is kept
// distinct from "business" (both currently read the Name column) so a template reads naturally
// either way; if a sheet ever has a separate business-name column, point business at it here.
export const TEMPLATE_FIELDS = ['firstName', 'name', 'business', 'city', 'category', 'phone'] as const;
export type TemplateField = (typeof TEMPLATE_FIELDS)[number];

export interface TemplateLeadSample {
  name: string | null;
  city: string | null;
  category: string | null;
  phone: string | null;
  /** The row exactly as the sheet had it — e.g. {"Name": "...", "Mobile Number": "...", "City": "..."} —
   *  so a template can use {{Name}} or {{Mobile Number}} directly, matching the sheet's own headers. */
  raw?: Record<string, unknown>;
}

/** The curated aliases plus every raw column value, stringified. A placeholder can be either. */
export function sampleFields(lead: TemplateLeadSample): Record<string, string | null> {
  const name = lead.name?.trim() || null;
  const fields: Record<string, string | null> = {
    firstName: name ? name.split(/\s+/)[0] : null,
    name,
    business: name,
    city: lead.city?.trim() || null,
    category: lead.category?.trim() || null,
    phone: formatPhone(lead.phone) ?? lead.phone ?? null,
  };
  for (const [k, v] of Object.entries(lead.raw ?? {})) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) fields[k] = s;
  }
  return fields;
}

// Any text between {{ }} except braces themselves, so a real sheet column header like
// "{{Mobile Number}}" matches, not just single-word aliases like "{{firstName}}".
const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

export interface RenderResult {
  text: string;
  /** Placeholders in the template that this lead has no value for — shown, not silently blanked. */
  missing: string[];
  /** Placeholders the template used that are not a known field at all (a typo). */
  unknown: string[];
}

/** Fills {{field}} placeholders; a missing value is kept as "{{field}}" so it is obvious in a preview,
 *  never guessed or dropped. Matches case-insensitively (so "{{name}}" and "{{Name}}" both work) but
 *  renders using the field's own value as stored. Callers must check `missing`/`unknown` before
 *  treating a send as ready. */
export function renderTemplate(bodyText: string, fields: Partial<Record<string, string | null>>): RenderResult {
  const byLower = new Map<string, string | null>();
  for (const [k, v] of Object.entries(fields)) byLower.set(k.toLowerCase(), v ?? null);
  const missing = new Set<string>();
  const unknown = new Set<string>();
  const text = bodyText.replace(PLACEHOLDER, (full, rawKey: string) => {
    const key = rawKey.trim();
    if (!byLower.has(key.toLowerCase())) {
      unknown.add(key);
      return full;
    }
    const v = byLower.get(key.toLowerCase());
    if (!v) {
      missing.add(key);
      return full;
    }
    return v;
  });
  return { text, missing: [...missing], unknown: [...unknown] };
}

/** Every column name seen across your WhatsApp leads' source rows, so the template editor can show
 *  "these are the placeholders you actually have" instead of a fixed guessed list. */
export async function availablePlaceholders(): Promise<string[]> {
  const rows = await q<{ k: string }>(
    `select distinct jsonb_object_keys(l.raw) as k from leads l join campaigns c on c.id = l.campaign_id where c.channel = 'whatsapp'`,
  );
  return [...TEMPLATE_FIELDS, ...rows.map((r) => r.k)].filter((v, i, arr) => arr.indexOf(v) === i).sort((a, b) => a.localeCompare(b));
}

export interface WaTemplate {
  id: number;
  name: string;
  kind: 'text' | 'image' | 'document' | 'video';
  bodyText: string;
  mediaId: string | null;
  mediaUrl: string | null;
  mediaFilename: string | null;
  mediaMimeType: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  usedByCampaigns: string[];
}

const COLS = `t.id, t.name, t.kind, t.body_text as "bodyText", t.media_id as "mediaId", t.media_url as "mediaUrl",
  m.filename as "mediaFilename", m.mime_type as "mediaMimeType",
  t.created_at as "createdAt", t.updated_at as "updatedAt", t.created_by as "createdBy", t.updated_by as "updatedBy"`;

export async function listTemplates(): Promise<WaTemplate[]> {
  const rows = await q<WaTemplate & { usedBy: string[] | null }>(
    `select ${COLS}, (select array_agg(c.name order by c.name) from campaigns c where c.template_id = t.id) as "usedBy"
       from wa_templates t left join wa_media m on m.id = t.media_id
      order by t.updated_at desc`,
  );
  return rows.map((r) => ({ ...r, usedByCampaigns: r.usedBy ?? [] }));
}

/** One real lead from a WhatsApp campaign, used to prefill the preview form with real values
 *  instead of made-up placeholders. Returns null if no WhatsApp leads have been loaded yet. */
export async function sampleLead(): Promise<TemplateLeadSample | null> {
  // `l.name`, not bare `name` — campaigns has its own `name` column, so the unqualified
  // reference was ambiguous and made this (and every page that calls it) throw.
  return one<TemplateLeadSample>(
    `select l.name, l.city, l.category, l.phone, l.raw from leads l join campaigns c on c.id = l.campaign_id
      where c.channel = 'whatsapp' and l.name is not null order by l.id desc limit 1`,
  );
}

export async function templateById(id: number): Promise<WaTemplate | null> {
  const row = await one<WaTemplate>(`select ${COLS} from wa_templates t left join wa_media m on m.id = t.media_id where t.id = $1`, [id]);
  return row ? { ...row, usedByCampaigns: [] } : null;
}

export const MEDIA_LIMITS: Record<'image' | 'document' | 'video', { maxBytes: number; types: string[] }> = {
  // WhatsApp's own published media limits (WAHA passes the file straight through to WhatsApp,
  // so a file WhatsApp itself would reject is refused here before anything is uploaded).
  image: { maxBytes: 16 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] },
  document: { maxBytes: 100 * 1024 * 1024, types: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain', 'text/csv'] },
  video: { maxBytes: 16 * 1024 * 1024, types: ['video/mp4', 'video/3gpp'] },
};

export async function saveMedia(kind: 'image' | 'document' | 'video', filename: string, mimeType: string, bytes: Buffer, actor: string): Promise<string> {
  const limit = MEDIA_LIMITS[kind];
  if (bytes.length > limit.maxBytes) throw new Error(`${kind} is too large: ${(bytes.length / 1024 / 1024).toFixed(1)} MB (WhatsApp's limit for ${kind} is ${limit.maxBytes / 1024 / 1024} MB).`);
  if (!limit.types.includes(mimeType)) throw new Error(`"${mimeType}" is not a ${kind} type WhatsApp accepts here (allowed: ${limit.types.join(', ')}).`);
  const id = crypto.randomUUID();
  await q(`insert into wa_media (id, filename, mime_type, kind, byte_size, data, created_by) values ($1,$2,$3,$4,$5,$6,$7)`, [
    id,
    filename.slice(0, 200),
    mimeType,
    kind,
    bytes.length,
    bytes,
    actor,
  ]);
  return id;
}

export async function deleteMedia(id: string): Promise<void> {
  await q(`update wa_templates set media_id = null where media_id = $1`, [id]);
  await q(`delete from wa_media where id = $1`, [id]);
}
