import { useCallback, useMemo, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Boxes, Building2, CalendarDays, CircleDot, Clock, Download, LayoutList, Plus, Search, Send, Signal, SquareKanban, Tag, Timer, User, X } from 'lucide-react';
import type { Category, Severity, Ticket, TicketStatus } from '../types';
import { CATEGORIES, CATEGORY_LABEL, CHANNEL_LABEL, PORTAL_STATUSES, SEVERITIES, SEVERITY_LABEL, STATUSES, STATUS_LABEL, isOpen, portalStatus, severityRank, NO_PRIORITY_LABEL, TASK_TYPE_LABEL, priorityLabel } from '../lib/domain';
import { downloadCsv, fmtDateTime, fmtDateYear, fromDateInput, startOfDay, toDateInput } from '../lib/format';
import { SLA_STATE_LABEL } from '../lib/sla';
import { expectedDone } from '../lib/plan';
import { useStore } from '../store';
import { TicketGroups, type TicketColumn, type TicketSort } from '../components/TicketTable';
import { Button, Card, PageHeader, cx, type Option } from '../components/ui';
import { FilterButton, FilterChips, useFilterMenu, type FilterField } from '../components/FilterMenu';
import { statusLabelFor, useScopedTickets, useTicketScope, type TicketsView } from '../components/scope';

const DAY = 24 * 60 * 60_000;

const RANGE_OPTIONS: Option[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
];

/** Export is built but hidden for now; flip this to show the button again. */
const SHOW_EXPORT = false;

export type { TicketsView };


/** Shared header for the list, board and calendar views of the same tickets. */
export function TicketsHeader({ view, actions }: { view: TicketsView; actions?: ReactNode }) {
  const { portal } = useTicketScope();
  if (portal) {
    return (
      <PageHeader
        title="Tickets"
        actions={
          <Link to="/portal/tickets/new" className="btn btn-primary">
            <Plus size={17} aria-hidden /> New ticket
          </Link>
        }
      />
    );
  }
  return (
    <PageHeader
      title="Tickets"
      actions={
        <>
          {actions}
          <Link to="/tickets/new" className="btn btn-primary">
            <Plus size={17} aria-hidden />
            Log ticket for client
          </Link>
        </>
      }
    />
  );
}

/**
 * The top of the tickets container: the view tabs on the left, search and the
 * filter button pushed to the right. Active filters show as chips beneath.
 */
export function TicketsToolbar({ view, search, onSearch, placeholder, filter, chips }: { view: TicketsView; search: string; onSearch: (q: string) => void; placeholder: string; filter: ReactNode; chips?: ReactNode }) {
  const { viewPath } = useTicketScope();
  // Switching view keeps the filters and the search: they live in the URL.
  const { search: query } = useLocation();
  const carried = (() => {
    const p = new URLSearchParams(query);
    for (const k of ['page', 'size', 'sort', 'dir']) p.delete(k);
    const out = p.toString();
    return out ? `?${out}` : '';
  })();
  const tabs = [
    { key: 'list', label: 'List', to: viewPath.list, icon: LayoutList },
    { key: 'board', label: 'Board', to: viewPath.board, icon: SquareKanban },
    // Calendar is hidden for now; its page is still there, and /tickets/calendar sends you to the list.
  ] as const;
  return (
    <div className="tickets-toolbar-wrap">
      <div className="tickets-toolbar">
        <nav className="view-tabs" aria-label="Ticket view">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <Link key={t.key} to={`${t.to}${carried}`} className={cx('view-tab', view === t.key && 'is-active')} aria-current={view === t.key ? 'page' : undefined}>
                <Icon size={16} aria-hidden />
                <span>
                  {t.label}
                  <span className="view-tab-suffix"> view</span>
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="tickets-toolbar-tools">
          <label className="filter-search">
            <Search size={16} aria-hidden />
            <input type="search" placeholder={placeholder} aria-label={placeholder} value={search} onChange={(e) => onSearch(e.target.value)} />
          </label>
          {filter}
        </div>
      </div>
      {chips}
    </div>
  );
}

/** Reads and writes ticket filters in the URL so filtered views can be linked and shared. */
export function useTicketFilters() {
  const [params, setParams] = useSearchParams();
  const get = (key: string, fallback = 'all') => params.get(key) ?? fallback;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '' || v === 'all') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  return { params, get, set, clear: () => setParams(new URLSearchParams(), { replace: true }) };
}


