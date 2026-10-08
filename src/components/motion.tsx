'use client';

import { motion, MotionConfig, useSpring, useTransform } from 'motion/react';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useRef } from 'react';

/** Wraps the whole app once: every animation below respects the OS "reduce motion" setting. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

const EASE = [0.16, 1, 0.3, 1] as const;

/** A route's content fades and rises in on navigation, instead of appearing instantly. */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <motion.div key={pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE }}>
      {children}
    </motion.div>
  );
}

/** Fades a section in once, slightly delayed — use for cards that should settle in after the page shell. */
export function Reveal({
  children,
  delay = 0,
  className,
  role,
  as = 'div',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  role?: string;
  as?: 'div' | 'section';
}) {
  const MotionTag = as === 'section' ? motion.section : motion.div;
  return (
    <MotionTag
      className={className}
      role={role}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: EASE }}
    >
      {children}
    </MotionTag>
  );
}

/** Wraps a list of items (e.g. KPI cards) so each one fades in slightly after the last. */
export function Stagger({ children, className }: { children: ReactNode[]; className?: string }) {
  return (
    <motion.div className={className} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.045 } } }}>
      {children.map((child, i) => (
        <motion.div key={i} variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }} transition={{ duration: 0.3, ease: EASE }}>
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
}

/**
 * Counts up to `value` instead of popping in. Real numbers only — this never invents data, it only
 * animates the same figure the server computed. Jumps straight to the value under reduced motion.
 */
export function AnimatedNumber({ value, format }: { value: number; format?: (n: number) => string }) {
  const fmt = format ?? ((n: number) => new Intl.NumberFormat('en-IN').format(Math.round(n)));
  const spring = useSpring(0, { stiffness: 120, damping: 20, mass: 0.6 });
  const display = useTransform(spring, (v) => fmt(v));
  const first = useRef(true);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      spring.jump(value);
    } else if (first.current) {
      // Count up from zero the first time a card mounts, then just glide to new values on refresh.
      spring.jump(0);
      spring.set(value);
    } else {
      spring.set(value);
    }
    first.current = false;
  }, [value, spring]);
  return <motion.span className="tabular">{display}</motion.span>;
}

/** A horizontal bar that grows into place instead of appearing at full width. */
export function AnimatedBar({ pct, className = 'bg-brand', trackClassName = 'bg-slate-100' }: { pct: number; className?: string; trackClassName?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className={`h-1.5 overflow-hidden rounded-full ${trackClassName}`}>
      <motion.div
        className={`h-full rounded-full ${className}`}
        initial={{ width: 0 }}
        animate={{ width: `${clamped}%` }}
        transition={{ duration: 0.6, ease: EASE }}
      />
    </div>
  );
}

/** Subtle hover/press feedback for a clickable card — lifts a couple of px, settles back on release. */
export function Lift({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} whileHover={{ y: -2 }} whileTap={{ y: 0, scale: 0.99 }} transition={{ duration: 0.15, ease: EASE }}>
      {children}
    </motion.div>
  );
}

/** Several proportional segments side by side in one track (e.g. accepted/failed/replies for a day), each growing in. */
export function AnimatedSegments({ segments, className = 'bg-slate-100' }: { segments: { pct: number; className: string; title?: string }[]; className?: string }) {
  return (
    <span className={`flex h-full flex-1 overflow-hidden rounded-sm ${className}`}>
      {segments.map((s, i) => (
        <motion.span
          key={i}
          className={`h-full ${s.className}`}
          title={s.title}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(0, Math.min(100, s.pct))}%` }}
          transition={{ duration: 0.5, ease: EASE, delay: i * 0.04 }}
        />
      ))}
    </span>
  );
}
