const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** 36m, 2h 14m, 3d 4h */
export function fmtDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < MIN) return '<1m';
  if (abs < HOUR) return `${Math.floor(abs / MIN)}m`;
  if (abs < DAY) {
    const h = Math.floor(abs / HOUR);
    const m = Math.floor((abs % HOUR) / MIN);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(abs / DAY);
  const h = Math.floor((abs % DAY) / HOUR);
  return h ? `${d}d ${h}h` : `${d}d`;
}

/** SLA targets stored in minutes: 15 min, 4 hours, 3 days */
export function fmtTarget(mins: number): string {
  if (mins < 60) return `${mins} min`;
  if (mins < 48 * 60) {
    const h = mins / 60;
    return `${Number.isInteger(h) ? h : h.toFixed(1)} ${h === 1 ? 'hour' : 'hours'}`;
  }
  const d = mins / (24 * 60);
  return `${Number.isInteger(d) ? d : d.toFixed(1)} days`;
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const dateYearFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const weekdayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });

export const fmtDate = (ts: number) => dateFmt.format(ts);
export const fmtDateYear = (ts: number) => dateYearFmt.format(ts);
export const fmtTime = (ts: number) => timeFmt.format(ts);
export const fmtWeekday = (ts: number) => weekdayFmt.format(ts);
export const fmtDateTime = (ts: number) => `${dateFmt.format(ts)}, ${timeFmt.format(ts)}`;

export function fmtRelative(ts: number, now: number): string {
  const diff = now - ts;
  if (diff < MIN) return 'Just now';
  if (diff < 7 * DAY) return `${fmtDuration(diff)} ago`;
  return fmtDateYear(ts);
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function toDateInput(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fromDateInput(value: string): number | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

export const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

export function initials(name: string): string {
  const parts = name.replace(/^dr\.\s*/i, '').split(' ').filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function greeting(now: number): string {
  const h = new Date(now).getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
