// Domain model for NXShield.
// Everything that belongs to a client carries a clientId so the same data can
// later be scoped per organization for the Client Portal.

/** P1 Critical, P2 Medium, P3 Low, as in the SLA. */
export type Severity = 'critical' | 'medium' | 'low';
/** Tech includes hardware: a device or network fault that stops someone using an asset. */
export type Category = 'tech' | 'business' | 'operational';

export type TicketStatus =
  | 'new'
  | 'not_started'
  | 'in_progress'
  | 'blocked'
  | 'waiting_testing'
  | 'on_testing'
  | 'qa_passed'
  | 'ready_to_deploy'
  | 'resolved'
  | 'canceled';

export type AssetStatus = 'operational' | 'degraded' | 'outage' | 'maintenance' | 'unknown';
export type AssetCategory = 'consumer_website' | 'marketing_dashboard' | 'omnichannel_dashboard' | 'lms_app';

export type Level = 'L1' | 'L2' | 'L3';
export type Availability = 'available' | 'busy' | 'away' | 'off_shift';

/** Internal roles are used today. Client roles are reserved for the Client Portal. */
export type Role = 'admin' | 'support_lead' | 'support_agent' | 'viewer' | 'client_admin' | 'client_user';

export type Permission =
  | 'ticket.create'
  | 'ticket.update'
  | 'ticket.assign'
  | 'ticket.cancel'
  | 'notes.internal'
  | 'clients.manage'
  | 'assets.manage'
  | 'sla.manage'
  | 'team.manage'
  | 'settings.manage';

export interface ClientUser {
  id: string;
  clientId: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  role: 'client_admin' | 'client_user';
  /** The categories this PIC raises tickets for; the new-ticket form offers only these. Set in Settings. */
  categories: Category[];
}

export interface Client {
  id: string;
  name: string;
  /** The company behind the brand, as the RCA reports name the client (CML is JTI's). Falls back to the name. */
  company?: string;
  code: string;
  industry: string;
  city: string;
  /** Initials on a colour, or an uploaded image (a data URL) that replaces them. */
  logo: { initials: string; bg: string; fg: string; image?: string };
  contact: { name: string; title: string; email: string; phone: string };
  slaPolicyId: string;
  /** The client's PM at NXS: reviews every new ticket's properties first. */
  accountManagerId: string;
  /** Who checks and tests this client's tickets (QA). */
  testerId: string;
  /** Who a ticket goes to, by the kind of work. */
  devs: Record<TaskType, string>;
  since: string;
  users: ClientUser[];
}

/** How NXShield learns whether an asset is live. Checked on a schedule, never set by hand. */
export type MonitorMethod = 'health_url' | 'status_api' | 'uptime_service';
export interface AssetMonitor {
  method: MonitorMethod;
  /** The URL NXShield calls on every check. */
  endpoint: string;
  intervalMins: number;
  /** A token is stored for the check; its value is never shown again. */
  hasToken: boolean;
}

export interface Asset {
  id: string;
  clientId: string;
  name: string;
  category: AssetCategory;
  url: string;
  environment: 'Production' | 'Staging';
  status: AssetStatus;
  statusNote: string;
  statusChangedAt: number;
  uptime30d: number | null;
  monitor?: AssetMonitor;
  /** The NXS team member plotted on this project. New tickets for it go to them. */
  ownerId: string;
}

export interface Department {
  id: string;
  name: string;
}

export interface TeamMember {
  id: string;
  name: string;
  title: string;
  role: Role;
  level: Level;
  departmentId: string;
  email: string;
  phone: string;
  availability: Availability;
  skills: Category[];
  /** Profile picture, when the person has uploaded one. */
  photo?: string;
}

export interface SlaTarget {
  /** Initial response: the first reply to the client (T+1). */
  firstResponseMins: number;
  /** Initial RCA: the issue, its cause and the fix plan (T+3). */
  rcaMins: number;
  resolutionMins: number;
}

