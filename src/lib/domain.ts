import type { TaskType, SlaExclusionKind, RequestType, AssetCategory, AssetStatus, Availability, Category, TicketChannel, Level, NotificationEventType, Permission, RecipientKind, Role, Severity, Ticket, TicketStatus, MonitorMethod } from '../types';

/* ---------- Labels ---------- */

export const SEVERITIES: Severity[] = ['critical', 'medium', 'low'];
/** Priority as in the SLA: P1 Critical, P2 Medium, P3 Low. Every category gets one, from two questions. */
export const SEVERITY_LABEL: Record<Severity, string> = { critical: 'P1 Critical', medium: 'P2 Medium', low: 'P3 Low' };
export const NO_PRIORITY_LABEL = 'No priority';
export const priorityLabel = (s: Severity | null) => (s ? SEVERITY_LABEL[s] : NO_PRIORITY_LABEL);
/** Older tickets logged without a priority run on P3 Low timings. */
export const UNRATED_SEVERITY: Severity = 'low';

/** Tech includes hardware, as in the SLA. */
export const CATEGORIES: Category[] = ['tech', 'business', 'operational'];
export const CATEGORY_LABEL: Record<Category, string> = {
  tech: 'Tech issue',
  business: 'Business issue',
  operational: 'Operational issue',
};
/* ---------- Planning: task type and weekly sprints ---------- */

export const TASK_TYPES: TaskType[] = ['frontend', 'backend'];
export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  frontend: 'Frontend Development',
  backend: 'Backend Development',
};

const DAY_MS = 24 * 60 * 60_000;
/** Sprints run a week, Thursday to Wednesday, and are named after their first day: SP.YY.MM.DD. */
export function sprintStart(ts: number): number {
  const d = new Date(ts);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const back = (day.getDay() - 4 + 7) % 7;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - back).getTime();
}
export function sprintCode(start: number): string {
  const d = new Date(start);
  const two = (n: number) => String(n).padStart(2, '0');
  return `SP.${two(d.getFullYear() % 100)}.${two(d.getMonth() + 1)}.${two(d.getDate())}`;
}
export const sprintOf = (ts: number) => sprintCode(sprintStart(ts));
/** The sprints a ticket can be planned in: last week's, this week's and the next two. */
export function sprintChoices(now: number): { code: string; start: number; end: number; when: string }[] {
  const current = sprintStart(now);
  const WHEN = ['Last sprint', 'This sprint', 'Next sprint', 'In two weeks'];
  return [-1, 0, 1, 2].map((n, i) => {
    const start = new Date(current + n * 7 * DAY_MS + 12 * 60 * 60_000);
    const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    return { code: sprintCode(s), start: s, end: s + 6 * DAY_MS, when: WHEN[i] };
  });
}

export const CATEGORY_HINT: Record<Category, string> = {
  tech: 'Something in a website, dashboard or app isn’t working, or a phone, laptop or network fault stops you using it.',
  business: 'A business rule, policy, data definition or requirement needs changing or clarifying.',
  operational: 'Day-to-day campaign operations, such as one-to-one activities, scheduling or participant handling.',
};
/** The categories shown on a new ticket, in this order. */
export const NEW_TICKET_CATEGORIES: Category[] = CATEGORIES;
/** Every category can be picked: all three get a priority from the same two questions. */
export const OPEN_TICKET_CATEGORIES: Category[] = CATEGORIES;

/**
 * Priority, as the SLA sets it: rate the impact and take the highest. The two
 * questions are written from the SLA's four dimensions (confidentiality,
 * integrity, availability, business impact). A yes to the first is P1, a yes
 * to the second is P2, two noes are P3.
 */
export const PRIORITY_QUESTIONS: { severity: Exclude<Severity, 'low'>; text: string; signs: string[] }[] = [
  {
    severity: 'critical',
    text: 'Is any of this happening?',
    signs: [
      'The service or a core function is down, with no workaround',
      'Personal data, WhatsApp numbers, trial data or competitor insights are exposed, or might be',
      'Data or campaign settings are corrupted, lost, tampered with, or sent to the wrong people',
      'A live campaign is blocked, or there is legal or regulatory exposure',
    ],
  },
  {
    severity: 'medium',
    text: 'If not, is any of this happening?',
    signs: [
      'A major function is unavailable, or badly slowed for many users',
      'Data in a major function is wrong and needs an urgent fix',
      'A limited amount of non-sensitive data is exposed',
      'A live campaign is badly disrupted or at risk',
    ],
  },
];

