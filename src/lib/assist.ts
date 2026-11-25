import type { Severity, Ticket, TicketStatus } from '../types';
import { fmtDate, fmtDuration, fmtWeekday } from './format';

/*
 * Drafts NXS writes on the ticket's behalf: what is wrong and how it will be
 * fixed when work starts, and the regular progress updates the SLA promises.
 * They read as NXS writing; nothing marks them as generated. Staff can edit
 * the diagnosis before it is sent.
 */

interface Area {
  match: RegExp;
  /** Where the cause sits, as it reads after "We traced it to …". */
  where: string;
  /** What goes wrong there, as it reads after "…, where …". */
  cause: string;
  /** The plan for a fault. */
  fix: string;
  /** The plan when the ticket asks for a change rather than reports a fault. */
  change?: string;
}

/** The kinds of fault NXS sees most, matched on the ticket's own words. First match wins. */
const AREAS: Area[] = [
  { match: /banner|hero|homepage|artwork|article|faq|copy|content|redirect/, where: 'the page content', cause: 'the content shown is outdated or missing', fix: 'Correct the content, check it on desktop and mobile, and clear the cache so everyone sees it.', change: 'Put the new content in place, check it on desktop and mobile, then send it to you to approve before it goes live.' },
  { match: /payment|checkout|bank transfer|gateway|virtual account/, where: 'the payment step', cause: 'the hand-off to the payment gateway fails or comes back late for some orders', fix: 'Trace the affected orders through the payment gateway, fix the step that fails and add a retry so late confirmations still complete the order. Then run a test payment end to end.' },
  { match: /stock|sync|feed|connector|marketplace|shopee|tokopedia/, where: 'the data sync', cause: 'some records are dropped or arrive late', fix: 'Find where the sync drops or delays records, fix the mapping or the job that causes it, and re-sync the affected items. Then compare a sample against the source.' },
  { match: /\bsms\b|push|reminder|notification|otp/, where: 'the step that sends messages', cause: 'some messages never leave the sending provider', fix: 'Check the messages that failed against the sending provider, fix the trigger or the settings that stop them, and resend the ones that were missed. Then send a test to confirm.' },
  { match: /access|permission|deactivate|grant|account/, where: 'the user access settings', cause: 'some accounts don’t have the access they should', fix: 'Correct the roles on the affected accounts and confirm each person can sign in and sees the right pages.', change: 'Update the access list with the right roles, then confirm each person can sign in and sees the right pages.' },
  { match: /sign-in|sign in|login|log in|session|password/, where: 'the sign-in check', cause: 'the session or account check turns valid users away', fix: 'Reproduce the failing sign-in, fix the session or account check that rejects it, and confirm with the affected accounts.' },
  { match: /video|play|freez/, where: 'the video player', cause: 'playback stops on some devices', fix: 'Reproduce it on the affected devices, fix the playback or streaming setting that stops it, and check the full video plays through.' },
  { match: /image|thumbnail|photo|picture/, where: 'the way images load', cause: 'some images fail to load from their source', fix: 'Find why the images fail to load, fix the source or the cache rule, and check the affected pages in each browser.' },
  { match: /map|locator|outlet|store filter|stores/, where: 'the store data and map', cause: 'the store data or the map setup is out of date', fix: 'Correct the store data and the map setup behind it, then check every location shows and links correctly.', change: 'Add the new locations to the store data, set them up on the map, then check each one shows and links correctly.' },
  { match: /report|export|pdf|email|deliver/, where: 'the report job', cause: 'the report fails to build or the email doesn’t go out', fix: 'Find the step where the report fails or goes missing, fix the job or the mail settings, and resend the latest report.', change: 'Set up the report as asked, run it once to check the numbers, and send you the first copy.' },
  { match: /slow|speed|time out|timeout|timing out|latency/, where: 'a few slow requests', cause: 'some requests take far longer than they should', fix: 'Profile the slow requests, fix the query or the cache behind them, and check the timings against the normal range.' },
  { match: /review/, where: 'the reviews widget', cause: 'reviews are matched to the wrong products', fix: 'Fix how reviews are matched to products, cover new variants too, and check the affected pages.' },
  { match: /menu|layout|mobile|screen|button|overlap/, where: 'the page layout', cause: 'elements overlap on small screens', fix: 'Fix the layout so nothing overlaps on small screens, then check it on the common phone sizes.' },
  { match: /quiz|progress|completion|module|lesson|leaderboard/, where: 'the learning records', cause: 'progress isn’t saved or counted correctly', fix: 'Fix how progress is saved and counted, correct the affected records, and check a full module from start to finish.', change: 'Upload and set up the content, check it from start to finish, and make it visible to the right group.' },
  { match: /chat|inbox|whatsapp|message/, where: 'the chat inbox', cause: 'messages are duplicated or lost on the way in', fix: 'Find where messages are duplicated or lost, fix the handler, and clean up the affected conversations.' },
  { match: /point|loyalty|discount|voucher|promo|price|bundle/, where: 'the pricing and promotion rules', cause: 'a rule applies the wrong value', fix: 'Correct the rule that applies the wrong value, fix the affected orders or points, and check it against a few test orders.', change: 'Set up the rule as described, test it on a few orders, and switch it on once you approve.' },
  { match: /ads|spend|attribution|roas|conversion|campaign/, where: 'the campaign data', cause: 'the numbers come in incomplete or miscounted', fix: 'Fix the connector or the calculation behind the numbers, backfill the affected days, and check them against the ad platform.', change: 'Add it to the tracking, backfill the past weeks, and check the numbers against the ad platform.' },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const firstSentence = (s: string) => (s.match(/^[^.!?]+[.!?]/)?.[0] ?? s).trim();
const sentence = (s: string) => {
  const t = s.trim().replace(/[\s:;,]+$/, '');
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/** The title without the wrapping a ticket sometimes carries: "Request: …", "… ready for your check". */
function cleanTitle(title: string) {
  return title
    .replace(/^(request|content update|change request)\s*:\s*/i, '')
    .replace(/[,:]?\s*(uploaded,?\s*)?ready for (your )?(check|approval|review)\.?$/i, '')
    .trim();
}

/** Asks for something new or different rather than reporting a fault. */
const CHANGE_WORDS = /^(add|upload|replace|update|set up|grant|deactivate|import|backfill|create|publish|remove|change|rename)\b/i;

/** The kind of fault a ticket reads as, from its own words, and whether it asks for a change instead. */
export function readTicket(t: Pick<Ticket, 'title' | 'description'>): { area?: { where: string; cause: string; fix: string }; isChange: boolean } {
  const title = cleanTitle(t.title);
  const text = `${title} ${t.description}`.toLowerCase();
  const area = AREAS.find((a) => a.match.test(text));
  const opener = firstSentence(t.description);
  const isChange = /^please\s/i.test(opener) || CHANGE_WORDS.test(title) || /request|ready for (your )?(check|approval|review)/i.test(t.title);
  return { area: area && { where: area.where, cause: area.cause, fix: area.change && isChange ? area.change : area.fix }, isChange };
}

/** What is wrong and how NXS will fix it, drafted from the client's brief. */
export function draftDiagnosis(t: Pick<Ticket, 'title' | 'description'>, assetName: string): { issue: string; fix: string } {
  const title = cleanTitle(t.title);
  const text = `${title} ${t.description}`.toLowerCase();
  const area = AREAS.find((a) => a.match.test(text));
  const opener = firstSentence(t.description);
  // A request reads best in the client's own ask, without the "please".
  const ask = /^please\s/i.test(opener) ? cap(opener.replace(/^please\s+/i, '')) : CHANGE_WORDS.test(title) ? sentence(cap(title)) : '';
  const isChange = !!ask || /request|ready for (your )?(check|approval|review)/i.test(t.title);

  if (isChange) {
    const what = ask || sentence(cap(title));
    const issue = `Nothing is broken. This is a change to ${assetName}: ${what.charAt(0).toLowerCase()}${what.slice(1)}`;
    const fix = area?.change ?? `Make the change on ${assetName}, check it ourselves, then send it to you to approve.`;
    return { issue, fix };
  }
  // Straight to the cause: the issue itself is stated just above it.
  const issue = area ? `We traced it to ${area.where} on ${assetName}, where ${area.cause}.` : `We’re still narrowing down the cause on ${assetName} and will share it in the next update.`;
  const fix = area?.fix ?? 'Reproduce the issue, find the change that caused it, fix it, and check the affected flow end to end.';
  return { issue, fix };
}

/* ---------- Progress updates ---------- */

/** How often the client hears from NXS while work goes on, per the SLA table. P3 is reported when it is fixed. */
export const PROGRESS_EVERY_MINS: Record<Severity, number | null> = { critical: 60, medium: 240, low: null };

/** Stages where work is moving and updates are due. Not New, not Blocker, not the client's turn. */
export const PROGRESS_STAGES: TicketStatus[] = ['in_progress', 'waiting_testing', 'on_testing', 'qa_passed'];

const when = (ts: number) => `${fmtWeekday(ts)}, ${fmtDate(ts)}`;

/**
 * One progress update: `client` for the portal, which only knows "In
 * progress", and `staff`, which names the next internal step.
 * `stageSince` is when the ticket entered its current stage; `fixDue` the SLA
 * resolution deadline.
 */
export function progressUpdate(status: TicketStatus, stageSince: number, fixDue: number, at: number): { client: string; staff: string } {
  const elapsed = fmtDuration(Math.max(at - stageSince, 60_000));
  const left = fixDue - at;
  const onTrack = left > 0;
  const due = when(fixDue);
  // The next internal step is expected part way to the fix deadline.
  const share = status === 'in_progress' ? 0.6 : status === 'waiting_testing' ? 0.7 : 0.85;
  const nextAt = stageSince + (fixDue - stageSince) * share;
  const nextIn = nextAt - at;
  const nextName = status === 'in_progress' ? 'testing' : status === 'waiting_testing' ? 'testing starts' : 'deployment';
  const nextLine = nextIn > 0 ? `${status === 'waiting_testing' ? 'Testing should start' : `Expected to reach ${nextName}`} in about ${fmtDuration(nextIn)}.` : `Taking longer than planned to reach ${nextName}.`;
  const stageName = status === 'in_progress' ? 'In progress' : status === 'waiting_testing' ? 'Waiting for testing' : 'On testing';
  const staff = `${stageName} for ${elapsed}. ${nextLine} ${onTrack ? `Fix due by ${due}.` : `Fix was due ${due}.`}`;
  const client =
    status === 'in_progress'
      ? `Work is under way (${elapsed} so far). ${onTrack ? `We expect to have it fixed by ${due}.` : 'It is taking longer than planned; we are on it and will update you soon.'}`
      : `The fix is in final checks before it reaches you. ${onTrack ? `We expect to have it ready by ${due}.` : 'It is taking longer than planned; we will update you soon.'}`;
  return { client, staff };
}

/**
 * What the client is told when the work crosses one of NXS's own steps.
 * The portal shows these stages as "In progress", so the line explains them
 * in plain words instead. Blocker is left out on purpose: no news there.
 */
/** How the team reads the client's step updates in the activity log: what happened, not "you". */
const STEP_STAFF: Record<string, string> = {
  'The fix is done. It goes through testing before it reaches you.': 'Fix done and handed over for testing. The client was told.',
  'We’re testing the fix now. You’ll get it to check once it passes.': 'Testing started. The client was told.',
  'Testing passed. The fix is scheduled to go live.': 'Testing passed and the fix is scheduled to go live. The client was told.',
  'Testing found something that still needs work. We’re fixing it before it reaches you.': 'Testing found an issue, so the fix went back for more work. The client was told.',
};
export const stepStaffLine = (text: string): string | undefined => STEP_STAFF[text];

export function stepUpdate(from: TicketStatus, to: TicketStatus): string | null {
  if (to === 'waiting_testing') return 'The fix is done. It goes through testing before it reaches you.';
  if (to === 'on_testing') return 'We’re testing the fix now. You’ll get it to check once it passes.';
  if (to === 'qa_passed') return 'The fix passed testing. We’re preparing it for you to approve.';
  if (to === 'ready_to_deploy') return 'Testing passed. The fix is scheduled to go live.';
  if (to === 'in_progress' && (from === 'waiting_testing' || from === 'on_testing' || from === 'qa_passed' || from === 'ready_to_deploy')) return 'Testing found something that still needs work. We’re fixing it before it reaches you.';
  return null;
}
