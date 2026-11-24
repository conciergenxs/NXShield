import type { SlaPolicy, Ticket } from '../types';
import { isOpen, UNRATED_SEVERITY } from './domain';

const MIN = 60_000;

/** within / at_risk / breached apply to running clocks; met / missed to finished ones. */
export type SlaState = 'within' | 'at_risk' | 'breached' | 'met' | 'missed' | 'excluded';

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
  /** Initial response, T+1. */
  firstResponse: SlaClock;
  /** Initial RCA, T+3. */
  initialRca: SlaClock;
  resolution: SlaClock;
  /** The clock a support member should watch right now. */
  active: SlaClock;
  activeLabel: 'First response' | 'Initial RCA' | 'Resolution';
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
  // At risk once the policy's share of this clock's own time is used (half, by
  // default), so the colour always matches the meter of time left.
  const atRiskNow = used >= atRisk;
  return {
    targetMs,
    due,
    completedAt: null,
    remainingMs: due - now,
    used,
    state: now > due ? 'breached' : atRiskNow ? 'at_risk' : 'within',
  };
}

const WEIGHT: Record<SlaState, number> = { excluded: -1, met: 0, within: 1, at_risk: 2, missed: 3, breached: 4 };

/**
 * Targets are measured in elapsed time from ticket creation.
 * Business-hours calendars per policy are not applied yet.
 */
export function getSla(ticket: Ticket, policy: SlaPolicy, now: number): TicketSla {
  const target = policy.targets[ticket.severity ?? UNRATED_SEVERITY];
  const atRisk = policy.atRiskPercent / 100;
  const done = ticket.resolvedAt ?? ticket.canceledAt;
  const firstResponse = clock(ticket.createdAt, target.firstResponseMins, ticket.firstRespondedAt ?? (isOpen(ticket) ? null : done), now, atRisk);
  const initialRca = clock(ticket.createdAt, target.rcaMins, ticket.diagnosis?.at ?? (isOpen(ticket) ? null : done), now, atRisk);
  // P1's fix time comes from its initial RCA, once QA has set it.
  const fixMins = ticket.severity === 'critical' && ticket.diagnosis?.fixBy ? Math.max(1, (ticket.diagnosis.fixBy - ticket.createdAt) / MIN) : target.resolutionMins;
  const resolution = clock(ticket.createdAt, fixMins, isOpen(ticket) ? null : done, now, atRisk);
  const responsePending = firstResponse.completedAt == null;
  const rcaPending = !responsePending && initialRca.completedAt == null;
  const active = responsePending ? firstResponse : rcaPending ? initialRca : resolution;
  const activeLabel = responsePending ? 'First response' : rcaPending ? 'Initial RCA' : 'Resolution';
  // Outside the SLA: the clocks still show their times, but nothing counts as late.
  if (ticket.slaExclusion) {
    const off = (c: SlaClock): SlaClock => (c.completedAt == null ? { ...c, state: 'excluded' } : c);
    const pick = responsePending ? off(firstResponse) : rcaPending ? off(initialRca) : off(resolution);
    return { firstResponse: off(firstResponse), initialRca: off(initialRca), resolution: off(resolution), active: pick, activeLabel, overall: 'excluded' };
  }

  let overall = resolution.state;
  for (const c of [firstResponse, initialRca]) if (c.completedAt == null && WEIGHT[c.state] > WEIGHT[overall]) overall = c.state;

  return { firstResponse, initialRca, resolution, active, activeLabel, overall };
}

export const SLA_STATE_LABEL: Record<SlaState, string> = {
  within: 'Within SLA',
  at_risk: 'Approaching deadline',
  breached: 'Breached',
  met: 'Met',
  missed: 'Missed',
  excluded: 'Outside SLA',
};
