import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, CircleAlert, CircleCheck, FlaskConical, Inbox, ListChecks, Loader, OctagonAlert, CircleDashed, type LucideIcon } from 'lucide-react';
import type { Asset, AssetStatus, Ticket } from '../types';
import { ASSET_STATUS_LABEL, isOpen } from '../lib/domain';
import { fmtDateYear, fmtDuration, greeting } from '../lib/format';
import { uptimeHistory, uptimeLevel, uptimeOver } from '../lib/uptime';
import type { TicketSla } from '../lib/sla';
import { useStore } from '../store';
import { ClientLogo, SeverityBadge } from '../components/domain';
import { Avatar, Badge, cx, type Tone } from '../components/ui';

/* The Overview: only what NXS has to act on, and whether anything is broken.

   Work is split by the job each stage asks for: a first reply (New), the fix
   (In progress, including not started and blocked tickets), and QA (Testing:
   waiting for a tester, and being tested by whom). Every card leads with the
   time left on the clock that matters at that stage and says who holds it.
   Fixes waiting on the client are left out: it is their turn.

   The three lanes always stay; a lane with nothing in it says so in place.
   "All tickets" or "My tickets" filters the same view for anyone.

   Asset health reads like a status page: one banner, then each client, with
   the ones that have a problem opened and healthy ones folded to a line. */

const HOUR = 60 * 60_000;
/** Cards shown per lane before "View all". */
const PER_LANE = 4;

interface Lane {
  key: string;
  label: string;
  /** The job this stage asks for. */
  job: string;
  icon: LucideIcon;
  tone: string;
  match: (t: Ticket) => boolean;
  /** The clock this stage runs against, as the card names it. */
  clock: string;
  /** What an empty lane says, and what would show up in it. */
  empty: [title: string, text: string];
  to: string;
}

const LANES: Lane[] = [
  {
    key: 'new',
    label: 'New',
    job: 'Needs QA review',
    icon: Inbox,
    tone: 'blue',
    match: (t) => t.status === 'new',
    clock: 'Reply',
    empty: ['Nothing to review', 'New tickets wait here until QA confirms the AI’s read.'],
    to: '/tickets?status=new',
  },
  {
    key: 'work',
    label: 'In progress',
    job: 'Being fixed',
    icon: Loader,
    tone: 'pink',
    match: (t) => t.status === 'in_progress' || t.status === 'not_started' || t.status === 'blocked',
    clock: 'Fix',
    empty: ['Nothing being fixed', 'Tickets stay here while a fix is underway.'],
    to: '/tickets?status=in_progress',
  },
  {
    key: 'test',
    label: 'Testing',
    job: 'Needs QA',
    icon: FlaskConical,
    tone: 'teal',
    match: (t) => t.status === 'waiting_testing' || t.status === 'on_testing',
    clock: 'QA',
    empty: ['Nothing waiting for QA', 'Fixes come here when they are ready to test.'],
    to: '/tickets?status=waiting_testing',
  },
];

type Urgency = 'late' | 'soon' | 'ok';
const urgencyOf = (s: TicketSla): Urgency => (s.active.state === 'breached' ? 'late' : s.active.remainingMs <= HOUR ? 'soon' : 'ok');

/** When the ticket went on testing, for how long it has been tested. */
function testingSince(t: Ticket) {
  return [...t.activity].reverse().find((x) => x.kind === 'status' && x.text.endsWith('to On testing'))?.at;
}
/** QA holds a ticket while it is new (checking the AI's read) and while it is in testing. */
const qaHolds = (t: Ticket) => t.status === 'new' || t.status === 'waiting_testing' || t.status === 'on_testing';

type Scope = 'all' | 'mine';

