import { useMemo, useState } from 'react';
import { CircleCheck, CircleHelp, CircleX, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react';
import type { Asset, AssetStatus } from '../types';
import { ASSET_STATUS_LABEL } from '../lib/domain';
import { fmtDateYear, fmtDuration } from '../lib/format';
import { uptimeHistory, uptimeLevel, uptimeOver, type UptimeLevel } from '../lib/uptime';
import { useStore } from '../store';
import { cx } from './ui';

const STATUS_ICON: Record<AssetStatus, { icon: LucideIcon; tone: string }> = {
  operational: { icon: CircleCheck, tone: 'green' },
  degraded: { icon: TriangleAlert, tone: 'orange' },
  outage: { icon: CircleX, tone: 'red' },
  maintenance: { icon: Wrench, tone: 'blue' },
  unknown: { icon: CircleHelp, tone: 'neutral' },
};

const LEGEND: { level: UptimeLevel; label: string }[] = [
  { level: 'up', label: 'No downtime' },
  { level: 'partial', label: 'Under 1 hour down' },
  { level: 'down', label: '1 hour or more down' },
  { level: 'none', label: 'No data' },
];

/**
 * Each asset's uptime over the last 90 days, one bar per day: how the client's
 * websites and apps have held up, at a glance. Hover a day for its numbers.
 */
export function UptimeCard({ assets, days = 90 }: { assets: Asset[]; days?: number }) {
  return (
    <section className="uptime-card" aria-labelledby="uptime-title">
      <header className="uptime-head">
        <h3 id="uptime-title" className="uptime-title">
          Uptime <span className="uptime-range">Last {days} days</span>
        </h3>
        <ul className="uptime-legend" aria-label="Legend">
          {LEGEND.map((l) => (
            <li key={l.level}>
              <span className={cx('uptime-swatch', `is-${l.level}`)} aria-hidden />
              {l.label}
            </li>
          ))}
        </ul>
      </header>
      <div className="uptime-rows">
        {assets.map((a) => (
          <UptimeRow key={a.id} asset={a} days={days} />
        ))}
      </div>
    </section>
  );
}

function UptimeRow({ asset, days }: { asset: Asset; days: number }) {
  const { now } = useStore();
  const history = useMemo(() => uptimeHistory(asset, now, days), [asset, now, days]);
  const overall = uptimeOver(history);
  const [hover, setHover] = useState<number | null>(null);
  const { icon: Icon, tone } = STATUS_ICON[asset.status];
  const shown = hover != null ? history[hover] : null;
  const pctText = overall == null ? 'No data yet' : `${overall.toFixed(2)}%`;

  return (
    <div className="uptime-row">
      <div className="uptime-row-head">
        <span className={cx('uptime-status', `tone-${tone}`)} title={ASSET_STATUS_LABEL[asset.status]}>
          <Icon size={16} aria-hidden />
          <span className="sr-only">{ASSET_STATUS_LABEL[asset.status]}</span>
        </span>
        <span className="uptime-name">{asset.name}</span>
        <span className="uptime-pct">{pctText}</span>
      </div>
      <div className="uptime-bars" role="img" aria-label={`${asset.name}: ${pctText} uptime over the last ${days} days`} onMouseLeave={() => setHover(null)}>
        {history.map((d, i) => (
          <span key={d.at} className={cx('uptime-bar', `is-${uptimeLevel(d)}`, hover === i && 'is-hover')} onMouseEnter={() => setHover(i)} />
        ))}
        {shown && hover != null && (
          <div className="uptime-tip" style={{ left: `clamp(84px, ${((hover + 0.5) / history.length) * 100}%, calc(100% - 84px))` }} aria-hidden>
            <span className="uptime-tip-date">{fmtDateYear(shown.at)}</span>
            {shown.pct == null ? (
              <span>No data yet</span>
            ) : (
              <>
                <span className="uptime-tip-pct">{shown.pct.toFixed(2)}% up</span>
                <span>{shown.downMins === 0 ? 'No downtime' : `Down for ${fmtDuration(shown.downMins * 60_000)}`}</span>
              </>
            )}
          </div>
        )}
      </div>
      <div className="uptime-axis" aria-hidden>
        <span>{days} days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}