export interface SlaPolicy {
  id: string;
  name: string;
  description: string;
  coverage: string;
  /** Share of the target that may elapse before a ticket counts as approaching its deadline. */
  atRiskPercent: number;
  targets: Record<Severity, SlaTarget>;
  isDefault: boolean;
}

export type Actor = { type: 'team'; id: string } | { type: 'client'; id: string } | { type: 'system' };

export type ActivityKind =
  | 'created'
  | 'status'
  | 'assignment'
  | 'severity'
  | 'resolution'
  | 'cancellation'
  | 'blocker'
  | 'reason'
  | 'handoff'
  | 'diagnosis'
  | 'progress'
  | 'exclusion'
  | 'rca'
  | 'response'
  | 'comment';

export interface Activity {
  id: string;
  at: number;
  actor: Actor;
  kind: ActivityKind;
  text: string;
  /** A fuller line for NXS staff when `text` is written for the client, e.g. naming internal stages. */
  staffText?: string;
  /** 'internal' entries must never be exposed to client users. */
  visibility: 'client' | 'internal';
}

/** The SLA's exclusions: when a ticket does not count against it. */
export type SlaExclusionKind = 'third_party' | 'client_side' | 'force_majeure' | 'maintenance' | 'change_request';

export interface SlaExclusion {
  kind: SlaExclusionKind;
  note: string;
  by: Actor;
  at: number;
}

/** The initial RCA: the likely cause and the plan, shared with the client. Due 3 hours after the ticket comes in. */
export interface Diagnosis {
  /** The problem in plain words, as the client is told it. */
  problem?: string;
  /** The cause. */
  issue: string;
  fix: string;
  /** When the fix is expected. For P1 this sets the fix deadline. */
  fixBy?: number;
  by: Actor;
  at: number;
}

export interface Attachment {
  id: string;
  name: string;
  size: string;
  kind: 'image' | 'doc' | 'log' | 'video';
  /** Where the file can be shown from. Uploads made in this session have one. */
  url?: string;
}

/** Sent to the client when the fix is ready to deploy: the full RCA document(s), with an optional note. */
export interface Handoff {
  id: string;
  /** Release notes, written by the AI when the fix was merged and checked by the developer: what changed. */
  note: string;
  /** QA's proof that it works, in their words; the screenshots and recordings are the attachments. Kept apart from the notes. */
  proofNote?: string;
  attachments: Attachment[];
  /** The container image the fix ships in. */
  imageTag?: string;
  by: Actor;
  at: number;
}

/** QA's result on staging: it works, with what they checked and any proof. */
/** What the AI makes when QA passes the fix and it is merged: the container image and the release notes. The developer checks them, asking the AI for changes. */
export interface ReleaseDraft {
  imageTag: string;
  notes: string;
  /** When the fix was merged, which is when QA passed it. */
  mergedAt: number;
}

/** QA's pass on staging: their proof that it works, as text and screenshots or recordings. Not the release notes. */
export interface TestResult {
  at: number;
  by: Actor;
  note: string;
  proof: Attachment[];
}

/** The reason given for a move back (rework) or a reopen. */
export interface MoveNote {
  id: string;
  from: TicketStatus;
  to: TicketStatus;
  reason: string;
  by: Actor;
  at: number;
}

/** One time the work was blocked, kept after it clears so blockers can be traced. */
export interface Blocker {
  id: string;
  /** What is blocking the work, in the words of whoever logged it. */
  details: string;
  by: Actor;
  at: number;
  clearedAt: number | null;
  clearedBy: Actor | null;
  /** How it was cleared, if anyone said. */
  clearNote: string;
  /** The stage the work was in when it got blocked; unblocking goes back there. */
  from?: TicketStatus;
}

/**
 * The client's answer to a fix marked resolved, written in the Client Portal.
 * Approving closes the ticket; declining reopens it and needs a reason.
 */
