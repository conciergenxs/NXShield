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
 * The release notes the client gets with the fix, written by the AI when the
 * fix is merged: what changed. Not how to deploy it (NXS deploys), and not how
 * it was tested: that is QA's proof, which goes beside the notes.
 */
const PAST: Record<string, string> = { find: 'found', fix: 'fixed', add: 'added', make: 'made', run: 'ran', trace: 'traced', check: 'checked', update: 'updated', remove: 'removed', correct: 'corrected', compare: 'compared', limit: 'limited', keep: 'kept', move: 'moved', show: 'showed', 're-sync': 're-synced', resync: 're-synced', clear: 'cleared', restore: 'restored', reprocess: 'reprocessed', match: 'matched', test: 'tested', backfill: 'backfilled', reproduce: 'reproduced', resend: 'resent', send: 'sent', rebuild: 'rebuilt', block: 'blocked', hide: 'hid', clean: 'cleaned', resize: 'resized', reorder: 'reordered', rerun: 'reran', recheck: 'rechecked', reset: 'reset', refresh: 'refreshed', recalculate: 'recalculated', retry: 'retried', confirm: 'confirmed', apply: 'applied', set: 'set', review: 'reviewed', restart: 'restarted', replace: 'replaced', adjust: 'adjusted', deploy: 'deployed', verify: 'verified', patch: 'patched', renew: 'renewed', rotate: 'rotated', upgrade: 'upgraded', validate: 'validated', change: 'changed', raise: 'raised', reduce: 'reduced', increase: 'increased', map: 'mapped', migrate: 'migrated', notify: 'notified', reconnect: 'reconnected', rename: 'renamed', rewrite: 'rewrote', point: 'pointed', align: 'aligned', handle: 'handled' };
/** The plan, as what was done: “Trace the orders, fix the step” becomes “traced the orders, fixed the step”. */
export const pastTense = (plan: string) => done(plan);
const done = (plan: string): string => plan.replace(/(^|,\s*(?:and\s+)?|\band\s+|\bthen\s+)([A-Za-z-]+)\b/g, (m, lead: string, verb: string) => (PAST[verb.toLowerCase()] ? `${lead}${PAST[verb.toLowerCase()]}` : m));

export function releaseNotesOf(t: Pick<Ticket, 'diagnosis' | 'title'>, assetName: string, checked: string): string {
  const fix = t.diagnosis?.fix ? done(lower(firstSentence(t.diagnosis.fix))).replace(/[.!?]$/, '') : `fixed ${lower(t.title)}`;
  // What changed, only. How it was checked is QA's proof, sent beside the notes, not in them.
  const how = checked.trim() ? ` How we checked it: ${lower(checked.trim()).replace(/[.!?]$/, '')}.` : '';
  return `What we did on ${assetName}: we ${fix.replace(/^(we )/, '')}.${how} Approve the deploy and we put it live.`;
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

/* ---------- Changing the release by asking the AI ---------- */

export type ReleasePart = 'tag' | 'notes';
const CLOSING = 'Approve the deploy and we put it live.';
const PLAIN: [RegExp, string][] = [
  [/payment gateway/gi, 'bank payment service'],
  [/re-synced/gi, 'sent again'],
  [/re-sync(ed)?/gi, 'send again'],
  [/\bsync(s|ed|ing)?\b/gi, 'update$1'],
  [/\bmapping\b/gi, 'link between the two systems'],
  [/\bthe job\b/gi, 'the scheduled process'],
  [/\bendpoint\b/gi, 'connection'],
  [/\bcache\b/gi, 'saved copy'],
  [/\bquery\b/gi, 'lookup'],
  [/\bbackfill(ed)?\b/gi, 'filled in the missing data'],
  [/\bstaging\b/gi, 'our test copy of the site'],
  [/\bconnector\b/gi, 'link to the other system'],
];

/**
 * The AI's change to the release from a plain instruction, simulated like the
 * rest: rebuild or set the image, shorten or simplify the notes, or add a
 * point to them. It says what it changed; an instruction it can't place
 * changes nothing.
 */
export function reviseRelease(
  r: { imageTag: string; notes: string; mergedAt: number },
  instruction: string,
  ctx: { repo: string; ticketId: string; now: number },
): { release: typeof r; changed: ReleasePart[]; reply: string } {
  const q = instruction.trim();
  const low = q.toLowerCase();
  const explicit = q.match(/[\w.-]+\/[\w./-]+:[\w.-]+/)?.[0];
  if (explicit) return { release: { ...r, imageTag: explicit }, changed: ['tag'], reply: `Set the image to ${explicit}.` };
  if (/rebuil|new build|latest|retag|re-tag|\btag\b|image|registry/.test(low)) {
    const imageTag = imageTagOf(ctx.repo, ctx.ticketId, ctx.now);
    return imageTag === r.imageTag
      ? { release: r, changed: [], reply: 'The image is already built from the latest merge.' }
      : { release: { ...r, imageTag }, changed: ['tag'], reply: `Rebuilt the image from the latest merge: ${imageTag}.` };
  }
  if (/short|brief|ringkas|pendek|concise/.test(low)) {
    const did = firstSentence(r.notes.replace(/How we checked it:[^.]*\.\s*/i, ''));
    const notes = `${did} ${CLOSING}`.replace(/\s+/g, ' ').trim();
    return notes === r.notes ? { release: r, changed: [], reply: 'The notes are already as short as they go.' } : { release: { ...r, notes }, changed: ['notes'], reply: 'Cut the notes down to what changed.' };
  }
  if (/less technical|simpl|plain|non.?tech|awam|easier/.test(low)) {
    const notes = PLAIN.reduce((x, [re, to]) => x.replace(re, to), r.notes);
    return notes === r.notes ? { release: r, changed: [], reply: 'The notes already read in plain words.' } : { release: { ...r, notes }, changed: ['notes'], reply: 'Swapped the technical words for plain ones.' };
  }
  const add = q.match(/^(?:please\s+)?(?:mention|add|include|say|tambah(?:kan)?)\s+(?:that\s+)?(.+)$/i)?.[1];
  if (add) {
    const point = `${add.charAt(0).toUpperCase()}${add.slice(1).replace(/[.!?]*$/, '')}.`;
    const notes = r.notes.includes(CLOSING) ? r.notes.replace(CLOSING, `${point} ${CLOSING}`) : `${r.notes} ${point}`;
    return { release: { ...r, notes }, changed: ['notes'], reply: 'Added it to the notes.' };
  }
  return { release: r, changed: [], reply: 'I couldn’t tell what to change. Try “Shorter”, “Less technical”, “Rebuild the image”, or “Mention …”.' };
}

/**
 * QA's proof as the AI drafts it, like a commit message: what was repeated on
 * staging and what was seen. QA edits it or leaves it out; it's optional.
 */
export function proofDraftOf(t: Pick<Ticket, 'title'>, assetName: string): string {
  const what = t.title.trim().replace(/[.!?]+$/, '');
  return `Repeated the steps from the report on the ${assetName} staging site, on desktop and on a phone. “${what}” no longer happens: it works as it should now.`;
}
