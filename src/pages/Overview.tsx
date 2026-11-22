import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, CircleCheck, CircleX, Ticket as TicketIcon, TriangleAlert } from 'lucide-react';
import type { AssetStatus } from '../types';
import { CATEGORIES, isOpen } from '../lib/domain';
import { fmtDuration, greeting, pct, startOfDay } from '../lib/format';
import { activitySeries, doneAt, openAt, type RangeDays } from '../lib/stats';
import { useStore } from '../store';
import { CHART, Gauge, Sparkline, TickMeter, type GaugePart } from '../components/charts';
import { AssetStatusBadge, CategoryLabel, SlaIndicator } from '../components/domain';
import { TicketTable } from '../components/TicketTable';
import { Card, CardHeader, Select, cx } from '../components/ui';

const DAY = 24 * 60 * 60_000;
const ASSET_ORDER: AssetStatus[] = ['outage', 'degraded', 'unknown', 'maintenance', 'operational'];
function Trend({ value, suffix = '', goodWhen, children }: { value: number; suffix?: string; goodWhen: 'up' | 'down'; children: string }) {
  if (value === 0) return <span className="trend">No change {children}</span>;
  const up = value > 0;
  const good = (goodWhen === 'up') === up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="trend">
      <span className={cx('trend-value', good ? 'is-good' : 'is-bad')}>
        <Icon size={15} aria-hidden />
        {Math.abs(value)}
        {suffix}
        <span className="sr-only">{up ? ' more' : ' fewer'}</span>
      </span>
      {children}
    </span>
  );
}

