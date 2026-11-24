import type { Asset, FullRcaContent, Ticket } from '../types';
import { draftDiagnosis, readTicket } from './assist';
import { fmtDateTime, fmtDuration } from './format';
import { ASSET_CATEGORY_LABEL } from './domain';

/*
 * The RCA assistant, simulated: there is no model behind the prototype, so
 * the analysis and the answers are put together from the ticket's own words,
 * its asset, and the tickets that came before it. A real version would call
 * an LLM with the same inputs.
 */

export interface Analysis {
  /** The problem itself, in plain words: what happens, where, and how much it matters. */
  problem: string;
  /** The likely cause, as it would be shared with the client. */
  issue: string;
  /** The plan to fix it. */
  fix: string;
  /** For P1: the suggested fix time, in hours. */
  hours: number;
  /** Earlier tickets on the same asset that read like this one. */
  similar: { id: string; title: string; tookMs: number | null }[];
  /** What to ask the client to narrow it down. */
  questions: string[];
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'on', 'in', 'to', 'for', 'is', 'are', 'not', 'with', 'from', 'after', 'when', 'some', 'our', 'we', 'it', 'by', 'at', 'as', 'be', 'this', 'that', 'still', 'out', 'up', 'new']);
// Words that carry meaning, with a plural 's' dropped so "transfers" meets "transfer".
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => (w.length > 4 ? w.replace(/s$/, '') : w)));

