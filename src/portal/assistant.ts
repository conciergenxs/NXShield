import type { Ticket } from '../types';
import type { TicketSla } from '../lib/sla';
import { fmtDateTime } from '../lib/format';
import { portalStatus } from '../lib/domain';

/*
 * The client's assistant on a ticket, simulated: it answers from the ticket's
 * own data (stage, deadlines, the RCA, the latest update), the way someone
 * would ask "where is my order?". A real version would call an LLM with the
 * same inputs and only client-visible data.
 */

export const CLIENT_STARTERS = ['When will it be fixed?', 'What’s happening now?', 'What caused it?', 'Do I need to do anything?'];

/** The latest update NXS sent the client on this ticket, if any. */
export function latestUpdate(t: Ticket) {
  return [...t.activity].reverse().find((a) => a.visibility === 'client' && (a.kind === 'progress' || a.kind === 'diagnosis'));
}

export function clientAnswer(question: string, t: Ticket, sla: TicketSla, now: number): string {
  const q = question.toLowerCase();
  const stage = portalStatus(t.status);
  const fixBy = fmtDateTime(sla.resolution.due);
  // The analysis is the initial RCA, due T+3.
  const replyBy = fmtDateTime(sla.initialRca.due);
  const update = latestUpdate(t);

  if (/when|kapan|long|lama|fixed|selesai|done|expect|eta/.test(q)) {
    if (stage === 'resolved') return 'It’s done: the fix was deployed. The full RCA is on this page.';
    if (stage === 'canceled') return 'This ticket was canceled, so no fix is planned.';
    if (stage === 'ready_to_deploy') return 'The fix is ready now. Check the full RCA on this page, then press Deploy when you’re happy with it.';
    if (stage === 'new') return `We’re analysing it first. You’ll get the Initial RCA Report by ${replyBy}, with how long the fix takes.`;
    return sla.resolution.due >= now ? `We expect it fixed by ${fixBy}, as agreed for this priority.` : `It’s taking longer than planned. We’re still on it and will update you here.`;
  }
  if (/now|happening|status|progress|update|sekarang|sedang|lagi/.test(q)) {
    if (stage === 'new') return `We received it and are analysing it. The Initial RCA Report comes by ${replyBy}.`;
    if (stage === 'ready_to_deploy') return 'Testing passed and the fix is ready for you to deploy.';
    if (stage === 'resolved') return 'It’s deployed and closed.';
    if (stage === 'canceled') return 'It was canceled.';
    return update ? `It’s being fixed. Latest update: ${update.kind === 'diagnosis' ? 'we sent the Initial RCA Report and started the fix.' : update.text}` : 'It’s being fixed now.';
  }
  if (/cause|why|kenapa|penyebab|wrong|salah/.test(q)) {
    return t.diagnosis ? `${t.diagnosis.issue} The fix: ${t.diagnosis.fix}` : `We’re still finding the cause. You’ll get it in the Initial RCA Report by ${replyBy}.`;
  }
  if (/full|report|laporan|lengkap|rca/.test(q)) {
    if (t.handoffs.length) return 'The full RCA came with the fix: you’ll find the document on this page, in the timeline under “Fix tested, full RCA sent”.';
    return 'The full RCA comes with the fix, as a document you can keep: summary, timeline, root cause, impact, what we did and how we prevent it.';
  }
  if (/do i|need|action|perlu|harus|anything/.test(q)) {
    if (stage === 'ready_to_deploy') return 'Yes: check the full RCA on this page, then press Deploy. If something isn’t right, reply in the comments instead.';
    return 'Nothing for now. We’ll let you know here when the fix is ready for you to deploy.';
  }
  return `${t.title}: it’s ${stage === 'new' ? 'submitted and being analysed' : stage === 'ready_to_deploy' ? 'ready for you to deploy' : stage === 'resolved' ? 'deployed' : stage === 'canceled' ? 'canceled' : 'being fixed'}. You can ask when it will be fixed, what’s happening now, what caused it, or whether you need to do anything.`;
}
