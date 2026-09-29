import { Pill } from './ui';

type Tone = Parameters<typeof Pill>[0]['tone'];

export const LEAD_STATUS: Record<string, { label: string; tone: Tone; help: string }> = {
  ready: { label: 'Ready', tone: 'brand', help: 'Valid contact, never contacted, and the campaign would pick it up without further work.' },
  awaiting_approval: { label: 'Awaiting approval', tone: 'default', help: 'Drafted in the sheet but not approved yet.' },
  needs_draft: { label: 'Needs draft', tone: 'default', help: 'Row exists but has no status / draft yet, so no workflow will send it.' },
  queued: { label: 'Queued', tone: 'brand', help: 'Approved and scheduled in the sheet (has a send date/time).' },
  sent: { label: 'Email sent', tone: 'teal', help: 'At least one send was accepted by the mail server/API. Delivery is not verified.' },
  followup_due: { label: 'Follow-up due', tone: 'warn', help: 'The next step of the sequence (or a manual follow-up) is due now or overdue.' },
  replied: { label: 'Replied', tone: 'good', help: 'A reply was matched to this lead.' },
  positive: { label: 'Positive reply', tone: 'good', help: 'A reply you classified as positive.' },
  not_interested: { label: 'Not interested', tone: 'default', help: 'A reply you classified as not interested.' },
  bounced: { label: 'Bounced', tone: 'critical', help: 'A bounce (non-delivery report) was matched to this address.' },
  unsubscribed: { label: 'Unsubscribed', tone: 'critical', help: 'On the suppression list (unsubscribed / do not contact).' },
  completed: { label: 'Completed', tone: 'default', help: 'Sequence finished without a reply.' },
  failed: { label: 'Send failed', tone: 'critical', help: 'Every send attempt failed; nothing was accepted.' },
  invalid: { label: 'Invalid contact', tone: 'default', help: 'No valid email address (or WhatsApp number) to contact.' },
  duplicate: { label: 'Duplicate', tone: 'default', help: 'Same address already appears earlier in this campaign.' },
  excluded: { label: 'Excluded', tone: 'default', help: 'Excluded by its sheet status (skip / DNC / invalid).' },
  unknown: { label: 'Unknown', tone: 'default', help: 'The sheet status is not one the dashboard recognises; see the raw value.' },
};

export function LeadStatus({ status }: { status: string }) {
  const s = LEAD_STATUS[status] ?? { label: status, tone: 'default' as Tone, help: '' };
  return (
    <Pill tone={s.tone} title={s.help}>
      {s.label}
    </Pill>
  );
}

export function CampaignStatus({ status }: { status: string }) {
  if (status === 'active') return <Pill tone="good" title="At least one of its n8n workflows is active.">Active</Pill>;
  if (status === 'paused') return <Pill title="All of its n8n workflows are inactive.">Paused</Pill>;
  return <Pill title="n8n is not connected yet, so the workflow state is unknown.">Status unknown</Pill>;
}

export function StepLabel({ step }: { step: number }) {
  return <span className="whitespace-nowrap">{step === 0 ? 'Original' : `Follow-up ${step}`}</span>;
}

export function ResultPill({ result, timeQuality }: { result: string; timeQuality?: string }) {
  if (result === 'accepted')
    return (
      <Pill tone="teal" title="Accepted by the mail server / API. This does not prove inbox delivery.">
        Accepted{timeQuality && timeQuality !== 'exact' ? '' : ''}
      </Pill>
    );
  if (result === 'failed') return <Pill tone="critical">Failed</Pill>;
  return <Pill title="The workflow failed mid-way; this item may or may not have been sent.">Outcome unknown</Pill>;
}

export const SOURCE_LABEL: Record<string, string> = {
  n8n_execution: 'n8n execution',
  n8n_push: 'n8n push',
  sheet_status: 'Sheet status only',
  mailbox_sent: 'Sent folder',
  manual: 'Manual',
};

export const TIME_QUALITY_LABEL: Record<string, string> = {
  exact: '',
  date_only: 'date only',
  unknown: 'time unknown',
};

export const OUTCOME: Record<string, { label: string; tone: Tone; help: string }> = {
  qualified: { label: 'Qualified lead', tone: 'teal', help: 'A real prospect with a need and budget worth pursuing.' },
  meeting_booked: { label: 'Meeting booked', tone: 'brand', help: 'A call or meeting is scheduled.' },
  won: { label: 'Won', tone: 'good', help: 'Became a paying client.' },
  lost: { label: 'Lost', tone: 'default', help: 'Went cold or chose someone else.' },
};

export function OutcomeBadge({ outcome }: { outcome: string | null | undefined }) {
  if (!outcome) return null;
  const o = OUTCOME[outcome] ?? { label: outcome, tone: 'default' as Tone, help: '' };
  return (
    <Pill tone={o.tone} title={o.help}>
      {o.label}
    </Pill>
  );
}
