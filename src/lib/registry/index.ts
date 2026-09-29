import { z } from 'zod';
import registryJson from '../../../config/registry.json';

export const SHEET_STATES = [
  'new',
  'awaiting_approval',
  'ready',
  'queued',
  'sent',
  'failed',
  'replied',
  'completed',
  'bounced',
  'excluded',
  'unknown',
] as const;
export type SheetState = (typeof SHEET_STATES)[number];

const fieldRef = z.object({
  const: z.union([z.string(), z.number()]).optional(),
  field: z.string().optional(),
  template: z.string().optional(),
  transform: z.enum(['minus_one', 'plus_one', 'fu_status', 'fu_suffix']).optional(),
});

const sendNode = z.object({
  node: z.string(),
  provider: z.enum(['hostinger_api', 'smtp', 'waha']),
  detect: z.enum(['http_error_output', 'http_never_error', 'smtp', 'waha_key']),
  sender: fieldRef,
  recipient: fieldRef,
  leadKey: fieldRef.optional(),
  subject: fieldRef.optional(),
  name: fieldRef.optional(),
  step: fieldRef,
});

const workflow = z.object({
  id: z.string(),
  name: z.string(),
  campaign: z.object({ slug: z.string().optional(), source: z.string().optional(), fromSource: z.string().optional() }),
  sendNodes: z.array(sendNode),
});

const statusRule = z.object({ match: z.string(), state: z.enum(SHEET_STATES) });

const source = z.object({
  key: z.string(),
  kind: z.enum(['google_sheet', 'n8n_data_table']),
  name: z.string(),
  channel: z.enum(['email', 'whatsapp']),
  rowKey: z.array(z.string()).min(1),
  rowKeyNormalize: z.enum(['email', 'phone', 'none']).optional(),
  campaign: z.union([
    z.string(),
    z.object({
      rules: z.array(z.object({ column: z.string(), regex: z.string(), campaign: z.string() })),
      default: z.string(),
    }),
  ]),
  phoneRule: z.enum(['india10', 'uae', 'any']).optional(),
  columns: z.object({
    name: z.array(z.string()).optional(),
    email: z.array(z.string()).optional(),
    phone: z.array(z.string()).optional(),
    website: z.array(z.string()).optional(),
    city: z.array(z.string()).optional(),
    country: z.array(z.string()).optional(),
    category: z.array(z.string()).optional(),
    status: z.string(),
    scheduledAt: z.string().optional(),
    scheduledDate: z.string().optional(),
    sender: z.string().optional(),
    touchNumber: z.string().optional(),
    maxTouches: z.string().optional(),
    lastSentAt: z.string().optional(),
    lastSentDate: z.string().optional(),
    lastSentDateFallback: z.string().optional(),
    subject: z.string().optional(),
    notes: z.string().optional(),
    draft: z.string().optional(),
    stopFlag: z.string().optional(),
    stage: z.string().optional(),
    nextTouchDate: z.string().optional(),
  }),
  blankStatus: z.enum(SHEET_STATES),
  requireDraft: z.boolean().optional(),
  statusRules: z.array(statusRule),
  history: z.enum(['status_sent_iso', 'touch_sequence', 'status_sent_date', 'fu_status', 'stage_counter', 'wa_status']),
  // Follow-ups stored as separate rows: pattern captures (lead key, step) from `column`, e.g. "^(.*)-fu(\\d+)$".
  touchRows: z.object({ column: z.string(), pattern: z.string() }).optional(),
  omitColumns: z.array(z.string()).optional(),
});

const campaign = z.object({
  slug: z.string(),
  name: z.string(),
  channel: z.enum(['email', 'whatsapp']),
  brand: z.string(),
  description: z.string().optional(),
  workflowIds: z.array(z.string()).default([]),
  leadsFromSends: z.boolean().optional(),
  waSession: z.string().optional(),
  followup: z.object({
    mode: z.enum(['none', 'source_schedule', 'days_after_last']),
    cadenceDays: z.array(z.number()).optional(),
    maxSteps: z.number().optional(),
    note: z.string().optional(),
  }),
});

const registrySchema = z.object({
  owner: z.object({ internalDomains: z.array(z.string()), internalAddresses: z.array(z.string()) }),
  mailboxes: z.array(z.object({ address: z.string(), via: z.enum(['hostinger_api', 'smtp']) })),
  /** Addresses that no longer exist: never listed as mailboxes; old sends from them keep the sender text only. */
  retiredMailboxes: z.array(z.string()).default([]),
  campaigns: z.array(campaign),
  sources: z.array(source),
  workflows: z.array(workflow),
  inboundWorkflows: z.array(z.object({ id: z.string(), name: z.string(), kind: z.literal('waha_inbound'), node: z.string() })),
  ignoredWorkflows: z.object({ ids: z.array(z.string()) }),
});

export type Registry = z.infer<typeof registrySchema>;
export type CampaignDef = z.infer<typeof campaign>;
export type SourceDef = z.infer<typeof source>;
export type WorkflowDef = z.infer<typeof workflow>;
export type SendNodeDef = z.infer<typeof sendNode>;
export type FieldRef = z.infer<typeof fieldRef>;

let cached: Registry | null = null;

export function registry(): Registry {
  if (!cached) {
    const parsed = registrySchema.parse(registryJson);
    // Cross-reference checks: a typo here would silently drop data, so fail loudly instead.
    const slugs = new Set(parsed.campaigns.map((c) => c.slug));
    const keys = new Set(parsed.sources.map((s) => s.key));
    for (const s of parsed.sources) {
      const targets = typeof s.campaign === 'string' ? [s.campaign] : [...s.campaign.rules.map((r) => r.campaign), s.campaign.default];
      for (const t of targets) if (!slugs.has(t)) throw new Error(`registry: source ${s.key} references unknown campaign ${t}`);
    }
    for (const w of parsed.workflows) {
      if (w.campaign.slug && !slugs.has(w.campaign.slug)) throw new Error(`registry: workflow ${w.id} references unknown campaign ${w.campaign.slug}`);
      for (const k of [w.campaign.source, w.campaign.fromSource]) if (k && !keys.has(k)) throw new Error(`registry: workflow ${w.id} references unknown source ${k}`);
    }
    cached = parsed;
  }
  return cached;
}

export function campaignForRow(src: SourceDef, row: Record<string, unknown>): string {
  if (typeof src.campaign === 'string') return src.campaign;
  for (const rule of src.campaign.rules) {
    if (new RegExp(rule.regex, 'i').test(String(row[rule.column] ?? ''))) return rule.campaign;
  }
  return src.campaign.default;
}

export function isInternalAddress(addr: string | null | undefined): boolean {
  if (!addr) return false;
  const a = addr.toLowerCase();
  const reg = registry();
  if (reg.owner.internalAddresses.includes(a)) return true;
  const domain = a.split('@')[1];
  return !!domain && reg.owner.internalDomains.includes(domain);
}
