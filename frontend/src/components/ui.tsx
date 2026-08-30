import React from 'react';

/**
 * Shared primitives for the Aegis Command look.
 *
 * These exist so density and hairline treatment are defined once. Pages that
 * still carry the older rounded/shadow styling keep working; they migrate by
 * swapping their markup for these.
 */

export type Tone = 'neutral' | 'ok' | 'warn' | 'crit' | 'info';

/** The subset a utilisation percentage can map to. */
export type UsageTone = Extract<Tone, 'ok' | 'warn' | 'crit'>;

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-on-surface-variant',
  ok: 'text-ok',
  warn: 'text-warn',
  crit: 'text-crit',
  info: 'text-tertiary',
};

const TONE_BADGE: Record<Tone, string> = {
  neutral: 'bg-surface-container-high text-on-surface-variant border-outline-variant',
  ok: 'bg-ok/10 text-ok border-ok/30',
  warn: 'bg-warn/10 text-warn border-warn/30',
  crit: 'bg-crit/10 text-crit border-crit/30',
  info: 'bg-tertiary/10 text-tertiary border-tertiary/30',
};

const TONE_BAR: Record<Tone, string> = {
  neutral: 'bg-outline',
  ok: 'bg-ok',
  warn: 'bg-warn',
  crit: 'bg-crit',
  info: 'bg-tertiary',
};

/** Level 1 surface. An optional left accent bar carries the status colour. */
export const Panel: React.FC<{
  children: React.ReactNode;
  className?: string;
  accent?: Tone;
}> = ({ children, className = '', accent }) => (
  <div
    className={`relative bg-surface-container border border-outline-variant rounded-lg overflow-hidden ${className}`}
  >
    {accent && <span className={`absolute inset-y-0 left-0 w-[3px] ${TONE_BAR[accent]}`} aria-hidden />}
    {children}
  </div>
);

/** Section heading with an optional trailing control cluster. */
export const SectionHeader: React.FC<{
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}> = ({ icon, title, subtitle, actions, className = '' }) => (
  <div className={`flex items-start justify-between gap-4 flex-wrap ${className}`}>
    <div className="flex items-start gap-2.5 min-w-0">
      {icon && <span className="text-primary shrink-0 mt-0.5">{icon}</span>}
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-on-surface tracking-[-0.01em]">{title}</h3>
        {subtitle && <p className="text-xs text-on-surface-variant/80 mt-0.5">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

/**
 * Telemetry card: micro-label, large value, monospaced unit, and a thin fill
 * bar along the bottom edge showing utilisation.
 */
export const StatCard: React.FC<{
  label: string;
  value: string | number;
  unit?: string;
  detail?: string;
  icon?: React.ReactNode;
  /** 0-100. Renders the bottom fill bar when provided. */
  percent?: number;
  tone?: Tone;
}> = ({ label, value, unit, detail, icon, percent, tone = 'info' }) => (
  <div className="relative bg-surface-container border border-outline-variant rounded-lg p-4 overflow-hidden">
    <div className="flex items-start justify-between gap-2 mb-3">
      <span className="mono-label">{label}</span>
      {icon && <span className={`shrink-0 ${TONE_TEXT[tone]}`}>{icon}</span>}
    </div>

    <div className="flex items-baseline gap-2 flex-wrap">
      <span className="text-[28px] leading-none font-bold text-on-surface tracking-[-0.02em] tabular-nums">
        {value}
      </span>
      {unit && <span className="font-mono text-xs text-on-surface-variant">{unit}</span>}
    </div>

    {detail && <p className="font-mono text-2xs text-on-surface-variant/70 mt-2 truncate">{detail}</p>}

    {percent !== undefined && (
      <span
        className={`absolute bottom-0 left-0 h-[3px] ${TONE_BAR[tone]}`}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        aria-hidden
      />
    )}
  </div>
);

/** Compact metric tile used inside a card, with an optional utilisation bar. */
export const MetricTile: React.FC<{
  label: string;
  value: string;
  icon?: React.ReactNode;
  percent?: number;
  tone?: Tone;
}> = ({ label, value, icon, percent, tone = 'info' }) => (
  <div className={`bg-surface-container-lowest border rounded p-2.5 ${tone === 'crit' ? 'border-crit/40' : 'border-outline-variant'}`}>
    <div className="flex items-center gap-1.5 mb-1">
      {icon && <span className="text-on-surface-variant/70 shrink-0">{icon}</span>}
      <span className="text-2xs text-on-surface-variant/80 truncate">{label}</span>
    </div>
    <p className={`font-mono text-sm ${tone === 'crit' ? 'text-crit' : 'text-on-surface'}`}>{value}</p>
    {percent !== undefined && (
      <div className="h-1 bg-surface-container-high rounded-full mt-2 overflow-hidden">
        <div
          className={`h-full rounded-full ${TONE_BAR[tone]}`}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    )}
  </div>
);

/** Pill badge. Subtle tinted background, full-opacity text. */
export const Badge: React.FC<{
  children: React.ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}> = ({ children, tone = 'neutral', dot, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1.5 text-2xs font-medium px-2 py-0.5 rounded-full border ${TONE_BADGE[tone]} ${className}`}
  >
    {dot && <span className={`w-1.5 h-1.5 rounded-full ${TONE_BAR[tone]}`} aria-hidden />}
    {children}
  </span>
);

/** Thin allocation bar, for resource usage outside a card. */
export const Meter: React.FC<{ percent: number; tone?: Tone; className?: string }> = ({
  percent,
  tone = 'info',
  className = '',
}) => (
  <div className={`h-1.5 bg-surface-container-high rounded-full overflow-hidden ${className}`}>
    <div
      className={`h-full rounded-full ${TONE_BAR[tone]}`}
      style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
    />
  </div>
);

/**
 * Picks a tone from a utilisation percentage, so "how full is it" and "how
 * worried should I be" never disagree between two places in the UI.
 */
export function toneForUsage(percent: number): UsageTone {
  if (percent >= 90) return 'crit';
  if (percent >= 75) return 'warn';
  return 'ok';
}