export interface ClientFeedback {
  id: string;
  at: number;
  /** Client user who answered. */
  by: string;
  decision: 'approved' | 'declined';
  /** Why the fix was declined. Optional when approving. */
  note: string;
  /** Screenshots or files the client added when declining. */
  attachments?: Attachment[];
}

/** Why and when a ticket was canceled: ended without doing the work. */
/**
 * The PM wasn't sure it is an issue and sent it to the business team to check
 * whether it is a feature request. Internal: the client sees it as submitted.
 */
export interface FeatureCheck {
  by: Actor;
  at: number;
  /** The business team's answer. A feature request is canceled with the reason; an issue goes back to the PM. */
  result?: { verdict: 'feature' | 'issue'; by: Actor; at: number; reason?: string };
}

/**
 * Checking the issue is real, in layers: QA first, then the assigned developer,
 * then the CTO. Each one not sure passes it up with what they checked; anyone
 * who confirms it starts the work. Only the CTO can cancel it. Internal.
 */
export interface IssueCheck {
  /** Who wasn't sure, oldest first: QA, then the developer. The layer now is one more than these. */
  unsure: { by: Actor; at: number; note: string; proof: Attachment[] }[];
}

export interface Cancellation {
  by: Actor;
  reason: string;
  at: number;
  /** Screenshots or a recording showing it isn't an issue, when QA cancels it after checking. */
  proof?: Attachment[];
}

/**
 * How a ticket reached NXS. Clients normally submit tickets themselves through
 * the Client Portal; anything else was logged by an NXS team member on the
 * client's behalf after the client reported it another way.
 */
export type TicketChannel = 'portal' | 'manual';

export interface TicketSource {
  channel: TicketChannel;
  /** Team member who logged the ticket. Null when the client submitted it in the portal. */
  loggedBy: string | null;
}

/** What a client is asking for when they raise a ticket in the portal. */
export type RequestType = 'issue' | 'scope_addition' | 'scope_change' | 'design' | 'technical' | 'content' | 'timeline' | 'commercial' | 'compliance';

/** The extra details a client gives with a request from the portal. */
export interface TicketRequest {
  type: RequestType;
  /** Why it is needed. Optional. */
  reason: string;
  /** The date the client would like it done by, if any. */
  neededBy: number | null;
  /** Who at the client asked for it: one portal account can stand for a whole team. */
  requestedBy: string;
  /** Links to briefs, mockups or screenshots. */
  references: string;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  clientId: string;
  assetId: string;
  category: Category;
  /** Client user who raised the ticket. Only this user can confirm a resolution. */
  reporterId: string;
  source: TicketSource;
  createdAt: number;
  updatedAt: number;
  status: TicketStatus;
  /** Priority P1 to P3, set by the two impact questions for every category.
   *  Null only on older tickets logged without one. Drives the SLA targets. */
  severity: Severity | null;
  assigneeId: string | null;
  /** The QA who checks the ticket when it comes in and tests the fix later. */
  testerId: string | null;
  /** What the AI set when the ticket came in, and when QA confirmed it. Internal. */
  triage?: TicketTriage;
  firstRespondedAt: number | null;
  resolvedAt: number | null;
  canceledAt: number | null;
  cancellation: Cancellation | null;
  /** Who has checked whether the issue is real so far, while Not started. */
  issueCheck?: IssueCheck;
  /** Sent to the business team as a possible feature request, while New. */
  featureCheck?: FeatureCheck;
  /** The client's approvals and declines of resolved fixes, oldest first. */
  feedback: ClientFeedback[];
  /** Every blocker the work has hit, oldest first. The last one is active while the status is Blocker. */
  blockers: Blocker[];
  /** Why the work went back or was reopened by NXS, newest last. */
  moveNotes: MoveNote[];
  /** Set when work starts: what is wrong and how NXS will fix it. */
  diagnosis?: Diagnosis;
  /** Marked outside the SLA, for one of the SLA's exclusions. Its clocks stop counting. */
  slaExclusion?: SlaExclusion;
  /** What NXS sent the client each time a fix was ready to deploy, newest last. */
  handoffs: Handoff[];
  attachments: Attachment[];
  activity: Activity[];
  /** Set for requests raised in the Client Portal. */
  request?: TicketRequest;
  /** How NXS plans the work. Internal: never shown in the Client Portal. */
  plan?: TicketPlan;
  /** The initial response, as sent. Sending it is the first response. */
  initialResponse?: InitialResponse;
  /** The team's edit of the AI's initial response before it goes out. Internal. */
  responseDraft?: string;
  /** The team's edit of the AI's full RCA, kept until it goes out with the fix. Internal until sent. */
  fullRcaDraft?: FullRcaContent;
  /** Comments, in two threads: with the client (they see it in the portal) and internal. */
  comments: Comment[];
  /** The team's edits to the AI's initial RCA before it is shared. Internal. */
  rcaDraft?: { problem?: string; issue: string; fix: string; hours?: number; at: number };
  /** Questions the team asked the AI about the RCA, and its answers. Internal. */
  rcaChat?: RcaExchange[];
  /** The AI's code fix as the developer last left it (after any revisions they asked for). Internal. */
  codeFix?: CodeFix;
  /** QA passed the fix on staging; the release goes to the client next. */
  testResult?: TestResult;
  /** The AI's container image and release notes, made at the merge, as the developer last left them. Internal until sent. */
  release?: ReleaseDraft;
  /** Marked as a security or data issue: a P2 then gets a full RCA too. */
  securityIssue?: boolean;
  /** The same issue came back after an earlier fix: a P3 then gets a full RCA too. */
  recurring?: boolean;
}

