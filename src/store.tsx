import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Activity, Actor, AppNotification, CodeFix, CommentOn, Asset, AssetStatus, Attachment, Availability, Category, Client, ClientUser, DeliveryRecord, Department, FullRcaContent, NotificationEventType, NotificationRule, Permission, ReleaseDraft, Role, Severity, SlaPolicy, SlaTarget, TeamMember, Ticket, TicketChannel, TicketStatus, AssetCategory, AssetMonitor, SlaExclusionKind, TicketPlan } from './types';
import * as seed from './data/seed';
import { useAuth } from './auth';
import { buildInitialTickets } from './data/tickets';
import { CATEGORY_LABEL, NEEDS_ASSIGNEE, SEVERITY_LABEL, priorityLabel, STATUS_LABEL, canTransition, moveBlockedBy, hasPermission, isOpen, moveLabel, needsMoveNote, portalStatus, SLA_EXCLUSION_LABEL, TASK_TYPE_LABEL } from './lib/domain';
import { fmtDuration } from './lib/format';
import { autoPlan, taskTypeFor } from './lib/plan';
import { analyze, fullRcaDraftOf, problemOf, responseDraftOf } from './lib/rcaAi';
import { codeFixFor } from './lib/codeFix';
import { imageTagOf, releaseNotesOf } from './lib/release';
import { routeTo, guessAsset, guessSeverity, pmFor, testerFor } from './lib/intake';
import { PROGRESS_EVERY_MINS, PROGRESS_STAGES, progressUpdate, stepUpdate } from './lib/assist';

const MIN_MS = 60_000;
import { dispatch, type NotifyContext } from './lib/notifications';
import { getSla, type SlaState, type TicketSla } from './lib/sla';

/** NXS logging a ticket for a client: which client, which of their PICs reported it, and what happened. The AI fills in the rest. */
export interface NewTicketInput {
  clientId: string;
  reporterId: string;
  /** Where the client reported the issue. Tickets logged here never come from the portal. */
  channel: Exclude<TicketChannel, 'portal'>;
  /** Picked by whoever raises it, from the categories their PIC may raise. Not the AI's, not the PM's. */
  category: Category;
  title: string;
  description: string;
  attachments: Attachment[];
}


/** A ticket a client user submits themselves in the Client Portal. */
/** A client raising a ticket: its category and what happened. The AI fills in the asset, the priority and who works on it. */
export interface PortalTicketInput {
  clientId: string;
  reporterId: string;
  category: Category;
  title: string;
  description: string;
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
  | { type: 'sla-exclusion'; ticketId: string }
  | { type: 'unblock'; ticketId: string }
  | { type: 'assign'; ticketId: string; then?: TicketStatus }
  | { type: 'add-client' }
  | { type: 'add-member' }
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
  categories: Category[];
}
export interface NewTeamMemberInput {
  name: string;
  title: string;
  email: string;
  role: Role;
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

/** A short message in the top-right corner. Success for something done, error for something that failed,
 *  warning for something to look at, info for a change to know about. */
export type ToastTone = 'success' | 'error' | 'warning' | 'info';
export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
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
  changeStatus: (id: string, to: TicketStatus, opts?: { reason?: string; proof?: Attachment[]; handoff?: { note: string; attachments: Attachment[]; imageTag?: string; proofNote?: string } }) => boolean;
  /** Save the initial RCA (the likely cause and the plan; for P1 also when it will be fixed). The client sees it. */
  saveInitialRca: (id: string, rca: { problem?: string; issue: string; fix: string; fixBy?: number }) => void;
  /** Keep the team's edits to the AI's initial RCA draft, before it is shared. */
  saveRcaDraft: (id: string, draft: { problem?: string; issue: string; fix: string; hours?: number }) => void;
  /** Record a question to the RCA assistant and its answer. */
  addRcaExchange: (id: string, exchange: { question: string; answer: string; apply?: { issue?: string; fix?: string } }) => void;
  /** Keep the team's edit of the AI's initial response. */
  saveResponseDraft: (id: string, text: string) => void;
  /** Send the initial response to the client (the team's edit, or the AI's). It is the first response. */
  sendInitialResponse: (id: string) => void;
  /** Keep the team's edit of the full RCA (by hand or by asking the AI). Null goes back to the AI's draft. */
  saveFullRcaDraft: (id: string, content: FullRcaContent | null) => void;
  /** The AI's code fix as it stands: the developer's revisions if any, else its first draft. */
  codeFixOf: (t: Ticket) => CodeFix;
  /** Keep the AI's revision of the code fix. */
  saveCodeFix: (id: string, fix: CodeFix) => void;
  /** The developer approves the fix: it goes on staging and the ticket waits for testing. */
  approveFix: (id: string) => void;
  /** QA passed the fix on staging, with their proof (text and screenshots). That merges the fix: the AI builds the image and writes the release notes. */
  passTest: (id: string, note: string, proof: Attachment[]) => void;
  /** The AI's release (image and notes) as it reads now: as the developer last left it, or freshly made from the merge. */
  releaseOf: (t: Ticket) => ReleaseDraft;
  /** Keep the AI's revision of the release. */
  saveRelease: (id: string, release: ReleaseDraft) => void;
  /** Mark (or unmark) a ticket as a security or data issue, which a full RCA covers. */
  setSecurityIssue: (id: string, on: boolean) => void;
  /** The AI's drafts, as they read now: the initial response, and what the full RCA document covers. */
  responseDraftFor: (t: Ticket) => string;
  fullRcaDraftFor: (t: Ticket) => FullRcaContent;
  /** Post a comment. NXS staff post as themselves; `by` is set for a client user posting from the portal. */
  addComment: (id: string, thread: 'client' | 'internal', text: string, by?: Actor, on?: CommentOn, replyingTo?: string) => void;
  /** When the signed-in client last opened their notifications, per client. */
  portalSeenAt: Record<string, number>;
  markPortalSeen: (clientId: string) => void;
  /** Hand a ticket to someone. Admins and leads can; so can whoever holds it now, or its QA. A note goes to the internal comments. */
  assignTicket: (id: string, memberId: string | null, then?: TicketStatus, note?: string) => void;
  /** Change the QA who checks and tests it. */
  setTester: (id: string, memberId: string) => void;
  setCategory: (id: string, category: Category) => void;
  setAsset: (id: string, assetId: string) => void;
  /** The PM confirms the properties the AI set on a new ticket: it moves to Not started, for QA to check. */
  confirmTriage: (id: string) => void;
  /** QA, then the developer, aren't sure it's an issue: it goes up a layer, with what they checked. */
  escalateIssueCheck: (id: string, note: string, proof: Attachment[]) => void;
  /** The PM isn't sure it's an issue: the business team checks whether it's a feature request. */
  markFeatureRequest: (id: string) => void;
  /** The business team's answer: a feature request is canceled with the reason; an issue goes back to the PM. */
  settleFeatureCheck: (id: string, verdict: 'feature' | 'issue', reason?: string) => void;
  /** The developer sends the initial RCA (the AI's draft, with their edits) to the client. */
  sendInitialRca: (id: string) => void;
  setSeverity: (id: string, severity: Severity) => void;
  /** Mark a ticket outside the SLA for one of its exclusions, or count it again with null. */
  setSlaExclusion: (id: string, exclusion: { kind: SlaExclusionKind; note: string } | null) => void;
  /** Change the team's planning on a ticket: sprint, task type, story points, expected day. Undefined clears a field. */
  planTicket: (id: string, patch: Partial<TicketPlan>) => void;

