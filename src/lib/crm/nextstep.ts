// The one next step for a lead that needs you, in plain words, and where a tap should take you:
// the conversation (to answer), or the lead page (to call and log it, or follow up).
// Pure: safe on client and server.

export type NextKind = 'reply' | 'call' | 'followup' | 'checkin';

export interface NextStep {
  kind: NextKind;
  label: string;
  href: string;
}

export function nextStep(lead: {
  id: number;
  attention: 'reply' | 'due' | 'cold' | null;
  replyIntent: string | null;
  /** The in-app conversation their latest reply is in (email thread or WhatsApp chat). */
  replyHref: string | null;
  hasPhone: boolean;
}): NextStep | null {
  const page = `/leads/${lead.id}`;
  const chat = lead.replyHref ?? page;
  if (lead.attention === 'reply') {
    switch (lead.replyIntent) {
      case 'callback':
        // Calling happens from the lead page, where the call gets logged.
        return { kind: 'call', label: 'They asked for a call', href: lead.hasPhone ? page : chat };
      case 'question':
        return { kind: 'reply', label: 'Answer their question', href: chat };
      case 'interested':
        return { kind: 'reply', label: 'Interested: send details', href: chat };
      case 'later':
        return { kind: 'reply', label: 'Asked to talk later', href: chat };
      default:
        return { kind: 'reply', label: 'Read and reply', href: chat };
    }
  }
  if (lead.attention === 'due') return { kind: 'followup', label: 'Follow up now', href: page };
  if (lead.attention === 'cold') return { kind: 'checkin', label: 'Check in: gone quiet', href: chat };
  return null;
}
