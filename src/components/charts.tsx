import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './ui';

/* Chart colours. The gauge orders its parts resolved, in progress, new, so
   each adjacent pair stays apart for colour-blind readers (ΔE 8.2 and 9.4);
   resolved and new are never adjacent. */
export const CHART = {
  resolved: '#C11FFF',
  progress: '#FF00C6',
  created: '#0E39FC',
  open: '#C11FFF',
  grid: '#EFEDF4',
  track: '#F1EEF5',
};

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Smooth path through points (Catmull-Rom converted to cubic Béziers). */
function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function TipRow({ color, label, value }: { color: string; label: string; value: ReactNode }) {
  return (
    <p className="chart-tip-row">
      <span className="chart-tip-key" style={{ background: color }} aria-hidden />
      <span>{label}</span>
      <strong>{value}</strong>
    </p>
  );
}

/* ---------- Sparkline: one series, a few points, no axis ---------- */

export function Sparkline({ points, label, height = 92 }: { points: { label: string; title: string; value: number }[]; label: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const padX = 18;
  const top = 10;
  const plotH = height - top - 6;
  const max = Math.max(...points.map((p) => p.value), 1);
  const min = Math.min(...points.map((p) => p.value));
  const span = Math.max(max - min, 1);
  const x = (i: number) => padX + ((width - padX * 2) * i) / Math.max(n - 1, 1);
  const y = (v: number) => top + plotH - ((v - min) / span) * plotH * 0.85 - plotH * 0.08;
  const pts = points.map((p, i) => [x(i), y(p.value)] as [number, number]);
  const active = hover ?? n - 1;

  return (
    <div className="sparkline" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height + 22} role="img" aria-label={`${label}. Data is also available in the table below.`} onPointerLeave={() => setHover(null)}>
          {pts.map(([px], i) => (
            <line key={i} x1={px} x2={px} y1={top} y2={top + plotH} stroke={CHART.grid} />
          ))}
          <path d={smoothPath(pts)} fill="none" stroke={CHART.open} strokeWidth={2.25} strokeLinecap="round" />
          <circle cx={pts[active][0]} cy={pts[active][1]} r={9} fill={CHART.open} opacity={0.14} />
          <circle cx={pts[active][0]} cy={pts[active][1]} r={4.5} fill={CHART.open} stroke="#fff" strokeWidth={2} />
          {points.map((p, i) => (
            <text key={i} x={x(i)} y={height + 16} textAnchor="middle" className={cx('chart-tick', i === active && 'is-active')}>
              {p.label}
            </text>
          ))}
          {points.map((_, i) => (
            <rect key={i} x={x(i) - (width / n) / 2} y={0} width={width / n} height={height + 22} fill="transparent" onPointerEnter={() => setHover(i)} />
          ))}
        </svg>
      )}
      {hover != null && (
        <div className={cx('chart-tip chart-tip-sm', x(hover) > width / 2 && 'is-left')} style={x(hover) > width / 2 ? { right: width - x(hover) + 12 } : { left: x(hover) + 12 }}>
          <p className="chart-tip-title">{points[hover].title}</p>
          <TipRow color={CHART.open} label="Open" value={points[hover].value} />
        </div>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.title}>
              <th>{p.title}</th>
              <td>{p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Gauge: one whole split into parts, on a half circle ---------- */

export interface GaugePart {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Point on a circle centred at (cx, cy); angle in radians, 0 = right, π = left, measured upwards. */
const polar = (cx: number, cy: number, r: number, a: number) => `${cx + r * Math.cos(a)},${cy - r * Math.sin(a)}`;

/**
 * Annular sector from angle a0 down to a1 (a0 > a1), shrunk by `inset` on every
 * side. Drawn with a stroke of 2 × inset in the same colour, it fills back out
 * to full size with corners rounded by `inset`.
 */
function sectorPath(cx: number, cy: number, outer: number, inner: number, a0: number, a1: number, inset: number) {
  const mid = (outer + inner) / 2;
  const da = inset / mid;
  const s = a0 - da;
  const e = Math.min(a1 + da, s - 0.002);
  const ro = outer - inset;
  const ri = inner + inset;
  return `M${polar(cx, cy, ro, s)} A${ro},${ro} 0 0 1 ${polar(cx, cy, ro, e)} L${polar(cx, cy, ri, e)} A${ri},${ri} 0 0 0 ${polar(cx, cy, ri, s)} Z`;
}

export function Gauge({ parts, total, caption, label }: { parts: GaugePart[]; total: number; caption: ReactNode; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const size = Math.min(width, 300);
  const thick = Math.round(Math.max(22, size * 0.1));
  const outer = size / 2;
  const inner = outer - thick;
  const cx = width / 2;
  const cy = outer;
  const inset = 4;
  const gap = 4;
  const sum = parts.reduce((s, p) => s + p.value, 0);

  const shown = parts.filter((p) => p.value > 0);
  const gapA = gap / ((outer + inner) / 2);
  const free = Math.PI - gapA * Math.max(shown.length - 1, 0);
  let cursor = Math.PI;
  const arcs = shown.map((p) => {
    const span = sum ? (p.value / sum) * free : 0;
    const a0 = cursor;
    const a1 = cursor - span;
    cursor = a1 - gapA;
    return { ...p, a0, a1, index: parts.indexOf(p) };
  });
  const active = hover != null ? parts[hover] : null;

  return (
    <div className="gauge" ref={ref}>
      {width > 0 && (
        <svg width={width} height={cy + 2} role="img" aria-label={`${label}. Data is also available in the table below.`} onPointerLeave={() => setHover(null)}>
          <path d={sectorPath(cx, cy, outer, inner, Math.PI, 0, inset)} fill={CHART.track} stroke={CHART.track} strokeWidth={inset * 2} strokeLinejoin="round" />
          {arcs.map((a) => (
            <path
              key={a.key}
              d={sectorPath(cx, cy, outer, inner, a.a0, a.a1, inset)}
              fill={a.color}
              stroke={a.color}
              strokeWidth={inset * 2}
              strokeLinejoin="round"
              opacity={hover == null || hover === a.index ? 1 : 0.3}
              onPointerEnter={() => setHover(a.index)}
              onPointerMove={() => setHover(a.index)}
              style={{ cursor: 'default', transition: 'opacity .15s' }}
            />
          ))}
        </svg>
      )}
      <div className="gauge-center" aria-live="polite">
        <strong className="gauge-value">{active ? active.value : total}</strong>
        <span className="gauge-caption">{active ? `${active.label}, ${sum ? Math.round((active.value / sum) * 100) : 0}%` : caption}</span>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {parts.map((p) => (
            <tr key={p.key}>
              <th>{p.label}</th>
              <td>{p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


/* ---------- Tick meter: a share shown as filled ticks ---------- */

const TICKS = 16;

export function TickMeter({ share }: { share: number }) {
  const filled = share > 0 ? Math.max(1, Math.round(share * TICKS)) : 0;
  return (
    <span className="ticks" aria-hidden>
      {Array.from({ length: TICKS }, (_, i) => (
        <span key={i} className={i < filled ? 'is-on' : undefined} />
      ))}
    </span>
  );
}

/* ---------- Segmented bar: one whole split into parts ---------- */

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
  /** Text colour inside the block. */
  ink: string;
}

export function SegmentedBar({ segments, ariaLabel }: { segments: Segment[]; ariaLabel: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const summary = segments.map((s) => `${s.label} ${s.value}`).join(', ');
  if (total === 0) return <div className="segbar segbar-empty" role="img" aria-label={`${ariaLabel}: no tickets`} />;
  return (
    <div className="segbar" role="img" aria-label={`${ariaLabel}: ${summary}`}>
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <span key={s.key} className="segbar-part" title={`${s.label}: ${s.value} (${Math.round((s.value / total) * 100)}%)`} style={{ flexGrow: s.value, background: s.color, color: s.ink }}>
            {s.value}
          </span>
        ))}
    </div>
  );
}
