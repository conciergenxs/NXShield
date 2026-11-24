import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, ArrowRightLeft, AtSign, Bell, Boxes, Check, ChevronDown, ChevronRight, CircleCheck, CircleX, LayoutDashboard, LogOut, Search, Settings, Ticket as TicketIcon, TriangleAlert, UserPlus, X } from 'lucide-react';
import type { NotificationEventType } from '../types';
import { fmtRelative } from '../lib/format';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { ClientLogo, StatusBadge } from './domain';
import { Dialogs } from './dialogs';
import { ThemeSwitch } from './ThemeSwitch';
import { Avatar, cx, usePopover } from './ui';

/* ---------- Brand ---------- */

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="NXShield overview">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="9" fill="#c11fff" />
        <path d="M16 6.5l8 3v6.2c0 4.6-3.2 8.2-8 9.8-4.8-1.6-8-5.2-8-9.8V9.5z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
        <path d="M12.5 15.8l2.6 2.6 4.6-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>NXShield</span>
    </Link>
  );
}

/* ---------- Main navigation ---------- */

function TopNav() {
  const { tickets } = useStore();
  const { pathname } = useLocation();
  const newCount = useMemo(() => tickets.filter((t) => t.status === 'new').length, [tickets]);
  const items = [
    { to: '/', label: 'Overview', icon: LayoutDashboard, active: pathname === '/' },
    { to: '/tickets', label: 'Tickets', icon: TicketIcon, active: pathname.startsWith('/tickets'), count: newCount },
    { to: '/settings', label: 'Settings', icon: Settings, active: pathname.startsWith('/settings') },
  ];
  return (
    <nav className="topnav" aria-label="Main">
      {items.map(({ to, label, icon: Icon, active, count }) => (
        <Link key={to} to={to} className={cx('topnav-item', active && 'is-active')} aria-current={active ? 'page' : undefined}>
          <Icon size={17} aria-hidden />
          {label}
          {count ? (
            <span className="topnav-count" title={`${count} new tickets waiting for QA`}>
              {count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

/* ---------- Breadcrumb ---------- */

function useCrumbs(): { label: string; to?: string }[] {
  const { pathname } = useLocation();
  const [, section, id] = pathname.split('/');
  switch (section) {
    case '':
    case undefined:
      return [{ label: 'Overview' }];
    case 'tickets':
      if (!id || id === 'board' || id === 'calendar') return [{ label: 'Tickets' }];
      return [{ label: 'Tickets', to: '/tickets' }, { label: id }];
    case 'settings':
      return [{ label: 'Settings' }];
    default:
      return [{ label: 'Not found' }];
  }
}

/* ---------- Global search ---------- */

/** Search is hidden for now. Flip to bring it back to the top bar. */
const SHOW_SEARCH = false;

function GlobalSearch() {
  const { tickets, clients, assets, clientOf } = useStore();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { open, setOpen, ref } = usePopover();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const term = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (term.length < 2) return null;
    const t = [];
    for (let i = tickets.length - 1; i >= 0 && t.length < 5; i--) {
      const x = tickets[i];
      if (x.id.toLowerCase().includes(term) || x.title.toLowerCase().includes(term)) t.push(x);
    }
    return {
      tickets: t,
      clients: clients.filter((c) => c.name.toLowerCase().includes(term)).slice(0, 3),
      assets: assets.filter((a) => a.name.toLowerCase().includes(term) || a.id.toLowerCase().includes(term)).slice(0, 3),
    };
  }, [term, tickets, clients, assets]);

  const go = (to: string) => {
    setOpen(false);
    setQ('');
    input.current?.blur();
    navigate(to);
  };
  const none = results && !results.tickets.length && !results.clients.length && !results.assets.length;

  return (
    <div className="search" ref={ref}>
      <Search size={17} aria-hidden className="search-icon" />
      <input
        ref={input}
        className="search-input"
        type="search"
        placeholder="Search"
        aria-label="Search tickets, clients and assets"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && term) go(`/tickets?q=${encodeURIComponent(q.trim())}`);
        }}
      />
      <kbd className="search-kbd" aria-hidden>
        ⌘K
      </kbd>
      {open && results && (
        <div className="search-results">
          {none && <p className="search-empty">No tickets, clients or assets match “{q.trim()}”.</p>}
          {results.tickets.length > 0 && (
            <div className="search-group">
              <p className="search-heading">Tickets</p>
              {results.tickets.map((t) => (
                <button key={t.id} type="button" className="search-row" onClick={() => go(`/tickets/${t.id}`)}>
                  <span className="ticket-id">{t.id}</span>
                  <span className="truncate search-main">{t.title}</span>
                  <StatusBadge status={t.status} />
                </button>
              ))}
              <button type="button" className="search-all" onClick={() => go(`/tickets?q=${encodeURIComponent(q.trim())}`)}>
                See all matching tickets
              </button>
            </div>
          )}
          {results.clients.length > 0 && (
            <div className="search-group">
              <p className="search-heading">Clients</p>
              {results.clients.map((c) => (
                <button key={c.id} type="button" className="search-row" onClick={() => go('/settings/workspace')}>
                  <ClientLogo client={c} size={24} />
                  <span className="truncate search-main">{c.name}</span>
                  <span className="muted">{c.industry}</span>
                </button>
              ))}
            </div>
          )}
          {results.assets.length > 0 && (
            <div className="search-group">
              <p className="search-heading">Assets</p>
              {results.assets.map((a) => (
                <button key={a.id} type="button" className="search-row" onClick={() => go('/settings/workspace')}>
                  <Boxes size={16} aria-hidden className="muted" />
                  <span className="truncate search-main">{a.name}</span>
                  <span className="muted">{clientOf(a.clientId)?.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Notification center ---------- */

const EVENT_ICON: Record<NotificationEventType, { icon: typeof Bell; tone: string }> = {
  ticket_created: { icon: TicketIcon, tone: 'blue' },
  ticket_assigned: { icon: UserPlus, tone: 'blue' },
  status_updated: { icon: ArrowRightLeft, tone: 'blue' },
  sla_approaching: { icon: TriangleAlert, tone: 'orange' },
  sla_breached: { icon: CircleX, tone: 'red' },
  ticket_resolved: { icon: CircleCheck, tone: 'purple' },
  ticket_canceled: { icon: Check, tone: 'neutral' },
  progress_update: { icon: Activity, tone: 'pink' },
  mention: { icon: AtSign, tone: 'purple' },
};

/** The kind of a notification, short, above its title. */
const EVENT_KIND: Record<NotificationEventType, string> = {
  ticket_created: 'New ticket',
  ticket_assigned: 'Assigned',
  status_updated: 'Status',
  sla_approaching: 'SLA at risk',
  sla_breached: 'SLA breached',
  ticket_resolved: 'Resolved',
  ticket_canceled: 'Canceled',
  progress_update: 'Progress',
  mention: 'Mention',
};

function NotificationCenter() {
  const { notifications, markRead, markAllRead, now } = useStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((n) => !n.read).length;
  // A side peek over the page: Escape or a click outside closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button type="button" className={cx('icon-btn', open && 'is-open')} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open} onClick={() => setOpen(true)}>
        <Bell size={19} />
        {unread > 0 && <span className="icon-btn-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open &&
        createPortal(
          <div className="drawer-layer" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
            <aside className="drawer notif-drawer" role="dialog" aria-modal="true" aria-labelledby="notif-title">
              <header className="drawer-head">
                <div>
                  <h2 id="notif-title" className="drawer-title">
                    Notifications
                  </h2>
                  <p className="drawer-sub">{unread ? `${unread} unread` : 'You’re all caught up.'}</p>
                </div>
                <div className="notif-drawer-actions">
                  <button type="button" className="link-btn" disabled={!unread} onClick={markAllRead}>
                    Mark all as read
                  </button>
                  <button type="button" className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
                    <X size={18} aria-hidden />
                  </button>
                </div>
              </header>
              <div className="notif-feed">
                {notifications.length === 0 && <p className="notif-empty">Nothing here yet.</p>}
                {(
                  [
                    ['New', notifications.filter((n) => !n.read)],
                    ['Earlier', notifications.filter((n) => n.read)],
                  ] as const
                ).map(
                  ([heading, list]) =>
                    list.length > 0 && (
                      <section key={heading} className="notif-group" aria-label={heading}>
                        <h3 className="notif-group-title">{heading}</h3>
                        <ul className="notif-cards">
                          {list.slice(0, 30).map((n) => {
                            const { icon: Icon, tone } = EVENT_ICON[n.type];
                            return (
                              <li key={n.id}>
                                <button
                                  type="button"
                                  className={cx('notif-card', !n.read && 'is-unread')}
                                  onClick={() => {
                                    markRead(n.id);
                                    setOpen(false);
                                    navigate(`/tickets/${n.ticketId}`);
                                  }}
                                >
                                  <span className={cx('notif-icon', `tone-${tone}`)}>
                                    <Icon size={15} aria-hidden />
                                  </span>
                                  <span className="notif-card-body">
                                    <span className="notif-card-meta">
                                      <span className={cx('notif-kind', `tone-${tone}`)}>{EVENT_KIND[n.type]}</span>
                                      <span className="notif-card-time">{fmtRelative(n.at, now)}</span>
                                      {!n.read && <span className="notif-dot" aria-label="Unread" />}
                                    </span>
                                    <span className="notif-card-title">{n.title}</span>
                                    <span className="notif-card-text">{n.body}</span>
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    ),
                )}
              </div>
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
}

/* ---------- Profile menu ---------- */

function ProfileMenu() {
  const { currentUser } = useStore();
  const { signOut } = useAuth();
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="popover-anchor" ref={ref}>
      <button type="button" className={cx('profile-btn', open && 'is-open')} aria-expanded={open} aria-label={`Account menu for ${currentUser.name}`} onClick={() => setOpen(!open)}>
        <Avatar name={currentUser.name} size={32} src={currentUser.photo} />
        <span className="profile-btn-name">{currentUser.name}</span>
        <ChevronDown size={16} aria-hidden className="profile-btn-caret" />
      </button>
      {open && (
        <div className="popover profile-panel">
          <div className="profile-card">
            <Avatar name={currentUser.name} size={40} src={currentUser.photo} />
            <div className="profile-card-text">
              <p className="profile-card-name">{currentUser.name}</p>
              <p className="profile-card-email">{currentUser.email}</p>
            </div>
          </div>
          <div className="menu-sep" role="separator" />
          <Link to="/settings" className="menu-item" onClick={() => setOpen(false)}>
            <Settings size={16} aria-hidden /> Settings
          </Link>
          <ThemeSwitch />
          <div className="menu-sep" role="separator" />
          <button type="button" className="menu-item menu-item-signout" onClick={signOut}>
            <LogOut size={16} aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- Toasts ---------- */

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('toast', t.tone === 'error' && 'toast-error')}>
          {t.tone === 'error' ? <TriangleAlert size={16} aria-hidden /> : <CircleCheck size={16} aria-hidden />}
          <span>{t.message}</span>
          {t.link && (
            <Link to={t.link.to} onClick={() => dismissToast(t.id)}>
              {t.link.label}
            </Link>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------- Shell ---------- */

/** The tickets view last open (list, board or calendar), so a ticket's Back returns to it. */
export const TICKETS_VIEW_KEY = 'nxshield.ticketsView';

export function Layout() {
  const crumbs = useCrumbs();
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
    if (/^\/tickets(\/(board|calendar))?$/.test(pathname)) {
      try {
        sessionStorage.setItem(TICKETS_VIEW_KEY, pathname);
      } catch {
        // Without storage, Back goes to the list view.
      }
    }
    document.title = `${crumbs[crumbs.length - 1].label} · NXShield`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Publish the sticky header's height so focus and anchor scrolling stop below it.
  const topbarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty('--topbar-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The header is clear at the top of the page and blurs what scrolls under it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="shell">
      <div className="band" aria-hidden />
      <header className={cx('topbar', scrolled && 'is-scrolled')} ref={topbarRef}>
        {/* The blur sits on its own layer, so the header itself never becomes
            the anchor for fixed popovers. */}
        <div className="topbar-bg" aria-hidden />
        <div className="topbar-inner">
          <Brand />
          <TopNav />
          <div className="topbar-tools">
            {SHOW_SEARCH && <GlobalSearch />}
            <NotificationCenter />
            <ProfileMenu />
          </div>
        </div>
      </header>
      <main className="content">
        {/* Ticket and client pages have their own back button, so they need no breadcrumb. */}
        {crumbs.length > 1 && !/^\/(tickets\/(?!board$|calendar$)|clients\/)[^/]+$/.test(pathname) && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i} className="crumb">
                {i > 0 && <ChevronRight size={14} aria-hidden />}
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <Outlet />
      </main>
      <Dialogs />
      <Toasts />
    </div>
  );
}
