import type { FeatureCheck, IssueCheck,
  Activity,
  Actor,
  AssetCategory,
  Attachment,
  Category,
  ClientFeedback,
  Cancellation,
  Comment,
  Severity,
  Ticket,
  TicketChannel,
  TicketStatus,
} from '../types';
import { startOfDay } from '../lib/format';
import { autoPlan, taskTypeFor } from '../lib/plan';
import { pmFor, routeTo, testerFor } from '../lib/intake';
import { problemOf, responseDraftOf } from '../lib/rcaAi';
import { imageTagOf, releaseNotesOf } from '../lib/release';
import { REPO } from '../lib/codeFix';
import { PROGRESS_EVERY_MINS, PROGRESS_STAGES, draftDiagnosis, progressUpdate, stepUpdate } from '../lib/assist';
import { DAY, HOUR, LOADED_AT, MIN, assets, clients, policies, team } from './seed';

const NOW = LOADED_AT;

const memberById = new Map(team.map((m) => [m.id, m]));
const assetById = new Map(assets.map((a) => [a.id, a]));
const clientById = new Map(clients.map((c) => [c.id, c]));

const reporterName = (d: Draft) => clientById.get(d.clientId)?.users.find((u) => u.id === d.reporterId)?.name ?? 'the client';

const teamActor = (id: string): Actor => ({ type: 'team', id });
const AI: Actor = { type: 'system' };

/* Who does what on a client's tickets: the PM reviews, QA checks and tests, a developer fixes. */
const pmOf = (d: Pick<Draft, 'clientId'>) => pmFor(clientById.get(d.clientId)!);
const testerOf = (d: Pick<Draft, 'clientId'>) => testerFor(clientById.get(d.clientId)!);

/** When QA confirmed the issue and it went to the developer: a little after the PM's review. */
function qaAt(d: Draft): number | null {
  const rv = d.reviewedAt;
  if (rv == null || d.status === 'new' || d.status === 'not_started' || d.issueCheck || d.featureCheck) return null;
  const end = d.firstResolvedAt ?? d.resolvedAt ?? d.canceledAt ?? NOW;
  return rv + Math.min(20 * MIN, Math.max(2 * MIN, (end - rv) * 0.15));
}

/** When the developer sent the initial RCA: after QA's check, well inside T+3, before any later step. */
function rcaAt(d: Draft): number | null {
  const qa = qaAt(d);
  if (qa == null || !d.assigneeId || d.rcaPending) return null;
  const end = d.firstResolvedAt ?? d.resolvedAt ?? d.canceledAt ?? NOW;
  return qa + Math.min(40 * MIN, Math.max(60_000, (end - qa) * 0.2));
}

/** The initial response, as the AI wrote and sent it the moment the ticket came in. */
function responseText(d: Draft): string {
  const reporter = clientById.get(d.clientId)?.users.find((u) => u.id === d.reporterId);
  return responseDraftOf(d, assetById.get(d.assetId)?.name ?? 'your asset', reporter?.name.split(' ')[0] ?? 'there', d.createdAt + 3 * HOUR);
}
const clientActor = (id: string): Actor => ({ type: 'client', id });

interface Draft {
  title: string;
  description: string;
  clientId: string;
  assetId: string;
  category: Category;
  severity: Severity;
  status: TicketStatus;
  assigneeId: string | null;
  createdAt: number;
  /** The AI's initial response: sent the moment the ticket came in. */
  firstRespondedAt: number | null;
  /** When the PM reviewed the properties and it moved to Not started. */
  reviewedAt: number | null;
  /** In progress, but the developer hasn't sent the initial RCA yet. */
  rcaPending?: boolean;
  security?: boolean;
  recurring?: boolean;
  /** QA passed it on staging: their proof that it works, and when. */
  passed?: { note: string; at: number };
  resolvedAt: number | null;
  /** Set when the ticket was resolved once and later reopened. */
  firstResolvedAt?: number;
  reopenedAt?: number;
  /** Why the client declined the fix, when they reopened it. */
  declineNote?: string;
  canceledAt: number | null;
  cancellation: Cancellation | null;
  /** Who wasn't sure it's an issue, in layers, before the CTO decided. */
  issueCheck?: IssueCheck;
  /** Sent to the business team as a possible feature request. */
  featureCheck?: FeatureCheck;
  reporterId: string;
  channel: TicketChannel;
  attachments: Attachment[];
  triageBy: string;
  /** The active blocker, for tickets sitting in Blocked. */
  blocker?: { details: string; at: number };
  /** What NXS sent the client with the fix, for tickets ready to deploy. */
  handoff?: { note: string; files: Attachment[]; proof?: string; at: number };
  comments?: Comment[];
}

let seq = 0;
/** Stands in for the release's id in sample replies, until the release exists. */
const RELEASE = '__release';
const nextId = (prefix: string) => `${prefix}${++seq}`;

/**
 * Every report comes with a screen recording of the incident, as the form asks
 * for one: the report's own videos, or one named after the title. Only videos:
 * the form takes nothing else.
 */
function recordingsOf(d: Pick<Draft, 'title' | 'attachments'>): Attachment[] {
  const videos = d.attachments.filter((a) => a.kind === 'video');
  if (videos.length) return videos;
  const slug = d.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(Boolean).slice(0, 4).join('-');
  const mb = 1.2 + ([...d.title].reduce((n, c) => n + c.charCodeAt(0), 0) % 80) / 10;
  return [{ id: nextId('att-'), name: `${slug}-recording.mp4`, size: `${mb.toFixed(1)} MB`, kind: 'video' }];
}


