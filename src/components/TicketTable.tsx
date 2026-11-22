import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  Boxes,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Signal,
  Tag,
  Text,
  Ticket as TicketIcon,
  Timer,
  User,
  type LucideIcon,
} from 'lucide-react';
import type { Ticket, TicketStatus } from '../types';
import { fmtDate, fmtTime } from '../lib/format';
import { useStore } from '../store';
import { CATEGORY_LABEL, OPEN_STATUSES, STATUS_LABEL } from '../lib/domain';
import { Assignee, ClientCell, STATUS_ICON, STATUS_TONE, SeverityBadge, SlaIndicator, StatusBadge } from './domain';
import { PORTAL_ORDER, STAFF_ORDER, groupStatusFor, statusLabelFor, useTicketScope } from './scope';
import { Button, Empty, Select, cx } from './ui';
import { AssignMenu } from './AssignMenu';

export type TicketColumn = 'id' | 'title' | 'client' | 'asset' | 'category' | 'severity' | 'status' | 'assignee' | 'sla' | 'created';
export interface TicketSort {
  key: TicketColumn;
  dir: 'asc' | 'desc';
}

const HEAD: Record<TicketColumn, string> = {
  id: 'Ticket ID',
  title: 'Issue title',
  client: 'Client',
  asset: 'Asset',
  category: 'Category',
  severity: 'Priority',
  status: 'Status',
  assignee: 'Assigned to',
  sla: 'SLA',
  created: 'Created',
};

/* A client reads the assignee as who at NXS handles it. */
const PORTAL_HEAD: Partial<Record<TicketColumn, string>> = { assignee: 'Handled by' };

const HEAD_ICON: Record<TicketColumn, LucideIcon> = {
  id: TicketIcon,
  title: Text,
  client: Building2,
  asset: Boxes,
  category: Tag,
  severity: Signal,
  status: CircleDot,
  assignee: User,
  sla: Timer,
  created: CalendarDays,
};

/** Column widths in px. The title column has none: it takes the remaining space. */
const WIDTH: Partial<Record<TicketColumn, number>> = {
  id: 112,
  client: 150,
  asset: 150,
  category: 104,
  // Wide enough for "P1 Critical" with room either side.
  severity: 148,
  status: 172,
  assignee: 170,
  sla: 132,
  created: 124,
};
/* Every cell is one line. The title is the widest column but gives way
   first; everything else keeps its width so dates and badges never wrap. */
const TITLE_MIN = 210;

const ALL: TicketColumn[] = ['id', 'title', 'client', 'asset', 'category', 'severity', 'status', 'assignee', 'sla', 'created'];

interface Props {
  tickets: Ticket[];
  hide?: TicketColumn[];
  sort?: TicketSort;
  onSort?: (key: TicketColumn) => void;
  emptyTitle?: string;
  emptyText?: string;
}

