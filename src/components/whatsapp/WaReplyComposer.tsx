'use client';

import { AlertTriangle, CheckCircle2, Send, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { sendWaReplyAction, type WaReplyState } from '@/app/actions/whatsapp';

function SendButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary min-w-28 justify-center" disabled={disabled || pending} aria-disabled={disabled || pending}>
      <Send size={14} aria-hidden /> {pending ? 'Sending…' : 'Send'}
    </button>
  );
}

export function WaReplyComposer({ session, chatId, initialKey, canSend, reason }: { session: string; chatId: string; initialKey: string; canSend: boolean; reason: string | null }) {
  const [state, action] = useActionState<WaReplyState, FormData>(sendWaReplyAction, { nextKey: initialKey });
  const [body, setBody] = useState('');
  const lastHandled = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (state.replyId && state.replyId !== lastHandled.current && (state.status === 'sent' || state.status === 'unknown')) {
      lastHandled.current = state.replyId;
      setBody('');
    }
  }, [state.replyId, state.status]);

  if (!canSend) {
    return (
      <section className="card border-dashed px-4 py-3 text-[13px] text-ink-2" aria-label="Reply">
        <b className="text-ink">Replying is not available.</b> {reason ?? 'This WhatsApp account is not connected.'}
      </section>
    );
  }

  return (
    <section className="card overflow-hidden" aria-label="Reply">
      <form action={action} className="space-y-2 px-4 py-3 text-[13px]">
        <input type="hidden" name="key" value={state.nextKey} />
        <input type="hidden" name="session" value={session} />
        <input type="hidden" name="chatId" value={chatId} />
        <label htmlFor="wa-reply-body" className="sr-only">
          Your reply
        </label>
        <textarea
          id="wa-reply-body"
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          required
          maxLength={4096}
          placeholder="Write your reply…"
          className="field w-full resize-y py-2 leading-relaxed"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11.5px] text-ink-3">Sent from {session} through WAHA. One message, no media, no automatic follow-up.</p>
          <SendButton disabled={false} />
        </div>
        {state.status && (
          <div
            role={state.status === 'sent' ? 'status' : 'alert'}
            className={`flex items-start gap-2 rounded-md px-3 py-2 text-[12.5px] ${
              state.status === 'sent' ? 'bg-good-50 text-good-text' : state.status === 'unknown' ? 'bg-warn-50 text-warn' : 'bg-critical-50 text-critical'
            }`}
          >
            {state.status === 'sent' ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden /> : state.status === 'unknown' ? <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> : <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden />}
            <span>{state.message}</span>
          </div>
        )}
      </form>
    </section>
  );
}
