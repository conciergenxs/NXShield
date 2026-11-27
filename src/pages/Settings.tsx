import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Building2, ChevronLeft, ChevronRight, Globe, KeyRound, Plus, Search, Trash2, Upload, User, UsersRound, type LucideIcon } from 'lucide-react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import type { AssetStatus, Availability, Category, Client, ClientUser, TeamMember } from '../types';
import { ASSET_CATEGORY_LABEL, AVAILABILITY_LABEL, CATEGORIES, CATEGORY_LABEL, ROLE_LABEL, isOpen } from '../lib/domain';
import { useStore } from '../store';
import { Assignee, ClientLogo } from '../components/domain';
import { Avatar, Button, Field, Select, cx } from '../components/ui';

/*
 * Settings, one module at a time, like a settings window: a rail on the left
 * groups the modules (you, then the workspace), the panel on the right shows
 * only the one you're in. Each module is a list of rows: what a setting is on
 * the left, its value or control on the right. Every module has its own
 * address, so a link can point straight at it. Few lines: groups are cards,
 * list items are soft rows with space between them.
 */

type SectionKey = 'profile' | 'security' | 'team' | 'clients';
interface NavItem {
  key: SectionKey;
  label: string;
  icon: LucideIcon;
  /** What the module is for, under its title. */
}
const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'You',
    items: [
      { key: 'profile', label: 'Profile', icon: User },
      { key: 'security', label: 'Security', icon: KeyRound },
    ],
  },
  {
    group: 'Workspace',
    items: [
      { key: 'team', label: 'Team', icon: UsersRound },
      { key: 'clients', label: 'Clients', icon: Building2 },
    ],
  },
];
const ITEMS = NAV.flatMap((g) => g.items);
const pathOf = (key: SectionKey) => (key === 'profile' ? '/settings' : `/settings/${key}`);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHOTO_MAX = 2 * 1024 * 1024;

