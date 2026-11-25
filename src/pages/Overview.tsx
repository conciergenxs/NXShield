import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, CircleCheck, OctagonAlert, User, Users } from 'lucide-react';
import type { Asset, Client, TeamMember, Ticket } from '../types';
import { ASSET_STATUS_LABEL, isOpen } from '../lib/domain';
import { fmtDate, fmtDateYear, fmtDuration, fmtTime, greeting } from '../lib/format';
import { pmFor, testerFor } from '../lib/intake';
import { uptimeHistory, uptimeLevel, uptimeOver } from '../lib/uptime';
import type { TicketSla } from '../lib/sla';
import { useStore } from '../store';
import { ClientLogo, SeverityBadge, clockWord } from '../components/domain';
import { Avatar, Badge, cx } from '../components/ui';

/* The Overview answers two questions before anything else: what is waiting
   on me, and who has everything else. Both columns hold the same card and
   always stand the same height: three cards, then "View all", which opens the
   rest inside the column (it scrolls) instead of making the page longer.

   Below, asset health: one card per client, each asset a line with its
   uptime and 90 days of bars. */

const HOUR = 60 * 60_000;
/** Cards a column shows before "View all". */
const PER_COLUMN = 3;

/** Whose turn a ticket is, and the step they take. A client holds it only while a deploy waits on their approval. */
interface Turn {
  member?: TeamMember;
  client?: Client;
  step: string;
}
interface Row {
  t: Ticket;
  sla: TicketSla;
  turn: Turn;
}

type Urgency = 'late' | 'soon' | 'ok';
const urgencyOf = (s: TicketSla): Urgency => (s.active.state === 'breached' ? 'late' : s.active.remainingMs <= HOUR ? 'soon' : 'ok');

/** The client approved the release NXS last sent, so the deploy is NXS's move again. */
function clientApproved(t: Ticket) {
  const last = t.feedback[t.feedback.length - 1];
  return last?.decision === 'approved' && last.at >= (t.handoffs[t.handoffs.length - 1]?.at ?? 0);
}

export function Overview() {
  const { tickets, now, currentUser, clientOf, memberOf, slaOf } = useStore();

  const rows = useMemo(() => {
    const turnOf = (t: Ticket): Turn | null => {
      const client = clientOf(t.clientId);
      if (!client) return null;
      const m = (id: string | null | undefined) => (id ? memberOf(id) : undefined);
      switch (t.status) {
        case 'new':
          return { member: m(pmFor(client)), step: 'Review the properties' };
        case 'not_started':
          return { member: m(t.testerId ?? testerFor(client)), step: 'Check the issue' };
        case 'in_progress':
          return { member: m(t.assigneeId), step: t.diagnosis ? 'Review the AI’s fix' : 'Send the initial RCA' };
        case 'blocked':
          return { member: m(t.assigneeId), step: 'Blocked' };
        case 'waiting_testing':
        case 'on_testing':
          return { member: m(t.testerId ?? testerFor(client)), step: 'Test the fix' };
        case 'qa_passed':
          return { member: m(t.assigneeId), step: 'Check the registry tag' };
        case 'ready_to_deploy':
          return clientApproved(t) ? { member: m(t.assigneeId), step: 'Deploy the fix' } : { client, step: 'Approve the deploy' };
        default:
          return null;
      }
    };
    return tickets
      .filter(isOpen)
      .map((t) => ({ t, sla: slaOf(t), turn: turnOf(t) }))
      .filter((r): r is Row => r.turn != null)
      .sort((a, b) => a.sla.active.due - b.sla.active.due);
  }, [tickets, clientOf, memberOf, slaOf]);

  const mine = rows.filter((r) => r.turn.member?.id === currentUser.id);
  const others = rows.filter((r) => r.turn.member?.id !== currentUser.id);
  const next = mine[0];
  const lede = next
    ? `${mine.length} ${mine.length === 1 ? 'ticket waits' : 'tickets wait'} on you. The soonest is ${
        urgencyOf(next.sla) === 'late' ? `overdue by ${fmtDuration(-next.sla.active.remainingMs)}` : `due in ${fmtDuration(next.sla.active.remainingMs)}`
      }.`
    : 'Nothing waits on you right now. Here is who has the rest.';

  return (
    <div className="page">
      <header className="page-header hero" data-hero>
        <div className="page-header-row">
          <div className="page-header-text">
            <h1 className="welcome-title">
              {greeting(now)}, {currentUser.name.split(' ')[0]}.
            </h1>
            <p className="page-desc">{lede}</p>
          </div>
        </div>
      </header>

      <section className="ovt-columns" aria-label="Open tickets by whose turn it is">
        <TurnColumn
          id="mine"
          title="Your turn"
          job="Waiting on you, soonest deadline first"
          icon={<User size={16} />}
          tone="purple"
          rows={mine}
          mine
          empty="Nothing waits on you. New work shows up here the moment it is your step."
        />
        <TurnColumn id="others" title="Others’ turn" job="Who holds the rest, soonest deadline first" icon={<Users size={16} />} tone="blue" rows={others} empty="Nobody else has an open ticket." />
      </section>

      <AssetHealth />
    </div>
  );
}