export function Overview() {
  const { tickets, now, currentUser, slaOf, assets, clients, clientOf } = useStore();
  const [range, setRange] = useState<RangeDays>(7);

  const open = useMemo(() => tickets.filter(isOpen), [tickets]);
  const fresh = useMemo(() => open.filter((t) => t.status === 'new').sort((a, b) => b.createdAt - a.createdAt), [open]);

  const kpi = useMemo(() => {
    const critical = open.filter((t) => t.severity === 'critical');
    const awaiting = open.filter((t) => !t.firstRespondedAt);
    const month = new Date(now);
    const monthStart = new Date(month.getFullYear(), month.getMonth(), 1).getTime();
    const prevStart = new Date(month.getFullYear(), month.getMonth() - 1, 1).getTime();
    const prevEnd = Math.min(prevStart + (now - monthStart), monthStart);
    let resolvedMonth = 0;
    let resolvedPrev = 0;
    for (const t of tickets) {
      const d = doneAt(t);
      if (d == null) continue;
      if (d >= monthStart) resolvedMonth++;
      else if (d >= prevStart && d < prevEnd) resolvedPrev++;
    }
    return {
      openDelta: open.length - openAt(tickets, now - 7 * DAY),
      critical,
      awaiting,
      oldestAwaiting: awaiting.length ? now - Math.min(...awaiting.map((t) => t.createdAt)) : 0,
      resolvedMonth,
      resolvedDelta: resolvedPrev ? Math.round(((resolvedMonth - resolvedPrev) / resolvedPrev) * 100) : 0,
    };
  }, [open, tickets, now]);

  const sla = useMemo(() => {
    const withSla = open.map((t) => ({ t, sla: slaOf(t) }));
    const count = (s: string) => withSla.filter((x) => x.sla.overall === s).length;
    return {
      within: count('within'),
      atRisk: count('at_risk'),
      breached: count('breached'),
      next: withSla
        .filter((x) => x.sla.overall !== 'breached')
        .sort((a, b) => a.sla.active.remainingMs - b.sla.active.remainingMs)
        .slice(0, 4),
    };
  }, [open, slaOf]);
  const criticalAtRisk = kpi.critical.filter((t) => slaOf(t).overall !== 'within').length;

  const week = useMemo(() => activitySeries(tickets, now, 7), [tickets, now]);

  // Tickets received in the period (same window as the ticket list's "Created" filter), by where they are now.
  const received = useMemo(() => {
    const start = startOfDay(now) - (range - 1) * DAY;
    const list = tickets.filter((t) => t.createdAt >= start);
    const resolved = list.filter((t) => !isOpen(t)).length;
    const fresh = list.filter((t) => t.status === 'new').length;
    const parts: GaugePart[] = [
      { key: 'resolved', label: 'Resolved', value: resolved, color: CHART.resolved },
      { key: 'progress', label: 'In progress', value: list.length - resolved - fresh, color: CHART.progress },
      { key: 'new', label: 'New', value: fresh, color: CHART.created },
    ];
    return { total: list.length, parts };
  }, [tickets, now, range]);

  const byCategory = useMemo(
    () =>
      CATEGORIES.map((c) => {
        const list = open.filter((t) => t.category === c);
        return { c, n: list.length, severe: list.filter((t) => t.severity === 'critical' || t.severity === 'high').length };
      })
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n),
    [open],
  );

  const assetHealth = useMemo(() => {
    const sorted = [...assets].sort((a, b) => ASSET_ORDER.indexOf(a.status) - ASSET_ORDER.indexOf(b.status));
    const attention = sorted.filter((a) => a.status !== 'operational');
    return { operational: assets.length - attention.length, list: (attention.length ? attention : sorted).slice(0, 5), more: Math.max(0, attention.length - 5) };
  }, [assets]);

  const recent = useMemo(() => [...tickets].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8), [tickets]);

  // The one thing most worth acting on right now, in plain words. New
  // tickets come first: nobody has looked at them yet.
  const insight = useMemo(() => {
    const backlog =
      kpi.openDelta > 0
        ? `The backlog grew by ${kpi.openDelta} this week: tickets are arriving faster than they are resolved.`
        : kpi.openDelta < 0
          ? `The backlog shrank by ${-kpi.openDelta} this week.`
          : 'The backlog is level with last week.';
    if (fresh.length > 0) {
      const n = fresh.length;
      const urgent = fresh.filter((t) => t.severity === 'critical' || t.severity === 'high').length;
      const oldest = now - fresh[fresh.length - 1].createdAt;
      const urgentText = urgent === 0 ? '' : urgent === n ? `${n === 1 ? 'It is' : 'All are'} critical or high. ` : `${urgent} of them ${urgent === 1 ? 'is' : 'are'} critical or high. `;
      const breachedText = sla.breached ? ` Separately, ${sla.breached} open ${sla.breached === 1 ? 'ticket has' : 'tickets have'} breached SLA.` : '';
      return {
        title: `${n} new ${n === 1 ? 'ticket is' : 'tickets are'} waiting to be assigned.`,
        body: `${urgentText}The oldest has waited ${fmtDuration(oldest)}.${breachedText}`,
        cta: n === 1 ? 'Review new ticket' : `Review ${n} new tickets`,
        to: '/tickets?status=new&sort=created&dir=asc',
      };
    }
    if (sla.breached > 0)
      return {
        title: `${sla.breached} open ${sla.breached === 1 ? 'ticket has' : 'tickets have'} breached SLA.`,
        body: `${sla.atRisk ? `${sla.atRisk} more ${sla.atRisk === 1 ? 'is' : 'are'} close to the deadline. ` : ''}${backlog}`,
        cta: 'Review breached tickets',
        to: '/tickets?status=open&sla=breached',
      };
    if (sla.atRisk > 0)
      return {
        title: `${sla.atRisk} ${sla.atRisk === 1 ? 'ticket is' : 'tickets are'} close to the SLA deadline.`,
        body: backlog,
        cta: 'Review at-risk tickets',
        to: '/tickets?status=open&sla=at_risk',
      };
    return { title: 'Every open ticket is within SLA.', body: backlog, cta: 'View open tickets', to: '/tickets?status=open' };
  }, [fresh, now, sla, kpi.openDelta]);

  const firstName = currentUser.name.split(' ')[0];
  const openClients = new Set(open.map((t) => t.clientId)).size;

  return (
    <div className="page">
      <header className="page-header hero" data-hero>
        <div className="page-header-row">
          <div className="page-header-text">
            <h1 className="welcome-title">
              {greeting(now)}, {firstName}.
            </h1>
            <p className="page-desc">
              {new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}. {open.length} open {open.length === 1 ? 'ticket' : 'tickets'}
              {openClients > 0 && ` across ${openClients === clients.length ? '' : `${openClients} of `}${clients.length} ${clients.length === 1 ? 'client' : 'clients'}`}.
            </p>
          </div>
        </div>
      </header>

      <div className="overview-grid">
        {/* Open backlog, with the other headline numbers beneath it */}
        <section className="card kpi-card" aria-labelledby="kpi-open">
          <div className="kpi-card-head">
            <span className="icon-tile" aria-hidden>
              <TicketIcon size={19} />
            </span>
            <h2 className="card-title" id="kpi-open">
              Total open tickets
            </h2>
          </div>
          <div className="kpi-card-main">
            <div className="kpi-card-figure">
              <Link to="/tickets?status=open" className="kpi-big">
                {open.length}
              </Link>
              <Trend value={kpi.openDelta} goodWhen="down">
                vs 7 days ago
              </Trend>
            </div>
            <Sparkline label="Open tickets at the end of each day, last 7 days" points={week.map((b) => ({ label: b.label, title: b.title, value: b.open }))} />
          </div>
          <ul className="mini-stats">
            <li>
              <Link to="/tickets?status=open&severity=critical" className="mini-stat">
                <span className="mini-stat-label">Critical</span>
                <strong>{kpi.critical.length}</strong>
                <span className={cx('mini-stat-note', criticalAtRisk > 0 && 'is-bad')}>{kpi.critical.length === 0 ? 'None open' : criticalAtRisk ? `${criticalAtRisk} at risk of SLA` : 'All within SLA'}</span>
              </Link>
            </li>
            <li>
              <Link to="/tickets?status=open&response=awaiting" className="mini-stat">
                <span className="mini-stat-label">Awaiting response</span>
                <strong>{kpi.awaiting.length}</strong>
                <span className="mini-stat-note">{kpi.awaiting.length ? `Oldest ${fmtDuration(kpi.oldestAwaiting)}` : 'All answered'}</span>
              </Link>
            </li>
            <li>
              <Link to="/tickets?status=done&range=month" className="mini-stat">
                <span className="mini-stat-label">Resolved this month</span>
                <strong>{kpi.resolvedMonth}</strong>
                <span className={cx('mini-stat-note', kpi.resolvedDelta < 0 && 'is-bad')}>
                  {kpi.resolvedDelta === 0 ? 'Same as last month' : `${kpi.resolvedDelta > 0 ? '+' : ''}${kpi.resolvedDelta}% vs last month`}
                </span>
              </Link>
            </li>
          </ul>
        </section>

        {/* What came in during the period, and where those tickets are now */}
        <section className="card activity-card" aria-labelledby="activity-title">
          <div className="card-header">
            <div>
              <h2 className="card-title" id="activity-title">
                Ticket activity
              </h2>
              <p className="card-desc">Received this period, by stage</p>
            </div>
            <Select
              size="sm"
              ariaLabel="Time range"
              value={String(range) as '7' | '30' | '90'}
              onChange={(v) => setRange(Number(v) as RangeDays)}
              options={[
                { value: '7', label: 'Last 7 days' },
                { value: '30', label: 'Last 30 days' },
                { value: '90', label: 'Last 90 days' },
              ]}
            />
          </div>
          <Gauge parts={received.parts} total={received.total} caption="Tickets received" label={`Tickets received in the last ${range} days, by current stage`} />
          <ul className="gauge-legend">
            {received.parts.map((p) => (
              <li key={p.key}>
                <span className="legend-key" style={{ background: p.color }} aria-hidden />
                <span className="gauge-legend-label">{p.label}</span>
                <strong>{p.value}</strong>
                <span className="gauge-legend-pct">{pct(p.value, received.total)}%</span>
              </li>
            ))}
          </ul>
        </section>

        {/* The single most important thing to act on, in plain words */}
        <section className="insight-card" aria-label="Needs attention">
          <h2>{insight.title}</h2>
          <p>{insight.body}</p>
          <Link to={insight.to} className="btn btn-light">
            {insight.cta}
          </Link>
        </section>

        {/* Deadlines get the wide card: they are what someone acts on next. */}
        <Card className="sla-card">
          <CardHeader
            title="SLA monitoring"
            description={`${open.length} open tickets against their deadlines`}
          />
          <ul className="sla-states">
            <li>
              <Link to="/tickets?status=open&sla=within" className="sla-state tone-purple">
                <CircleCheck size={16} aria-hidden />
                <span>Within SLA</span>
                <strong>{sla.within}</strong>
              </Link>
            </li>
            <li>
              <Link to="/tickets?status=open&sla=at_risk" className="sla-state tone-orange">
                <TriangleAlert size={16} aria-hidden />
                <span>Approaching deadline</span>
                <strong>{sla.atRisk}</strong>
              </Link>
            </li>
            <li>
              <Link to="/tickets?status=open&sla=breached" className="sla-state tone-red">
                <CircleX size={16} aria-hidden />
                <span>Breached</span>
                <strong>{sla.breached}</strong>
              </Link>
            </li>
          </ul>
          <h3 className="subhead">Next deadlines</h3>
          {sla.next.length === 0 ? (
            <p className="muted">No open deadlines.</p>
          ) : (
            <ul className="soft-list">
              {sla.next.map(({ t, sla: s }) => (
                <li key={t.id}>
                  <Link to={`/tickets/${t.id}`} className="soft-row deadline">
                    <span className="deadline-main">
                      <span className="truncate deadline-title">{t.title}</span>
                      <span className="deadline-sub">
                        <span className="ticket-id">{t.id}</span> {clientOf(t.clientId)?.name}
                      </span>
                    </span>
                    <SlaIndicator sla={s} showLabel />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Two short lists stacked beside the deadlines. */}
        <div className="overview-side">
          <Card className="asset-card">
            <CardHeader
              title="Asset health"
              description={`${assetHealth.operational} of ${assets.length} operational`}
              action={
                <Link to="/clients" className="btn btn-secondary btn-sm">
                  Clients
                </Link>
              }
            />
            <ul className="asset-list">
              {assetHealth.list.map((a) => (
                <li key={a.id}>
                  <Link to={`/clients/${a.clientId}?tab=assets`} className="asset-row">
                    <span className="asset-row-name">
                      <span className="truncate">{a.name}</span>
                      <span className="muted truncate">{clientOf(a.clientId)?.name}</span>
                    </span>
                    <AssetStatusBadge status={a.status} plain />
                  </Link>
                </li>
              ))}
            </ul>
            {assetHealth.more > 0 && <p className="asset-card-more">{assetHealth.more} more need attention</p>}
          </Card>

          <Card className="category-card">
            <CardHeader title="Open tickets by category" description={`Where the ${open.length} open tickets sit`} />
            {byCategory.length === 0 ? (
              <p className="muted">No open tickets.</p>
            ) : (
              <ul className="cat-list">
                {byCategory.map(({ c, n, severe }) => (
                  <li key={c}>
                    <Link to={`/tickets?status=open&category=${c}`} className="cat-row">
                      <span className="cat-main">
                        <span className="cat-name">
                          <CategoryLabel category={c} short />
                        </span>
                        <span className="cat-sub">{severe ? `${severe} critical or high` : 'None critical or high'}</span>
                      </span>
                      <TickMeter share={open.length ? n / open.length : 0} />
                      <span className="cat-count">{n}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="recent-card" flush>
          <CardHeader
            title="Recent tickets"
            description="Latest issues raised by clients"
            action={
              <Link to="/tickets" className="btn btn-secondary btn-sm">
                View all tickets
              </Link>
            }
          />
          <TicketTable tickets={recent} hide={['asset', 'category', 'sla']} />
        </Card>
      </div>
    </div>
  );
}
