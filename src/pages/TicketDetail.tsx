import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Briefcase, Sparkles, ShieldOff, ArrowLeft, ArrowUp, Ban, CornerUpLeft, OctagonAlert, Timer, Check, ChevronDown, CircleCheck, CircleX, Lock, Plus, Send, ShieldCheck, UserPlus, Stethoscope, FileSearch, MessageSquare, RotateCcw, PenLine, History, X, User, FlaskConical, CircleUser, Signal, Tag, Building2, Boxes, Milestone, Layers, Hash, CalendarCheck, CalendarClock, CalendarDays, Activity as ActivityIcon } from 'lucide-react';
import type { Activity, Actor, Attachment, CodeFix, CommentOn, Category, Severity, TaskType, TeamMember, Ticket, TicketStatus } from '../types';
import { CATEGORIES, CATEGORY_LABEL, SEVERITIES, SEVERITY_LABEL, NEXT_STAGE, STATUS_LABEL, TASK_TYPES, TASK_TYPE_LABEL, TRANSITIONS, isOpen, isRework, moveBlockedBy, moveLabel, sprintChoices } from '../lib/domain';
import { fmtDate, fmtDateTime, fmtDateYear, fmtDuration, fmtRelative, fmtTime } from '../lib/format';
import { SLA_STATE_LABEL, type SlaClock } from '../lib/sla';
import { useStore } from '../store';
import { CategoryLabel, ClientLogo, SEVERITY_TONE, SLA_TONE, STATUS_ICON, STATUS_TONE, SeverityBadge, clockWord } from '../components/domain';
import { Avatar, Badge, Button, Card, Empty, Field, TextArea, cx, usePopover, type Tone } from '../components/ui';
import { countLines, reviseCodeFix } from '../lib/codeFix';
import { fullRcaPlan, imageTagOf, releaseNotesOf } from '../lib/release';
import { analyze, answer, editInitialRca, STARTERS, type Analysis, type RcaDraftText, type RcaPart } from '../lib/rcaAi';
import { stepStaffLine } from '../lib/assist';
import { BadgeSelect, Dropdown, type BadgeOption } from '../components/pickers';
import { AssignMenu } from '../components/AssignMenu';
import { Attachments, Prop, RequestNotes } from '../components/detail';
import { RichInput } from '../components/RichInput';
import { TICKETS_VIEW_KEY } from '../components/Layout';
import { CommentBox, withMentions } from '../components/comments';


/* ---------- Status: where the ticket is, and the move to make ---------- */

const STATUS_BY_LABEL = Object.fromEntries(Object.entries(STATUS_LABEL).map(([k, v]) => [v, k])) as Record<string, TicketStatus>;

/** When the ticket last entered each stage, read from its activity. */
function stageEntries(t: Ticket) {
  const out: Partial<Record<TicketStatus, Activity>> = {};
  for (const a of t.activity) {
    let to: TicketStatus | undefined;
    if (a.kind === 'created') to = 'new';
    else if (a.kind === 'resolution') to = 'resolved';
    else if (a.kind === 'cancellation') to = 'canceled';
    // The stage moved to is the label the line ends with ("Ready to deploy" has a " to " of its own).
    else if (a.kind === 'status') to = STATUS_BY_LABEL[Object.keys(STATUS_BY_LABEL).find((label) => a.text.replace(/\.$/, '').endsWith(` to ${label}`)) ?? ''];
    if (to) out[to] = a;
  }
  return out;
}

/**
 * The two controls in the ticket's header: the status, which opens every move
 * this stage allows (each asks why where it should), and the one button for
 * the usual next step.
 */