function buildActivity(d: Draft): Activity[] {
  const acts: Activity[] = [];
  const push = (at: number, actor: Actor, kind: Activity['kind'], text: string, visibility: Activity['visibility'] = 'client') =>
    acts.push({ id: nextId('act-'), at, actor, kind, text, visibility });

  const reporter = clientActor(d.reporterId);
  if (d.channel === 'portal') push(d.createdAt, reporter, 'created', 'Submitted from the Client Portal');
  else push(d.createdAt, teamActor(d.triageBy), 'created', `Logged by NXS on behalf of ${reporterName(d)}`);

  const firstDone = d.firstResolvedAt ?? d.resolvedAt;
  const end = firstDone ?? d.canceledAt ?? NOW;
  const QA = testerOf(d);
  // The AI reads the ticket the moment it comes in and sets its properties; the PM reviews them first.
  if (d.assigneeId) {
    const m = memberById.get(d.assigneeId)!;
    push(d.createdAt + 1000, AI, 'assignment', `AI suggested ${m.name} as the developer. Waiting for ${memberById.get(pmOf(d))?.name ?? 'the PM'} to review.`, 'internal');
  }
  // The AI's initial response goes out on its own, with no one to confirm it.
  if (d.firstRespondedAt != null) push(d.firstRespondedAt, AI, 'response', responseText(d));
  // The PM's review hands it to QA; QA's check hands it to the developer.
  if (d.reviewedAt != null) push(d.reviewedAt, teamActor(pmOf(d)), 'status', 'Status changed from New to Not started');
  const fr = qaAt(d);
  if (fr != null) push(fr, teamActor(QA), 'status', 'Status changed from Not started to In progress', 'internal');
  if (fr != null && d.assigneeId) {
    const m = memberById.get(d.assigneeId)!;
    const span = Math.max(end - fr, 4 * MIN);
    // Blocked and testing are NXS's own steps, so they stay internal.
    const by = teamActor(m.id);
    if (d.status === 'blocked' && d.blocker) {
      push(d.blocker.at, by, 'status', 'Status changed from In progress to Blocked', 'internal');
      push(d.blocker.at + 1000, by, 'blocker', `Blocker: ${d.blocker.details}`, 'internal');
    }
    const past = (s: TicketStatus[]) => s.includes(d.status);
    if (past(['waiting_testing', 'on_testing', 'qa_passed', 'ready_to_deploy'])) {
      push(fr + span * 0.45, by, 'status', 'Status changed from In progress to Waiting for testing', 'internal');
      push(fr + span * 0.45 + 1000, by, 'progress', stepUpdate('in_progress', 'waiting_testing')!);
    }
    if (past(['on_testing', 'qa_passed', 'ready_to_deploy'])) {
      push(fr + span * 0.55, teamActor(QA), 'status', 'Status changed from Waiting for testing to On testing', 'internal');
      push(fr + span * 0.55 + 1000, by, 'progress', stepUpdate('waiting_testing', 'on_testing')!);
    }
    if (d.status === 'qa_passed') {
      push(fr + span * 0.8, teamActor(QA), 'status', 'Status changed from On testing to Release check', 'internal');
      push(fr + span * 0.8 + 1000, by, 'progress', stepUpdate('on_testing', 'qa_passed')!);
    }
    // Testing passed: the developer sends the release to the client to approve the deploy.
    if (d.status === 'ready_to_deploy') {
      push(fr + span * 0.6, teamActor(QA), 'status', 'Status changed from On testing to Release check', 'internal');
      push(fr + span * 0.65, teamActor(d.assigneeId), 'status', 'Status changed from Release check to Ready to deploy');
    }
    if (d.status === 'ready_to_deploy' && d.handoff) push(d.handoff.at, teamActor(d.assigneeId), 'handoff', 'Sent the release to the client to approve the deploy');
  }
  // The fix goes to the client first; once they approve it, it is resolved.
  // A reopened ticket was declined during client review.
  if (firstDone != null && d.assigneeId) {
    const sentAt = d.reopenedAt != null ? firstDone : firstDone - Math.min(3 * HOUR, (firstDone - (fr ?? d.createdAt)) * 0.25);
    const gap = Math.min(2 * HOUR, (sentAt - (fr ?? d.createdAt)) * 0.4);
    push(sentAt - gap, teamActor(d.assigneeId), 'status', 'Status changed from In progress to Waiting for testing', 'internal');
    push(sentAt - gap + 1000, teamActor(d.assigneeId), 'progress', stepUpdate('in_progress', 'waiting_testing')!);
    push(sentAt - gap * 0.6, teamActor(d.assigneeId), 'status', 'Status changed from Waiting for testing to On testing', 'internal');
    push(sentAt - gap * 0.6 + 1000, teamActor(d.assigneeId), 'progress', stepUpdate('waiting_testing', 'on_testing')!);
    push(sentAt - gap * 0.3, teamActor(QA), 'status', 'Status changed from On testing to Release check', 'internal');
    push(sentAt, teamActor(d.assigneeId), 'status', 'Status changed from Release check to Ready to deploy');
    // The client approves the deploy; NXS puts it live, which resolves it.
    if (d.reopenedAt == null) {
      push(firstDone - Math.min(40 * MIN, (firstDone - sentAt) * 0.5), reporter, 'status', `${reporterName(d)} approved the deploy. NXS deploys it next.`);
      push(firstDone, teamActor(d.assigneeId), 'resolution', 'Deployed. Status changed from Ready to deploy to Resolved');
    }
  }
  if (d.reopenedAt != null) {
    push(d.reopenedAt, reporter, 'status', 'Declined the fix. Status changed from Ready to deploy to In progress');
  }
  // Not sure it's an issue: up a layer each time, QA to the developer to the CTO.
  (d.issueCheck?.unsure ?? []).forEach((u, i) => {
    const to = i === 0 ? memberById.get(d.assigneeId ?? '') : [...memberById.values()].find((m) => /chief technology officer/i.test(m.title));
    push(u.at, u.by, 'reason', `Not sure it’s an issue, so ${to?.name ?? 'the next person'} checks it. What was checked: ${u.note}`, 'internal');
  });
  if (d.featureCheck) push(d.featureCheck.at, d.featureCheck.by, 'reason', 'Marked as a possible feature request and sent to the business team', 'internal');
  if (d.cancellation && d.canceledAt != null) push(d.canceledAt, d.cancellation.by, 'cancellation', `Canceled. Reason: ${d.cancellation.reason}`);
  // Starting work told the client what was wrong and how it would be fixed.
  const found = diagnosisOf(d);
  if (found) push(found.at, found.by, 'diagnosis', `What we found: ${found.issue} How we’ll fix it: ${found.fix}`);
  acts.sort((a, b) => a.at - b.at);

  // While work moves, an update went out at the priority's cadence.
  const every = PROGRESS_EVERY_MINS[d.severity];
  if (PROGRESS_STAGES.includes(d.status) && every) {
    const stageStart = [...acts].reverse().find((a) => a.kind === 'status')?.at ?? d.createdAt;
    const client = clientById.get(d.clientId)!;
    const target = policies.find((p) => p.id === client.slaPolicyId)!.targets[d.severity];
    const fixDue = d.createdAt + target.resolutionMins * MIN;
    const times: number[] = [];
    for (let at = stageStart + every * MIN; at <= NOW; at += every * MIN) times.push(at);
    for (const at of times.slice(-6)) {
      const { client: text, staff } = progressUpdate(d.status, stageStart, fixDue, at);
      acts.push({ id: nextId('act-'), at, actor: { type: 'system' }, kind: 'progress', text, staffText: staff, visibility: 'client' });
    }
  }
  return acts.sort((a, b) => a.at - b.at);
}

/** What was found and the plan: the AI's draft, reviewed and sent by the developer. */
function diagnosisOf(d: Draft) {
  const at = rcaAt(d);
  if (at == null || !d.assigneeId) return undefined;
  const assetName = assetById.get(d.assetId)?.name ?? 'the asset';
  const { issue, fix } = draftDiagnosis(d, assetName);
  return { problem: problemOf(d, assetName), issue, fix, by: teamActor(d.assigneeId), at: at + 500 };
}

function buildFeedback(d: Draft): ClientFeedback[] {
  const out: ClientFeedback[] = [];
  if (d.reopenedAt != null) out.push({ id: nextId('fb-'), at: d.reopenedAt, by: d.reporterId, decision: 'declined', note: d.declineNote ?? 'The issue is still happening.' });
  // Approval comes before Resolved: the client's go-ahead is what resolves it.
  const approved = d.reopenedAt == null && d.resolvedAt != null && d.status === 'resolved';
  if (approved) out.push({ id: nextId('fb-'), at: d.resolvedAt!, by: d.reporterId, decision: 'approved', note: '' });
  return out;
}

