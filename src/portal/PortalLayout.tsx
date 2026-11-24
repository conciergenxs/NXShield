import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Ban, Bell, ChevronDown, CircleCheck, Flag, Hammer, LogOut, MessageSquare, Search, type LucideIcon } from 'lucide-react';
import { useAuth } from '../auth';
import { ROLE_LABEL, clientVisibleActivity } from '../lib/domain';
import { fmtRelative } from '../lib/format';
import { useStore } from '../store';
import type { Activity, Ticket } from '../types';
import { ClientLogo } from '../components/domain';
import { Toasts } from '../components/Layout';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { Avatar, cx, usePopover } from '../components/ui';
import { TicketScopeContext, portalScope } from '../components/scope';
import { portalText, usePortalUser } from './shared';

/* The Client Portal: what a client user sees. It shares the dashboard's look
   (the artwork behind a glass header, white containers) but shows only the
   client's own company, and never anything marked internal. */

function PortalBrand() {
  return (
    <Link to="/portal" className="brand" aria-label="Client Portal home">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="9" fill="#c11fff" />
        <path d="M16 6.5l8 3v6.2c0 4.6-3.2 8.2-8 9.8-4.8-1.6-8-5.2-8-9.8V9.5z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
        <path d="M12.5 15.8l2.6 2.6 4.6-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>NXShield</span>
      <span className="brand-tag">Client Portal</span>
    </Link>
  );
}

/* ---------- Notifications: every update NXS makes on the brand's tickets ---------- */

/** What a client is told about, and how it reads in the list. Their own actions are left out. */
const NOTIFY: Partial<Record<Activity['kind'], { icon: LucideIcon; tone: string; text: (a: Activity) => string }>> = {
  diagnosis: { icon: Search, tone: 'pink', text: () => 'Found the problem and started the fix' },
  progress: { icon: Hammer, tone: 'pink', text: (a) => a.text },
  status: { icon: Hammer, tone: 'neutral', text: (a) => portalText(a) },
  handoff: { icon: Flag, tone: 'yellow', text: () => 'The fix and its full RCA are ready: deploy it' },
  resolution: { icon: CircleCheck, tone: 'purple', text: () => 'Resolved' },
  cancellation: { icon: Ban, tone: 'neutral', text: () => 'Canceled by NXS' },
  comment: { icon: MessageSquare, tone: 'purple', text: (a) => a.text.replace(/^Comment: /, 'New comment: ') },
  response: { icon: MessageSquare, tone: 'blue', text: () => 'We replied to your report' },
  rca: { icon: Search, tone: 'purple', text: () => 'We updated our analysis' },
};