/** SLA states a filter can pick; the calendar only shows open work, so it leaves out the finished ones. */
const SLA_FILTER: { value: string; label: string; open: boolean }[] = [
  { value: 'within', label: SLA_STATE_LABEL.within, open: true },
  { value: 'at_risk', label: SLA_STATE_LABEL.at_risk, open: true },
  { value: 'breached', label: SLA_STATE_LABEL.breached, open: true },
  { value: 'met', label: SLA_STATE_LABEL.met, open: false },
  { value: 'missed', label: SLA_STATE_LABEL.missed, open: false },
  { value: 'excluded', label: SLA_STATE_LABEL.excluded, open: true },
];

/**
 * The filters every ticket view shares (list, board, calendar), read from and
 * written to the URL, so a filter set in one view is still on in the next.
 * One search too: ID, title, client and asset. The list adds Status and a date
 * range on top; the board's columns already are the status.
 */
export function useSharedTicketFilters(view: TicketsView) {
  const { clients, assets: allAssets, team, slaOf, clientOf, assetOf } = useStore();
  const { portal, clientId } = useTicketScope();
  const { params, get, set, clear } = useTicketFilters();
  const q = get('q', '');
  const client = get('client');
  const asset = get('asset');
  const category = get('category');
  const severity = get('severity');
  const assignee = get('assignee');
  const slaState = get('sla');
  const source = get('source');

  const assets = useMemo(() => (clientId ? allAssets.filter((a) => a.clientId === clientId) : allAssets), [allAssets, clientId]);
  const assetOptions = useMemo(() => assets.filter((a) => client === 'all' || a.clientId === client), [assets, client]);

  const match = useCallback(
    (t: Ticket) => {
      if (client !== 'all' && t.clientId !== client) return false;
      if (asset !== 'all' && t.assetId !== asset) return false;
      if (category !== 'all' && t.category !== category) return false;
      if (severity !== 'all' && (t.severity ?? 'none') !== severity) return false;
      if (assignee === 'unassigned' ? t.assigneeId != null : assignee !== 'all' && t.assigneeId !== assignee) return false;
      if (source === 'portal' ? t.source.channel !== 'portal' : source === 'manual' && t.source.channel === 'portal') return false;
      if (slaState !== 'all' && slaOf(t).overall !== slaState) return false;
      const term = q.trim().toLowerCase();
      if (term && !`${t.id} ${t.title} ${clientOf(t.clientId)?.name ?? ''} ${assetOf(t.assetId)?.name ?? ''}`.toLowerCase().includes(term)) return false;
      return true;
    },
    [client, asset, category, severity, assignee, source, slaState, q, slaOf, clientOf, assetOf],
  );

  const all = (label = 'All'): Option => ({ value: 'all', label });
  const fields: FilterField[] = [
    {
      key: 'client',
      label: 'Client',
      icon: Building2,
      value: client,
      empty: 'all',
      searchable: true,
      options: [all(), ...clients.map((c) => ({ value: c.id, label: c.name }))],
      // An asset belongs to one client, so a new client clears it.
      onChange: (v) => set({ client: v, asset: null }),
    },
    {
      key: 'asset',
      label: 'Asset',
      icon: Boxes,
      value: asset,
      empty: 'all',
      searchable: true,
      options: [all(), ...assetOptions.map((a) => ({ value: a.id, label: a.name }))],
      onChange: (v) => set({ asset: v }),
    },
    {
      key: 'category',
      label: 'Category',
      icon: Tag,
      value: category,
      empty: 'all',
      options: [all(), ...CATEGORIES.map((c: Category) => ({ value: c as string, label: CATEGORY_LABEL[c] }))],
      onChange: (v) => set({ category: v }),
    },
    {
      key: 'severity',
      label: 'Priority',
      icon: Signal,
      value: severity,
      empty: 'all',
      options: [all(), ...SEVERITIES.map((v: Severity) => ({ value: v as string, label: SEVERITY_LABEL[v] })), { value: 'none', label: NO_PRIORITY_LABEL }],
      onChange: (v) => set({ severity: v }),
    },
    {
      key: 'assignee',
      label: 'Assigned to',
      icon: User,
      value: assignee,
      empty: 'all',
      searchable: true,
      options: [all('Anyone'), { value: 'unassigned', label: 'Unassigned' }, ...team.map((m) => ({ value: m.id, label: m.name }))],
      onChange: (v) => set({ assignee: v }),
    },
    {
      key: 'sla',
      label: 'SLA',
      icon: Timer,
      value: slaState,
      empty: 'all',
      options: [all('Any'), ...SLA_FILTER.filter((o) => view !== 'calendar' || o.open).map(({ value, label }) => ({ value, label }))],
      onChange: (v) => set({ sla: v }),
    },
    {
      key: 'source',
      label: 'Source',
      icon: Send,
      value: source,
      empty: 'all',
      options: [all('Any'), { value: 'portal', label: 'Client Portal' }, { value: 'manual', label: 'Logged by NXS' }],
      onChange: (v) => set({ source: v }),
    },
  ];
  // A client sees only their own company and doesn't pick NXS staff.
  const PORTAL_SHARED = ['asset', 'category', 'severity'];
  const shown = portal ? fields.filter((f) => PORTAL_SHARED.includes(f.key)) : fields;

  /** Clears what this view can show, and the search; filters only another view uses stay put. */
  const clearShown = () => set(Object.fromEntries([...shown.map((f) => [f.key, null]), ['q', null]]));
  const hasActive = shown.some((f) => f.value !== f.empty) || q !== '';

  return { q, setQ: (v: string) => set({ q: v }), fields: shown, match, params, get, set, clear, clearShown, hasActive, portal };
}