  /* Client Portal: actions taken by a client user, recorded as theirs. */
  submitPortalTicket: (input: PortalTicketInput) => Ticket;
  /** The client's answer to a fix ready to deploy: approving resolves it, declining sends it back to Not started. */
  reviewFix: (ticketId: string, userId: string, decision: 'approved' | 'declined', note: string, attachments?: Attachment[]) => boolean;

  setAssetStatus: (id: string, status: AssetStatus) => void;
  addClient: (input: NewClientInput) => Client;
  addClientUser: (clientId: string, input: NewClientUserInput) => ClientUser;
  /** Which categories a client PIC can raise tickets for. */
  setUserCategories: (clientId: string, userId: string, categories: Category[]) => void;
  /** Who at NXS runs a client: its PM, its QA, and its frontend and backend developers. */
  setClientCrew: (clientId: string, patch: Partial<Pick<Client, 'accountManagerId' | 'testerId' | 'devs'>>) => void;
  /** Add someone to the NXS team. */
  addTeamMember: (input: NewTeamMemberInput) => TeamMember;
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
  toast: (message: string, opts?: { tone?: ToastTone; link?: Toast['link'] }) => void;
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
  const markPortalSeen = useCallback((clientId: string) => setPortalSeenAt((m) => ({ ...m, [clientId]: seed.clock() })), []);
  const [notificationRules, setNotificationRules] = useState(seed.notificationRules);
  const [initialFeed] = useState(() => seedNotifications(tickets, seed.clock()));
  const [notifications, setNotifications] = useState(initialFeed.notifications);
  const [deliveries, setDeliveries] = useState(initialFeed.deliveries);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const departments = seed.departments;

  // Latest state for use inside actions, so several actions can run in one tick.
  const live = useRef({ tickets, clients, assets, team, policies, notificationRules });
  live.current = { tickets, clients, assets, team, policies, notificationRules };

