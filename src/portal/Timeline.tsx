import { useMemo, useState, type ReactNode } from 'react';
import { BadgeCheck, Ban, ChevronDown, Clock, FileText, MessageSquareText, Package, Rocket, SearchCheck, Send, ThumbsUp, type LucideIcon } from 'lucide-react';
import type { CommentOn, Ticket } from '../types';
import { SEVERITY_LABEL, clientVisibleActivity, portalStatus } from '../lib/domain';
import { fmtDate, fmtDateTime, fmtDateYear, fmtRelative, fmtTime, fmtWeekday, startOfDay } from '../lib/format';
import { useStore } from '../store';
import { Attachments } from '../components/detail';
import { Avatar, cx } from '../components/ui';
import { CommentBox, CommentThreads, type CommentAuthor } from '../components/comments';
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

const same = (a: CommentOn | undefined, b: CommentOn) => !!a && a.kind === b.kind && (a.kind !== 'release' || (b.kind === 'release' && a.id === b.id));

/** Comments under one timeline entry, threaded like the comments under a video: replies sit under the comment they answer. */
function Replies({ ticket, userId, on }: { ticket: Ticket; userId: string; on: CommentOn }) {
  const { addComment, clients, clientOf, memberOf, now } = useStore();
  const users = useMemo(() => new Map(clients.flatMap((c) => c.users).map((u) => [u.id, u.name])), [clients]);
  const [open, setOpen] = useState(false);
  const [folded, setFolded] = useState(false);
  const [text, setText] = useState('');
  const list = ticket.comments.filter((c) => c.thread === 'client' && same(c.on, on));
  const people = (clientOf(ticket.clientId)?.users ?? []).filter((u) => u.id !== userId).map((u) => ({ id: u.id, name: u.name, title: u.title }));
  // NXS people by name and photo, marked as NXS Support; the client's own people by name, "You" for the reader.
  const authorOf = (c: (typeof list)[number]): CommentAuthor => {
    if (c.by.type === 'client') return { name: users.get(c.by.id) ?? 'Your team', tag: c.by.id === userId ? 'You' : undefined };
    const m = c.by.type === 'team' ? memberOf(c.by.id) : undefined;
    return m ? { name: m.name, photo: m.photo, tag: 'NXS Support', nxs: true } : { name: 'NXS Support', tag: 'Automatic', nxs: true };
  };
  const send = () => {
    if (!text.trim()) return;
    addComment(ticket.id, 'client', text, { type: 'client', id: userId }, on);
    setText('');
    setOpen(false);
  };
  return (
    <div className={cx('pt-replies', folded && 'is-folded')}>
      {/* A new comment goes on top, where the newest ones are; the count folds the thread away when it gets long. */}
      <div className="pt-replies-bar">
        {open ? null : (
          <button type="button" className="pt-reply-open" onClick={() => setOpen(true)}>
            <MessageSquareText size={15} aria-hidden />
            {list.length ? 'New comment' : 'Comment'}
          </button>
        )}
        {list.length > 0 && (
          <button type="button" className="pt-replies-toggle" aria-expanded={!folded} onClick={() => setFolded((f) => !f)}>
            {list.length} {list.length === 1 ? 'comment' : 'comments'}
            <ChevronDown size={15} aria-hidden />
          </button>
        )}
      </div>
      {open && (
        <div className="pt-reply-compose">
          <CommentBox value={text} onChange={setText} onSend={send} onCancel={() => setOpen(false)} people={people} label="Comment to NXS" placeholder="Write a comment to NXS… Type @ to mention someone on your team." />
        </div>
      )}
      {list.length > 0 && !folded && (
        <CommentThreads
          comments={list}
          authorOf={authorOf}
          when={(c) => ({ short: fmtRelative(c.at, now), full: fmtDateTime(c.at) })}
          people={people}
          replyLabel="Reply"
          onReply={(t, to) => addComment(ticket.id, 'client', t, { type: 'client', id: userId }, on, to.id)}
        />
      )}
    </div>
  );
}

