import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, CircleCheck, Clock, Search } from 'lucide-react';
import type { Asset, Client, TeamMember, Ticket } from '../types';
import { ASSET_STATUS_LABEL, isOpen } from '../lib/domain';
import { fmtDateYear, fmtDuration, fmtTime, greeting } from '../lib/format';
import { pmFor, testerFor } from '../lib/intake';
import { uptimeHistory, uptimeLevel, uptimeOver } from '../lib/uptime';
import type { TicketSla } from '../lib/sla';
import { useStore } from '../store';
import { ClientLogo, StatusBadge, clockWord } from '../components/domain';
import { Avatar, cx } from '../components/ui';

/* The Overview, at a glance: asset health on top (one uptime bar, for the
   asset you pick), then a column per client. A column holds that client's
   open tickets: yours first, then the blocked ones, then the rest by deadline.
   A card is the ticket's title and status, and under it who has it, what
   they do next and how long is left. The client whose next deadline is
   nearest comes first. */

const HOUR = 60 * 60_000;
/** Cards a column shows before "View all". */
const PER_COLUMN = 6;

/** Whose turn a ticket is, and the step they take. A client holds it only while a deploy waits on their approval. */
interface Turn {
  member?: TeamMember;
  client?: Client;
  /** A team holds it, not one person: the business team checking for a feature request. */
  team?: string;
  step: string;
}
interface Row {
  t: Ticket;
  sla: TicketSla;
  turn: Turn;
  mine: boolean;
}

type Urgency = 'late' | 'soon' | 'ok';
/** Orange under two hours, red once past. */
const urgencyOf = (s: TicketSla): Urgency => (s.active.state === 'breached' ? 'late' : s.active.remainingMs <= 2 * HOUR ? 'soon' : 'ok');

/** The client approved the release NXS last sent, so the deploy is NXS's move again. */
function clientApproved(t: Ticket) {
  const last = t.feedback[t.feedback.length - 1];
  return last?.decision === 'approved' && last.at >= (t.handoffs[t.handoffs.length - 1]?.at ?? 0);
}

