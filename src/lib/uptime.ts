import type { Asset } from '../types';
import { startOfDay } from './format';

const DAY = 24 * 60 * 60_000;
const DAY_MINS = 24 * 60;

export interface UptimeDay {
  /** Start of the day. */
  at: number;
  /** Share of the day the asset was up, 0 to 100. Null before monitoring started. */
  pct: number | null;
  /** Minutes down that day. */
  downMins: number;
}

/** Small deterministic generator, so an asset's history is the same every visit. */
function seeded(key: string) {
  let a = [...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 2166136261);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The last `days` days of uptime for an asset, oldest first. The sample keeps
 * the last 30 days in line with the asset's 30-day uptime figure, spreads a
 * few short incidents over the rest, and marks today by the live status.
 * An asset with no readings yet shows no data.
 */
export function uptimeHistory(asset: Asset, now: number, days = 90): UptimeDay[] {
  const rnd = seeded(asset.id);
  const today = startOfDay(now);
  // Some assets were put under monitoring part way through the window.
  const monitored = asset.uptime30d == null ? 0 : rnd() < 0.35 ? 40 + Math.floor(rnd() * 30) : days;
  const out: UptimeDay[] = Array.from({ length: days }, (_, i) => ({ at: today - (days - 1 - i) * DAY, pct: null, downMins: 0 }));
  if (!monitored) return out;
  for (let i = days - monitored; i < days; i++) out[i].pct = 100;

  // Last 30 days: the downtime the 30-day figure implies, in one to three incidents.
  const recentDown = Math.round(((100 - (asset.uptime30d ?? 100)) / 100) * 30 * DAY_MINS);
  const recentDays = Math.min(30, monitored);
  const incidents = recentDown === 0 ? 0 : Math.min(recentDays, 1 + Math.floor(rnd() * 3));
  for (let k = 0; k < incidents; k++) {
    const i = days - 1 - Math.floor(rnd() * recentDays);
    out[i].downMins += Math.round(recentDown / incidents);
  }
  // Older days: the odd short blip.
  for (let i = days - monitored; i < days - 30; i++) if (rnd() < 0.05) out[i].downMins += 5 + Math.floor(rnd() * 40);

  // Today follows what the asset is doing right now.
  const last = out[days - 1];
  if (asset.status === 'degraded') last.downMins = Math.max(last.downMins, 25);
  if (asset.status === 'outage') last.downMins = Math.max(last.downMins, 180);

  for (const d of out) if (d.pct != null) d.pct = Math.max(0, 100 - (d.downMins / DAY_MINS) * 100);
  return out;
}

/** Uptime over the days that have readings. Null when none do. */
export function uptimeOver(days: UptimeDay[]): number | null {
  const read = days.filter((d) => d.pct != null);
  if (!read.length) return null;
  return read.reduce((s, d) => s + (d.pct ?? 0), 0) / read.length;
}

export type UptimeLevel = 'up' | 'partial' | 'down' | 'none';
/** How a day reads: fully up, a short outage, a long one, or no data. */
export const uptimeLevel = (d: UptimeDay): UptimeLevel => (d.pct == null ? 'none' : d.downMins === 0 ? 'up' : d.downMins < 60 ? 'partial' : 'down');