export function Overview() {
  const { tickets, now, currentUser } = useStore();
  const [scope, setScope] = useState<Scope>('all');
  const all = useMemo(() => tickets.filter((t) => isOpen(t) && LANES.some((l) => l.match(t))), [tickets]);
  // Mine: what I hold now. QA holds new and testing tickets; the assignee holds the fix.
  const isMine = (t: Ticket) => (qaHolds(t) ? t.testerId : t.assigneeId) === currentUser.id;
  const mineCount = all.filter(isMine).length;
  const work = scope === 'mine' ? all.filter(isMine) : all;

  return (
    <div className="page">
      <header className="page-header hero" data-hero>
        <div className="page-header-row">
          <div className="page-header-text">
            <h1 className="welcome-title">
              {greeting(now)}, {currentUser.name.split(' ')[0]}.
            </h1>
            <p className="page-desc">Tickets that need NXS, soonest deadline first, and how every asset is doing.</p>
          </div>
          <div className="view-tabs ovx-scope" role="tablist" aria-label="Whose tickets">
            {(
              [
                ['all', 'All tickets', all.length],
                ['mine', 'My tickets', mineCount],
              ] as const
            ).map(([key, label, n]) => (
              <button key={key} type="button" role="tab" aria-selected={scope === key} className={cx('view-tab', scope === key && 'is-active')} onClick={() => setScope(key)}>
                {label}
                <span className="view-tab-count">{n}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="ovx-section" aria-label="Tickets that need NXS">
        <div className="ovx-lanes">
          {LANES.map((lane) => (
            <LaneColumn key={lane.key} lane={lane} tickets={work.filter(lane.match)} mine={scope === 'mine'} />
          ))}
        </div>
      </section>

      <StatusPage />
    </div>
  );
}

function LaneColumn({ lane, tickets, mine }: { lane: Lane; tickets: Ticket[]; mine: boolean }) {
  const { slaOf } = useStore();
  // Soonest deadline first: late ones, then the ones closest to the line.
  const rows = useMemo(() => tickets.map((t) => ({ t, sla: slaOf(t) })).sort((a, b) => a.sla.active.due - b.sla.active.due), [tickets, slaOf]);
  const late = rows.filter((r) => urgencyOf(r.sla) === 'late').length;
  const soon = rows.filter((r) => urgencyOf(r.sla) === 'soon').length;
  const Icon = lane.icon;
  return (
    <section className={cx('ovx-lane', `tone-${lane.tone}`)} aria-labelledby={`ovx-${lane.key}`}>
      <header className="ovx-lane-head">
        <span className="ovx-lane-icon" aria-hidden>
          <Icon size={16} />
        </span>
        <span className="ovx-lane-text">
          <span className="ovx-lane-title" id={`ovx-${lane.key}`}>
            {lane.label}
            <span className="ovx-lane-count">{rows.length}</span>
          </span>
          <span className="ovx-lane-job">{lane.job}</span>
        </span>
        {rows.length > 0 && (late > 0 ? <span className="ovx-tag is-red">{late} late</span> : soon > 0 ? <span className="ovx-tag is-orange">{soon} within 1h</span> : <span className="ovx-tag">On time</span>)}
      </header>

      {rows.length === 0 ? (
        <div className="ovx-empty">
          <span className="ovx-empty-icon" aria-hidden>
            <CircleCheck size={20} />
          </span>
          <p className="ovx-empty-title">{lane.empty[0]}</p>
          <p className="ovx-empty-text">{mine ? 'Nothing of yours at this stage.' : lane.empty[1]}</p>
        </div>
      ) : (
        <>
          <ol className="ovx-cards">
            {rows.slice(0, PER_LANE).map(({ t, sla }) => (
              <TicketCard key={t.id} t={t} sla={sla} clock={lane.clock} />
            ))}
          </ol>
          <Link to={lane.to} className="ovx-more">
            {rows.length > PER_LANE ? `View all ${rows.length}` : 'View in Tickets'}
          </Link>
        </>
      )}
    </section>
  );
}

/** Stages that set a card apart inside its lane: a tint across the card and a badge, no extra text. */
const STATE: Partial<Record<Ticket['status'], { label: string; tone: Tone; icon: LucideIcon }>> = {
  blocked: { label: 'Blocked', tone: 'orange', icon: OctagonAlert },
  not_started: { label: 'Not started', tone: 'neutral', icon: CircleDashed },
  waiting_testing: { label: 'Waiting for testing', tone: 'indigo', icon: ListChecks },
  on_testing: { label: 'On testing', tone: 'teal', icon: FlaskConical },
};

/** A card: the clock label and priority, the time, the title, then the ticket and who holds it. */
function TicketCard({ t, sla, clock }: { t: Ticket; sla: TicketSla; clock: string }) {
  const { clientOf, memberOf, now } = useStore();
  const u = urgencyOf(sla);
  const label = u === 'late' ? `${clock} overdue by` : `${clock} due in`;
  // Who has it now: QA while it is new or in testing, the assignee while it is being fixed.
  const person = memberOf(qaHolds(t) ? t.testerId : t.assigneeId);
  const holder = person ? { name: person.name, photo: person.photo } : null;
  const since = t.status === 'on_testing' ? testingSince(t) : undefined;
  const blocker = t.status === 'blocked' ? t.blockers[t.blockers.length - 1]?.details : undefined;
  const state = STATE[t.status];
  return (
    <li>
      <Link to={`/tickets/${t.id}`} className={cx('ovx-card', `is-${u}`, state && `has-state tone-${state.tone}`)}>
        <span className="ovx-card-top">
          <span className="ovx-card-label">{label}</span>
          <SeverityBadge severity={t.severity} />
        </span>
        <span className="ovx-card-time">{fmtDuration(Math.abs(sla.active.remainingMs))}</span>
        <span className="ovx-card-title">{t.title}</span>
        <span className="ovx-card-foot">
          <span className="ticket-id">{t.id}</span>
          <span className="ovx-card-client truncate">{clientOf(t.clientId)?.name}</span>
          {state && (
            <span className="ovx-card-state" title={blocker ? `Blocked: ${blocker}` : undefined}>
              <Badge tone={state.tone} icon={<state.icon size={13} aria-hidden />}>
                {state.label}
              </Badge>
            </span>
          )}
        </span>
        {holder && (
          <span className="ovx-card-owner">
            <Avatar name={holder.name} size={22} src={holder.photo} />
            <span className="truncate">{holder.name}</span>
            {since != null && <span className="ovx-card-testing">testing {fmtDuration(now - since)}</span>}
          </span>
        )}
      </Link>
    </li>
  );
}

/* ---------- Asset health ---------- */

const RANK: AssetStatus[] = ['outage', 'degraded', 'unknown', 'maintenance', 'operational'];
const STATE_TONE: Record<AssetStatus, string> = { operational: 'green', degraded: 'orange', outage: 'red', maintenance: 'blue', unknown: 'neutral' };

function StatusPage() {
  const { assets, clients } = useStore();
  const issues = assets.filter((a) => a.status !== 'operational');
  const worst = RANK.find((s) => assets.some((a) => a.status === s)) ?? 'operational';
  // Clients with a problem first, otherwise in the workspace's own order (CML, then Aroma Abadi).
  const groups = clients
    .map((c) => ({ c, list: assets.filter((a) => a.clientId === c.id).sort((a, b) => RANK.indexOf(a.status) - RANK.indexOf(b.status) || a.name.localeCompare(b.name)) }))
    .sort((a, b) => Number(b.list.some((x) => x.status !== 'operational')) - Number(a.list.some((x) => x.status !== 'operational')));

  return (
    <section className="ovx-section ovx-health" aria-labelledby="ovx-health">
      <div className="ovx-section-head">
        <h2 id="ovx-health" className="section-title">
          Asset health
        </h2>
      </div>
      <div className="ovx-status">
        <div className={cx('ovx-banner', `tone-${STATE_TONE[worst]}`)}>
          <span className="ovx-banner-icon" aria-hidden>
            {issues.length ? <CircleAlert size={18} /> : <CircleCheck size={18} />}
          </span>
          <span className="ovx-banner-text">{issues.length ? `${issues.length} of ${assets.length} assets need attention` : `All ${assets.length} assets operational`}</span>
        </div>
        {groups.map(({ c, list }) => (
          <ClientGroup key={c.id} clientId={c.id} assets={list} />
        ))}
      </div>
    </section>
  );
}

function ClientGroup({ clientId, assets }: { clientId: string; assets: Asset[] }) {
  const { clientOf, now } = useStore();
  const client = clientOf(clientId)!;
  const troubled = assets.filter((a) => a.status !== 'operational').length;
  const [open, setOpen] = useState(troubled > 0);
  const histories = useMemo(() => assets.map((a) => ({ a, days: uptimeHistory(a, now, 90) })), [assets, now]);
  const u90 = uptimeOver(histories.flatMap((h) => h.days));
  const id = `ovx-client-${clientId}`;
  return (
    <div className="ovx-group">
      <button type="button" className="ovx-row ovx-group-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <ChevronDown size={16} aria-hidden className={cx('ovx-caret', !open && 'is-closed')} />
        <ClientLogo client={client} size={24} />
        <span className="ovx-group-name">{client.name}</span>
        <span className="ovx-group-sub">
          {assets.length} {assets.length === 1 ? 'asset' : 'assets'}
        </span>
        <span className="ovx-row-end">
          {!open && u90 != null && <span className="ovx-group-uptime">{u90.toFixed(2)}% uptime</span>}
          <StatePill status={troubled ? 'degraded' : 'operational'} label={troubled ? `${troubled} need attention` : 'Operational'} />
        </span>
      </button>
      {open && (
        <ul className="ovx-assets" id={id}>
          {histories.map(({ a, days }) => (
            <AssetRow key={a.id} asset={a} days={days} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StatePill({ status, label }: { status: AssetStatus; label?: string }) {
  return (
    <span className={cx('ovx-state', `tone-${STATE_TONE[status]}`)}>
      <span className="ovx-dot" aria-hidden />
      {label ?? ASSET_STATUS_LABEL[status]}
    </span>
  );
}

function AssetRow({ asset, days }: { asset: Asset; days: ReturnType<typeof uptimeHistory> }) {
  const [hover, setHover] = useState<number | null>(null);
  const u90 = uptimeOver(days);
  const shown = hover != null ? days[hover] : null;
  return (
    <li className="ovx-asset">
      <div className="ovx-asset-head">
        <span className="ovx-asset-name">{asset.name}</span>
        <StatePill status={asset.status} />
      </div>
      <div className="ovx-bars" onMouseLeave={() => setHover(null)} role="img" aria-label={`${asset.name}: ${u90 == null ? 'no data' : `${u90.toFixed(2)}%`} uptime over 90 days`}>
        {days.map((d, i) => (
          <span key={d.at} className={cx('uptime-bar', `is-${uptimeLevel(d)}`, hover === i && 'is-hover')} onMouseEnter={() => setHover(i)} />
        ))}
      </div>
      {/* The uptime sits in the middle of the axis; hovering a day shows that day instead. */}
      <div className="ovx-axis">
        <span>90 days ago</span>
        <span className="ovx-axis-rule" aria-hidden />
        {shown ? (
          <span className="ovx-axis-mid is-day">
            {fmtDateYear(shown.at)}: {shown.pct == null ? 'no data' : shown.downMins ? `${fmtDuration(shown.downMins * 60_000)} down` : 'no downtime'}
          </span>
        ) : (
          <span className="ovx-axis-mid">{u90 == null ? 'No data yet' : `${u90.toFixed(2)}% uptime`}</span>
        )}
        <span className="ovx-axis-rule" aria-hidden />
        <span>Today</span>
      </div>
    </li>
  );
}