/** Examples from the SLA, per category and priority, behind "See examples". */
export const PRIORITY_EXAMPLES: Record<Category, Record<Severity, string[]>> = {
  tech: {
    critical: [
      'Website fully down, or returning errors to most users',
      'Consumer data or quiz answers accessed or exported without permission',
      'WhatsApp messages sent to the wrong audience by a system fault',
      'Dashboard down during a live campaign',
      'A lost or stolen device holding consumer data or dashboard access',
    ],
    medium: [
      'Quiz results not saving for most users while the site stays up',
      'Campaign setup unavailable, so a campaign cannot launch',
      'Pages taking more than 5 seconds to load',
      'A device or network fault stopping one campaign team',
    ],
    low: ['Typos, cosmetic or alignment issues', 'A CSV export times out but the on-screen view works', 'One phone cannot open the dashboard, with no campaign impact', 'Small enhancement requests'],
  },
  business: {
    critical: ['A wrong business rule hits a live campaign for many consumers', 'Missing campaign data stops a live campaign from launching or being reported'],
    medium: ['A requirement change needed before the next campaign phase', 'A data definition mismatch that distorts campaign reports', 'A policy question holding up an ongoing activity'],
    low: ['A policy or data definition question with no campaign impact', 'Small wording changes to business rules or documents'],
  },
  operational: {
    critical: ['A live one-to-one activity cannot run at all', 'Participant data handled or shared in error during an activity'],
    medium: ['A one-to-one activity runs only in part, such as a scheduling clash', 'A delay in recording or reporting activity results'],
    low: ['A small change to an activity schedule or script', 'An operational question with no effect on a live activity'],
  },
};

/**
 * What each priority means and what the client can count on, in plain words,
 * from the SLA. NXS works around the clock for every priority.
 */
export const PRIORITY_PROMISE: Record<Severity, { word: string; because: string; updates: string; fix: string }> = {
  critical: { word: 'urgent', because: 'the service, consumer data or a live campaign is hit', updates: 'every hour', fix: 'by the time set in the diagnosis' },
  medium: { word: 'medium', because: 'a major function is disrupted, with no sensitive data exposed', updates: 'every 4 hours', fix: 'within 1 day' },
  low: { word: 'low', because: 'the impact is limited, cosmetic, or there is a way around it', updates: 'when it’s fixed', fix: 'within 3 days' },
};

/** The priority the answers so far lead to, or null while a question is still open. */
export function priorityFromAnswers(answers: (boolean | null)[]): Severity | null {
  for (let i = 0; i < PRIORITY_QUESTIONS.length; i++) {
    if (answers[i] == null) return null;
    if (answers[i]) return PRIORITY_QUESTIONS[i].severity;
  }
  return 'low';
}

/** The SLA's exclusions, in plain words. */
export const SLA_EXCLUSION_LABEL: Record<SlaExclusionKind, string> = {
  third_party: 'Third-party outage',
  client_side: 'Caused on the client’s side',
  force_majeure: 'Force majeure',
  maintenance: 'Approved maintenance',
  change_request: 'Change request',
};
export const SLA_EXCLUSION_HINT: Record<SlaExclusionKind, string> = {
  third_party: 'A provider outside NXS, such as a payment gateway or WhatsApp, is down.',
  client_side: 'The cause is on the client’s systems, devices or access.',
  force_majeure: 'Events outside anyone’s control.',
  maintenance: 'Planned maintenance the client agreed to.',
  change_request: 'New work or a change, not a fault: it follows the change process.',
};

/** NXS's own stages, in the order work moves through them. */
export const STATUSES: TicketStatus[] = [
  'new',
  'not_started',
  'in_progress',
  'blocked',
  'waiting_testing',
  'on_testing',
  'qa_passed',
  'ready_to_deploy',
  'resolved',
  'canceled',
];
export const STATUS_LABEL: Record<TicketStatus, string> = {
  new: 'New',
  // The PM reviewed it; QA checks the issue is real before it goes to a developer.
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  waiting_testing: 'Waiting for testing',
  on_testing: 'On testing',
  // Testing passed; the developer prepares the release (the image and its notes).
  qa_passed: 'QA passed',
  // Tested; the client checks it and approves it going live, or says what's still wrong.
  ready_to_deploy: 'Ready to deploy',
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
  admin: 'Super admin',
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
  account_manager: 'Project manager',
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
  mention: 'Mentioned in a comment',
};

