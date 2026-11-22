// Domain model for NXShield.
// Everything that belongs to a client carries a clientId so the same data can
// later be scoped per organization for the Client Portal.

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Category = 'tech' | 'business' | 'operational' | 'hardware';

export type TicketStatus =
  | 'new'
  | 'reopened'
  | 'in_progress'
  | 'blocked'
  | 'waiting_testing'
  | 'on_testing'
  | 'waiting_approval'
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
}

export interface Client {
  id: string;
  name: string;
  code: string;
  industry: string;
  city: string;
  /** Initials on a colour, or an uploaded image (a data URL) that replaces them. */
  logo: { initials: string; bg: string; fg: string; image?: string };
  contact: { name: string; title: string; email: string; phone: string };
  slaPolicyId: string;
  accountManagerId: string;
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
  firstResponseMins: number;
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
  | 'progress';

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

/** What NXS found and how it will fix it, shared with the client when work starts. */
export interface Diagnosis {
  issue: string;
  fix: string;
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

/** Sent to the client with a fix for approval: what changed, how to check it, and proof. */
export interface Handoff {
  id: string;
  note: string;
  attachments: Attachment[];
  by: Actor;
  at: number;
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
export interface Cancellation {
  by: Actor;
  reason: string;
  at: number;
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
  /** Priority P1 to P4, set by the impact questions. Only Tech issues have
   *  one; null for Operational and Hardware. Drives the SLA targets. */
  severity: Severity | null;
  assigneeId: string | null;
  firstRespondedAt: number | null;
  resolvedAt: number | null;
  canceledAt: number | null;
  cancellation: Cancellation | null;
  /** The client's approvals and declines of resolved fixes, oldest first. */
  feedback: ClientFeedback[];
  /** Every blocker the work has hit, oldest first. The last one is active while the status is Blocker. */
  blockers: Blocker[];
  /** Why the work went back or was reopened by NXS, newest last. */
  moveNotes: MoveNote[];
  /** Set when work starts: what is wrong and how NXS will fix it. */
  diagnosis?: Diagnosis;
  /** What NXS sent the client with each request for approval, newest last. */
  handoffs: Handoff[];
  attachments: Attachment[];
  activity: Activity[];
  /** Set for requests raised in the Client Portal. */
  request?: TicketRequest;
}

export type NotificationEventType =
  | 'ticket_created'
  | 'ticket_assigned'
  | 'status_updated'
  | 'sla_approaching'
  | 'sla_breached'
  | 'ticket_resolved'
  | 'ticket_canceled'
  | 'progress_update';

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
