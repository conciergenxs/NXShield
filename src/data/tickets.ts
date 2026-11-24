import type {
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
import { routeTo } from '../lib/intake';
import { problemOf, responseDraftOf } from '../lib/rcaAi';
import { PROGRESS_EVERY_MINS, PROGRESS_STAGES, draftDiagnosis, progressUpdate, stepUpdate } from '../lib/assist';
import { DAY, HOUR, LOADED_AT, LOGGER_IDS, MIN, QA_ID, assets, clients, policies, team } from './seed';

const NOW = LOADED_AT;

const memberById = new Map(team.map((m) => [m.id, m]));
const assetById = new Map(assets.map((a) => [a.id, a]));
const clientById = new Map(clients.map((c) => [c.id, c]));

const reporterName = (d: Draft) => clientById.get(d.clientId)?.users.find((u) => u.id === d.reporterId)?.name ?? 'the client';

const teamActor = (id: string): Actor => ({ type: 'team', id });

/** When the initial RCA went out: a while after the first reply, well inside T+3, before any later step. */
function rcaAt(d: Draft): number | null {
  const fr = d.firstRespondedAt;
  if (fr == null || d.status === 'new' || !d.assigneeId) return null;
  const end = d.firstResolvedAt ?? d.resolvedAt ?? d.canceledAt ?? NOW;
  return fr + Math.min(45 * MIN, Math.max(60_000, (end - fr) * 0.2));
}

/** The initial response, as the AI drafted it and QA sent it. */
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
  firstRespondedAt: number | null;
  resolvedAt: number | null;
  /** Set when the ticket was resolved once and later reopened. */
  firstResolvedAt?: number;
  reopenedAt?: number;
  /** Why the client declined the fix, when they reopened it. */
  declineNote?: string;
  canceledAt: number | null;
  cancellation: Cancellation | null;
  reporterId: string;
  channel: TicketChannel;
  attachments: Attachment[];
  triageBy: string;
  /** The active blocker, for tickets sitting in Blocked. */
  blocker?: { details: string; at: number };
  /** What NXS sent the client with the fix, for tickets ready to deploy. */
  handoff?: { note: string; files: Attachment[]; at: number };
  comments?: Comment[];
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}${++seq}`;


function buildActivity(d: Draft): Activity[] {
  const acts: Activity[] = [];
  const push = (at: number, actor: Actor, kind: Activity['kind'], text: string, visibility: Activity['visibility'] = 'client') =>
    acts.push({ id: nextId('act-'), at, actor, kind, text, visibility });

  const reporter = clientActor(d.reporterId);
  if (d.channel === 'portal') push(d.createdAt, reporter, 'created', 'Submitted from the Client Portal');
  else push(d.createdAt, teamActor(d.triageBy), 'created', `Logged by NXS on behalf of ${reporterName(d)}`);

  const fr = d.firstRespondedAt;
  const firstDone = d.firstResolvedAt ?? d.resolvedAt;
  const end = firstDone ?? d.canceledAt ?? NOW;
  // The AI reads the ticket the moment it comes in and suggests who should work on it; QA checks it first.
  if (d.assigneeId) {
    const m = memberById.get(d.assigneeId)!;
    push(d.createdAt + 1000, { type: 'system' }, 'assignment', `AI suggested ${m.name} as the assignee. Waiting for ${memberById.get(QA_ID)?.name ?? 'QA'} to confirm.`, 'internal');
  }
  // QA's first reply to the client: the initial response.
  if (fr != null) push(fr, teamActor(QA_ID), 'response', responseText(d));
  const sentRca = rcaAt(d);
  if (fr != null && d.assigneeId && sentRca != null) {
    const m = memberById.get(d.assigneeId)!;
    const span = Math.max(end - fr, 4 * MIN);
    // QA confirmed the AI's read and sent the initial RCA; confirming starts the work.
    push(sentRca, teamActor(QA_ID), 'status', 'Status changed from New to In progress');
    // Blocked and testing are NXS's own steps, so they stay internal.
    const by = teamActor(m.id);
    if (d.status === 'blocked' && d.blocker) {
      push(d.blocker.at, by, 'status', 'Status changed from In progress to Blocked', 'internal');
      push(d.blocker.at + 1000, by, 'blocker', `Blocker: ${d.blocker.details}`, 'internal');
    }
    const past = (s: TicketStatus[]) => s.includes(d.status);
    if (past(['waiting_testing', 'on_testing', 'ready_to_deploy'])) {
      push(fr + span * 0.45, by, 'status', 'Status changed from In progress to Waiting for testing', 'internal');
      push(fr + span * 0.45 + 1000, by, 'progress', stepUpdate('in_progress', 'waiting_testing')!);
    }
    if (past(['on_testing', 'ready_to_deploy'])) {
      push(fr + span * 0.55, teamActor(QA_ID), 'status', 'Status changed from Waiting for testing to On testing', 'internal');
      push(fr + span * 0.55 + 1000, by, 'progress', stepUpdate('waiting_testing', 'on_testing')!);
    }
    // Testing passed: QA sends it to the client to approve it going live.
    if (d.status === 'ready_to_deploy') push(fr + span * 0.65, teamActor(QA_ID), 'status', 'Status changed from On testing to Ready to deploy');
    if (d.status === 'ready_to_deploy' && d.handoff) push(d.handoff.at, teamActor(QA_ID), 'handoff', 'Sent the full RCA with the fix');
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
    push(sentAt, teamActor(QA_ID), 'status', 'Status changed from On testing to Ready to deploy');
    // The client's Deploy is what resolves it.
    if (d.reopenedAt == null) push(firstDone, reporter, 'resolution', `Deployed by ${reporterName(d)}. Status changed from Ready to deploy to Resolved`);
  }
  if (d.reopenedAt != null) {
    push(d.reopenedAt, reporter, 'status', 'Declined the fix. Status changed from Ready to deploy to In progress');
  }
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

/** What was found and the plan, written when work started. */
function diagnosisOf(d: Draft) {
  const at = rcaAt(d);
  if (at == null) return undefined;
  const assetName = assetById.get(d.assetId)?.name ?? 'the asset';
  const { issue, fix } = draftDiagnosis(d, assetName);
  // QA shares it when confirming the AI's read.
  return { problem: problemOf(d, assetName), issue, fix, by: teamActor(QA_ID), at: at + 500 };
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
    testerId: QA_ID,
    // A ticket still in New has only the AI's read so far; QA hasn't confirmed it.
    triage: d.status === 'new' && d.assigneeId ? { assetId: d.assetId, category: d.category, severity: d.severity, assigneeId: d.assigneeId } : undefined,
    firstRespondedAt: d.firstRespondedAt,
    resolvedAt: d.resolvedAt,
    canceledAt: d.canceledAt,
    cancellation: d.cancellation,
    feedback: buildFeedback(d),
    diagnosis: diagnosisOf(d),
    blockers: d.blocker && d.assigneeId
      ? [{ id: nextId('blk-'), details: d.blocker.details, by: teamActor(d.assigneeId), at: d.blocker.at, clearedAt: null, clearedBy: null, clearNote: '' }]
      : [],
    moveNotes: [],
    handoffs: d.handoff && d.assigneeId ? [{ id: nextId('hof-'), note: '', attachments: [fullRcaFile(id)], by: teamActor(QA_ID), at: d.handoff.at }] : verifiedFor(d, id),
    attachments: d.attachments,
    comments: d.comments ?? [],
    activity,
  };
  if (d.firstRespondedAt != null) ticket.initialResponse = { text: responseText(d), by: teamActor(QA_ID), at: d.firstRespondedAt };
  return ticket;
}

/** A resolved ticket passed testing before the client deployed it: what was checked, with proof. */
function verifiedFor(d: Draft, id: string): Ticket['handoffs'] {
  if (d.status !== 'resolved' || d.resolvedAt == null || !d.assigneeId) return [];
  return [{ id: nextId('hof-'), note: '', attachments: [fullRcaFile(id)], by: teamActor(QA_ID), at: d.resolvedAt - Math.min(3 * HOUR, (d.resolvedAt - d.createdAt) * 0.25) }];
}

/** The full RCA spreadsheet that goes to the client with the fix. */
const fullRcaFile = (id: string): Attachment => ({ id: nextId('att-'), name: `RCA Report - ${id}.xlsx`, size: '72 KB', kind: 'doc' });

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
  /** For tickets in Blocked: what is blocking it, and since how many hours ago. */
  blocker?: [details: string, agoH: number];
  /** For tickets ready to deploy: the note sent to the client, and its files. */
  handoff?: [note: string, files?: [string, string, Attachment['kind']][]];
  /** Comments: the thread, who wrote it ('reporter', 'assignee' or a team member id), how many hours ago, and the text. */
  comments?: [thread: Comment['thread'], who: string, agoH: number, text: string][];
}

const ACTIVE: Spec[] = [
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
    asset: 'AST-CML-01', cat: 'tech', sev: 'medium', status: 'new', agoH: 0.8, via: 'manual', reporter: 1,
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
    title: 'Store locator map shows no pins outside Jakarta',
    desc: 'The store locator lists every outlet, but the map only shows pins for Jakarta. Outlets in Bandung, Surabaya and Medan have no pin, so shoppers there see an empty map.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'low', status: 'waiting_testing', agoH: 17.5, frM: 50, reporter: 1,
    files: [['store-locator-empty-map.png', '520 KB', 'image']],
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
    handoff: ['TikTok Ads spend comes through again and has been backfilled from 1 November. Open Spend by channel and compare TikTok Ads with your Ads Manager export.', [['spend-by-channel-tiktok.png', '280 KB', 'image']]],
  },

  /* Aroma Abadi, Omnichannel Dashboard */
  {
    title: 'Marketplace orders stopped syncing after the connector upgrade',
    desc: 'Since the marketplace connector was upgraded this morning, no new Shopee or Tokopedia orders appear in the omnichannel dashboard. Store teams cannot pick and pack marketplace orders.',
    asset: 'AST-ARA-01', cat: 'tech', sev: 'critical', status: 'in_progress', agoH: 1.4, frM: 6, via: 'manual', reporter: 2,
    comments: [['internal', 'assignee', 1, 'Rolled the connector back on staging and orders sync again. Testing the same rollback on production next.']],
    files: [['connector-error-log.txt', '18 KB', 'log']],
  },
  {
    title: 'Shopee and Tokopedia stock differ from the warehouse count',
    desc: 'Stock shown for 40 best sellers on Shopee and Tokopedia is lower than the warehouse count in the dashboard. Several products show as sold out on the marketplaces while we have stock.',
    asset: 'AST-ARA-01', cat: 'tech', sev: 'medium', status: 'new', agoH: 0.8, reporter: 3,
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
    // Business to a business PIC; frontend to Alfiana, backend to Mega, as the AI routes it.
    assigneeId: routeTo(s.cat, taskTypeFor(s.title, s.desc, s.cat), s.reporter),
    createdAt,
    // A new ticket more than a quarter of an hour old has had its initial response; the late ones haven't.
    firstRespondedAt: s.frM != null ? createdAt + s.frM * MIN : s.status === 'new' && !s.late && s.agoH * 60 >= 15 ? createdAt + 10 * MIN : null,
    resolvedAt: reopened ? null : resolvedOnce,
    firstResolvedAt: reopened ? resolvedOnce ?? undefined : undefined,
    reopenedAt: reopened ? NOW - s.reopenedAgoH! * HOUR : undefined,
    declineNote: reopened ? s.declineNote : undefined,
    canceledAt: null,
    cancellation: null,
    reporterId: reporterFor(client.id, s.cat, s.reporter),
    channel: s.via ?? 'portal',
    attachments: (s.files ?? []).map(([name, size, kind]) => ({ id: nextId('att-'), name, size, kind })),
    triageBy: LOGGER_IDS[spec.agoH % 2 < 1 ? 0 : 1],
    blocker: s.blocker ? { details: s.blocker[0], at: NOW - s.blocker[1] * HOUR } : undefined,
    comments: (s.comments ?? []).map(([thread, who, agoH, text], i) => ({
      id: nextId('cmt-'),
      thread,
      by: who === 'reporter' ? clientActor(reporterFor(client.id, s.cat, s.reporter)) : teamActor(who === 'assignee' ? routeTo(s.cat, taskTypeFor(s.title, s.desc, s.cat), s.reporter) : who),
      // Never before the ticket came in, and in the order written.
      at: Math.max(createdAt + (10 + i) * MIN, NOW - agoH * HOUR),
      text,
    })),
    // Sent at the same moment the status moved, as buildActivity places it.
    handoff:
      s.handoff && s.frM != null
        ? {
            note: s.handoff[0],
            files: (s.handoff[1] ?? []).map(([name, size, kind]) => ({ id: nextId('att-'), name, size, kind })),
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
      const firstRespondedAt = Math.min(createdAt + target.firstResponseMins * MIN * frFactor, createdAt + (resolvedAt - createdAt) * 0.3);
      // A few requests never get done: withdrawn, duplicates, out of scope.
      const canceled = r[8] < 0.04;
      const canceledAt = createdAt + (resolvedAt - createdAt) * 0.4;

      // Routed the way the AI routes a new ticket: business to a business PIC, the rest by kind of work.
      const assignee = team.find((m) => m.id === routeTo(category, taskTypeFor(title, '', category), Math.floor(r[10] * 10)))!;
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
        assigneeId: asset.ownerId ?? assignee.id,
        createdAt,
        firstRespondedAt,
        resolvedAt: canceled ? null : resolvedAt,
        canceledAt: canceled ? canceledAt : null,
        cancellation: canceled ? { by: teamActor('tm-riyan'), reason: CANCEL_REASONS[Math.floor(r[9] * CANCEL_REASONS.length)], at: canceledAt } : null,
        reporterId: reporter.id,
        channel: weighted(() => (r[3] * 1013) % 1, CHANNEL_WEIGHTS),
        attachments: [],
        triageBy: LOGGER_IDS[r[0] < 0.5 ? 0 : 1],
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