/** One line of a diff: added, removed, or unchanged context. */
export type DiffLine = { t: '+' | '-' | ' '; text: string };
export interface CodeFile {
  path: string;
  /** Short note on what changed in this file. */
  note: string;
  lines: DiffLine[];
}
/** A newer release of a package the fix uses. */
export interface PackageRelease {
  name: string;
  installed: string;
  latest: string;
  bump: 'patch' | 'minor' | 'major';
  /** What the new release brings, in a line. */
  note: string;
  maintainer: string;
  url: string;
}

/** What the fix touches and how risky it is, read from its files. */
export interface FixImpact {
  risk: 'low' | 'medium' | 'high';
  breaking: boolean;
  /** The parts of the app it touches. */
  areas: string[];
  /** Things worth knowing before approving it. */
  notes: string[];
}

/** The AI's code fix for a ticket: a branch, what it does, and the changed files. */
export interface CodeFix {
  repo: string;
  branch: string;
  /** Why the fix exists: its purpose, in a sentence or two. */
  summary: string;
  /** The pull request the AI opened for it. */
  pr: { number: number; title: string; commits: number };
  /** What changed, as short lines. */
  changes: string[];
  impact: FixImpact;
  /** Newer releases of packages the fix uses. */
  packages: PackageRelease[];
  files: CodeFile[];
  /** How many times the developer asked the AI to revise it. */
  revision: number;
  /** When the developer approved it and it went on staging. */
  stagedAt?: number;
  stagedBy?: Actor;
}

export interface RcaExchange {
  id: string;
  question: string;
  answer: string;
  /** Text the answer suggests for the initial RCA. */
  apply?: { issue?: string; fix?: string };
  by: Actor;
  at: number;
}

/** The full RCA: what really caused it, what was changed, and how it is kept from happening again. */
/** One line of a full RCA table: a label and its value. */
export type RcaRow = [string, string];

export interface RcaAction {
  action: string;
  type: 'Corrective' | 'Preventive' | 'Detective' | 'Process';
  owner: string;
  due: string;
  status: 'Open' | 'In progress' | 'Done';
}

