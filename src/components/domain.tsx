import { Link } from 'react-router-dom';
import { Ban, Briefcase, CircleCheck, CircleX, ClipboardList, Clock, CodeXml, FlaskConical, HardDrive, Hourglass, Inbox, ListChecks, Loader, OctagonAlert, RotateCcw, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { AssetStatus, Category, Client, Severity, TeamMember, Ticket, TicketStatus } from '../types';
import { ASSET_STATUS_LABEL, CATEGORY_LABEL, NO_PRIORITY_LABEL, SEVERITY_LABEL, STATUS_LABEL, portalStatus } from '../lib/domain';
import { fmtDuration } from '../lib/format';
import { SLA_STATE_LABEL, type SlaClock, type SlaState, type TicketSla } from '../lib/sla';
import { useStore } from '../store';
import { Avatar, Badge, cx, type Tone } from './ui';
import { statusLabelFor, useTicketScope } from './scope';

/* ---------- Severity ---------- */

/* A warm ramp from most to least urgent; the bar icon repeats the level. */
const SEVERITY_TONE: Record<Severity, Tone> = { critical: 'red', high: 'orange', medium: 'yellow', low: 'neutral' };
const SEVERITY_BARS: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/** Four ascending bars; the number filled encodes the level without relying on colour. */
export function SeverityBars({ level }: { level: Severity }) {
  const n = SEVERITY_BARS[level];
  return (
    <svg className="sev-bars" width="14" height="12" viewBox="0 0 14 12" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={i * 3.7} y={9 - i * 3} width="2.6" height={3 + i * 3} rx="1" fill="currentColor" opacity={i < n ? 1 : 0.22} />
      ))}
    </svg>
  );
}

