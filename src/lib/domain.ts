import type { RequestType, AssetCategory, AssetStatus, Availability, Category, TicketChannel, Level, NotificationEventType, Permission, RecipientKind, Role, Severity, Ticket, TicketStatus, MonitorMethod } from '../types';

/* ---------- Labels ---------- */

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];
/** Priority, P1 to P4. Only Tech issues get one; it comes from the impact questions. */
export const SEVERITY_LABEL: Record<Severity, string> = { critical: 'P1 Critical', high: 'P2 High', medium: 'P3 Medium', low: 'P4 Low' };
export const NO_PRIORITY_LABEL = 'No priority';
export const priorityLabel = (s: Severity | null) => (s ? SEVERITY_LABEL[s] : NO_PRIORITY_LABEL);
/**
 * Operational and Hardware issues have no priority rating; they are picked up
 * by category. Until category targets exist, their SLA clock runs on the P4
 * Low timings.
 */
export const UNRATED_SEVERITY: Severity = 'low';

export const CATEGORIES: Category[] = ['tech', 'business', 'operational', 'hardware'];
export const CATEGORY_LABEL: Record<Category, string> = {
  tech: 'Tech issue',
  business: 'Business issue',
  operational: 'Operational issue',
  hardware: 'Hardware issue',
};
export const CATEGORY_HINT: Record<Category, string> = {
  tech: 'Something in the system isn’t working: an outage, an error, a broken form, slow pages.',
  business: 'A business rule, policy, data definition or requirement.',
  operational: 'Day-to-day requests: content updates, banners, articles or how-to questions.',
  hardware: 'A device or network fault that stops you using the website or dashboard.',
};
/** The categories shown on a new ticket, in this order. Only the open ones can be picked. */
export const NEW_TICKET_CATEGORIES: Category[] = ['tech', 'business', 'operational', 'hardware'];

/**
 * The impact questions for a Tech issue, asked in order until one is a yes.
 * The first yes sets the priority; three noes make it P4 Low.
 */
export const PRIORITY_QUESTIONS: { severity: Severity; text: string }[] = [
  { severity: 'critical', text: 'Is the service down, is personal or confidential data exposed or changed, or is a live campaign blocked?' },
  { severity: 'high', text: 'Is a major feature not working, or is the service badly slowed down?' },
  { severity: 'medium', text: 'Is only part of a feature affected, or is there a way to work around it?' },
];
/** The categories that can be picked today. The rest show as coming soon until their questions exist. */
export const OPEN_TICKET_CATEGORIES: Category[] = ['tech'];

/**
 * What each priority means and what the client can count on, in their words,
 * from the SLA table. The reply and fix times come from the client's SLA
 * policy; these are the parts the policy does not hold.
 */
export const PRIORITY_PROMISE: Record<Severity, { word: string; because: string; hours: string; updates: string; stopgap?: string }> = {
  critical: { word: 'urgent', because: 'the service is down, data is at risk, or a live campaign is blocked', hours: 'around the clock, weekends included', updates: 'every hour' },
  high: { word: 'high', because: 'a major feature isn’t working', hours: 'during business hours', updates: 'every 4 business hours', stopgap: 'within 4 business hours' },
  medium: { word: 'medium', because: 'only part of a feature is affected, or there’s a way around it', hours: 'during business hours', updates: 'once a day', stopgap: 'within 1 business day' },
  low: { word: 'low', because: 'it’s a minor issue', hours: 'during business hours', updates: 'when it’s fixed, and in your monthly report' },
};

/** The priority the answers so far lead to, or null while a question is still open. */
export function priorityFromAnswers(answers: (boolean | null)[]): Severity | null {
  for (let i = 0; i < PRIORITY_QUESTIONS.length; i++) {
    if (answers[i] == null) return null;
    if (answers[i]) return PRIORITY_QUESTIONS[i].severity;
  }
  return 'low';
}

