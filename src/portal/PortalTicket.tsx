import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Ban,
  Send,
  Boxes,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  CircleCheck,
  CircleUser,
  CircleX,
  Flag,
  Hammer,
  Inbox,
  RotateCcw,
  Signal,
  ThumbsUp,
  Timer,
  User,
  type LucideIcon,
  Search,
  Wrench,
  FileText,
  History,
} from 'lucide-react';
import type { Activity, Attachment, Ticket, TicketStatus } from '../types';
import { PORTAL_STATUS_LABEL, REQUEST_TYPE_LABEL, STATUS_LABEL, clientVisibleActivity, isOpen, portalStatus } from '../lib/domain';
import { fmtDateTime, fmtDateYear, fmtDuration, fmtRelative } from '../lib/format';
import { useStore } from '../store';
import { Attachments, BackHeader, Prop, RequestNotes } from '../components/detail';
import { RichInput } from '../components/RichInput';
import { STATUS_TONE, SeverityBadge, StatusBadge } from '../components/domain';
import { Button, Card, Empty, cx } from '../components/ui';
import { portalText, usePortalActorName, usePortalUser, whenText } from './shared';


/* ---------- Where the ticket is, in the client's words ---------- */

const PATH: TicketStatus[] = ['new', 'in_progress', 'waiting_approval', 'resolved'];
const STEP_ICON: Partial<Record<TicketStatus, LucideIcon>> = { new: Inbox, in_progress: Hammer, waiting_approval: Flag, resolved: CircleCheck, reopened: RotateCcw };

function reachedAt(t: Ticket, step: TicketStatus): number | undefined {
  if (step === 'new') return t.createdAt;
  const hit = [...t.activity]
    .reverse()
    .find((a) => a.visibility === 'client' && ((step === 'resolved' && a.kind === 'resolution') || a.text.includes(`to ${STATUS_LABEL[step]}`)));
  return hit?.at;
}

