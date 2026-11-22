import type { SlaPolicy, Ticket } from '../types';
import { isOpen, UNRATED_SEVERITY } from './domain';

const MIN = 60_000;

/** within / at_risk / breached apply to running clocks; met / missed to finished ones. */
export type SlaState = 'within' | 'at_risk' | 'breached' | 'met' | 'missed';

export interface SlaClock {
  targetMs: number;
  due: number;
  state: SlaState;
  /** Time left until the deadline; negative once overdue. For finished clocks, the margin at completion. */
  remainingMs: number;
  /** Share of the target used, 0–1+. */
  used: number;
  completedAt: number | null;
}

export interface TicketSla {
  firstResponse: SlaClock;
  resolution: SlaClock;
  /** The clock a support member should watch right now. */
  active: SlaClock;
  activeLabel: 'First response' | 'Resolution';
  /** Worst state across the clocks still running, or the resolution outcome once done. */
  overall: SlaState;
}

function clock(start: number, targetMins: number, completedAt: number | null, now: number, atRisk: number): SlaClock {
  const targetMs = targetMins * MIN;
  const due = start + targetMs;
  if (completedAt != null) {
    return {
      targetMs,
      due,
      completedAt,
      remainingMs: due - completedAt,
      used: (completedAt - start) / targetMs,
      state: completedAt <= due ? 'met' : 'missed',
    };
  }
  const used = (now - start) / targetMs;
  return {
    targetMs,
    due,
    completedAt: null,
    remainingMs: due - now,
    used,
    state: now > due ? 'breached' : used >= atRisk ? 'at_risk' : 'within',
  };
}

const WEIGHT: Record<SlaState, number> = { met: 0, within: 1, at_risk: 2, missed: 3, breached: 4 };

/**
 * Targets are measured in elapsed time from ticket creation.
 * Business-hours calendars per policy are not applied yet.
 */
export function getSla(ticket: Ticket, policy: SlaPolicy, now: number): TicketSla {
  const target = policy.targets[ticket.severity ?? UNRATED_SEVERITY];
  const atRisk = policy.atRiskPercent / 100;
  const done = ticket.resolvedAt ?? ticket.canceledAt;
  const firstResponse = clock(ticket.createdAt, target.firstResponseMins, ticket.firstRespondedAt ?? (isOpen(ticket) ? null : done), now, atRisk);
  const resolution = clock(ticket.createdAt, target.resolutionMins, isOpen(ticket) ? null : done, now, atRisk);

  const responsePending = firstResponse.completedAt == null;
  const active = responsePending ? firstResponse : resolution;
  let overall = resolution.state;
  if (responsePending && WEIGHT[firstResponse.state] > WEIGHT[overall]) overall = firstResponse.state;

  return { firstResponse, resolution, active, activeLabel: responsePending ? 'First response' : 'Resolution', overall };
}

export const SLA_STATE_LABEL: Record<SlaState, string> = {
  within: 'Within SLA',
  at_risk: 'Approaching deadline',
  breached: 'Breached',
  met: 'Met',
  missed: 'Missed',
};
