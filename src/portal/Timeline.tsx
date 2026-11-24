import { useMemo, type ReactNode } from 'react';
import { FileText, Rocket } from 'lucide-react';
import type { Ticket } from '../types';
import { SEVERITY_LABEL, clientVisibleActivity, portalStatus } from '../lib/domain';
import { fmtDate, fmtDateTime, fmtDateYear, fmtTime, fmtWeekday, startOfDay } from '../lib/format';
import { useStore } from '../store';
import { Attachments } from '../components/detail';
import { Button, cx } from '../components/ui';
import { portalText } from './shared';

/*
 * The ticket from the client's side as one timeline, newest first: what comes
 * next on top (with when to expect it, or the button when it is their turn),
 * then everything that has happened, down to their own report. NXS's three
 * deliverables (the reply, the initial RCA, the full RCA sent with the fix)
 * are entries of their own; progress updates are small ones.
 */

type Entry = {
  key: string;
  at: number;
  title: string;
  meta?: string;
  body?: ReactNode;
  size: 'big' | 'small';
  state: 'done' | 'now' | 'next';
};

/** How long the fix takes, as the SLA gives it for this priority. */
function within(ms: number) {
  const days = ms / 86_400_000;
  if (Number.isInteger(days)) return `${days} ${days === 1 ? 'day' : 'days'}`;
  const h = Math.round(ms / 3_600_000);
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

/** When to expect something: a rough hour on the same day, the date otherwise. */
function expected(ts: number, now: number) {
  const half = 30 * 60_000;
  if (startOfDay(ts) === startOfDay(now)) return `around ${fmtTime(Math.ceil(ts / half) * half)} today`;
  return `${fmtWeekday(ts)}, ${fmtDate(ts)}`;
}

export function Timeline({ ticket, userId, onDeploy, onComment }: { ticket: Ticket; userId: string; onDeploy: () => void; onComment: () => void }) {
  const { slaOf, clients, assetOf, now } = useStore();
  const sla = slaOf(ticket);
  const stage = portalStatus(ticket.status);
  const names = useMemo(() => new Map(clients.flatMap((c) => c.users).map((u) => [u.id, u.name])), [clients]);
  const who = (id: string) => (id === userId ? 'You' : (names.get(id) ?? 'Your team'));

  const entries: Entry[] = [];
  // Their own report, as sent.
  entries.push({
    key: 'report',
    at: ticket.createdAt,
    title: 'Report submitted',
    meta: `${who(ticket.reporterId)} · ${fmtDateTime(ticket.createdAt)}`,
    size: 'big',
    state: 'done',
    body: (
      <>
        <p className="pt-tl-text">{ticket.description}</p>
        <Attachments files={ticket.attachments} />
      </>
    ),
  });
  const reply = ticket.initialResponse;
  if (reply)
    entries.push({
      key: 'reply',
      at: reply.at,
      title: 'Reply from NXS',
      meta: `${fmtDateTime(reply.at)}${reply.at <= sla.firstResponse.due ? ' · within 1 hour' : ''}`,
      size: 'big',
      state: 'done',
      body: <p className="pt-tl-text is-soft">{reply.text}</p>,
    });
  const d = ticket.diagnosis;
  if (d)
    entries.push({
      key: 'rca',
      at: d.at,
      title: 'Initial analysis (RCA)',
      meta: `${fmtDateTime(d.at)}${d.at <= sla.initialRca.due ? ' · within 3 hours' : ''}`,
      size: 'big',
      state: 'done',
      body: (
        <dl className="rca-fields pt-tl-fields">
          <div>
            <dt>Issue</dt>
            <dd>{d.problem ?? ticket.title}</dd>
          </div>
          <div>
            <dt>Cause</dt>
            <dd>{d.issue}</dd>
          </div>
          <div>
            <dt>How it will be fixed</dt>
            <dd>{d.fix}</dd>
          </div>
          <div>
            <dt>Time to fix</dt>
            <dd>
              <span className="fix-when">
                <strong>Within {within(sla.resolution.due - ticket.createdAt)}</strong>
                <span className="muted">
                  {ticket.severity ? SEVERITY_LABEL[ticket.severity] : 'This priority'}, by {fmtDateYear(sla.resolution.due)}
                </span>
              </span>
            </dd>
          </div>
        </dl>
      ),
    });
  // Progress updates as NXS wrote them, and the client's own moves.
  for (const a of clientVisibleActivity(ticket)) {
    if (a.kind === 'progress') entries.push({ key: a.id, at: a.at, title: portalText(a), meta: fmtDateTime(a.at), size: 'small', state: 'done' });
    if (a.kind === 'status' && a.actor.type === 'client' && /Declined/.test(a.text)) {
      const fb = ticket.feedback.find((f) => f.decision === 'declined' && Math.abs(f.at - a.at) < 60_000);
      entries.push({ key: a.id, at: a.at, title: 'You asked us to look again', meta: `${who(a.actor.id)} · ${fmtDateTime(a.at)}`, size: 'small', state: 'done', body: fb?.note ? <p className="pt-tl-text is-soft">{fb.note}</p> : undefined });
    }
  }
  // Each fix sent for the client, with its full RCA. The one waiting on them is the deploy step on top.
  const waiting = stage === 'ready_to_deploy' ? ticket.handoffs[ticket.handoffs.length - 1] : undefined;
  ticket.handoffs.forEach((h) => {
    if (h === waiting) return;
    entries.push({ key: h.id, at: h.at, title: 'Fix tested, full RCA sent', meta: fmtDateTime(h.at), size: 'big', state: 'done', body: <Attachments files={h.attachments} /> });
  });
  if (ticket.status === 'resolved' && ticket.resolvedAt) {
    const by = [...ticket.activity].reverse().find((a) => a.kind === 'resolution');
    entries.push({ key: 'deployed', at: ticket.resolvedAt, title: 'Deployed', meta: `${by?.actor.type === 'client' ? who(by.actor.id) : 'NXS'} · ${fmtDateTime(ticket.resolvedAt)}`, size: 'big', state: 'done' });
  }
  if (ticket.status === 'canceled' && ticket.cancellation)
    entries.push({ key: 'canceled', at: ticket.cancellation.at, title: 'Canceled', meta: `NXS · ${fmtDateTime(ticket.cancellation.at)}`, size: 'big', state: 'done', body: <p className="pt-tl-text">{ticket.cancellation.reason}</p> });

  const assetName = assetOf(ticket.assetId)?.name ?? 'your site';
  // What comes next, with when to expect it, so the page never ends on the last thing that happened.
  // When it is the client's turn, that is the top entry, with the button.
  const cadence = ticket.severity === 'critical' ? 'We update you here every hour until then.' : ticket.severity === 'medium' ? 'We update you here every 4 hours until then.' : 'We’ll let you know here when it’s ready.';
  const next: Entry | null =
    stage === 'new'
      ? reply
        ? { key: 'next', at: now, title: 'Initial analysis (RCA)', meta: `Expected ${expected(sla.initialRca.due, now)}`, size: 'big', state: 'next', body: <p className="pt-tl-text is-muted">The issue, what’s causing it and how long the fix takes, on this page.</p> }
        : { key: 'next', at: now, title: 'Reply from NXS', meta: `Expected ${expected(sla.firstResponse.due, now)}`, size: 'big', state: 'next', body: <p className="pt-tl-text is-muted">We confirm we’ve got your report, how we’ve rated it and when our analysis follows.</p> }
      : stage === 'in_progress'
        ? { key: 'next', at: now, title: 'Fix ready for you to deploy', meta: sla.resolution.due >= now ? `Estimated ${expected(sla.resolution.due, now)}` : 'Taking a little longer than estimated', size: 'big', state: 'next', body: <p className="pt-tl-text is-muted">It comes with the full RCA. {cadence}</p> }
        : stage === 'ready_to_deploy'
          ? {
              key: 'next',
              at: now,
              title: 'Ready for you to deploy',
              meta: waiting ? `Tested ${fmtDateTime(waiting.at)} · waiting for you` : 'Waiting for you',
              size: 'big',
              state: 'now',
              body: (
                // One highlighted block: what is waiting, and the two things to do with it.
                <div className="pt-tl-ready">
                  <p className="pt-tl-ready-text">The fix passed testing. The full RCA report covers what happened, why, what we did and how we prevent it. Deploy the fix and it goes live on {assetName}.</p>
                  <div className="pt-tl-ready-foot">
                    <button type="button" className="link-btn" onClick={onComment}>
                      Something’s not right? Tell us in the comments
                    </button>
                    <div className="pt-tl-ready-actions">
                      {/* The report opens as a page of its own, to read or pass on. */}
                      <a className="btn btn-secondary" href={`/report/${ticket.id}`} target="_blank" rel="noopener noreferrer">
                        <FileText size={15} aria-hidden />
                        View full report
                      </a>
                      <Button variant="primary" onClick={onDeploy}>
                        <Rocket size={15} aria-hidden />
                        Deploy
                      </Button>
                    </div>
                  </div>
                </div>
              ),
            }
          : null;

  const list = [...(next ? [next] : []), ...entries.sort((a, b) => b.at - a.at)];

  return (
    <section className="main-block" aria-label="Timeline">
      <ol className="pt-tl">
        {list.map((e, i) => (
          <li key={e.key} className={cx('pt-tl-item', `is-${e.size}`, `is-${e.state}`, i === list.length - 1 && 'is-last')}>
            <span className="pt-tl-marker" aria-hidden />
            <div className="pt-tl-head">
              <p className="pt-tl-title">
                {e.state === 'next' && <span className="pt-tl-next">Next</span>}
                {e.title}
              </p>
              {e.meta && <p className="pt-tl-meta">{e.meta}</p>}
            </div>
            {e.body && <div className="pt-tl-body">{e.body}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}
