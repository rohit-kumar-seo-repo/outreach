'use client';

import { useEffect, useRef } from 'react';
import { ensureBodies, markOpened } from '@/app/actions/inbox';

/**
 * Runs once when a conversation is actually opened (never on link prefetch): marks it read in the
 * dashboard and loads any message bodies not fetched yet. Neither changes read flags in the mailbox.
 */
export function OpenEffects({ thread, unread, missingBodies }: { thread: string; unread: boolean; missingBodies: boolean }) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (done.current === thread) return;
    done.current = thread;
    if (missingBodies) void ensureBodies(thread).catch(() => undefined);
    if (unread) void markOpened(thread).catch(() => undefined);
  }, [thread, unread, missingBodies]);
  return null;
}