export function Overview() {
  const { tickets, now, currentUser, clients, clientOf, memberOf, slaOf, team } = useStore();

  const rows = useMemo(() => {
    const turnOf = (t: Ticket): Turn | null => {
      const client = clientOf(t.clientId);
      if (!client) return null;
      const m = (id: string | null | undefined) => (id ? memberOf(id) : undefined);
      switch (t.status) {
        case 'new':
          return t.featureCheck && !t.featureCheck.result ? { team: 'Business team', step: 'Check if it’s a feature request' } : { member: m(pmFor(client)), step: 'Review the properties' };
        case 'not_started': {
          // Checked in layers: QA, then the assigned developer, then the CTO.
          const layer = t.issueCheck?.unsure.length ?? 0;
          if (layer === 0) return { member: m(t.testerId ?? testerFor(client)), step: 'Check the issue' };
          if (layer === 1) return { member: m(t.assigneeId), step: 'Check the issue' };
          return { member: team.find((x) => /chief technology officer/i.test(x.title)), step: 'Decide if it’s an issue' };
        }
        case 'in_progress':
          return { member: m(t.assigneeId), step: t.diagnosis ? 'Review the AI’s fix' : 'Send the Initial RCA Report' };
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
    const isMine = (turn: Turn) => turn.member?.id === currentUser.id || (!!turn.team && currentUser.departmentId === 'business');
    return tickets
      .filter(isOpen)
      .map((t) => ({ t, sla: slaOf(t), turn: turnOf(t) }))
      .filter((r): r is Omit<Row, 'mine'> & { turn: Turn } => r.turn != null)
      .map((r) => ({ ...r, mine: isMine(r.turn) }))
      .sort((a, b) => a.sla.active.due - b.sla.active.due);
  }, [tickets, clientOf, memberOf, slaOf, team, currentUser]);

  // A column per client with open work; the one with the nearest deadline first (rows are already in that order).
  const columns = useMemo(() => {
    const order: string[] = [];
    rows.forEach((r) => !order.includes(r.t.clientId) && order.push(r.t.clientId));
    return order.map((id) => ({ client: clients.find((c) => c.id === id)!, rows: rows.filter((r) => r.t.clientId === id) })).filter((c) => c.client);
  }, [rows, clients]);

  return (
    <div className="page">
      <header className="page-header hero" data-hero>
        <div className="page-header-row">
          <div className="page-header-text">
            <h1 className="welcome-title">
              {greeting(now)}, {currentUser.name.split(' ')[0]}.
            </h1>
          </div>
        </div>
      </header>

      <AssetHealth />

      {columns.length === 0 ? (
        <div className="ovc-empty">
          <CircleCheck size={20} aria-hidden />
          No open tickets right now.
        </div>
      ) : (
        <section className="ovc-cols" aria-label="Open tickets by client">
          {columns.map(({ client, rows: list }) => (
            <ClientColumn key={client.id} client={client} rows={list} />
          ))}
        </section>
      )}
    </div>
  );
}

function ClientColumn({ client, rows }: { client: Client; rows: Row[] }) {
  const [open, setOpen] = useState(false);
  const mine = rows.filter((r) => r.mine);
  const blocked = rows.filter((r) => !r.mine && r.t.status === 'blocked');
  const ordered = [...mine, ...blocked, ...rows.filter((r) => !r.mine && r.t.status !== 'blocked')];
  const shown = open ? ordered : ordered.slice(0, PER_COLUMN);
  const id = `ovc-${client.id}`;
  return (
    <section className="ovc-col" aria-labelledby={id}>
      <header className="ovc-col-head">
        <ClientLogo client={client} size={32} />
        <h2 id={id} className="ovc-col-title">
          {client.name}
        </h2>
        <span className="ovc-col-count">{rows.length} open</span>
        <span className="ovc-col-tags">
          {mine.length > 0 && <span className="ovc-tag is-you">{mine.length} on you</span>}
          {blocked.length > 0 && <span className="ovc-tag is-blocked">{blocked.length} blocked</span>}
        </span>
      </header>
      <ol className={cx('ovc-list', open && 'is-open')}>
        {shown.map((r) => (
          <TicketCard key={r.t.id} row={r} />
        ))}
      </ol>
      {rows.length > PER_COLUMN && (
        <button type="button" className="ovc-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : `View all ${rows.length}`}
          <ChevronDown size={15} aria-hidden className={cx('ovc-more-caret', open && 'is-open')} />
        </button>
      )}
    </section>
  );
}

/** A ticket: its title and status, then who has it, their next step, and the time left. Yours glow purple; blocked ones red. */
function TicketCard({ row }: { row: Row }) {
  const { now } = useStore();
  const { t, sla, turn, mine } = row;
  const u = urgencyOf(sla);
  const blocker = t.status === 'blocked' ? t.blockers[t.blockers.length - 1] : undefined;
  const who = mine ? 'You' : turn.member ? turn.member.name.split(' ')[0] : turn.team ? turn.team : 'Client';
  const due = sla.active.due;
  const sameDay = new Date(due).toDateString() === new Date(now).toDateString();
  const dueText = `${clockWord(t.status, sla)} ${u === 'late' ? 'was due' : 'due'} ${sameDay ? fmtTime(due) : `${fmtDateYear(due)}, ${fmtTime(due)}`}`;
  return (
    <li>
      <Link to={`/tickets/${t.id}`} className={cx('ovc-card', mine && 'is-mine', blocker && 'is-blocked')} title={`${t.id} · ${t.title}`}>
        <span className="ovc-card-top">
          <span className="ovc-card-title">{t.title}</span>
          <StatusBadge status={t.status} />
        </span>
        <span className="ovc-card-meta">
          <span className="ovc-who">
            {turn.member ? (
              <Avatar name={turn.member.name} src={turn.member.photo} size={24} />
            ) : turn.client ? (
              <ClientLogo client={turn.client} size={24} />
            ) : (
              <Avatar name={turn.team ?? 'Team'} size={24} />
            )}
            <span className="ovc-who-name">{who}</span>
            <span className="ovc-who-step">{blocker ? `Blocked for ${fmtDuration(now - blocker.at)}` : turn.step}</span>
          </span>
          <span className={cx('ovc-time', `is-${u}`)} title={dueText}>
            <Clock size={14} aria-hidden />
            {u === 'late' ? `${fmtDuration(-sla.active.remainingMs)} over` : `${fmtDuration(sla.active.remainingMs)} left`}
          </span>
        </span>
      </Link>
    </li>
  );
}

/* ---------- Asset health ---------- */

const STATE_TONE: Record<Asset['status'], string> = { operational: 'green', degraded: 'orange', outage: 'red', maintenance: 'blue', unknown: 'neutral' };
const RANK: Asset['status'][] = ['outage', 'degraded', 'unknown', 'maintenance', 'operational'];

/** One uptime bar for the asset you pick; it opens on the asset in the worst state. */
function AssetHealth() {
  const { assets, clients, now } = useStore();
  const ranked = useMemo(() => [...assets].sort((a, b) => RANK.indexOf(a.status) - RANK.indexOf(b.status) || a.name.localeCompare(b.name)), [assets]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const asset = ranked.find((a) => a.id === pickedId) ?? ranked[0];
  const days = useMemo(() => (asset ? uptimeHistory(asset, now, 90) : []), [asset, now]);
  const [hover, setHover] = useState<number | null>(null);
  if (!asset) return null;
  const issues = assets.filter((a) => a.status !== 'operational').length;
  const u90 = uptimeOver(days);
  const day = hover != null ? days[hover] : null;
  const client = clients.find((c) => c.id === asset.clientId);
  return (
    <section className="ovc-health" aria-labelledby="ovc-health">
      <div className="ovc-health-head">
        <h2 id="ovc-health" className="ovc-health-title">
          Asset health
        </h2>
        <span className={cx('ovc-health-sum', issues > 0 && 'is-issue')}>{issues ? `${issues} of ${assets.length} need attention` : `All ${assets.length} operational`}</span>
      </div>
      <div className="ovc-health-meta">
        <AssetPicker assets={ranked} clients={clients} value={asset} onPick={(a) => setPickedId(a.id)} />
        <span className={cx('ovc-state', `tone-${STATE_TONE[asset.status]}`)}>
          <span className="ovc-dot" aria-hidden />
          {ASSET_STATUS_LABEL[asset.status]}
        </span>
        <span className="ovc-uptime">{u90 == null ? 'No uptime data yet' : <><strong>{u90.toFixed(2)}%</strong> uptime in the last 90 days</>}</span>
        {day && (
          <span className="ovc-day">
            {fmtDateYear(day.at)}: {day.pct == null ? 'no data' : day.downMins ? `${fmtDuration(day.downMins * 60_000)} down` : 'no downtime'}
          </span>
        )}
      </div>
      <div
        className="ovc-bars"
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${asset.name}${client ? `, ${client.name}` : ''}: ${u90 == null ? 'no data' : `${u90.toFixed(2)}%`} uptime over 90 days`}
      >
        {days.map((d, i) => (
          <span key={d.at} className={cx('ovc-bar', `is-${uptimeLevel(d)}`)} onMouseEnter={() => setHover(i)} />
        ))}
      </div>
      <div className="ovc-axis" aria-hidden>
        <span>90 days ago</span>
        <span>Today</span>
      </div>
    </section>
  );
}

/** Picks the asset the bar shows: a searchable list, grouped by client, worst state first. Stays usable with a hundred assets. */
function AssetPicker({ assets, clients, value, onPick }: { assets: Asset[]; clients: Client[]; value: Asset; onPick: (a: Asset) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const clientOf = (a: Asset) => clients.find((c) => c.id === a.clientId);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const hits = assets.filter((a) => !q || `${a.name} ${clientOf(a)?.name ?? ''}`.toLowerCase().includes(q));
  const groups = clients.map((c) => ({ c, list: hits.filter((a) => a.clientId === c.id) })).filter((g) => g.list.length > 0);
  // Groups follow the worst asset in each, like the list itself.
  groups.sort((a, b) => hits.indexOf(a.list[0]) - hits.indexOf(b.list[0]));
  const valueClient = clientOf(value);

  return (
    <div className="ovc-picker" ref={root}>
      <button
        type="button"
        className="ovc-picker-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setQuery('');
        }}
      >
        {valueClient && <ClientLogo client={valueClient} size={20} />}
        <span className="ovc-picker-name">{value.name}</span>
        {valueClient && <span className="ovc-picker-client">{valueClient.name}</span>}
        <ChevronDown size={15} aria-hidden className="ovc-picker-caret" />
      </button>
      {open && (
        <div className="ovc-panel">
          <label className="ovc-search">
            <Search size={15} aria-hidden />
            <input ref={input} type="search" placeholder="Search assets" aria-label="Search assets" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="ovc-options" role="listbox" aria-label="Assets">
            {groups.length === 0 && <p className="ovc-options-empty">No asset matches that name.</p>}
            {groups.map(({ c, list }) => (
              <div key={c.id} role="group" aria-label={c.name}>
                <p className="ovc-group">{c.name}</p>
                {list.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="option"
                    aria-selected={a.id === value.id}
                    className={cx('ovc-option', a.id === value.id && 'is-on')}
                    onClick={() => {
                      onPick(a);
                      setOpen(false);
                    }}
                  >
                    <ClientLogo client={c} size={18} />
                    <span className="ovc-option-name">{a.name}</span>
                    <span className={cx('ovc-option-state', `tone-${STATE_TONE[a.status]}`)}>{ASSET_STATUS_LABEL[a.status]}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
