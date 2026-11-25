import type { Ticket } from '../types';

const DAY = 24 * 60 * 60 * 1000;
const lower = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);
const firstSentence = (x: string) => (x.match(/^[^.!?]+[.!?]/)?.[0] ?? x).trim();

/** The image built from the approved fix: its repository, tagged with the ticket and when it was built. */
export function imageTagOf(repo: string, ticketId: string, builtAt: number): string {
  const d = new Date(builtAt);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${repo}:${ticketId.toLowerCase()}-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
}

/**
 * The release notes the client gets with the fix: not how to deploy it (NXS
 * deploys), but proof that it's fixed: what changed and how it was checked.
 */
const PAST: Record<string, string> = { find: 'found', fix: 'fixed', add: 'added', make: 'made', run: 'ran', trace: 'traced', check: 'checked', update: 'updated', remove: 'removed', correct: 'corrected', compare: 'compared', limit: 'limited', keep: 'kept', move: 'moved', show: 'showed', 're-sync': 're-synced', resync: 're-synced', clear: 'cleared', restore: 'restored', reprocess: 'reprocessed', match: 'matched', test: 'tested', backfill: 'backfilled', reproduce: 'reproduced', resend: 'resent', send: 'sent', rebuild: 'rebuilt', block: 'blocked', hide: 'hid', clean: 'cleaned', resize: 'resized', reorder: 'reordered', rerun: 'reran', recheck: 'rechecked', reset: 'reset', refresh: 'refreshed', recalculate: 'recalculated', retry: 'retried', confirm: 'confirmed', apply: 'applied', set: 'set', review: 'reviewed', restart: 'restarted', replace: 'replaced', adjust: 'adjusted', deploy: 'deployed', verify: 'verified', patch: 'patched', renew: 'renewed', rotate: 'rotated', upgrade: 'upgraded', validate: 'validated', change: 'changed', raise: 'raised', reduce: 'reduced', increase: 'increased', map: 'mapped', migrate: 'migrated', notify: 'notified', reconnect: 'reconnected', rename: 'renamed', rewrite: 'rewrote', point: 'pointed', align: 'aligned', handle: 'handled' };
/** The plan, as what was done: “Trace the orders, fix the step” becomes “traced the orders, fixed the step”. */
export const pastTense = (plan: string) => done(plan);
const done = (plan: string): string => plan.replace(/(^|,\s*(?:and\s+)?|\band\s+|\bthen\s+)([A-Za-z-]+)\b/g, (m, lead: string, verb: string) => (PAST[verb.toLowerCase()] ? `${lead}${PAST[verb.toLowerCase()]}` : m));

export function releaseNotesOf(t: Pick<Ticket, 'diagnosis' | 'title'>, assetName: string, checked: string): string {
  const fix = t.diagnosis?.fix ? done(lower(firstSentence(t.diagnosis.fix))).replace(/[.!?]$/, '') : `fixed ${lower(t.title)}`;
  const how = checked.trim() ? lower(checked.trim()).replace(/[.!?]$/, '') : 'we repeated the steps from your report on staging and the problem no longer happens';
  return `What we did on ${assetName}: we ${fix.replace(/^(we )/, '')}. How we checked it: ${how}. Approve the deploy and we put it live.`;
}

/**
 * When the full RCA goes to the client, from the SLA: P1 always, five days
 * after it's resolved; P2 ten days after, only for a security or data issue;
 * P3 ten days after, only when the issue keeps coming back.
 */
export function fullRcaPlan(t: Pick<Ticket, 'severity' | 'resolvedAt' | 'securityIssue' | 'recurring'>, recurring = !!t.recurring): { due: number | null; why: string } {
  const base = t.resolvedAt;
  if (t.severity === 'critical') return { due: base != null ? base + 5 * DAY : null, why: 'Every P1 gets one, five days after it’s resolved.' };
  if (t.severity === 'medium')
    return t.securityIssue ? { due: base != null ? base + 10 * DAY : null, why: 'It was a security or data issue, so it gets one, ten days after it’s resolved.' } : { due: null, why: 'A P2 gets one only if it was a security or data issue.' };
  return recurring ? { due: base != null ? base + 10 * DAY : null, why: 'The issue came back, so it gets one, ten days after it’s resolved.' } : { due: null, why: 'A P3 gets one only if the issue comes back.' };
}