function finalize(d: Draft, id: string): Ticket {
  const activity = buildActivity(d);
  const ticket: Ticket = {
    id,
    title: d.title,
    description: d.description,
    clientId: d.clientId,
    assetId: d.assetId,
    category: d.category,
    reporterId: d.reporterId,
    source: { channel: d.channel, loggedBy: d.channel === 'portal' ? null : d.triageBy },
    createdAt: d.createdAt,
    updatedAt: activity[activity.length - 1].at,
    status: d.status,
    severity: d.severity,
    assigneeId: d.assigneeId,
    testerId: testerOf(d),
    // A ticket still in New has only the AI's read so far; the PM hasn't reviewed it.
    triage: d.status === 'new' && d.assigneeId ? { assetId: d.assetId, category: d.category, severity: d.severity, assigneeId: d.assigneeId } : undefined,
    firstRespondedAt: d.firstRespondedAt,
    resolvedAt: d.resolvedAt,
    canceledAt: d.canceledAt,
    cancellation: d.cancellation,
    issueCheck: d.issueCheck,
    featureCheck: d.featureCheck,
    feedback: buildFeedback(d),
    diagnosis: diagnosisOf(d),
    blockers: d.blocker && d.assigneeId
      ? [{ id: nextId('blk-'), details: d.blocker.details, by: teamActor(d.assigneeId), at: d.blocker.at, clearedAt: null, clearedBy: null, clearNote: '', from: 'in_progress' }]
      : [],
    moveNotes: [],
    handoffs: d.handoff && d.assigneeId ? [releaseOf(d, d.handoff.at, id)] : verifiedFor(d, id),
    attachments: recordingsOf(d),
    comments: d.comments ?? [],
    activity,
  };
  if (d.status === 'qa_passed' && d.passed) {
    const shot = `${d.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').slice(0, 3).join('-')}-on-staging.png`;
    ticket.testResult = { at: d.passed.at, by: teamActor(testerOf(d)), note: d.passed.note || 'Repeated the steps from the report on staging, on desktop and on a phone. It works as it should now.', proof: [{ id: nextId('att-'), name: shot, size: '410 KB', kind: 'image' }] };
  }
  if (d.security) ticket.securityIssue = true;
  if (d.recurring) ticket.recurring = true;
  const lastRelease = ticket.handoffs[ticket.handoffs.length - 1];
  ticket.comments = ticket.comments.map((c) => (c.on?.kind === 'release' && c.on.id === RELEASE ? { ...c, on: lastRelease ? { kind: 'release', id: lastRelease.id } : { kind: 'rca' } } : c));
  if (d.firstRespondedAt != null) ticket.initialResponse = { text: responseText(d), by: AI, at: d.firstRespondedAt };
  return ticket;
}

/** A resolved ticket passed testing before the client deployed it: what was checked, with proof. */
function verifiedFor(d: Draft, id: string): Ticket['handoffs'] {
  if (d.status !== 'resolved' || d.resolvedAt == null || !d.assigneeId) return [];
  return [releaseOf(d, d.resolvedAt - Math.min(3 * HOUR, (d.resolvedAt - d.createdAt) * 0.25), id)];
}

/** What the developer sent the client with the fix: the image and release notes as proof. */
function releaseOf(d: Draft, at: number, id: string): Ticket['handoffs'][number] {
  const assetName = assetById.get(d.assetId)?.name ?? 'the asset';
  const t = { title: d.title, diagnosis: diagnosisOf(d), clientId: d.clientId, plan: { taskType: taskTypeFor(d.title, d.description, d.category) } };
  // QA's proof from staging: a screenshot of it working.
  const shot = `${d.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').slice(0, 4).join('-')}-fixed-on-staging.png`;
  const proof: Attachment[] = d.handoff?.files.length ? d.handoff.files : [{ id: nextId('att-'), name: shot, size: '380 KB', kind: 'image' }];
  // QA's words on what they checked: kept apart from the release notes, which are the AI's.
  const proofNote = d.handoff?.proof || d.passed?.note || `Repeated the steps from the report on staging, on desktop and on a phone. It works as it should now.`;
  return { id: nextId('hof-'), note: d.handoff?.note || releaseNotesOf(t, assetName, ''), proofNote, attachments: proof, imageTag: imageTagOf(`nxs-tech/${REPO[assetById.get(d.assetId)?.category ?? 'consumer_website']}`, id, at), by: teamActor(d.assigneeId ?? testerOf(d)), at };
}

/* ---------- Who reports ---------- */

/** As the SLA docs say: a ticket is logged by the JTI PIC of its category. */
const PIC_BY_CATEGORY: Partial<Record<string, Record<Category, string[]>>> = {
  cml: { tech: ['cu-cml-1', 'cu-cml-2', 'cu-cml-3'], business: ['cu-cml-4', 'cu-cml-5'], operational: ['cu-cml-4', 'cu-cml-5'] },
  // Aroma Abadi follows the same SLA and PIC set as CML for now.
  aroma: { tech: ['cu-aroma-1', 'cu-aroma-2', 'cu-aroma-3'], business: ['cu-aroma-4', 'cu-aroma-5'], operational: ['cu-aroma-4', 'cu-aroma-5'] },
};
function reporterFor(clientId: string, category: Category, n: number): string {
  const pics = PIC_BY_CATEGORY[clientId]?.[category];
  const client = clientById.get(clientId)!;
  return pics ? pics[n % pics.length] : client.users[n % client.users.length].id;
}

/** Links each reply to the comment it answers (by index), and to that comment's thread. */
function threaded(list: Comment[], replyTo: (number | undefined)[]): Comment[] {
  return list.map((c, i) => {
    const t = replyTo[i];
    if (t == null || !list[t]) return c;
    let root = t;
    while (replyTo[root] != null) root = replyTo[root]!;
    return { ...c, parentId: list[root].id, replyingTo: list[t].id };
  });
}

/* ---------- Active tickets (hand-authored) ---------- */