/** Finished tickets on the same asset that share at least two meaningful words with this one, closest first. */
export function similarTo(t: Ticket, all: Ticket[]) {
  const mine = words(`${t.title} ${t.description}`);
  return all
    .filter((o) => o.id !== t.id && o.assetId === t.assetId && o.status === 'resolved' && o.createdAt < t.createdAt)
    .map((o) => ({ o, score: [...words(o.title)].filter((w) => mine.has(w)).length }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || b.o.createdAt - a.o.createdAt)
    // The same fault reported again counts once: the latest one.
    .filter((x, i, list) => list.findIndex((y) => y.o.title === x.o.title) === i)
    .slice(0, 3)
    .map(({ o }) => ({ id: o.id, title: o.title, tookMs: o.resolvedAt ? o.resolvedAt - o.createdAt : null }));
}

function questionsFor(t: Ticket): string[] {
  const { area, isChange } = readTicket(t);
  if (isChange) return ['Is there a date this has to be live by?', 'Who should check it before it goes live?'];
  const where = area?.where ?? '';
  if (where.includes('payment')) return ['Which payment methods or banks are affected?', 'Roughly how many orders, and since when?'];
  if (where.includes('sync')) return ['Which items or orders are missing, and since when?', 'Did anything change on the marketplace side recently?'];
  if (where.includes('video') || where.includes('layout')) return ['Which devices and browsers does it happen on?', 'Can they send a screen recording?'];
  if (where.includes('sign-in') || where.includes('access')) return ['Which accounts are affected? A few user IDs help.', 'When did it last work for them?'];
  return ['When did it start, and does it happen every time?', 'Who is affected: everyone, or some users?'];
}

/** The analysis made the moment the ticket comes in. */
export function analyze(t: Ticket, assetName: string, all: Ticket[]): Analysis {
  const { issue, fix } = draftDiagnosis(t, assetName);
  return { problem: problemOf(t, assetName), issue, fix, hours: 6, similar: similarTo(t, all), questions: questionsFor(t) };
}

/** The issue in NXS's words: what is broken, on which asset, and what it means for the people using it.
 *  It doesn't repeat the client's report (that sits right above it) or the priority (Time to fix carries it). */
export function problemOf(t: Pick<Ticket, 'title' | 'description' | 'severity'>, assetName: string): string {
  const title = t.title.trim().replace(/[.!?]+$/, '');
  const what = `${title.charAt(0).toUpperCase()}${title.slice(1)} on ${assetName}.`;
  return t.severity ? `${what} ${EFFECT[t.severity]}` : what;
}

/** The AI's initial response, ready when the ticket comes in: it arrived, how it is rated and why,
 *  when the initial RCA follows, and how often updates come. Signed by NXS, never a person. */
export function responseDraftOf(t: Pick<Ticket, 'title' | 'severity'>, assetName: string, firstName: string, rcaDue: number): string {
  const title = t.title.trim().replace(/[.!?]+$/, '');
  const rated = t.severity ? ` We’ve rated it ${PRIORITY_NAME[t.severity]}: ${EFFECT[t.severity].charAt(0).toLowerCase()}${EFFECT[t.severity].slice(1)}` : '';
  const cadence = t.severity === 'critical' ? 'While we work on it, we’ll update you every hour.' : t.severity === 'medium' ? 'While we work on it, we’ll update you every 4 hours.' : 'We’ll let you know as soon as it’s fixed.';
  return `Hi ${firstName}, thanks for reporting this. We’ve received it and are looking into it now: ${title} on ${assetName}.${rated} You’ll get our initial analysis (RCA) by ${fmtDateTime(rcaDue)}, with what’s causing it and how long the fix will take. ${cadence}`;
}

/** What the full RCA draft needs besides the ticket. */
export interface RcaContext {
  asset?: Asset;
  clientName: string;
  reporterName: string;
}

const PRIORITY_SHORT: Record<string, string> = { critical: 'P1 Critical', medium: 'P2 Medium', low: 'P3 Low' };
const TO_CONFIRM = (what: string) => `[To confirm: ${what}]`;

/**
 * The AI's full RCA, kept up to date from the ticket and laid out as the RCA report template.
 * What the ticket can't tell (users affected, error text, recent changes) is left as a marked
 * placeholder for QA to fill in before it goes out.
 */
export function fullRcaDraftOf(t: Ticket, ctx: RcaContext): FullRcaContent {
  const assetName = ctx.asset?.name ?? 'the asset';
  const { area } = readTicket(t);
  const where = area?.where ?? 'the affected flow';
  const handoff = t.handoffs[t.handoffs.length - 1];
  const fixedAt = t.resolvedAt ?? handoff?.at ?? null;
  const priority = t.severity ? PRIORITY_SHORT[t.severity] : 'Not rated';
  const effect = t.severity ? EFFECT[t.severity] : 'The effect is still being assessed.';
  const firstLine = (t.description.match(/^[^.!?]+[.!?]/)?.[0] ?? t.description).trim();
  const status = t.status === 'resolved' ? 'Resolved' : handoff ? 'Fix ready, waiting for your deploy' : 'Being fixed';
  const cause = t.diagnosis?.issue ?? (area ? `We traced it to ${where} on ${assetName}, where ${area.cause}.` : TO_CONFIRM('the cause'));
  const fix = t.diagnosis?.fix ?? TO_CONFIRM('the fix');
  const prevention = `We’ll add an automated check and an alert for ${where} on ${assetName}, so this is caught before it reaches you.`;
  const day = 86_400_000;
  const base = handoff?.at ?? t.updatedAt;
  const due = (days: number) => fmtDateTime(base + days * day).split(',')[0];
  const reported = fmtDateTime(t.createdAt);

  const timeline: [string, string, string][] = [[reported, `Issue reported: ${firstLine}`, 'Client']];
  if (t.initialResponse) timeline.push([fmtDateTime(t.initialResponse.at), 'Report acknowledged and analysis started', 'NXS support']);
  if (t.diagnosis) timeline.push([fmtDateTime(t.diagnosis.at), 'Cause identified; initial RCA sent and fix started', 'NXS support']);
  for (const a of t.activity) {
    if (a.kind === 'status' && /to Waiting for testing$/.test(a.text)) timeline.push([fmtDateTime(a.at), 'Fix done, handed to testing', 'NXS developer']);
    if (a.kind === 'status' && /to On testing$/.test(a.text)) timeline.push([fmtDateTime(a.at), 'Testing started', 'NXS QA']);
  }
  if (handoff) timeline.push([fmtDateTime(handoff.at), 'Fix passed testing; sent to the client to deploy', 'NXS QA']);
  if (t.resolvedAt) timeline.push([fmtDateTime(t.resolvedAt), 'Fix deployed', 'Client']);

  return {
    header: [
      ['Client', ctx.clientName],
      ['Asset', assetName],
      ['Website / URL', ctx.asset?.url ?? '—'],
      ['Platform', ctx.asset ? `${ASSET_CATEGORY_LABEL[ctx.asset.category]}, ${ctx.asset.environment.toLowerCase()}` : '—'],
      ['Ticket ID', t.id],
      ['Priority', priority],
      ['Report date', fmtDateTime(base).split(',')[0]],
      ['Prepared by', 'NXS support team'],
      ['Status', handoff ? 'Final' : 'Draft'],
    ],
    summary: [
      ['What happened', firstLine],
      ['Impact', `${effect}${fixedAt ? ` It lasted ${fmtDuration(fixedAt - t.createdAt)} from the report to the fix.` : ''}`],
      ['Cause (plain language)', cause],
      ['Current status', status],
      ['Key prevention step', prevention],
    ],
    details: [
      ['Start time', `${reported} WIB, when it was reported (the logs may show an earlier start)`],
      ['Detected at', `${reported} WIB`],
      ['Detected by', t.source.channel === 'portal' ? 'Client report (Client Portal)' : 'Client report, logged by NXS'],
      ['Resolved at', t.resolvedAt ? `${fmtDateTime(t.resolvedAt)} WIB` : handoff ? `${fmtDateTime(handoff.at)} WIB (fix ready)` : 'Not yet'],
      ['Total duration', fixedAt ? fmtDuration(fixedAt - t.createdAt) : 'Ongoing'],
      ['Time to detect', 'Found by the client’s report: not measured'],
      ['Time to resolve', fixedAt ? fmtDuration(fixedAt - t.createdAt) : 'Ongoing'],
      ['Affected areas', `${where.charAt(0).toUpperCase()}${where.slice(1)} on ${assetName}`],
      ['Users affected', TO_CONFIRM('estimate or analytics data')],
      ['Business impact', effect],
    ],
    timeline,
    evidence: [
      ['Observed symptoms', t.description],
      ['Error messages', TO_CONFIRM('exact error text')],
      ['Logs reviewed', area ? `Application and server logs for ${where}` : 'Application and server logs'],
      ['Monitoring data', ctx.asset?.uptime30d != null ? `Uptime over the last 30 days: ${ctx.asset.uptime30d}%` : 'No monitoring on this asset'],
      ['Recent changes (last 7 days)', TO_CONFIRM('updates, deployments, DNS, content or hosting changes')],
      ['Screenshots / attachments', t.attachments.length ? t.attachments.map((f) => f.name).join(', ') : 'None'],
    ],
    method: '5 Whys',
    whys: [
      ['Problem', 'What went wrong?', firstLine],
      ['Why 1', 'Why did that happen?', cause],
      ['Why 2', 'Why did the error occur?', area ? `In ${where}, ${area.cause}.` : TO_CONFIRM('the next cause')],
      ['Why 3', 'Why did it reach production?', 'The change went live without a check that covers this case.'],
      ['Why 4', 'Why wasn’t it caught first?', `No automated test or alert covers ${where}.`],
      ['Why 5', 'Why was there no such check?', `Checks for ${where} were never part of the release and monitoring plan.`],
    ],
    rootCause: `Changes to ${where} on ${assetName} could reach production without a test or an alert that covers this case.`,
    factors: [
      ['Code / Application', cause],
      ['Hosting / Infrastructure', 'None found'],
      ['Third-party services', /payment|gateway|connector|ads|marketplace|sync/.test(where) ? 'The third-party service behind it was checked; no outage on their side' : 'None found'],
      ['Data / Content', 'None found'],
      ['Process', 'No pre-release check for this case'],
      ['People / Communication', 'None found'],
      ['Monitoring', `No alert for ${where}; it was found by the client’s report`],
    ],
    wentWell: t.diagnosis && t.initialResponse ? 'The report was acknowledged and the cause found within the SLA.' : 'The report was picked up within the SLA.',
    didntGoWell: 'Detection depended on the client reporting the issue.',
    resolution: [
      ['Immediate fix applied', fix],
      ['Verification performed', `Tested by NXS QA before it went to the client: ${where} end to end, on desktop and mobile.`],
      ['Data loss or rollback impact', 'None'],
    ],
    steps: fix
      .split(/(?<=[.!?])\s+/)
      .map((x) => x.trim())
      .filter(Boolean),
    actions: [
      { action: `Apply and verify the fix on ${assetName}`, type: 'Corrective', owner: 'NXS developer', due: handoff ? due(0) : TO_CONFIRM('date'), status: handoff ? 'Done' : 'In progress' },
      { action: `Add an automated test for this case in ${where}`, type: 'Preventive', owner: 'NXS developer', due: due(7), status: 'Open' },
      { action: `Add an alert that fires when ${where} fails`, type: 'Detective', owner: 'NXS support', due: due(7), status: 'Open' },
      { action: 'Add this check to the pre-release checklist', type: 'Process', owner: 'NXS QA', due: due(14), status: 'Open' },
    ],
    lessons: [`${where.charAt(0).toUpperCase()}${where.slice(1)} needs its own check before every release.`, 'We should hear about failures from our monitoring before the client does.'],
    risk: [
      ['Likelihood of recurrence', t.severity === 'critical' ? 'Medium' : 'Low'],
      ['Residual risk after actions', 'Low'],
      ['Follow-up review date', due(30)],
    ],
    signoff: [
      ['Prepared by (support / developer)', 'NXS support team', handoff ? fmtDateTime(handoff.at).split(',')[0] : ''],
      ['Reviewed by (project / account manager)', 'NXS account manager', handoff ? fmtDateTime(handoff.at).split(',')[0] : ''],
      ['Accepted by (client)', t.resolvedAt ? ctx.reporterName : '', t.resolvedAt ? fmtDateTime(t.resolvedAt).split(',')[0] : ''],
    ],
  };
}



/** Every single-value field of the report, by its label, so an instruction can name one. */
function fields(c: FullRcaContent): { label: string; get: () => string; set: (v: string) => void }[] {
  const rows = (list: [string, string][]) => list.map((r) => ({ label: r[0], get: () => r[1], set: (v: string) => (r[1] = v) }));
  return [
    ...rows(c.header),
    ...rows(c.summary),
    ...rows(c.details),
    ...rows(c.evidence),
    ...rows(c.resolution),
    ...rows(c.risk),
    { label: 'Root cause statement', get: () => c.rootCause, set: (v) => (c.rootCause = v) },
    { label: 'Method used', get: () => c.method, set: (v) => (c.method = v) },
    { label: 'Went well', get: () => c.wentWell, set: (v) => (c.wentWell = v) },
    { label: 'Didn’t go well', get: () => c.didntGoWell, set: (v) => (c.didntGoWell = v) },
    ...c.factors.map((r) => ({ label: r[0], get: () => r[1], set: (v: string) => (r[1] = v) })),
  ];
}
const norm = (v: string) => v.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const firstSentence = (v: string) => (v.match(/^[^.!?]+[.!?]/)?.[0] ?? v).trim();

/**
 * The full RCA assistant, simulated like the rest: it takes a plain instruction and changes the
 * report. It understands setting a named part ("Users affected: about 120 orders"), shortening a
 * section, adding an action or a lesson, and filling in what is still marked to confirm.
 */
export function editFullRca(content: FullRcaContent, instruction: string): { content: FullRcaContent; reply: string } {
  const c: FullRcaContent = JSON.parse(JSON.stringify(content));
  const q = instruction.trim();
  const nq = norm(q);
  const all = fields(c);

  // Add an action: "add action: monitor the connector daily" (type and owner if named).
  const act = q.match(/^(?:add|tambah(?:kan)?)\s+(?:an?\s+)?(?:action|aksi|tindakan)\s*[:-]?\s*(.+)$/i);
  if (act) {
    const text = act[1].trim();
    const type = /detect|alert|monitor/i.test(text) ? 'Detective' : /process|checklist|procedure|policy/i.test(text) ? 'Process' : 'Preventive';
    c.actions.push({ action: text.charAt(0).toUpperCase() + text.slice(1), type, owner: 'NXS developer', due: c.actions[c.actions.length - 1]?.due ?? '', status: 'Open' });
    return { content: c, reply: `Added a ${type.toLowerCase()} action: “${text}”. Set its owner and due date in section 7 if they differ.` };
  }
  const lesson = q.match(/^(?:add|tambah(?:kan)?)\s+(?:a\s+)?(?:lesson|pelajaran)\s*[:-]?\s*(.+)$/i);
  if (lesson) {
    c.lessons.push(lesson[1].trim());
    return { content: c, reply: 'Added it to Lessons Learned.' };
  }
  // Shorten: "make the executive summary shorter".
  if (/shorter|simpler|concise|ringkas|singkat|pendek/i.test(q)) {
    const section = /summary|ringkasan|executive/.test(nq) ? 'summary' : /evidence|symptom/.test(nq) ? 'evidence' : /detail/.test(nq) ? 'details' : 'summary';
    (c[section] as [string, string][]).forEach((r) => (r[1] = firstSentence(r[1])));
    return { content: c, reply: `Shortened the ${section === 'summary' ? 'executive summary' : section === 'evidence' ? 'symptoms and evidence' : 'incident details'} to one sentence per point.` };
  }
  // Set a named part: the longest label the instruction mentions wins ("Time to resolve" over "Time").
  const named = all.filter((f) => nq.includes(norm(f.label))).sort((a, b) => b.label.length - a.label.length)[0];
  if (named) {
    // What follows the label is the new value: "Users affected: about 120 orders".
    const i = q.toLowerCase().indexOf(named.label.toLowerCase());
    const rest = (i >= 0 ? q.slice(i + named.label.length) : q.replace(/^[^:=]*[:=]/, ''))
      .replace(/^\s*(?:[:=-]|to be|to|is|jadi|menjadi)\s*/i, '')
      .trim();
    if (rest) {
      named.set(rest.charAt(0).toUpperCase() + rest.slice(1));
      return { content: c, reply: `Updated ${named.label}.` };
    }
    return { content: c, reply: `${named.label} reads: “${named.get()}”. Tell me what it should say, for example “${named.label}: …”.` };
  }
  const open = all.filter((f) => f.get().startsWith('[To confirm')).map((f) => f.label);
  if (/confirm|todo|missing|kosong|kurang|belum/i.test(q))
    return { content: c, reply: open.length ? `Still to confirm: ${open.join(', ')}. Give me each one as “Label: value”.` : 'Nothing is left to confirm.' };
  return { content: c, reply: `I couldn’t tell which part to change. Name it, like “Users affected: about 120 orders”, “Make the executive summary shorter” or “Add action: alert on failed syncs”.${open.length ? ` Still to confirm: ${open.join(', ')}.` : ''}` };
}

export interface AiAnswer {
  text: string;
  /** Text the answer suggests putting in the initial RCA. */
  apply?: { problem?: string; issue?: string; fix?: string };
}

/** Questions offered before anyone has asked one. */
export const STARTERS = ['What’s the issue?', 'Why this cause?', 'What should we check first?', 'How long will it take?', 'Rewrite it for the client'];

const PRIORITY_NAME: Record<string, string> = { critical: 'P1 Critical', medium: 'P2 Medium', low: 'P3 Low' };
/** What the priority means for the people using the asset, in plain words. */
const EFFECT: Record<string, string> = {
  critical: 'It stops a core flow, with no way around it.',
  medium: 'Part of the flow is affected, but people can still get through.',
  low: 'It’s a minor problem with little effect on day-to-day use.',
};

/** An answer to a question about the analysis, matched on what the question asks. */
export function answer(question: string, t: Ticket, assetName: string, a: Pick<Analysis, 'issue' | 'fix' | 'similar' | 'questions'>, fixDue: number, now: number, storyPoints?: number): AiAnswer {
  const q = question.toLowerCase();
  const { area, isChange } = readTicket(t);
  const firstLine = (t.description.match(/^[^.!?]+[.!?]/)?.[0] ?? t.description).trim();

  // The problem itself, in short: what happens, where, and how much it matters.
  if (/what.{0,12}(issue|problem|happen|wrong)|masalah|issue ?nya|summar|ringkas|intinya/.test(q)) {
    return { text: problemOf(t, assetName), apply: { problem: problemOf(t, assetName) } };
  }
  if (/why|kenapa|reason|alasan|cause|penyebab|yakin|sure/.test(q)) {
    const basis = area ? `The brief points to ${area.where}: “${firstLine}” Faults like this usually mean ${area.cause}.` : `The brief doesn’t name a clear area yet: “${firstLine}” So the cause is a first guess until it is reproduced.`;
    const ids = a.similar.map((s) => s.id);
    const named = ids.length > 1 ? `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}` : ids[0];
    const past = ids.length ? ` ${named} on ${assetName} read the same way and ${ids.length > 1 ? 'were' : 'was'} fixed in that area.` : ` There are no earlier tickets like it on ${assetName}, so confirm it before sharing.`;
    return { text: isChange ? `It reads as a change request, not a fault: “${firstLine}” Nothing points to something broken.` : basis + past };
  }
  if (/check|cek|first|dulu|start|mulai|step|langkah|debug|investig/.test(q)) {
    const steps = isChange
      ? ['Confirm the exact change and any deadline with the client.', `Make it on staging for ${assetName} and check it on desktop and mobile.`, 'Get it tested, then file the release request.']
      : [`Reproduce it on ${assetName} with the client’s steps${a.questions[0] ? ` (ask: ${a.questions[0].toLowerCase()})` : ''}.`, area ? `Check ${area.where} first. The likely fault: ${area.cause}.` : 'Check what changed on the asset around the time it started.', 'Once found, fix it and run the affected flow end to end.'];
    return { text: steps.map((s, i) => `${i + 1}. ${s}`).join('\n') };
  }
  if (/long|lama|estimate|estimasi|hour|jam|deadline|when|kapan/.test(q)) {
    const pts = storyPoints ?? 3;
    const left = fixDue - now;
    return { text: `About ${pts} ${pts === 1 ? 'hour' : 'hours'} of work, going by the story points. The SLA deadline is ${fmtDateTime(fixDue)}${left > 0 ? `, so there is room for testing and the release` : ''}.${a.similar.find((s) => s.tookMs) ? ` A similar ticket, ${a.similar.find((s) => s.tookMs)!.id}, took ${fmtDuration(a.similar.find((s) => s.tookMs)!.tookMs!)} from report to fix.` : ''}` };
  }
  if (/similar|mirip|before|sebelum|pernah|history|riwayat/.test(q)) {
    return { text: a.similar.length ? a.similar.map((s) => `${s.id}: ${s.title}${s.tookMs ? `, fixed in ${fmtDuration(s.tookMs)}` : ''}`).join('\n') : `No finished tickets on ${assetName} read like this one.` };
  }
  if (/ask|tanya|question|pertanyaan|client.*know|info/.test(q) && !/rewrite|tulis/.test(q)) {
    return { text: a.questions.map((x, i) => `${i + 1}. ${x}`).join('\n') };
  }
  if (/client|simple|simpel|rewrite|tulis|bahasa|plain|short|singkat/.test(q)) {
    // Short, in the client's terms: what goes wrong for them, then what happens next. No internals.
    const issue = isChange
      ? a.issue.replace(/^Nothing is broken\. This is a change to [^:]+: /, 'You asked us to ')
      : area
        ? `We found the problem in ${area.where}: ${area.cause}.`
        : 'We’re still pinning down the exact cause and will tell you as soon as we have it.';
    const fix = isChange ? 'We’ll make the change, test it, and let you check it before it goes live.' : 'We’re fixing that step now and will test it end to end before it reaches you.';
    return { text: `${issue}\n${fix}`, apply: { issue, fix } };
  }
  return { text: `Here is the short version: ${a.issue} The plan: ${a.fix}\nYou can ask what the issue is, why this cause, what to check first, how long it will take, about similar tickets, or for a version written for the client.` };
}

/** A first draft of the resolution notes; QA adds anything specific to this fix. */
export function verifiedDraft(assetName: string): string {
  return `Fixed on ${assetName}. The steps from the report now work as expected, tested on desktop and mobile, and the related flows still work.`;
}
