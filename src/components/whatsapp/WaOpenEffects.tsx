'use client';

import { useEffect, useRef } from 'react';
import { markWaRead } from '@/app/actions/whatsapp';

/** Marks a WhatsApp conversation read in the dashboard when it is actually opened. */
export function WaOpenEffects({ session, chatId, unread }: { session: string; chatId: string; unread: boolean }) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    const key = `${session}:${chatId}`;
    if (done.current === key) return;
    done.current = key;
    if (unread) void markWaRead(session, chatId).catch(() => undefined);
  }, [session, chatId, unread]);
  return null;
}