interface Spec {
  title: string;
  desc: string;
  asset: string;
  cat: Category;
  sev: Severity;
  status: TicketStatus;
  agoH: number;
  /** Minutes from creation to first response. Omit when still waiting. */
  frM?: number;
  resolvedAgoH?: number;
  reopenedAgoH?: number;
  /** The client's reason for declining the fix, written in the Client Portal. */
  declineNote?: string;
  reporter: number;
  /** Set when the client reported this outside the portal and NXS logged it. */
  via?: Exclude<TicketChannel, 'portal'>;
  files?: [string, string, Attachment['kind']][];
  /** Left past its deadline on purpose: one of the few overdue cases in the sample. */
  late?: boolean;
  /** In progress, but the developer hasn't sent the initial RCA yet. */
  rcaPending?: boolean;
  /** Resolved security or data issue (a P2 then gets a full RCA). */
  security?: boolean;
  /** The issue came back after an earlier fix (a P3 then gets a full RCA). */
  recurring?: boolean;
  /** For tickets in QA passed: QA's proof that it works, in their words (the release notes are the AI's). */
  passedNote?: string;
  /** For tickets in Blocked: what is blocking it, and since how many hours ago. */
  blocker?: [details: string, agoH: number];
  /** For tickets ready to deploy: the note sent to the client, and its files. */
  /** The release that went to the client: the release notes (what changed), proof files, and QA's proof note (what they checked). */
  handoff?: [note: string, files?: [string, string, Attachment['kind']][], proof?: string];
  /** Comments: the thread, who wrote it ('reporter', 'assignee' or a team member id), how many hours ago, and the text. */
  /** who: 'reporter', 'assignee', a team member id, or a client user id (cu-…). replyTo: the index of the comment it answers. */
  comments?: [thread: Comment['thread'], who: string, agoH: number, text: string, on?: 'rca' | 'release' | 'cancel', replyTo?: number][];
  /** Canceled: who did it ('tm-…'), how many hours ago, and the reason the client sees. */
  cancel?: { by: string; agoH: number; reason: string };
  /** Canceled by the CTO after the check went up: QA's, then the developer's notes, and how many hours ago. */
  unsure?: [note: string, agoH: number][];
  /** Canceled as a feature request: how many hours ago the PM sent it to the business team. */
  feature?: { sentAgoH: number };
}