/* ---------- Workflow ---------- */

export const OPEN_STATUSES: TicketStatus[] = ['new', 'not_started', 'in_progress', 'blocked', 'waiting_testing', 'on_testing', 'qa_passed', 'ready_to_deploy'];
export const isOpen = (t: Pick<Ticket, 'status'>) => OPEN_STATUSES.includes(t.status);

/** The linear path: the one step the main button takes from each stage.
 *  Ready to deploy has none (the client answers in the portal), and Blocked has
 *  two (back to In progress, or straight to testing). */
export const NEXT_STAGE: Partial<Record<TicketStatus, TicketStatus>> = {
  // The PM's review hands it to QA, who checks the issue before a developer starts.
  new: 'not_started',
  not_started: 'in_progress',
  in_progress: 'waiting_testing',
  waiting_testing: 'on_testing',
  on_testing: 'qa_passed',
  qa_passed: 'ready_to_deploy',
};
/** Where work can pick up again once a blocker clears. */
export const UNBLOCK_TO: TicketStatus[] = ['in_progress', 'waiting_testing'];

/**
 * Where a ticket can go from each stage. The usual path is New → Not started
 * → In progress → Waiting for testing → On testing → Ready to deploy →
 * Resolved; the rest are the sensible detours (block, send back, cancel,
 * reopen), each asking why where it should.
 */
export const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  // The PM's review hands it to QA.
  new: ['not_started', 'canceled'],
  // QA confirms it (to the developer), sends it back for another review, or cancels it with proof.
  not_started: ['in_progress', 'new', 'canceled'],
  in_progress: ['waiting_testing', 'blocked', 'canceled'],
  // Unblocking goes back to where the work was; the step offers that one first.
  blocked: ['in_progress', 'waiting_testing', 'on_testing', 'canceled'],
  waiting_testing: ['on_testing', 'in_progress', 'blocked', 'canceled'],
  on_testing: ['qa_passed', 'in_progress', 'blocked', 'canceled'],
  qa_passed: ['ready_to_deploy', 'in_progress', 'canceled'],
  ready_to_deploy: ['resolved', 'in_progress', 'canceled'],
  resolved: ['in_progress'],
  canceled: ['in_progress'],
};
/** Why a move can't happen yet, if something it needs is missing. */
export function moveBlockedBy(t: Pick<Ticket, 'status' | 'diagnosis'>, to: TicketStatus): string | null {
  if (to === 'waiting_testing' && !t.diagnosis) return 'Send the initial RCA first.';
  return null;
}
export const canTransition = (from: TicketStatus, to: TicketStatus) => TRANSITIONS[from].includes(to);

/** A move back to In progress from further along: work has to be redone. */
export const isRework = (from: TicketStatus, to: TicketStatus) => to === 'in_progress' && (from === 'waiting_testing' || from === 'on_testing' || from === 'qa_passed' || from === 'ready_to_deploy');
/** Moves that ask "why" in a short note: rework and reopening. Blocker,
 *  resolve without approval and cancel have their own dialogs. */
export const isReopen = (from: TicketStatus, to: TicketStatus) => to === 'in_progress' && (from === 'resolved' || from === 'canceled');
export const needsMoveNote = (from: TicketStatus, to: TicketStatus) => isRework(from, to) || isReopen(from, to);

/**
 * How each move reads from where the ticket is now: `title` names what the
 * move means (used on dialogs and the highlighted note), `hint` says what it
 * does or asks for (used in the Move to menu), `ask` is the dialog's question.
 */