function PortalNotifications() {
  const { tickets, now, portalSeenAt, markPortalSeen } = useStore();
  const { client } = usePortalUser();
  const navigate = useNavigate();
  const { open, setOpen, ref } = usePopover();
  const items = useMemo(() => {
    if (!client) return [] as { t: Ticket; a: Activity }[];
    return tickets
      .filter((t) => t.clientId === client.id)
      .flatMap((t) => clientVisibleActivity(t).filter((a) => a.actor.type !== 'client' && NOTIFY[a.kind]).map((a) => ({ t, a })))
      .sort((x, y) => y.a.at - x.a.at)
      .slice(0, 25);
  }, [tickets, client]);
  if (!client) return null;
  // Before the first look, anything from the last day counts as new.
  const seen = portalSeenAt[client.id] ?? now - 24 * 3_600_000;
  const unread = items.filter((i) => i.a.at > seen).length;
  const toggle = () => {
    if (open) markPortalSeen(client.id);
    setOpen(!open);
  };

  return (
    <div className="popover-anchor" ref={ref}>
      <button type="button" className={cx('icon-btn', open && 'is-open')} aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'} aria-expanded={open} onClick={toggle}>
        <Bell size={19} />
        {unread > 0 && <span className="icon-btn-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="popover notif-panel portal-notif-panel" role="dialog" aria-label="Notifications">
          <header className="popover-header">
            <h2>Updates</h2>
            <button type="button" className="link-btn" disabled={!unread} onClick={() => markPortalSeen(client.id)}>
              Mark all as read
            </button>
          </header>
          <ul className="notif-list">
            {items.length === 0 && <li className="notif-empty">Nothing new yet.</li>}
            {items.map(({ t, a }) => {
              const kind = NOTIFY[a.kind]!;
              const Icon = kind.icon;
              const isNew = a.at > seen;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    className={cx('notif', isNew && 'is-unread')}
                    onClick={() => {
                      markPortalSeen(client.id);
                      setOpen(false);
                      navigate(`/portal/tickets/${t.id}`);
                    }}
                  >
                    <span className={cx('notif-icon', `tone-${kind.tone}`)}>
                      <Icon size={15} aria-hidden />
                    </span>
                    <span className="notif-body">
                      <span className="notif-title">
                        {t.id} · {t.title}
                      </span>
                      <span className="notif-text">{kind.text(a)}</span>
                      <span className="notif-time">{fmtRelative(a.at, now)}</span>
                    </span>
                    {isNew && <span className="notif-dot" aria-label="New" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function PortalProfile() {
  const { user, client } = usePortalUser();
  const { signOut } = useAuth('client');
  const { open, setOpen, ref } = usePopover();
  if (!user || !client) return null;
  return (
    <div className="popover-anchor" ref={ref}>
      <button type="button" className={cx('profile-btn', open && 'is-open')} aria-expanded={open} aria-label={`Account menu for ${user.name}`} onClick={() => setOpen(!open)}>
        <Avatar name={user.name} size={32} />
        <span className="profile-btn-name">{user.name}</span>
        <ChevronDown size={16} aria-hidden className="profile-btn-caret" />
      </button>
      {open && (
        <div className="popover profile-panel">
          <div className="profile-card">
            <Avatar name={user.name} size={40} />
            <div className="profile-card-text">
              <p className="profile-card-name">{user.name}</p>
              <p className="profile-card-email">{user.email}</p>
            </div>
          </div>
          <div className="menu-sep" role="separator" />
          <div className="profile-org">
            <ClientLogo client={client} size={28} />
            <div className="profile-card-text">
              <p className="profile-org-name">{client.name}</p>
              <p className="profile-card-email">{ROLE_LABEL[user.role]}</p>
            </div>
          </div>
          <div className="menu-sep" role="separator" />
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

const TITLES: [RegExp, string][] = [
  [/^\/portal\/tickets\/new/, 'New ticket'],
  [/^\/portal\/tickets\//, 'Ticket'],
  [/^\/portal\/(board|calendar)?\/?$/, 'Tickets'],
];

export function PortalLayout() {
  const { pathname } = useLocation();
  const { user, client } = usePortalUser();
  const { signOut } = useAuth('client');
  // Everything under the portal sees only this client's tickets, in the client's words.
  const scope = useMemo(() => portalScope(client?.id ?? '', client?.name ?? ''), [client?.id, client?.name]);

  useEffect(() => {
    window.scrollTo(0, 0);
    const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? 'Client Portal';
    document.title = `${title} · NXS Client Portal`;
  }, [pathname]);

  const topbarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Clear at the top of the page; blurs what scrolls under it, as on the dashboard.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // The account was removed, or only existed before a reload: sign in again.
  useEffect(() => {
    if (!user) signOut();
  }, [user, signOut]);
  if (!user || !client) return <Navigate to="/portal/login" replace />;

  return (
    <div className="shell portal-shell">
      <div className="band" aria-hidden />
      <header className={cx('topbar', scrolled && 'is-scrolled')} ref={topbarRef}>
        <div className="topbar-bg" aria-hidden />
        <div className="topbar-inner">
          <PortalBrand />
          <div className="topbar-tools">
            <PortalNotifications />
            <PortalProfile />
          </div>
        </div>
      </header>
      <main className="content">
        <TicketScopeContext.Provider value={scope}>
          <Outlet />
        </TicketScopeContext.Provider>
      </main>
      <Toasts />
    </div>
  );
}