function Progress({ ticket }: { ticket: Ticket }) {
  const { now } = useStore();
  // Reopened work sits on the "In progress" step again.
  // Blocked and testing are NXS's own steps: the client sees In progress.
  const status = portalStatus(ticket.status);
  const at = PATH.indexOf(status === 'reopened' ? 'in_progress' : status);
  const done = status === 'resolved';
  return (
    <ol className="pipeline portal-pipeline" aria-label="Ticket progress">
      {PATH.map((step, i) => {
        const state = i < at || (done && i === at) ? 'done' : i === at ? 'current' : 'todo';
        const shown: TicketStatus = state === 'current' ? status : step;
        const Icon = state === 'done' ? CircleCheck : STEP_ICON[shown] ?? Hammer;
        const when = state !== 'todo' ? reachedAt(ticket, shown === 'reopened' ? 'reopened' : step) : undefined;
        return (
          <li key={step} className={cx('pipeline-step', `is-${state}`, state === 'current' && `tone-${STATUS_TONE[shown]}`)} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="pipeline-name">
              <Icon size={15} aria-hidden />
              <span className="truncate">{step === 'waiting_approval' ? 'Your review' : PORTAL_STATUS_LABEL[shown]}</span>
            </span>
            <span className="pipeline-time" title={when ? fmtDateTime(when) : undefined}>
              {state === 'todo' ? 'Not yet' : state === 'current' && !done ? (when && now - when >= 60_000 ? `${fmtDuration(now - when)} so far` : 'Now') : when ? fmtDateTime(when) : 'Done'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- The fix: approve it, or say what's still wrong ---------- */

function ReviewPanel({ ticket, userId }: { ticket: Ticket; userId: string }) {
  const { reviewFix, assetOf, toast, now } = useStore();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const asset = assetOf(ticket.assetId);
  const actorName = usePortalActorName();
  // What NXS sent with the fix: what changed, how to check it, and proof.
  const handoff = ticket.handoffs[ticket.handoffs.length - 1];
  // One account per brand for now, so whoever is signed in can answer.

  const error = note.trim().length < 10 ? 'Tell NXS what’s still wrong (at least 10 characters).' : '';
  const decline = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (error) {
      document.getElementById('decline-note')?.focus();
      return;
    }
    if (reviewFix(ticket.id, userId, 'declined', note, files)) toast(`Sent back to NXS. ${ticket.id} is open again.`);
  };
  const approve = () => {
    if (reviewFix(ticket.id, userId, 'approved', '')) toast(`Thanks. ${ticket.id} is resolved.`);
  };

  return (
    <div className="portal-review-panel">
      <div className="portal-review-panel-head">
        <span className="portal-review-icon" aria-hidden>
          <Flag size={18} />
        </span>
        <div>
          <p className="portal-review-title">NXS has fixed this. Does it work for you?</p>
          <p className="portal-review-text">Check {asset?.name ?? 'the asset'}, then approve the fix or tell us what’s still wrong.</p>
        </div>
      </div>
      {handoff && (
        <div className="portal-handoff">
          <p className="portal-handoff-head">
            Sent {whenText(handoff.at, now)} by {actorName(handoff.by)}
          </p>
          <p className="portal-handoff-note">{handoff.note}</p>
          <Attachments files={handoff.attachments} />
        </div>
      )}
      {declining ? (
        <form className="portal-decline" onSubmit={decline} noValidate>
          <label className="field-label" htmlFor="decline-note">
            What’s still wrong?
          </label>
          <RichInput id="decline-note" rows={3} value={note} onChange={setNote} files={files} onFilesChange={setFiles} invalid={submitted && !!error} placeholder="The blank page still shows when I pay by bank transfer on my phone." autoFocus />
          {submitted && error && <p className="field-error">{error}</p>}
          <div className="portal-review-actions">
            <Button variant="secondary" onClick={() => setDeclining(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Send back to NXS
            </Button>
          </div>
        </form>
      ) : (
        <div className="portal-review-actions">
          <Button variant="secondary" icon={<CircleX size={16} />} onClick={() => setDeclining(true)}>
            Still not fixed
          </Button>
          <Button variant="primary" icon={<ThumbsUp size={16} />} onClick={approve}>
            Approve fix
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------- Updates: only what the client may see ---------- */

const KIND_ICON: Record<Activity['kind'], LucideIcon> = {
  created: Inbox,
  status: RotateCcw,
  assignment: User,
  severity: Signal,
  resolution: CircleCheck,
  cancellation: Ban,
  blocker: Hammer,
  reason: Hammer,
  handoff: Send,
  diagnosis: Search,
  progress: Hammer,
};

/** What NXS found and how it will fix it, as shared when work started. */
function FoundCard({ ticket }: { ticket: Ticket }) {
  const { now } = useStore();
  const actorName = usePortalActorName();
  const d = ticket.diagnosis!;
  return (
    <section className="main-block" aria-labelledby="found-title">
      <div className="found-card">
        <header className="found-head">
          <h2 id="found-title" className="block-title">
            What we found
          </h2>
          <p className="found-meta">
            {actorName(d.by)}, {whenText(d.at, now)}
          </p>
        </header>
        <div className="found-row">
          <span className="found-icon" aria-hidden>
            <Search size={16} />
          </span>
          <div>
            <p className="found-label">What’s wrong</p>
            <p className="found-text">{d.issue}</p>
          </div>
        </div>
        <div className="found-row">
          <span className="found-icon" aria-hidden>
            <Wrench size={16} />
          </span>
          <div>
            <p className="found-label">How we’ll fix it</p>
            <p className="found-text">{d.fix}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The client's own report, and the ticket's history, side by side as tabs. */
function PortalTabs({ ticket, userId }: { ticket: Ticket; userId: string }) {
  const [tab, setTab] = useState<'request' | 'activity'>('request');
  const count = clientVisibleActivity(ticket).length;
  const tabs = [
    { key: 'request' as const, label: 'Your request', icon: FileText },
    { key: 'activity' as const, label: 'Activity', icon: History, count },
  ];
  return (
    <section className="main-block is-joined" aria-label="Ticket content">
      <div className="doc-tabs" role="tablist" aria-label="Ticket content">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} type="button" role="tab" id={`ptab-${t.key}`} aria-selected={tab === t.key} aria-controls="portal-panel" className={cx('doc-tab', tab === t.key && 'is-active')} onClick={() => setTab(t.key)}>
              <Icon size={16} aria-hidden />
              {t.label}
              {t.count != null && <span className="doc-tab-count">{t.count}</span>}
            </button>
          );
        })}
      </div>
      <div id="portal-panel" className="ticket-panel" role="tabpanel" aria-labelledby={`ptab-${tab}`}>
        {tab === 'request' ? (
          <>
            <p className="description">{ticket.description}</p>
            <RequestNotes request={ticket.request} />
            <Attachments files={ticket.attachments} />
          </>
        ) : (
          <ActivityList ticket={ticket} userId={userId} />
        )}
      </div>
    </section>
  );
}

/** Everything that has happened on the ticket that the client may see, newest first. */
function ActivityList({ ticket, userId }: { ticket: Ticket; userId: string }) {
  const { now } = useStore();
  const actorName = usePortalActorName();
  // Internal notes and internal assignment lines never reach the portal.
  const history = useMemo(() => [...clientVisibleActivity(ticket)].reverse(), [ticket]);
  const declines = ticket.feedback.filter((f) => f.decision === 'declined');

  return (
      <ol className="timeline portal-timeline">
        {history.map((a) => {
          const Icon = KIND_ICON[a.kind];
          const sent = a.kind === 'handoff' ? ticket.handoffs.find((h) => Math.abs(h.at - a.at) < 5000) : undefined;
          const found = a.kind === 'diagnosis' ? ticket.diagnosis : undefined;
          // A decline carries the client's reason; show it under the line.
          const reason = a.actor.type === 'client' && a.text.startsWith('Declined') ? declines.find((f) => Math.abs(f.at - a.at) < 60_000) : undefined;
          const who = actorName(a.actor, userId);
          return (
            <li key={a.id} className={cx('timeline-item', `kind-${a.kind}`)}>
              <span className="timeline-icon" aria-hidden>
                <Icon size={14} />
              </span>
              <div className="timeline-body">
                <p className="timeline-text">{sent ? 'Sent the fix for your review' : found ? 'Found the problem and started the fix' : portalText(a)}</p>
                {(reason || sent) && <p className="portal-quote">{sent ? a.text : reason?.note}</p>}
                {reason?.attachments && reason.attachments.length > 0 && <Attachments files={reason.attachments} />}
                {sent && sent.attachments.length > 0 && <Attachments files={sent.attachments} />}
                {found && (
                  <dl className="diagnosis is-compact">
                    <div>
                      <dt>What’s wrong</dt>
                      <dd>{found.issue}</dd>
                    </div>
                    <div>
                      <dt>How we’ll fix it</dt>
                      <dd>{found.fix}</dd>
                    </div>
                  </dl>
                )}
                <p className="timeline-meta">
                  <span>{who}</span>
                  <time title={fmtDateTime(a.at)}>{fmtRelative(a.at, now)}</time>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
  );
}

/* ---------- Page ---------- */

export function PortalTicket() {
  const { id } = useParams();
  const { now, assetOf, reporterOf, memberOf, slaOf } = useStore();
  const { user, tickets } = usePortalUser();
  // Only the client's own company's tickets can be opened here.
  const ticket = tickets.find((t) => t.id === id);

  if (!user) return null;
  if (!ticket) {
    return (
      <div className="page">
        <Empty
          title="We can’t find that ticket"
          action={
            <Link to="/portal" className="btn btn-secondary">
              Back to tickets
            </Link>
          }
        >
          It may belong to another company, or the link is wrong.
        </Empty>
      </div>
    );
  }

  const asset = assetOf(ticket.assetId);
  const reporter = reporterOf(ticket);
  const handler = memberOf(ticket.assigneeId);
  const sla = slaOf(ticket);
  const responded = ticket.firstRespondedAt;

  return (
    <div className="page">
      <BackHeader title="Ticket detail" description={`Raised by ${reporter?.id === user.id ? 'you' : (reporter?.name ?? 'your team')} ${whenText(ticket.createdAt, now)}`} fallback="/portal" backLabel="Back to tickets" />

      <Card className="ticket-card">
        <header className="ticket-card-head portal-ticket-head">
          <div className="portal-ticket-head-row">
            <span className="ticket-id ticket-id-lg">{ticket.id}</span>
            <StatusBadge status={ticket.status} />
          </div>
          <h2 className="ticket-card-title">{ticket.title}</h2>
        </header>

        <div className="ticket-body">
          <div className="ticket-main">
            {/* Where it stands first, then what the client can do about it. */}
            <section className="main-block" aria-label="Progress">
              {ticket.status === 'canceled' ? (
                <p className="portal-state-note tone-neutral">
                  <Ban size={16} aria-hidden /> NXS canceled this ticket{ticket.cancellation ? `: ${ticket.cancellation.reason}` : '.'}
                </p>
              ) : (
                <Progress ticket={ticket} />
              )}
              {ticket.status === 'reopened' && (
                <p className="portal-state-note tone-red portal-state-after">
                  <RotateCcw size={16} aria-hidden /> The fix didn’t hold, so NXS is working on it again.
                </p>
              )}
              {ticket.status === 'waiting_approval' && <ReviewPanel ticket={ticket} userId={user.id} />}
            </section>

            {ticket.diagnosis && <FoundCard ticket={ticket} />}

            <PortalTabs ticket={ticket} userId={user.id} />
          </div>

          <aside className="ticket-aside" aria-label="Ticket details">
            <dl className="props">
              <Prop icon={Boxes} label="Asset">
                {asset?.name ?? '—'}
              </Prop>
              {ticket.request && (
                <Prop icon={ClipboardList} label="Type of request">
                  {REQUEST_TYPE_LABEL[ticket.request.type]}
                </Prop>
              )}
              <Prop icon={CircleUser} label="Requested by" title={reporter?.title}>
                {ticket.request?.requestedBy || (reporter?.id === user.id ? `${reporter.name} (you)` : (reporter?.name ?? '—'))}
              </Prop>
              {ticket.request?.neededBy && (
                <Prop icon={CalendarClock} label="Needed by">
                  {fmtDateYear(ticket.request.neededBy)}
                </Prop>
              )}
              <Prop icon={User} label="Handled by">
                {handler ? `${handler.name}, NXS` : <span className="muted">Not picked up yet</span>}
              </Prop>
              <Prop icon={Signal} label="Priority">
                <SeverityBadge severity={ticket.severity} />
              </Prop>
              <Prop icon={Timer} label="First response">
                {responded ? (
                  `Within ${fmtDuration(responded - ticket.createdAt)}`
                ) : sla.firstResponse.remainingMs >= 0 ? (
                  `Expected within ${fmtDuration(sla.firstResponse.remainingMs)}`
                ) : (
                  // Late is said plainly: the client should know NXS is behind.
                  <span className="portal-late">Late by {fmtDuration(-sla.firstResponse.remainingMs)}</span>
                )}
              </Prop>
              {/* The SLA's resolution target, as a plain expectation rather than a deadline. */}
              {isOpen(ticket) && (
                <Prop icon={CalendarClock} label="Expected fix" title={fmtDateTime(sla.resolution.due)}>
                  {sla.resolution.remainingMs >= 0 ? `In about ${fmtDuration(sla.resolution.remainingMs)}` : <span className="portal-late">Running late</span>}
                  <span className="prop-meta">by {fmtDateTime(sla.resolution.due)}</span>
                </Prop>
              )}
              <Prop icon={CalendarDays} label="Raised" title={fmtRelative(ticket.createdAt, now)}>
                {fmtDateTime(ticket.createdAt)}
                <span className="prop-meta">{ticket.source.channel === 'portal' ? 'in the portal' : 'logged by NXS for you'}</span>
              </Prop>
            </dl>
          </aside>
        </div>
      </Card>
    </div>
  );
}