export function moveLabel(from: TicketStatus, to: TicketStatus): { title: string; hint: string; ask: string } {
  if (to === 'blocked') return { title: 'Blocked', hint: 'Pauses the work. Asks what is blocking it.', ask: 'What’s blocking it?' };
  if (to === 'canceled') return { title: 'Cancel ticket', hint: 'Ends the ticket. Asks why.', ask: 'Why is it canceled?' };
  if (to === 'resolved') return { title: 'Resolve without approval', hint: 'Skips the client’s approval. Asks why.', ask: 'Why skip the approval?' };
  if (from === 'new' && to === 'not_started') return { title: 'Confirm properties', hint: 'Hands it to QA to check the issue.', ask: '' };
  if (from === 'not_started' && to === 'new') return { title: 'Back to the PM', hint: 'The properties need another look.', ask: '' };
  if (from === 'not_started' && to === 'in_progress') return { title: 'Confirm the issue', hint: 'It happens. Hands it to the developer.', ask: '' };
  if (isReopen(from, to)) return { title: 'Reopen', hint: 'Back to the assignee, in progress. Asks why.', ask: 'Why reopen it?' };
  if (to === 'ready_to_deploy') return { title: 'Ready to deploy', hint: 'Testing passed. Sends the client a note to approve it going live.', ask: 'What should the client check?' };
  if (from === 'blocked') return { title: 'Unblock', hint: to === 'in_progress' ? 'Clears the blocker. Work carries on.' : 'Clears the blocker. The fix is ready to test.', ask: '' };
  if (from === 'on_testing' && to === 'qa_passed') return { title: 'QA passed', hint: 'Testing passed. The developer prepares the release.', ask: '' };
  if (from === 'on_testing') return { title: 'Testing failed', hint: 'Testing failed. Asks what failed.', ask: 'What failed in testing?' };
  if (from === 'qa_passed' && to === 'in_progress') return { title: 'Needs more work', hint: 'Back to the developer before it goes to the client. Asks why.', ask: 'What needs more work?' };
  if (from === 'waiting_testing' && to === 'in_progress') return { title: 'Not ready for testing', hint: 'Not ready to test yet. Asks why.', ask: 'Why isn’t it ready for testing?' };
  if (from === 'ready_to_deploy') return { title: 'Needs more work', hint: 'Takes it back from the client before it goes live. Asks why.', ask: 'What needs more work?' };
  if (to === 'in_progress') return { title: 'Start work', hint: 'Starts the work. Asks who owns it if nobody does.', ask: '' };
  if (to === 'waiting_testing') return { title: 'Send to testing', hint: 'The fix is ready to test.', ask: '' };
  if (to === 'on_testing') return { title: 'Start testing', hint: 'Someone is testing the fix now.', ask: '' };
  return { title: STATUS_LABEL[to], hint: '', ask: '' };
}

/** Stages that need a named support member before a ticket can enter them.
 *  Starting the work needs someone to do it. */
export const NEEDS_ASSIGNEE: TicketStatus[] = ['in_progress'];

/* ---------- Severity ---------- */

const RANK: Record<Severity, number> = { low: 1, medium: 2, critical: 3 };
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
  support_lead: ['ticket.create', 'ticket.update', 'ticket.assign', 'ticket.cancel', 'notes.internal', 'assets.manage', 'sla.manage'],
  // QA cancels a ticket that turns out not to be an issue; developers hand on work that isn't theirs.
  support_agent: ['ticket.create', 'ticket.update', 'ticket.assign', 'ticket.cancel', 'notes.internal'],
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
  not_started: 'In progress',
  in_progress: 'In progress',
  blocked: 'In progress',
  waiting_testing: 'In progress',
  on_testing: 'In progress',
  qa_passed: 'In progress',
  ready_to_deploy: 'Ready to deploy',
  // The client's Deploy is what resolves it.
  resolved: 'Deployed',
  canceled: 'Canceled',
};

/** The stage a client sees. Blocked and testing are NXS's own steps inside
 *  "In progress", so the portal never shows them. */
export const portalStatus = (s: TicketStatus): TicketStatus => (s === 'not_started' || s === 'blocked' || s === 'waiting_testing' || s === 'on_testing' || s === 'qa_passed' ? 'in_progress' : s);
/** Stages a client can see, in workflow order. */
export const PORTAL_STATUSES: TicketStatus[] = STATUSES.filter((s) => portalStatus(s) === s);

/** What each severity means to the person reporting it. */
export const PORTAL_SEVERITY_HINT: Record<Severity, string> = {
  critical: 'Down, data at risk, or a live campaign blocked.',
  medium: 'A major function is disrupted.',
  low: 'Limited impact, or there is a workaround.',
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
