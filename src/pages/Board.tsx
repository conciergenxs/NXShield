import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Ban, Boxes, ChevronDown, FlaskConical, GripVertical, Hash, Layers, User } from 'lucide-react';
import type { TaskType, Ticket, TicketStatus } from '../types';
import { NEXT_STAGE, TASK_TYPE_LABEL, canTransition, isOpen, severityRank } from '../lib/domain';
import { useStore } from '../store';
import { STATUS_ICON, STATUS_TONE, SeverityBadge, SlaIndicator } from '../components/domain';
import { PORTAL_ORDER, STAFF_ORDER, groupStatusFor, statusLabelFor, useScopedTickets, useTicketScope } from '../components/scope';
import { Avatar, Badge, Card, cx, type Tone } from '../components/ui';
import { FilterButton, FilterChips, useFilterMenu } from '../components/FilterMenu';
import { TicketsHeader, TicketsToolbar, useSharedTicketFilters } from './Tickets';
import { TicketPeek } from './TicketDetail';

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
function BoardCard({ ticket, onDragStart, onDragEnd, dragging, landed, onOpen }: { ticket: Ticket; onDragStart: (e: DragEvent, t: Ticket) => void; onDragEnd: () => void; dragging: boolean; landed?: boolean; onOpen: (id: string) => void }) {
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
      className={cx('board-card', dragging && 'is-dragging', portal && 'is-static', blocker && 'has-blocker', landed && 'is-landed')}
      draggable={!portal}
      onDragStart={portal ? undefined : (e) => onDragStart(e, ticket)}
      onDragEnd={portal ? undefined : onDragEnd}
      // Staff: a click anywhere on the card opens its step beside the board (links inside still work as links).
      onClick={
        portal
          ? undefined
          : (e) => {
              if ((e.target as HTMLElement).closest('a, button')) return;
              onOpen(ticket.id);
            }
      }
    >
      <div className="board-card-top">
        {/* The grip says the card can be dragged; the whole card is the drag source. */}
        {!portal && <GripVertical size={16} aria-hidden className="board-grip" />}
        {portal ? (
          <Link to={ticketPath(ticket.id)} className="ticket-id">
            {ticket.id}
          </Link>
        ) : (
          <span className="ticket-id">{ticket.id}</span>
        )}
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
      {portal ? (
        <Link to={ticketPath(ticket.id)} className="board-card-title" title={ticket.title}>
          {ticket.title}
        </Link>
      ) : (
        <button type="button" className="board-card-title" title={ticket.title} onClick={() => onOpen(ticket.id)}>
          {ticket.title}
        </button>
      )}
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
  const { now, slaOf, changeStatus } = useStore();
  const { portal, viewPath } = useTicketScope();
  const tickets = useScopedTickets();
  const { q, setQ, fields, match, clearShown, hasActive, get, set } = useSharedTicketFilters('board');
  // The ticket open beside the board lives in the address (?peek=), with the stage it was dragged to, if any.
  const peek = get('peek', '');
  const intent = get('to', '') as TicketStatus | '';
  const openPeek = (id: string, to?: TicketStatus) => set({ peek: id, to: to ?? null });
  const closePeek = useCallback(() => set({ peek: null, to: null }), [set]); // eslint-disable-line react-hooks/exhaustive-deps
  const [drag, setDrag] = useState<{ id: string; from: TicketStatus } | null>(null);
  const [over, setOver] = useState<TicketStatus | null>(null);
  const [expanded, setExpanded] = useState<TicketStatus[]>([]);
  const [landed, setLanded] = useState<string | null>(null);


  const columns = useMemo(() => {
    const pool = tickets.filter((t) => {
      // Finished work stays on the board for a week; the list keeps the rest.
      if (!isOpen(t) && (t.canceledAt ?? t.resolvedAt ?? 0) < now - 7 * DAY) return false;
      return match(t);
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
  }, [tickets, match, now, slaOf, portal]);

  const filterMenu = useFilterMenu(fields);

  // A card that landed past the first three of its column: open the column so it shows.
  useEffect(() => {
    if (!landed) return;
    const col = columns.find((c) => c.list.some((t) => t.id === landed));
    if (col && col.list.findIndex((t) => t.id === landed) >= COLUMN_LIMIT) setExpanded((x) => (x.includes(col.status) ? x : [...x, col.status]));
  }, [landed, columns]);

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
          placeholder={portal ? 'Search ID, title, asset' : 'Search ID, title, client, asset'}
          filter={<FilterButton menu={filterMenu} ariaLabel="Filter board" />}
          chips={<FilterChips menu={filterMenu} onClearAll={hasActive ? clearShown : undefined} />}
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
                if (!id || !allowed) return;
                // The next stage in the flow is reached by finishing the step, as on the ticket page: open it beside the board.
                const from = tickets.find((t) => t.id === id)?.status;
                if (from && NEXT_STAGE[from] === status) {
                  openPeek(id, status);
                  return;
                }
                if (changeStatus(id, status)) {
                  // The card lands where you can see it and glows for a moment; its column opens if it fell past the first three (below).
                  setLanded(id);
                  window.setTimeout(() => setLanded((l) => (l === id ? null : l)), 1800);
                }
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
                  <BoardCard key={t.id} ticket={t} onDragStart={onDragStart} onDragEnd={endDrag} dragging={drag?.id === t.id} landed={landed === t.id} onOpen={(id) => openPeek(id)} />
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
      {peek && !portal && <TicketPeek key={peek} ticketId={peek} intent={intent || undefined} onClose={closePeek} />}
    </div>
  );
}
