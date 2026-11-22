import type { Ticket } from '../types';
import { fmtDate, fmtWeekday, startOfDay } from './format';

const DAY = 24 * 60 * 60_000;

export const doneAt = (t: Ticket) => t.resolvedAt ?? t.canceledAt;

export interface ActivityBucket {
  start: number;
  end: number;
  /** Short axis label. */
  label: string;
  /** Full label for tooltips and the table view. */
  title: string;
  created: number;
  resolved: number;
  /** Tickets still open at the end of the bucket. */
  open: number;
}

export type RangeDays = 7 | 30 | 90;

/** Daily buckets for 7 and 30 days, weekly buckets for 90 days. */
export function activitySeries(tickets: Ticket[], now: number, range: RangeDays): ActivityBucket[] {
  const tomorrow = startOfDay(now) + DAY;
  const step = range === 90 ? 7 : 1;
  const count = range === 90 ? 13 : range;
  const buckets: ActivityBucket[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const end = tomorrow - i * step * DAY;
    const start = end - step * DAY;
    const last = end - DAY;
    buckets.push({
      start,
      end,
      label: range === 7 ? fmtWeekday(start) : fmtDate(start),
      title: step === 1 ? `${fmtWeekday(start)}, ${fmtDate(start)}` : `${fmtDate(start)} – ${fmtDate(last)}`,
      created: 0,
      resolved: 0,
      open: 0,
    });
  }
  for (const t of tickets) {
    const done = doneAt(t);
    for (const b of buckets) {
      if (t.createdAt >= b.start && t.createdAt < b.end) b.created++;
      if (done != null && done >= b.start && done < b.end) b.resolved++;
      const cutoff = Math.min(b.end, now);
      if (t.createdAt < cutoff && (done == null || done >= cutoff)) b.open++;
    }
  }
  return buckets;
}

/** Tickets open at a given moment in the past. */
export function openAt(tickets: Ticket[], at: number): number {
  let n = 0;
  for (const t of tickets) {
    const done = doneAt(t);
    if (t.createdAt < at && (done == null || done >= at)) n++;
  }
  return n;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
