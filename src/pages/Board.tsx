import { useMemo, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Ban, Boxes, Building2, ChevronDown, FlaskConical, GripVertical, Hash, Layers, Signal, User } from 'lucide-react';
import type { TaskType, Ticket, TicketStatus } from '../types';
import { SEVERITIES, SEVERITY_LABEL, STATUS_LABEL, TASK_TYPE_LABEL, canTransition, isOpen, severityRank, NO_PRIORITY_LABEL } from '../lib/domain';
import { useStore } from '../store';
import { STATUS_ICON, STATUS_TONE, SeverityBadge, SlaIndicator } from '../components/domain';
import { PORTAL_ORDER, STAFF_ORDER, groupStatusFor, statusLabelFor, useScopedTickets, useTicketScope } from '../components/scope';
import { Avatar, Badge, Card, cx, type Tone } from '../components/ui';
import { FilterButton, FilterChips, useFilterMenu } from '../components/FilterMenu';
import { TicketsHeader, TicketsToolbar } from './Tickets';

const DAY = 24 * 60 * 60_000;
/** Cards a column shows before “View all”: the board stays a calm overview, like Notion's. */
const COLUMN_LIMIT = 3;
const TASK_TONE: Record<TaskType, Tone> = { frontend: 'blue', backend: 'green' };

/**
 * A ticket as a card: the ID on top, the title, then its properties (the
 * client's asset, who has it, story points, who tests it, task type), the priority by
 * the ID, each with its column
 * icon, and the deadline. Drag the card to move it to another stage.
 */
function BoardCard({ ticket, onDragStart, onDragEnd, dragging }: { ticket: Ticket; onDragStart: (e: DragEvent, t: Ticket) => void; onDragEnd: () => void; dragging: boolean }) {
  const { clientOf, assetOf, memberOf, slaOf } = useStore();
  const { portal, ticketPath } = useTicketScope();
  const client = clientOf(ticket.clientId);
  const member = memberOf(ticket.assigneeId);
  const tester = memberOf(ticket.testerId);
  const plan = ticket.plan ?? {};
  const asset = assetOf(ticket.assetId);
  // Blocked work stays in In progress on the board, marked so it can't be missed.
  const blocker = !portal && ticket.status === 'blocked' ? ticket.blockers[ticket.blockers.length - 1] : undefined;
  // Only NXS moves tickets between stages; in the portal the cards stay put.
  return (
    <article
      className={cx('board-card', dragging && 'is-dragging', portal && 'is-static', blocker && 'has-blocker')}
      draggable={!portal}
      onDragStart={portal ? undefined : (e) => onDragStart(e, ticket)}
      onDragEnd={portal ? undefined : onDragEnd}
    >
      <div className="board-card-top">
        {/* The grip says the card can be dragged; the whole card is the drag source. */}
        {!portal && <GripVertical size={16} aria-hidden className="board-grip" />}
        <Link to={ticketPath(ticket.id)} className="ticket-id">
          {ticket.id}
        </Link>
        <span className="board-priority">
          <SeverityBadge severity={ticket.severity} />
        </span>
      </div>
      {blocker && (
        <p className="board-blocker" title={blocker.details}>
          <Ban size={14} aria-hidden />
          <strong>Blocked</strong>
          <span className="truncate">{blocker.details}</span>
        </p>
      )}
      <Link to={ticketPath(ticket.id)} className="board-card-title" title={ticket.title}>
        {ticket.title}
      </Link>
      <dl className="board-props">
        <div>
          <dt>
            <Boxes size={14} aria-hidden />
            <span className="sr-only">Asset</span>
          </dt>
          {/* Staff see whose asset it is in the same line: "CML Marketing-Tech Dashboard". */}
          <dd className="truncate">{portal || !client ? asset?.name : `${client.name} ${asset?.name ?? ''}`.trim()}</dd>
        </div>
        <div>
          <dt>
            {/* The person's face says who has it; the icon only stands in when nobody does. */}
            {member ? <Avatar name={member.name} size={20} src={member.photo} /> : <User size={14} aria-hidden />}
            <span className="sr-only">{portal ? 'Handled by' : 'Assigned to'}</span>
          </dt>
          <dd className={cx('truncate', !member && 'muted')}>{member?.name ?? 'Unassigned'}</dd>
        </div>
        {!portal && (
          <div>
            <dt>
              <Hash size={14} aria-hidden />
              <span className="sr-only">Story points</span>
            </dt>
            <dd className={cx(plan.storyPoints == null && 'muted')} title="Story points">
              {plan.storyPoints ?? 'No story points'}
            </dd>
          </div>
        )}
        {!portal && (
          <div>
            <dt>
              <FlaskConical size={14} aria-hidden />
              <span className="sr-only">Testing</span>
            </dt>
            <dd className={cx('truncate', !tester && 'muted')} title="Testing">{tester?.name ?? 'No tester yet'}</dd>
          </div>
        )}
        {!portal && (
          <div>
            <dt>
              <Layers size={14} aria-hidden />
              <span className="sr-only">Task type</span>
            </dt>
            <dd>{plan.taskType ? <Badge tone={TASK_TONE[plan.taskType]}>{TASK_TYPE_LABEL[plan.taskType]}</Badge> : <span className="muted">No task type</span>}</dd>
          </div>
        )}
      </dl>
      <div className="board-card-foot board-sla">
        <SlaIndicator sla={slaOf(ticket)} status={ticket.status} showLabel />
      </div>
    </article>
  );
}