/** NXS's own stages, in the order work moves through them. */
export const STATUSES: TicketStatus[] = [
  'new',
  'reopened',
  'in_progress',
  'blocked',
  'waiting_testing',
  'on_testing',
  'waiting_approval',
  'resolved',
  'canceled',
];
export const STATUS_LABEL: Record<TicketStatus, string> = {
  new: 'New',
  reopened: 'Reopened',
  in_progress: 'In progress',
  blocked: 'Blocker',
  waiting_testing: 'Waiting for testing',
  on_testing: 'On testing',
  // Done and tested on NXS's side; the client still has to approve the fix.
  waiting_approval: 'Waiting for approval',
  resolved: 'Resolved',
  canceled: 'Canceled',
};

export const ASSET_STATUSES: AssetStatus[] = ['operational', 'degraded', 'outage', 'maintenance', 'unknown'];
export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  outage: 'Outage',
  maintenance: 'Maintenance',
  unknown: 'Unknown',
};
export const ASSET_CATEGORIES: AssetCategory[] = ['consumer_website', 'marketing_dashboard', 'omnichannel_dashboard', 'lms_app'];
export const ASSET_CATEGORY_LABEL: Record<AssetCategory, string> = {
  consumer_website: 'Consumer website',
  marketing_dashboard: 'Marketing-tech dashboard',
  omnichannel_dashboard: 'Omnichannel dashboard',
  lms_app: 'Learning app (LMS)',
};

export const MONITOR_METHODS: MonitorMethod[] = ['health_url', 'status_api', 'uptime_service'];
export const MONITOR_METHOD_LABEL: Record<MonitorMethod, string> = {
  health_url: 'Health check URL',
  status_api: 'Status API',
  uptime_service: 'Uptime monitor',
};
export const MONITOR_METHOD_HINT: Record<MonitorMethod, string> = {
  health_url: 'A 2xx reply means live.',
  status_api: 'Reads its JSON status.',
  uptime_service: 'Like Better Stack.',
};
export const MONITOR_INTERVALS = [1, 5, 15];

export const LEVELS: Level[] = ['L1', 'L2', 'L3'];
export const LEVEL_HINT: Record<Level, string> = {
  L1: 'Triage, known issues and routine requests.',
  L2: 'Product specialists and engineers for diagnosed faults.',
  L3: 'Senior engineering and infrastructure for critical incidents.',
};

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: 'Available',
  busy: 'Busy',
  away: 'Away',
  off_shift: 'Off shift',
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrator',
  support_lead: 'Support lead',
  support_agent: 'Support agent',
  viewer: 'Viewer',
  client_admin: 'Client admin',
  client_user: 'Client user',
};

export const CHANNEL_LABEL: Record<TicketChannel, string> = {
  portal: 'Client Portal',
  manual: 'Logged by NXS',
};

export const RECIPIENT_LABEL: Record<RecipientKind, string> = {
  assignee: 'Assigned support',
  support_lead: 'Support lead',
  account_manager: 'Account manager',
  client_contact: 'Client contact',
};

export const EVENT_LABEL: Record<NotificationEventType, string> = {
  ticket_created: 'New ticket created',
  ticket_assigned: 'Ticket assigned',
  status_updated: 'Status updated',
  sla_approaching: 'SLA approaching deadline',
  sla_breached: 'SLA breached',
  ticket_resolved: 'Ticket resolved',
  ticket_canceled: 'Ticket canceled',
  progress_update: 'Progress update',
};

/* ---------- Workflow ---------- */

export const OPEN_STATUSES: TicketStatus[] = ['new', 'reopened', 'in_progress', 'blocked', 'waiting_testing', 'on_testing', 'waiting_approval'];
export const isOpen = (t: Pick<Ticket, 'status'>) => OPEN_STATUSES.includes(t.status);

/** The linear path: the one step the main button takes from each stage.
 *  Waiting for approval has none (the client answers in the portal), and
 *  Blocker has two (back to In progress, or straight to testing). */
export const NEXT_STAGE: Partial<Record<TicketStatus, TicketStatus>> = {
  new: 'in_progress',
  reopened: 'in_progress',
  in_progress: 'waiting_testing',
  waiting_testing: 'on_testing',
  on_testing: 'waiting_approval',
};
/** Where work can pick up again once a blocker clears. */
export const UNBLOCK_TO: TicketStatus[] = ['in_progress', 'waiting_testing'];

