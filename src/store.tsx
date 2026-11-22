import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Activity, Actor, AppNotification, Asset, AssetStatus, Attachment, Availability, Category, Client, ClientUser, DeliveryRecord, Department, NotificationEventType, NotificationRule, Permission, Severity, SlaPolicy, SlaTarget, TeamMember, Ticket, TicketChannel, TicketStatus, AssetCategory, AssetMonitor } from './types';
import * as seed from './data/seed';
import { buildInitialTickets } from './data/tickets';
import { NEEDS_ASSIGNEE, SEVERITY_LABEL, priorityLabel, STATUS_LABEL, canTransition, hasPermission, isOpen, moveLabel, needsMoveNote, portalStatus } from './lib/domain';
import { fmtDuration } from './lib/format';
import { PROGRESS_EVERY_MINS, PROGRESS_STAGES, progressUpdate, stepUpdate } from './lib/assist';

const MIN_MS = 60_000;
import { dispatch, type NotifyContext } from './lib/notifications';
import { getSla, type SlaState, type TicketSla } from './lib/sla';

export interface NewTicketInput {
  clientId: string;
  assetId: string;
  reporterId: string;
  /** Where the client reported the issue. Tickets logged here never come from the portal. */
  channel: Exclude<TicketChannel, 'portal'>;
  title: string;
  description: string;
  category: Category;
  /** From the impact questions; null for categories without a priority. */
  severity: Severity | null;
  attachments: Attachment[];
}

/** A ticket a client user submits themselves in the Client Portal. */
export interface PortalTicketInput {
  clientId: string;
  assetId: string;
  reporterId: string;
  title: string;
  description: string;
  category: Category;
  severity: Severity | null;
  attachments: Attachment[];
}

/** Soft logo colours handed out in turn to new clients. */
const LOGO_TONES = [
  { bg: '#FCE8EF', fg: '#A8325E' },
  { bg: '#EAEAF7', fg: '#3D3F8F' },
  { bg: '#E3F3EA', fg: '#2C6B45' },
  { bg: '#FFF0DE', fg: '#94520F' },
  { bg: '#E2F1F8', fg: '#22617F' },
  { bg: '#F3E8FD', fg: '#6B2A99' },
];

export type Dialog =
  | { type: 'cancel'; ticketId: string }
  | { type: 'resolve'; ticketId: string }
  | { type: 'block'; ticketId: string }
  | { type: 'move-note'; ticketId: string; to: TicketStatus }
  | { type: 'request-approval'; ticketId: string }
  | { type: 'start-work'; ticketId: string }
  | { type: 'unblock'; ticketId: string }
  | { type: 'assign'; ticketId: string; then?: TicketStatus }
  | { type: 'add-client' }
  | { type: 'add-user'; clientId: string }
  | { type: 'add-asset'; clientId: string }
  | null;

export interface NewClientInput {
  name: string;
  /** A few words on what they do, shown under the name. */
  industry: string;
  logoImage?: string;
}
export interface NewClientUserInput {
  name: string;
  title: string;
  email: string;
  phone: string;
}
export interface NewAssetInput {
  /** Who at NXS is plotted on it; new tickets go to them. */
  ownerId: string;
  name: string;
  category: AssetCategory;
  url: string;
  environment: Asset['environment'];
  monitor: AssetMonitor;
}

export interface Toast {
  id: number;
  message: string;
  tone: 'default' | 'error';
  link?: { to: string; label: string };
}

interface Store {
  now: number;
  currentUser: TeamMember;
  can: (p: Permission) => boolean;

  tickets: Ticket[];
  clients: Client[];
  assets: Asset[];
  team: TeamMember[];
  departments: Department[];
  policies: SlaPolicy[];
  notifications: AppNotification[];
  notificationRules: NotificationRule[];
  deliveries: DeliveryRecord[];

  ticketOf: (id: string | undefined) => Ticket | undefined;
  clientOf: (id: string) => Client | undefined;
  assetOf: (id: string) => Asset | undefined;
  memberOf: (id: string | null | undefined) => TeamMember | undefined;
  deptOf: (id: string) => Department | undefined;
  reporterOf: (t: Ticket) => ClientUser | undefined;
  policyOf: (clientId: string) => SlaPolicy;
  slaOf: (t: Ticket) => TicketSla;
  actorName: (a: Actor) => string;
  openLoad: (memberId: string) => number;