export function Settings() {
  const { section, id } = useParams();
  const [params] = useSearchParams();
  // Portal users and assets live on each client's page now; old links land there.
  if (section === 'users' || section === 'assets') {
    const c = params.get('client');
    return <Navigate to={c ? `/settings/clients/${c}` : '/settings/clients'} replace />;
  }
  const key = (section ?? 'profile') as SectionKey;
  const item = ITEMS.find((i) => i.key === key);
  if (!item) return <Navigate to="/settings" replace />;
  return (
    // One container: the modules on the left, the one you're in on the right.
    <div className="page">
      <div className="st">
        <nav className="st-nav" aria-label="Settings">
          <p className="st-nav-title">Settings</p>
          {NAV.map((g) => (
            <div key={g.group} className="st-nav-group">
              <p className="st-nav-label">{g.group}</p>
              {g.items.map((i) => (
                <Link key={i.key} to={pathOf(i.key)} className={cx('st-nav-item', i.key === key && 'is-active')} aria-current={i.key === key && !id ? 'page' : undefined}>
                  <i.icon size={17} aria-hidden />
                  {i.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        {/* Keyed by module (and client), so each one opens fresh and slides in. */}
        <main key={`${key}-${id ?? ''}`} className="st-panel" aria-labelledby="st-title">
          {key === 'profile' && <ProfileModule item={item} />}
          {key === 'security' && <SecurityModule item={item} />}
          {key === 'team' && <TeamModule item={item} />}
          {key === 'clients' && (id ? <ClientPage clientId={id} /> : <ClientsModule item={item} />)}
        </main>
      </div>
    </div>
  );
}

/* ---------- Shared pieces ---------- */

function PanelHead({ item, count, actions }: { item: NavItem; count?: number; actions?: ReactNode }) {
  return (
    <header className="st-head">
      <div>
        <h1 id="st-title" className="st-title">
          {item.label}
          {count != null && <span className="st-count">{count}</span>}
        </h1>
      </div>
      {actions && <div className="st-head-actions">{actions}</div>}
    </header>
  );
}

/** Search and, where it helps, one client at a time. The client lives in the address (?client=). */
function Toolbar({ query, onQuery, placeholder, clientFilter, children }: { query: string; onQuery: (v: string) => void; placeholder: string; clientFilter?: boolean; children?: ReactNode }) {
  const { clients } = useStore();
  const [params, setParams] = useSearchParams();
  const client = params.get('client') ?? 'all';
  return (
    <div className="st-toolbar">
      <label className="filter-search st-search">
        <Search size={16} aria-hidden />
        <input type="search" placeholder={placeholder} aria-label={placeholder} value={query} onChange={(e) => onQuery(e.target.value)} />
      </label>
      {clientFilter && (
        <div className="st-chips" role="group" aria-label="Client">
          {[{ id: 'all', name: 'All clients' }, ...clients].map((c) => (
            <button
              key={c.id}
              type="button"
              className={cx('st-chip', client === c.id && 'is-on')}
              aria-pressed={client === c.id}
              onClick={() => setParams(c.id === 'all' ? {} : { client: c.id }, { replace: true })}
            >
              {'logo' in c && <ClientLogo client={c as Client} size={18} />}
              {c.name}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

function EmptyRows({ children }: { children: ReactNode }) {
  return <p className="st-empty">{children}</p>;
}

/* ---------- You: profile ---------- */

function ProfileModule({ item }: { item: NavItem }) {
  const { currentUser, updateProfile, toast, clients } = useStore();
  const picker = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState('');
  const [name, setName] = useState(currentUser.name);
  const [title, setTitle] = useState(currentUser.title);
  const [email, setEmail] = useState(currentUser.email);
  const [phone, setPhone] = useState(currentUser.phone);
  const [submitted, setSubmitted] = useState(false);
  const errors = { name: name.trim().length < 2 ? 'Add your name.' : '', email: EMAIL_RE.test(email.trim()) ? '' : 'Enter a valid email.' };
  const changed = name !== currentUser.name || title !== currentUser.title || email !== currentUser.email || phone !== currentUser.phone;
  const reset = () => {
    setName(currentUser.name);
    setTitle(currentUser.title);
    setEmail(currentUser.email);
    setPhone(currentUser.phone);
    setSubmitted(false);
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (errors.name || errors.email) return;
    updateProfile({ name: name.trim(), title: title.trim(), email: email.trim(), phone: phone.trim() });
    toast('Profile saved');
    setSubmitted(false);
  };
  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) return setPhotoError('Use a PNG, JPG, WebP or GIF image.');
    if (file.size > PHOTO_MAX) return setPhotoError('Use an image up to 2 MB.');
    setPhotoError('');
    const reader = new FileReader();
    reader.onload = () => {
      updateProfile({ photo: String(reader.result) });
      toast('Photo updated');
    };
    reader.readAsDataURL(file);
  };
  const roles = crewRoles(currentUser.id, clients);
  return (
    <form onSubmit={save} noValidate>
      <PanelHead item={item} />
      {/* Who you are, at a glance: photo, name, role and the clients you work on. */}
      <section className="st-identity" aria-label="You">
        <Avatar name={currentUser.name} size={72} src={currentUser.photo} />
        <div className="st-identity-main">
          <p className="st-identity-name">{currentUser.name}</p>
          <p className="st-identity-sub">
            {currentUser.title || 'No job title'} · {ROLE_LABEL[currentUser.role]}
          </p>
          {roles.length > 0 && <CrewChips roles={roles} />}
        </div>
        <div className="st-identity-actions">
          <Button size="sm" icon={<Upload size={15} />} onClick={() => picker.current?.click()}>
            {currentUser.photo ? 'Change photo' : 'Upload photo'}
          </Button>
          {currentUser.photo && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={15} />}
              onClick={() => {
                updateProfile({ photo: undefined });
                toast('Photo removed');
              }}
            >
              Remove
            </Button>
          )}
          <p className={photoError ? 'field-error' : 'st-identity-hint'}>{photoError || 'PNG, JPG, WebP or GIF, up to 2 MB.'}</p>
          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </section>
      <section className="st-card" aria-labelledby="st-info">
        <h2 id="st-info" className="st-card-title">
          Personal information
        </h2>
        <div className="form-grid">
          <Field label="Full name" htmlFor="st-name" error={submitted ? errors.name : ''}>
            <input id="st-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          <Field label="Job title" htmlFor="st-title-input" optional>
            <input id="st-title-input" className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="organization-title" />
          </Field>
          <Field label="Email" htmlFor="st-email" error={submitted ? errors.email : ''}>
            <input id="st-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          <Field label="Phone" htmlFor="st-phone" optional>
            <input id="st-phone" type="tel" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          </Field>
        </div>
      </section>
      {/* Only when something changed: a bar to save it or put it back. */}
      {changed && (
        <div className="st-savebar" role="region" aria-label="Unsaved changes">
          <span>You have unsaved changes.</span>
          <Button variant="ghost" onClick={reset}>
            Discard
          </Button>
          <Button variant="primary" type="submit">
            Save changes
          </Button>
        </div>
      )}
    </form>
  );
}

/* ---------- You: security ---------- */

function SecurityModule({ item }: { item: NavItem }) {
  const { toast } = useStore();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const errors = {
    current: current ? '' : 'Enter your current password.',
    next: next.length >= 8 ? '' : 'Use at least 8 characters.',
    confirm: confirm === next ? '' : 'The passwords don’t match.',
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (errors.current || errors.next || errors.confirm) return;
    toast('Password updated');
    setCurrent('');
    setNext('');
    setConfirm('');
    setSubmitted(false);
  };
  return (
    <form onSubmit={save} noValidate>
      <PanelHead item={item} />
      <section className="st-card" aria-labelledby="st-pw">
        <h2 id="st-pw" className="st-card-title">
          Change password
        </h2>
        <div className="form-grid">
          <div className="span-2">
            <Field label="Current password" htmlFor="st-current" error={submitted ? errors.current : ''}>
              <input id="st-current" type="password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            </Field>
          </div>
          <Field label="New password" htmlFor="st-new" hint="At least 8 characters." error={submitted ? errors.next : ''}>
            <input id="st-new" type="password" className="input" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password" htmlFor="st-confirm" error={submitted ? errors.confirm : ''}>
            <input id="st-confirm" type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
        </div>
        <div className="st-card-foot">
          <Button variant="primary" type="submit" disabled={!current && !next && !confirm}>
            Update password
          </Button>
        </div>
      </section>
    </form>
  );
}

/* ---------- Workspace: team ---------- */

type CrewRole = 'PM' | 'QA' | 'Frontend' | 'Backend';
/** What someone does for each client, from the clients' set-up. */
function crewRoles(memberId: string, clients: Client[]): { client: Client; role: CrewRole }[] {
  const out: { client: Client; role: CrewRole }[] = [];
  for (const c of clients) {
    if (c.accountManagerId === memberId) out.push({ client: c, role: 'PM' });
    if (c.testerId === memberId) out.push({ client: c, role: 'QA' });
    if (c.devs.frontend === memberId) out.push({ client: c, role: 'Frontend' });
    if (c.devs.backend === memberId) out.push({ client: c, role: 'Backend' });
  }
  return out;
}
function CrewChips({ roles }: { roles: { client: Client; role: CrewRole }[] }) {
  return (
    <span className="st-crew">
      {roles.map(({ client, role }) => (
        <span key={`${client.id}-${role}`} className="st-crew-chip">
          <ClientLogo client={client} size={16} />
          {role}
        </span>
      ))}
    </span>
  );
}

const AVAILABILITIES: Availability[] = ['available', 'busy', 'away', 'off_shift'];

function TeamModule({ item }: { item: NavItem }) {
  const { team, clients, tickets, setAvailability, setDialog, can, currentUser } = useStore();
  const [q, setQ] = useState('');
  const editable = can('team.manage');
  const term = q.trim().toLowerCase();
  const shown = team.filter((m) => !term || `${m.name} ${m.title} ${m.email}`.toLowerCase().includes(term));
  const load = (id: string) => tickets.filter((t) => isOpen(t) && t.assigneeId === id).length;
  return (
    <>
      <PanelHead
        item={item}
        count={team.length}
        actions={
          editable && (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setDialog({ type: 'add-member' })}>
              Add member
            </Button>
          )
        }
      />
      <Toolbar query={q} onQuery={setQ} placeholder="Search name, title or email" />
      <ul className="st-list" aria-label="Team">
        {shown.map((m: TeamMember) => {
          const roles = crewRoles(m.id, clients);
          return (
            <li key={m.id} className="st-item st-member">
              <Avatar name={m.name} size={36} src={m.photo} />
              <div className="st-item-main">
                <p className="st-item-name">
                  {m.name}
                  {m.id === currentUser.id && <span className="st-you">You</span>}
                </p>
                <p className="st-item-sub truncate">
                  {m.title} · {m.email}
                </p>
              </div>
              <div className="st-member-work">
                {roles.length ? <CrewChips roles={roles} /> : <span className="st-value is-muted">No client</span>}
                <span className="st-load">{load(m.id)} open</span>
              </div>
              <span className="st-role">{ROLE_LABEL[m.role]}</span>
              <span className="st-avail">
                <span className={cx('st-avail-dot', `is-${m.availability}`)} aria-hidden />
                {editable ? (
                  <Select<Availability> size="sm" ariaLabel={`${m.name}: availability`} value={m.availability} onChange={(v) => setAvailability(m.id, v)} options={AVAILABILITIES.map((a) => ({ value: a, label: AVAILABILITY_LABEL[a] }))} />
                ) : (
                  AVAILABILITY_LABEL[m.availability]
                )}
              </span>
            </li>
          );
        })}
        {shown.length === 0 && <EmptyRows>No one matches “{q.trim()}”.</EmptyRows>}
      </ul>
    </>
  );
}

/* ---------- Workspace: clients ---------- */

function ClientsModule({ item }: { item: NavItem }) {
  const { clients, assets, tickets, setDialog, can } = useStore();
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const shown = clients.filter((c) => !term || `${c.name} ${c.industry} ${c.city}`.toLowerCase().includes(term));
  return (
    <>
      <PanelHead
        item={item}
        count={clients.length}
        actions={
          can('clients.manage') && (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setDialog({ type: 'add-client' })}>
              Add client
            </Button>
          )
        }
      />
      <Toolbar query={q} onQuery={setQ} placeholder="Search clients" />
      <div className="st-clients">
        {shown.map((c) => {
          const own = assets.filter((a) => a.clientId === c.id).length;
          const open = tickets.filter((t) => t.clientId === c.id && isOpen(t)).length;
          return (
            <Link key={c.id} to={`/settings/clients/${c.id}`} className="st-client" aria-labelledby={`stc-${c.id}`}>
              <header className="st-client-head">
                <ClientLogo client={c} size={48} />
                <div>
                  <h2 id={`stc-${c.id}`}>{c.name}</h2>
                  <p>
                    {c.industry} · {c.city}
                  </p>
                </div>
                <ChevronRight size={18} aria-hidden className="st-client-go" />
              </header>
              {/* Three numbers at a glance; the card opens the client's set-up. */}
              <div className="st-client-stats">
                <span className="st-stat">
                  <strong>{open}</strong>
                  <span>Open tickets</span>
                </span>
                <span className="st-stat">
                  <strong>{c.users.length}</strong>
                  <span>Portal users</span>
                </span>
                <span className="st-stat">
                  <strong>{own}</strong>
                  <span>Assets</span>
                </span>
              </div>
            </Link>
          );
        })}
        {shown.length === 0 && <EmptyRows>No client matches “{q.trim()}”.</EmptyRows>}
      </div>
    </>
  );
}

/* ---------- Workspace: a client's page ---------- */

/**
 * What a PIC can raise tickets for: one toggle per category. The last one
 * can't be switched off; a PIC with no category couldn't raise anything.
 */
function CanRaise({ user, editable }: { user: ClientUser; editable: boolean }) {
  const { setUserCategories, toast } = useStore();
  const toggle = (c: Category) => {
    const on = user.categories.includes(c);
    if (on && user.categories.length === 1) return toast(`${user.name} needs at least one category`, { tone: 'warning' });
    setUserCategories(user.clientId, user.id, CATEGORIES.filter((x) => (x === c ? !on : user.categories.includes(x))));
  };
  if (!editable) return <span className="st-value">{CATEGORIES.filter((c) => user.categories.includes(c)).map((c) => CATEGORY_LABEL[c].replace(' issue', '')).join(', ') || '—'}</span>;
  return (
    <span className="cat-toggles" role="group" aria-label={`What ${user.name} can raise`}>
      {CATEGORIES.map((c) => {
        const on = user.categories.includes(c);
        return (
          <button key={c} type="button" className={cx('cat-toggle', on && 'is-on')} aria-pressed={on} onClick={() => toggle(c)}>
            {CATEGORY_LABEL[c].replace(' issue', '')}
          </button>
        );
      })}
    </span>
  );
}

/* ---------- Workspace: assets ---------- */

const LIVE_LABEL: Record<AssetStatus, string> = { operational: 'Live', degraded: 'Degraded', outage: 'Down', maintenance: 'Maintenance', unknown: 'No signal' };

/**
 * One client, set up in one place: who they are, the people who raise tickets
 * (and what each may raise), and the assets NXS looks after for them.
 */
function ClientPage({ clientId }: { clientId: string }) {
  const { clientOf, assets, tickets, team, setDialog, can } = useStore();
  const client = clientOf(clientId);
  if (!client) return <Navigate to="/settings/clients" replace />;
  const own = assets.filter((a) => a.clientId === client.id);
  const open = tickets.filter((t) => t.clientId === client.id && isOpen(t)).length;
  const editable = can('clients.manage');
  return (
    <>
      <Link to="/settings/clients" className="st-back">
        <ChevronLeft size={16} aria-hidden />
        Clients
      </Link>
      <header className="st-brand">
        <ClientLogo client={client} size={64} />
        <div className="st-brand-main">
          <h1 id="st-title" className="st-title">
            {client.name}
          </h1>
          <p className="st-about">
            {client.industry} · {client.city} · with NXS since {client.since.slice(0, 4)}
          </p>
        </div>
        <Link to={`/tickets?client=${client.id}&status=open`} className="st-brand-stat">
          <strong>{open}</strong>
          <span>Open tickets</span>
          <ChevronRight size={15} aria-hidden />
        </Link>
      </header>

      <section className="st-card" aria-labelledby="st-users">
        <div className="st-card-head">
          <h2 id="st-users" className="st-card-title">
            Portal users <span className="st-count">{client.users.length}</span>
          </h2>
          {editable && (
            <Button size="sm" icon={<Plus size={15} />} onClick={() => setDialog({ type: 'add-user', clientId: client.id })}>
              Add user
            </Button>
          )}
        </div>
        <ul className="st-list" aria-label="Portal users">
          {client.users.map((u) => (
            <li key={u.id} className="st-item st-user">
              <Avatar name={u.name} size={36} />
              <div className="st-item-main">
                <p className="st-item-name">{u.name}</p>
                <p className="st-item-sub truncate">
                  {u.title || 'No title'} · {u.email}
                </p>
              </div>
              <span className="st-role">{ROLE_LABEL[u.role]}</span>
              <div className="st-user-raise">
                <span className="st-mini-label">Can raise</span>
                <CanRaise user={u} editable={editable} />
              </div>
            </li>
          ))}
          {client.users.length === 0 && <EmptyRows>No one at {client.name} can sign in yet. Add the people who raise tickets.</EmptyRows>}
        </ul>
      </section>

      <section className="st-card" aria-labelledby="st-assets">
        <div className="st-card-head">
          <h2 id="st-assets" className="st-card-title">
            Assets <span className="st-count">{own.length}</span>
          </h2>
          {can('assets.manage') && (
            <Button size="sm" icon={<Plus size={15} />} onClick={() => setDialog({ type: 'add-asset', clientId: client.id })}>
              Add asset
            </Button>
          )}
        </div>
        <ul className="st-list" aria-label="Assets">
          {own.map((a) => {
            const openHere = tickets.filter((t) => t.assetId === a.id && isOpen(t)).length;
            return (
              <li key={a.id} className="st-item st-asset">
                <span className="st-asset-icon" aria-hidden>
                  <Globe size={17} />
                </span>
                <div className="st-item-main">
                  <p className="st-item-name">{a.name}</p>
                  <p className="st-item-sub truncate">
                    <a href={a.url} target="_blank" rel="noreferrer" className="link-quiet">
                      {a.url.replace(/^https?:\/\//, '')}
                    </a>{' '}
                    · {ASSET_CATEGORY_LABEL[a.category]} · {a.environment}
                  </p>
                </div>
                <span className="st-asset-owner">
                  <Assignee member={team.find((m) => m.id === a.ownerId)} size={22} />
                </span>
                <span className="st-asset-state">
                  <span className={cx('live-status', `is-${a.status}`)}>
                    <span className="live-dot" aria-hidden />
                    {LIVE_LABEL[a.status]}
                  </span>
                  <small>
                    {a.uptime30d != null ? `${a.uptime30d}% · ` : ''}
                    {openHere} open
                  </small>
                </span>
              </li>
            );
          })}
          {own.length === 0 && <EmptyRows>No assets yet. Add the websites, dashboards or apps NXS looks after for {client.name}.</EmptyRows>}
        </ul>
      </section>
    </>
  );
}