/**
 * Every move a ticket can make. Forward is only ever one step, so testing can
 * never be skipped. Everything else is one of five off-path moves, each with
 * a reason: rework (back to In progress), pause (Blocker), resolve without
 * the client's approval, cancel, and reopen. The client's own approve and
 * decline in the portal are not listed here; they act on Waiting for approval directly.
 */
export const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ['in_progress', 'canceled'],
  reopened: ['in_progress', 'canceled'],
  in_progress: ['waiting_testing', 'blocked', 'canceled'],
  blocked: ['in_progress', 'waiting_testing', 'canceled'],
  waiting_testing: ['on_testing', 'in_progress', 'blocked', 'canceled'],
  on_testing: ['waiting_approval', 'in_progress', 'blocked', 'canceled'],
  waiting_approval: ['in_progress', 'resolved', 'canceled'],
  resolved: ['reopened'],
  canceled: ['reopened'],
};
export const canTransition = (from: TicketStatus, to: TicketStatus) => TRANSITIONS[from].includes(to);

/** A move back to In progress from further along: work has to be redone. */
export const isRework = (from: TicketStatus, to: TicketStatus) => to === 'in_progress' && (from === 'waiting_testing' || from === 'on_testing' || from === 'waiting_approval');
/** Moves that ask "why" in a short note: rework and reopening. Blocker,
 *  resolve without approval and cancel have their own dialogs. */
export const needsMoveNote = (from: TicketStatus, to: TicketStatus) => isRework(from, to) || to === 'reopened';

/**
 * How each move reads from where the ticket is now: `title` names what the
 * move means (used on dialogs and the highlighted note), `hint` says what it
 * does or asks for (used in the Move to menu), `ask` is the dialog's question.
 */
export function moveLabel(from: TicketStatus, to: TicketStatus): { title: string; hint: string; ask: string } {
  if (to === 'blocked') return { title: 'Blocker', hint: 'Pauses the work. Asks what is blocking it.', ask: 'What’s blocking it?' };
  if (to === 'canceled') return { title: 'Cancel ticket', hint: 'Ends the ticket. Asks why.', ask: 'Why is it canceled?' };
  if (to === 'resolved') return { title: 'Resolve without approval', hint: 'Skips the client’s approval. Asks why.', ask: 'Why skip the approval?' };
  if (to === 'reopened') return { title: 'Reopen', hint: 'Back to work. Asks why.', ask: 'Why reopen it?' };
  if (to === 'waiting_approval') return { title: 'Send for approval', hint: 'Testing passed. Sends the client a note and proof.', ask: 'What should the client check?' };
  if (from === 'blocked') return { title: 'Unblock', hint: to === 'in_progress' ? 'Clears the blocker. Work carries on.' : 'Clears the blocker. The fix is ready to test.', ask: '' };
  if (from === 'on_testing') return { title: 'Testing failed', hint: 'Testing failed. Asks what failed.', ask: 'What failed in testing?' };
  if (from === 'waiting_testing' && to === 'in_progress') return { title: 'Not ready for testing', hint: 'Not ready to test yet. Asks why.', ask: 'Why isn’t it ready for testing?' };
  if (from === 'waiting_approval') return { title: 'Needs more work', hint: 'Takes it back from the client. Asks why.', ask: 'What needs more work?' };
  if (to === 'in_progress') return { title: 'Start work', hint: 'Starts the work. Asks who owns it if nobody does.', ask: '' };
  if (to === 'waiting_testing') return { title: 'Send to testing', hint: 'The fix is ready to test.', ask: '' };
  if (to === 'on_testing') return { title: 'Start testing', hint: 'Someone is testing the fix now.', ask: '' };
  return { title: STATUS_LABEL[to], hint: '', ask: '' };
}

/** Stages that need a named support member before a ticket can enter them.
 *  Assigning someone to a New or Reopened ticket starts the work. */
export const NEEDS_ASSIGNEE: TicketStatus[] = ['in_progress'];

