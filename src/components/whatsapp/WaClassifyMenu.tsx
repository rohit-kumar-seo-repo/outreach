'use client';

import { useRef, useTransition } from 'react';
import { classifyWaThread } from '@/app/actions/whatsapp';

const OPTIONS = [
  { value: '', label: 'Classify conversation…' },
  { value: 'positive', label: 'Interested' },
  { value: 'not_interested', label: 'Not interested' },
  { value: 'needs_followup', label: 'Needs follow-up' },
  { value: 'auto_reply', label: 'Mark latest message as auto-reply' },
  { value: 'not_auto', label: 'Not an auto-reply (undo)' },
  { value: 'unsubscribe', label: 'Unsubscribe / do not contact' },
];

export function WaClassifyMenu({ session, chatId }: { session: string; chatId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  return (
    <form
      ref={ref}
      action={(fd) => start(() => classifyWaThread(fd))}
      onChange={() => ref.current && start(() => classifyWaThread(new FormData(ref.current!)))}
    >
      <input type="hidden" name="session" value={session} />
      <input type="hidden" name="chatId" value={chatId} />
      <select name="classification" defaultValue="" className="field py-1 text-[12.5px]" disabled={pending}>
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value} disabled={o.value === ''}>
            {o.label}
          </option>
        ))}
      </select>
    </form>
  );
}
