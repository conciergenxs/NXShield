import { UptimeCard } from '../components/Uptime';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Activity, Boxes, Briefcase, ChevronDown, Clock, CircleCheck, CircleDot, ChartNoAxesColumn, Layers, Monitor, Plus, TabletSmartphone, Ticket as TicketIcon, Timer, User, Users, type LucideIcon } from 'lucide-react';
import type { Asset, AssetCategory, AssetStatus, Ticket } from '../types';
import { isOpen } from '../lib/domain';
import { fmtRelative, pct } from '../lib/format';
import { useStore } from '../store';
import { ClientLogo } from '../components/domain';
import { PAGE_SIZES, Pager, TicketTable } from '../components/TicketTable';
import { Avatar, Button, Card, Empty, PageHeader, cx } from '../components/ui';
import { BackHeader } from '../components/detail';

/* ---------- Shared: numbers, live status, product table ---------- */

/** How each asset is doing right now, in words a support lead reads at a glance. */
const LIVE_LABEL: Record<AssetStatus, string> = {
  operational: 'Live',
  degraded: 'Degraded',
  outage: 'Down',
  maintenance: 'Maintenance',
  unknown: 'No signal',
};
/** Worst first: a client's health is the state of its least healthy asset. */
const LIVE_RANK: AssetStatus[] = ['outage', 'degraded', 'maintenance', 'unknown', 'operational'];

/** One icon per kind of product. */
const ASSET_ICON: Record<AssetCategory, LucideIcon> = {
  consumer_website: Monitor,
  marketing_dashboard: ChartNoAxesColumn,
  omnichannel_dashboard: Layers,
  lms_app: TabletSmartphone,
};

const PRODUCT_COLS: { key: string; label: string; icon: LucideIcon; width?: number }[] = [
  { key: 'product', label: 'Asset', icon: Boxes },
  { key: 'status', label: 'Status', icon: CircleDot, width: 180 },
  { key: 'uptime', label: 'Uptime, 30 days', icon: Activity, width: 170 },
  { key: 'open', label: 'Open tickets', icon: TicketIcon, width: 150 },
];

interface RowStats {
  open: number;
  met: number;
  resolved: number;
}
const NO_STATS: RowStats = { open: 0, met: 0, resolved: 0 };

/** Open tickets and SLA results, keyed by client id and by asset id. */
function useRowStats() {
  const { tickets, slaOf } = useStore();
  return useMemo(() => {
    const map = new Map<string, RowStats>();
    const add = (key: string, t: Ticket) => {
      const s = map.get(key) ?? { ...NO_STATS };
      if (isOpen(t)) s.open++;
      else if (t.status === 'resolved') {
        s.resolved++;
        if (slaOf(t).overall === 'met') s.met++;
      }
      map.set(key, s);
    };
    for (const t of tickets) {
      add(t.clientId, t);
      add(t.assetId, t);
    }
    return map;
  }, [tickets, slaOf]);
}

function LiveStatus({ status, label }: { status: AssetStatus; label?: string }) {
  return (
    <span className={cx('live-status', `is-${status}`)}>
      <span className="live-dot" aria-hidden />
      {label ?? LIVE_LABEL[status]}
    </span>
  );
}

/** "All live", or how many products share the worst state. */
function healthOf(list: Asset[]): { status: AssetStatus; label: string } {
  if (!list.length) return { status: 'unknown', label: 'No assets yet' };
  const worst = LIVE_RANK.find((st) => list.some((a) => a.status === st)) ?? 'unknown';
  if (worst === 'operational') return { status: worst, label: 'All live' };
  const n = list.filter((a) => a.status === worst).length;
  // No signal on every asset usually means none has been checked yet.
  if (worst === 'unknown' && n === list.length) return { status: worst, label: 'Waiting for the first check' };
  return { status: worst, label: `${n} of ${list.length} ${LIVE_LABEL[worst].toLowerCase()}` };
}

