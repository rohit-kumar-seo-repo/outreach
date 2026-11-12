'use client';

import { AlertTriangle, CheckCircle2, Send, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { sendWaReplyAction, type WaReplyState } from '@/app/actions/whatsapp';

function SendButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#128c7e] text-white shadow-sm transition-transform hover:bg-[#0f7a6e] active:scale-95 disabled:opacity-50"
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
      aria-label={pending ? 'Sending' : 'Send'}
    >
      <Send size={18} aria-hidden />
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
      <section className="rounded-2xl border border-dashed border-line-strong bg-white/70 px-4 py-3 text-[13px] text-ink-2" aria-label="Reply">
        <b className="text-ink">Replying is not available.</b> {reason ?? 'This WhatsApp account is not connected.'}
      </section>
    );
  }

  return (
    <section aria-label="Reply">
      <form action={action} className="space-y-2 text-[13px]">
        <input type="hidden" name="key" value={state.nextKey} />
        <input type="hidden" name="session" value={session} />
        <input type="hidden" name="chatId" value={chatId} />
        <label htmlFor="wa-reply-body" className="sr-only">
          Your reply
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="wa-reply-body"
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={1}
            required
            maxLength={4096}
            placeholder="Type a message"
            className="field max-h-40 min-h-11 w-full flex-1 resize-y rounded-3xl border-0 bg-white px-4 py-2.5 leading-relaxed shadow-sm"
          />
          <SendButton disabled={false} />
        </div>
        <p className="px-2 text-[11px] text-ink-3">Sends from {session} through WAHA: one text message, no automatic follow-up.</p>
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