function TurnColumn(props: { id: string; title: string; job: string; icon: ReactNode; tone: string; rows: Row[]; mine?: boolean; empty: string }) {
  const { id, title, job, icon, tone, rows, mine, empty } = props;
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, PER_COLUMN);
  return (
    <section className={cx('ovx-lane ovt-column', `tone-${tone}`, mine && 'is-mine')} aria-labelledby={`ovt-${id}`}>
      <header className="ovx-lane-head">
        <span className="ovx-lane-icon" aria-hidden>
          {icon}
        </span>
        <span className="ovx-lane-text">
          <span className="ovx-lane-title" id={`ovt-${id}`}>
            {title}
            <span className="ovx-lane-count">{rows.length}</span>
          </span>
          <span className="ovx-lane-job">{job}</span>
        </span>
      </header>

      {rows.length === 0 ? (
        <div className="ovx-empty ovt-list">
          <span className="ovx-empty-icon" aria-hidden>
            <CircleCheck size={20} />
          </span>
          <p className="ovx-empty-text">{empty}</p>
        </div>
      ) : (
        <ol className={cx('ovt-list', open && 'is-open')} tabIndex={open ? 0 : undefined}>
          {shown.map(({ t, sla, turn }) => (
            <TurnCard key={t.id} t={t} sla={sla} turn={turn} mine={mine} />
          ))}
        </ol>
      )}

      {/* Always there, so both columns end on the same line. */}
      {rows.length > PER_COLUMN ? (
        <button type="button" className="board-view-all ovt-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : `View all ${rows.length}`}
          <ChevronDown size={15} aria-hidden className={cx('board-view-all-caret', open && 'is-open')} />
        </button>
      ) : (
        <Link to="/tickets" className="board-view-all ovt-more">
          Open Tickets
          <ArrowRight size={15} aria-hidden />
        </Link>
      )}
    </section>
  );
}

/** A card: the ticket and where it lives with its priority, the title, then whose step it is and the deadline. */
function TurnCard({ t, sla, turn, mine }: { t: Ticket; sla: TicketSla; turn: Turn; mine?: boolean }) {
  const { clientOf, assets, now } = useStore();
  const client = clientOf(t.clientId);
  const asset = assets.find((a) => a.id === t.assetId);
  const u = urgencyOf(sla);
  const word = clockWord(t.status, sla);
  const due = sla.active.due;
  const sameDay = new Date(due).toDateString() === new Date(now).toDateString();
  const at = sameDay ? fmtTime(due) : `${fmtDate(due)}, ${fmtTime(due)}`;
  const blocker = t.status === 'blocked' ? t.blockers[t.blockers.length - 1] : undefined;
  return (
    <li>
      <Link to={`/tickets/${t.id}`} className={cx('ovt-card', `is-${u}`)}>
        <span className="ovt-card-top">
          <span className="ticket-id">{t.id}</span>
          <span className="ovt-card-where truncate">
            {client?.name}
            {asset && ` · ${asset.name}`}
          </span>
          <SeverityBadge severity={t.severity} />
        </span>
        <span className="ovt-card-title">{t.title}</span>
        <span className="ovt-card-foot">
          <span className="ovt-card-step">
            {!mine && turn.member && (
              <>
                <Avatar name={turn.member.name} src={turn.member.photo} size={22} />
                <span className="ovt-card-who">{turn.member.name.split(' ')[0]}</span>
              </>
            )}
            {!mine && turn.client && (
              <>
                <ClientLogo client={turn.client} size={22} />
                <span className="ovt-card-who">{turn.client.name}</span>
              </>
            )}
            {blocker ? (
              <Badge tone="orange" icon={<OctagonAlert size={13} aria-hidden />}>
                Blocked {fmtDuration(now - blocker.at)}
              </Badge>
            ) : (
              <span className={cx('ovt-card-do', mine && 'is-mine')}>{turn.step}</span>
            )}
          </span>
          <span className="ovt-card-due">
            <strong>{u === 'late' ? `${fmtDuration(-sla.active.remainingMs)} over` : `${fmtDuration(sla.active.remainingMs)} left`}</strong>
            <small>
              {word} {u === 'late' ? 'was due' : 'due'} {at}
            </small>
          </span>
        </span>
      </Link>
    </li>
  );
}