/** A client's products: status, uptime and open tickets. With `linked`, a row opens the client's assets tab. */
function ProductTable({ list, stats, linked = false }: { list: Asset[]; stats: Map<string, RowStats>; linked?: boolean }) {
  const navigate = useNavigate();
  if (!list.length) return null;
  return (
    <div className="table-wrap table-frame">
      <table className="table ticket-table product-table" style={{ minWidth: 780 }}>
        <thead>
          <tr>
            {PRODUCT_COLS.map((col) => {
              const Icon = col.icon;
              return (
                <th key={col.key} className={`col-${col.key}`} style={{ width: col.width }}>
                  <span className="th-label">
                    <Icon size={15} aria-hidden className="th-icon" />
                    {col.label}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {list.map((a) => {
            const Icon = ASSET_ICON[a.category];
            const open = stats.get(a.id)?.open ?? 0;
            return (
              <tr key={a.id} className={cx(linked && 'row-link')} onClick={linked ? () => navigate(`/clients/${a.clientId}?tab=assets`) : undefined}>
                <td className="col-product">
                  <span className="product-cell">
                    <span className="product-icon" aria-hidden>
                      <Icon size={16} />
                    </span>
                    <span className="product-text">
                      <span className="product-name">{a.name}</span>
                      <span className="product-url">{a.url.replace(/^https?:\/\//, '')}</span>
                    </span>
                  </span>
                </td>
                <td className="col-status" title={a.statusNote || undefined}>
                  <LiveStatus status={a.status} />
                </td>
                <td className="col-uptime">{a.uptime30d != null ? `${a.uptime30d}%` : <span className="muted">No data</span>}</td>
                <td className={cx('col-open', open === 0 && 'muted')}>{open}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Client list ---------- */

export function Clients() {
  const { clients, assets, setDialog, can } = useStore();
  const stats = useRowStats();
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const addClient = () => setDialog({ type: 'add-client' });

  return (
    <div className="page">
      <PageHeader
        title="Clients"
        description="The organizations NXS supports and how their assets are doing right now."
        actions={
          can('clients.manage') && (
            <Button variant="primary" icon={<Plus size={17} />} onClick={addClient}>
              Add client
            </Button>
          )
        }
      />

      {clients.length === 0 && (
        <Card>
          <Empty title="No clients yet" action={can('clients.manage') && <Button variant="primary" icon={<Plus size={17} />} onClick={addClient}>Add client</Button>}>
            Add the first organization NXS supports, then its users and assets.
          </Empty>
        </Card>
      )}

      {/* One white card per client, straight on the background: the client
          on top, its products as rows beneath. Folds away when not needed. */}
      <div className="client-groups">
        {clients.map((c) => {
          const list = assets.filter((a) => a.clientId === c.id);
          const s = stats.get(c.id) ?? NO_STATS;
          const h = healthOf(list);
          const isFolded = !!folded[c.id];
          const bodyId = `client-group-${c.id}`;
          return (
            <section key={c.id} className="client-group" aria-labelledby={`${bodyId}-name`}>
              <header className="client-group-head">
                <button
                  type="button"
                  className="client-fold"
                  aria-expanded={!isFolded}
                  aria-controls={bodyId}
                  aria-label={`${isFolded ? 'Show' : 'Hide'} ${c.name} assets`}
                  onClick={() => setFolded((f) => ({ ...f, [c.id]: !isFolded }))}
                >
                  <ChevronDown size={16} aria-hidden />
                </button>
                <Link to={`/clients/${c.id}`} className="client-group-id">
                  <ClientLogo client={c} size={36} />
                  <span className="client-group-name">
                    <span id={`${bodyId}-name`}>{c.name}</span>
                    <span className="client-group-sub">{c.industry}</span>
                  </span>
                </Link>
                <ul className="client-chips" aria-label={`${c.name} summary`}>
                  <li className={cx('client-chip', `is-${h.status}`)}>
                    <span className="live-dot" aria-hidden />
                    {h.label}
                  </li>
                  <li className="client-chip">
                    <strong>{s.open}</strong> open tickets
                  </li>
                  <li className="client-chip">
                    <strong>{s.resolved ? `${pct(s.met, s.resolved)}%` : '–'}</strong> within SLA
                  </li>
                </ul>
              </header>

              {!isFolded && (
                <div id={bodyId} className="client-group-body">
                  {list.length ? (
                    <ProductTable list={list} stats={stats} linked />
                  ) : (
                    <Link to={`/clients/${c.id}?tab=assets`} className="add-row client-group-add">
                      <Plus size={16} aria-hidden /> Add their first asset
                    </Link>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Client detail ----------
   Ticket management, not client management: the numbers, the products,
   the tickets, and the people who raise them. Nothing else. */

type ClientTab = 'users' | 'assets' | 'tickets';

const USER_COLS: { key: string; label: string; icon: LucideIcon; width?: number }[] = [
  { key: 'name', label: 'Name', icon: User },
  { key: 'title', label: 'Job title', icon: Briefcase, width: 230 },
  { key: 'raised', label: 'Tickets raised', icon: TicketIcon, width: 150 },
  { key: 'last', label: 'Last ticket', icon: Clock, width: 150 },
];

/** Starts fresh for each client, and for each tab a link asks for. */
export function ClientDetail() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const asked = params.get('tab');
  const tab: ClientTab = asked === 'assets' || asked === 'tickets' ? asked : 'users';
  return <ClientDetailView key={`${id}:${tab}`} id={id} initialTab={tab} />;
}

/** A tab with nothing in it yet: what belongs here, and the button to add it. */
function TabEmpty({ icon: Icon, title, children, actions }: { icon: LucideIcon; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="panel-empty client-empty">
      <span className="panel-empty-icon" aria-hidden>
        <Icon size={20} />
      </span>
      <p className="panel-empty-title">{title}</p>
      <p className="panel-empty-text">{children}</p>
      {actions && <div className="panel-empty-actions">{actions}</div>}
    </div>
  );
}

function ClientDetailView({ id, initialTab }: { id: string; initialTab: ClientTab }) {
  const { clientOf, assets, tickets, setDialog, can, now } = useStore();
  const navigate = useNavigate();
  const stats = useRowStats();
  const [tab, setTab] = useState<ClientTab>(initialTab);
  const [paging, setPaging] = useState({ page: 1, size: PAGE_SIZES[0] });
  const client = clientOf(id);

  const history = useMemo(() => {
    const list = tickets.filter((t) => t.clientId === id).sort((a, b) => b.createdAt - a.createdAt);
    return { open: list.filter(isOpen), all: list };
  }, [tickets, id]);

  // Tickets each client user has raised, and when they last raised one.
  const raised = useMemo(() => {
    const map = new Map<string, { count: number; last: number }>();
    for (const t of history.all) {
      const r = map.get(t.reporterId) ?? { count: 0, last: 0 };
      r.count++;
      r.last = Math.max(r.last, t.createdAt);
      map.set(t.reporterId, r);
    }
    return map;
  }, [history]);

  if (!client) {
    return (
      <div className="page">
        <Card>
          <Empty title="Client not found" action={<Link to="/clients" className="btn btn-secondary">Back to clients</Link>} />
        </Card>
      </div>
    );
  }

  const s = stats.get(client.id) ?? NO_STATS;
  const clientAssets = assets.filter((a) => a.clientId === client.id);
  const h = healthOf(clientAssets);
  const critical = history.open.filter((t) => t.severity === 'critical').length;
  // Every ticket the client has raised, newest first, a page at a time.
  const { size } = paging;
  const page = Math.min(paging.page, Math.max(1, Math.ceil(history.all.length / size)));
  const setPage = (p: number) => setPaging({ page: p, size });
  const shown = history.all.slice((page - 1) * size, page * size);

  const kpis: { key: string; icon: LucideIcon; label: string; value: string; note: ReactNode }[] = [
    { key: 'open', icon: TicketIcon, label: 'Open tickets', value: String(s.open), note: critical ? <span className="is-bad">{critical} critical</span> : 'None critical' },
    { key: 'resolved', icon: CircleCheck, label: 'Resolved', value: String(s.resolved), note: 'All time' },
    { key: 'sla', icon: Timer, label: 'Resolved within SLA', value: s.resolved ? `${pct(s.met, s.resolved)}%` : '–', note: s.resolved ? `${s.met} of ${s.resolved} tickets` : 'Nothing resolved yet' },
    { key: 'assets', icon: Boxes, label: 'Assets', value: String(clientAssets.length), note: <LiveStatus status={h.status} label={h.label} /> },
  ];
  // A ticket needs someone to raise it and an asset to tie it to.
  const hasUsers = client.users.length > 0;
  const hasAssets = clientAssets.length > 0;
  const ready = hasUsers && hasAssets;
  const addUser = () => setDialog({ type: 'add-user', clientId: client.id });
  const addAsset = () => setDialog({ type: 'add-asset', clientId: client.id });
  const logTicket = () => navigate(`/tickets/new?client=${client.id}`);
  const tabs: { key: ClientTab; label: string; icon: LucideIcon; count: number }[] = [
    { key: 'users', label: 'Client users', icon: Users, count: client.users.length },
    { key: 'assets', label: 'Assets', icon: Boxes, count: clientAssets.length },
    { key: 'tickets', label: 'Tickets', icon: TicketIcon, count: history.all.length },
  ];

  return (
    <div className="page">
      <BackHeader
        title="Client detail"
        description="Their numbers, the people who raise tickets, their assets and their tickets."
        fallback="/clients"
        backLabel="Back to clients"
        actions={
          // Shown once the client has someone to raise a ticket and an asset to tie it to.
          ready && (
            <Button variant="primary" icon={<Plus size={17} />} onClick={logTicket}>
              Log ticket for client
            </Button>
          )
        }
      />

      {/* One container: who the client is and four numbers on top, then
          one tab at a time for their users, tickets and assets. */}
      <Card className="client-detail-card">
        <header className="client-id">
          <ClientLogo client={client} size={52} />
          <div className="client-head-main">
            <h2 className="client-id-name">{client.name}</h2>
            <p className="client-head-sub">
              {client.industry}
            </p>
          </div>
        </header>

        <ul className="client-kpis" aria-label="Key numbers">
          {kpis.map((k) => {
            const Icon = k.icon;
            return (
              <li key={k.key} className="client-kpi">
                <span className="client-kpi-head">
                  <Icon size={16} aria-hidden />
                  {k.label}
                </span>
                <span className="client-kpi-value">{k.value}</span>
                <span className="client-kpi-note">{k.note}</span>
              </li>
            );
          })}
        </ul>

        <div className="doc-tabs client-tabs" role="tablist" aria-label="Client">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`client-tab-${t.key}`}
                aria-selected={tab === t.key}
                aria-controls="client-panel"
                className={cx('doc-tab', tab === t.key && 'is-active')}
                onClick={() => setTab(t.key)}
              >
                <Icon size={16} aria-hidden />
                {t.label}
                <span className="doc-tab-count">{t.count}</span>
              </button>
            );
          })}
        </div>

        <div id="client-panel" role="tabpanel" aria-labelledby={`client-tab-${tab}`} className="client-panel">
          {tab === 'users' && !hasUsers && (
            <TabEmpty
              icon={Users}
              title="No client users yet"
              actions={
                can('clients.manage') && (
                  <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={addUser}>
                    Add client user
                  </Button>
                )
              }
            >
              Add the people at {client.name} who report issues. Every ticket is raised by one of them.
            </TabEmpty>
          )}
          {tab === 'users' && hasUsers && (
            <div className="table-wrap table-frame">
              <table className="table ticket-table client-user-table" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    {USER_COLS.map((col) => {
                      const Icon = col.icon;
                      return (
                        <th key={col.key} style={{ width: col.width }}>
                          <span className="th-label">
                            <Icon size={15} aria-hidden className="th-icon" />
                            {col.label}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {client.users.map((u) => {
                    const r = raised.get(u.id);
                    return (
                      <tr key={u.id}>
                        <td>
                          <span className="person">
                            <Avatar name={u.name} size={28} />
                            <span className="truncate client-user-name">{u.name}</span>
                          </span>
                        </td>
                        <td className="truncate muted-strong">{u.title}</td>
                        <td className={cx('col-open', !r && 'muted')}>{r?.count ?? 0}</td>
                        <td className="muted-strong">{r ? fmtRelative(r.last, now) : <span className="muted">None yet</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {tab === 'users' && hasUsers && can('clients.manage') && (
            <button type="button" className="add-row" onClick={addUser}>
              <Plus size={16} aria-hidden /> Add client user
            </button>
          )}

          {tab === 'assets' && !hasAssets && (
            <TabEmpty
              icon={Boxes}
              title="No assets yet"
              actions={
                can('assets.manage') && (
                  <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={addAsset}>
                    Add asset
                  </Button>
                )
              }
            >
              Add the websites, dashboards or apps NXS looks after for {client.name}. Each one gets a live status check.
            </TabEmpty>
          )}
          {tab === 'assets' && hasAssets && (
            <>
              <ProductTable list={clientAssets} stats={stats} />
              {can('assets.manage') && (
                <button type="button" className="add-row" onClick={addAsset}>
                  <Plus size={16} aria-hidden /> Add asset
                </button>
              )}
              <UptimeCard assets={clientAssets} />
            </>
          )}

          {tab === 'tickets' && history.all.length === 0 && !ready && (
            <TabEmpty
              icon={TicketIcon}
              title={!hasUsers && !hasAssets ? 'Add a client user and an asset first' : !hasUsers ? 'Add a client user first' : 'Add an asset first'}
              actions={
                <>
                  {!hasUsers && can('clients.manage') && (
                    <Button size="sm" icon={<Plus size={16} />} onClick={addUser}>
                      Add client user
                    </Button>
                  )}
                  {!hasAssets && can('assets.manage') && (
                    <Button size="sm" icon={<Plus size={16} />} onClick={addAsset}>
                      Add asset
                    </Button>
                  )}
                </>
              }
            >
              Every ticket is raised by someone at {client.name} and tied to one of their assets. Once both are here, you can log the first ticket.
            </TabEmpty>
          )}
          {tab === 'tickets' && history.all.length === 0 && ready && (
            <TabEmpty
              icon={TicketIcon}
              title="No tickets yet"
              actions={
                can('ticket.create') && (
                  <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={logTicket}>
                    Log ticket
                  </Button>
                )
              }
            >
              {client.name} raises tickets in the Client Portal. If they report an issue another way, log it here so it is tracked against their SLA.
            </TabEmpty>
          )}
          {tab === 'tickets' && history.all.length > 0 && (
            <>
              <TicketTable tickets={shown} hide={['client', 'category']} />
              {history.all.length > PAGE_SIZES[0] && (
                <Pager label={`${client.name} tickets`} total={history.all.length} page={page} size={size} onPage={setPage} onSize={(n) => setPaging({ page: 1, size: n })} />
              )}
            </>
          )}

        </div>
      </Card>
    </div>
  );
}

/** Old asset addresses: the asset lives on its client's page now. */
export function AssetRedirect() {
  const { id = '' } = useParams();
  const { assetOf } = useStore();
  const asset = assetOf(id);
  return <Navigate to={asset ? `/clients/${asset.clientId}?tab=assets` : '/clients'} replace />;
}