const ACTIVE: Spec[] = [
  /* Canceled: QA and the developer weren't sure, and the CTO found it isn't an issue. */
  {
    title: 'Wishlist count shows 0 after adding items',
    desc: 'The heart icon in the header shows 0 even after I add products to my wishlist. The wishlist page itself lists them.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'low', status: 'canceled', agoH: 12, frM: 18, reporter: 1,
    unsure: [
      ['Added items on desktop and on a phone; the count went up each time. Couldn’t get it to show 0.', 10],
      ['The count and the wishlist page read the same API, and both match in the logs for this account. Not sure what the client saw.', 7],
    ],
    comments: [
      ['client', 'reporter', 3.4, 'Ah, that makes sense. One of our tabs was signed in with the shared store account.', 'cancel'],
      ['client', 'tm-riyan', 3.1, 'No problem. If the count is wrong on a single account, report it again with a screen recording and we’ll pick it up.', 'cancel', 0],
    ],
    cancel: {
      by: 'tm-riyan',
      agoH: 4,
      reason: 'Could not be reproduced. The items were saved while signed in with a second account; the count was right for the account that was signed in.',
    },
  },
  /* Canceled as a feature request: the PM sent it to the business team, who confirmed it's new work. */
  {
    title: 'ROAS report has no breakdown by campaign objective',
    desc: 'We need ROAS split by campaign objective (awareness, traffic, conversion). Right now the report only shows one ROAS figure per channel.',
    asset: 'AST-CML-02', cat: 'business', sev: 'low', status: 'canceled', agoH: 7, frM: 12, reporter: 0,
    feature: { sentAgoH: 5 },
    comments: [
      ['client', 'reporter', 1.6, 'Understood. Can you send the proposal before our Q1 planning on the 28th?', 'cancel'],
      ['client', 'tm-adra', 1.3, 'Yes. We’ll send it by Thursday, with the effort and a timeline.', 'cancel', 0],
      ['client', 'cu-cml-5', 1.0, 'Please start with the conversion objective. That’s the one the brand team reviews every week.', 'cancel', 0],
    ],
    cancel: {
      by: 'tm-adra',
      agoH: 2,
      reason: 'This is a feature request, not a fault: the report has never split ROAS by campaign objective. Our business team will scope it with you as new work.',
    },
  },
  /* CML, Consumer Website */
  {
    title: 'Checkout shows a blank page after choosing bank transfer',
    desc: 'Customers who pick bank transfer at checkout get a blank white page instead of the virtual account number. Card and e-wallet payments work. We are losing orders from the evening traffic.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'critical', status: 'new', agoH: 0.18, reporter: 1,
    files: [['blank-checkout-recording.mp4', '4.2 MB', 'video']],
  },
  {
    title: 'Payment confirmation times out for some orders',
    desc: 'Roughly 1 in 12 orders hangs on the "Confirming your payment" screen and then shows a timeout. The payment is captured, but the order stays in "Pending payment" until our finance team reconciles it manually.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'medium', status: 'in_progress', agoH: 5.5, frM: 22, reporter: 1,
    files: [['timeout-recording.mp4', '6.1 MB', 'video'], ['affected-orders.csv', '7 KB', 'doc']],
  },
  {
    title: 'Flash sale stock counts out of sync with the warehouse feed',
    desc: 'Tonight\'s flash sale SKUs show 0 stock on the website although the warehouse feed reports 300+ units each. The sale starts at 20:00 and the affected SKUs are the headline products.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'medium', status: 'not_started', agoH: 0.8, frM: 12, via: 'manual', reporter: 1,
    files: [['warehouse-feed-export.csv', '112 KB', 'doc']],
  },
  {
    title: 'Product reviews widget shows reviews from the wrong product',
    desc: 'On several serum product pages the reviews section shows reviews written for the cleanser range. It was fixed on Friday but is happening again on newly added variants.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'low', status: 'in_progress', agoH: 58, frM: 150, resolvedAgoH: 30, reopenedAgoH: 5, reporter: 1,
    declineNote: 'The original three pages are correct now, but the new 30 ml variants added yesterday show cleanser reviews again. Please cover new variants too.',
    comments: [
      ['internal', 'assignee', 3, 'New variants inherit the parent SKU, so the widget looks up the wrong product. Fixing the lookup instead of patching each page.'],
      ['client', 'assignee', 2.5, 'Thanks, we found why the new variants were missed and are fixing it for every variant, including ones you add later.'],
    ],
  },
  {
    title: 'Promo price for the 11.11 bundle still showing after the campaign ended',
    desc: 'The 11.11 bundle is still listed at the campaign price of Rp 189.000. The campaign ended on the 12th and the price should have switched back to Rp 235.000 automatically.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'low', status: 'new', agoH: 3, reporter: 0,
  },
  {
    title: 'Mobile menu covers the cart button on small screens',
    desc: 'On phones narrower than 380 px the open menu sits on top of the cart button, so shoppers cannot reach their cart without closing the menu first.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'low', status: 'on_testing', agoH: 14, frM: 110, reporter: 2,
    files: [['menu-overlap-iphone-se.png', '320 KB', 'image']],
  },
  {
    title: 'Homepage hero shows an empty block on phones',
    desc: 'Since Monday\'s content update the homepage hero shows as an empty grey block on phones. Desktop shows the banner and its link to the campaign page works.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'low', status: 'waiting_testing', agoH: 30, frM: 300, via: 'manual', reporter: 0,
    files: [['hero-empty-mobile.png', '410 KB', 'image']],
  },
  {
    title: 'Size guide link opens a blank pop-up on product pages',
    desc: 'On every product page the "Size guide" link opens an empty white pop-up. It used to show the size chart. Customers are asking customer service for sizes instead.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'low', status: 'qa_passed', agoH: 26, frM: 40, reporter: 1,
    files: [['size-guide-blank.png', '230 KB', 'image']],
    passedNote: 'The size guide opens with the right chart again on every product page we tried, on desktop and on a phone. The pop-up also closes with the back button now.',
  },
  {
    title: 'Store locator map shows no pins outside Jakarta',
    desc: 'The store locator lists every outlet, but the map only shows pins for Jakarta. Outlets in Bandung, Surabaya and Medan have no pin, so shoppers there see an empty map.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'low', status: 'waiting_testing', agoH: 17.5, frM: 50, reporter: 1,
    files: [['store-locator-empty-map.png', '520 KB', 'image']],
  },
  {
    title: 'Checkout down for all card payments during the 11.11 sale',
    desc: 'From 21:05 on 11 November every card payment failed with "Payment could not be processed". Bank transfer still worked. It was the busiest hour of the sale.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'critical', status: 'resolved', agoH: 176, frM: 20, resolvedAgoH: 170, reporter: 2,
    files: [['card-payment-error.png', '260 KB', 'image']],
  },
  {
    // Resolved just over five days ago, so its full RCA went out an hour ago: the top of the portal's Done tab.
    title: 'Customers logged out and unable to sign back in on the website',
    desc: 'Since 02:40 every customer is logged out, and the sign-in page says "Something went wrong" even with the right password. Guests can still place orders, but members cannot see their points or past orders.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'critical', status: 'resolved', agoH: 127, frM: 12, resolvedAgoH: 121, reporter: 2,
    files: [['sign-in-error.png', '240 KB', 'image'], ['sign-in-loop.mp4', '2.1 MB', 'video']],
  },
  {
    title: 'Product search returns nothing for any keyword',
    desc: 'Since this morning the search bar returns "No products found" for every keyword, even product names. Shoppers can still browse by category.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'critical', status: 'resolved', agoH: 30, frM: 15, resolvedAgoH: 22, reporter: 2,
    files: [['search-no-results.mp4', '3.2 MB', 'video']],
  },
  {
    title: 'Customer emails visible in the shared campaign report link',
    desc: 'The campaign report link we share with our agency shows a column of customer emails that was not there before. The agency should only see totals.',
    asset: 'AST-CML-02', cat: 'tech', sev: 'medium', status: 'resolved', agoH: 50, frM: 30, resolvedAgoH: 40, reporter: 2, security: true,
    files: [['shared-report-emails-column.png', '330 KB', 'image']],
  },
  {
    title: 'Banner carousel stops on the second slide again',
    desc: 'The homepage carousel stops on the second slide again, like in October. It was fixed then but is back since the new banners went up.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'low', status: 'resolved', agoH: 40, frM: 60, resolvedAgoH: 26, reporter: 2, recurring: true,
    files: [['carousel-stuck.mp4', '2.6 MB', 'video']],
  },
  {
    title: 'Order confirmation emails delayed by up to 40 minutes',
    desc: 'Customers are receiving order confirmation emails 30 to 40 minutes after paying. Several called customer service to check whether their order went through.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'medium', status: 'resolved', agoH: 30, frM: 55, resolvedAgoH: 8, via: 'manual', reporter: 0,
  },
  {
    title: 'Broken product thumbnails on search results in Firefox',
    desc: 'Product thumbnails show as broken images in Firefox on the search results page. Chrome and Safari are fine.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'low', status: 'resolved', agoH: 60, frM: 420, resolvedAgoH: 20, reporter: 2,
  },

  /* CML, Marketing-Tech Dashboard */
  {
    title: 'Dashboard widgets time out for date ranges over 60 days',
    desc: 'Every widget on the campaign overview times out when the date range is longer than 60 days. We need the quarter view for Monday\'s business review.',
    asset: 'AST-CML-02', cat: 'tech', sev: 'medium', status: 'in_progress', agoH: 9, frM: 18, reporter: 2,
  },
  {
    title: 'Meta Ads spend not syncing since Thursday\'s token refresh',
    desc: 'The Meta Ads spend widget has shown no new data since Thursday. Google and TikTok spend are updating. We need complete numbers for Monday\'s campaign review.',
    asset: 'AST-CML-02', cat: 'tech', sev: 'medium', status: 'blocked', agoH: 40, frM: 95, reporter: 2,
    blocker: ['The new connector needs the shared Meta app upgraded to API v21 first. The platform team is on it this sprint.', 6],
    comments: [
      ['client', 'reporter', 5, 'Is there an estimate? We need the Meta numbers for Monday’s campaign review.'],
      ['client', 'assignee', 4.5, 'We’re waiting on an upgrade to the shared Meta app, expected Thursday. We’ll backfill the missing days as soon as it’s in, so Monday’s numbers will be complete.'],
      ['internal', 'assignee', 4, 'Platform team confirmed the API v21 upgrade lands Thursday morning. I’ll run the backfill right after.'],
    ],
  },
  {
    title: 'ROAS figures leave out marketplace orders',
    desc: 'ROAS on the dashboard only counts website orders. Orders from Shopee and Tokopedia that came from our ads are missing, so ROAS looks about 30% lower than it is.',
    asset: 'AST-CML-02', cat: 'tech', sev: 'low', status: 'new', agoH: 1.5, reporter: 2, late: true,
  },
  {
    title: 'Monthly attribution report email not delivered to marketing leads',
    desc: 'The scheduled monthly attribution report did not reach the three marketing leads on the 1st. The report itself is available in the dashboard.',
    asset: 'AST-CML-02', cat: 'tech', sev: 'low', status: 'in_progress', agoH: 52, frM: 380, reporter: 0,
  },
  {
    title: 'TikTok Ads spend shows zero in Spend by channel',
    desc: 'TikTok Ads has shown Rp 0 spend since 1 November in Spend by channel, although Ads Manager shows the campaigns running. Meta and Google are correct.',
    asset: 'AST-CML-02', cat: 'tech', sev: 'low', status: 'ready_to_deploy', agoH: 44, frM: 170, reporter: 2,
    files: [['spend-by-channel-zero.png', '310 KB', 'image'], ['tiktok-ads-manager-export.csv', '14 KB', 'doc']],
    handoff: ['TikTok Ads spend comes through again and has been backfilled from 1 November. Approve the deploy and we put it live.', [['spend-by-channel-tiktok-fixed.png', '280 KB', 'image'], ['tiktok-backfill-check.mp4', '3.4 MB', 'video']], 'Checked on staging against your Ads Manager export: every day from 1 to 19 November now matches.'],
    comments: [
      ['client', 'reporter', 9, 'Thanks. Does the backfill also cover the campaigns we paused on 5 November?', 'release'],
      ['client', 'assignee', 8, 'Yes. Paused campaigns are included; their spend up to the pause date is back in the report.', 'release', 0],
      ['client', 'cu-cml-1', 7.5, 'Good to hear. Did the Meta and Google numbers move with this fix? Finance already closed October on them.', 'release', 1],
      ['client', 'assignee', 7, 'They didn’t. Only the TikTok rows changed; Meta and Google are exactly as before.', 'release', 2],
      ['client', 'reporter', 6, 'Great. Will the November total in the monthly report update on its own?', 'release'],
      ['client', 'cu-cml-2', 5.5, 'Same question here: we send that report to the brand team on Monday.', 'release', 4],
      ['client', 'assignee', 5, 'It will. Once the fix is live the monthly report rebuilds overnight with the corrected numbers, well before Monday.', 'release', 4],
      ['client', 'reporter', 20, 'The cause makes sense. Our token was renewed on 31 October, so the timing fits.', 'rca'],
    ],
  },
  {
    title: 'Voucher code field rejects codes typed in lowercase',
    desc: 'Customers typing a voucher code in lowercase get "Invalid code", while the same code in capitals works. Customer service is getting calls about the 12.12 codes we sent by SMS in lowercase.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'medium', status: 'ready_to_deploy', agoH: 20, frM: 40, reporter: 1,
    files: [['voucher-invalid-lowercase.png', '240 KB', 'image'], ['voucher-checkout-recording.mp4', '5.8 MB', 'video']],
    handoff: ['Voucher codes are now accepted in any mix of capitals and lowercase, and spaces around the code are ignored. Approve the deploy and we put it live.', [['voucher-lowercase-accepted.png', '210 KB', 'image'], ['voucher-fixed-checkout.mp4', '4.1 MB', 'video']], 'Tried the 12.12 codes from your SMS on staging, on desktop and on a phone: each one applied its discount.'],
    comments: [['client', 'reporter', 3, 'Can you confirm codes with a space at the end also work? Some customers copy them from WhatsApp.', 'release']],
  },

  /* Aroma Abadi, Omnichannel Dashboard */
  {
    title: 'Marketplace orders stopped syncing after the connector upgrade',
    desc: 'Since the marketplace connector was upgraded this morning, no new Shopee or Tokopedia orders appear in the omnichannel dashboard. Store teams cannot pick and pack marketplace orders.',
    asset: 'AST-ARA-01', cat: 'tech', sev: 'critical', status: 'in_progress', agoH: 1.4, frM: 6, rcaPending: true, via: 'manual', reporter: 2,
    comments: [['internal', 'assignee', 1, 'Rolled the connector back on staging and orders sync again. Testing the same rollback on production next.']],
    files: [['connector-error-log.txt', '18 KB', 'log']],
  },
  {
    title: 'Shopee and Tokopedia stock differ from the warehouse count',
    desc: 'Stock shown for 40 best sellers on Shopee and Tokopedia is lower than the warehouse count in the dashboard. Several products show as sold out on the marketplaces while we have stock.',
    asset: 'AST-ARA-01', cat: 'tech', sev: 'medium', status: 'not_started', agoH: 0.8, frM: 15, reporter: 3,
    files: [['stock-mismatch.xlsx', '46 KB', 'doc']],
  },
  {
    title: 'Customer chat inbox duplicates WhatsApp messages',
    desc: 'Every WhatsApp message from customers appears twice in the shared inbox, and agents are replying twice to the same question.',
    asset: 'AST-ARA-01', cat: 'tech', sev: 'medium', status: 'in_progress', agoH: 7, frM: 35, reporter: 3,
  },
  {
    title: 'Store filter leaves out stores opened after October',
    desc: 'The three Bandung stores opened in November (Paris Van Java, Trans Studio and Festival Citylink) don\'t appear in the store filter, so their sales can\'t be viewed on their own. Store codes are in the attachment.',
    asset: 'AST-ARA-01', cat: 'tech', sev: 'low', status: 'on_testing', agoH: 28, frM: 130, via: 'manual', reporter: 2,
    files: [['bandung-store-codes.xlsx', '12 KB', 'doc']],
  },
  {
    title: 'Loyalty points not credited on orders paid with a voucher',
    desc: 'Members who use a voucher on a fragrance order get no loyalty points for it. Orders without a voucher earn points as normal.',
    asset: 'AST-ARA-01', cat: 'tech', sev: 'low', status: 'ready_to_deploy', agoH: 10, frM: 45, reporter: 3,
    handoff: ['Orders paid partly with a voucher now earn points on the amount paid after the discount, and the points missed since 1 November have been added back. Try it on the staging store before we switch it on.', [['loyalty-points-test-cases.csv', '6 KB', 'doc']]],
  },
  {
    title: 'Sales by channel report counts returned orders twice',
    desc: 'Returned marketplace orders are counted as sales in the sales by channel report, and the refund is not subtracted. November revenue looks higher than our finance numbers.',
    asset: 'AST-ARA-01', cat: 'tech', sev: 'low', status: 'in_progress', agoH: 2.5, frM: 25, via: 'manual', reporter: 0,
  },
  {
    title: 'Member import skips phone numbers that start with +62',
    desc: 'Importing the member list from the mall activation event added only 430 of 1,200 members. Rows where the phone number starts with +62 were skipped without an error.',
    asset: 'AST-ARA-01', cat: 'tech', sev: 'low', status: 'resolved', agoH: 21, frM: 40, resolvedAgoH: 3, reporter: 3,
    files: [['event-members.xlsx', '310 KB', 'doc']],
  },

  /* Aroma Abadi, LMS App */
  {
    title: 'Training videos stop playing after two minutes on Android',
    desc: 'Fragrance advisors using Android phones report that product training videos freeze at around two minutes. iPhones and the web version play to the end.',
    asset: 'AST-ARA-02', cat: 'tech', sev: 'medium', status: 'in_progress', agoH: 4.5, frM: 15, reporter: 1,
    files: [['video-freeze-android.mp4', '8.4 MB', 'video']],
  },
  {
    title: 'Quiz scores not saved when advisors submit offline',
    desc: 'Advisors who finish a quiz without signal see their score, but it never reaches the training report once they are back online.',
    asset: 'AST-ARA-02', cat: 'tech', sev: 'low', status: 'new', agoH: 3.5, reporter: 1,
  },
  {
    title: 'Completion report includes advisors who have left',
    desc: 'The monthly completion report still lists 18 advisors who left the company, which brings the completion rate down for their stores.',
    asset: 'AST-ARA-02', cat: 'tech', sev: 'low', status: 'blocked', agoH: 80, frM: 240, reporter: 1,
    blocker: ['The report needs an “active advisor” flag that the LMS data model doesn’t have yet. Backend change is scoped for Thursday.', 9],
  },
  {
    title: 'New product module stuck on “Processing” after upload',
    desc: 'The Eau de Parfum product knowledge module (slides and quiz attached) has shown “Processing” for two days since it was uploaded, so advisors can\'t open it. The launch is next week.',
    asset: 'AST-ARA-02', cat: 'tech', sev: 'low', status: 'on_testing', agoH: 50, frM: 200, reporter: 1,
    files: [['edp-module-slides.pdf', '5.6 MB', 'doc']],
  },
  {
    title: 'Certificate PDF prints the advisor name in capitals',
    desc: 'Completion certificates print names in capitals, for example "SITI NURHALIZA". Please use the name as registered.',
    asset: 'AST-ARA-02', cat: 'tech', sev: 'low', status: 'in_progress', agoH: 131, frM: 600, reporter: 1,
  },
  {
    title: 'New hires cannot sign in with their employee ID',
    desc: 'Advisors who joined this month get "account not found" when they sign in with their employee ID. Older accounts are fine.',
    asset: 'AST-ARA-02', cat: 'tech', sev: 'low', status: 'resolved', agoH: 46, frM: 90, resolvedAgoH: 26, reporter: 2,
  },
];

