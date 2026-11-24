import type { Category, Severity, TaskType, Ticket, TicketPlan } from '../types';
import { sprintOf } from './domain';
import type { TicketSla } from './sla';

/* The team's planning on a ticket is filled in for them the moment the ticket
   is created, so nobody starts from a blank form:
   - Sprint plan: the weekly sprint the ticket came in.
   - Task type: read from the ticket's words (data and syncs are backend,
     screens and pages are frontend).
   - Story points: a first estimate from its priority and kind of work.
   - Expected done: the SLA's resolution deadline.
   Anyone at NXS can change any of them; a change replaces the automatic value. */

const FRONTEND_WORDS = /page|menu|mobile|widget|thumbnail|pdf|certificate|video|screen|image|checkout|banner|hero|chart|tooltip|filter|form|display|layout|firefox|safari|chrome|button|blank|shows|showing/i;

const BACKEND_WORDS = /sync|token|api|connector|feed|import|email|time(s)? out|timeout|duplicat|report|calculat|not saved|sign in|login|session|stock|orders|data|points|roas|attribution|spend|count/i;

export function taskTypeFor(title: string, description: string, category: Category): TaskType {
  // What the title says it is about wins: data and syncs are backend even when a widget shows them.
  if (BACKEND_WORDS.test(title)) return 'backend';
  return FRONTEND_WORDS.test(`${title} ${description}`) ? 'frontend' : 'backend';
}

/** Hours of work, one story point each: bigger for higher priority, a little more for backend. */
export function estimateFor(severity: Severity | null, taskType: TaskType): number {
  const base = { critical: 4, medium: 3, low: 2 }[severity ?? 'low'];
  return Math.max(1, base + (taskType === 'backend' ? 1 : 0));
}

export function autoPlan(t: Pick<Ticket, 'title' | 'description' | 'category' | 'severity' | 'createdAt'>): TicketPlan {
  const taskType = taskTypeFor(t.title, t.description, t.category);
  return { sprint: sprintOf(t.createdAt), taskType, storyPoints: estimateFor(t.severity, taskType) };
}

/** When the work should be done: the team's own date if they set one, otherwise the SLA's resolution deadline. */
export function expectedDone(t: Ticket, sla: TicketSla): { at: number; fromSla: boolean } {
  return t.plan?.expectedBy != null ? { at: t.plan.expectedBy, fromSla: false } : { at: sla.resolution.due, fromSla: true };
}

/** A build tag in the team's usual shape, e.g. nxs-tech/cml/cml-frontend:20261120-1015. */
export function buildTagFor(clientId: string, type: TaskType, at: number): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `nxs-tech/${clientId}/${clientId}-${type}:${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
}
