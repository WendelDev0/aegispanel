/**
 * Retention decided by the panel, not a bucket lifecycle rule: those differ
 * between AWS, R2, B2 and MinIO, and a misconfigured rule would delete the
 * only copy. After each successful upload we list our prefix and drop objects
 * that fall outside daily-14 / weekly-8 / monthly-12.
 */
export interface DatedObject {
  key: string;
  lastModified: Date;
  sizeBytes?: number;
}

export function keysToDelete(objects: DatedObject[], now = new Date()): string[] {
  if (!objects.length) return [];

  const keep = new Set<string>();
  const byDay = new Map<string, DatedObject>();
  const byWeek = new Map<string, DatedObject>();
  const byMonth = new Map<string, DatedObject>();

  for (const obj of objects) {
    const day = utcStamp(obj.lastModified, 'day');
    const week = utcStamp(obj.lastModified, 'week');
    const month = utcStamp(obj.lastModified, 'month');
    const takeLatest = (map: Map<string, DatedObject>, stamp: string) => {
      const prev = map.get(stamp);
      if (!prev || obj.lastModified > prev.lastModified) map.set(stamp, obj);
    };
    takeLatest(byDay, day);
    takeLatest(byWeek, week);
    takeLatest(byMonth, month);
  }

  const dayCutoff = addUtcDays(now, -14);
  for (const [stamp, obj] of byDay) {
    if (parseUtcStamp(stamp, 'day') >= dayCutoff) keep.add(obj.key);
  }

  const weekCutoff = addUtcDays(now, -8 * 7);
  for (const [stamp, obj] of byWeek) {
    if (parseUtcStamp(stamp, 'week') >= weekCutoff) keep.add(obj.key);
  }

  const monthCutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  for (const [stamp, obj] of byMonth) {
    if (parseUtcStamp(stamp, 'month') >= monthCutoff) keep.add(obj.key);
  }

  return objects.filter((o) => !keep.has(o.key)).map((o) => o.key);
}

function utcStamp(at: Date, kind: 'day' | 'week' | 'month'): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, '0');
  const d = String(at.getUTCDate()).padStart(2, '0');
  if (kind === 'month') return `${y}-${m}`;
  if (kind === 'day') return `${y}-${m}-${d}`;
  const jan1 = Date.UTC(y, 0, 1);
  const week = Math.floor((Date.UTC(y, at.getUTCMonth(), at.getUTCDate()) - jan1) / 86400000 / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}

function parseUtcStamp(stamp: string, kind: 'day' | 'week' | 'month'): Date {
  if (kind === 'month') {
    const [y, m] = stamp.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1));
  }
  if (kind === 'day') {
    const [y, m, d] = stamp.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const [yPart, wPart] = stamp.split('-W');
  const y = Number(yPart);
  const week = Number(wPart);
  return new Date(Date.UTC(y, 0, 1 + week * 7));
}

function addUtcDays(at: Date, days: number): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + days));
}

/** Groups object keys by the directory that holds them (panel vs each database). */
export function groupByPrefix(objects: DatedObject[]): Map<string, DatedObject[]> {
  const groups = new Map<string, DatedObject[]>();
  for (const obj of objects) {
    const slash = obj.key.lastIndexOf('/');
    const dir = slash >= 0 ? obj.key.slice(0, slash) : '';
    const list = groups.get(dir) || [];
    list.push(obj);
    groups.set(dir, list);
  }
  return groups;
}