/** Live tickets in the sample start inside their SLA: past at most half of each
 *  target, so nothing shows as overdue when the preview opens. The ticket's whole
 *  timeline (creation, first response, replies, reopening) is compressed by the
 *  same factor, so its story keeps its order. Finished history is left as it was. */
const LIVE_SHARE = 0.4;
function fitLive(s: Spec): Spec {
  if (s.status === 'resolved' || s.status === 'canceled' || s.late) return s;
  const client = clientById.get(assetById.get(s.asset)!.clientId)!;
  const target = policies.find((p) => p.id === client.slaPolicyId)!.targets[s.sev];
  const ageMins = s.agoH * 60;
  let k = Math.min(1, (target.resolutionMins * LIVE_SHARE) / ageMins);
  if (s.frM == null) {
    // Not answered yet: squeeze the age under the reply target, keeping each ticket's
    // place in the queue so they don't all land on the same minute.
    const cap = target.firstResponseMins * 0.7;
    k = Math.min(k, cap / (ageMins + cap));
  }
  else k = Math.min(k, (target.firstResponseMins * LIVE_SHARE) / s.frM);
  if (k >= 1) return s;
  return {
    ...s,
    agoH: s.agoH * k,
    frM: s.frM != null ? s.frM * k : undefined,
    resolvedAgoH: s.resolvedAgoH != null ? s.resolvedAgoH * k : undefined,
    reopenedAgoH: s.reopenedAgoH != null ? s.reopenedAgoH * k : undefined,
    blocker: s.blocker ? [s.blocker[0], s.blocker[1] * k] : undefined,
  };
}