export function Timeline({ ticket, userId }: { ticket: Ticket; userId: string }) {
  const { slaOf, clients, now, memberOf } = useStore();
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
        // A message, as in a chat: who sent it (the person, or NXS Support when it went out on its own), then what it says.
        const member = reply.by.type === 'team' ? memberOf(reply.by.id) : undefined;
        return (
          <div className="pt-msg">
            <Avatar name={member?.name ?? 'NXS Support'} size={32} src={member?.photo} />
            <div className="pt-msg-body">
              <p className="ct-meta">
                <span className="ct-name">{member?.name ?? 'NXS Support'}</span>
                {member && <span className="ct-tag is-nxs">NXS Support</span>}
              </p>
              <p className="pt-msg-text">{reply.text}</p>
              {/* Sent on its own: signed with NXS Support's initials. */}
              {!member && <p className="pt-msg-sign">~NS</p>}
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
      title: 'Initial RCA Report',
      meta: `${fmtDateTime(d.at)}${d.at <= sla.initialRca.due ? ' · Within T+3' : ''}`,
      size: 'big',
      state: 'done',
      body: (
        <div className="pt-tl-block">
          <dl className="rca-fields rca-form">
            <div>
              <dt>
                Issue
              </dt>
              <dd>{d.problem ?? ticket.title}</dd>
            </div>
            <div>
              <dt>
                Cause
              </dt>
              <dd>{d.issue}</dd>
            </div>
            <div>
              <dt>
                How it will be fixed
              </dt>
              <dd>{d.fix}</dd>
            </div>
            <div>
              <dt>
                Time to fix
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
              Container registry
            </dt>
            <dd>
              <code className="fix-tag">{h.imageTag}</code>
            </dd>
          </div>
        )}
        {h.note && (
          <div>
            <dt>
              Release notes
            </dt>
            <dd>{h.note}</dd>
          </div>
        )}
        {(h.proofNote || proof.length > 0) && (
          <div>
            <dt>
              Proof
            </dt>
            <dd>
              {h.proofNote && <p className="fs-proof-note">{h.proofNote}</p>}
              {proof.length > 0 && <Attachments files={proof} />}
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
      body: <p className="pt-tl-text is-muted">{plan.due != null ? 'A full RCA report follows.' : 'No full RCA report for this one.'}</p>,
    });
  }
  if (ticket.status === 'canceled' && ticket.cancellation)
    entries.push({
      key: 'canceled',
      icon: Ban,
      at: ticket.cancellation.at,
      title: ticket.featureCheck?.result?.verdict === 'feature' ? 'Canceled as a feature request' : 'Canceled',
      meta: fmtDateTime(ticket.cancellation.at),
      size: 'big',
      state: 'done',
      replies: { kind: 'cancel' },
      // A message from the person who canceled it, with the reason they wrote; the client can comment under it.
      body: (() => {
        const c = ticket.cancellation!;
        const member = c.by.type === 'team' ? memberOf(c.by.id) : undefined;
        return (
          <div className="pt-msg">
            <Avatar name={member?.name ?? 'NXS Support'} size={32} src={member?.photo} />
            <div className="pt-msg-body">
              <p className="ct-meta">
                <span className="ct-name">{member?.name ?? 'NXS Support'}</span>
                <span className="ct-tag is-nxs">NXS Support</span>
              </p>
              <p className="pt-msg-text">{c.reason}</p>
              {c.proof && c.proof.length > 0 && <Attachments files={c.proof} />}
            </div>
          </div>
        );
      })(),
    });

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
        ? { key: 'next', icon: SearchCheck, at: now, title: 'Initial RCA Report', meta: `Expected ${expected(sla.initialRca.due, now)}`, size: 'big', state: 'next' }
        : { key: 'next', icon: MessageSquareText, at: now, title: 'Reply from NXS', meta: `Expected ${expected(sla.firstResponse.due, now)}`, size: 'big', state: 'next' }
      : stage === 'in_progress'
        ? { key: 'next', icon: Package, at: now, title: 'Fix ready for you to approve', meta: sla.resolution.due >= now ? `Estimated ${expected(sla.resolution.due, now)}` : 'Taking a little longer than estimated', size: 'big', state: 'next', body: <p className="pt-tl-text is-muted">{cadence}</p> }
        : stage === 'ready_to_deploy'
          ? approved
            ? { key: 'next', icon: Rocket, at: now, title: 'NXS is deploying the fix', meta: `You approved it ${fmtDateTime(approved.at)}`, size: 'big', state: 'next' }
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
            ? { key: 'next', icon: FileText, at: now, title: 'Full RCA report', meta: `Sent to you on ${fmtDateTime(rca.due)}`, size: 'big', state: 'next' }
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
