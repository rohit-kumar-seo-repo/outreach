'use client';

import { Phone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { LogCallPanel } from './LeadControls';
import type { Stage } from '@/lib/crm/stages';

/** Call-mode logger: saving moves straight on to the next lead in the queue. */
export function CallLogger({ leadId, stage }: { leadId: number; stage: Stage | null }) {
  const router = useRouter();
  return (
    <LogCallPanel
      leadId={leadId}
      stage={stage}
      big
      onSaved={() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        router.refresh();
      }}
    />
  );
}

export function CallButton({ tel, label }: { tel: string; label: string }) {
  return (
    <a
      href={tel}
      onClick={() => window.dispatchEvent(new CustomEvent('crm:call-started'))}
      className="flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 px-5 py-5 text-white shadow-lg shadow-emerald-700/25 transition-transform active:scale-[0.98]"
    >
      <Phone size={26} aria-hidden />
      <span className="text-left">
        <span className="block text-[19px] font-bold leading-tight">Call now</span>
        <span className="block text-[14px] text-emerald-50/90 tabular">{label}</span>
      </span>
    </a>
  );
}