function fromSpec(spec: Spec): Draft {
  // Every priority gets its first reply within an hour; the seed's replies land inside it.
  const s = fitLive({ ...spec, frM: spec.frM != null ? Math.min(spec.frM, 42) : undefined });
  const asset = assetById.get(s.asset)!;
  const client = clientById.get(asset.clientId)!;
  const createdAt = NOW - s.agoH * HOUR;
  const resolvedOnce = s.resolvedAgoH != null ? NOW - s.resolvedAgoH * HOUR : null;
  const reopened = s.reopenedAgoH != null;
  return {
    title: s.title,
    description: s.desc,
    clientId: client.id,
    assetId: asset.id,
    category: s.cat,
    severity: s.sev,
    status: s.status,
    // To the client's frontend or backend developer, as the AI routes it.
    assigneeId: routeTo(client, taskTypeFor(s.title, s.desc, s.cat)),
    createdAt,
    // The AI answers the moment it comes in; the PM's review is the first human step.
    firstRespondedAt: createdAt + MIN,
    // A feature request was canceled while New, before the PM's review.
    reviewedAt: s.frM != null && s.status !== 'new' && !s.feature ? createdAt + s.frM * MIN : null,
    rcaPending: s.rcaPending,
    security: s.security,
    recurring: s.recurring,
    passed: s.status === 'qa_passed' ? { note: s.passedNote ?? '', at: NOW - Math.min(s.agoH * 0.1, 0.6) * HOUR } : undefined,
    resolvedAt: reopened ? null : resolvedOnce,
    firstResolvedAt: reopened ? resolvedOnce ?? undefined : undefined,
    reopenedAt: reopened ? NOW - s.reopenedAgoH! * HOUR : undefined,
    declineNote: reopened ? s.declineNote : undefined,
    canceledAt: s.cancel ? NOW - s.cancel.agoH * HOUR : null,
    cancellation: s.cancel ? { by: teamActor(s.cancel.by), reason: s.cancel.reason, at: NOW - s.cancel.agoH * HOUR } : null,
    issueCheck: s.unsure
      ? {
          unsure: s.unsure.map(([note, agoH], i) => ({
            by: teamActor(i === 0 ? testerFor(client) : routeTo(client, taskTypeFor(s.title, s.desc, s.cat))),
            at: NOW - agoH * HOUR,
            note,
            proof: [],
          })),
        }
      : undefined,
    featureCheck:
      s.feature && s.cancel
        ? {
            by: teamActor(pmFor(client)),
            at: NOW - s.feature.sentAgoH * HOUR,
            result: { verdict: 'feature', by: teamActor(s.cancel.by), at: NOW - s.cancel.agoH * HOUR, reason: s.cancel.reason },
          }
        : undefined,
    reporterId: reporterFor(client.id, s.cat, s.reporter),
    channel: s.via ?? 'portal',
    attachments: (s.files ?? []).map(([name, size, kind]) => ({ id: nextId('att-'), name, size, kind })),
    triageBy: pmFor(client),
    blocker: s.blocker ? { details: s.blocker[0], at: NOW - s.blocker[1] * HOUR } : undefined,
    comments: threaded(
      (s.comments ?? []).map(([thread, who, agoH, text, on], i) => ({
        id: nextId('cmt-'),
        thread,
        // A client-thread comment is a reply on the client's timeline: under the initial RCA, or under the fix.
        ...(thread === 'client' ? { on: on === 'release' ? ({ kind: 'release', id: RELEASE } as const) : on === 'cancel' ? ({ kind: 'cancel' } as const) : ({ kind: 'rca' } as const) } : {}),
        by: who === 'reporter' ? clientActor(reporterFor(client.id, s.cat, s.reporter)) : who.startsWith('cu-') ? clientActor(who) : teamActor(who === 'assignee' ? routeTo(client, taskTypeFor(s.title, s.desc, s.cat)) : who),
        // Never before the ticket came in, and in the order written.
        at: Math.max(createdAt + (10 + i) * MIN, NOW - agoH * HOUR),
        text,
      })),
      (s.comments ?? []).map((c) => c[5]),
    ),
    // Sent at the same moment the status moved, as buildActivity places it.
    handoff:
      s.handoff && s.frM != null
        ? {
            note: s.handoff[0],
            files: (s.handoff[1] ?? []).map(([name, size, kind]) => ({ id: nextId('att-'), name, size, kind })),
            proof: s.handoff[2],
            at: createdAt + s.frM * MIN + Math.max(NOW - (createdAt + s.frM * MIN), 4 * MIN) * 0.65 + 1000,
          }
        : undefined,
  };
}

/* ---------- Ticket history (generated, deterministic per session) ---------- */

type Template = [title: string, category: Category];

