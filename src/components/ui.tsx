import Link from 'next/link';
import { AlertTriangle, CheckCircle2, CircleDashed, CircleSlash, HelpCircle, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Lift, Reveal } from './motion';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-2">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className = '', pad = true }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <Reveal as="section" delay={0.04} className={`card ${className}`}>
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </Reveal>
  );
}

/** Hover/focus definition for a metric. Plain text so it is also readable by screen readers. */
export function Tip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle" tabIndex={0} aria-label={text}>
      <HelpCircle size={13} className="text-ink-3" aria-hidden />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-5 z-30 hidden w-64 -translate-x-1/2 rounded-md bg-navy-900 px-3 py-2 text-[11.5px] font-normal leading-snug text-white shadow-lg group-hover:block group-focus:block"
      >
        {text}
      </span>
    </span>
  );
}

type Tone = 'default' | 'brand' | 'good' | 'teal' | 'warn' | 'critical';
const toneClass: Record<Tone, string> = {
  default: 'bg-slate-100 text-ink-2',
  brand: 'bg-brand-50 text-brand',
  good: 'bg-good-50 text-good-text',
  teal: 'bg-teal-50 text-teal',
  warn: 'bg-warn-50 text-warn',
  critical: 'bg-critical-50 text-critical',
};

export function Pill({ children, tone = 'default', title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ${toneClass[tone]}`}>
      {children}
    </span>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  tip,
  icon,
  tone = 'default',
  href,
  unavailable,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tip?: string;
  icon?: ReactNode;
  tone?: Tone;
  href?: string;
  unavailable?: string | null;
}) {
  const body = (
    <Lift className="h-full">
      <div className={`card h-full p-4 ${href ? 'transition-shadow hover:shadow-sm' : ''}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
            {label}
            {tip ? <Tip text={tip} /> : null}
          </div>
          {icon ? <div className={`flex h-7 w-7 items-center justify-center rounded-md ${toneClass[tone]}`}>{icon}</div> : null}
        </div>
        {unavailable ? (
          <>
            <div className="mt-2 text-[22px] font-semibold text-ink-3">—</div>
            <div className="mt-1 text-xs text-ink-3">{unavailable}</div>
          </>
        ) : (
          <>
            <div className="mt-2 text-[26px] font-semibold leading-none text-ink">{value}</div>
            {sub ? <div className="mt-2 text-xs text-ink-3 [overflow-wrap:anywhere]">{sub}</div> : null}
          </>
        )}
      </div>
    </Lift>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 text-ink-3">{icon ?? <CircleDashed size={28} aria-hidden />}</div>
      <div className="text-sm font-medium text-ink">{title}</div>
      {children ? <div className="mt-1 max-w-xl text-[13px] text-ink-2">{children}</div> : null}
    </div>
  );
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'critical' | 'good'; title?: string; children: ReactNode }) {
  const cls = {
    info: 'border-blue-200 bg-brand-50 text-ink',
    warn: 'border-amber-200 bg-warn-50 text-ink',
    critical: 'border-red-200 bg-critical-50 text-ink',
    good: 'border-emerald-200 bg-good-50 text-ink',
  }[tone];
  const Icon = { info: Info, warn: AlertTriangle, critical: XCircle, good: CheckCircle2 }[tone];
  const iconCls = { info: 'text-brand', warn: 'text-warn', critical: 'text-critical', good: 'text-good-text' }[tone];
  return (
    <Reveal role={tone === 'critical' ? 'alert' : 'status'} className={`flex gap-3 rounded-lg border px-4 py-3 text-[13px] ${cls}`}>
      <Icon size={17} className={`mt-0.5 shrink-0 ${iconCls}`} aria-hidden />
      <div>
        {title ? <div className="font-semibold">{title}</div> : null}
        <div className="text-ink-2">{children}</div>
      </div>
    </Reveal>
  );
}

export function SyncState({ status }: { status: 'ok' | 'error' | 'not_connected' | 'never' }) {
  if (status === 'ok')
    return (
      <Pill tone="good">
        <CheckCircle2 size={12} aria-hidden /> Connected
      </Pill>
    );
  if (status === 'error')
    return (
      <Pill tone="critical">
        <XCircle size={12} aria-hidden /> Error
      </Pill>
    );
  if (status === 'not_connected')
    return (
      <Pill>
        <CircleSlash size={12} aria-hidden /> Not connected
      </Pill>
    );
  return (
    <Pill>
      <CircleDashed size={12} aria-hidden /> Not synced yet
    </Pill>
  );
}

export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-IN').format(n);
}

export function pct(r: number | null): string {
  if (r === null) return '—';
  return `${(r * 100).toFixed(r < 0.1 && r > 0 ? 1 : 0)}%`;
}

/** "12.5% (3 of 24)" — every rate is shown with its denominator. */
export function RateCell({ num, den, label }: { num: number; den: number; label?: string }) {
  const r = den > 0 ? num / den : null;
  return (
    <span className="tabular" title={label ? `${label}: ${num} ÷ ${den}` : `${num} ÷ ${den}`}>
      <span className="font-medium text-ink">{pct(r)}</span>
      <span className="ml-1 text-ink-3">
        ({fmt(num)}/{fmt(den)})
      </span>
    </span>
  );
}