/** The header row: one cell per column, sortable when `onSort` is given. */
function TicketHead({ cols, sort, onSort }: { cols: TicketColumn[]; sort?: TicketSort; onSort?: (key: TicketColumn) => void }) {
  const { portal } = useTicketScope();
  return (
    <thead>
      <tr>
        {cols.map((c) => {
          const active = sort?.key === c;
          const Icon = HEAD_ICON[c];
          const label = (
            <>
              <Icon size={15} aria-hidden className="th-icon" />
              {(portal && PORTAL_HEAD[c]) || HEAD[c]}
            </>
          );
          return (
            <th key={c} className={`col-${c}`} style={{ width: WIDTH[c] }} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
              {onSort ? (
                <button type="button" className={cx('th-sort', active && 'is-active')} onClick={() => onSort(c)}>
                  {label}
                  {active && (sort!.dir === 'asc' ? <ArrowUp size={13} aria-hidden className="th-dir" /> : <ArrowDown size={13} aria-hidden className="th-dir" />)}
                </button>
              ) : (
                <span className="th-label">{label}</span>
              )}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

/** One ticket as a table row. The whole row opens the ticket. */
function TicketRow({ t, cols }: { t: Ticket; cols: TicketColumn[] }) {
  const { assetOf, slaOf, memberOf } = useStore();
  const { portal, ticketPath } = useTicketScope();
  const navigate = useNavigate();
  const open = () => navigate(ticketPath(t.id));
  return (
    <tr key={t.id} className="row-link" onClick={open}>
      {cols.map((c) => {
        switch (c) {
          case 'id':
            return (
              <td key={c} className="col-id">
                <Link to={ticketPath(t.id)} className="ticket-id" onClick={(e) => e.stopPropagation()}>
                  {t.id}
                </Link>
              </td>
            );
          case 'title':
            return (
              <td key={c} className="col-title">
                <span className="ticket-title" title={t.title}>
                  {t.title}
                </span>
              </td>
            );
          case 'client':
            return (
              <td key={c} className="col-client">
                <ClientCell clientId={t.clientId} />
              </td>
            );
          case 'asset':
            return (
              <td key={c} className="col-asset">
                <span className="truncate muted-strong" title={assetOf(t.assetId)?.name}>
                  {assetOf(t.assetId)?.name}
                </span>
              </td>
            );
          case 'category':
            return (
              <td key={c} title={CATEGORY_LABEL[t.category]}>
                {CATEGORY_LABEL[t.category].replace(' issue', '')}
              </td>
            );
          case 'severity':
            return (
              <td key={c}>
                <SeverityBadge severity={t.severity} />
              </td>
            );
          case 'status':
            return (
              <td key={c}>
                <StatusBadge status={t.status} />
              </td>
            );
          case 'assignee':
            return (
              <td key={c} className="col-assignee">
                {/* Only NXS staff assign; a client just sees who has it. */}
                {portal ? <Assignee member={memberOf(t.assigneeId)} /> : <AssignMenu ticket={t} variant="cell" />}
              </td>
            );
          case 'sla':
            return (
              <td key={c} className="col-sla">
                <SlaIndicator sla={slaOf(t)} />
              </td>
            );
          case 'created':
            return (
              <td key={c} className="col-created">
                {fmtDate(t.createdAt)}
                <span className="muted">, {fmtTime(t.createdAt)}</span>
              </td>
            );
        }
      })}
    </tr>
  );
}

const tableWidth = (cols: TicketColumn[]) => cols.reduce((w, c) => w + (WIDTH[c] ?? TITLE_MIN), 0);

export function TicketTable({ tickets, hide = [], sort, onSort, emptyTitle = 'No tickets found', emptyText }: Props) {
  const cols = ALL.filter((c) => !hide.includes(c));
  if (!tickets.length) return <Empty title={emptyTitle}>{emptyText}</Empty>;

  return (
    <div className="table-wrap table-frame">
      <table className="table ticket-table" style={{ minWidth: tableWidth(cols) }}>
        <TicketHead cols={cols} sort={sort} onSort={onSort} />
        <tbody>
          {tickets.map((t) => (
            <TicketRow key={t.id} t={t} cols={cols} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Pagination ---------- */

export const PAGE_SIZES = [10, 20, 30, 50, 100];

/** Page numbers with gaps: first, last, and the pages around the current one. */
function pageList(pages: number, current: number) {
  const out: (number | '…')[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - current) <= 1) out.push(p);
    else if (out[out.length - 1] !== '…') out.push('…');
  }
  return out;
}

export function Pager({ total, page, size, onPage, onSize, label }: { total: number; page: number; size: number; onPage: (p: number) => void; onSize: (s: number) => void; label: string }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <nav className="pager" aria-label={label}>
      <span className="pager-range">
        Showing <strong>{(page - 1) * size + 1}–{Math.min(page * size, total)}</strong> of {total.toLocaleString()}
      </span>
      <div className="pager-controls">
        <Select size="sm" prefix="Rows" ariaLabel={`Rows per page, ${label}`} value={String(size)} onChange={(v) => onSize(Number(v))} options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))} />
        <Button size="sm" icon={<ChevronLeft size={16} />} aria-label="Previous page" disabled={page === 1} onClick={() => onPage(page - 1)} />
        {pageList(pages, page).map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="page-gap">
              …
            </span>
          ) : (
            <button key={p} type="button" className={cx('page-num', p === page && 'is-active')} aria-current={p === page ? 'page' : undefined} onClick={() => onPage(p)}>
              {p}
            </button>
          ),
        )}
        <Button size="sm" icon={<ChevronRight size={16} />} aria-label="Next page" disabled={page === pages} onClick={() => onPage(page + 1)} />
      </div>
    </nav>
  );
}

/* ---------- Grouped by stage ---------- */

/** Stages in the order work needs attention: incoming first, finished last. */
export const GROUP_ORDER: TicketStatus[] = STAFF_ORDER;

/**
 * The same table, split into one section per stage. Each section folds; the
 * finished stages start folded whenever open work is on screen. A section with
 * more than ten tickets pages, with its own page and page size.
 */
export function TicketGroups({ tickets, hide = [], sort, onSort, emptyTitle, emptyText }: Props) {
  const { portal } = useTicketScope();
  const groups = useMemo(
    () => (portal ? PORTAL_ORDER : STAFF_ORDER).map((status) => ({ status, list: tickets.filter((t) => groupStatusFor(portal, t.status) === status) })).filter((g) => g.list.length),
    [tickets, portal],
  );
  const [folded, setFolded] = useState<Partial<Record<TicketStatus, boolean>>>({});
  const [paging, setPaging] = useState<Partial<Record<TicketStatus, { page: number; size: number }>>>({});

  if (!tickets.length) return <Empty title={emptyTitle ?? 'No tickets found'}>{emptyText}</Empty>;
  const hasOpen = groups.some((g) => OPEN_STATUSES.includes(g.status));

  return (
    <div className="ticket-groups">
      {groups.map(({ status, list }) => {
        const isFolded = folded[status] ?? (hasOpen && !OPEN_STATUSES.includes(status));
        const size = paging[status]?.size ?? PAGE_SIZES[0];
        const pages = Math.max(1, Math.ceil(list.length / size));
        // Filters can shrink a section under the page it was on.
        const page = Math.min(paging[status]?.page ?? 1, pages);
        const Icon = STATUS_ICON[status];
        const id = `group-${status}`;
        return (
          <section key={status} className={cx('ticket-group', `tone-${STATUS_TONE[status]}`)} aria-labelledby={`${id}-label`}>
            <h3 className="ticket-group-head">
              <button type="button" className="ticket-group-toggle" aria-expanded={!isFolded} aria-controls={id} onClick={() => setFolded((f) => ({ ...f, [status]: !isFolded }))}>
                <ChevronDown size={16} aria-hidden className="ticket-group-chevron" />
                <Icon size={17} aria-hidden className="ticket-group-icon" />
                <span id={`${id}-label`}>{statusLabelFor(portal, status)}</span>
                <span className="ticket-group-count">{list.length}</span>
              </button>
            </h3>
            {!isFolded && (
              <div id={id} className="ticket-group-body">
                <TicketTable tickets={list.slice((page - 1) * size, page * size)} hide={[...hide, 'status']} sort={sort} onSort={onSort} />
                {list.length > PAGE_SIZES[0] && (
                  <Pager
                    label={`${statusLabelFor(portal, status)} tickets`}
                    total={list.length}
                    page={page}
                    size={size}
                    onPage={(p) => setPaging((x) => ({ ...x, [status]: { size, page: p } }))}
                    onSize={(n) => setPaging((x) => ({ ...x, [status]: { size: n, page: 1 } }))}
                  />
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
