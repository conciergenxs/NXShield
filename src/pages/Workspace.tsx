import { useMemo, useState } from 'react';
import { Activity, Boxes, Briefcase, ChevronDown, CircleDot, Globe, Mail, Plus, Search, ShieldCheck, Ticket as TicketIcon, User, Users, type LucideIcon } from 'lucide-react';
import type { Asset, AssetStatus, Client } from '../types';
import { ASSET_CATEGORY_LABEL, ROLE_LABEL, isOpen } from '../lib/domain';
import { useStore } from '../store';
import { Assignee, ClientLogo } from '../components/domain';
import { Button, Empty, cx } from '../components/ui';

/* The clients NXS serves, set up in one place: each client, the assets NXS
   looks after for them, and the people who can use the Client Portal. Built
   for many clients: a search, and each client folds to one line. How the
   assets are doing day to day is on the Overview. */

const LIVE_LABEL: Record<AssetStatus, string> = { operational: 'Live', degraded: 'Degraded', outage: 'Down', maintenance: 'Maintenance', unknown: 'No signal' };
const WORST: AssetStatus[] = ['outage', 'degraded', 'maintenance', 'unknown', 'operational'];

function Th({ icon: Icon, children, width }: { icon: LucideIcon; children: string; width?: number }) {
  return (
    <th style={{ width }}>
      <span className="th-label">
        <Icon size={15} aria-hidden className="th-icon" />
        {children}
      </span>
    </th>
  );
}

export function Workspace() {
  const { clients, setDialog, can } = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const term = q.trim().toLowerCase();
  const list = clients.filter((c) => !term || c.name.toLowerCase().includes(term) || c.industry.toLowerCase().includes(term));

  return (
    <div className="workspace">
      <div className="workspace-bar">
        <label className="filter-search">
          <Search size={16} aria-hidden />
          <span className="sr-only">Search clients</span>
          <input type="search" placeholder="Search clients" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {can('clients.manage') && (
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setDialog({ type: 'add-client' })}>
            Add client
          </Button>
        )}
      </div>
      <p className="workspace-lead">
        {clients.length} {clients.length === 1 ? 'client' : 'clients'}. Open one to manage its assets and the people who can use the Client Portal.
      </p>
      {list.length === 0 ? (
        <Empty title={clients.length ? 'No clients match' : 'No clients yet'}>{clients.length ? 'Try another name.' : 'Add the first client NXS supports.'}</Empty>
      ) : (
        <div className="ticket-groups">
          {list.map((c) => (
            <ClientBlock key={c.id} client={c} open={!!open[c.id]} onToggle={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))} />
          ))}
        </div>
      )}
    </div>
  );
}

function ClientBlock({ client, open, onToggle }: { client: Client; open: boolean; onToggle: () => void }) {
  const { assets, tickets, team, setDialog, can } = useStore();
  const own = useMemo(() => assets.filter((a) => a.clientId === client.id), [assets, client.id]);
  const openTickets = tickets.filter((t) => t.clientId === client.id && isOpen(t)).length;
  const worst = WORST.find((s) => own.some((a) => a.status === s));
  const id = `ws-${client.id}`;
  return (
    <section className="ticket-group workspace-client" aria-labelledby={`${id}-name`}>
      <h3 className="ticket-group-head">
        <button type="button" className="ticket-group-toggle" aria-expanded={open} aria-controls={id} onClick={onToggle}>
          <ChevronDown size={16} aria-hidden className="ticket-group-chevron" />
          <ClientLogo client={client} size={26} />
          <span id={`${id}-name`}>{client.name}</span>
          <span className="ticket-group-hint">{client.industry}</span>
          <span className="workspace-facts">
            {worst && worst !== 'operational' && (
              <span className={cx('live-status', `is-${worst}`)}>
                <span className="live-dot" aria-hidden />
                {own.filter((a) => a.status === worst).length} {LIVE_LABEL[worst].toLowerCase()}
              </span>
            )}
            <span>
              <Boxes size={14} aria-hidden /> {own.length} {own.length === 1 ? 'asset' : 'assets'}
            </span>
            <span>
              <Users size={14} aria-hidden /> {client.users.length} {client.users.length === 1 ? 'user' : 'users'}
            </span>
            <span>
              <TicketIcon size={14} aria-hidden /> {openTickets} open
            </span>
          </span>
        </button>
      </h3>
      {open && (
        <div id={id} className="workspace-body">
          <div className="workspace-sub">
            <h4>Assets</h4>
            {can('assets.manage') && (
              <Button size="sm" icon={<Plus size={15} />} onClick={() => setDialog({ type: 'add-asset', clientId: client.id })}>
                Add asset
              </Button>
            )}
          </div>
          {own.length === 0 ? (
            <p className="workspace-empty">No assets yet. Add the websites, dashboards or apps NXS looks after for {client.name}.</p>
          ) : (
            <div className="ticket-group-body">
              <div className="table-wrap">
                <table className="table ticket-table" style={{ minWidth: 820 }}>
                  <thead>
                    <tr>
                      <Th icon={Boxes}>Asset</Th>
                      <Th icon={Briefcase} width={190}>
                        Kind
                      </Th>
                      <Th icon={Globe} width={260}>
                        Address
                      </Th>
                      <Th icon={User} width={200}>
                        Looked after by
                      </Th>
                      <Th icon={CircleDot} width={140}>
                        Status
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {own.map((a: Asset) => (
                      <tr key={a.id}>
                        <td className="strong">{a.name}</td>
                        <td>{ASSET_CATEGORY_LABEL[a.category]}</td>
                        <td>
                          <a href={a.url} target="_blank" rel="noreferrer" className="link-quiet truncate">
                            {a.url.replace(/^https?:\/\//, '')}
                          </a>
                        </td>
                        <td>
                          <Assignee member={team.find((m) => m.id === a.ownerId)} />
                        </td>
                        <td>
                          <span className={cx('live-status', `is-${a.status}`)}>
                            <span className="live-dot" aria-hidden />
                            {LIVE_LABEL[a.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="workspace-sub">
            <h4>Portal users</h4>
            {can('clients.manage') && (
              <Button size="sm" icon={<Plus size={15} />} onClick={() => setDialog({ type: 'add-user', clientId: client.id })}>
                Add user
              </Button>
            )}
          </div>
          {client.users.length === 0 ? (
            <p className="workspace-empty">No one at {client.name} can sign in yet. Add the people who raise tickets.</p>
          ) : (
            <div className="ticket-group-body">
              <div className="table-wrap">
                <table className="table ticket-table" style={{ minWidth: 820 }}>
                  <thead>
                    <tr>
                      <Th icon={User}>Name</Th>
                      <Th icon={Briefcase} width={240}>
                        Job title
                      </Th>
                      <Th icon={Mail} width={280}>
                        Email
                      </Th>
                      <Th icon={ShieldCheck} width={140}>
                        Role
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {client.users.map((u) => (
                      <tr key={u.id}>
                        <td className="strong">{u.name}</td>
                        <td>{u.title}</td>
                        <td>{u.email}</td>
                        <td>{ROLE_LABEL[u.role]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="workspace-note">
            <Activity size={14} aria-hidden /> Uptime and incidents for these assets are on the Overview.
          </p>
        </div>
      )}
    </section>
  );
}