const TEMPLATES: Record<AssetCategory, Template[]> = {
  consumer_website: [
    ['Product images fail to load on category pages', 'tech'],
    ['Search returns no results for multi-word queries', 'tech'],
    ['Checkout form loses data after a validation error', 'tech'],
    ['Page speed regression on product pages', 'tech'],
    ['Password reset link reported as expired immediately', 'tech'],
    ['Payment gateway callback returns an error for bank transfers', 'tech'],
    ['Contact form submissions not reaching the shared inbox', 'tech'],
    ['Shipping fee shown differs from the confirmed total', 'tech'],
    ['Voucher applied twice on a single order', 'tech'],
    ['Minimum purchase rule not enforced for a promo code', 'tech'],
    ['Redirects for retired product URLs return a 404', 'tech'],
  ],
  marketing_dashboard: [
    ['Dashboard widgets time out for long date ranges', 'tech'],
    ['Chart tooltips show UTC instead of WIB', 'tech'],
    ['Login session expires every 10 minutes', 'tech'],
    ['Scheduled PDF report renders blank pages', 'tech'],
    ['Conversion figures differ from the ad platform report', 'tech'],
    ['ROAS calculation excludes marketplace orders', 'tech'],
    ['Google Ads connector stops after its token expires', 'tech'],
    ['Data missing for last week after a sync failure', 'tech'],
  ],
  omnichannel_dashboard: [
    ['Marketplace orders arrive late in the dashboard', 'tech'],
    ['Customer chat inbox does not load older conversations', 'tech'],
    ['Order status not updated after the courier picks up', 'tech'],
    ['Stock sync skips products with variants', 'tech'],
    ['Sales by store totals differ from the POS report', 'tech'],
    ['Loyalty points not credited for marketplace orders', 'tech'],
    ['Discount rule applies to excluded products', 'tech'],
    ['Monthly data export for finance fails halfway', 'tech'],
  ],
  lms_app: [
    ['Training video does not play on some phones', 'tech'],
    ['Quiz progress lost when the app is closed', 'tech'],
    ['Push reminders not sent for overdue modules', 'tech'],
    ['Sign-in with employee ID fails for some advisors', 'tech'],
    ['Leaderboard points do not match quiz scores', 'tech'],
    ['Completion rate counts optional modules', 'tech'],
    ['Advisor directory missing stores added this month', 'tech'],
  ],
};

const SEVERITY_WEIGHTS: Record<Category, [Severity, number][]> = {
  tech: [['critical', 0.08], ['medium', 0.27], ['low', 0.65]],
  business: [['critical', 0.03], ['medium', 0.27], ['low', 0.7]],
  operational: [['critical', 0.02], ['medium', 0.2], ['low', 0.78]],
};

const ASSET_WEIGHT: Record<AssetCategory, number> = { consumer_website: 3, marketing_dashboard: 1.4, omnichannel_dashboard: 2, lms_app: 1.6 };

const CHANNEL_WEIGHTS: [TicketChannel, number][] = [['portal', 0.82], ['manual', 0.18]];

const CANCEL_REASONS = [
  'Client withdrew the request.',
  'Duplicate of an earlier ticket; work tracked there.',
  'Out of scope for the current contract.',
];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted<T>(rnd: () => number, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r <= 0) return item;
  }
  return items[items.length - 1][0];
}

function generateHistory(): Draft[] {
  const rnd = mulberry32(20261115);
  const assetPool = assets.map((a) => [a, ASSET_WEIGHT[a.category]] as [typeof a, number]);
  const drafts: Draft[] = [];
  const today = startOfDay(NOW);

  for (let d = 89; d >= 0; d--) {
    const dayStart = today - d * DAY;
    const dow = new Date(dayStart).getDay();
    const base = dow === 0 || dow === 6 ? 1.6 : 4.2;
    const count = Math.max(0, Math.round(base + (rnd() - 0.5) * 3));
    for (let i = 0; i < count; i++) {
      // Draw every random value up front so the sequence does not depend on the clock.
      const r = Array.from({ length: 12 }, () => rnd());
      const asset = weighted(() => r[0], assetPool);
      const client = clientById.get(asset.clientId)!;
      const templates = TEMPLATES[asset.category];
      const [title, category] = templates[Math.floor(r[1] * templates.length)];
      const severity = weighted(() => r[2], SEVERITY_WEIGHTS[category]);
      const target = policies.find((p) => p.id === client.slaPolicyId)!.targets[severity];

      const createdAt = dayStart + (7.5 + r[3] * 13) * HOUR;
      const factor = r[4] < 0.1 ? 1.05 + r[5] * 0.6 : 0.42 + r[5] * 0.54;
      const resolvedAt = createdAt + target.resolutionMins * MIN * factor;
      if (createdAt > NOW - 2 * HOUR || resolvedAt > NOW - 20 * MIN) continue;

      const frFactor = r[6] < 0.07 ? 1.1 + r[7] * 0.8 : 0.15 + r[7] * 0.7;
      // The PM's review: inside the hour, so QA and the developer have time before the RCA is due.
      const reviewedAt = Math.min(createdAt + target.firstResponseMins * MIN * frFactor, createdAt + (resolvedAt - createdAt) * 0.3);
      // A few requests never get done: withdrawn, duplicates, out of scope.
      const canceled = r[8] < 0.04;
      const canceledAt = createdAt + (resolvedAt - createdAt) * 0.4;

      // Routed the way the AI routes a new ticket: to the client's developer for the kind of work.
      const assignee = team.find((m) => m.id === routeTo(client, taskTypeFor(title, '', category)))!;
      const reporterId = reporterFor(client.id, category, Math.floor(r[11] * 1000));
      const reporter = client.users.find((u) => u.id === reporterId)!;

      drafts.push({
        title,
        description: `${reporter.name} reported this for ${asset.name}. ${title}. Impact and steps to reproduce were confirmed with the client during triage.`,
        clientId: client.id,
        assetId: asset.id,
        category,
        severity,
        status: canceled ? 'canceled' : 'resolved',
        assigneeId: assignee.id,
        createdAt,
        firstRespondedAt: createdAt + MIN,
        reviewedAt,
        resolvedAt: canceled ? null : resolvedAt,
        canceledAt: canceled ? canceledAt : null,
        cancellation: canceled ? { by: teamActor(testerFor(client)), reason: CANCEL_REASONS[Math.floor(r[9] * CANCEL_REASONS.length)], at: canceledAt } : null,
        reporterId: reporter.id,
        channel: weighted(() => (r[3] * 1013) % 1, CHANNEL_WEIGHTS),
        attachments: [],
        triageBy: pmFor(client),
      });
    }
  }
  return drafts;
}

/* ---------- Planning ---------- */

/** Every ticket gets its plan the moment it is created, as the app does for new ones. */
const withPlan = (t: Ticket): Ticket => ({ ...t, plan: autoPlan(t) });

export function buildInitialTickets(): Ticket[] {
  const drafts = [...generateHistory(), ...ACTIVE.map(fromSpec)].sort((a, b) => a.createdAt - b.createdAt);
  return drafts.map((d, i) => withPlan(finalize(d, `NXS-${4001 + i}`)));
}