export function Tickets() {
  const { now, clientOf, assetOf, memberOf, reporterOf, slaOf } = useStore();
  const tickets = useScopedTickets();
  const shared = useSharedTicketFilters('list');
  const { q, setQ, match, params, get, set, clear, portal } = shared;

  const status = get('status');
  const response = get('response');
  const range = get('range');
  const from = get('from', '');
  const to = get('to', '');
  const sort: TicketSort = { key: get('sort', 'created') as TicketColumn, dir: get('dir', 'desc') as 'asc' | 'desc' };

  const filtered = useMemo(() => {
    let start: number | null = null;
    let end: number | null = null;
    if (range === 'today') start = startOfDay(now);
    else if (range === 'month') start = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
    else if (range === 'custom') {
      start = fromDateInput(from);
      const e = fromDateInput(to);
      end = e != null ? e + DAY : null;
    } else if (range !== 'all') start = startOfDay(now) - (Number(range) - 1) * DAY;
    // "Resolved this month" style views filter on when the work finished, not when it was reported.
    const dateOf = (t: Ticket) => (status === 'done' ? (t.resolvedAt ?? t.canceledAt ?? t.createdAt) : t.createdAt);

    return tickets.filter((t) => {
      if (!match(t)) return false;
      if (status === 'open' ? !isOpen(t) : status === 'done' ? isOpen(t) : status !== 'all' && (portal ? portalStatus(t.status) : t.status) !== status) return false;
      if (response === 'awaiting' && (t.firstRespondedAt != null || !isOpen(t))) return false;
      if (start != null && dateOf(t) < start) return false;
      if (end != null && dateOf(t) >= end) return false;
      return true;
    });
  }, [tickets, match, status, response, range, from, to, now, portal]);

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const text = (a: string, b: string) => a.localeCompare(b);
    const cmp: Record<TicketColumn, (a: Ticket, b: Ticket) => number> = {
      id: (a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)),
      title: (a, b) => text(a.title, b.title),
      client: (a, b) => text(clientOf(a.clientId)?.name ?? '', clientOf(b.clientId)?.name ?? ''),
      asset: (a, b) => text(assetOf(a.assetId)?.name ?? '', assetOf(b.assetId)?.name ?? ''),
      category: (a, b) => text(a.category, b.category),
      severity: (a, b) => severityRank(a.severity) - severityRank(b.severity),
      status: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status),
      assignee: (a, b) => text(memberOf(a.assigneeId)?.name ?? 'zzz', memberOf(b.assigneeId)?.name ?? 'zzz'),
      sla: (a, b) => {
        const oa = isOpen(a);
        const ob = isOpen(b);
        if (oa !== ob) return oa ? -1 : 1;
        return slaOf(a).active.remainingMs - slaOf(b).active.remainingMs;
      },
      reporter: (a, b) => text(reporterOf(a)?.name ?? 'zzz', reporterOf(b)?.name ?? 'zzz'),
      created: (a, b) => a.createdAt - b.createdAt,
    };
    const fn = cmp[sort.key] ?? cmp.created;
    return [...filtered].sort((a, b) => fn(a, b) * dir || b.createdAt - a.createdAt);
  }, [filtered, sort.key, sort.dir, clientOf, assetOf, memberOf, reporterOf, slaOf]);

  const activeCount = [...params.keys()].filter((k) => !['sort', 'dir', 'page', 'size'].includes(k)).length;

  const onSort = (key: TicketColumn) => {
    const firstDir = key === 'created' || key === 'severity' || key === 'id' ? 'desc' : 'asc';
    set({ sort: key, dir: sort.key === key ? (sort.dir === 'asc' ? 'desc' : 'asc') : firstDir });
  };

  const filterFields: FilterField[] = [
    {
      key: 'status',
      label: 'Status',
      icon: CircleDot,
      value: status,
      empty: 'all',
      options: [{ value: 'all', label: 'All' }, { value: 'open', label: 'All open' }, { value: 'done', label: 'Resolved or canceled' }, ...(portal ? PORTAL_STATUSES : STATUSES).map((v: TicketStatus) => ({ value: v as string, label: statusLabelFor(portal, v) }))],
      onChange: (v) => set({ status: v }),
    },
    ...shared.fields,
    {
      key: 'range',
      label: status === 'done' ? 'Resolved' : 'Created',
      icon: CalendarDays,
      value: range,
      empty: 'all',
      options: RANGE_OPTIONS,
      onChange: (v) => set({ range: v, from: null, to: null }),
      stayOpenOn: 'custom',
      chipText: range === 'custom' ? (from || to ? `${from || '…'} to ${to || 'today'}` : 'Custom range') : undefined,
      extra:
        range === 'custom' ? (
          <div className="date-range">
            <input type="date" className="input input-sm" aria-label="From date" value={from} max={to || toDateInput(now)} onChange={(e) => set({ from: e.target.value })} />
            <span className="muted">to</span>
            <input type="date" className="input input-sm" aria-label="To date" value={to} min={from} max={toDateInput(now)} onChange={(e) => set({ to: e.target.value })} />
          </div>
        ) : undefined,
    },
  ];

  const exportCsv = () =>
    downloadCsv('nxshield-tickets.csv', [
      ['Ticket ID', 'Issue title', 'Client', 'Asset', 'Category', 'Priority', 'Status', 'Assigned to', 'SLA', 'Reported by', 'Created', 'Source', ...(portal ? [] : ['Sprint plan', 'Task type', 'Story points', 'Expected done'])],
      ...sorted.map((t) => [
        t.id,
        t.title,
        clientOf(t.clientId)?.name ?? '',
        assetOf(t.assetId)?.name ?? '',
        CATEGORY_LABEL[t.category],
        priorityLabel(t.severity),
        STATUS_LABEL[t.status],
        memberOf(t.assigneeId)?.name ?? 'Unassigned',
        SLA_STATE_LABEL[slaOf(t).overall],
        reporterOf(t)?.name ?? '',
        fmtDateTime(t.createdAt),
        CHANNEL_LABEL[t.source.channel],
        // Planning is NXS's own; a client's export leaves it out.
        ...(portal ? [] : [t.plan?.sprint ?? '', t.plan?.taskType ? TASK_TYPE_LABEL[t.plan.taskType] : '', t.plan?.storyPoints?.toString() ?? '', fmtDateYear(expectedDone(t, slaOf(t)).at)]),
      ]),
    ]);

  // A client filters by what they know: stage, asset, type, priority and date (the shared hook already left out the rest).
  const filterMenu = useFilterMenu(filterFields);

  return (
    <div className="page">
      <TicketsHeader
        view="list"
        actions={
          SHOW_EXPORT && (
            <Button icon={<Download size={17} />} onClick={exportCsv}>
              Export CSV
            </Button>
          )
        }
      />

      <Card flush className="tickets-card">
        <TicketsToolbar
          view="list"
          search={q}
          onSearch={setQ}
          placeholder={portal ? 'Search ID, title, asset' : 'Search ID, title, client, asset'}
          filter={<FilterButton menu={filterMenu} ariaLabel="Filter tickets" />}
          chips={
            <FilterChips
              menu={filterMenu}
              onClearAll={activeCount > 0 ? clear : undefined}
              extra={
                response === 'awaiting' && (
                  <span className="filter-chip">
                    <span className="filter-chip-main">
                      <Clock size={14} aria-hidden />
                      <strong>Awaiting first response</strong>
                    </span>
                    <button type="button" className="filter-chip-remove" aria-label="Remove awaiting first response filter" onClick={() => set({ response: null })}>
                      <X size={14} aria-hidden />
                    </button>
                  </span>
                )
              }
            />
          }
        />

        <TicketGroups
          tickets={sorted}
          // A client sees who handles a ticket on the ticket itself, not in the list.
          hide={portal ? ['client', 'assignee'] : []}
          sort={sort}
          onSort={onSort}
          emptyTitle={portal && tickets.length === 0 ? 'No tickets yet' : 'No tickets match these filters'}
          emptyText={portal && tickets.length === 0 ? 'When something isn’t working, use New ticket and NXS takes it from there.' : 'Try removing a filter or widening the date range.'}
        />
      </Card>
    </div>
  );
}