/* ---------- Severity ---------- */

const RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };
export const severityRank = (s: Severity | null) => (s ? RANK[s] : 0);

/* ---------- Roles and permissions ---------- */

const INTERNAL_ALL: Permission[] = [
  'ticket.create',
  'ticket.update',
  'ticket.assign',
  'ticket.cancel',
  'notes.internal',
  'clients.manage',
  'assets.manage',
  'sla.manage',
  'team.manage',
  'settings.manage',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: INTERNAL_ALL,
  support_lead: ['ticket.create', 'ticket.update', 'ticket.assign', 'notes.internal', 'assets.manage', 'sla.manage'],
  support_agent: ['ticket.create', 'ticket.update', 'notes.internal'],
  viewer: ['notes.internal'],
  // Client roles never receive notes.internal.
  client_admin: ['ticket.create'],
  client_user: ['ticket.create'],
};

export const PERMISSION_LABEL: Record<Permission, string> = {
  'ticket.create': 'Create tickets',
  'ticket.update': 'Update status',
  'ticket.assign': 'Assign support',
  'ticket.cancel': 'Cancel tickets',
  'notes.internal': 'See internal notes',
  'clients.manage': 'Manage clients',
  'assets.manage': 'Manage assets',
  'sla.manage': 'Manage SLA policies',
  'team.manage': 'Manage team',
  'settings.manage': 'Manage settings',
};

export const hasPermission = (role: Role, permission: Permission) => ROLE_PERMISSIONS[role].includes(permission);

/** The only view of a ticket's history that may be shown to client users. */
export const clientVisibleActivity = (t: Ticket) => t.activity.filter((a) => a.visibility === 'client');

/* ---------- Client Portal wording ---------- */

/** Stage names as a client reads them: what is happening from their side. */
export const PORTAL_STATUS_LABEL: Record<TicketStatus, string> = {
  // From the client's side: they sent it in; NXS hasn't started yet.
  new: 'Submitted',
  reopened: 'Reopened',
  in_progress: 'In progress',
  blocked: 'In progress',
  waiting_testing: 'In progress',
  on_testing: 'In progress',
  waiting_approval: 'Ready for your review',
  resolved: 'Resolved',
  canceled: 'Canceled',
};

/** The stage a client sees. Blocked and testing are NXS's own steps inside
 *  "In progress", so the portal never shows them. */
export const portalStatus = (s: TicketStatus): TicketStatus => (s === 'blocked' || s === 'waiting_testing' || s === 'on_testing' ? 'in_progress' : s);
/** Stages a client can see, in workflow order. */
export const PORTAL_STATUSES: TicketStatus[] = STATUSES.filter((s) => portalStatus(s) === s);

/** What each severity means to the person reporting it. */
export const PORTAL_SEVERITY_HINT: Record<Severity, string> = {
  critical: 'Down or unusable for everyone.',
  high: 'A key feature is broken, with no workaround.',
  medium: 'Something is wrong, but there is a workaround.',
  low: 'A small issue or a change request.',
};

/* ---------- Request types ---------- */

/** What a client can ask for. Kept general so it fits any client and product. */
export const REQUEST_TYPES: RequestType[] = ['issue', 'scope_addition', 'scope_change', 'design', 'technical', 'content', 'timeline', 'commercial', 'compliance'];
export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  issue: 'Something isn’t working',
  scope_addition: 'New scope or deliverable',
  scope_change: 'Change to agreed scope',
  design: 'Design or UI/UX revision',
  technical: 'Technical or development change',
  content: 'Content update',
  timeline: 'Timeline change',
  commercial: 'Budget or commercial change',
  compliance: 'Legal or compliance requirement',
};
/** How each request type lands in NXS's own categories. */
export const REQUEST_TYPE_CATEGORY: Record<RequestType, Category> = {
  issue: 'tech',
  scope_addition: 'business',
  scope_change: 'business',
  design: 'tech',
  technical: 'tech',
  content: 'operational',
  timeline: 'business',
  commercial: 'business',
  compliance: 'business',
};
