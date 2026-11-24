import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Globe, GraduationCap, Inbox, Layers, Plus, Search, type LucideIcon } from 'lucide-react';
import type { AssetCategory, Ticket, TicketStatus } from '../types';
import { PORTAL_STATUS_LABEL, portalStatus } from '../lib/domain';
import { useStore } from '../store';
import { Badge, cx, type Tone } from '../components/ui';
import { Dropdown } from '../components/pickers';
import { STATUS_TONE } from '../components/domain';
import { usePortalUser } from './shared';

/*
 * The client's home, in the dashboard's own design language: one card per
 * ticket, like an order. The top says which asset and where it stands; the
 * body says what it is and who reported it; the button opens it (or, for a fix
 * that's ready, takes them to review and deploy it). A just-submitted ticket
 * shows no asset yet: until NXS confirms it, that is only the AI's guess.
 */

type Tab = 'new' | 'ongoing' | 'done';
type Who = 'all' | 'mine';
const WHO_KEY = 'nxshield.portal.who';
function readWho(): Who {
  try {
    return sessionStorage.getItem(WHO_KEY) === 'mine' ? 'mine' : 'all';
  } catch {
    return 'all';
  }
}
const ORDER: TicketStatus[] = ['ready_to_deploy', 'in_progress', 'new'];
const PRODUCT_ICON: Record<AssetCategory, { icon: LucideIcon; tone: Tone }> = {
  consumer_website: { icon: Globe, tone: 'blue' },
  marketing_dashboard: { icon: BarChart3, tone: 'teal' },
  omnichannel_dashboard: { icon: Layers, tone: 'indigo' },
  lms_app: { icon: GraduationCap, tone: 'orange' },
};
const DONE_PAGE = 24;

function greeting(now: number) {
  const h = new Date(now).getHours();
  return h < 11 ? 'Good morning' : h < 15 ? 'Good afternoon' : 'Good evening';
}

function TicketCard({ t, meId }: { t: Ticket; meId: string }) {
  const { assetOf, reporterOf } = useStore();
  const stage = portalStatus(t.status);
  const asset = assetOf(t.assetId);
  const reporter = reporterOf(t);
  const fresh = stage === 'new';
  const product = fresh || !asset ? { icon: Inbox, tone: 'neutral' as Tone } : PRODUCT_ICON[asset.category];
  const Icon = product.icon;
  const ready = stage === 'ready_to_deploy';
  return (
    <li className="pk-card">
      <div className="pk-card-head">
        <span className={cx('pk-icon', `tone-${product.tone}`)} aria-hidden>
          <Icon size={17} />
        </span>
        <div className="pk-card-who">
          {/* Until NXS confirms it, the asset is only the AI's guess. */}
          <p className="pk-card-product">{fresh ? 'New report' : (asset?.name ?? '—')}</p>
          <p className="pk-card-meta">
            <span className="ticket-id">{t.id}</span>
          </p>
        </div>
        <Badge tone={STATUS_TONE[stage]} dot>
          {PORTAL_STATUS_LABEL[stage]}
        </Badge>
      </div>
      <div className="pk-card-body">
        <div className="pk-card-text">
          <p className="pk-card-title">{t.title}</p>
          <p className="pk-card-next">Reported by {reporter?.id === meId ? 'you' : (reporter?.name ?? 'your team')}</p>
        </div>
        <Link to={`/portal/tickets/${t.id}`} className={cx('btn btn-sm', ready ? 'btn-primary' : 'btn-secondary')}>
          {ready ? 'Review and deploy' : 'View'}
        </Link>
      </div>
    </li>
  );
}