/**
 * A full RCA, laid out as NXS's RCA report template: the header, then ten
 * sections. The AI drafts every part from the ticket; QA checks it and sends
 * it as a document with the fix. Names follow the dashboard's (ticket ID,
 * priority, asset); NXS staff appear by role, never by name.
 */
export interface FullRcaContent {
  header: RcaRow[];
  /** 1. Executive summary: what happened, impact, cause, current status, key prevention step. */
  summary: RcaRow[];
  /** 2. Incident details. */
  details: RcaRow[];
  /** 3. Timeline of events: time, event, who. */
  timeline: [string, string, string][];
  /** 4. Symptoms and evidence. */
  evidence: RcaRow[];
  /** 5. Root cause analysis. */
  method: string;
  whys: [string, string, string][];
  rootCause: string;
  factors: RcaRow[];
  wentWell: string;
  didntGoWell: string;
  /** 6. Resolution. */
  resolution: RcaRow[];
  steps: string[];
  /** 7. Corrective and preventive actions. */
  actions: RcaAction[];
  /** 8. Lessons learned. */
  lessons: string[];
  /** 9. Recurrence risk. */
  risk: RcaRow[];
  /** 10. Sign-off: role, name, date. */
  signoff: [string, string, string][];
}

/** The first reply to the client: they know it arrived, how it is rated and what comes next. */
export interface InitialResponse {
  text: string;
  by: Actor;
  at: number;
}

export interface Comment {
  id: string;
  /** 'client' is shared with the client in the portal; 'internal' never leaves NXS. */
  thread: 'client' | 'internal';
  by: Actor;
  at: number;
  text: string;
  /** What it replies to on the client's timeline: the initial RCA, or one fix sent (by its id). */
  on?: CommentOn;
  /** For a reply: the comment that starts its thread (replies sit one level under it, as on YouTube). */
  parentId?: string;
  /** For a reply: the comment it answers, which may itself be a reply; shows as "replying to …". */
  replyingTo?: string;
}
/** What a client comment is under on their timeline: the initial RCA, a fix sent to them, or the cancellation. */
export type CommentOn = { kind: 'rca' } | { kind: 'release'; id: string } | { kind: 'cancel' };

/** The AI's first read of a new ticket. QA checks it; anything still equal to it reads as set by AI until confirmed. */
export interface TicketTriage {
  assetId: string;
  category: Category;
  severity: Severity;
  assigneeId: string;
  confirmedAt?: number;
  confirmedBy?: Actor;
}

/** The kind of work a ticket needs, as the team splits it. */
export type TaskType = 'frontend' | 'backend';

/** NXS's own planning on a ticket, set by the team and edited in place. */
export interface TicketPlan {
  /** The weekly sprint it is planned in, e.g. "SP.26.11.19" (the sprint's first day). */
  sprint?: string;
  taskType?: TaskType;
  /** The estimate in story points, one point for one hour of work. */
  storyPoints?: number;
  /** The day the team expects to finish it, as the start of that day. */
  expectedBy?: number;
}

export type NotificationEventType =
  | 'ticket_created'
  | 'ticket_assigned'
  | 'status_updated'
  | 'sla_approaching'
  | 'sla_breached'
  | 'ticket_resolved'
  | 'ticket_canceled'
  | 'progress_update'
  | 'mention';

export type RecipientKind = 'assignee' | 'support_lead' | 'account_manager' | 'client_contact';

export interface AppNotification {
  id: string;
  type: NotificationEventType;
  ticketId: string;
  title: string;
  body: string;
  at: number;
  read: boolean;
}

export interface NotificationRule {
  event: NotificationEventType;
  enabled: boolean;
  recipients: RecipientKind[];
}

export interface DeliveryRecord {
  id: string;
  event: NotificationEventType;
  ticketId: string;
  channel: 'ava_whatsapp';
  recipientName: string;
  recipientPhone: string;
  message: string;
  status: 'simulated' | 'queued' | 'delivered' | 'failed';
  at: number;
}
