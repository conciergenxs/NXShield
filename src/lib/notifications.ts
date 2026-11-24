import type {
  AppNotification,
  Client,
  DeliveryRecord,
  NotificationEventType,
  NotificationRule,
  RecipientKind,
  TeamMember,
  Ticket,
} from '../types';
import { SEVERITY_LABEL, STATUS_LABEL } from './domain';

/**
 * Notification pipeline.
 *
 * A ticket event produces one in-app notification and, when the event is
 * enabled for WhatsApp, one outbound message per recipient. Outbound messages
 * go through a NotificationChannel. AVA is the only channel today and runs in
 * sandbox mode: messages are recorded in the delivery log, not sent.
 *
 * To go live, replace `avaWhatsApp.deliver` with a call to the AVA messaging
 * API and return the status it reports. Nothing else needs to change.
 */

export interface OutboundMessage {
  event: NotificationEventType;
  ticketId: string;
  recipientName: string;
  recipientPhone: string;
  text: string;
}

export interface NotificationChannel {
  id: DeliveryRecord['channel'];
  label: string;
  deliver(message: OutboundMessage): DeliveryRecord['status'];
}

export const avaWhatsApp: NotificationChannel = {
  id: 'ava_whatsapp',
  label: 'AVA WhatsApp',
  deliver: () => 'simulated',
};

export interface NotifyContext {
  clients: Client[];
  team: TeamMember[];
  rules: NotificationRule[];
}

let counter = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${++counter}`;

function describe(type: NotificationEventType, t: Ticket, ctx: NotifyContext, detail?: string) {
  const client = ctx.clients.find((c) => c.id === t.clientId)?.name ?? 'Client';
  const assignee = ctx.team.find((m) => m.id === t.assigneeId)?.name;
  switch (type) {
    case 'ticket_created':
      return { title: t.severity ? `New ${SEVERITY_LABEL[t.severity]} ticket from ${client}` : `New ticket from ${client}`, body: t.title };
    case 'ticket_assigned':
      return { title: `${t.id} assigned to ${assignee ?? 'support'}`, body: t.title };
    case 'status_updated':
      return { title: `${t.id} moved to ${STATUS_LABEL[t.status]}`, body: t.title };
    case 'sla_approaching':
      return { title: `${t.id} is approaching its SLA deadline`, body: detail ? `${detail}. ${t.title}` : t.title };
    case 'sla_breached':
      return { title: `${t.id} has breached SLA`, body: detail ? `${detail}. ${t.title}` : t.title };
    case 'ticket_resolved':
      return { title: `${t.id} resolved, awaiting client confirmation`, body: t.title };
    case 'ticket_canceled':
      return { title: `${t.id} canceled`, body: detail ? `${detail}. ${t.title}` : t.title };
    case 'progress_update':
      return { title: `${t.id}: progress update`, body: detail ?? t.title };
    case 'mention':
      return { title: `Mentioned on ${t.id}`, body: detail ?? t.title };
  }
}

/** Plain-text WhatsApp message body for an event. */
export function composeWhatsApp(type: NotificationEventType, t: Ticket, ctx: NotifyContext, detail?: string): string {
  const { title } = describe(type, t, ctx, detail);
  const client = ctx.clients.find((c) => c.id === t.clientId)?.name ?? '';
  return [`NXShield: ${title}`, `"${t.title}"`, `${client}, ${t.severity ? SEVERITY_LABEL[t.severity] : 'no priority'}`, detail ?? '', `Open ticket: nxshield.example/tickets/${t.id}`]
    .filter(Boolean)
    .join('\n');
}

function recipientsFor(kinds: RecipientKind[], t: Ticket, ctx: NotifyContext) {
  const client = ctx.clients.find((c) => c.id === t.clientId);
  const out: { name: string; phone: string }[] = [];
  const add = (name?: string, phone?: string) => {
    if (name && phone && !out.some((r) => r.phone === phone)) out.push({ name, phone });
  };
  for (const kind of kinds) {
    if (kind === 'assignee') {
      const m = ctx.team.find((x) => x.id === t.assigneeId);
      add(m?.name, m?.phone);
    } else if (kind === 'support_lead') {
      const m = ctx.team.find((x) => x.role === 'admin') ?? ctx.team.find((x) => x.role === 'support_lead');
      add(m?.name, m?.phone);
    } else if (kind === 'account_manager') {
      const m = ctx.team.find((x) => x.id === client?.accountManagerId);
      add(m?.name, m?.phone);
    } else if (kind === 'client_contact') {
      const reporter = client?.users.find((u) => u.id === t.reporterId);
      add(reporter?.name ?? client?.contact.name, reporter?.phone ?? client?.contact.phone);
    }
  }
  return out;
}

export function dispatch(
  type: NotificationEventType,
  ticket: Ticket,
  ctx: NotifyContext,
  at: number,
  detail?: string,
  read = false,
  /** NXS-only events (blocked, testing) never message the client. */
  internalOnly = false,
): { notification: AppNotification; deliveries: DeliveryRecord[] } {
  const { title, body } = describe(type, ticket, ctx, detail);
  const notification: AppNotification = { id: uid('ntf'), type, ticketId: ticket.id, title, body, at, read };

  const rule = ctx.rules.find((r) => r.event === type);
  const deliveries: DeliveryRecord[] = [];
  if (rule?.enabled) {
    const text = composeWhatsApp(type, ticket, ctx, detail);
    for (const r of recipientsFor(internalOnly ? rule.recipients.filter((k) => k !== 'client_contact') : rule.recipients, ticket, ctx)) {
      const message: OutboundMessage = { event: type, ticketId: ticket.id, recipientName: r.name, recipientPhone: r.phone, text };
      deliveries.push({
        id: uid('dlv'),
        event: type,
        ticketId: ticket.id,
        channel: avaWhatsApp.id,
        recipientName: r.name,
        recipientPhone: r.phone,
        message: text,
        status: avaWhatsApp.deliver(message),
        at,
      });
    }
  }
  return { notification, deliveries };
}
