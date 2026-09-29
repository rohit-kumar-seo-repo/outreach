'use client';

import { AlertTriangle, CheckCircle2, CircleHelp, Send, XCircle } from 'lucide-react';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { sendReplyAction, type ReplyState } from '@/app/actions/inbox';

export interface ComposerOption {
  address: string;
  canSend: boolean;
  reason: string | null;
}

function SendButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary min-w-28 justify-center" disabled={disabled || pending} aria-disabled={disabled || pending}>
      <Send size={14} aria-hidden /> {pending ? 'Sending…' : 'Send reply'}
    </button>
  );
}

export function ReplyComposer({
  thread,
  initialKey,
  options,
  defaultFrom,
  defaultTo,
  subject,
  warnings,
  linkedTo,
}: {
  thread: string;
  initialKey: string;
  options: ComposerOption[];
  defaultFrom: string | null;
  defaultTo: string[];
  subject: string;
  warnings: string[];
  linkedTo: string | null;
}) {
  const [state, action] = useActionState<ReplyState, FormData>(sendReplyAction, { nextKey: initialKey });
  const sendable = options.filter((o) => o.canSend);
  const startFrom = options.find((o) => o.address === defaultFrom) ? defaultFrom! : (sendable[0]?.address ?? options[0]?.address ?? '');
  const [from, setFrom] = useState(startFrom);
  const [showCc, setShowCc] = useState(false);
  // Controlled fields: React resets uncontrolled ones after every action, which would lose a draft on an error.
  const [to, setTo] = useState(defaultTo.join(', '));
  const [cc, setCc] = useState('');
  const [body, setBody] = useState('');
  const lastHandled = useRef<number | undefined>(undefined);
  const chosen = options.find((o) => o.address === from);
  const switched = !!defaultFrom && from !== defaultFrom;

  // Clear the text after a reply went out (or may have), so it cannot be sent twice by accident.
  useEffect(() => {
    if (state.replyId && state.replyId !== lastHandled.current && (state.status === 'sent' || state.status === 'unknown')) {
      lastHandled.current = state.replyId;
      setBody('');
      setCc('');
    }
  }, [state.replyId, state.status]);

  if (options.length === 0 || sendable.length === 0) {
    const reason = options.find((o) => o.address === defaultFrom)?.reason ?? options[0]?.reason;
    return (
      <section className="card border-dashed px-4 py-3 text-[13px]" aria-label="Reply">
        <div className="flex items-start gap-2 text-ink-2">
          <CircleHelp size={16} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
          <div>
            <b className="text-ink">Replying is not available for this conversation.</b>{' '}
            {reason ?? 'None of the mailboxes in this conversation is connected through the Hostinger Email API.'} You can still reply from webmail; the
            dashboard picks the reply up at the next mailbox sync.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="card overflow-hidden" aria-label="Reply">
      <form action={action} className="space-y-2 px-4 py-3 text-[13px]">
        <input type="hidden" name="key" value={state.nextKey} />
        <input type="hidden" name="thread" value={thread} />
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="reply-from" className="font-medium text-ink-2">
            Reply from
          </label>
          <select id="reply-from" name="from" value={from} onChange={(e) => setFrom(e.target.value)} className="field min-w-0 max-w-full flex-1 py-1 sm:flex-none">
            {options.map((o) => (
              <option key={o.address} value={o.address} disabled={!o.canSend}>
                {o.address}
                {o.address === defaultFrom ? ' (received this conversation)' : ''}
                {o.canSend ? '' : ' — unavailable'}
              </option>
            ))}
          </select>
          <button type="button" className="link ml-auto text-[12px]" onClick={() => setShowCc((v) => !v)} aria-expanded={showCc}>
            {showCc ? 'Hide Cc' : 'Cc'}
          </button>
        </div>
        {switched && chosen?.canSend && (
          <p className="flex items-start gap-1.5 rounded-md bg-warn-50 px-2.5 py-1.5 text-[12px] text-warn">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden /> You are replying from {from}, not {defaultFrom}, which received this conversation.
          </p>
        )}
        {chosen && !chosen.canSend && chosen.reason && <p className="text-[12px] text-critical">{chosen.reason}</p>}
        <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-center">
          <label htmlFor="reply-to" className="text-ink-2">
            To
          </label>
          <input id="reply-to" name="to" value={to} onChange={(e) => setTo(e.target.value)} className="field w-full py-1" autoComplete="off" required />
          {showCc ? (
            <>
              <label htmlFor="reply-cc" className="text-ink-2">
                Cc
              </label>
              <input
                id="reply-cc"
                name="cc"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                className="field w-full py-1"
                placeholder="Optional, comma-separated"
                autoComplete="off"
              />
            </>
          ) : (
            <input type="hidden" name="cc" value={cc} />
          )}
          <span className="text-ink-2">Subject</span>
          <span className="truncate text-ink" title="Kept as-is so the reply stays in the same thread">
            {subject}
          </span>
        </div>
        {warnings.map((w) => (
          <p key={w} className="flex items-start gap-1.5 rounded-md bg-warn-50 px-2.5 py-1.5 text-[12px] text-warn">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden /> {w}
          </p>
        ))}
        <label htmlFor="reply-body" className="sr-only">
          Your reply
        </label>
        <textarea
          id="reply-body"
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          required
          maxLength={20000}
          placeholder="Write your reply…"
          className="field w-full resize-y py-2 leading-relaxed"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11.5px] text-ink-3">
            Sent through the Hostinger Email API, threaded to this conversation, saved in {from}&rsquo;s Sent folder
            {linkedTo ? ` and recorded against ${linkedTo}` : ''}. Plain text, no attachments.
          </p>
          <SendButton disabled={!chosen?.canSend} />
        </div>
        {state.status && (
          <div
            role={state.status === 'sent' ? 'status' : 'alert'}
            className={`flex items-start gap-2 rounded-md px-3 py-2 text-[12.5px] ${
              state.status === 'sent' ? 'bg-good-50 text-good-text' : state.status === 'unknown' ? 'bg-warn-50 text-warn' : 'bg-critical-50 text-critical'
            }`}
          >
            {state.status === 'sent' ? (
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden />
            ) : state.status === 'unknown' ? (
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
            ) : (
              <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
            )}
            <span>{state.message}</span>
          </div>
        )}
      </form>
    </section>
  );
}
