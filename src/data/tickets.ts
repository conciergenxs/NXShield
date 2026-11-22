import type {
  Activity,
  Actor,
  AssetCategory,
  Attachment,
  Category,
  ClientFeedback,
  Cancellation,
  Severity,
  Ticket,
  TicketChannel,
  TicketStatus,
} from '../types';
import { startOfDay } from '../lib/format';
import { PROGRESS_EVERY_MINS, PROGRESS_STAGES, draftDiagnosis, progressUpdate, stepUpdate } from '../lib/assist';
import { DAY, HOUR, LOADED_AT, MIN, assets, clients, departments, policies, team } from './seed';

const NOW = LOADED_AT;

const memberById = new Map(team.map((m) => [m.id, m]));
const assetById = new Map(assets.map((a) => [a.id, a]));
const clientById = new Map(clients.map((c) => [c.id, c]));
const deptName = (id: string) => departments.find((d) => d.id === id)?.name ?? id;

const reporterName = (d: Draft) => clientById.get(d.clientId)?.users.find((u) => u.id === d.reporterId)?.name ?? 'the client';

const teamActor = (id: string): Actor => ({ type: 'team', id });
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
  /** The active blocker, for tickets sitting in Blocker. */
  blocker?: { details: string; at: number };
  /** What NXS sent the client with the fix, for tickets waiting for approval. */
  handoff?: { note: string; files: Attachment[]; at: number };
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}${++seq}`;

/** Who usually handled each kind of ticket, used only to give the sample history plausible assignees. */
const USUAL_TEAM: { category: Category; severities: Severity[]; level: 'L1' | 'L2' | 'L3'; departmentId: string }[] = [
  { category: 'tech', severities: ['critical'], level: 'L3', departmentId: 'infra' },
  { category: 'tech', severities: ['high'], level: 'L2', departmentId: 'engineering' },
  { category: 'tech', severities: ['medium', 'low'], level: 'L1', departmentId: 'support' },
  { category: 'business', severities: ['critical', 'high', 'medium', 'low'], level: 'L2', departmentId: 'accounts' },
  { category: 'operational', severities: ['critical', 'high'], level: 'L2', departmentId: 'data' },
  { category: 'operational', severities: ['medium', 'low'], level: 'L1', departmentId: 'support' },
  { category: 'hardware', severities: ['critical', 'high', 'medium', 'low'], level: 'L2', departmentId: 'field' },
];
function usualTeam(category: Category, severity: Severity) {
  const row = USUAL_TEAM.find((r) => r.category === category && r.severities.includes(severity));
  return { level: row?.level ?? 'L1', departmentId: row?.departmentId ?? 'support' } as const;
}

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
  // The ticket is assigned the moment it is created, to whoever is plotted on
  // the asset. It stays New until that person starts the work.
  if (d.assigneeId) {
    const m = memberById.get(d.assigneeId)!;
    push(d.createdAt + 1000, { type: 'system' }, 'assignment', `Assigned to ${m.name} (${m.level}, ${deptName(m.departmentId)})`, 'internal');
  }
  if (fr != null && d.assigneeId) {
    const m = memberById.get(d.assigneeId)!;
    const span = Math.max(end - fr, 4 * MIN);
    push(fr, teamActor(m.id), 'status', 'Status changed from New to In progress');
    // Blocked and testing are NXS's own steps, so they stay internal.
    const by = teamActor(m.id);
    if (d.status === 'blocked' && d.blocker) {
      push(d.blocker.at, by, 'status', 'Status changed from In progress to Blocker', 'internal');
      push(d.blocker.at + 1000, by, 'blocker', `Blocker: ${d.blocker.details}`, 'internal');
    }
    if (d.status === 'waiting_testing' || d.status === 'on_testing' || d.status === 'waiting_approval') {
      push(fr + span * 0.45, by, 'status', 'Status changed from In progress to Waiting for testing', 'internal');
      push(fr + span * 0.45 + 1000, by, 'progress', stepUpdate('in_progress', 'waiting_testing')!);
    }
    if (d.status === 'on_testing' || d.status === 'waiting_approval') {
      push(fr + span * 0.55, by, 'status', 'Status changed from Waiting for testing to On testing', 'internal');
      push(fr + span * 0.55 + 1000, by, 'progress', stepUpdate('waiting_testing', 'on_testing')!);
    }
    if (d.status === 'waiting_approval') push(fr + span * 0.65, by, 'status', 'Status changed from On testing to Waiting for approval');
    if (d.status === 'waiting_approval' && d.handoff) push(d.handoff.at, by, 'handoff', d.handoff.note);
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
    push(sentAt, teamActor(d.assigneeId), 'status', 'Status changed from On testing to Waiting for approval');
    if (d.reopenedAt == null) push(firstDone, teamActor(d.assigneeId), 'resolution', 'Marked as resolved. The client approved the fix.');
  }
  if (d.reopenedAt != null) {
    push(d.reopenedAt, reporter, 'status', 'Declined the fix. Status changed from Waiting for approval to Reopened');
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
  if (d.firstRespondedAt == null || !d.assigneeId) return undefined;
  const { issue, fix } = draftDiagnosis(d, assetById.get(d.assetId)?.name ?? 'the asset');
  return { issue, fix, by: teamActor(d.assigneeId), at: d.firstRespondedAt + 500 };
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
  return {
    id,
    title: d.title,
    description: d.description,
    clientId: d.clientId,
    assetId: d.assetId,
    // Only Tech issues are taken in for now, so every sample ticket is one, with a priority.
    category: 'tech',
    reporterId: d.reporterId,
    source: { channel: d.channel, loggedBy: d.channel === 'portal' ? null : d.triageBy },
    createdAt: d.createdAt,
    updatedAt: activity[activity.length - 1].at,
    status: d.status,
    severity: d.severity,
    assigneeId: d.assigneeId,
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
    handoffs: d.handoff && d.assigneeId ? [{ id: nextId('hof-'), note: d.handoff.note, attachments: d.handoff.files, by: teamActor(d.assigneeId), at: d.handoff.at }] : [],
    attachments: d.attachments,
    activity,
  };
}

/* ---------- Active tickets (hand-authored) ---------- */

interface Spec {
  title: string;
  desc: string;
  asset: string;
  cat: Category;
  sev: Severity;
  status: TicketStatus;
  who?: string;
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
  /** For tickets in Blocker: what is blocking it, and since how many hours ago. */
  blocker?: [details: string, agoH: number];
  /** For tickets waiting for approval: the note sent to the client, and its files. */
  handoff?: [note: string, files?: [string, string, Attachment['kind']][]];
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
    asset: 'AST-CML-01', cat: 'tech', sev: 'high', status: 'in_progress', who: 'tm-bima', agoH: 5.5, frM: 22, reporter: 1,
    files: [['timeout-recording.mp4', '6.1 MB', 'video'], ['affected-orders.csv', '7 KB', 'doc']],
  },
  {
    title: 'Flash sale stock counts out of sync with the warehouse feed',
    desc: 'Tonight\'s flash sale SKUs show 0 stock on the website although the warehouse feed reports 300+ units each. The sale starts at 20:00 and the affected SKUs are the headline products.',
    asset: 'AST-CML-01', cat: 'operational', sev: 'high', status: 'new', agoH: 0.8, via: 'manual', reporter: 1,
    files: [['warehouse-feed-export.csv', '112 KB', 'doc']],
  },
  {
    title: 'Product reviews widget shows reviews from the wrong product',
    desc: 'On several serum product pages the reviews section shows reviews written for the cleanser range. It was fixed on Friday but is happening again on newly added variants.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'medium', status: 'reopened', who: 'tm-nadia', agoH: 58, frM: 150, resolvedAgoH: 30, reopenedAgoH: 5, reporter: 1,
    declineNote: 'The original three pages are correct now, but the new 30 ml variants added yesterday show cleanser reviews again. Please cover new variants too.',
  },
  {
    title: 'Promo price for the 11.11 bundle still showing after the campaign ended',
    desc: 'The 11.11 bundle is still listed at the campaign price of Rp 189.000. The campaign ended on the 12th and the regular price should be Rp 235.000.',
    asset: 'AST-CML-01', cat: 'business', sev: 'medium', status: 'new', agoH: 3, reporter: 0,
  },
  {
    title: 'Mobile menu covers the cart button on small screens',
    desc: 'On phones narrower than 380 px the open menu sits on top of the cart button, so shoppers cannot reach their cart without closing the menu first.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'medium', status: 'on_testing', who: 'tm-nadia', agoH: 14, frM: 110, reporter: 2,
    files: [['menu-overlap-iphone-se.png', '320 KB', 'image']],
  },
  {
    title: 'Request: replace the homepage hero for the December campaign',
    desc: 'Please replace the homepage hero with the December campaign artwork (desktop and mobile versions attached) and link it to the campaign page. Go-live is Thursday.',
    asset: 'AST-CML-01', cat: 'operational', sev: 'low', status: 'waiting_testing', who: 'tm-nadia', agoH: 30, frM: 300, via: 'manual', reporter: 0,
    files: [['december-hero-desktop.jpg', '1.8 MB', 'image'], ['december-hero-mobile.jpg', '940 KB', 'image']],
  },
  {
    title: 'Store locator: 12 new outlets ready for your check',
    desc: 'Please add the 12 outlets opening this month to the store locator. Addresses and opening hours are in the attached sheet.',
    asset: 'AST-CML-01', cat: 'operational', sev: 'medium', status: 'waiting_approval', who: 'tm-dinda', agoH: 17.5, frM: 50, reporter: 1,
    handoff: ['All 12 outlets are live on the store locator with addresses, opening hours and map pins. Search “Bandung” or “Surabaya” on the locator page to check them.', [['store-locator-new-outlets.png', '410 KB', 'image'], ['store-locator-mobile.png', '260 KB', 'image']]],
    files: [['new-outlets-december.xlsx', '28 KB', 'doc']],
  },
  {
    title: 'Order confirmation emails delayed by up to 40 minutes',
    desc: 'Customers are receiving order confirmation emails 30 to 40 minutes after paying. Several called customer service to check whether their order went through.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'high', status: 'resolved', who: 'tm-bima', agoH: 30, frM: 55, resolvedAgoH: 8, via: 'manual', reporter: 0,
  },
  {
    title: 'Broken product thumbnails on search results in Firefox',
    desc: 'Product thumbnails show as broken images in Firefox on the search results page. Chrome and Safari are fine.',
    asset: 'AST-CML-01', cat: 'tech', sev: 'low', status: 'resolved', who: 'tm-yoga', agoH: 60, frM: 420, resolvedAgoH: 20, reporter: 2,
  },

  /* CML, Marketing-Tech Dashboard */
  {
    title: 'Dashboard widgets time out for date ranges over 60 days',
    desc: 'Every widget on the campaign overview times out when the date range is longer than 60 days. We need the quarter view for Monday\'s business review.',
    asset: 'AST-CML-02', cat: 'tech', sev: 'high', status: 'in_progress', who: 'tm-andre', agoH: 9, frM: 18, reporter: 2,
  },
  {
    title: 'Meta Ads spend not syncing since Thursday\'s token refresh',
    desc: 'The Meta Ads spend widget has shown no new data since Thursday. Google and TikTok spend are updating. We need complete numbers for Monday\'s campaign review.',
    asset: 'AST-CML-02', cat: 'operational', sev: 'medium', status: 'blocked', who: 'tm-gilang', agoH: 40, frM: 95, reporter: 2,
    blocker: ['The new connector needs the shared Meta app upgraded to API v21 first. The platform team is on it this sprint.', 6],
  },
  {
    title: 'ROAS figures leave out marketplace orders',
    desc: 'ROAS on the dashboard only counts website orders. Orders from Shopee and Tokopedia that came from our ads are missing, so ROAS looks about 30% lower than it is.',
    asset: 'AST-CML-02', cat: 'business', sev: 'medium', status: 'new', agoH: 1.5, reporter: 2,
  },
  {
    title: 'Monthly attribution report email not delivered to marketing leads',
    desc: 'The scheduled monthly attribution report did not reach the three marketing leads on the 1st. The report itself is available in the dashboard.',
    asset: 'AST-CML-02', cat: 'operational', sev: 'low', status: 'in_progress', who: 'tm-gilang', agoH: 52, frM: 380, reporter: 0,
  },
  {
    title: 'TikTok Ads added to spend tracking, ready for your check',
    desc: 'Please add TikTok Ads as a channel in spend tracking, next to Meta and Google, starting from November.',
    asset: 'AST-CML-02', cat: 'operational', sev: 'low', status: 'waiting_approval', who: 'tm-gilang', agoH: 44, frM: 170, reporter: 2,
    handoff: ['TikTok Ads is now its own channel in spend tracking, backfilled from 1 November. Open Spend by channel and pick TikTok Ads to compare it with your Ads Manager export.', [['spend-by-channel-tiktok.png', '280 KB', 'image']]],
  },

  /* Aroma Abadi, Omnichannel Dashboard */
  {
    title: 'Marketplace orders stopped syncing after the connector upgrade',
    desc: 'Since the marketplace connector was upgraded this morning, no new Shopee or Tokopedia orders appear in the omnichannel dashboard. Store teams cannot pick and pack marketplace orders.',
    asset: 'AST-ARA-01', cat: 'tech', sev: 'critical', status: 'in_progress', who: 'tm-kevin', agoH: 1.4, frM: 6, via: 'manual', reporter: 2,
    files: [['connector-error-log.txt', '18 KB', 'log']],
  },
  {
    title: 'Shopee and Tokopedia stock differ from the warehouse count',
    desc: 'Stock shown for 40 best sellers on Shopee and Tokopedia is lower than the warehouse count in the dashboard. Several products show as sold out on the marketplaces while we have stock.',
    asset: 'AST-ARA-01', cat: 'operational', sev: 'high', status: 'new', agoH: 0.8, reporter: 3,
    files: [['stock-mismatch.xlsx', '46 KB', 'doc']],
  },
  {
    title: 'Customer chat inbox duplicates WhatsApp messages',
    desc: 'Every WhatsApp message from customers appears twice in the shared inbox, and agents are replying twice to the same question.',
    asset: 'AST-ARA-01', cat: 'tech', sev: 'high', status: 'in_progress', who: 'tm-bima', agoH: 7, frM: 35, reporter: 3,
  },
  {
    title: 'Add the three new Bandung stores to the store filter',
    desc: 'Please add Paris Van Java, Trans Studio and Festival Citylink to the store filter so their sales show in the dashboard. Store codes are in the attachment.',
    asset: 'AST-ARA-01', cat: 'operational', sev: 'medium', status: 'on_testing', who: 'tm-dinda', agoH: 28, frM: 130, via: 'manual', reporter: 2,
    files: [['bandung-store-codes.xlsx', '12 KB', 'doc']],
  },
  {
    title: 'Year-end loyalty points rule ready for your approval',
    desc: 'For the year-end promo, members should earn double points on fragrance purchases above Rp 500.000 from 1 to 31 December.',
    asset: 'AST-ARA-01', cat: 'business', sev: 'medium', status: 'waiting_approval', who: 'tm-sari', agoH: 10, frM: 45, reporter: 3,
    handoff: ['The year-end rule gives double points on orders from 1 to 31 December, capped at 2,000 points per member. Try it on the staging store before we switch it on.', [['loyalty-rule-test-cases.csv', '6 KB', 'doc']]],
  },
  {
    title: 'Sales by channel report counts returned orders twice',
    desc: 'Returned marketplace orders are counted as sales in the sales by channel report, and the refund is not subtracted. November revenue looks higher than our finance numbers.',
    asset: 'AST-ARA-01', cat: 'business', sev: 'medium', status: 'new', agoH: 2.5, via: 'manual', reporter: 0,
  },
  {
    title: 'Bulk import of 1,200 new loyalty members',
    desc: 'Please import the attached member list from the mall activation event into the loyalty programme, skipping duplicates by phone number.',
    asset: 'AST-ARA-01', cat: 'operational', sev: 'medium', status: 'resolved', who: 'tm-dinda', agoH: 21, frM: 40, resolvedAgoH: 3, reporter: 3,
    files: [['event-members.xlsx', '310 KB', 'doc']],
  },

  /* Aroma Abadi, LMS App */
  {
    title: 'Training videos stop playing after two minutes on Android',
    desc: 'Fragrance advisors using Android phones report that product training videos freeze at around two minutes. iPhones and the web version play to the end.',
    asset: 'AST-ARA-02', cat: 'tech', sev: 'high', status: 'in_progress', who: 'tm-nadia', agoH: 4.5, frM: 15, reporter: 1,
    files: [['video-freeze-android.mp4', '8.4 MB', 'video']],
  },
  {
    title: 'Quiz scores not saved when advisors submit offline',
    desc: 'Advisors who finish a quiz without signal see their score, but it never reaches the training report once they are back online.',
    asset: 'AST-ARA-02', cat: 'tech', sev: 'medium', status: 'new', agoH: 3.5, reporter: 1,
  },
  {
    title: 'Completion report includes advisors who have left',
    desc: 'The monthly completion report still lists 18 advisors who left the company, which brings the completion rate down for their stores.',
    asset: 'AST-ARA-02', cat: 'operational', sev: 'medium', status: 'blocked', who: 'tm-gilang', agoH: 80, frM: 240, reporter: 1, late: true,
    blocker: ['The report needs an “active advisor” flag that the LMS data model doesn’t have yet. Backend change is scoped for Thursday.', 9],
  },
  {
    title: 'Eau de Parfum product module uploaded, ready for review',
    desc: 'Please publish the new Eau de Parfum product knowledge module (slides and quiz attached) for all advisors before the launch next week.',
    asset: 'AST-ARA-02', cat: 'operational', sev: 'low', status: 'waiting_approval', who: 'tm-yoga', agoH: 50, frM: 200, reporter: 1,
    handoff: ['The Eau de Parfum module is uploaded with its six lessons and the final quiz. Only the Jakarta pilot group sees it until you approve.', [['edp-module-preview.png', '520 KB', 'image']]],
    files: [['edp-module-slides.pdf', '5.6 MB', 'doc']],
  },
  {
    title: 'Certificate PDF prints the advisor name in capitals',
    desc: 'Completion certificates print names in capitals, for example "SITI NURHALIZA". Please use the name as registered.',
    asset: 'AST-ARA-02', cat: 'tech', sev: 'low', status: 'in_progress', who: 'tm-yoga', agoH: 131, frM: 600, reporter: 1, late: true,
  },
  {
    title: 'New hires cannot sign in with their employee ID',
    desc: 'Advisors who joined this month get "account not found" when they sign in with their employee ID. Older accounts are fine.',
    asset: 'AST-ARA-02', cat: 'tech', sev: 'medium', status: 'resolved', who: 'tm-nadia', agoH: 46, frM: 90, resolvedAgoH: 26, reporter: 2,
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
  if (s.frM == null) k = Math.min(k, (target.firstResponseMins * LIVE_SHARE) / ageMins);
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
  const s = fitLive(spec);
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
    assigneeId: s.who ?? asset.ownerId,
    createdAt,
    firstRespondedAt: s.frM != null ? createdAt + s.frM * MIN : null,
    resolvedAt: reopened ? null : resolvedOnce,
    firstResolvedAt: reopened ? resolvedOnce ?? undefined : undefined,
    reopenedAt: reopened ? NOW - s.reopenedAgoH! * HOUR : undefined,
    declineNote: reopened ? s.declineNote : undefined,
    canceledAt: null,
    cancellation: null,
    reporterId: client.users[s.reporter % client.users.length].id,
    channel: s.via ?? 'portal',
    attachments: (s.files ?? []).map(([name, size, kind]) => ({ id: nextId('att-'), name, size, kind })),
    triageBy: spec.agoH % 2 < 1 ? 'tm-dinda' : 'tm-yoga',
    blocker: s.blocker ? { details: s.blocker[0], at: NOW - s.blocker[1] * HOUR } : undefined,
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
    ['Shipping fee shown differs from the confirmed total', 'business'],
    ['Voucher applied twice on a single order', 'business'],
    ['Minimum purchase rule not enforced for a promo code', 'business'],
    ['Content update: homepage banner for the monthly campaign', 'operational'],
    ['Add new outlets to the store locator', 'operational'],
    ['Update FAQ and returns policy pages', 'operational'],
    ['Set up redirects for retired product URLs', 'operational'],
  ],
  marketing_dashboard: [
    ['Dashboard widgets time out for long date ranges', 'tech'],
    ['Chart tooltips show UTC instead of WIB', 'tech'],
    ['Login session expires every 10 minutes', 'tech'],
    ['Scheduled PDF report renders blank pages', 'tech'],
    ['Conversion figures differ from the ad platform report', 'business'],
    ['ROAS calculation excludes marketplace orders', 'business'],
    ['Attribution window should be 7 days, not 28', 'business'],
    ['Add a new campaign channel to spend tracking', 'operational'],
    ['Grant dashboard access to new marketing staff', 'operational'],
    ['Google Ads connector needs re-authentication', 'operational'],
    ['Backfill missing data for last week', 'operational'],
  ],
  omnichannel_dashboard: [
    ['Marketplace orders arrive late in the dashboard', 'tech'],
    ['Customer chat inbox does not load older conversations', 'tech'],
    ['Order status not updated after the courier picks up', 'tech'],
    ['Stock sync skips products with variants', 'tech'],
    ['Sales by store totals differ from the POS report', 'business'],
    ['Loyalty points not credited for marketplace orders', 'business'],
    ['Discount rule applies to excluded products', 'business'],
    ['Add a new store to the store filter', 'operational'],
    ['Grant dashboard access to new store managers', 'operational'],
    ['Import a member list from an event', 'operational'],
    ['Monthly data export for finance', 'operational'],
  ],
  lms_app: [
    ['Training video does not play on some phones', 'tech'],
    ['Quiz progress lost when the app is closed', 'tech'],
    ['Push reminders not sent for overdue modules', 'tech'],
    ['Sign-in with employee ID fails for some advisors', 'tech'],
    ['Leaderboard points do not match quiz scores', 'business'],
    ['Completion rate counts optional modules', 'business'],
    ['Upload a new product knowledge module', 'operational'],
    ['Deactivate accounts for advisors who have left', 'operational'],
    ['Add new stores to the advisor directory', 'operational'],
    ['Monthly completion report for regional managers', 'operational'],
  ],
};

const SEVERITY_WEIGHTS: Record<Category, [Severity, number][]> = {
  tech: [['critical', 0.07], ['high', 0.2], ['medium', 0.43], ['low', 0.3]],
  business: [['critical', 0.02], ['high', 0.18], ['medium', 0.5], ['low', 0.3]],
  operational: [['critical', 0.01], ['high', 0.09], ['medium', 0.45], ['low', 0.45]],
  hardware: [['critical', 0.04], ['high', 0.26], ['medium', 0.45], ['low', 0.25]],
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

      const routing = usualTeam(category, severity);
      const candidates = team.filter((m) => m.departmentId === routing.departmentId && m.level === routing.level);
      const pool = candidates.length ? candidates : team.filter((m) => m.departmentId === routing.departmentId);
      const assignee = pool[Math.floor(r[10] * pool.length)] ?? team[1];
      const reporter = client.users[Math.floor(r[11] * client.users.length)];

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
        cancellation: canceled ? { by: teamActor('tm-raka'), reason: CANCEL_REASONS[Math.floor(r[9] * CANCEL_REASONS.length)], at: canceledAt } : null,
        reporterId: reporter.id,
        channel: weighted(() => (r[3] * 1013) % 1, CHANNEL_WEIGHTS),
        attachments: [],
        triageBy: r[0] < 0.5 ? 'tm-dinda' : 'tm-yoga',
      });
    }
  }
  return drafts;
}

export function buildInitialTickets(): Ticket[] {
  const drafts = [...generateHistory(), ...ACTIVE.map(fromSpec)].sort((a, b) => a.createdAt - b.createdAt);
  return drafts.map((d, i) => finalize(d, `NXS-${4001 + i}`));
}