  createTicket: (input: NewTicketInput) => Ticket;
  /** Moves a ticket along a move the workflow allows. Every move off the
   *  linear path needs a `reason` (rework, reopen, blocker, resolve without
   *  approval, cancel); without one the matching dialog opens. Sending for
   *  approval needs a `handoff`: a note to the client, with optional files. */
  changeStatus: (id: string, to: TicketStatus, opts?: { reason?: string; handoff?: { note: string; attachments: Attachment[] }; diagnosis?: { issue: string; fix: string } }) => boolean;
  /** When the signed-in client last opened their notifications, per client. */
  portalSeenAt: Record<string, number>;
  markPortalSeen: (clientId: string) => void;
  assignTicket: (id: string, memberId: string | null, then?: TicketStatus) => void;
  setSeverity: (id: string, severity: Severity) => void;

  /* Client Portal: actions taken by a client user, recorded as theirs. */
  submitPortalTicket: (input: PortalTicketInput) => Ticket;
  /** The client's answer to a fix waiting for approval: approving resolves it, declining reopens it. */
  reviewFix: (ticketId: string, userId: string, decision: 'approved' | 'declined', note: string, attachments?: Attachment[]) => boolean;

  setAssetStatus: (id: string, status: AssetStatus) => void;
  addClient: (input: NewClientInput) => Client;
  addClientUser: (clientId: string, input: NewClientUserInput) => ClientUser;
  addAsset: (clientId: string, input: NewAssetInput) => Asset;
  updatePolicyTarget: (policyId: string, severity: Severity, patch: Partial<SlaTarget>) => void;
  setAvailability: (memberId: string, availability: Availability) => void;
  /** The signed-in person edits their own name, title, email and phone. */
  updateProfile: (patch: Partial<Pick<TeamMember, 'name' | 'title' | 'email' | 'phone' | 'photo'>>) => void;

  markRead: (id: string) => void;
  markAllRead: () => void;
  updateNotificationRule: (event: NotificationEventType, patch: Partial<NotificationRule>) => void;
  sendTestMessage: (event: NotificationEventType) => void;

  dialog: Dialog;
  setDialog: (d: Dialog) => void;
  toasts: Toast[];
  toast: (message: string, opts?: { tone?: Toast['tone']; link?: Toast['link'] }) => void;
  dismissToast: (id: number) => void;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore must be used inside StoreProvider');
  return s;
}

let actSeq = 0;
const activity = (at: number, actor: Actor, kind: Activity['kind'], text: string, visibility: Activity['visibility'] = 'client'): Activity => ({
  id: `act-n${++actSeq}`,
  at,
  actor,
  kind,
  text,
  visibility,
});

const policyFor = (clients: Client[], policies: SlaPolicy[], clientId: string) => {
  const c = clients.find((x) => x.id === clientId);
  return policies.find((p) => p.id === c?.slaPolicyId) ?? policies.find((p) => p.isDefault) ?? policies[0];
};

function slaDetail(sla: TicketSla): string {
  const left = sla.active.remainingMs;
  return left >= 0 ? `${sla.activeLabel} due in ${fmtDuration(left)}` : `${sla.activeLabel} overdue by ${fmtDuration(left)}`;
}

