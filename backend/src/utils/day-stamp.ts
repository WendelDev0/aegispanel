/**
 * Calendar day in the panel's own timezone.
 *
 * The WhatsApp flow counters used `toISOString().slice(0, 10)`, which is
 * always UTC. On a Brazilian panel that rolls "hoje" over at 21:00 local:
 * the operator watched runsToday reset in the middle of the evening and
 * reported the flow as broken. Node resolves `TZ` through its bundled ICU
 * (the Alpine image has no /usr/share/zoneinfo, but that only affects the
 * shell's `date`), so formatting is enough — no tzdata lookup involved.
 *
 * 'en-CA' is the locale that renders as YYYY-MM-DD, which is what the
 * stored `stats.day` string compares against.
 */
export function localDayStamp(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