/* ---------- Asset health ---------- */

const STATE_TONE: Record<Asset['status'], string> = { operational: 'green', degraded: 'orange', outage: 'red', maintenance: 'blue', unknown: 'neutral' };
const RANK: Asset['status'][] = ['outage', 'degraded', 'unknown', 'maintenance', 'operational'];

function AssetHealth() {
  const { assets, clients } = useStore();
  const issues = assets.filter((a) => a.status !== 'operational').length;
  const groups = clients
    .map((c) => ({ c, list: assets.filter((a) => a.clientId === c.id).sort((a, b) => RANK.indexOf(a.status) - RANK.indexOf(b.status) || a.name.localeCompare(b.name)) }))
    .filter((g) => g.list.length > 0);
  return (
    <section className="ovx-section ovt-health" aria-labelledby="ovt-health">
      <div className="ovt-health-head">
        <h2 id="ovt-health" className="section-title">
          Asset health
        </h2>
        <span className={cx('ovt-health-sum', issues > 0 && 'is-issue')}>{issues ? `${issues} of ${assets.length} need attention` : `All ${assets.length} operational`}</span>
      </div>
      <div className="ovt-health-grid">
        {groups.map(({ c, list }) => (
          <div key={c.id} className="ovt-client">
            <div className="ovt-client-head">
              <ClientLogo client={c} size={24} />
              <span className="ovt-client-name">{c.name}</span>
              <span className="ovt-client-sub">
                {list.length} {list.length === 1 ? 'asset' : 'assets'}
              </span>
            </div>
            <ul className="ovt-assets">
              {list.map((a) => (
                <AssetLine key={a.id} asset={a} />
              ))}
            </ul>
            <div className="ovt-axis" aria-hidden>
              <span>90 days ago</span>
              <span>Today</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** One asset: its name, its state when something is wrong, its 90-day uptime, then a bar per day. Hovering a day shows that day. */
function AssetLine({ asset }: { asset: Asset }) {
  const { now } = useStore();
  const days = useMemo(() => uptimeHistory(asset, now, 90), [asset, now]);
  const [hover, setHover] = useState<number | null>(null);
  const u90 = uptimeOver(days);
  const shown = hover != null ? days[hover] : null;
  return (
    <li className="ovt-asset">
      <div className="ovt-asset-head">
        <span className="ovt-asset-name truncate">{asset.name}</span>
        <span className="ovt-asset-meta">
          {shown ? (
            <span className="ovt-asset-day">
              {fmtDateYear(shown.at)}: {shown.pct == null ? 'no data' : shown.downMins ? `${fmtDuration(shown.downMins * 60_000)} down` : 'no downtime'}
            </span>
          ) : (
            <>
              {asset.status !== 'operational' && <span className={cx('ovt-asset-state', `tone-${STATE_TONE[asset.status]}`)}>{ASSET_STATUS_LABEL[asset.status]}</span>}
              <span className="ovt-asset-uptime">{u90 == null ? 'No data yet' : `${u90.toFixed(2)}%`}</span>
            </>
          )}
        </span>
      </div>
      <div className="ovx-bars ovt-bars" onMouseLeave={() => setHover(null)} role="img" aria-label={`${asset.name}: ${u90 == null ? 'no data' : `${u90.toFixed(2)}%`} uptime over 90 days`}>
        {days.map((d, i) => (
          <span key={d.at} className={cx('uptime-bar', `is-${uptimeLevel(d)}`, hover === i && 'is-hover')} onMouseEnter={() => setHover(i)} />
        ))}
      </div>
    </li>
  );
}
