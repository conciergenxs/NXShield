import { useMemo, useState, type ReactNode } from 'react';
import { BadgeCheck, Ban, Clock, FileText, MessageSquareText, Package, Rocket, SearchCheck, Send, ShieldCheck, ThumbsUp, type LucideIcon } from 'lucide-react';
import type { CommentOn, Ticket } from '../types';
import { SEVERITY_LABEL, clientVisibleActivity, portalStatus } from '../lib/domain';
import { fmtDate, fmtDateTime, fmtDateYear, fmtRelative, fmtTime, fmtWeekday, startOfDay } from '../lib/format';
import { useStore } from '../store';
import { Attachments } from '../components/detail';
import { Avatar, cx } from '../components/ui';
import { CommentBox, withMentions } from '../components/comments';
import { portalText } from './shared';
import { fullRcaPlan } from '../lib/release';

/*
 * The ticket from the client's side as one timeline, newest first: what comes
 * next on top (with when to expect it, or the button when it is their turn),
 * then everything that has happened, down to their own report. NXS's three
 * deliverables (the reply, the initial RCA, the fix with its release notes)
 * are entries of their own; progress updates are small ones.
 */

type Entry = {
  key: string;
  /** People can reply under it, like a post: the initial RCA, or one fix sent. */
  replies?: CommentOn;
  /** A button on the entry's own line, beside its title. */
  action?: ReactNode;
  /** What kind of moment it is, shown in its marker on the line. */
  icon?: LucideIcon;
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

const same = (a: CommentOn | undefined, b: CommentOn) => !!a && a.kind === b.kind && (a.kind === 'rca' || (b.kind === 'release' && a.id === b.id));

/** Replies under one timeline entry, like a thread: who, when, what, then a reply box that opens on demand. */
/** NXS in a conversation: the company's mark, never a person's face. */
function NxsMark() {
  return (
    <span className="comment-mark" aria-hidden>
      <ShieldCheck size={14} />
    </span>
  );
}

function Replies({ ticket, userId, on }: { ticket: Ticket; userId: string; on: CommentOn }) {
  const { addComment, clients, clientOf, now } = useStore();
  const names = useMemo(() => new Map(clients.flatMap((c) => c.users).map((u) => [u.id, u.name])), [clients]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const list = ticket.comments.filter((c) => c.thread === 'client' && same(c.on, on)).sort((x, y) => x.at - y.at);
  const people = (clientOf(ticket.clientId)?.users ?? []).filter((u) => u.id !== userId).map((u) => ({ id: u.id, name: u.name, title: u.title }));
  const name = (c: (typeof list)[number]) => (c.by.type === 'client' ? (c.by.id === userId ? 'You' : (names.get(c.by.id) ?? 'Your team')) : 'NXS');
  const send = () => {
    if (!text.trim()) return;
    addComment(ticket.id, 'client', text, { type: 'client', id: userId }, on);
    setText('');
    // Sent: the reply joins the thread and the box closes, like posting a reply.
    setOpen(false);
  };
  return (
    <div className="pt-replies">
      {list.length > 0 && (
        <ol className="comment-list is-thread pt-comment-list" aria-label="Comments">
          {list.map((c) => (
            <li key={c.id} className={cx('comment', c.by.type !== 'client' && 'is-nxs')}>
              {c.by.type === 'client' ? <Avatar name={names.get(c.by.id) ?? name(c)} size={28} /> : <NxsMark />}
              <div className="comment-body">
                <p className="comment-meta">
                  <span className="comment-name">{name(c)}</span>
                  <time title={fmtDateTime(c.at)}>{fmtRelative(c.at, now)}</time>
                </p>
                <p className="comment-text">{withMentions(c.text, people.map((p) => p.name))}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {open ? (
        <div className="pt-reply-compose">
          <CommentBox value={text} onChange={setText} onSend={send} people={people} label="Comment to NXS" placeholder="Write a comment to NXS… Type @ to mention someone on your team." />
          <button type="button" className="link-btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="pt-reply-open" onClick={() => setOpen(true)}>
          <MessageSquareText size={15} aria-hidden />
          Comment
        </button>
      )}
    </div>
  );
}

export function Timeline({ ticket, userId }: { ticket: Ticket; userId: string }) {
  const { slaOf, clients, assetOf, now, memberOf } = useStore();
  const sla = slaOf(ticket);
  const stage = portalStatus(ticket.status);
  const names = useMemo(() => new Map(clients.flatMap((c) => c.users).map((u) => [u.id, u.name])), [clients]);
  const who = (id: string) => (id === userId ? 'You' : (names.get(id) ?? 'Your team'));

  const entries: Entry[] = [];
  // Their own report, as sent.
  entries.push({
    key: 'report',
    icon: Send,
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
      icon: MessageSquareText,
      at: reply.at,
      title: 'Reply from NXS',
      meta: `${fmtDateTime(reply.at)}${reply.at <= sla.firstResponse.due ? ' · Within T+1' : ''}`,
      size: 'big',
      state: 'done',
      body: (() => {
        // Signed like a support reply: the person who sent it, or the NXS team when it went out automatically.
        const member = reply.by.type === 'team' ? memberOf(reply.by.id) : undefined;
        return (
          <div className="pt-tl-letter">
            <blockquote className="pt-tl-quote">{reply.text}</blockquote>
            <div className="pt-tl-sign">
              {member ? <Avatar name={member.name} size={28} /> : <NxsMark />}
              <span className="pt-tl-sign-text">
                <span className="pt-tl-sign-name">~ {member ? member.name : 'NXS Support Team'}</span>
                <span className="pt-tl-sign-role">{member ? `${member.title} · NXS` : 'Client Support'}</span>
              </span>
            </div>
          </div>
        );
      })(),
    });
  const d = ticket.diagnosis;
  if (d)
    entries.push({
      key: 'rca',
      icon: SearchCheck,
      replies: { kind: 'rca' },
      at: d.at,
      title: 'Initial analysis (RCA)',
      meta: `${fmtDateTime(d.at)}${d.at <= sla.initialRca.due ? ' · Within T+3' : ''}`,
      size: 'big',
      state: 'done',
      body: (
        <div className="pt-tl-block">
          <dl className="rca-fields rca-form">
            <div>
              <dt>
                Issue<small>What happens</small>
              </dt>
              <dd>{d.problem ?? ticket.title}</dd>
            </div>
            <div>
              <dt>
                Cause<small>Why it happens</small>
              </dt>
              <dd>{d.issue}</dd>
            </div>
            <div>
              <dt>
                How it will be fixed<small>What we’ll do</small>
              </dt>
              <dd>{d.fix}</dd>
            </div>
            <div>
              <dt>
                Time to fix<small>Set by the SLA</small>
              </dt>
              <dd className="fix-when">
                <strong>Within {within(sla.resolution.due - ticket.createdAt)}</strong>
                <span className="muted">
                  {ticket.severity ? SEVERITY_LABEL[ticket.severity] : 'This priority'}, by {fmtDateYear(sla.resolution.due)}
                </span>
              </dd>
            </div>
          </dl>
        </div>
      ),
    });
  // Progress updates as NXS wrote them, and the client's own moves.
  for (const a of clientVisibleActivity(ticket)) {
    if (a.kind === 'progress') entries.push({ key: a.id, at: a.at, title: portalText(a), meta: fmtDateTime(a.at), size: 'small', state: 'done' });
    if (a.kind === 'status' && a.actor.type === 'client' && /Declined/.test(a.text)) {
      const fb = ticket.feedback.find((f) => f.decision === 'declined' && Math.abs(f.at - a.at) < 60_000);
      entries.push({ key: a.id, icon: MessageSquareText, at: a.at, title: 'You asked us to look again', meta: `${who(a.actor.id)} · ${fmtDateTime(a.at)}`, size: 'small', state: 'done', body: fb?.note ? <p className="pt-tl-text is-soft">{fb.note}</p> : undefined });
    }
  }
  // Comments from before replies were tied to an entry stay on the line, at their time.
  for (const c of ticket.comments.filter((x) => x.thread === 'client' && !x.on)) {
    const from = c.by.type === 'client' ? who(c.by.id) : 'NXS';
    entries.push({ key: c.id, at: c.at, title: `${from}: “${c.text.length > 160 ? `${c.text.slice(0, 157)}…` : c.text}”`, meta: fmtDateTime(c.at), size: 'small', state: 'done' });
  }
  // Each fix sent for the client: the release notes as proof, and the image it ships in. The one waiting on them is on top.
  const waiting = stage === 'ready_to_deploy' ? ticket.handoffs[ticket.handoffs.length - 1] : undefined;
  const lastFeedback = ticket.feedback[ticket.feedback.length - 1];
  const approved = waiting && lastFeedback?.decision === 'approved' && lastFeedback.at >= waiting.at ? lastFeedback : undefined;
  // The same three rows NXS checks: the image that goes live, the release notes, and QA's proof.
  const release = (h: Ticket['handoffs'][number]) => {
    const proof = h.attachments.filter((f) => !/^RCA Report/.test(f.name));
    return (
      <dl className="rca-fields rca-form">
        {h.imageTag && (
          <div>
            <dt>
              Container registry<small>The image that goes live</small>
            </dt>
            <dd>
              <code className="fix-tag">{h.imageTag}</code>
            </dd>
          </div>
        )}
        {h.note && (
          <div>
            <dt>
              Release notes<small>Proof it’s fixed</small>
            </dt>
            <dd>{h.note}</dd>
          </div>
        )}
        {proof.length > 0 && (
          <div>
            <dt>
              Proof<small>From testing</small>
            </dt>
            <dd>
              <Attachments files={proof} />
            </dd>
          </div>
        )}
      </dl>
    );
  };
  ticket.handoffs.forEach((h) => {
    // The one waiting on them sits on top; once approved it joins the history, replies and all.
    if (h === waiting && !approved) return;
    entries.push({ key: h.id, icon: Package, replies: { kind: 'release', id: h.id }, at: h.at, title: 'Fix tested and sent to you', meta: fmtDateTime(h.at), size: 'big', state: 'done', body: <div className="pt-tl-block">{release(h)}</div> });
  });
  if (approved) entries.push({ key: 'approved', icon: ThumbsUp, at: approved.at, title: 'You approved the deploy', meta: `${who(approved.by)} · ${fmtDateTime(approved.at)}`, size: 'small', state: 'done' });
  if (ticket.status === 'resolved' && ticket.resolvedAt) {
    const by = [...ticket.activity].reverse().find((a) => a.kind === 'resolution');
    // Whether a full RCA report follows, from the SLA, said once on the live entry.
    const plan = fullRcaPlan(ticket);
    entries.push({
      key: 'deployed',
      icon: Rocket,
      at: ticket.resolvedAt,
      title: 'Fixed and live',
      meta: `${by?.actor.type === 'client' ? who(by.actor.id) : 'NXS'} · ${fmtDateTime(ticket.resolvedAt)}`,
      size: 'big',
      state: 'done',
      body: <p className="pt-tl-text is-muted">{plan.due != null ? `A full RCA report follows. ${plan.why}` : `No full RCA report for this one. ${plan.why}`}</p>,
    });
  }
  if (ticket.status === 'canceled' && ticket.cancellation)
    entries.push({
      key: 'canceled',
      icon: Ban,
      at: ticket.cancellation.at,
      title: 'Canceled',
      meta: `NXS · ${fmtDateTime(ticket.cancellation.at)}`,
      size: 'big',
      state: 'done',
      body: (
        <>
          <p className="pt-tl-text">{ticket.cancellation.reason}</p>
          {ticket.cancellation.proof && <Attachments files={ticket.cancellation.proof} />}
        </>
      ),
    });

  const assetName = assetOf(ticket.assetId)?.name ?? 'your site';
  // What comes next, with when to expect it, so the page never ends on the last thing that happened.
  // When it is the client's turn, that is the top entry, with the button.
  const cadence = ticket.severity === 'critical' ? 'We update you here every hour until then.' : ticket.severity === 'medium' ? 'We update you here every 4 hours until then.' : 'We’ll let you know here when it’s ready.';
  // The full RCA, after it's resolved, as the SLA times it.
  const rca = ticket.status === 'resolved' ? fullRcaPlan(ticket) : null;
  const rcaSent = rca?.due != null && rca.due <= now;
  if (rca && rcaSent) entries.push({ key: 'full-rca', icon: FileText, at: rca.due!, title: 'Full RCA report', meta: fmtDateTime(rca.due!), size: 'big', state: 'done', body: <a className="btn btn-secondary btn-sm" href={`/report/${ticket.id}`} target="_blank" rel="noopener noreferrer"><FileText size={15} aria-hidden />View full report</a> });

  const next: Entry | null =
    stage === 'new'
      ? reply
        ? { key: 'next', icon: SearchCheck, at: now, title: 'Initial analysis (RCA)', meta: `Expected ${expected(sla.initialRca.due, now)}`, size: 'big', state: 'next', body: <p className="pt-tl-text is-muted">The issue, what’s causing it and how long the fix takes, on this page.</p> }
        : { key: 'next', icon: MessageSquareText, at: now, title: 'Reply from NXS', meta: `Expected ${expected(sla.firstResponse.due, now)}`, size: 'big', state: 'next', body: <p className="pt-tl-text is-muted">We confirm we’ve got your report, how we’ve rated it and when our analysis follows.</p> }
      : stage === 'in_progress'
        ? { key: 'next', icon: Package, at: now, title: 'Fix ready for you to approve', meta: sla.resolution.due >= now ? `Estimated ${expected(sla.resolution.due, now)}` : 'Taking a little longer than estimated', size: 'big', state: 'next', body: <p className="pt-tl-text is-muted">Tested first, with notes on what we fixed and how we checked it. {cadence}</p> }
        : stage === 'ready_to_deploy'
          ? approved
            ? { key: 'next', icon: Rocket, at: now, title: 'NXS is deploying the fix', meta: `You approved it ${fmtDateTime(approved.at)}`, size: 'big', state: 'next', body: <p className="pt-tl-text is-muted">It goes live on {assetName} next. We’ll let you know here when it’s done.</p> }
            : {
                key: 'next',
                icon: BadgeCheck,
                replies: waiting ? { kind: 'release', id: waiting.id } : undefined,
                at: now,
                title: 'Ready for you to approve',
                meta: waiting ? `Tested ${fmtDateTime(waiting.at)} · waiting for you` : 'Waiting for you',
                size: 'big',
                state: 'now',
                // What is waiting, as one highlighted block. NXS does the deploy.
                body: <div className="pt-tl-ready">{waiting ? release(waiting) : <p className="pt-tl-text">The fix passed testing.</p>}</div>,
              }
          : rca?.due != null && !rcaSent
            ? { key: 'next', icon: FileText, at: now, title: 'Full RCA report', meta: `Sent to you on ${fmtDateTime(rca.due)}`, size: 'big', state: 'next', body: <p className="pt-tl-text is-muted">What happened, why, what we did and how we keep it from happening again. It covers everything up to then, in case anything comes back.</p> }
            : null;

  const list = [...(next ? [next] : []), ...entries.sort((a, b) => b.at - a.at)];

  return (
    <section className="main-block" aria-label="Timeline">
      <ol className="pt-tl">
        {list.map((e, i) => (
          <li key={e.key} className={cx('pt-tl-item', `is-${e.size}`, `is-${e.state}`, i === list.length - 1 && 'is-last')}>
            <span className="pt-tl-marker" aria-hidden>
              {e.size === 'big' && e.icon && <e.icon size={15} />}
              {e.state === 'next' && !e.icon && <Clock size={14} />}
            </span>
            <div className={cx('pt-tl-head', e.action != null && 'has-action')}>
              <div>
                <p className="pt-tl-title">
                  {e.state === 'next' && <span className="pt-tl-next">Next</span>}
                  {e.title}
                </p>
                {e.meta && <p className="pt-tl-meta">{e.meta}</p>}
              </div>
              {e.action}
            </div>
            {e.body && <div className="pt-tl-body">{e.body}</div>}
            {e.replies && <Replies ticket={ticket} userId={userId} on={e.replies} />}
          </li>
        ))}
      </ol>
    </section>
  );
}