/** Notifications that would already exist for the seeded tickets. */
function seedNotifications(tickets: Ticket[], now: number) {
  const ctx: NotifyContext = { clients: seed.clients, team: seed.team, rules: seed.notificationRules };
  const items: { type: NotificationEventType; t: Ticket; at: number; detail?: string }[] = [];
  const recent = now - 30 * seed.HOUR;
  for (const t of tickets) {
    if (t.createdAt > now - 6 * seed.HOUR) items.push({ type: 'ticket_created', t, at: t.createdAt });
    if (t.status === 'resolved' && t.resolvedAt && t.resolvedAt > recent && t.activity.length > 6) items.push({ type: 'ticket_resolved', t, at: t.resolvedAt });
    if (!isOpen(t)) continue;
    const policy = policyFor(seed.clients, seed.policies, t.clientId);
    const sla = getSla(t, policy, now);
    const c = sla.active;
    if (sla.overall === 'breached') {
      const at = sla.resolution.state === 'breached' ? sla.resolution.due : sla.firstResponse.due;
      if (at > recent) items.push({ type: 'sla_breached', t, at, detail: slaDetail(sla) });
    } else if (sla.overall === 'at_risk') {
      items.push({ type: 'sla_approaching', t, at: Math.min(now - seed.MIN, c.due - c.targetMs * (1 - policy.atRiskPercent / 100)), detail: slaDetail(sla) });
    }
  }
  items.sort((a, b) => b.at - a.at);
  const notifications: AppNotification[] = [];
  const deliveries: DeliveryRecord[] = [];
  for (const it of items.slice(0, 14)) {
    const out = dispatch(it.type, it.t, ctx, it.at, it.detail, it.at < now - 1.5 * seed.HOUR);
    notifications.push(out.notification);
    deliveries.push(...out.deliveries);
  }
  return { notifications, deliveries };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  // The clock is frozen at the moment the sample data was made, so countdowns
  // and SLA states hold still while the prototype is shown. Actions still
  // stamp the real time.
  const [now] = useState(() => seed.LOADED_AT);
  const [tickets, setTickets] = useState<Ticket[]>(() => buildInitialTickets());
  const [clients, setClients] = useState(seed.clients);
  const [assets, setAssets] = useState(seed.assets);
  const [team, setTeam] = useState(seed.team);
  const [policies, setPolicies] = useState(seed.policies);
  const [portalSeenAt, setPortalSeenAt] = useState<Record<string, number>>({});
  const markPortalSeen = useCallback((clientId: string) => setPortalSeenAt((m) => ({ ...m, [clientId]: Date.now() })), []);
  const [notificationRules, setNotificationRules] = useState(seed.notificationRules);
  const [initialFeed] = useState(() => seedNotifications(tickets, Date.now()));
  const [notifications, setNotifications] = useState(initialFeed.notifications);
  const [deliveries, setDeliveries] = useState(initialFeed.deliveries);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const departments = seed.departments;

  // Latest state for use inside actions, so several actions can run in one tick.
  const live = useRef({ tickets, clients, assets, team, policies, notificationRules });
  live.current = { tickets, clients, assets, team, policies, notificationRules };

  const currentUser = team.find((m) => m.id === seed.CURRENT_USER_ID)!;
  const me: Actor = useMemo(() => ({ type: 'team', id: currentUser.id }), [currentUser.id]);
  const can = useCallback((p: Permission) => hasPermission(currentUser.role, p), [currentUser.role]);

  /* ---------- Lookups ---------- */

  const ticketMap = useMemo(() => new Map(tickets.map((t) => [t.id, t])), [tickets]);
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const memberMap = useMemo(() => new Map(team.map((m) => [m.id, m])), [team]);
  const userMap = useMemo(() => new Map(clients.flatMap((c) => c.users).map((u) => [u.id, u])), [clients]);
  const policyByClient = useMemo(() => new Map(clients.map((c) => [c.id, policyFor(clients, policies, c.id)])), [clients, policies]);
  const loadMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tickets) if (t.assigneeId && isOpen(t)) m.set(t.assigneeId, (m.get(t.assigneeId) ?? 0) + 1);
    return m;
  }, [tickets]);

  const ticketOf = useCallback((id: string | undefined) => (id ? ticketMap.get(id) : undefined), [ticketMap]);
  const clientOf = useCallback((id: string) => clientMap.get(id), [clientMap]);
  const assetOf = useCallback((id: string) => assetMap.get(id), [assetMap]);
  const memberOf = useCallback((id: string | null | undefined) => (id ? memberMap.get(id) : undefined), [memberMap]);
  const deptOf = useCallback((id: string) => departments.find((d) => d.id === id), [departments]);
  const reporterOf = useCallback((t: Ticket) => userMap.get(t.reporterId), [userMap]);
  const policyOf = useCallback((clientId: string) => policyByClient.get(clientId) ?? policies[0], [policyByClient, policies]);
  const slaOf = useCallback((t: Ticket) => getSla(t, policyByClient.get(t.clientId) ?? policies[0], now), [policyByClient, policies, now]);
  const openLoad = useCallback((memberId: string) => loadMap.get(memberId) ?? 0, [loadMap]);
  const actorName = useCallback(
    (a: Actor) => (a.type === 'team' ? memberMap.get(a.id)?.name ?? 'NXS support' : a.type === 'client' ? userMap.get(a.id)?.name ?? 'Client' : 'System'),
    [memberMap, userMap],
  );

  /* ---------- Feedback ---------- */

  const toastSeq = useRef(0);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback<Store['toast']>(
    (message, opts) => {
      const id = ++toastSeq.current;
      setToasts((t) => [...t.slice(-2), { id, message, tone: opts?.tone ?? 'default', link: opts?.link }]);
      window.setTimeout(() => dismissToast(id), 5000);
    },
    [dismissToast],
  );

  // Events caused by the signed-in user are logged as already read, so the unread
  // badge only counts things that happened without them (such as SLA changes).
  const emit = useCallback((type: NotificationEventType, ticket: Ticket, detail?: string, unread = false, internalOnly = false) => {
    const { clients, team, notificationRules } = live.current;
    const out = dispatch(type, ticket, { clients, team, rules: notificationRules }, Date.now(), detail, !unread, internalOnly);
    setNotifications((n) => [out.notification, ...n].slice(0, 60));
    if (out.deliveries.length) setDeliveries((d) => [...out.deliveries, ...d].slice(0, 200));
  }, []);

  const commit = useCallback((next: Ticket) => {
    const list = live.current.tickets.map((t) => (t.id === next.id ? next : t));
    live.current.tickets = list;
    setTickets(list);
  }, []);
  const current = (id: string) => live.current.tickets.find((t) => t.id === id);

  /* ---------- SLA watcher: raises events when a running clock changes state ---------- */

  const seenSla = useRef<Map<string, SlaState> | null>(null);
  useEffect(() => {
    const first = seenSla.current == null;
    const seen = seenSla.current ?? new Map<string, SlaState>();
    seenSla.current = seen;
    for (const t of tickets) {
      if (!isOpen(t)) {
        seen.delete(t.id);
        continue;
      }
      const sla = getSla(t, policyByClient.get(t.clientId) ?? policies[0], now);
      const prev = seen.get(t.id);
      seen.set(t.id, sla.overall);
      if (first || prev === undefined || prev === sla.overall) continue;
      if (sla.overall === 'breached') emit('sla_breached', t, slaDetail(sla), true);
      else if (sla.overall === 'at_risk' && prev === 'within') emit('sla_approaching', t, slaDetail(sla), true);
    }
  }, [now, tickets, policyByClient, policies, emit]);

  /* ---------- Progress updates: the regular word the SLA promises ---------- */

  // While work moves (not New, not Blocker, not the client's turn), NXS posts
  // an update at the priority's cadence: when it should reach the next step
  // and when the fix is due. The client sees it in Updates and in their
  // notifications; staff see the fuller line and get it in theirs.
  useEffect(() => {
    const due: Ticket[] = [];
    for (const t of tickets) {
      if (!PROGRESS_STAGES.includes(t.status) || !t.severity) continue;
      const every = PROGRESS_EVERY_MINS[t.severity];
      if (!every) continue;
      const last = [...t.activity].reverse().find((a) => a.kind === 'progress' || a.kind === 'status' || a.kind === 'diagnosis');
      if (last && now - last.at < every * MIN_MS) continue;
      const policy = policyFor(live.current.clients, live.current.policies, t.clientId);
      const sla = getSla(t, policy, now);
      const since = [...t.activity].reverse().find((a) => a.kind === 'status')?.at ?? t.createdAt;
      const { client, staff } = progressUpdate(t.status, since, sla.resolution.due, now);
      const entry: Activity = { ...activity(now, { type: 'system' }, 'progress', client), staffText: staff };
      due.push({ ...t, activity: [...t.activity, entry] });
    }
    if (!due.length) return;
    const byId = new Map(due.map((t) => [t.id, t]));
    const list = live.current.tickets.map((t) => byId.get(t.id) ?? t);
    live.current.tickets = list;
    setTickets(list);
    for (const t of due) emit('progress_update', t, t.activity[t.activity.length - 1].staffText, true);
  }, [now, tickets, emit]);

  /* ---------- Ticket actions ---------- */

  const changeStatus = useCallback<Store['changeStatus']>(
    (id, to, opts) => {
      const t = current(id);
      if (!t || t.status === to) return false;
      if (!canTransition(t.status, to)) {
        toast(`${t.id} can't move from ${STATUS_LABEL[t.status]} to ${STATUS_LABEL[to]}.`, { tone: 'error' });
        return false;
      }
      if (NEEDS_ASSIGNEE.includes(to) && !t.assigneeId) {
        setDialog({ type: 'assign', ticketId: id, then: to });
        return false;
      }
      // Blocking says why, so blockers can be traced afterwards.
      if (to === 'blocked' && !opts?.reason?.trim()) {
        setDialog({ type: 'block', ticketId: id });
        return false;
      }
      // Resolving is the client's call: they approve the fix in the Client Portal.
      // From here it only happens by skipping that, so it needs a confirmed reason.
      if (to === 'resolved' && !opts?.reason?.trim()) {
        setDialog({ type: 'resolve', ticketId: id });
        return false;
      }
      // Starting work says what is wrong and how it will be fixed; the client sees it.
      if (t.status === 'new' && to === 'in_progress' && !(opts?.diagnosis?.issue.trim() && opts.diagnosis.fix.trim())) {
        setDialog({ type: 'start-work', ticketId: id });
        return false;
      }
      // The client gets the fix with a note on what changed and how to check it.
      if (to === 'waiting_approval' && !opts?.handoff?.note.trim()) {
        setDialog({ type: 'request-approval', ticketId: id });
        return false;
      }
      // Sending work back, or reopening it, says why: the next person needs to know.
      if (needsMoveNote(t.status, to) && !opts?.reason?.trim()) {
        setDialog({ type: 'move-note', ticketId: id, to });
        return false;
      }
      if (to === 'canceled') {
        if (!can('ticket.cancel')) {
          toast('Only administrators can cancel tickets.', { tone: 'error' });
          return false;
        }
        if (!opts?.reason?.trim()) {
          setDialog({ type: 'cancel', ticketId: id });
          return false;
        }
      }
      const at = Date.now();
      const next: Ticket = { ...t, status: to, updatedAt: at };
      const moved = `Status changed from ${STATUS_LABEL[t.status]} to ${STATUS_LABEL[to]}`;
      // Blocked and testing are NXS's own steps inside "In progress": moving
      // between them stays internal, so the client never sees or hears of it.
      const internal = portalStatus(t.status) === portalStatus(to);
      let entry: Activity;
      const extra: Activity[] = [];
      // Leaving Blocker clears the active blocker; entering it logs a new one.
      if (t.status === 'blocked') {
        const open = t.blockers[t.blockers.length - 1];
        if (open && open.clearedAt == null) {
          next.blockers = [...t.blockers.slice(0, -1), { ...open, clearedAt: at, clearedBy: me, clearNote: '' }];
          extra.push(activity(at + 1, me, 'blocker', `Blocker cleared after ${fmtDuration(at - open.at)}`, 'internal'));
        }
      }
      if (to === 'blocked') {
        next.blockers = [...next.blockers, { id: `blk-${at}`, details: opts!.reason!.trim(), by: me, at, clearedAt: null, clearedBy: null, clearNote: '' }];
        extra.push(activity(at + 1, me, 'blocker', `Blocker: ${opts!.reason!.trim()}`, 'internal'));
      }
      if (t.status === 'new' && to === 'in_progress') {
        const { issue, fix } = opts!.diagnosis!;
        next.diagnosis = { issue: issue.trim(), fix: fix.trim(), by: me, at };
        extra.push(activity(at + 1, me, 'diagnosis', `What we found: ${issue.trim()} How we’ll fix it: ${fix.trim()}`));
      }
      if (to === 'waiting_approval') {
        const { note, attachments } = opts!.handoff!;
        next.handoffs = [...t.handoffs, { id: `hof-${at}`, note: note.trim(), attachments, by: me, at }];
        extra.push(activity(at + 1, me, 'handoff', note.trim()));
      }
      // The reason for rework or a reopen stays with NXS, even when the move itself is visible.
      if (needsMoveNote(t.status, to)) {
        const reason = opts!.reason!.trim();
        next.moveNotes = [...t.moveNotes, { id: `mv-${at}`, from: t.status, to, reason, by: me, at }];
        extra.push(activity(at + 1, me, 'reason', `${moveLabel(t.status, to).title}: ${reason}`, 'internal'));
      }
      if (to === 'resolved') {
        next.resolvedAt = at;
        entry = activity(at, me, 'resolution', `Marked as resolved from ${STATUS_LABEL[t.status]}, without client approval. Reason: ${opts!.reason!.trim()}`);
      } else if (to === 'canceled') {
        const reason = opts!.reason!.trim();
        next.canceledAt = at;
        next.cancellation = { by: me, reason, at };
        entry = activity(at, me, 'cancellation', `Canceled. Reason: ${reason}`);
      } else {
        if (to === 'reopened') {
          next.resolvedAt = null;
          next.canceledAt = null;
          next.cancellation = null;
        }
        entry = activity(at, me, 'status', moved, internal ? 'internal' : 'client');
      }
      // Testing steps stay internal, but the client still hears, in plain words, that the fix moved on.
      const step = internal ? stepUpdate(t.status, to) : null;
      if (step) extra.push(activity(at + 2, me, 'progress', step));
      // Leaving New acknowledges the ticket to the client, which counts as the first response.
      if (!next.firstRespondedAt && to !== 'canceled') next.firstRespondedAt = at;
      next.activity = [...t.activity, entry, ...extra];
      commit(next);
      if (step) emit('progress_update', next, step);
      else emit(to === 'resolved' ? 'ticket_resolved' : to === 'canceled' ? 'ticket_canceled' : 'status_updated', next, to === 'canceled' ? opts!.reason!.trim() : undefined, false, internal);
      toast(`${t.id} moved to ${STATUS_LABEL[to]}`, { link: { to: `/tickets/${t.id}`, label: 'View' } });
      return true;
    },
    [can, commit, emit, me, toast],
  );

  const assignTicket = useCallback<Store['assignTicket']>(
    (id, memberId, then) => {
      const t = current(id);
      if (!t) return;
      if (!can('ticket.assign')) {
        toast('You do not have permission to assign tickets.', { tone: 'error' });
        return;
      }
      const at = Date.now();
      const { team } = live.current;
      const member = team.find((m) => m.id === memberId);
      const previous = team.find((m) => m.id === t.assigneeId);
      // There is always someone on a ticket: it can change hands, never go empty.
      if (!member) return;
      if (member.id === t.assigneeId) {
        if (then) changeStatus(id, then);
        return;
      }
      const entries: Activity[] = [];
      // Changing hands doesn't start the work; starting it is its own step.
      const next: Ticket = { ...t, assigneeId: member.id, updatedAt: at };
      const dept = departments.find((d) => d.id === member.departmentId)?.name ?? '';
      entries.push(
        activity(at, me, 'assignment', previous ? `Reassigned from ${previous.name} to ${member.name} (${member.level}, ${dept})` : `Assigned to ${member.name} (${member.level}, ${dept})`, 'internal'),
      );
      next.activity = [...t.activity, ...entries];
      commit(next);
      emit('ticket_assigned', next);
      toast(`${t.id} assigned to ${member.name}`, { link: { to: `/tickets/${t.id}`, label: 'View' } });
      if (then && then !== next.status) changeStatus(id, then);
    },
    [can, changeStatus, commit, departments, emit, me, toast],
  );

  const setSeverity = useCallback<Store['setSeverity']>(
    (id, severity) => {
      const t = current(id);
      if (!t || t.severity === severity) return;
      const at = Date.now();
      commit({
        ...t,
        severity,
        updatedAt: at,
        activity: [...t.activity, activity(at, me, 'severity', `Priority changed from ${priorityLabel(t.severity)} to ${SEVERITY_LABEL[severity]}`, 'internal')],
      });
      toast(`${t.id} is now ${SEVERITY_LABEL[severity]}. SLA targets updated.`);
    },
    [commit, me, toast],
  );


  /** The NXS member plotted on an asset: new tickets for it go straight to them. */
  const ownerOf = (assetId: string) => {
    const { assets, team } = live.current;
    const asset = assets.find((x) => x.id === assetId);
    return team.find((m) => m.id === asset?.ownerId);
  };
  const assignedOnCreate = (assetId: string, at: number): Activity[] => {
    const m = ownerOf(assetId);
    if (!m) return [];
    const dept = departments.find((d) => d.id === m.departmentId)?.name ?? '';
    return [activity(at + 1, { type: 'system' }, 'assignment', `Assigned to ${m.name} (${m.level}, ${dept}), who handles this asset`, 'internal')];
  };

  const createTicket = useCallback<Store['createTicket']>(
    (input) => {
      const { tickets } = live.current;
      const at = Date.now();
      const max = tickets.reduce((m, t) => Math.max(m, Number(t.id.slice(4))), 4000);
      const reporterName = live.current.clients.find((c) => c.id === input.clientId)?.users.find((u) => u.id === input.reporterId)?.name ?? 'the client';
      const ticket: Ticket = {
        id: `NXS-${max + 1}`,
        title: input.title.trim(),
        description: input.description.trim(),
        clientId: input.clientId,
        assetId: input.assetId,
        category: input.category,
        reporterId: input.reporterId,
        source: { channel: input.channel, loggedBy: currentUser.id },
        createdAt: at,
        updatedAt: at,
        status: 'new',
        severity: input.severity,
        assigneeId: ownerOf(input.assetId)?.id ?? null,
        firstRespondedAt: null,
        resolvedAt: null,
        canceledAt: null,
        cancellation: null,
        feedback: [],
        blockers: [],
        moveNotes: [],
        handoffs: [],
        attachments: input.attachments,
        activity: [activity(at, me, 'created', `Logged by NXS on behalf of ${reporterName}`), ...assignedOnCreate(input.assetId, at)],
      };
      const list = [...tickets, ticket];
      live.current.tickets = list;
      setTickets(list);
      emit('ticket_created', ticket);
      toast(`${ticket.id} created`, { link: { to: `/tickets/${ticket.id}`, label: 'View ticket' } });
      return ticket;
    },
    [emit, me, toast],
  );

  /* ---------- Client Portal ---------- */

  const nextTicketId = () => `NXS-${live.current.tickets.reduce((m, t) => Math.max(m, Number(t.id.slice(4))), 4000) + 1}`;

  const submitPortalTicket = useCallback<Store['submitPortalTicket']>(
    (input) => {
      const at = Date.now();
      const by: Actor = { type: 'client', id: input.reporterId };
      const ticket: Ticket = {
        id: nextTicketId(),
        title: input.title.trim(),
        description: input.description.trim(),
        clientId: input.clientId,
        assetId: input.assetId,
        category: input.category,
        reporterId: input.reporterId,
        source: { channel: 'portal', loggedBy: null },
        createdAt: at,
        updatedAt: at,
        status: 'new',
        severity: input.severity,
        assigneeId: ownerOf(input.assetId)?.id ?? null,
        firstRespondedAt: null,
        resolvedAt: null,
        canceledAt: null,
        cancellation: null,
        feedback: [],
        blockers: [],
        moveNotes: [],
        handoffs: [],
        attachments: input.attachments,
        activity: [activity(at, by, 'created', 'Submitted from the Client Portal'), ...assignedOnCreate(input.assetId, at)],
      };
      const list = [...live.current.tickets, ticket];
      live.current.tickets = list;
      setTickets(list);
      // NXS did not do this, so it lands unread in the team's notifications.
      emit('ticket_created', ticket, undefined, true);
      return ticket;
    },
    [emit],
  );

  const reviewFix = useCallback<Store['reviewFix']>(
    (ticketId, userId, decision, note, attachments = []) => {
      const t = current(ticketId);
      // Anyone signed in for the ticket's brand answers (one account per brand for now), only while it is in review.
      const sameClient = live.current.clients.find((c) => c.id === t?.clientId)?.users.some((u) => u.id === userId);
      if (!t || t.status !== 'waiting_approval' || !sameClient) return false;
      if (decision === 'declined' && !note.trim()) return false;
      const at = Date.now();
      const by: Actor = { type: 'client', id: userId };
      const feedback = { id: `fb-n${at.toString(36)}`, at, by: userId, decision, note: note.trim(), attachments };
      const next: Ticket =
        decision === 'approved'
          ? {
              ...t,
              status: 'resolved',
              resolvedAt: at,
              updatedAt: at,
              feedback: [...t.feedback, feedback],
              activity: [...t.activity, activity(at, by, 'resolution', 'Approved the fix in the Client Portal. Status changed from Waiting for approval to Resolved')],
            }
          : {
              ...t,
              status: 'reopened',
              resolvedAt: null,
              updatedAt: at,
              feedback: [...t.feedback, feedback],
              activity: [...t.activity, activity(at, by, 'status', 'Declined the fix. Status changed from Waiting for approval to Reopened')],
            };
      commit(next);
      emit(decision === 'approved' ? 'ticket_resolved' : 'status_updated', next, decision === 'declined' ? note.trim() : undefined, true);
      return true;
    },
    [commit, emit],
  );


  /* ---------- Clients, assets, SLA, team ---------- */

  const setAssetStatus = useCallback<Store['setAssetStatus']>((id, status) => {
    setAssets((list) => list.map((a) => (a.id === id ? { ...a, status, statusChangedAt: Date.now(), statusNote: status === a.status ? a.statusNote : '' } : a)));
  }, []);
  const addClient = useCallback<Store['addClient']>(
    (input) => {
      const { clients, policies } = live.current;
      const name = input.name.trim();
      const words = name.split(/\s+/).filter(Boolean);
      const initials = (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
      // A short code and a URL id, both unique among the clients already here.
      const unique = (base: string, taken: string[]) => {
        let out = base;
        for (let n = 2; taken.includes(out); n++) out = `${base}${n}`;
        return out;
      };
      const code = unique(name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'CLT', clients.map((c) => c.code));
      const id = unique(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client', clients.map((c) => c.id));
      const tone = LOGO_TONES[clients.length % LOGO_TONES.length];
      const client: Client = {
        id,
        name,
        code,
        industry: input.industry.trim(),
        city: '',
        logo: { initials, ...tone, ...(input.logoImage ? { image: input.logoImage } : {}) },
        contact: { name: '', title: '', email: '', phone: '' },
        slaPolicyId: (policies.find((p) => p.isDefault) ?? policies[0]).id,
        accountManagerId: currentUser.id,
        since: new Date().toISOString().slice(0, 10),
        users: [],
      };
      setClients((list) => [...list, client]);
      return client;
    },
    [currentUser.id],
  );
  const addClientUser = useCallback<Store['addClientUser']>((clientId, input) => {
    const user: ClientUser = { id: `cu-${clientId}-${Date.now().toString(36)}`, clientId, role: 'client_user', ...input };
    setClients((list) => list.map((c) => (c.id === clientId ? { ...c, users: [...c.users, user] } : c)));
    return user;
  }, []);
  const addAsset = useCallback<Store['addAsset']>((clientId, input) => {
    const { clients, assets } = live.current;
    const code = clients.find((c) => c.id === clientId)?.code ?? clientId.toUpperCase();
    const n = assets.filter((a) => a.clientId === clientId).length + 1;
    // A new asset has no reading yet: its status waits for the first check.
    const asset: Asset = {
      id: `AST-${code}-${String(n).padStart(2, '0')}`,
      clientId,
      ...input,
      status: 'unknown',
      statusNote: 'Waiting for the first check.',
      statusChangedAt: Date.now(),
      uptime30d: null,
    };
    setAssets((list) => [...list, asset]);
    return asset;
  }, []);
  const updatePolicyTarget = useCallback<Store['updatePolicyTarget']>((policyId, severity, patch) => {
    setPolicies((list) => list.map((p) => (p.id === policyId ? { ...p, targets: { ...p.targets, [severity]: { ...p.targets[severity], ...patch } } } : p)));
  }, []);
  const updateProfile = useCallback<Store['updateProfile']>((patch) => {
    setTeam((list) => list.map((m) => (m.id === seed.CURRENT_USER_ID ? { ...m, ...patch } : m)));
  }, []);
  const setAvailability = useCallback<Store['setAvailability']>((memberId, availability) => {
    setTeam((list) => list.map((m) => (m.id === memberId ? { ...m, availability } : m)));
  }, []);

  /* ---------- Notifications ---------- */

  const markRead = useCallback((id: string) => setNotifications((n) => n.map((x) => (x.id === id ? { ...x, read: true } : x))), []);
  const markAllRead = useCallback(() => setNotifications((n) => n.map((x) => ({ ...x, read: true }))), []);
  const updateNotificationRule = useCallback<Store['updateNotificationRule']>((event, patch) => {
    setNotificationRules((list) => list.map((r) => (r.event === event ? { ...r, ...patch } : r)));
  }, []);
  const sendTestMessage = useCallback<Store['sendTestMessage']>(
    (event) => {
      const { tickets, clients, team, notificationRules } = live.current;
      const sample = [...tickets].reverse().find((t) => isOpen(t) && t.assigneeId) ?? tickets[tickets.length - 1];
      const rules = notificationRules.map((r) => (r.event === event ? { ...r, enabled: true } : r));
      const out = dispatch(event, sample, { clients, team, rules }, Date.now(), event.startsWith('sla') ? 'Test message' : undefined);
      setDeliveries((d) => [...out.deliveries, ...d]);
      toast(out.deliveries.length ? `Test logged for ${out.deliveries.length} recipient${out.deliveries.length > 1 ? 's' : ''}` : 'Choose at least one recipient first', {
        tone: out.deliveries.length ? 'default' : 'error',
      });
    },
    [toast],
  );

  const value: Store = {
    updateProfile,
    portalSeenAt,
    markPortalSeen,
    now,
    currentUser,
    can,
    tickets,
    clients,
    assets,
    team,
    departments,
    policies,
    notifications,
    notificationRules,
    deliveries,
    ticketOf,
    clientOf,
    assetOf,
    memberOf,
    deptOf,
    reporterOf,
    policyOf,
    slaOf,
    actorName,
    openLoad,
    createTicket,
    changeStatus,
    assignTicket,
    setSeverity,
    submitPortalTicket,
    reviewFix,
    setAssetStatus,
    addClient,
    addClientUser,
    addAsset,
    updatePolicyTarget,
    setAvailability,
    markRead,
    markAllRead,
    updateNotificationRule,
    sendTestMessage,
    dialog,
    setDialog,
    toasts,
    toast,
    dismissToast,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
