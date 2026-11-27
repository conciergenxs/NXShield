import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Ban, BarChart3, CircleCheck, Globe, GraduationCap, Inbox, Layers, Plus, Search, type LucideIcon } from 'lucide-react';
import type { AssetCategory, Ticket, TicketStatus } from '../types';
import { PORTAL_STATUS_LABEL, portalStatus } from '../lib/domain';
import { fmtDate, fmtRelative, fmtTime } from '../lib/format';
import { fullRcaPlan } from '../lib/release';
import { useStore } from '../store';
import { Avatar, Badge, cx, type Tone } from '../components/ui';
import { Dropdown } from '../components/pickers';
import { STATUS_ICON, STATUS_TONE } from '../components/domain';
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
/** What an empty column says. */
const EMPTY_COL: Partial<Record<TicketStatus, string>> = {
  in_progress: 'Nothing being fixed right now.',
  ready_to_deploy: 'No fixes waiting for your approval.',
  resolved: 'Nothing deployed yet.',
  canceled: 'Nothing canceled.',
};

function greeting(now: number) {
  const h = new Date(now).getHours();
  return h < 11 ? 'Good morning' : h < 15 ? 'Good afternoon' : 'Good evening';
}

/** How much of the time NXS set is spent, as a ring: it fills as the date nears. Same as the Overview's. */
function Ring({ used, late }: { used: number; late?: boolean }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const share = Math.min(1, Math.max(0.04, used));
  return (
    <svg className={cx('ovt-ring', late ? 'is-late' : used > 0.85 && 'is-soon')} width="24" height="24" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r={r} className="ovt-ring-track" />
      <circle cx="12" cy="12" r={r} className="ovt-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - share)} transform="rotate(-90 12 12)" />
    </svg>
  );
}

/**
 * A ticket as the client sees it: which product and its stage on top, the
 * title, then who reported it and what comes next. What comes next is the date
 * NXS is working to (with a ring for how close it is), the approval when a fix
 * waits on them, or when it went live. The whole card opens the ticket.
 */