export function PortalHome() {
  const { user, client, tickets } = usePortalUser();
  const { assetOf, reporterOf, slaOf, now } = useStore();
  const [who, setWhoState] = useState<Who>(readWho);
  const setWho = (v: Who) => {
    setWhoState(v);
    try {
      sessionStorage.setItem(WHO_KEY, v);
    } catch {
      /* not remembered, that's fine */
    }
  };
  const [tab, setTab] = useState<Tab>('ongoing');
  const [query, setQuery] = useState('');
  const [doneShown, setDoneShown] = useState(DONE_PAGE);

  const { fresh, ongoing, done } = useMemo(() => {
    const rank = (t: Ticket) => ORDER.indexOf(portalStatus(t.status));
    // What needs the client first, then what we're fixing (soonest first), then what just came in.
    const ongoing = tickets
      .filter((t) => ORDER.includes(portalStatus(t.status)))
      .sort((a, b) => rank(a) - rank(b) || slaOf(a).active.due - slaOf(b).active.due);
    const done = tickets.filter((t) => t.status === 'resolved' || t.status === 'canceled').sort((a, b) => (b.resolvedAt ?? b.canceledAt ?? b.updatedAt) - (a.resolvedAt ?? a.canceledAt ?? a.updatedAt));
    // Just submitted, still with NXS for its reply and analysis: newest first.
    const fresh = ongoing.filter((t) => t.status === 'new').sort((a, b) => b.createdAt - a.createdAt);
    return { fresh, ongoing: ongoing.filter((t) => t.status !== 'new'), done };
  }, [tickets, slaOf]);
  if (!user || !client) return null;

  const ready = ongoing.filter((t) => t.status === 'ready_to_deploy').length;
  const term = query.trim().toLowerCase();
  const matches = (t: Ticket) => !term || t.id.toLowerCase().includes(term) || t.title.toLowerCase().includes(term) || (assetOf(t.assetId)?.name.toLowerCase().includes(term) ?? false);
  const mineOnly = (t: Ticket) => who === 'all' || reporterOf(t)?.id === user.id;
  const newList = fresh.filter(mineOnly);
  const ongoingList = ongoing.filter(mineOnly);
  const doneList = done.filter(mineOnly);
  const list = (tab === 'new' ? newList : tab === 'ongoing' ? ongoingList : doneList).filter(matches);
  const shown = tab === 'done' ? list.slice(0, doneShown) : list;

  return (
    <div className="page pk-home">
      <header className="pk-head">
        <div>
          <h1 className="page-title">
            {greeting(now)}, {user.name.split(' ')[0]}
          </h1>
          <p className="page-desc">
            {client.name} has {fresh.length + ongoing.length} open {fresh.length + ongoing.length === 1 ? 'ticket' : 'tickets'} with NXS.
            {ready > 0 && ` ${ready} ${ready === 1 ? 'fix is' : 'fixes are'} ready for you to deploy.`}
          </p>
        </div>
        <Link to="/portal/tickets/new" className="btn btn-primary">
          <Plus size={16} aria-hidden />
          Report a problem
        </Link>
      </header>

      <div className="pk-bar">
        <div className="view-tabs" role="tablist" aria-label="Which tickets">
          {(
            [
              ['new', 'New', newList.length],
              ['ongoing', 'Ongoing', ongoingList.length],
              ['done', 'Done', doneList.length],
            ] as const
          ).map(([key, label, n]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={cx('view-tab', tab === key && 'is-active')} onClick={() => setTab(key)}>
              {label} <span className="view-tab-count">{n}</span>
            </button>
          ))}
        </div>
        <div className="pk-tools">
          <div className="pk-who">
            <Dropdown<Who>
              value={who}
              onChange={setWho}
              placeholder="All tickets"
              options={[
                { value: 'all', label: `All ${client.name} tickets` },
                { value: 'mine', label: 'Reported by you' },
              ]}
            />
          </div>
          <label className="filter-search pk-search">
            <Search size={16} aria-hidden />
            <input type="search" placeholder="Search ID, title, asset" aria-label="Search tickets" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="pt-empty">{term
            ? `No tickets match “${query.trim()}”.`
            : tab === 'new'
              ? who === 'mine'
                ? 'Nothing you reported is waiting for our reply. If something isn’t working, report a problem.'
                : 'No new reports waiting for our reply. If something isn’t working, report a problem.'
              : tab === 'ongoing'
              ? who === 'mine'
                ? 'Nothing you reported is ongoing. If something isn’t working, report a problem.'
                : 'Nothing ongoing. If something isn’t working, report a problem.'
              : who === 'mine'
                ? 'Nothing you reported has finished yet.'
                : 'No finished tickets yet.'}</div>
      ) : (
        <ul className="pk-grid">
          {shown.map((t) => (
            <TicketCard key={t.id} t={t} meId={user.id} />
          ))}
        </ul>
      )}
      {tab === 'done' && list.length > doneShown && (
        <button type="button" className="btn btn-secondary pk-more" onClick={() => setDoneShown((n) => n + DONE_PAGE)}>
          Show more
        </button>
      )}
    </div>
  );
}