export function SeverityBadge({ severity }: { severity: Severity | null }) {
  if (!severity) return <Badge tone="neutral">{NO_PRIORITY_LABEL}</Badge>;
  return (
    <Badge tone={SEVERITY_TONE[severity]} icon={<SeverityBars level={severity} />}>
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}

/* ---------- Status ---------- */

/** One icon per stage, used where a stage heads a group of tickets. */
export const STATUS_ICON: Record<TicketStatus, LucideIcon> = {
  new: Inbox,
  reopened: RotateCcw,
  in_progress: Loader,
  blocked: OctagonAlert,
  waiting_testing: ListChecks,
  on_testing: FlaskConical,
  waiting_approval: Hourglass,
  resolved: CircleCheck,
  canceled: Ban,
};

/* One colour per stage, none shared: blue for incoming, red when it comes
   back, pink while someone works on it, orange when it is stuck, indigo and
   teal through testing, yellow while it waits on the client, purple when
   solved (the positive colour used across the dashboard), grey if canceled. */
export const STATUS_TONE: Record<TicketStatus, Tone> = {
  new: 'blue',
  reopened: 'red',
  in_progress: 'pink',
  blocked: 'orange',
  waiting_testing: 'indigo',
  on_testing: 'teal',
  waiting_approval: 'yellow',
  resolved: 'purple',
  canceled: 'neutral',
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  const { portal } = useTicketScope();
  return (
    <Badge tone={STATUS_TONE[portal ? portalStatus(status) : status]} dot>
      {statusLabelFor(portal, status)}
    </Badge>
  );
}

const ASSET_TONE: Record<AssetStatus, Tone> = { operational: 'green', degraded: 'orange', outage: 'red', maintenance: 'blue', unknown: 'neutral' };

export function AssetStatusBadge({ status, plain }: { status: AssetStatus; plain?: boolean }) {
  if (plain) {
    return (
      <span className={cx('status-plain', `tone-${ASSET_TONE[status]}`)}>
        <span className="badge-dot" aria-hidden />
        {ASSET_STATUS_LABEL[status]}
      </span>
    );
  }
  return (
    <Badge tone={ASSET_TONE[status]} dot>
      {ASSET_STATUS_LABEL[status]}
    </Badge>
  );
}

/* ---------- Category ---------- */

const CATEGORY_ICON = { tech: CodeXml, business: Briefcase, operational: ClipboardList, hardware: HardDrive } as const;

export function CategoryLabel({ category, short }: { category: Category; short?: boolean }) {
  const Icon = CATEGORY_ICON[category];
  return (
    <span className="category">
      <Icon size={15} aria-hidden />
      {short ? CATEGORY_LABEL[category].replace(' issue', '') : CATEGORY_LABEL[category]}
    </span>
  );
}

/* ---------- SLA ---------- */

export const SLA_TONE: Record<SlaState, Tone> = { within: 'purple', at_risk: 'orange', breached: 'red', met: 'purple', missed: 'red' };

export function slaText(clock: SlaClock): string {
  switch (clock.state) {
    case 'within':
    case 'at_risk':
      return `${fmtDuration(clock.remainingMs)} left`;
    case 'breached':
      return `${fmtDuration(clock.remainingMs)} over`;
    case 'met':
      return 'Met';
    case 'missed':
      return `${fmtDuration(clock.remainingMs)} late`;
  }
}

const SLA_ICON = { within: Clock, at_risk: TriangleAlert, breached: CircleX, met: CircleCheck, missed: CircleX } as const;

/**
 * The SLA clock: a thin meter showing how much of the target has been used,
 * with the time remaining beside it. Used wherever a ticket is listed.
 */
export function SlaIndicator({ sla, showLabel }: { sla: TicketSla; showLabel?: boolean }) {
  const clock = sla.active;
  const running = clock.completedAt == null;
  const Icon = SLA_ICON[clock.state];
  const label = `${sla.activeLabel}: ${SLA_STATE_LABEL[clock.state]}, ${slaText(clock)}`;
  return (
    <span className={cx('sla', `tone-${SLA_TONE[clock.state]}`)} title={label} aria-label={label}>
      <Icon size={14} aria-hidden className="sla-icon" />
      <span className="sla-body">
        <span className="sla-text">
          {showLabel && running && <span className="sla-kind">{sla.activeLabel === 'First response' ? 'Response' : 'Resolve'}</span>}
          {slaText(clock)}
        </span>
        {running && (
          <span className="sla-meter" aria-hidden>
            <span style={{ width: `${Math.min(100, Math.max(4, clock.used * 100))}%` }} />
          </span>
        )}
      </span>
    </span>
  );
}

/* ---------- People and organizations ---------- */

export function ClientLogo({ client, size = 28 }: { client: Client; size?: number }) {
  const { logo } = client;
  return (
    <span
      className={cx('client-logo', logo.image && 'has-image')}
      aria-hidden
      style={{ width: size, height: size, background: logo.image ? undefined : logo.bg, color: logo.fg, fontSize: Math.round(size * 0.38) }}
    >
      {logo.image ? <img src={logo.image} alt="" /> : logo.initials}
    </span>
  );
}

export function ClientCell({ clientId, link }: { clientId: string; link?: boolean }) {
  const { clientOf } = useStore();
  const client = clientOf(clientId);
  if (!client) return <span className="muted">Unknown client</span>;
  const inner = (
    <>
      <ClientLogo client={client} size={22} />
      <span className="truncate">{client.name}</span>
    </>
  );
  return link ? (
    <Link to={`/clients/${client.id}`} className="person link-quiet" onClick={(e) => e.stopPropagation()}>
      {inner}
    </Link>
  ) : (
    <span className="person">{inner}</span>
  );
}

export function Assignee({ member, size = 24, showLevel }: { member: TeamMember | undefined; size?: number; showLevel?: boolean }) {
  if (!member) {
    return (
      <span className="person unassigned">
        <span className="avatar avatar-empty" aria-hidden style={{ width: size, height: size }} />
        Unassigned
      </span>
    );
  }
  return (
    <span className="person">
      <Avatar name={member.name} size={size} src={member.photo} />
      <span className="truncate">{member.name}</span>
      {showLevel && <span className="level-tag">{member.level}</span>}
    </span>
  );
}

/** Stage label for resolved tickets that are still waiting on the client. */
export function awaitingConfirmation(t: Ticket) {
  return t.status === 'resolved';
}
