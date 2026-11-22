import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, Building2, GripVertical, Signal, User } from 'lucide-react';
import type { Ticket, TicketStatus } from '../types';
import { SEVERITIES, SEVERITY_LABEL, STATUS_LABEL, canTransition, isOpen, severityRank, NO_PRIORITY_LABEL } from '../lib/domain';
import { useStore } from '../store';
import { STATUS_ICON, STATUS_TONE, SeverityBadge, SlaIndicator } from '../components/domain';
import { PORTAL_ORDER, STAFF_ORDER, groupStatusFor, statusLabelFor, useScopedTickets, useTicketScope } from '../components/scope';
import { Avatar, Card, cx } from '../components/ui';
import { FilterButton, FilterChips, useFilterMenu } from '../components/FilterMenu';
import { TicketsHeader, TicketsToolbar } from './Tickets';

const DAY = 24 * 60 * 60_000;
const COLUMN_LIMIT = 8;

/**
 * A ticket as a card, laid out like a row of the list: ID and severity on top,
 * the title, then the same properties the table shows, each with its column
 * icon, and the deadline. Drag the card to move it to another stage.
 */
function BoardCard({ ticket, onDragStart, onDragEnd, dragging }: { ticket: Ticket; onDragStart: (e: DragEvent, t: Ticket) => void; onDragEnd: () => void; dragging: boolean }) {
  const { clientOf, assetOf, memberOf, slaOf } = useStore();
  const { portal, ticketPath } = useTicketScope();
  const client = clientOf(ticket.clientId);
  const member = memberOf(ticket.assigneeId);
  const asset = assetOf(ticket.assetId);
  // Only NXS moves tickets between stages; in the portal the cards stay put.
  return (
    <article
      className={cx('board-card', dragging && 'is-dragging', portal && 'is-static')}
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
        <SeverityBadge severity={ticket.severity} />
      </div>
      <Link to={ticketPath(ticket.id)} className="board-card-title" title={ticket.title}>
        {ticket.title}
      </Link>
      <dl className="board-props">
        {!portal && (
          <div>
            <dt>
              <Building2 size={14} aria-hidden />
              <span className="sr-only">Client</span>
            </dt>
            <dd className="truncate">{client?.name}</dd>
          </div>
        )}
        <div>
          <dt>
            <Boxes size={14} aria-hidden />
            <span className="sr-only">Asset</span>
          </dt>
          <dd className="truncate">{asset?.name}</dd>
        </div>
        <div>
          <dt>
            {/* The person's face says who has it; the icon only stands in when nobody does. */}
            {member ? <Avatar name={member.name} size={20} src={member.photo} /> : <User size={14} aria-hidden />}
            <span className="sr-only">{portal ? 'Handled by' : 'Assigned to'}</span>
          </dt>
          <dd className={cx('truncate', !member && 'muted')}>{member?.name ?? 'Unassigned'}</dd>
        </div>
      </dl>
      <div className="board-card-foot">
        <SlaIndicator sla={slaOf(ticket)} showLabel />
      </div>
    </article>
  );
}

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

  // Which sides have more columns out of view, so those edges fade to white
  // instead of cutting a column off.
  const boardRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measureEdges = useCallback(() => {
    const el = boardRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    measureEdges();
    const ro = new ResizeObserver(measureEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureEdges]);

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
    // Same stage order as the list view.
    return (portal ? PORTAL_ORDER : STAFF_ORDER).map((status) => {
      const list = pool.filter((t) => groupStatusFor(portal, t.status) === status);
      // Open stages: most urgent deadline first. Finished stages: most recent first.
      list.sort((a, b) =>
        isOpen(a) ? slaOf(a).active.remainingMs - slaOf(b).active.remainingMs || severityRank(b.severity) - severityRank(a.severity) : (b.canceledAt ?? b.resolvedAt ?? 0) - (a.canceledAt ?? a.resolvedAt ?? 0),
      );
      return { status, list };
    });
  }, [tickets, client, assignee, severity, q, now, slaOf, portal]);
  useEffect(measureEdges, [columns, expanded, measureEdges]);

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

        <div ref={boardRef} onScroll={measureEdges} className={cx('board', drag && 'is-dragging', edges.left && 'fade-left', edges.right && 'fade-right')}>
        {columns.map(({ status, list }) => {
          const allowed = drag ? canTransition(drag.from, status) : false;
          const isSource = drag?.from === status;
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
                {list.length > COLUMN_LIMIT && (
                  <button type="button" className="board-more" onClick={() => setExpanded((x) => (showAll ? x.filter((s) => s !== status) : [...x, status]))}>
                    {showAll ? 'Show fewer' : `Show ${list.length - COLUMN_LIMIT} more`}
                  </button>
                )}
                {(status === 'resolved' || status === 'canceled') && (
                  <Link to={`${viewPath.list}?status=${status}`} className="board-more">
                    View all {statusLabelFor(portal, status).toLowerCase()} tickets
                  </Link>
                )}
              </div>
            </section>
          );
        })}
      </div>
      </Card>
    </div>
  );
}