function TicketCard({ t, meId, inColumn }: { t: Ticket; meId: string; inColumn?: boolean }) {
  const { assetOf, reporterOf, slaOf, now } = useStore();
  const stage = portalStatus(t.status);
  const asset = assetOf(t.assetId);
  const reporter = reporterOf(t);
  const fresh = stage === 'new';
  const product = fresh || !asset ? { icon: Inbox, tone: 'neutral' as Tone } : PRODUCT_ICON[asset.category];
  const Icon = product.icon;
  const ready = stage === 'ready_to_deploy';
  const StageIcon = STATUS_ICON[stage];
  const closed = t.resolvedAt ?? t.canceledAt;
  const sla = slaOf(t);
  // What they wait for: the Initial RCA Report while it's new, the fix while it's being worked on.
  const clock = fresh ? sla.initialRca : sla.resolution;
  const by = (ts: number) => (new Date(ts).toDateString() === new Date(now).toDateString() ? `today, ${fmtTime(ts)}` : fmtDate(ts));
  const href = `/portal/tickets/${t.id}`;
  return (
    <li className={cx('pk-card', `tone-${STATUS_TONE[stage]}`, ready && 'is-ready')}>
      {/* One line of context, small; the title is the only thing that's big. */}
      <div className="pk-card-top">
        <span className={cx('pk-icon', `tone-${product.tone}`)} aria-hidden>
          <Icon size={15} />
        </span>
        {/* Until NXS confirms it, the asset is only the AI's guess. */}
        <span className="pk-card-where truncate">{fresh ? 'New report' : (asset?.name ?? '—')}</span>
        <span className="ticket-id">{t.id}</span>
        {/* In a column the column already says where it stands. */}
        {!inColumn && (
          <Badge tone={STATUS_TONE[stage]} icon={<StageIcon size={13} aria-hidden />}>
            {PORTAL_STATUS_LABEL[stage]}
          </Badge>
        )}
      </div>
      {/* The title is the card's link; it stretches over the whole card. */}
      <Link to={href} className="pk-card-title">
        {t.title}
      </Link>
      <div className="pk-card-foot">
        <span className="pk-card-by">
          <Avatar name={reporter?.name ?? 'Your team'} size={24} />
          <span className="pk-card-by-text">
            <span className="pk-card-by-name">{reporter?.id === meId ? 'You' : (reporter?.name.split(' ')[0] ?? 'Your team')}</span>
            <span className="pk-card-by-when">Reported {fmtRelative(t.createdAt, now).replace(/^J/, 'j')}</span>
          </span>
        </span>
        {ready ? (
          <Link to={href} className="btn btn-primary btn-sm pk-card-approve">
            Review and approve
            <ArrowRight size={15} aria-hidden />
          </Link>
        ) : closed != null ? (
          <span className={cx('pk-card-closed', t.status === 'canceled' && 'is-canceled')}>
            {t.status === 'canceled' ? <Ban size={15} aria-hidden /> : <CircleCheck size={15} aria-hidden />}
            {t.status === 'canceled' ? 'Canceled' : 'Deployed'} {fmtRelative(closed, now).replace(/^J/, 'j')}
          </span>
        ) : (
          <span className="ovt-card-due pk-card-due">
            <Ring used={clock.used} late={clock.state === 'breached'} />
            <span className="ovt-card-due-text">
              <strong>{fresh ? 'Initial RCA Report' : 'Fix'} by</strong>
              <small>{by(clock.due)}</small>
            </span>
          </span>
        )}
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
    // Latest news first: when it was resolved or canceled, or when its full RCA report arrived, if that came later.
    const lastNews = (t: Ticket) => {
      const closed = t.resolvedAt ?? t.canceledAt ?? t.updatedAt;
      const rca = t.status === 'resolved' ? fullRcaPlan(t).due : null;
      return rca != null && rca <= now ? Math.max(closed, rca) : closed;
    };
    const done = tickets.filter((t) => t.status === 'resolved' || t.status === 'canceled').sort((a, b) => lastNews(b) - lastNews(a));
    // Just submitted, still with NXS for its reply and analysis: newest first.
    const fresh = ongoing.filter((t) => t.status === 'new').sort((a, b) => b.createdAt - a.createdAt);
    return { fresh, ongoing: ongoing.filter((t) => t.status !== 'new'), done };
  }, [tickets, slaOf, now]);
  if (!user || !client) return null;

  const term = query.trim().toLowerCase();
  const matches = (t: Ticket) => !term || t.id.toLowerCase().includes(term) || t.title.toLowerCase().includes(term) || (assetOf(t.assetId)?.name.toLowerCase().includes(term) ?? false);
  const mineOnly = (t: Ticket) => who === 'all' || reporterOf(t)?.id === user.id;
  // The tab counts follow the search and the "who" choice, like the list under them.
  const newList = fresh.filter(mineOnly).filter(matches);
  const ongoingList = ongoing.filter(mineOnly).filter(matches);
  const doneList = done.filter(mineOnly).filter(matches);
  const list = tab === 'new' ? newList : tab === 'ongoing' ? ongoingList : doneList;
  const shown = list;

  return (
    <div className="page pk-home">
      <header className="pk-head">
        <div>
          <h1 className="page-title">
            {greeting(now)}, {user.name.split(' ')[0]}
          </h1>
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

      {tab !== 'new' && list.length > 0 ? (
        // Ongoing and Done as two columns each: what NXS is fixing and what's ready to deploy; what went live and what was canceled.
        <div className="pk-kanban">
          {(tab === 'ongoing' ? (['in_progress', 'ready_to_deploy'] as const) : (['resolved', 'canceled'] as const)).map((stage) => {
            const all = list.filter((t) => portalStatus(t.status) === stage);
            const col = tab === 'done' ? all.slice(0, doneShown) : all;
            const Icon = STATUS_ICON[stage];
            return (
              <section key={stage} className={cx('board-col pk-col', `tone-${STATUS_TONE[stage]}`, stage === 'ready_to_deploy' && 'is-ready')} aria-label={`${PORTAL_STATUS_LABEL[stage]}, ${all.length} ${all.length === 1 ? 'ticket' : 'tickets'}`}>
                <header className="board-col-head">
                  <h2>
                    <Icon size={17} aria-hidden className="board-col-icon" />
                    {PORTAL_STATUS_LABEL[stage]}
                    <span className="board-count">{all.length}</span>
                  </h2>
                </header>
                {col.length > 0 ? (
                  <ul className="board-col-body">
                    {col.map((t) => (
                      <TicketCard key={t.id} t={t} meId={user.id} inColumn />
                    ))}
                  </ul>
                ) : (
                  <p className="board-empty pk-col-empty">{EMPTY_COL[stage]}</p>
                )}
                {all.length > col.length && (
                  <button type="button" className="board-view-all" onClick={() => setDoneShown((n) => n + DONE_PAGE)}>
                    Show more
                  </button>
                )}
              </section>
            );
          })}
        </div>
      ) : shown.length === 0 ? (
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
    </div>
  );
}