  // Whoever signed in with their work email; anyone else opens as the default PIC.
  const { session } = useAuth('team');
  const currentUser = team.find((m) => m.email === session?.email) ?? team.find((m) => m.id === seed.CURRENT_USER_ID)!;
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
      const tone = opts?.tone ?? 'success';
      setToasts((t) => [...t.slice(-2), { id, message, tone, link: opts?.link }]);
      // Errors and warnings stay a little longer: they ask for something.
      window.setTimeout(() => dismissToast(id), tone === 'error' || tone === 'warning' ? 7000 : 5000);
    },
    [dismissToast],
  );

  // Events caused by the signed-in user are logged as already read, so the unread
  // badge only counts things that happened without them (such as SLA changes).
  const emit = useCallback((type: NotificationEventType, ticket: Ticket, detail?: string, unread = false, internalOnly = false) => {
    const { clients, team, notificationRules } = live.current;
    const out = dispatch(type, ticket, { clients, team, rules: notificationRules }, seed.clock(), detail, !unread, internalOnly);
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

  const responseDraftFor = useCallback<Store['responseDraftFor']>((t) => {
    const { assets, clients, policies } = live.current;
    const asset = assets.find((a) => a.id === t.assetId);
    const reporter = clients.find((c) => c.id === t.clientId)?.users.find((u) => u.id === t.reporterId);
    const sla = getSla(t, policyFor(clients, policies, t.clientId), seed.clock());
    return t.responseDraft ?? responseDraftOf(t, asset?.name ?? 'your asset', reporter?.name.split(' ')[0] ?? 'there', sla.initialRca.due);
  }, []);

  const fullRcaDraftFor = useCallback<Store['fullRcaDraftFor']>((t) => {
    const { assets, clients } = live.current;
    const client = clients.find((c) => c.id === t.clientId);
    const reporter = client?.users.find((u) => u.id === t.reporterId);
    if (t.fullRcaDraft) return t.fullRcaDraft;
    return fullRcaDraftOf(t, { asset: assets.find((a) => a.id === t.assetId), clientName: client?.company ?? client?.name ?? 'the client', reporterName: reporter?.name ?? 'the client' });
  }, []);

  const changeStatus = useCallback<Store['changeStatus']>(
    (id, to, opts) => {
      const t = current(id);
      if (!t || t.status === to) return false;
      if (!canTransition(t.status, to)) {
        toast(`${t.id} can't move from ${STATUS_LABEL[t.status]} to ${STATUS_LABEL[to]}.`, { tone: 'error' });
        return false;
      }
      const missing = moveBlockedBy(t, to);
      if (missing) {
        toast(`${t.id} can't move to ${STATUS_LABEL[to]} yet. ${missing}`, { tone: 'error' });
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
      const clientApproved = t.status === 'ready_to_deploy' && t.feedback[t.feedback.length - 1]?.decision === 'approved' && (t.feedback[t.feedback.length - 1].at >= (t.handoffs[t.handoffs.length - 1]?.at ?? 0));
      if (to === 'resolved' && !clientApproved && !opts?.reason?.trim()) {
        setDialog({ type: 'resolve', ticketId: id });
        return false;
      }
      // Testing passed: the client gets a note, from the RCA and the test, to approve it going live.
      if (to === 'ready_to_deploy' && !opts?.handoff) {
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
      const at = seed.clock();
      const next: Ticket = { ...t, status: to, updatedAt: at };
      // Out of New, from anywhere (the button, the menu, the board): the PM confirms the AI's properties.
      const confirming = t.status === 'new' && to !== 'canceled';
      const moved = `Status changed from ${STATUS_LABEL[t.status]} to ${STATUS_LABEL[to]}`;
      // Blocked and testing are NXS's own steps inside "In progress": moving
      // between them stays internal, so the client never sees or hears of it.
      const internal = portalStatus(t.status) === portalStatus(to);
      let entry: Activity;
      const extra: Activity[] = [];
      // Leaving Blocked clears the active blocker; entering it logs a new one.
      if (t.status === 'blocked') {
        const open = t.blockers[t.blockers.length - 1];
        if (open && open.clearedAt == null) {
          const how = opts?.reason?.trim() ?? '';
          next.blockers = [...t.blockers.slice(0, -1), { ...open, clearedAt: at, clearedBy: me, clearNote: how }];
          extra.push(activity(at + 1, me, 'blocker', `Blocker cleared after ${fmtDuration(at - open.at)}${how ? `: ${how}` : ''}`, 'internal'));
        }
      }
      // Back to work: the test and the release built from it no longer stand.
      if (to === 'in_progress') {
        next.testResult = undefined;
        next.release = undefined;
      }
      if (to === 'blocked') {
        next.blockers = [...next.blockers, { id: `blk-${at}`, details: opts!.reason!.trim(), by: me, at, clearedAt: null, clearedBy: null, clearNote: '', from: t.status }];
        extra.push(activity(at + 1, me, 'blocker', `Blocker: ${opts!.reason!.trim()}`, 'internal'));
      }
      if (to === 'ready_to_deploy') {
        const { note, attachments, imageTag, proofNote } = opts!.handoff!;
        next.handoffs = [...t.handoffs, { id: `hof-${at}`, note: note.trim(), proofNote: proofNote?.trim() || undefined, attachments, imageTag, by: me, at }];
        extra.push(activity(at + 1, me, 'handoff', imageTag ? `Sent ${imageTag} to the client to approve the deploy` : 'Sent the fix to the client to deploy'));
      }
      if (confirming) {
        const dev = live.current.team.find((m) => m.id === t.assigneeId);
        if (t.triage) next.triage = { ...t.triage, confirmedAt: at, confirmedBy: me };
        extra.push(activity(at + 1, me, 'assignment', `Reviewed the AI's properties: ${dev?.name ?? 'the team'} develops it`, 'internal'));
      }
      // The reason for rework or a reopen stays with NXS, even when the move itself is visible.
      if (needsMoveNote(t.status, to)) {
        const reason = opts!.reason!.trim();
        next.moveNotes = [...t.moveNotes, { id: `mv-${at}`, from: t.status, to, reason, by: me, at }];
        extra.push(activity(at + 1, me, 'reason', `${moveLabel(t.status, to).title}: ${reason}`, 'internal'));
      }
      if (to === 'resolved') {
        next.resolvedAt = at;
        entry = clientApproved
          ? activity(at, me, 'resolution', 'Deployed. Status changed from Ready to deploy to Resolved')
          : activity(at, me, 'resolution', `Marked as resolved from ${STATUS_LABEL[t.status]}, without client approval. Reason: ${opts!.reason!.trim()}`);
      } else if (to === 'canceled') {
        const reason = opts!.reason!.trim();
        next.canceledAt = at;
        next.cancellation = { by: me, reason, at, ...(opts?.proof?.length ? { proof: opts.proof } : {}) };
        entry = activity(at, me, 'cancellation', `Canceled. Reason: ${reason}`);
      } else {
        if (to === 'in_progress' && (t.status === 'resolved' || t.status === 'canceled')) {
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
      // Who has it now: QA while it's checked or tested, the PM while it's new, the client while a deploy waits on them, else the developer.
      const { team: crew, clients: all } = live.current;
      const owner = all.find((c) => c.id === next.clientId);
      const approvedNow = to === 'ready_to_deploy' && next.feedback[next.feedback.length - 1]?.decision === 'approved' && next.feedback[next.feedback.length - 1].at >= (next.handoffs[next.handoffs.length - 1]?.at ?? 0);
      const holder =
        to === 'resolved' || to === 'canceled'
          ? undefined
          : to === 'new'
            ? crew.find((m) => m.id === owner?.accountManagerId)?.name
            : to === 'not_started' || to === 'waiting_testing' || to === 'on_testing'
              ? crew.find((m) => m.id === next.testerId)?.name
              : to === 'ready_to_deploy' && !approvedNow
                ? owner?.users.find((u) => u.id === next.reporterId)?.name
                : crew.find((m) => m.id === next.assigneeId)?.name;
      toast(`${t.id} moved to ${STATUS_LABEL[to]}${holder ? ` · now with ${holder.split(' ')[0]}` : ''}`, { tone: to === 'canceled' ? 'info' : 'success', link: { to: `/tickets/${t.id}`, label: 'View' } });
      return true;
    },
    [can, commit, emit, me, toast],
  );

  const codeFixOf = useCallback<Store['codeFixOf']>((t) => {
    if (t.codeFix) return t.codeFix;
    const asset = live.current.assets.find((a) => a.id === t.assetId);
    return codeFixFor(t, asset?.category, t.diagnosis?.fix ?? t.title);
  }, []);

  const approveFix = useCallback<Store['approveFix']>(
    (id) => {
      const t = current(id);
      if (!t) return;
      const at = seed.clock();
      const fix = { ...codeFixOf(t), stagedAt: at, stagedBy: me };
      commit({ ...t, codeFix: fix, activity: [...t.activity, activity(at, me, 'progress', `Approved the AI’s fix and put it on staging: ${fix.branch}`, 'internal')] });
      changeStatus(id, 'waiting_testing');
    },
    [changeStatus, codeFixOf, commit, me],
  );

  const releaseOf = useCallback<Store['releaseOf']>(
    (t) => {
      if (t.release) return t.release;
      const asset = live.current.assets.find((a) => a.id === t.assetId);
      const fix = codeFixOf(t);
      const mergedAt = t.testResult?.at ?? fix.stagedAt ?? t.updatedAt;
      return { imageTag: imageTagOf(fix.repo, t.id, mergedAt), notes: releaseNotesOf(t, asset?.name ?? 'the asset', ''), mergedAt };
    },
    [codeFixOf],
  );

  const passTest = useCallback<Store['passTest']>(
    (id, note, proof) => {
      const t = current(id);
      if (!t) return;
      const at = seed.clock();
      // Passing merges the fix; the AI then builds the image and writes the release notes from the RCA and the fix.
      const fix = codeFixOf(t);
      const asset = live.current.assets.find((a) => a.id === t.assetId);
      const release: ReleaseDraft = { imageTag: imageTagOf(fix.repo, t.id, at), notes: releaseNotesOf(t, asset?.name ?? 'the asset', ''), mergedAt: at };
      commit({
        ...t,
        testResult: { at, by: me, note: note.trim(), proof },
        release,
        updatedAt: at,
        activity: [
          ...t.activity,
          activity(at, me, 'progress', `Testing passed on staging${note.trim() ? `: ${note.trim()}` : ''}`, 'internal'),
          activity(at + 1, { type: 'system' }, 'progress', `Merged ${fix.branch}. The AI built ${release.imageTag} and wrote the release notes.`, 'internal'),
        ],
      });
      changeStatus(id, 'qa_passed');
    },
    [changeStatus, codeFixOf, commit, me],
  );

  const saveRelease = useCallback<Store['saveRelease']>(
    (id, release) => {
      const t = current(id);
      if (t) commit({ ...t, release });
    },
    [commit],
  );

  const setSecurityIssue = useCallback<Store['setSecurityIssue']>(
    (id, on) => {
      const t = current(id);
      if (t) commit({ ...t, securityIssue: on });
    },
    [commit],
  );

  const assignTicket = useCallback<Store['assignTicket']>(
    (id, memberId, then, note) => {
      const t = current(id);
      if (!t) return;
      // Whoever holds the ticket can hand it on (it may not be their kind of work), and so can its QA.
      const holds = t.assigneeId === currentUser.id || t.testerId === currentUser.id;
      if (!can('ticket.assign') && !holds) {
        toast('You do not have permission to assign tickets.', { tone: 'error' });
        return;
      }
      const at = seed.clock();
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
      entries.push(activity(at, me, 'assignment', previous ? `Reassigned from ${previous.name} to ${member.name}` : `Assigned to ${member.name}`, 'internal'));
      next.activity = [...t.activity, ...entries];
      // The why lives in the internal comments, where the team already talks about the ticket.
      if (note?.trim()) next.comments = [...t.comments, { id: `cmt-${at}`, thread: 'internal', by: me, at, text: note.trim() }];
      commit(next);
      emit('ticket_assigned', next);
      toast(`${t.id} assigned to ${member.name}`, { link: { to: `/tickets/${t.id}`, label: 'View' } });
      if (then && then !== next.status) changeStatus(id, then);
    },
    [can, changeStatus, commit, currentUser.id, emit, me, toast],
  );

  const setSeverity = useCallback<Store['setSeverity']>(
    (id, severity) => {
      const t = current(id);
      if (!t || t.severity === severity) return;
      const at = seed.clock();
      commit({
        ...t,
        severity,
        updatedAt: at,
        activity: [...t.activity, activity(at, me, 'severity', `Priority changed from ${priorityLabel(t.severity)} to ${SEVERITY_LABEL[severity]}`, 'internal')],
      });
      toast(`${t.id} is now ${SEVERITY_LABEL[severity]}. SLA targets updated.`, { tone: 'info' });
    },
    [commit, me, toast],
  );

  const setTester = useCallback<Store['setTester']>(
    (id, memberId) => {
      const t = current(id);
      const member = live.current.team.find((m) => m.id === memberId);
      if (!t || !member || t.testerId === memberId) return;
      const at = seed.clock();
      const previous = live.current.team.find((m) => m.id === t.testerId);
      commit({ ...t, testerId: memberId, updatedAt: at, activity: [...t.activity, activity(at, me, 'assignment', previous ? `Tester changed from ${previous.name} to ${member.name}` : `${member.name} will test it`, 'internal')] });
      toast(`${member.name} tests ${t.id}`);
    },
    [commit, me, toast],
  );

  const setCategory = useCallback<Store['setCategory']>(
    (id, category) => {
      const t = current(id);
      if (!t || t.category === category) return;
      const at = seed.clock();
      commit({ ...t, category, updatedAt: at, activity: [...t.activity, activity(at, me, 'severity', `Category changed from ${CATEGORY_LABEL[t.category].replace(' issue', '')} to ${CATEGORY_LABEL[category].replace(' issue', '')}`, 'internal')] });
    },
    [commit, me],
  );

  const setAsset = useCallback<Store['setAsset']>(
    (id, assetId) => {
      const t = current(id);
      const asset = live.current.assets.find((a) => a.id === assetId);
      if (!t || !asset || t.assetId === assetId) return;
      const at = seed.clock();
      const before = live.current.assets.find((a) => a.id === t.assetId);
      commit({ ...t, assetId, updatedAt: at, activity: [...t.activity, activity(at, me, 'severity', `Asset changed from ${before?.name ?? 'none'} to ${asset.name}`, 'internal')] });
    },
    [commit, me],
  );

  const confirmTriage = useCallback<Store['confirmTriage']>((id) => void changeStatus(id, 'not_started'), [changeStatus]);

  const escalateIssueCheck = useCallback<Store['escalateIssueCheck']>(
    (id, note, proof) => {
      const t = current(id);
      if (!t || t.status !== 'not_started') return;
      const unsure = t.issueCheck?.unsure ?? [];
      if (unsure.length >= 2) return;
      const at = seed.clock();
      const team = live.current.team;
      const to = unsure.length === 0 ? team.find((m) => m.id === t.assigneeId) : team.find((m) => /chief technology officer/i.test(m.title));
      commit({
        ...t,
        issueCheck: { unsure: [...unsure, { by: me, at, note: note.trim(), proof }] },
        updatedAt: at,
        activity: [...t.activity, activity(at, me, 'reason', `Not sure it’s an issue, so ${to?.name ?? 'the next person'} checks it. What was checked: ${note.trim()}`, 'internal')],
      });
      toast(`${t.id} sent to ${to?.name.split(' ')[0] ?? 'the next person'} to check`, { tone: 'info' });
    },
    [commit, me, toast],
  );

  const markFeatureRequest = useCallback<Store['markFeatureRequest']>(
    (id) => {
      const t = current(id);
      if (!t || t.status !== 'new') return;
      const at = seed.clock();
      commit({
        ...t,
        featureCheck: { by: me, at },
        updatedAt: at,
        activity: [...t.activity, activity(at, me, 'reason', 'Marked as a possible feature request and sent to the business team', 'internal')],
      });
      toast(`${t.id} sent to the business team`, { tone: 'info' });
    },
    [commit, me, toast],
  );

  const settleFeatureCheck = useCallback<Store['settleFeatureCheck']>(
    (id, verdict, reason) => {
      const t = current(id);
      if (!t?.featureCheck || t.featureCheck.result) return;
      const at = seed.clock();
      const result = { verdict, by: me, at, ...(reason?.trim() ? { reason: reason.trim() } : {}) };
      if (verdict === 'feature') {
        commit({ ...t, featureCheck: { ...t.featureCheck, result } });
        changeStatus(id, 'canceled', { reason: reason!.trim() });
        return;
      }
      commit({
        ...t,
        featureCheck: { ...t.featureCheck, result },
        updatedAt: at,
        activity: [...t.activity, activity(at, me, 'reason', 'Business team: it’s an issue, not a feature request. Back to the PM to confirm', 'internal')],
      });
      toast(`${t.id} is an issue, back with the PM`);
    },
    [commit, changeStatus, me, toast],
  );

  const sendInitialRca = useCallback<Store['sendInitialRca']>(
    (id) => {
      const t = current(id);
      if (!t || t.diagnosis) return;
      const at = seed.clock();
      const asset = live.current.assets.find((a) => a.id === t.assetId);
      const draft = t.rcaDraft ?? analyze(t, asset?.name ?? 'the asset', live.current.tickets);
      const problem = t.rcaDraft?.problem ?? problemOf(t, asset?.name ?? 'the asset');
      // P1's fix time is set in its initial RCA; P2 and P3 follow the SLA.
      const fixBy = t.severity === 'critical' && t.rcaDraft?.hours ? t.createdAt + t.rcaDraft.hours * seed.HOUR : undefined;
      const next: Ticket = {
        ...t,
        diagnosis: { problem, issue: draft.issue, fix: draft.fix, fixBy, by: me, at },
        updatedAt: at,
        activity: [...t.activity, activity(at, me, 'diagnosis', `The issue: ${problem} What we found: ${draft.issue} How we’ll fix it: ${draft.fix}`)],
      };
      commit(next);
      emit('progress_update', next, 'Initial RCA Report sent');
      toast(`Initial RCA Report sent on ${t.id}`);
    },
    [commit, emit, me, toast],
  );

  const setSlaExclusion = useCallback<Store['setSlaExclusion']>(
    (id, exclusion) => {
      const t = current(id);
      if (!t) return;
      const at = seed.clock();
      commit({
        ...t,
        slaExclusion: exclusion ? { ...exclusion, note: exclusion.note.trim(), by: me, at } : undefined,
        updatedAt: at,
        activity: [
          ...t.activity,
          activity(at, me, 'exclusion', exclusion ? `Marked outside the SLA: ${SLA_EXCLUSION_LABEL[exclusion.kind]}. ${exclusion.note.trim()}` : 'Counted against the SLA again', 'internal'),
        ],
      });
      toast(exclusion ? `${t.id} is outside the SLA` : `${t.id} counts against the SLA again`, { tone: exclusion ? 'warning' : 'info' });
    },
    [commit, me, toast],
  );


  const saveInitialRca = useCallback<Store['saveInitialRca']>(
    (id, rca) => {
      const t = current(id);
      if (!t) return;
      const at = seed.clock();
      const first = !t.diagnosis;
      commit({
        ...t,
        diagnosis: { problem: rca.problem?.trim() ?? t.diagnosis?.problem, issue: rca.issue.trim(), fix: rca.fix.trim(), fixBy: rca.fixBy, by: me, at },
        updatedAt: at,
        activity: [...t.activity, activity(at, me, 'rca', first ? 'Shared the Initial RCA Report' : 'Updated the Initial RCA Report')],
      });
      toast(first ? `Initial RCA Report shared on ${t.id}` : `Initial RCA Report updated on ${t.id}`);
    },
    [commit, me, toast],
  );

  const saveRcaDraft = useCallback<Store['saveRcaDraft']>(
    (id, draft) => {
      const t = current(id);
      if (!t) return;
      const at = seed.clock();
      commit({ ...t, rcaDraft: { problem: draft.problem?.trim() ?? t.rcaDraft?.problem, issue: draft.issue.trim(), fix: draft.fix.trim(), hours: draft.hours ?? t.rcaDraft?.hours, at } });
    },
    [commit],
  );

  const addRcaExchange = useCallback<Store['addRcaExchange']>(
    (id, x) => {
      const t = current(id);
      if (!t) return;
      const at = seed.clock();
      commit({ ...t, rcaChat: [...(t.rcaChat ?? []), { id: `ai-${at}`, ...x, by: me, at }] });
    },
    [commit, me],
  );

  const saveCodeFix = useCallback<Store['saveCodeFix']>(
    (id, fix) => {
      const t = current(id);
      if (t) commit({ ...t, codeFix: fix });
    },
    [commit],
  );

  const saveFullRcaDraft = useCallback<Store['saveFullRcaDraft']>(
    (id, content) => {
      const t = current(id);
      if (t) commit({ ...t, fullRcaDraft: content ?? undefined });
    },
    [commit],
  );

  const saveResponseDraft = useCallback<Store['saveResponseDraft']>(
    (id, text) => {
      const t = current(id);
      if (t) commit({ ...t, responseDraft: text.trim() });
    },
    [commit],
  );

  const sendInitialResponse = useCallback<Store['sendInitialResponse']>(
    (id) => {
      const t = current(id);
      if (!t || t.initialResponse) return;
      const at = seed.clock();
      const text = responseDraftFor(t);
      const next: Ticket = {
        ...t,
        initialResponse: { text, by: me, at },
        firstRespondedAt: t.firstRespondedAt ?? at,
        updatedAt: at,
        activity: [...t.activity, activity(at, me, 'response', text)],
      };
      commit(next);
      emit('progress_update', next, 'Initial response sent');
      toast(`Initial response sent on ${t.id}`);
    },
    [commit, emit, me, responseDraftFor, toast],
  );

  const addComment = useCallback<Store['addComment']>(
    (id, thread, text, by, on, replyingTo) => {
      const t = current(id);
      if (!t || !text.trim()) return;
      // A reply joins the thread of the comment it answers: under that comment's own root.
      const target = replyingTo ? t.comments.find((c) => c.id === replyingTo) : undefined;
      const thread0 = target ? { parentId: target.parentId ?? target.id, replyingTo: target.id, on: target.on } : {};
      const at = seed.clock();
      const author = by ?? me;
      const body = text.trim();
      const excerpt = body.length > 140 ? `${body.slice(0, 137)}…` : body;
      const { team, clients } = live.current;
      const authorId = author.type === 'system' ? '' : author.id;
      const authorName = author.type === 'team' ? team.find((m) => m.id === authorId)?.name ?? 'Someone' : clients.flatMap((c) => c.users).find((u) => u.id === authorId)?.name ?? 'The client';
      // Every comment is part of the ticket's history; an internal one stays internal.
      const logged = activity(at, author, 'comment', `${thread === 'internal' ? 'Internal note' : 'Comment'}: “${excerpt}”`, thread === 'internal' ? 'internal' : 'client');
      commit({ ...t, comments: [...t.comments, { id: `cmt-${at}`, thread, by: author, at, text: body, ...(on ? { on } : {}), ...thread0 }], activity: [...t.activity, logged], updatedAt: at });
      // Whoever is @mentioned hears about it: the team on internal notes, the client's people on the client thread.
      const people = thread === 'internal' ? team.map((m) => ({ id: m.id, name: m.name })) : (clients.find((c) => c.id === t.clientId)?.users ?? []).map((u) => ({ id: u.id, name: u.name }));
      const mentioned = people.filter((p) => body.includes(`@${p.name}`) && p.id !== authorId);
      if (mentioned.length) {
        const mine = author.type === 'team' && author.id === currentUser.id;
        setNotifications((n) => [
          ...mentioned.map((p, i) => ({
            id: `ntf-mention-${at}-${i}`,
            type: 'mention' as const,
            ticketId: t.id,
            title: p.id === currentUser.id ? `${authorName} mentioned you on ${t.id}` : `${mine ? 'You' : authorName} mentioned ${p.name} on ${t.id}`,
            body: excerpt,
            at,
            // Your own mentions are logged as read; being mentioned by someone else is new.
            read: mine || p.id !== currentUser.id,
          })),
          ...n,
        ].slice(0, 60));
      }
    },
    [commit, me, currentUser.id],
  );

  const planTicket = useCallback<Store['planTicket']>(
    (id, patch) => {
      const t = current(id);
      if (!t) return;
      const at = seed.clock();
      const before = t.plan ?? {};
      const lines: string[] = [];
      if ('sprint' in patch && patch.sprint !== before.sprint) lines.push(before.sprint ? `Sprint plan changed from ${before.sprint} to ${patch.sprint ?? 'none'}` : `Sprint plan set to ${patch.sprint}`);
      if ('taskType' in patch && patch.taskType !== before.taskType)
        lines.push(before.taskType ? `Task type changed from ${TASK_TYPE_LABEL[before.taskType]} to ${patch.taskType ? TASK_TYPE_LABEL[patch.taskType] : 'none'}` : `Task type set to ${patch.taskType ? TASK_TYPE_LABEL[patch.taskType] : 'none'}`);
      if ('storyPoints' in patch && patch.storyPoints !== before.storyPoints) lines.push(before.storyPoints != null ? `Story points changed from ${before.storyPoints} to ${patch.storyPoints ?? 'none'}` : `Story points set to ${patch.storyPoints}`);
      const logged = lines.map((text, i) => activity(at + i, me, 'severity', text, 'internal'));
      commit({ ...t, plan: { ...t.plan, ...patch }, updatedAt: at, activity: [...t.activity, ...logged] });
    },
    [commit, me],
  );

  /** The AI's read of a new ticket: the asset it is about, its priority, and who should work on it. The category is the reporter's. */
  const triageFor = (clientId: string, title: string, description: string, category: Category) => {
    const { assets, clients } = live.current;
    const client = clients.find((c) => c.id === clientId)!;
    const asset = guessAsset(`${title} ${description}`, assets.filter((a) => a.clientId === clientId));
    const severity = guessSeverity(title, description);
    // To the client's frontend or backend developer, by the kind of work.
    return { assetId: asset?.id ?? '', category, severity, assigneeId: routeTo(client, taskTypeFor(title, description, category)) };
  };

  /** A new ticket, as the AI first reads it: everything filled in and the initial response sent, waiting for the PM to review it. */
  const newTicket = (id: string, input: { clientId: string; reporterId: string; category: Category; title: string; description: string; attachments: Attachment[] }, source: Ticket['source'], created: Activity, at: number): Ticket => {
    const { team, clients } = live.current;
    const client = clients.find((c) => c.id === input.clientId)!;
    const triage = triageFor(input.clientId, input.title, input.description, input.category);
    const dev = team.find((m) => m.id === triage.assigneeId);
    const pm = team.find((m) => m.id === pmFor(client));
    const ticket: Ticket = {
      id,
      title: input.title.trim(),
      description: input.description.trim(),
      clientId: input.clientId,
      assetId: triage.assetId,
      category: triage.category,
      reporterId: input.reporterId,
      source,
      createdAt: at,
      updatedAt: at,
      status: 'new',
      severity: triage.severity,
      assigneeId: triage.assigneeId,
      testerId: testerFor(client),
      triage,
      firstRespondedAt: null,
      resolvedAt: null,
      canceledAt: null,
      cancellation: null,
      feedback: [],
      blockers: [],
      moveNotes: [],
      handoffs: [],
      attachments: input.attachments,
      comments: [],
      activity: [
        created,
        activity(at + 1, { type: 'system' }, 'assignment', `AI suggested ${SEVERITY_LABEL[triage.severity]}, developed by ${dev?.name ?? 'the team'}. Waiting for ${pm?.name ?? 'the PM'} to review.`, 'internal'),
      ],
    };
    ticket.plan = autoPlan(ticket);
    // The AI's initial response goes out at once, with no one to confirm it.
    const reporter = client.users.find((u) => u.id === input.reporterId);
    const sla = getSla(ticket, policyFor(clients, live.current.policies, client.id), at);
    const reply = responseDraftOf(ticket, live.current.assets.find((a) => a.id === ticket.assetId)?.name ?? 'your asset', reporter?.name.split(' ')[0] ?? 'there', sla.initialRca.due);
    ticket.initialResponse = { text: reply, by: { type: 'system' }, at: at + 2 };
    ticket.firstRespondedAt = at + 2;
    ticket.activity.push(activity(at + 2, { type: 'system' }, 'response', reply));
    return ticket;
  };

  const createTicket = useCallback<Store['createTicket']>(
    (input) => {
      const { tickets } = live.current;
      const at = seed.clock();
      const max = tickets.reduce((m, t) => Math.max(m, Number(t.id.slice(4))), 4000);
      const reporterName = live.current.clients.find((c) => c.id === input.clientId)?.users.find((u) => u.id === input.reporterId)?.name ?? 'the client';
      const ticket = newTicket(`NXS-${max + 1}`, input, { channel: input.channel, loggedBy: currentUser.id }, activity(at, me, 'created', `Logged by NXS on behalf of ${reporterName}`), at);
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
      const at = seed.clock();
      const by: Actor = { type: 'client', id: input.reporterId };
      const ticket = newTicket(nextTicketId(), input, { channel: 'portal', loggedBy: null }, activity(at, by, 'created', 'Submitted from the Client Portal'), at);
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
      if (!t || t.status !== 'ready_to_deploy' || !sameClient) return false;
      if (decision === 'declined' && !note.trim()) return false;
      const at = seed.clock();
      const by: Actor = { type: 'client', id: userId };
      const clientName = live.current.clients.flatMap((c) => c.users).find((u) => u.id === userId)?.name ?? 'the client';
      const feedback = { id: `fb-n${at.toString(36)}`, at, by: userId, decision, note: note.trim(), attachments };
      const next: Ticket =
        decision === 'approved'
          ? {
              ...t,
              updatedAt: at,
              feedback: [...t.feedback, feedback],
              activity: [...t.activity, activity(at, by, 'status', `${clientName} approved the deploy. NXS deploys it next.`)],
            }
          : {
              ...t,
              status: 'in_progress',
              resolvedAt: null,
              updatedAt: at,
              feedback: [...t.feedback, feedback],
              activity: [...t.activity, activity(at, by, 'status', 'Declined the fix. Status changed from Ready to deploy to In progress')],
            };
      commit(next);
      emit('status_updated', next, decision === 'declined' ? note.trim() : undefined, true);
      return true;
    },
    [commit, emit],
  );


  /* ---------- Clients, assets, SLA, team ---------- */

  const setAssetStatus = useCallback<Store['setAssetStatus']>((id, status) => {
    setAssets((list) => list.map((a) => (a.id === id ? { ...a, status, statusChangedAt: seed.clock(), statusNote: status === a.status ? a.statusNote : '' } : a)));
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
        testerId: currentUser.id,
        devs: { frontend: currentUser.id, backend: currentUser.id },
        since: new Date(seed.clock()).toISOString().slice(0, 10),
        users: [],
      };
      setClients((list) => [...list, client]);
      return client;
    },
    [currentUser.id],
  );
  const addClientUser = useCallback<Store['addClientUser']>((clientId, input) => {
    const user: ClientUser = { id: `cu-${clientId}-${seed.clock().toString(36)}`, clientId, role: 'client_user', ...input };
    setClients((list) => list.map((c) => (c.id === clientId ? { ...c, users: [...c.users, user] } : c)));
    return user;
  }, []);
  const setUserCategories = useCallback<Store['setUserCategories']>((clientId, userId, categories) => {
    setClients((list) => list.map((c) => (c.id === clientId ? { ...c, users: c.users.map((u) => (u.id === userId ? { ...u, categories } : u)) } : c)));
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
      statusChangedAt: seed.clock(),
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
  const setClientCrew = useCallback<Store['setClientCrew']>((clientId, patch) => {
    setClients((list) => list.map((c) => (c.id === clientId ? { ...c, ...patch, devs: { ...c.devs, ...(patch.devs ?? {}) } } : c)));
  }, []);
  const addTeamMember = useCallback<Store['addTeamMember']>((input) => {
    const member: TeamMember = {
      id: `tm-${seed.clock().toString(36)}`,
      name: input.name,
      title: input.title,
      role: input.role,
      level: input.role === 'admin' || input.role === 'support_lead' ? 'L3' : 'L2',
      departmentId: 'engineering',
      email: input.email,
      phone: '',
      availability: 'available',
      skills: ['tech', 'business', 'operational'],
    };
    setTeam((list) => [...list, member]);
    return member;
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
      const out = dispatch(event, sample, { clients, team, rules }, seed.clock(), event.startsWith('sla') ? 'Test message' : undefined);
      setDeliveries((d) => [...out.deliveries, ...d]);
      toast(out.deliveries.length ? `Test logged for ${out.deliveries.length} recipient${out.deliveries.length > 1 ? 's' : ''}` : 'Choose at least one recipient first', {
        tone: out.deliveries.length ? 'success' : 'warning',
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
    setTester,
    setCategory,
    setAsset,
    confirmTriage,
    markFeatureRequest,
    escalateIssueCheck,
    settleFeatureCheck,
    sendInitialRca,
    codeFixOf,
    saveCodeFix,
    approveFix,
    passTest,
    releaseOf,
    saveRelease,
    setSecurityIssue,
    setSeverity,
    setSlaExclusion,
    planTicket,
    saveInitialRca,
    saveRcaDraft,
    addRcaExchange,
    saveResponseDraft,
    sendInitialResponse,
    responseDraftFor,
    fullRcaDraftFor,
    saveFullRcaDraft,
    addComment,
    submitPortalTicket,
    reviewFix,
    setAssetStatus,
    addClient,
    addClientUser,
    setUserCategories,
    setClientCrew,
    addTeamMember,
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