function StatusActions({ ticket }: { ticket: Ticket }) {
  const { changeStatus, setDialog, can } = useStore();
  const menu = usePopover();
  const status = ticket.status;
  const next = NEXT_STAGE[status];
  const editable = can('ticket.update');
  // Only the moves that make sense from here, and only once what they need is in place.
  const moves = TRANSITIONS[status]
    .filter((s) => (s !== 'canceled' || can('ticket.cancel')) && !moveBlockedBy(ticket, s))
    .sort((a, b) => Number(b === next) - Number(a === next));
  const move = (to: TicketStatus) => {
    menu.setOpen(false);
    if (to === 'resolved') setDialog({ type: 'resolve', ticketId: ticket.id });
    else changeStatus(ticket.id, to);
  };

  return (
    <div className="tdl-actions">
      <div className="tdl-actions-row">
        {editable && moves.length > 0 && (
          <div className="popover-anchor" ref={menu.ref}>
            <Button variant="secondary" aria-haspopup="menu" aria-expanded={menu.open} onClick={() => menu.setOpen(!menu.open)}>
              Move to
              <ChevronDown size={15} aria-hidden />
            </Button>
            {menu.open && (
              <div className="popover move-menu" role="menu" aria-label="Move to">
                {moves.map((to) => {
                  const ToIcon = isRework(status, to) ? CornerUpLeft : STATUS_ICON[to];
                  const label = moveLabel(status, to);
                  return (
                    <Fragment key={to}>
                      {to === 'canceled' && moves.length > 1 && <div className="menu-sep" role="separator" />}
                      <button type="button" role="menuitem" className={cx('move-item', `tone-${STATUS_TONE[to]}`)} onClick={() => move(to)}>
                        <ToIcon size={16} aria-hidden className="move-item-icon" />
                        <span className="move-item-text">
                          <span className="move-item-name">
                            {STATUS_LABEL[to]}
                            {to === next && <span className="move-item-tag">Next step</span>}
                          </span>
                          <span className="move-item-hint">{label.hint}</span>
                        </span>
                      </button>
                    </Fragment>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The step's bar, at the end of the step: what happens next, and the one button that does it. Not floating. */
function StepBar({ next, children }: { next?: ReactNode; children: ReactNode }) {
  return (
    <div className="fs-bar">
      <p className="fs-bar-next">{next}</p>
      <div className="fs-bar-actions">{children}</div>
    </div>
  );
}

/** The stages in order, as one thin line: done, now, still to come. Blocked sits on In progress. */
const PATH: TicketStatus[] = ['new', 'not_started', 'in_progress', 'waiting_testing', 'on_testing', 'qa_passed', 'ready_to_deploy', 'resolved'];
const PATH_INDEX: Record<TicketStatus, number> = { new: 0, not_started: 1, in_progress: 2, blocked: 2, waiting_testing: 3, on_testing: 4, qa_passed: 5, ready_to_deploy: 6, resolved: 7, canceled: -1 };

function StageSteps({ ticket }: { ticket: Ticket }) {
  const { actorName, now } = useStore();
  const entries = useMemo(() => stageEntries(ticket), [ticket]);
  const status = ticket.status;
  // On a phone the bar scrolls sideways: bring the current stage into view.
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = ref.current;
    const current = list?.querySelector<HTMLElement>('.is-current');
    if (list && current && list.scrollWidth > list.clientWidth) list.scrollLeft = current.offsetLeft - list.offsetLeft - 24;
  }, [status]);
  if (status === 'canceled') return null;
  const at = PATH_INDEX[status];
  const done = status === 'resolved';
  const since = entries[status];
  return (
    <ol className="tdl-stages" aria-label="Ticket stages" ref={ref}>
      {PATH.map((step, i) => {
        const state = i < at || (done && i === at) ? 'done' : i === at ? 'current' : 'todo';
        const shown: TicketStatus = state === 'current' && !done ? status : step;
        const StepIcon = state === 'done' ? CircleCheck : STATUS_ICON[shown];
        // A stage ahead can have been visited before, like testing before a failed test.
        const entry = state === 'current' ? since : entries[step];
        const when =
          state === 'current' && !done ? (since ? `For ${fmtDuration(now - since.at)}` : 'Now') : state === 'todo' ? (entry ? `Earlier, ${fmtDateTime(entry.at)}` : 'Not yet') : entry ? fmtDateTime(entry.at) : 'Skipped';
        return (
          <li
            key={step}
            className={cx('tdl-stage', `is-${state}`, state === 'current' && `tone-${STATUS_TONE[shown]}`)}
            aria-current={state === 'current' ? 'step' : undefined}
            title={entry ? `${STATUS_LABEL[shown]}: ${actorName(entry.actor)}, ${fmtDateTime(entry.at)}` : STATUS_LABEL[shown]}
          >
            <span className="tdl-stage-name">
              <StepIcon size={15} aria-hidden />
              <span>{STATUS_LABEL[shown]}</span>
            </span>
            <span className="tdl-stage-time">{when}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** A banner only when something explains the stage: why it is blocked, why it came back, what went to the client. */
function StageBanner({ ticket }: { ticket: Ticket }) {
  const { reporterOf, actorName, now } = useStore();
  const entries = useMemo(() => stageEntries(ticket), [ticket]);
  const status = ticket.status;
  const since = entries[status];
  const reporter = reporterOf(ticket);
  const declined = [...ticket.feedback].reverse().find((f) => f.decision === 'declined');
  const declinedNow = status === 'in_progress' && ticket.feedback[ticket.feedback.length - 1]?.decision === 'declined';
  const blocker = status === 'blocked' ? ticket.blockers[ticket.blockers.length - 1] : undefined;
  const lastNote = ticket.moveNotes[ticket.moveNotes.length - 1];
  const moveNote = lastNote && lastNote.to === status && since && lastNote.at >= since.at - 1000 && (!declined || lastNote.at > declined.at) ? lastNote : undefined;
  const resolution = status === 'resolved' ? [...ticket.activity].reverse().find((a) => a.kind === 'resolution' && a.text.includes('without client approval')) : undefined;
  const note: { title: string; text: string; by: string; at: number; files?: Attachment[]; icon: typeof Check } | undefined = blocker
    ? { title: 'Blocked', text: blocker.details, by: actorName(blocker.by), at: blocker.at, icon: OctagonAlert }
    : declinedNow && declined
      ? { title: 'The client declined the fix', text: declined.note || 'No reason given.', by: reporter?.name ?? 'The client', at: declined.at, files: declined.attachments, icon: CircleX }
      : moveNote
        ? { title: moveLabel(moveNote.from, moveNote.to).title, text: moveNote.reason, by: actorName(moveNote.by), at: moveNote.at, icon: CornerUpLeft }
        : resolution
            ? { title: 'Resolved without client approval', text: resolution.text.split('Reason: ')[1] ?? '', by: actorName(resolution.actor), at: resolution.at, icon: CircleCheck }
            : status === 'canceled' && ticket.cancellation
              ? { title: 'Canceled', text: ticket.cancellation.reason, by: actorName(ticket.cancellation.by), at: ticket.cancellation.at, icon: Ban }
              : undefined;
  if (!note) return null;
  const NoteIcon = note.icon;
  return (
    <div className={cx('tdl-banner', `tone-${STATUS_TONE[status]}`)}>
      <NoteIcon size={17} aria-hidden className="tdl-banner-icon" />
      <div className="tdl-banner-body">
        <p>
          <strong>{note.title}.</strong> {note.text}
        </p>
        {note.files && note.files.length > 0 && <Attachments files={note.files} />}
        <p className="tdl-banner-meta">
          {note.by}, <time title={fmtDateTime(note.at)}>{fmtRelative(note.at, now).toLowerCase()}</time>
        </p>
      </div>
    </div>
  );
}

/* ---------- The client's brief and the ticket's activity ---------- */

/* Activity is a log of updates: stage moves, progress, what was found, what
   blocked it, what was deployed. Comments have their own tab. */
const KIND_ICON: Record<Activity['kind'], typeof Check> = {
  created: Plus,
  status: Check,
  assignment: UserPlus,
  severity: ShieldCheck,
  resolution: CircleCheck,
  cancellation: CircleX,
  blocker: OctagonAlert,
  reason: CornerUpLeft,
  handoff: Send,
  diagnosis: Stethoscope,
  progress: ActivityIcon,
  exclusion: ShieldOff,
  rca: FileSearch,
  response: Send,
  comment: MessageSquare,
};

/** The headline of one activity line, as staff read it. */
function activityLine(a: Activity) {
  if (a.kind === 'handoff') return 'Sent the resolution notes to the client to deploy';
  if (a.kind === 'diagnosis') return 'Sent the initial RCA to the client';
  if (a.kind === 'response') return 'Sent the initial response to the client';
  // Updates written to the client ("before it reaches you") read as what happened, for the team.
  return a.staffText ?? stepStaffLine(a.text) ?? a.text;
}

/**
 * The left column: a banner when something needs explaining, the client's
 * brief, then three tabs: the RCA (what the AI found, what QA confirmed and
 * sent, and the resolution notes with the fix), the comments, and the activity log.
 */
function TicketContent({ ticket, onAsk }: { ticket: Ticket; onAsk: () => void }) {
  const { assetOf, tickets, actorName, can, now } = useStore();
  const assetName = assetOf(ticket.assetId)?.name ?? 'the asset';
  // Made once from the client's brief, the asset and earlier tickets, as if on arrival.
  const analysis = useMemo(() => analyze(ticket, assetName, tickets), [ticket.id, assetName, tickets.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  // New, Not started, and In progress until the initial RCA goes out: the step is the page.
  // Every stage is its step on the page; only Blocked and Canceled keep the plain view.
  const focus = can('ticket.update') && ticket.status !== 'canceled';
  const history = useMemo(() => [...ticket.activity].reverse(), [ticket.activity]);
  const tabs = [
    { key: 'comments' as const, label: 'Comments', icon: MessageSquare, count: ticket.comments.length },
    { key: 'activity' as const, label: 'Activity', icon: History, count: history.length },
  ];
  return (
    <>
      {focus ? (
        // A fresh step each time the work moves on, so answers from an earlier round don't carry over.
        <FocusStep key={`${ticket.status}-${!!ticket.diagnosis}-${ticket.testResult?.at ?? 0}-${ticket.moveNotes.length}`} ticket={ticket} analysis={analysis} onAsk={onAsk} />
      ) : (
        <>
          <NextStep ticket={ticket} analysis={analysis} onAsk={onAsk} />
          <section className="main-block tdl-brief" aria-label="Client brief">
            <StageBanner ticket={ticket} />
            <p className="description">{ticket.description}</p>
            <RequestNotes request={ticket.request} />
            <Attachments files={ticket.attachments} />
          </section>
        </>
      )}
      <section className="main-block" aria-label="Comments and activity">
        <div className="doc-tabs" role="tablist" aria-label="Comments and activity">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={cx('doc-tab', tab === t.key && 'is-active')} onClick={() => setTab(t.key)}>
              <t.icon size={16} aria-hidden />
              {t.label}
              {t.count != null && <span className="doc-tab-count">{t.count}</span>}
            </button>
          ))}
        </div>
        <div className="ticket-panel" role="tabpanel">
          {tab === 'comments' && <CommentsPanel ticket={ticket} />}
          {tab === 'activity' && (
            <ol className="timeline">
              {history.map((a) => {
                const KindIcon = KIND_ICON[a.kind];
                return (
                  <li key={a.id} className={cx('timeline-item', `kind-${a.kind}`)}>
                    <span className="timeline-icon" aria-hidden>
                      <KindIcon size={14} />
                    </span>
                    <div className="timeline-body">
                      <p className="timeline-text">
                        {activityLine(a)}
                        {a.visibility === 'internal' && (
                          <span className="internal-tag">
                            <Lock size={12} aria-hidden /> Internal
                          </span>
                        )}
                      </p>
                      <p className="timeline-meta">
                        <span>{actorName(a.actor)}</span>
                        <time title={fmtDateTime(a.at)}>{fmtRelative(a.at, now)}</time>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>
    </>
  );
}

/** Ask AI: a panel that slides in from the right, over the page, so the ticket keeps its shape. */
function AskAiDrawer({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const { assetOf, tickets } = useStore();
  const assetName = assetOf(ticket.assetId)?.name ?? 'the asset';
  const analysis = useMemo(() => analyze(ticket, assetName, tickets), [ticket.id, assetName, tickets.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = ticket.diagnosis ?? ticket.rcaDraft ?? analysis;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="drawer-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="ask-ai-title">
        <header className="drawer-head">
          <div>
            <h2 id="ask-ai-title" className="drawer-title">
              Ask AI
            </h2>
            <p className="drawer-sub">About {ticket.id}. Only NXS sees this chat.</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </header>
        <AskAi ticket={ticket} analysis={{ ...analysis, issue: current.issue, fix: current.fix }} assetName={assetName} />
      </aside>
    </div>,
    document.body,
  );
}

/* ---------- RCA ----------
   The AI drafts it the moment the ticket comes in: the issue, its cause and
   the fix. QA checks it and confirms; it goes to the client with the time to
   fix. When testing passes, the resolution and its proof close it. */

const HOUR_MS = 60 * 60_000;

/** Where a deliverable stands against its SLA deadline: sent when, or due when and how long is left. */
function DueLine({ clock, sentAt, sentLabel = 'Sent to the client' }: { clock: SlaClock | null; sentAt?: number; sentLabel?: string }) {
  const { now } = useStore();
  if (sentAt) {
    const late = clock && sentAt > clock.due;
    return (
      <span className={cx('rca-due', late ? 'tone-red' : 'is-done')}>
        {sentLabel} {fmtDateTime(sentAt)}
        {clock && (late ? `, ${fmtDuration(sentAt - clock.due)} late` : ', on time')}
      </span>
    );
  }
  if (!clock) return null;
  return (
    <span className={cx('rca-due', `tone-${SLA_TONE[clock.state]}`)}>
      Due {fmtDateTime(clock.due)} · {clock.due >= now ? `${fmtDuration(clock.due - now)} left` : `${fmtDuration(now - clock.due)} overdue`}
    </span>
  );
}

/** One thing that went to the client, in the side column: a few lines until opened. */
function SentItem({ title, meta, children }: { title: string; meta: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={cx('sent-item', open && 'is-open')}>
      <p className="sent-item-title">{title}</p>
      <p className="sent-item-meta">{meta}</p>
      <div className="sent-item-body">{children}</div>
      <button type="button" className="link-btn sent-item-more" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Show less' : 'Read all'}
      </button>
    </li>
  );
}

/** What has gone to the client, in order: the AI's reply, the initial RCA, and the fix's notes. */
function SentToClient({ ticket }: { ticket: Ticket }) {
  const { slaOf, actorName, reporterOf } = useStore();
  const sla = slaOf(ticket);
  const reporter = reporterOf(ticket);
  const by = (a: Actor) => (a.type === 'system' ? 'AI' : actorName(a));
  const when = (at: number, due?: number) => `${fmtDateTime(at)}${due != null ? (at <= due ? ', on time' : ', late') : ''}`;
  const reply = ticket.initialResponse;
  const rca = ticket.diagnosis;
  const fix = ticket.handoffs[ticket.handoffs.length - 1];
  return (
    <section className="aside-sent" aria-labelledby="sent-title">
      <h3 id="sent-title" className="aside-sent-title">
        Sent to {reporter?.name.split(' ')[0] ?? 'the client'}
      </h3>
      {!reply && !rca && !fix ? (
        <p className="aside-sent-empty">Nothing yet.</p>
      ) : (
        <ol className="aside-sent-list">
          {reply && (
            <SentItem title="Initial response" meta={`By ${by(reply.by)} · ${when(reply.at, sla.firstResponse?.due)}`}>
              <p>{reply.text}</p>
            </SentItem>
          )}
          {rca && (
            <SentItem title="Initial RCA" meta={`By ${by(rca.by)} · ${when(rca.at, sla.initialRca?.due)}`}>
              <dl className="sent-rca">
                <dt>Issue</dt>
                <dd>{rca.problem}</dd>
                <dt>Cause</dt>
                <dd>{rca.issue}</dd>
                <dt>How it will be fixed</dt>
                <dd>{rca.fix}</dd>
                <dt>Time to fix</dt>
                <dd>By {fmtDateTime(rca.fixBy ?? sla.resolution.due)}</dd>
              </dl>
            </SentItem>
          )}
          {fix && (
            <SentItem title="Release" meta={`By ${by(fix.by)} · ${when(fix.at, sla.resolution.due)}${ticket.resolvedAt ? ` · deployed ${fmtDateTime(ticket.resolvedAt)}` : ''}`}>
              {fix.note && <p>{fix.note}</p>}
              <Attachments files={fix.attachments} />
            </SentItem>
          )}
        </ol>
      )}
    </section>
  );
}

/* ---------- Next step ----------
   One thing to do at a time, at the top of the ticket. The AI works first and
   shows it (reading the report, drafting); then the step, its deadline and one
   button. When it is done the page says so and moves to the next step. */

/** AI work shown once per ticket and step in this session, so coming back doesn't replay it. */
const shownWork = new Set<string>();
function useAiWork(key: string, ms: number, active: boolean) {
  // Re-read on every render: the step can change under the same component.
  const [, setTick] = useState(0);
  const [line, setLine] = useState({ key, n: 0 });
  const done = !active || shownWork.has(key);
  useEffect(() => {
    if (done) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const total = reduce ? 300 : ms;
    const a = window.setTimeout(() => setLine({ key, n: 1 }), total / 3);
    const b = window.setTimeout(() => setLine({ key, n: 2 }), (total * 2) / 3);
    const c = window.setTimeout(() => {
      shownWork.add(key);
      setTick((t) => t + 1);
    }, total);
    return () => [a, b, c].forEach(window.clearTimeout);
  }, [done, key, ms]);
  return { done, line: line.key === key ? line.n : 0 };
}

function AiWorking({ lines, line }: { lines: string[]; line: number }) {
  return (
    <div className="ns-working" role="status" aria-live="polite">
      <span className="ai-ring ns-working-icon" aria-hidden />
      <ol>
        {lines.map((l, i) => (
          <li key={l} className={cx(i < line && 'is-done', i === line && 'is-now')}>
            {i < line ? <Check size={14} aria-hidden /> : <span className="ns-dot" aria-hidden />}
            {l}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------- The first three steps, as the page itself ----------
   New (the PM), Not started (QA) and In progress until the initial RCA goes out
   (the developer) each make the page about one job: the client's report, the
   AI's work for that job, and one bar that says what happens next. */

const EFFECT_NOTE: Record<Severity, string> = {
  critical: 'It stops a core flow, with no way around it.',
  medium: 'Part of a flow fails, but people can still get through.',
  low: 'A minor problem with little effect day to day.',
};
const CATEGORY_NOTE: Record<Category, string> = {
  tech: 'Something broke; it isn’t a request.',
  business: 'It’s about money, points or numbers.',
  operational: 'Content or setup the client asked for.',
};

/** The client's report: their words, any request notes, and their files. Compact once the work has moved past it. */
function ReportBlock({ ticket, compact }: { ticket: Ticket; compact?: boolean }) {
  const { reporterOf } = useStore();
  const reporter = reporterOf(ticket);
  // Open while it's the step's material; folded once the work has moved past it.
  const [open, setOpen] = useState(!compact);
  const files = ticket.attachments.length;
  return (
    <section className={cx('fs-report', !open && 'is-folded')} aria-label="The client's report">
      <div className="fs-report-meta">
        <Avatar name={reporter?.name ?? 'Client'} size={22} />
        <span>
          <strong>{reporter?.name ?? 'The client'}</strong> {ticket.source.channel === 'portal' ? 'reported it from the Client Portal' : 'reported it, logged by NXS'} · {fmtDateTime(ticket.createdAt)}
          {!open && files > 0 && ` · ${files} ${files === 1 ? 'file' : 'files'}`}
        </span>
        <button type="button" className="fs-report-toggle" aria-expanded={open} aria-label={open ? 'Hide the report' : 'Show the report'} onClick={() => setOpen(!open)}>
          <ChevronDown size={16} aria-hidden />
        </button>
      </div>
      {open && (
        <div className="fs-report-body">
          <p className="fs-report-text">{ticket.description}</p>
          <RequestNotes request={ticket.request} />
          <Attachments files={ticket.attachments} />
        </div>
      )}
    </section>
  );
}

/** Whose step it is and what it is, so the page explains itself before any scrolling. */
function StepHead({ person, title }: { person?: Pick<TeamMember, 'id' | 'name' | 'photo'> | null; title: string }) {
  const { currentUser } = useStore();
  const mine = !!person && person.id === currentUser.id;
  return (
    <header className="fs-head">
      {person && (
        <p className="fs-who">
          <Avatar name={person.name} size={18} src={person.photo} />
          {mine ? 'Now with you' : `Now with ${person.name.split(' ')[0]}`}
        </p>
      )}
      <h2 className="fs-title">{title}</h2>
    </header>
  );
}

/** A card for the AI's work in this step, marked as the AI's. */
function AiCard({ id, title, note, working, children }: { id: string; title: string; note: ReactNode; working?: boolean; children: ReactNode }) {
  return (
    <section className="fs-card" aria-labelledby={id}>
      <header className="fs-card-head">
        <h3 id={id}>{title}</h3>
        {/* The AI's mark: a colour-shifting edge, turning while it works. */}
        <span className={cx('ai-chip', working && 'is-working')}>Suggested by AI</span>
        <span className="fs-card-note">{note}</span>
      </header>
      {children}
    </section>
  );
}

/** The asset's staging address: the same site on its staging host. */
function stagingUrl(url?: string) {
  if (!url) return 'https://staging.example';
  const u = url.replace(/^(https?:\/\/)(www\.)?/, '$1');
  return u.replace(/^(https?:\/\/)/, '$1staging.');
}

const FIX_ASKS = ['Add a test', 'Add logging', 'Keep it smaller'];

/** The AI's code fix: what it does, the files it changes as small diffs, and a composer to ask for changes. */
function FixByAi({ ticket, onBusy }: { ticket: Ticket; onBusy: (busy: boolean) => void }) {
  const { codeFixOf, saveCodeFix } = useStore();
  const fix = codeFixOf(ticket);
  const [open, setOpen] = useState<string[]>(() => [fix.files[0]?.path].filter(Boolean) as string[]);
  const [ask, setAsk] = useState('');
  const [thread, setThread] = useState<{ id: number; q: string; reply: string | null; before: CodeFix | null }[]>([]);
  const [fresh, setFresh] = useState<string[]>([]);
  const threadRef = useRef<HTMLOListElement>(null);
  const busy = thread.some((x) => x.reply == null);
  const count = countLines(fix);
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [thread]);
  const run = (q: string) => {
    const said = q.trim();
    if (!said || busy) return;
    setAsk('');
    setFresh([]);
    const before = fix;
    const r = reviseCodeFix(before, said);
    const id = Date.now();
    setThread((t) => [...t, { id, q: said, reply: null, before: null }]);
    onBusy(true);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => {
      if (r.changed.length || r.fix !== before) saveCodeFix(ticket.id, r.fix);
      setThread((t) => t.map((x) => (x.id === id ? { ...x, reply: r.reply, before: r.fix !== before ? before : null } : x)));
      setFresh(r.changed);
      setOpen((o) => [...new Set([...o, ...r.changed])]);
      onBusy(false);
    }, reduce ? 200 : 1800);
  };
  const undo = (id: number, before: CodeFix) => {
    saveCodeFix(ticket.id, before);
    setThread((t) => t.map((x) => (x.id === id ? { ...x, reply: 'Undone. The fix is back as it was.', before: null } : x)));
    setFresh([]);
  };
  const latest = thread[thread.length - 1];
  return (
    <>
      <dl className="rca-fields rca-form fix-meta">
        <div>
          <dt>
            What it does<small>From the initial RCA</small>
          </dt>
          <dd>{fix.summary}</dd>
        </div>
        <div>
          <dt>
            Where<small>Repository and branch</small>
          </dt>
          <dd className="fix-where">
            <code>{fix.repo}</code>
            <span className="muted">on</span>
            <code>{fix.branch}</code>
          </dd>
        </div>
      </dl>
      <div className={cx('fix-files', busy && 'is-rewriting')}>
        <p className="fix-files-head">
          {fix.files.length} {fix.files.length === 1 ? 'file' : 'files'} changed
          <span className="fix-plus">+{count.add}</span>
          <span className="fix-minus">−{count.del}</span>
        </p>
        <ul className="fix-file-list">
          {fix.files.map((f) => {
            const shown = open.includes(f.path);
            const plus = f.lines.filter((l) => l.t === '+').length;
            const minus = f.lines.filter((l) => l.t === '-').length;
            return (
              <li key={f.path} className={cx('fix-file', fresh.includes(f.path) && 'is-changed')}>
                <button type="button" className="fix-file-head" aria-expanded={shown} onClick={() => setOpen((o) => (shown ? o.filter((x) => x !== f.path) : [...o, f.path]))}>
                  <ChevronDown size={15} aria-hidden className="fix-file-caret" />
                  <code className="fix-file-path">{f.path}</code>
                  <span className="fix-file-count">
                    <span className="fix-plus">+{plus}</span>
                    {minus > 0 && <span className="fix-minus">−{minus}</span>}
                  </span>
                </button>
                {shown && (
                  <>
                    <p className="fix-file-note">{f.note}</p>
                    <pre className="fix-diff" aria-label={`Changes to ${f.path}`}>
                      {f.lines.map((l, i) => (
                        <span key={i} className={cx('fix-line', l.t === '+' && 'is-add', l.t === '-' && 'is-del')}>
                          <span className="fix-sign" aria-hidden>
                            {l.t === ' ' ? '' : l.t === '-' ? '−' : '+'}
                          </span>
                          {l.text}
                        </span>
                      ))}
                    </pre>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="rca-chat">
        {thread.length > 0 && (
          <ol ref={threadRef} className="rca-thread" aria-label="What you asked the AI">
            {thread.map((x) => (
              <li key={x.id}>
                <p className="rca-me">{x.q}</p>
                <p className="rca-said" role={x === latest ? 'status' : undefined}>
                  <span className={cx('ai-ring', x.reply != null && 'is-still')} aria-hidden />
                  <span>
                    {x.reply ?? 'Changing the code…'}
                    {x === latest && x.before && (
                      <button type="button" className="link-btn rca-undo" onClick={() => undo(x.id, x.before!)}>
                        Undo
                      </button>
                    )}
                  </span>
                </p>
              </li>
            ))}
          </ol>
        )}
        <form
          className="rca-composer"
          onSubmit={(e) => {
            e.preventDefault();
            run(ask);
          }}
        >
          <label htmlFor="fix-ask-input" className="sr-only">
            Tell the AI what to change in the fix
          </label>
          <textarea
            id="fix-ask-input"
            className="rca-composer-input"
            rows={2}
            placeholder={thread.length ? 'Anything else to change?' : 'Tell the AI what to change in this fix…'}
            value={ask}
            disabled={busy}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                run(ask);
              }
            }}
          />
          <div className="rca-composer-foot">
            <div className="rca-composer-asks">
              {FIX_ASKS.map((x) => (
                <button key={x} type="button" className="rca-ask-chip" disabled={busy} onClick={() => run(x)}>
                  {x}
                </button>
              ))}
            </div>
            <button type="submit" className="rca-composer-send" aria-label="Send to the AI" disabled={!ask.trim() || busy}>
              <ArrowUp size={16} aria-hidden />
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

const RCA_ASKS = ['Less technical', 'Shorter', 'More detail on the fix'];
const PART_WORD: Record<RcaPart, string> = { problem: 'issue', issue: 'cause', fix: 'fix' };

type RcaExchange = { id: number; q: string; reply: string | null; parts: RcaPart[]; before: RcaDraftText | null };

/** The initial RCA, changed by talking to the AI under it: a short thread of what was asked and what changed, then the composer. */
function RcaByAi({ ticket, analysis, onBusy }: { ticket: Ticket; analysis: Analysis; onBusy: (busy: boolean) => void }) {
  const { saveRcaDraft } = useStore();
  const [ask, setAsk] = useState('');
  const [thread, setThread] = useState<RcaExchange[]>([]);
  const [fresh, setFresh] = useState<RcaPart[]>([]);
  const threadRef = useRef<HTMLOListElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const busy = thread.some((x) => x.reply == null);
  // The thread keeps every exchange but stays a fixed height: it scrolls, and follows the newest.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [thread]);
  const working = thread.find((x) => x.reply == null);
  const base = ticket.rcaDraft ?? analysis;
  const current: RcaDraftText = { problem: base.problem ?? analysis.problem, issue: base.issue, fix: base.fix };
  const run = (q: string) => {
    const said = q.trim();
    if (!said || busy) return;
    setAsk('');
    setFresh([]);
    const before = current;
    const r = editInitialRca(before, said);
    const id = Date.now();
    setThread((t) => [...t, { id, q: said, reply: null, parts: r.changed, before: null }]);
    onBusy(true);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => {
      if (r.changed.length) saveRcaDraft(ticket.id, r.draft);
      setThread((t) => t.map((x) => (x.id === id ? { ...x, reply: r.reply, before: r.changed.length ? before : null } : x)));
      setFresh(r.changed);
      onBusy(false);
    }, reduce ? 200 : 1600);
  };
  const undo = (x: RcaExchange) => {
    if (x.before) saveRcaDraft(ticket.id, x.before);
    setThread((t) => t.map((y) => (y.id === x.id ? { ...y, reply: `Undone. The ${x.parts.map((p) => PART_WORD[p]).join(' and ')} is back as it was.`, before: null } : y)));
    setFresh(x.parts);
  };
  const latest = thread[thread.length - 1];
  return (
    <>
      {/* Mounted afresh after each exchange, so a part changed twice glows twice. */}
      <InitialRca key={`${thread.length}-${busy}`} ticket={ticket} analysis={analysis} embedded rewriting={working?.parts} changed={busy ? undefined : fresh} />
      <div className="rca-chat">
        {thread.length > 0 && (
          <ol ref={threadRef} className={cx('rca-thread', overflowing && 'is-overflowing')} aria-label="What you asked the AI">
            {thread.map((x) => (
              <li key={x.id}>
                <p className="rca-me">{x.q}</p>
                <p className="rca-said" role={x === latest ? 'status' : undefined}>
                  <span className={cx('ai-ring', x.reply != null && 'is-still')} aria-hidden />
                  <span>
                    {x.reply ?? (x.parts.length ? `Rewriting the ${x.parts.map((p) => PART_WORD[p]).join(' and ')}…` : 'Reading your note…')}
                    {x === latest && x.before && (
                      <button type="button" className="link-btn rca-undo" onClick={() => undo(x)}>
                        Undo
                      </button>
                    )}
                  </span>
                </p>
              </li>
            ))}
          </ol>
        )}
        <form
          className="rca-composer"
          onSubmit={(e) => {
            e.preventDefault();
            run(ask);
          }}
        >
          <label htmlFor="rca-ask-input" className="sr-only">
            Tell the AI what to change in the initial RCA
          </label>
          <textarea
            id="rca-ask-input"
            className="rca-composer-input"
            rows={2}
            placeholder={thread.length ? 'Anything else to change?' : 'Tell the AI what to change in this RCA…'}
            value={ask}
            disabled={busy}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                run(ask);
              }
            }}
          />
          <div className="rca-composer-foot">
            <div className="rca-composer-asks">
              {RCA_ASKS.map((x) => (
                <button key={x} type="button" className="rca-ask-chip" disabled={busy} onClick={() => run(x)}>
                  {x}
                </button>
              ))}
            </div>
            <button type="submit" className="rca-composer-send" aria-label="Send to the AI" disabled={!ask.trim() || busy}>
              <ArrowUp size={16} aria-hidden />
            </button>
          </div>
        </form>
      </div>
    </>
  );
}


function FocusStep({ ticket, analysis, onAsk }: { ticket: Ticket; analysis: Analysis; onAsk: () => void }) {
  const { assetOf, reporterOf, memberOf, clientOf, confirmTriage, sendInitialRca, changeStatus, approveFix, codeFixOf, actorName, passTest, setSecurityIssue, now } = useStore();
  const asset = assetOf(ticket.assetId);
  const client = clientOf(ticket.clientId);
  const reporter = reporterOf(ticket);
  const dev = memberOf(ticket.assigneeId);
  const tester = memberOf(ticket.testerId);
  const step =
    ticket.status === 'blocked'
      ? 'blocked'
      : ticket.status === 'new'
      ? 'review'
      : ticket.status === 'not_started'
        ? 'check'
        : ticket.status === 'waiting_testing'
          ? 'wait'
          : ticket.status === 'on_testing'
            ? 'test'
            : ticket.status === 'qa_passed'
              ? 'release'
            : ticket.status === 'ready_to_deploy'
              ? 'deploy'
              : ticket.status === 'resolved'
                ? 'done'
                : ticket.diagnosis
                  ? 'fix'
                  : 'rca';
  const reading = useAiWork(`review:${ticket.id}`, 2400, step === 'review');
  const checking = useAiWork(`check:${ticket.id}`, 2000, step === 'check');
  const drafting = useAiWork(`rca:${ticket.id}`, 2000, step === 'rca');
  const coding = useAiWork(`fix:${ticket.id}:${ticket.moveNotes.length}`, 2600, step === 'fix');
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null);
  const [rewriting, setRewriting] = useState(false);
  const [verdict, setVerdict] = useState<'pass' | 'fail' | null>(null);
  const [testNote, setTestNote] = useState('');
  const [testProof, setTestProof] = useState<Attachment[]>([]);
  const [generating, setGenerating] = useState(false);
  const [tag, setTag] = useState<string | null>(null);
  const [checked, setChecked] = useState('');
  const [proof, setProof] = useState<Attachment[]>([]);
  const [tried, setTried] = useState(false);
  const first = (m?: { name: string } | null, or = 'the team') => m?.name.split(' ')[0] ?? or;
  const reporterName = (id: string) => client?.users.find((u) => u.id === id)?.name ?? 'the client';
  const pm = memberOf(client?.accountManagerId ?? null);
  const plan = ticket.plan ?? {};
  const task = plan.taskType === 'backend' ? 'Backend' : 'Frontend';
  const p = ticket.severity ? SEVERITY_LABEL[ticket.severity] : 'this priority';

  // Why the AI set each property, beside it, so the PM checks reasons instead of guessing.
  const rows = usePropRows(
    ticket,
    step === 'review'
      ? {
          priority: ticket.severity ? EFFECT_NOTE[ticket.severity] : undefined,
          assignee: `${task} work on ${client?.name ?? 'this client'} goes to ${first(dev)}.`,
          tester: `${client?.name ?? 'The client'}’s QA. Checks the issue next.`,
          taskType: plan.taskType === 'backend' ? 'It’s about the data or a sync behind the page.' : 'It’s about what a page shows.',
          asset: `What the report describes happens on ${asset?.name ?? 'this asset'}.`,
          category: CATEGORY_NOTE[ticket.category],
          sprint: 'This week’s sprint.',
          points: `A first estimate for ${p} ${task.toLowerCase()} work.`,
          expected: `The fix time for ${p} in the SLA.`,
        }
      : {},
  );


  if (step === 'review')
    return (
      <div className="fs">
        <StepHead person={pm} title="Review the properties" />
        <StageBanner ticket={ticket} />
        <ReportBlock key={step} ticket={ticket} />
        <AiCard id="fs-props-title" title="Properties" working={!reading.done} note={`Read from the report at ${fmtTime(ticket.createdAt)}. Change any that are off.`}>
          {reading.done ? (
            <dl className="props is-rows fs-props ns-fade">
              {rows.priority}
              {rows.assignee}
              {rows.tester}
              {rows.taskType}
              {rows.asset}
              {rows.category}
              {rows.sprint}
              {rows.points}
              {rows.expected}
            </dl>
          ) : (
            <AiWorking lines={[`Reading ${first(reporter, 'the client')}’s report`, `Matching it to ${client?.name ?? 'the client'}’s assets`, 'Setting the properties']} line={reading.line} />
          )}
        </AiCard>
        {reading.done && (
          <StepBar
            next={
              <>
                Next, <strong>{first(tester, 'QA')}</strong> checks that the issue is real.
              </>
            }
          >
            <Button variant="primary" onClick={() => confirmTriage(ticket.id)}>
              Confirm and send to {first(tester, 'QA')}
            </Button>
          </StepBar>
        )}
      </div>
    );

  if (step === 'check') {
    const error = answer === 'no' ? (checked.trim().length < 5 ? 'Say what you checked.' : proof.length === 0 ? 'Add a screenshot or recording as proof.' : '') : '';
    const submit = () => {
      if (answer === 'yes') changeStatus(ticket.id, 'in_progress');
      if (answer === 'no') {
        setTried(true);
        if (!error) changeStatus(ticket.id, 'canceled', { reason: `Could not be reproduced. ${checked.trim()}`, proof });
      }
    };
    return (
      <div className="fs">
        <StepHead person={tester} title="Check that the issue is real" />
        <StageBanner ticket={ticket} />
        <ReportBlock key={step} ticket={ticket} />
        <AiCard id="fs-found-title" title="What the AI found" working={!checking.done} note="Check it yourself before you answer.">
          {checking.done ? (
            <dl className="fs-found ns-fade">
              <div>
                <dt>What happens</dt>
                <dd>{analysis.problem}</dd>
              </div>
              <div>
                <dt>Where it likely is</dt>
                <dd>{analysis.issue}</dd>
              </div>
              {analysis.similar.length > 0 && (
                <div>
                  <dt>Seen before</dt>
                  <dd>
                    {analysis.similar.slice(0, 2).map((x, i) => (
                      <Fragment key={x.id}>
                        {i > 0 && ', '}
                        <Link to={`/tickets/${x.id}`}>{x.id}</Link> {x.title}
                        {x.tookMs != null && <span className="muted"> (fixed in {fmtDuration(x.tookMs)})</span>}
                      </Fragment>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <AiWorking lines={[`Reading ${first(reporter, 'the client')}’s report`, `Looking at ${asset?.name ?? 'the asset'}`, 'Finding earlier tickets like it']} line={checking.line} />
          )}
        </AiCard>
        {checking.done && (
          <>
            <fieldset className="fs-choice">
              <legend>Does it happen?</legend>
              <div className="fs-choice-row">
                <label className={cx('fs-option', answer === 'yes' && 'is-picked')}>
                  <input type="radio" name="fs-answer" checked={answer === 'yes'} onChange={() => setAnswer('yes')} />
                  <span>
                    <strong>Yes, it happens</strong>
                    <span>It goes to {first(dev, 'the developer')}, who sends the initial RCA.</span>
                  </span>
                </label>
                <label className={cx('fs-option', answer === 'no' && 'is-picked')}>
                  <input type="radio" name="fs-answer" checked={answer === 'no'} onChange={() => setAnswer('no')} />
                  <span>
                    <strong>No, it doesn’t</strong>
                    <span>It closes as canceled, with your proof.</span>
                  </span>
                </label>
              </div>
              {answer === 'no' && (
                <Field label="What you checked" htmlFor="fs-checked" hint={`${first(reporter, 'The client')} sees this and your proof.`} error={tried ? error : ''}>
                  <RichInput id="fs-checked" value={checked} onChange={setChecked} files={proof} onFilesChange={setProof} invalid={tried && !!error} placeholder="Followed the report on desktop and on a phone; bank transfer shows the virtual account number." autoFocus />
                </Field>
              )}
            </fieldset>
          </>
        )}
        {checking.done && (
          <StepBar
            next={
              !answer ? (
                'Answer “Does it happen?” above to go on.'
              ) : answer === 'no' ? (
                <>
                  It closes as canceled. <strong>{first(reporter, 'The client')}</strong> sees why.
                </>
              ) : (
                <>
                  Next, <strong>{first(dev, 'the developer')}</strong> reviews the initial RCA and sends it to {first(reporter, 'the client')}.
                </>
              )
            }
          >
            <Button variant={answer === 'no' ? 'danger' : 'primary'} disabled={!answer} onClick={submit}>
              {answer === 'no' ? 'Cancel with proof' : `Send to ${first(dev, 'the developer')}`}
            </Button>
          </StepBar>
        )}
      </div>
    );
  }

  const fix = step === 'wait' || step === 'test' || step === 'release' ? codeFixOf(ticket) : null;
  const stagingCard = fix && (
    <section className="fs-plain" aria-labelledby="fs-staging-title">
      <h3 id="fs-staging-title" className="fs-plain-title">
        On staging
      </h3>
      <dl className="rca-fields rca-form">
        <div>
          <dt>
            Try it at<small>Staging, not live</small>
          </dt>
          <dd>
            <a href={stagingUrl(asset?.url)} target="_blank" rel="noopener noreferrer" className="fix-link">
              {stagingUrl(asset?.url).replace(/^https?:\/\//, '')}
            </a>
          </dd>
        </div>
        <div>
          <dt>
            The fix<small>What changed</small>
          </dt>
          <dd>
            {fix.summary}
            <span className="fix-changed-line">
              {fix.files.length} {fix.files.length === 1 ? 'file' : 'files'} changed <span className="fix-plus">+{countLines(fix).add}</span> <span className="fix-minus">−{countLines(fix).del}</span> · <code>{fix.branch}</code>
            </span>
          </dd>
        </div>
        <div>
          <dt>
            Approved by<small>Put on staging</small>
          </dt>
          <dd>{fix.stagedAt ? `${fix.stagedBy ? actorName(fix.stagedBy) : (dev?.name ?? 'The developer')}, ${fmtDateTime(fix.stagedAt)}` : (dev?.name ?? 'The developer')}</dd>
        </div>
      </dl>
    </section>
  );

  if (step === 'blocked') {
    const blocker = ticket.blockers[ticket.blockers.length - 1];
    const back: TicketStatus = blocker?.from && blocker.from !== 'blocked' ? blocker.from : 'in_progress';
    const holder = back === 'waiting_testing' || back === 'on_testing' ? tester : dev;
    return (
      <div className="fs">
        <StepHead person={holder} title="Clear the blocker" />
        <ReportBlock key={step} ticket={ticket} compact />
        <section className="fs-plain fs-blocked" aria-labelledby="fs-blocked-title">
          <h3 id="fs-blocked-title" className="fs-plain-title">
            <Ban size={17} aria-hidden />
            Blocked
          </h3>
          <dl className="rca-fields rca-form">
            <div>
              <dt>
                What’s blocking it<small>Logged when it stopped</small>
              </dt>
              <dd>{blocker?.details ?? 'No reason given.'}</dd>
            </div>
            <div>
              <dt>
                Since<small>How long it’s waited</small>
              </dt>
              <dd>
                {blocker ? (
                  <>
                    <strong>{fmtDuration(now - blocker.at)}</strong>
                    <span className="fix-changed-line">
                      {actorName(blocker.by)} blocked it, {fmtDateTime(blocker.at)}
                    </span>
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt>
                Paused at<small>Where it picks up again</small>
              </dt>
              <dd>{STATUS_LABEL[back]}</dd>
            </div>
            <div>
              <dt>
                The client<small>What they see</small>
              </dt>
              <dd>
                Still <strong>In progress</strong>, with the usual updates. Blocked stays inside NXS.
              </dd>
            </div>
          </dl>
          <Field label="How it was cleared" optional htmlFor="fs-cleared" hint="Goes into the activity log, so the team knows next time.">
            <TextArea id="fs-cleared" rows={2} value={testNote} onChange={(e) => setTestNote(e.target.value)} placeholder="The platform team upgraded the Meta app to API v21." />
          </Field>
        </section>
        <StepBar
          next={
            <>
              It goes back to <strong>{STATUS_LABEL[back]}</strong> with <strong>{first(holder, 'the team')}</strong>.
            </>
          }
        >
          <Button variant="primary" onClick={() => changeStatus(ticket.id, back, { reason: testNote.trim() || undefined })}>
            Unblock and continue
          </Button>
        </StepBar>
      </div>
    );
  }

  if (step === 'wait')
    return (
      <div className="fs">
        <StepHead person={tester} title="Start testing the fix" />
        <StageBanner ticket={ticket} />
        <ReportBlock key={step} ticket={ticket} compact />
        {stagingCard}
        <StepBar
          next={
            <>
              You test it on staging, then pass it or send it back to <strong>{first(dev, 'the developer')}</strong>.
            </>
          }
        >
          <Button variant="primary" onClick={() => changeStatus(ticket.id, 'on_testing')}>
            Start testing
          </Button>
        </StepBar>
      </div>
    );

  if (step === 'test') {
    // Passing needs the release notes the client gets (proof is optional); failing needs what still goes wrong.
    const failError = verdict === 'fail' && testNote.trim().length < 5 ? 'Say what still goes wrong.' : verdict === 'pass' && testNote.trim().length < 10 ? 'Write the release notes, or generate a draft with AI.' : '';
    // Like a commit message: the AI drafts it from the RCA and the approved fix, and QA edits it.
    const generate = () => {
      if (generating) return;
      setGenerating(true);
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      window.setTimeout(() => {
        setTestNote(releaseNotesOf(ticket, asset?.name ?? 'the asset', ''));
        setGenerating(false);
      }, reduce ? 150 : 1200);
    };
    const submit = () => {
      setTried(true);
      if (verdict === 'pass' && !failError) passTest(ticket.id, testNote, testProof);
      if (verdict === 'fail' && !failError) changeStatus(ticket.id, 'in_progress', { reason: testNote.trim() });
    };
    return (
      <div className="fs">
        <StepHead person={tester} title="Test the fix on staging" />
        <StageBanner ticket={ticket} />
        <ReportBlock key={step} ticket={ticket} />
        {stagingCard}
        <fieldset className="fs-choice">
          <legend>Does the fix work?</legend>
          <div className="fs-choice-row">
            <label className={cx('fs-option', verdict === 'pass' && 'is-picked')}>
              <input type="radio" name="fs-verdict" checked={verdict === 'pass'} onChange={() => setVerdict('pass')} />
              <span>
                <strong>Yes, it works</strong>
                <span>{first(dev, 'The developer')} prepares the release for {first(reporter, 'the client')}.</span>
              </span>
            </label>
            <label className={cx('fs-option', verdict === 'fail' && 'is-picked')}>
              <input type="radio" name="fs-verdict" checked={verdict === 'fail'} onChange={() => setVerdict('fail')} />
              <span>
                <strong>No, it still fails</strong>
                <span>It goes back to {first(dev, 'the developer')}, and the AI rewrites the fix from your notes.</span>
              </span>
            </label>
          </div>
          {verdict && (
            <div className="fs-notes-field">
            <Field
              label={verdict === 'pass' ? 'Release notes' : 'What still goes wrong'}
              htmlFor="fs-test-note"
              hint={verdict === 'pass' ? `${first(reporter, 'The client')} gets this as the release notes, with any screenshots or recordings you attach.` : `${first(dev, 'The developer')} and the AI work from this.`}
              error={tried ? failError : ''}
            >
              <RichInput
                id="fs-test-note"
                value={testNote}
                onChange={setTestNote}
                files={testProof}
                onFilesChange={setTestProof}
                invalid={tried && !!failError}
                placeholder={verdict === 'pass' ? 'What we fixed, and how you checked it on staging. Or generate a draft with AI.' : 'Still blank on Safari on iPhone; desktop works.'}
                autoFocus
                tools={
                  verdict === 'pass' && (
                    <button type="button" className={cx('fs-generate', generating && 'is-working')} onClick={generate} disabled={generating}>
                      <span className="ai-ring" aria-hidden />
                      {generating ? 'Writing…' : testNote.trim() ? 'Regenerate with AI' : 'Generate with AI'}
                    </button>
                  )
                }
              />
            </Field>
            </div>
          )}
        </fieldset>
        <StepBar
          next={
            !verdict ? (
              'Answer “Does the fix work?” above to go on.'
            ) : verdict === 'pass' ? (
              <>
                Next, <strong>{first(dev, 'the developer')}</strong> checks the container registry and sends your release notes to {first(reporter, 'the client')}.
              </>
            ) : (
              <>
                It goes back to <strong>{first(dev, 'the developer')}</strong>, with your notes.
              </>
            )
          }
        >
          <Button variant="primary" disabled={!verdict} onClick={submit}>
            {verdict === 'fail' ? `Send back to ${first(dev, 'the developer')}` : 'Passed'}
          </Button>
        </StepBar>
      </div>
    );
  }

  if (step === 'release') {
    // Moved here from the menu without a test result: it still goes out, with the notes left empty.
    const result = ticket.testResult ?? { at: ticket.updatedAt, by: { type: 'system' as const }, note: '', proof: [] };
    const built = fix ?? codeFixOf(ticket);
    const builtAt = built.stagedAt ?? result.at;
    const image = tag ?? imageTagOf(built.repo, ticket.id, builtAt);
    const tagError = image.trim() && !/^[\w./-]+:[\w.-]+$/.test(image.trim()) ? 'Use the image’s full name and tag, like repo/name:tag.' : '';
    const notesText = result.note || releaseNotesOf(ticket, asset?.name ?? 'the asset', '');
    return (
      <div className="fs">
        <StepHead person={dev} title="Check the container registry and send it" />
        <StageBanner ticket={ticket} />
        <ReportBlock key={step} ticket={ticket} compact />
        <section className="fs-plain" aria-labelledby="fs-release-title">
          <h3 id="fs-release-title" className="fs-plain-title">
            Release
          </h3>
          <dl className="rca-fields rca-form">
            <div>
              <dt>
                Container registry<small>Built from the approved fix</small>
              </dt>
              <dd>
                <label htmlFor="fs-tag" className="sr-only">
                  Container registry image
                </label>
                <input id="fs-tag" className={cx('input fs-tag-input', tagError && 'is-invalid')} value={image} spellCheck={false} onChange={(e) => setTag(e.target.value)} />
                <span className={cx('fix-changed-line', tagError && 'is-error')}>
                  {tagError || (
                    <>
                      Built from <code>{built.branch}</code>
                      {built.stagedAt ? `, ${fmtDateTime(built.stagedAt)}` : ''}. Change it if you rebuilt.
                    </>
                  )}
                </span>
              </dd>
            </div>
            <div>
              <dt>
                The fix<small>What changed</small>
              </dt>
              <dd>
                {built.summary}
                <span className="fix-changed-line">
                  {built.files.length} {built.files.length === 1 ? 'file' : 'files'} changed <span className="fix-plus">+{countLines(built).add}</span> <span className="fix-minus">−{countLines(built).del}</span>
                </span>
              </dd>
            </div>
            <div>
              <dt>
                Release notes<small>From {first(tester, 'QA')}</small>
              </dt>
              <dd>{notesText}</dd>
            </div>
            <div>
              <dt>
                Proof<small>From testing</small>
              </dt>
              <dd>{result.proof.length > 0 ? <Attachments files={result.proof} /> : <span className="muted">None attached.</span>}</dd>
            </div>
          </dl>
        </section>
        <StepBar
          next={
            <>
              <strong>{first(reporter, 'The client')}</strong> gets the release notes and proof to approve the deploy.
            </>
          }
        >
          <Button variant="primary" disabled={!image.trim() || !!tagError} onClick={() => changeStatus(ticket.id, 'ready_to_deploy', { handoff: { note: notesText, attachments: result.proof, imageTag: image.trim() } })}>
            Send to {first(reporter, 'the client')}
          </Button>
        </StepBar>
      </div>
    );
  }

  if (step === 'deploy') {
    const sent = ticket.handoffs[ticket.handoffs.length - 1];
    const last = ticket.feedback[ticket.feedback.length - 1];
    const approved = last?.decision === 'approved' && (!sent || last.at >= sent.at) ? last : undefined;
    return (
      <div className="fs">
        <StepHead person={approved ? dev : reporter} title={approved ? 'Deploy the fix' : `Waiting for ${first(reporter, 'the client')} to approve the deploy`} />
        <StageBanner ticket={ticket} />
        <ReportBlock key={step} ticket={ticket} compact />
        <section className="fs-plain" aria-labelledby="fs-sent-title">
          <h3 id="fs-sent-title" className="fs-plain-title">
            Sent to {first(reporter, 'the client')}
          </h3>
          <dl className="rca-fields rca-form">
            {sent?.imageTag && (
              <div>
                <dt>
                  Container registry<small>The image that goes live</small>
                </dt>
                <dd>
                  <code className="fix-tag">{sent.imageTag}</code>
                </dd>
              </div>
            )}
            {sent?.note && (
              <div>
                <dt>
                  Release notes<small>Proof it’s fixed</small>
                </dt>
                <dd>{sent.note}</dd>
              </div>
            )}
            {sent && sent.attachments.length > 0 && (
              <div>
                <dt>
                  Proof<small>From testing</small>
                </dt>
                <dd>
                  <Attachments files={sent.attachments} />
                </dd>
              </div>
            )}
            <div>
              <dt>
                Approval<small>From the client</small>
              </dt>
              <dd>{approved ? `Approved by ${reporterName(approved.by)}, ${fmtDateTime(approved.at)}` : `Not yet. Sent ${sent ? fmtRelative(sent.at, now).toLowerCase() : ''}`}</dd>
            </div>
          </dl>
        </section>
        <StepBar
          next={
            approved ? (
              <>
                Put <code className="fix-tag">{sent?.imageTag ?? 'the image'}</code> live, then mark it deployed.
              </>
            ) : (
              <>
                <strong>{first(reporter, 'The client')}</strong> approves it in the Client Portal first.
              </>
            )
          }
        >
          <Button variant="primary" disabled={!approved} onClick={() => changeStatus(ticket.id, 'resolved')}>
            Mark as deployed
          </Button>
        </StepBar>
      </div>
    );
  }

  if (step === 'done') {
    const recurring = analysis.similar.length > 0;
    const plan = fullRcaPlan(ticket, ticket.recurring ?? recurring);
    const sentRca = plan.due != null && plan.due <= now;
    const deployedBy = [...ticket.activity].reverse().find((a) => a.kind === 'resolution');
    return (
      <div className="fs">
        <StepHead title="Fixed and live" />
        <ReportBlock key={step} ticket={ticket} compact />
        <section className="fs-plain" aria-labelledby="fs-done-title">
          <h3 id="fs-done-title" className="fs-plain-title">
            Resolved
          </h3>
          <dl className="rca-fields rca-form">
            <div>
              <dt>
                Deployed<small>Live for the client</small>
              </dt>
              <dd>{ticket.resolvedAt ? `${deployedBy ? actorName(deployedBy.actor) : 'NXS'}, ${fmtDateTime(ticket.resolvedAt)}` : '—'}</dd>
            </div>
            <div>
              <dt>
                Full RCA<small>From the SLA</small>
              </dt>
              <dd>
                {plan.due != null ? (sentRca ? `Sent to ${first(reporter, 'the client')} on ${fmtDateTime(plan.due)}.` : `Goes to ${first(reporter, 'the client')} on ${fmtDateTime(plan.due)}.`) : 'Not needed for this ticket.'}
                <span className="fix-changed-line">
                  {plan.why}
                  {plan.due != null && ' The AI builds it from this ticket’s history; nobody needs to write it.'}
                </span>
                {ticket.severity === 'medium' && (
                  <button type="button" className="link-btn fs-rca-flag" onClick={() => setSecurityIssue(ticket.id, !ticket.securityIssue)}>
                    {ticket.securityIssue ? 'It wasn’t a security or data issue' : 'It was a security or data issue'}
                  </button>
                )}
                {sentRca && (
                  <a className="link-btn fs-rca-flag" href={`/report/${ticket.id}`} target="_blank" rel="noopener noreferrer">
                    View the full RCA
                  </a>
                )}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    );
  }

  if (step === 'fix') {
    // Sent back from testing: what QA found goes to the AI as the reason for the next attempt.
    const back = [...ticket.moveNotes].reverse().find((m) => m.to === 'in_progress' && (m.from === 'on_testing' || m.from === 'qa_passed' || m.from === 'waiting_testing' || m.from === 'ready_to_deploy'));
    return (
      <div className="fs">
        <StepHead person={dev} title={back ? 'Review the AI’s new fix' : 'Review the AI’s fix'} />
        <StageBanner ticket={ticket} />
        <ReportBlock key={step} ticket={ticket} compact />
        <AiCard id="fs-fix-title" title="Code fix" working={!coding.done || rewriting} note={back ? `Rewritten for what ${first(tester, 'QA')} found in testing. Tell the AI what to change below.` : 'Written from the initial RCA. Tell the AI what to change below.'}>
          {coding.done ? (
            <div className="ns-fade">
              <FixByAi ticket={ticket} onBusy={setRewriting} />
            </div>
          ) : (
            <AiWorking lines={back ? [`Reading ${first(tester, 'QA')}’s notes from testing`, 'Finding what the last fix missed', 'Rewriting the fix'] : ['Reading the initial RCA', `Finding the code behind it in ${asset?.name ?? 'the asset'}`, 'Writing the fix']} line={coding.line} />
          )}
        </AiCard>
        {coding.done && (
          <StepBar
            next={
              <>
                It goes on staging, and <strong>{first(tester, 'QA')}</strong> tests it there.
              </>
            }
          >
            <Button variant="primary" disabled={rewriting} onClick={() => approveFix(ticket.id)}>
              Approve and put on staging
            </Button>
          </StepBar>
        )}
      </div>
    );
  }

  return (
    <div className="fs">
      <StepHead person={dev} title="Review and send the initial RCA" />
      <StageBanner ticket={ticket} />
      <ReportBlock key={step} ticket={ticket} compact />
      <AiCard id="fs-rca-title" title="Initial RCA" working={!drafting.done || rewriting} note="Tell the AI what to change below; it rewrites the draft for you.">
        {drafting.done ? (
          <div className="ns-fade">
            <RcaByAi ticket={ticket} analysis={analysis} onBusy={setRewriting} />
          </div>
        ) : (
          <AiWorking lines={[`Reading the report and ${first(tester, 'QA')}’s check`, 'Finding the likely cause', 'Drafting the RCA']} line={drafting.line} />
        )}
      </AiCard>
      {drafting.done && (
        <StepBar
          next={
            <>
              <strong>{first(reporter, 'The client')}</strong> sees it in the Client Portal. Then you fix it and send it to testing.
            </>
          }
        >
          <Button variant="primary" disabled={rewriting} onClick={() => sendInitialRca(ticket.id)}>
            Send RCA to {first(reporter, 'the client')}
          </Button>
        </StepBar>
      )}
    </div>
  );
}

function NextStep({ ticket }: { ticket: Ticket; analysis: Analysis; onAsk: () => void }) {
  const { slaOf, assetOf, memberOf, reporterOf, currentUser, changeStatus, can, now } = useStore();
  const sla = slaOf(ticket);
  const status = ticket.status;
  const asset = assetOf(ticket.assetId);
  const reporter = reporterOf(ticket);
  const dev = memberOf(ticket.assigneeId);
  const tester = memberOf(ticket.testerId);
  const step = status;
  if (status === 'resolved' || status === 'canceled' || !can('ticket.update')) return null;
  const first = (m?: { name: string } | null, or = 'the team') => m?.name.split(' ')[0] ?? or;
  const mine = (id: string | null) => id === currentUser.id;
  // Nothing is locked: anyone can take a step, and the header says whose it is.
  const whose = (id: string | null, m?: { name: string } | null) => (mine(id) ? 'Now with you' : `Now with ${first(m)}`);
  const fixDue = `Fix due ${fmtDateTime(sla.resolution.due)}`;
  const every = ticket.severity === 'critical' ? 'every hour' : ticket.severity === 'medium' ? 'every 4 hours' : 'when it is fixed';

  let title = '';
  let kicker = '';
  let due: ReactNode = null;
  let body: ReactNode = null;
  let actions: ReactNode = null;

  if (step === 'in_progress') {
    title = 'Fix it and send it to testing';
    kicker = whose(ticket.assigneeId, dev);
    due = <span className="rca-due">{fixDue}</span>;
    body = (
      <p className="ns-text">
        The cause and the fix are in the initial RCA, under “Sent to” on the right. The client hears from us {every} while it’s being fixed; the AI sends those updates.
      </p>
    );
    actions = (
      <Button variant="primary" onClick={() => changeStatus(ticket.id, 'waiting_testing')}>
        Send to testing
      </Button>
    );
  } else if (step === 'waiting_testing') {
    title = 'Start testing the fix';
    kicker = whose(ticket.testerId, tester);
    due = <DueLine clock={sla.resolution} />;
    body = <p className="ns-text">{dev?.name.split(' ')[0] ?? 'The developer'} has finished the fix. The client has been told it is in testing.</p>;
    actions = (
      <Button variant="primary" onClick={() => changeStatus(ticket.id, 'on_testing')}>
        Start testing
      </Button>
    );
  } else if (step === 'on_testing') {
    title = 'Test the fix, then send it to deploy';
    kicker = whose(ticket.testerId, tester);
    due = <DueLine clock={sla.resolution} />;
    const checks = (ticket.diagnosis?.fix ?? '').split(/(?<=[.!?])\s+/).filter(Boolean);
    body = (
      <div className="ns-fade">
        <p className="ns-label">
          <Sparkles size={14} aria-hidden /> What to test, from the RCA
        </p>
        <ul className="ns-checks">
          {checks.map((c) => (
            <li key={c}>{c}</li>
          ))}
          <li>The rest of {asset?.name ?? 'the asset'} still works on desktop and mobile.</li>
        </ul>
      </div>
    );
    actions = (
      <Button variant="primary" onClick={() => changeStatus(ticket.id, 'ready_to_deploy')}>
        Passed: send to deploy
      </Button>
    );
  } else if (step === 'ready_to_deploy') {
    const sent = ticket.handoffs[ticket.handoffs.length - 1];
    title = `Waiting for ${reporter?.name.split(' ')[0] ?? 'the client'} to deploy`;
    body = <p className="ns-text">The fix and its resolution notes went to the client{sent ? ` ${fmtRelative(sent.at, now).toLowerCase()}` : ''}. Nothing to do until they deploy it or reply.</p>;
  }

  return (
    <section className={cx('ns', `is-${step}`)} aria-labelledby="ns-title" key={step}>
      <header className="ns-head">
        <div>
          <p className="ns-kicker">{actions ? kicker || 'Your next step' : 'Now'}</p>
          <h2 id="ns-title" className="ns-title">
            {title}
          </h2>
        </div>
        {due && <div className="ns-due">{due}</div>}
      </header>
      {body}
      {actions && <div className="ns-actions">{actions}</div>}
    </section>
  );
}

/* ---------- Initial RCA ----------
   The AI drafts it the moment the ticket comes in: the issue, its cause and
   the fix. QA checks it and sends it by confirming the ticket (T+3). For P1,
   the time to fix is set here; P2 and P3 follow the SLA. */

function InitialRca({ ticket, analysis, onAsk, embedded, changed, rewriting }: { ticket: Ticket; analysis: Analysis; onAsk?: () => void; embedded?: boolean; /** Parts the AI just rewrote, marked for a moment. */ changed?: RcaPart[]; /** Parts the AI is rewriting now. */ rewriting?: RcaPart[] }) {
  const { saveInitialRca, saveRcaDraft, slaOf, can } = useStore();
  const shared = ticket.diagnosis;
  const draft = ticket.rcaDraft ?? analysis;
  const shown = shared ?? draft;
  const shownProblem = shown.problem ?? analysis.problem;
  // The developer edits the AI's draft until it's sent. Once sent it is what the client has:
  // later findings go in the comments, not back into this.
  // In the step the draft is changed by asking the AI, so there is no Edit there.
  const canEdit = !embedded && !shared && isOpen(ticket) && can('ticket.update');
  const mark = (part: RcaPart) => (rewriting?.includes(part) ? 'is-rewriting' : changed?.includes(part) ? 'is-changed' : undefined);
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState('');
  const [issue, setIssue] = useState('');
  const [fix, setFix] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const sla = slaOf(ticket);
  const open = () => {
    setProblem(shownProblem);
    setIssue(shown.issue);
    setFix(shown.fix);
    setSubmitted(false);
    setEditing(true);
  };
  const errors = {
    problem: problem.trim().length < 10 ? 'Say what the issue is.' : '',
    issue: issue.trim().length < 10 ? 'Say what is causing it.' : '',
    fix: fix.trim().length < 10 ? 'Say how it will be fixed.' : '',
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (errors.problem || errors.issue || errors.fix) return;
    if (shared) saveInitialRca(ticket.id, { problem, issue, fix, fixBy: shared.fixBy });
    else saveRcaDraft(ticket.id, { problem, issue, fix });
    setEditing(false);
  };
  /** How long the fix takes, as the client reads it. The target date follows, without a clock time. */
  const span = (ms: number) => {
    const days = ms / (24 * HOUR_MS);
    if (Number.isInteger(days)) return `${days} ${days === 1 ? 'day' : 'days'}`;
    const h = Math.round(ms / HOUR_MS);
    return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  };
  const priority = ticket.severity ? SEVERITY_LABEL[ticket.severity] : 'this priority';
  // Time to fix follows the priority's SLA; it isn't set here.
  const fixDue = sla.resolution.due;
  const shownFix = {
    within: `Within ${span(fixDue - ticket.createdAt)}`,
    note: `From the SLA for ${priority}, by ${fmtDateTime(fixDue)}`,
  };
  const actions = !editing && (canEdit || onAsk) && (
    <div className="rca-head-actions">
      {canEdit && (
        <Button variant="secondary" size="sm" onClick={open}>
          <PenLine size={15} aria-hidden />
          Edit
        </Button>
      )}
      {onAsk && (
        <Button variant="primary" size="sm" onClick={onAsk}>
          <MessageSquare size={15} aria-hidden />
          Ask AI
        </Button>
      )}
    </div>
  );

  return (
    <div className="rca-block" role="group" aria-labelledby="rca-initial">
      <header className={cx('rca-head', embedded && 'is-embedded')}>
        <div className={embedded ? 'sr-only' : undefined}>
          <h3 id="rca-initial" className="rca-title">
            Initial RCA
            {!shared && <Badge tone="purple">AI draft</Badge>}
          </h3>
          <p className="rca-sub">
            {shared ? (
              <DueLine clock={sla.initialRca} sentAt={shared.at} />
            ) : (
              <>
                <DueLine clock={sla.initialRca} /> · goes to the client when you confirm the ticket
              </>
            )}
          </p>
        </div>
        {actions}
      </header>

      {editing ? (
        <form className="form-stack" onSubmit={save} noValidate>
          <Field label="Issue" htmlFor="rca-problem" error={submitted ? errors.problem : ''}>
            <TextArea id="rca-problem" rows={3} value={problem} onChange={(e) => setProblem(e.target.value)} />
          </Field>
          <Field label="Cause" htmlFor="rca-issue" error={submitted ? errors.issue : ''}>
            <TextArea id="rca-issue" rows={3} value={issue} onChange={(e) => setIssue(e.target.value)} />
          </Field>
          <Field label="How it will be fixed" htmlFor="rca-fix" error={submitted ? errors.fix : ''}>
            <TextArea id="rca-fix" rows={3} value={fix} onChange={(e) => setFix(e.target.value)} />
          </Field>
          <p className="fix-preview">Time to fix follows the priority’s SLA.</p>
          <div className="rca-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setProblem(analysis.problem);
                setIssue(analysis.issue);
                setFix(analysis.fix);
              }}
            >
              <RotateCcw size={15} aria-hidden />
              Use AI draft
            </Button>
            <span className="rca-actions-end">
              <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="submit">
                Save
              </Button>
            </span>
          </div>
        </form>
      ) : (
        // A filled-in form: labels (with what each part answers) on the left, the AI's words on the right.
        // Read-only on purpose: the words change by asking the AI, never by typing here.
        <dl className="rca-fields rca-form">
          <div>
            <dt>
              Issue<small>What happens</small>
            </dt>
            <dd className={mark('problem')}>{shownProblem}</dd>
          </div>
          <div>
            <dt>
              Cause<small>Why it happens</small>
            </dt>
            <dd className={mark('issue')}>{shown.issue}</dd>
          </div>
          <div>
            <dt>
              How it will be fixed<small>What we’ll do</small>
            </dt>
            <dd className={mark('fix')}>{shown.fix}</dd>
          </div>
          <div>
            <dt>
              Time to fix<small>Set by the SLA</small>
            </dt>
            <dd className="fix-when">
              <strong>{shownFix.within}</strong>
              <span className="muted">{shownFix.note}</span>
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

/** Questions to the AI about the analysis. Answers can go straight into the initial RCA. */
function AskAi({ ticket, analysis, assetName }: { ticket: Ticket; analysis: Analysis; assetName: string }) {
  const { addRcaExchange, saveRcaDraft, saveInitialRca, actorName, slaOf, toast, now } = useStore();
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const thread = ticket.rcaChat ?? [];
  const unasked = STARTERS.filter((q) => !thread.some((x) => x.question === q));
  const ask = (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    setText('');
    setPending(q);
    // A short pause, as a real model would take.
    window.setTimeout(() => {
      const a = answer(q, ticket, assetName, analysis, slaOf(ticket).resolution.due, now, ticket.plan?.storyPoints);
      addRcaExchange(ticket.id, { question: q, answer: a.text, apply: a.apply });
      setPending(null);
    }, 700);
  };
  const use = (apply: { problem?: string; issue?: string; fix?: string }) => {
    const base = ticket.diagnosis ?? ticket.rcaDraft ?? analysis;
    const next = { problem: apply.problem ?? base.problem ?? analysis.problem, issue: apply.issue ?? base.issue, fix: apply.fix ?? base.fix };
    if (ticket.diagnosis) saveInitialRca(ticket.id, { ...next, fixBy: ticket.diagnosis.fixBy });
    else {
      saveRcaDraft(ticket.id, next);
      toast('Added to the initial RCA draft');
    }
  };
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [thread.length, pending]);
  return (
    <div className="ask-ai">
      <div className="ai-scroll" ref={scroller}>
      {thread.length === 0 && !pending && (
        <div className="ai-a">
          <span className="ai-mark" aria-hidden>
            AI
          </span>
          <div className="ai-a-body">
            <p className="ai-a-text">Ask me anything about this ticket: what’s wrong, why I read the cause this way, what to check, or how to say it to the client.</p>
          </div>
        </div>
      )}
      {thread.length > 0 && (
        <ol className="ai-thread">
          {thread.map((x) => {
            const name = actorName(x.by);
            return (
              <li key={x.id} className="ai-exchange">
                <div className="ai-q" title={name}>
                  <p>{x.question}</p>
                </div>
                <div className="ai-a">
                  <span className="ai-mark" aria-hidden>
                    AI
                  </span>
                  <div className="ai-a-body">
                    <p className="ai-a-text">{x.answer}</p>
                    {x.apply && ticket.status === 'new' && (
                      <Button variant="secondary" size="sm" onClick={() => use(x.apply!)}>
                        Use in initial RCA
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {pending && (
        <div className="ai-exchange">
          <div className="ai-q">
            <p>{pending}</p>
          </div>
          <p className="ai-thinking" role="status">
            Thinking…
          </p>
        </div>
      )}

      </div>
      <div className="ai-foot">
      {!pending && unasked.length > 0 && (
        <div className="ai-starters">
          {unasked.map((q) => (
            <button key={q} type="button" className="choice-chip" onClick={() => ask(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
      <form
        className="ai-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
      >
        <input className="ai-input" aria-label="Ask AI about this ticket" placeholder="Ask about this ticket…" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="ai-send" aria-label="Send" disabled={!text.trim() || !!pending}>
          <ArrowUp size={17} aria-hidden />
        </button>
      </form>
      </div>
    </div>
  );
}

/* ---------- Comments: one thread with the client, one inside NXS ---------- */

function CommentsPanel({ ticket }: { ticket: Ticket }) {
  const { addComment, actorName, memberOf, clientOf, team, now } = useStore();
  const [thread, setThread] = useState<'client' | 'internal'>('client');
  const [text, setText] = useState('');
  // Replying under one part of the client's timeline, so the answer shows up there in the portal.
  const [replyTo, setReplyTo] = useState<CommentOn | null>(null);
  const list = ticket.comments.filter((c) => c.thread === thread);
  /** What a client comment replied to, as they see it on their timeline. */
  const onLabel = (on?: CommentOn) => {
    if (!on) return null;
    if (on.kind === 'rca') return 'Initial analysis (RCA)';
    const h = ticket.handoffs.find((x) => x.id === on.id);
    return h ? `The fix sent ${fmtDateTime(h.at)}` : 'The fix';
  };
  // Who can be mentioned: the team on the internal thread, the client's own people on the client thread.
  const people = thread === 'internal' ? team.map((m) => ({ id: m.id, name: m.name, title: m.title, photo: m.photo })) : (clientOf(ticket.clientId)?.users ?? []).map((u) => ({ id: u.id, name: u.name, title: u.title, photo: undefined }));
  const send = () => {
    if (!text.trim()) return;
    addComment(ticket.id, thread, text, undefined, thread === 'client' ? (replyTo ?? undefined) : undefined);
    setText('');
    setReplyTo(null);
  };
  const count = (t: 'client' | 'internal') => ticket.comments.filter((c) => c.thread === t).length;
  const keyOf = (on?: CommentOn) => (on ? (on.kind === 'rca' ? 'rca' : `release-${on.id}`) : 'rca');
  const replyKey = replyTo ? keyOf(replyTo) : null;
  // The client thread, grouped by what each reply is on, in the order the parts were first replied to.
  const groups = (() => {
    const by = new Map<string, { key: string; on: CommentOn; items: typeof list }>();
    for (const c of thread === 'client' ? [...list].sort((x, y) => x.at - y.at) : []) {
      const k = keyOf(c.on);
      if (!by.has(k)) by.set(k, { key: k, on: c.on ?? { kind: 'rca' }, items: [] });
      by.get(k)!.items.push(c);
    }
    return [...by.values()];
  })();
  const row = (c: (typeof list)[number]) => {
    const name = actorName(c.by);
    return (
      <li key={c.id} className={cx('comment', c.by.type !== 'client' && 'is-nxs')}>
        <Avatar name={name} size={28} src={c.by.type === 'team' ? memberOf(c.by.id)?.photo : undefined} />
        <div className="comment-body">
          <p className="comment-meta">
            <span className="comment-name">{name}</span>
            {c.by.type === 'client' && <span className="comment-who">Client</span>}
            <time title={fmtDateTime(c.at)}>{fmtRelative(c.at, now)}</time>
          </p>
          <p className="comment-text">{withMentions(c.text, people.map((x) => x.name))}</p>
        </div>
      </li>
    );
  };
  return (
    <div className="comments">
      <div className="view-tabs comments-threads" role="tablist" aria-label="Comment thread">
        {(
          [
            ['client', 'With client'],
            ['internal', 'Internal'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={thread === key} className={cx('view-tab', thread === key && 'is-active')} onClick={() => setThread(key)}>
            {key === 'internal' && <Lock size={13} aria-hidden />}
            {label}
            <span className="view-tab-count">{count(key)}</span>
          </button>
        ))}
      </div>
      <p className="comments-hint">
        {thread === 'client'
          ? 'The client comments under the initial RCA and the fix in the Client Portal. Comment back on one and they see it there, under the same part.'
          : 'Only the NXS team sees this thread. Nothing here reaches the client.'}
      </p>

      {thread === 'client' ? (
        // One group per part of the client's timeline, its replies in order, and the reply box under it.
        groups.length > 0 ? (
          <div className="comment-groups">
            {groups.map((g) => (
              <section key={g.key} className="comment-group" aria-label={`Comments on ${onLabel(g.on)}`}>
                <p className="comment-group-head">
                  On <strong>{onLabel(g.on)}</strong>
                  <span className="muted">
                    {g.items.length} {g.items.length === 1 ? 'comment' : 'comments'}
                  </span>
                </p>
                <ol className="comment-list is-thread">{g.items.map(row)}</ol>
                {replyKey === g.key ? (
                  <div className="comment-group-reply">
                    <CommentBox key={g.key} value={text} onChange={setText} onSend={send} people={people} label="Comment to the client" placeholder="Write a comment to the client… They see it under the same part. Type @ to mention someone." />
                    <button type="button" className="link-btn" onClick={() => setReplyTo(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button type="button" className="pt-reply-open comment-group-open" onClick={() => setReplyTo(g.on)}>
                    <MessageSquare size={15} aria-hidden />
                    Comment
                  </button>
                )}
              </section>
            ))}
          </div>
        ) : (
          <p className="comments-empty">No comments from the client yet. They can comment under the initial RCA and under the fix in the Client Portal.</p>
        )
      ) : (
        <>
          {list.length > 0 ? <ol className="comment-list">{list.map(row)}</ol> : <p className="comments-empty">No comments yet.</p>}
          <CommentBox key="internal" value={text} onChange={setText} onSend={send} people={people} label="Internal comment" placeholder="Write a note for the team… Type @ to mention someone." />
        </>
      )}
    </div>
  );
}

/* ---------- Planning ---------- */

const TASK_TONE: Record<TaskType, Tone> = { frontend: 'blue', backend: 'green' };

/**
 * The right column: every property as a label and value row, in groups:
 * where it stands, who, what it is about, the plan, when it came in. The AI
 * fills them in when the ticket comes in; a sparkle marks a value QA hasn't
 * changed yet.
 */
type PropKey = 'priority' | 'assignee' | 'tester' | 'taskType' | 'asset' | 'category' | 'sprint' | 'points' | 'expected';

/** Every property row of a ticket, editable where it may be. `notes` puts a short reason beside a row. */
function usePropRows(ticket: Ticket, notes: Partial<Record<PropKey, ReactNode>> = {}) {
  const { clientOf, assetOf, assets, reporterOf, planTicket, setSeverity, setCategory, setAsset, slaOf, can, now } = useStore();
  const client = clientOf(ticket.clientId);
  const asset = assetOf(ticket.assetId);
  const reporter = reporterOf(ticket);
  const plan = ticket.plan ?? {};
  const editable = isOpen(ticket) && can('ticket.update');
  const set = (patch: Partial<NonNullable<Ticket['plan']>>) => planTicket(ticket.id, patch);
  const sla = slaOf(ticket);
  const clock = sla.active;
  const running = clock.completedAt == null && isOpen(ticket);
  const sprints = sprintChoices(now);
  const sprintOptions: BadgeOption<string>[] = [
    ...(plan.sprint && !sprints.some((x) => x.code === plan.sprint) ? [{ value: plan.sprint, label: plan.sprint, tone: 'purple' as Tone }] : []),
    ...sprints.map((x) => ({ value: x.code, label: x.code, tone: 'purple' as Tone, description: `${x.when}, ${fmtDate(x.start)} to ${fmtDate(x.end)}` })),
  ];
  const none = <span className="muted">Not set</span>;
  const row = {
    due: running && (
      <Prop icon={Timer} label={`${sla.activeLabel === 'Initial RCA' ? 'Initial RCA' : clockWord(ticket.status, sla)} due`} className="prop-deadline">
        <span className={cx('prop-due', `tone-${SLA_TONE[clock.state]}`)}>
          <strong className="prop-due-left">{clock.due >= now ? `${fmtDuration(clock.due - now)} left` : `${fmtDuration(now - clock.due)} over`}</strong>
          <span className="prop-due-when">
            {clock.due >= now ? 'Due' : 'Was due'} {fmtDateTime(clock.due)}
            {sla.activeLabel === 'Initial RCA' && ' · counts from the report'}
          </span>
        </span>
      </Prop>
    ),
    slaDone: !running && (
      <Prop icon={Timer} label="SLA">
        <span className={cx('prop-sla', `tone-${SLA_TONE[sla.overall]}`)}>{SLA_STATE_LABEL[sla.overall]}</span>
      </Prop>
    ),
    assignee: (
      <Prop icon={User} label="Assigned to" note={notes.assignee}>
        <AssignMenu ticket={ticket} id="assign-trigger" />
      </Prop>
    ),
    tester: (
      <Prop icon={FlaskConical} label="Testing" note={notes.tester}>
        <AssignMenu ticket={ticket} id="tester-trigger" role="tester" />
      </Prop>
    ),
    reporter: (
      <Prop icon={CircleUser} label="Reported by" title={reporter?.title}>
        {reporter ? (
          <span className="prop-link">
            <Avatar name={reporter.name} size={20} />
            <span className="truncate">{reporter.name}</span>
          </span>
        ) : (
          '—'
        )}
      </Prop>
    ),
    priority: (
      <Prop icon={Signal} label="Priority" note={notes.priority}>
        {editable ? (
          <BadgeSelect<Severity> id="prop-priority" label="Priority" value={ticket.severity ?? undefined} options={SEVERITIES.map((v) => ({ value: v, label: SEVERITY_LABEL[v], tone: SEVERITY_TONE[v] }))} onChange={(v) => setSeverity(ticket.id, v)} />
        ) : (
          <SeverityBadge severity={ticket.severity} />
        )}
      </Prop>
    ),
    category: (
      <Prop icon={Tag} label="Category" note={notes.category}>
        {editable ? (
          <span className="prop-edit">
            <Dropdown<Category> id="prop-category" value={ticket.category} placeholder="Choose" options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c].replace(' issue', '') }))} onChange={(c) => setCategory(ticket.id, c)} />
          </span>
        ) : (
          <CategoryLabel category={ticket.category} short />
        )}
      </Prop>
    ),
    client: (
      <Prop icon={Building2} label="Client">
        {client ? (
          <span className="prop-link">
            <ClientLogo client={client} size={20} />
            <span className="truncate">{client.name}</span>
          </span>
        ) : (
          '—'
        )}
      </Prop>
    ),
    asset: (
      <Prop icon={Boxes} label="Asset" title={asset?.name} note={notes.asset}>
        {editable && client ? (
          <span className="prop-edit">
            <Dropdown id="prop-asset" value={ticket.assetId} placeholder="Choose" options={assets.filter((a) => a.clientId === client.id).map((a) => ({ value: a.id, label: a.name }))} onChange={(v) => setAsset(ticket.id, v)} />
          </span>
        ) : (
          (asset?.name ?? '—')
        )}
      </Prop>
    ),
    sprint: (
      <Prop icon={Milestone} label="Sprint plan" note={notes.sprint}>
        {editable ? <BadgeSelect id="plan-sprint" label="Sprint plan" value={plan.sprint} options={sprintOptions} onChange={(v) => set({ sprint: v })} /> : plan.sprint ? <Badge tone="purple">{plan.sprint}</Badge> : none}
      </Prop>
    ),
    taskType: (
      <Prop icon={Layers} label="Task type" note={notes.taskType}>
        {editable ? <BadgeSelect<TaskType> id="plan-type" label="Task type" value={plan.taskType} options={TASK_TYPES.map((x) => ({ value: x, label: TASK_TYPE_LABEL[x], tone: TASK_TONE[x] }))} onChange={(v) => set({ taskType: v })} /> : plan.taskType ? <Badge tone={TASK_TONE[plan.taskType]}>{TASK_TYPE_LABEL[plan.taskType]}</Badge> : none}
      </Prop>
    ),
    points: (
      <Prop icon={Hash} label="Story points" note={notes.points}>
        {editable ? <PointsInput value={plan.storyPoints} onChange={(n) => set({ storyPoints: n })} /> : (plan.storyPoints ?? none)}
      </Prop>
    ),
    // Follows the SLA's fix deadline, so it is read, not set.
    expected: (
      <Prop icon={CalendarCheck} label="Expected done" title="From the SLA for this priority" note={notes.expected}>
        {fmtDateYear(sla.resolution.due)}
      </Prop>
    ),
    created: (
      <Prop icon={CalendarDays} label="Created" title={fmtRelative(ticket.createdAt, now)}>
        {fmtDateTime(ticket.createdAt)}
      </Prop>
    ),
    neededBy: ticket.request?.neededBy && (
      <Prop icon={CalendarClock} label="Needed by">
        {fmtDateYear(ticket.request.neededBy)}
      </Prop>
    ),
  };
  return row;
}

/** The details beside a ticket: its deadline on top, then everyone and everything on it. */
function TicketAside({ ticket }: { ticket: Ticket }) {
  const { clientOf, memberOf } = useStore();
  const row = usePropRows(ticket);
  const pm = memberOf(clientOf(ticket.clientId)?.accountManagerId ?? null);
  // While the PM reviews it, the properties are the page's main content, so here only the who and when.
  const review = ticket.status === 'new';

  if (review)
    return (
      <aside className="ticket-aside" aria-label="Ticket details">
        <dl className="props is-rows is-head">{row.due}</dl>
        <dl className="props is-rows">
          {row.reporter}
          {row.client}
          {pm && (
            <Prop icon={Briefcase} label="PM">
              <span className="prop-link">
                <Avatar name={pm.name} size={20} src={pm.photo} />
                <span className="truncate">{pm.name}</span>
              </span>
            </Prop>
          )}
          {row.created}
          {row.neededBy}
        </dl>
        <SentToClient ticket={ticket} />
      </aside>
    );

  // The deadline (or, once done, how the SLA went) on its own above the rule; one even list below.
  return (
    <aside className="ticket-aside" aria-label="Ticket details">
      <dl className="props is-rows is-head">
        {row.due}
        {row.slaDone}
      </dl>
      <dl className="props is-rows">
        {row.created}
        {row.neededBy}
        {row.reporter}
        {row.client}
        {row.assignee}
        {row.tester}
        {row.priority}
        {row.category}
        {row.asset}
        {row.sprint}
        {row.points}
        {row.taskType}
        {row.expected}
      </dl>
      <SentToClient ticket={ticket} />
    </aside>
  );
}

/** Story points, typed in place: saved when the field loses focus or on Enter. */
function PointsInput({ value, onChange }: { value: number | undefined; onChange: (n: number | undefined) => void }) {
  const [draft, setDraft] = useState(value?.toString() ?? '');
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value?.toString() ?? '');
  }
  const save = () => {
    const n = Number(draft);
    const next = draft.trim() === '' || !Number.isFinite(n) || n <= 0 ? undefined : Math.round(n * 2) / 2;
    setDraft(next?.toString() ?? '');
    if (next !== value) onChange(next);
  };
  return (
    <span className="prop-points">
      <input
        className="prop-input"
        // As wide as what is typed.
        style={{ width: `calc(${Math.max(draft.length, 2)}ch + 14px)` }}
        type="number"
        inputMode="decimal"
        min={0.5}
        step={0.5}
        placeholder="Not set"
        aria-label="Story points"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
    </span>
  );
}

/* ---------- Page ---------- */

export function TicketDetail() {
  const { id } = useParams();
  const { ticketOf } = useStore();
  const ticket = ticketOf(id);
  const navigate = useNavigate();
  // Back always leaves the ticket for the tickets page, in the view last used there.
  const back = () => {
    let to = '/tickets';
    try {
      to = sessionStorage.getItem(TICKETS_VIEW_KEY) ?? to;
    } catch {
      // Storage can be blocked; the list view is the default.
    }
    navigate(to);
  };
  const [asking, setAsking] = useState(false);

  if (!ticket) {
    return (
      <div className="page">
        <Card>
          <Empty title={`Ticket ${id} was not found`} action={<Link to="/tickets" className="btn btn-secondary">Back to tickets</Link>}>
            It may have been created in another session. Ticket data in this preview resets when the browser session ends.
          </Empty>
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      <Card className="ticket-card tdl">
        <header className="tdl-head">
          <button type="button" className="back-btn" aria-label="Back to tickets" onClick={back}>
            <ArrowLeft size={20} aria-hidden />
          </button>
          <div className="tdl-head-text">
            <span className="ticket-id">{ticket.id}</span>
            <h1 className="tdl-title">{ticket.title}</h1>
          </div>
          <StatusActions ticket={ticket} />
        </header>
        <StageSteps ticket={ticket} />

        <div className="ticket-body">
          <div className="ticket-main">
            <TicketContent ticket={ticket} onAsk={() => setAsking(true)} />
          </div>
          <TicketAside ticket={ticket} />
        </div>
      </Card>
      {asking && <AskAiDrawer ticket={ticket} onClose={() => setAsking(false)} />}
    </div>
  );
}