/** The column a ticket sits in: as the list groups it, with Blocked inside In progress. */
const columnOf = (portal: boolean, s: TicketStatus) => (s === 'blocked' ? 'in_progress' : groupStatusFor(portal, s));

export function Board() {
  const { clients, team, now, slaOf, changeStatus } = useStore();
  const { portal, viewPath } = useTicketScope();
  const tickets = useScopedTickets();
  const [client, setClient] = useState('all');
  const [assignee, setAssignee] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [q, setQ] = useState('');
  const [drag, setDrag] = useState<{ id: string; from: TicketStatus } | null>(null);
  const [over, setOver] = useState<TicketStatus | null>(null);
  const [expanded, setExpanded] = useState<TicketStatus[]>([]);


  const columns = useMemo(() => {
    const term = q.trim().toLowerCase();
    const pool = tickets.filter((t) => {
      // Finished work stays on the board for a week; the list keeps the rest.
      if (!isOpen(t) && (t.canceledAt ?? t.resolvedAt ?? 0) < now - 7 * DAY) return false;
      if (client !== 'all' && t.clientId !== client) return false;
      if (assignee === 'unassigned' ? t.assigneeId != null : assignee !== 'all' && t.assigneeId !== assignee) return false;
      if (severity !== 'all' && (t.severity ?? 'none') !== severity) return false;
      if (term && !`${t.id} ${t.title}`.toLowerCase().includes(term)) return false;
      return true;
    });
    // Same stage order as the list view, except Blocked: on the board it sits in In progress.
    return (portal ? PORTAL_ORDER : STAFF_ORDER.filter((s) => s !== 'blocked')).map((status) => {
      const list = pool.filter((t) => columnOf(portal, t.status) === status);
      // Open stages: blocked work first, then the most urgent deadline. Finished stages: most recent first.
      list.sort((a, b) =>
        isOpen(a) ? Number(b.status === 'blocked') - Number(a.status === 'blocked') || slaOf(a).active.remainingMs - slaOf(b).active.remainingMs || severityRank(b.severity) - severityRank(a.severity) : (b.canceledAt ?? b.resolvedAt ?? 0) - (a.canceledAt ?? a.resolvedAt ?? 0),
      );
      return { status, list };
    });
  }, [tickets, client, assignee, severity, q, now, slaOf, portal]);

  const fields = [
    { key: 'client', label: 'Client', icon: Building2, value: client, empty: 'all', searchable: true, options: [{ value: 'all', label: 'All' }, ...clients.map((c) => ({ value: c.id, label: c.name }))], onChange: setClient },
    {
      key: 'assignee',
      label: 'Assigned to',
      icon: User,
      value: assignee,
      empty: 'all',
      searchable: true,
      options: [{ value: 'all', label: 'Anyone' }, ...team.map((m) => ({ value: m.id, label: m.name }))],
      onChange: setAssignee,
    },
    { key: 'severity', label: 'Priority', icon: Signal, value: severity, empty: 'all', options: [{ value: 'all', label: 'All' }, ...SEVERITIES.map((v) => ({ value: v as string, label: SEVERITY_LABEL[v] })), { value: 'none', label: NO_PRIORITY_LABEL }], onChange: setSeverity },
  ];
  // A client sees one brand and doesn't pick NXS staff, so only severity applies.
  const filterMenu = useFilterMenu(portal ? fields.filter((f) => f.key === 'severity') : fields);
  const clearFilters = () => {
    setClient('all');
    setAssignee('all');
    setSeverity('all');
  };

  const onDragStart = (e: DragEvent, t: Ticket) => {
    e.dataTransfer.setData('text/plain', t.id);
    e.dataTransfer.effectAllowed = 'move';
    setDrag({ id: t.id, from: t.status });
  };
  const endDrag = () => {
    setDrag(null);
    setOver(null);
  };

  return (
    <div className="page page-board">
      <TicketsHeader view="board" />

      <Card flush className="tickets-card board-wrap">
        <TicketsToolbar
          view="board"
          search={q}
          onSearch={setQ}
          placeholder="Search ID or title"
          filter={<FilterButton menu={filterMenu} ariaLabel="Filter board" />}
          chips={<FilterChips menu={filterMenu} onClearAll={filterMenu.active.length ? clearFilters : undefined} />}
        />

        <div className={cx('board', drag && 'is-dragging')}>
        {columns.map(({ status, list }) => {
          const isSource = !!drag && columnOf(portal, drag.from) === status;
          const allowed = drag && !isSource ? canTransition(drag.from, status) : false;
          const showAll = expanded.includes(status);
          const visible = showAll ? list : list.slice(0, COLUMN_LIMIT);
          const Icon = STATUS_ICON[status];
          return (
            <section
              key={status}
              className={cx('board-col', `tone-${STATUS_TONE[status]}`, drag && !isSource && (allowed ? 'is-allowed' : 'is-blocked'), over === status && allowed && 'is-over')}
              aria-label={`${statusLabelFor(portal, status)}, ${list.length} tickets`}
              onDragOver={(e) => {
                if (!allowed) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (over !== status) setOver(status);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === status ? null : o));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain') || drag?.id;
                endDrag();
                if (id && allowed) changeStatus(id, status);
              }}
            >
              <header className="board-col-head">
                <h2>
                  <Icon size={17} aria-hidden className="board-col-icon" />
                  {statusLabelFor(portal, status)}
                  <span className="board-count">{list.length}</span>
                </h2>
              </header>
              <div className="board-col-body">
                {visible.map((t) => (
                  <BoardCard key={t.id} ticket={t} onDragStart={onDragStart} onDragEnd={endDrag} dragging={drag?.id === t.id} />
                ))}
                {list.length === 0 && <p className="board-empty">{drag && allowed ? 'Drop here' : 'No tickets'}</p>}
                {list.length > 0 && drag && allowed && <p className="board-empty board-drop">Drop here</p>}
              </div>
              {/* More than three: one quiet full-width button opens the rest in place. Finished
                  columns hand over to the list, where their whole history lives. */}
              {list.length > COLUMN_LIMIT &&
                (status === 'resolved' || status === 'canceled' ? (
                  <Link to={`${viewPath.list}?status=${status}`} className="board-view-all">
                    <span>View all {list.length}</span>
                    <ArrowRight size={15} aria-hidden />
                  </Link>
                ) : (
                  <button type="button" className="board-view-all" aria-expanded={showAll} onClick={() => setExpanded((x) => (showAll ? x.filter((s) => s !== status) : [...x, status]))}>
                    <span>{showAll ? 'Show fewer' : `View all ${list.length}`}</span>
                    <ChevronDown size={15} aria-hidden className={cx('board-view-all-caret', showAll && 'is-open')} />
                  </button>
                ))}
            </section>
          );
        })}
      </div>
      </Card>
    </div>
  );
}
