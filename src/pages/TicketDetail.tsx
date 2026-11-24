import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Sparkles, ShieldOff, ArrowLeft, ArrowRight, ArrowUp, Ban, CornerUpLeft, OctagonAlert, Timer, Check, ChevronDown, CircleCheck, CircleX, Lock, Plus, Send, ShieldCheck, UserPlus, Stethoscope, FileSearch, MessageSquare, RotateCcw, PenLine, History, X, User, FlaskConical, CircleUser, Signal, Tag, Building2, Boxes, Milestone, Layers, Hash, CalendarCheck, CalendarClock, CalendarDays, Activity as ActivityIcon } from 'lucide-react';
import type { Activity, Attachment, Category, Severity, TaskType, Ticket, TicketStatus } from '../types';
import { CATEGORIES, CATEGORY_LABEL, SEVERITIES, SEVERITY_LABEL, NEXT_STAGE, STATUS_LABEL, TASK_TYPES, TASK_TYPE_LABEL, TRANSITIONS, isOpen, isRework, moveLabel, sprintChoices } from '../lib/domain';
import { fmtDate, fmtDateTime, fmtDateYear, fmtDuration, fmtRelative, fmtTime } from '../lib/format';
import { SLA_STATE_LABEL, type SlaClock } from '../lib/sla';
import { useStore } from '../store';
import { CategoryLabel, ClientLogo, SEVERITY_TONE, SLA_TONE, STATUS_ICON, STATUS_TONE, SeverityBadge, clockWord } from '../components/domain';
import { Avatar, Badge, Button, Card, Empty, Field, TextArea, cx, usePopover, type Tone } from '../components/ui';
import { analyze, answer, STARTERS, type Analysis } from '../lib/rcaAi';
import { stepStaffLine } from '../lib/assist';
import { BadgeSelect, Dropdown, type BadgeOption } from '../components/pickers';
import { AssignMenu } from '../components/AssignMenu';
import { Attachments, Prop, RequestNotes } from '../components/detail';
import { TICKETS_VIEW_KEY } from '../components/Layout';
import { CommentBox, withMentions } from '../components/comments';


/* ---------- Status: where the ticket is, and the move to make ---------- */

const STATUS_BY_LABEL = Object.fromEntries(Object.entries(STATUS_LABEL).map(([k, v]) => [v, k])) as Record<string, TicketStatus>;

/** The main button: one step along the linear path. Blocked asks where the
 *  work carries on; Deployed has none, the client answers. */
const NEXT_LABEL: Partial<Record<TicketStatus, string>> = {
  in_progress: 'Send to testing',
  waiting_testing: 'Start testing',
  on_testing: 'Ready to deploy',
};

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
  const { memberOf, changeStatus, confirmTriage, sendInitialResponse, setDialog, can } = useStore();
  const menu = usePopover();
  const status = ticket.status;
  const next = NEXT_STAGE[status];
  const blocked = status === 'blocked';
  const member = memberOf(ticket.assigneeId);
  const editable = can('ticket.update');
  const moves = TRANSITIONS[status]
    .filter((s) => s !== 'canceled' || can('ticket.cancel'))
    .sort((a, b) => Number(b === next) - Number(a === next));
  const move = (to: TicketStatus) => {
    menu.setOpen(false);
    if (to === 'resolved') setDialog({ type: 'resolve', ticketId: ticket.id });
    // Out of New is always QA confirming the AI's read: the RCA goes out with it.
    else if (status === 'new' && to === 'in_progress') confirmTriage(ticket.id);
    else changeStatus(ticket.id, to);
  };
  // In New the SLA asks for the reply first (T+1), then the initial RCA, which confirming sends (T+3).
  const replyFirst = status === 'new' && !ticket.initialResponse;
  const primaryLabel = blocked
    ? 'Unblock'
    : replyFirst
      ? 'Send initial response'
      : status === 'new'
      ? `Send RCA and assign to ${member?.name.split(' ')[0] ?? 'the team'}`
      : next
        ? NEXT_LABEL[status] ?? `Move to ${STATUS_LABEL[next]}`
        : '';
  const onPrimary = () => (blocked ? setDialog({ type: 'unblock', ticketId: ticket.id }) : replyFirst ? sendInitialResponse(ticket.id) : next && move(next));
  const Icon = STATUS_ICON[status];

  return (
    <div className="tdl-actions">
      <div className="popover-anchor" ref={menu.ref}>
        <button
          type="button"
          className={cx('tdl-status', `tone-${STATUS_TONE[status]}`)}
          aria-haspopup="menu"
          aria-expanded={menu.open}
          disabled={!editable || moves.length === 0}
          onClick={() => menu.setOpen(!menu.open)}
        >
          <Icon size={15} aria-hidden />
          {STATUS_LABEL[status]}
          {editable && moves.length > 0 && <ChevronDown size={15} aria-hidden className="tdl-status-caret" />}
        </button>
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
                        {status === 'new' && to === 'in_progress' ? label.title : STATUS_LABEL[to]}
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
      {/* The next step's button lives with the step itself, below; only Unblock stays up here. */}
      {editable && blocked && (
        <Button variant="primary" onClick={onPrimary}>
          {primaryLabel}
          <ArrowRight size={15} aria-hidden />
        </Button>
      )}
    </div>
  );
}

/** The stages in order, as one thin line: done, now, still to come. Blocked sits on In progress. */
const PATH: TicketStatus[] = ['new', 'in_progress', 'waiting_testing', 'on_testing', 'ready_to_deploy', 'resolved'];
const PATH_INDEX: Record<TicketStatus, number> = { new: 0, not_started: 1, in_progress: 1, blocked: 1, waiting_testing: 2, on_testing: 3, ready_to_deploy: 4, resolved: 5, canceled: -1 };

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
  const { assetOf, tickets, actorName, now } = useStore();
  const assetName = assetOf(ticket.assetId)?.name ?? 'the asset';
  // Made once from the client's brief, the asset and earlier tickets, as if on arrival.
  const analysis = useMemo(() => analyze(ticket, assetName, tickets), [ticket.id, assetName, tickets.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tab, setTab] = useState<'rca' | 'comments' | 'activity'>('rca');
  const history = useMemo(() => [...ticket.activity].reverse(), [ticket.activity]);
  const tabs = [
    { key: 'rca' as const, label: 'Sent to client', icon: FileSearch },
    { key: 'comments' as const, label: 'Comments', icon: MessageSquare, count: ticket.comments.length },
    { key: 'activity' as const, label: 'Activity', icon: History, count: history.length },
  ];
  return (
    <>
      <NextStep ticket={ticket} analysis={analysis} onAsk={onAsk} />
      <section className="main-block tdl-brief" aria-label="Client brief">
        <StageBanner ticket={ticket} />
        <p className="description">{ticket.description}</p>
        <RequestNotes request={ticket.request} />
        <Attachments files={ticket.attachments} />
      </section>
      <section className="main-block" aria-label="RCA, comments and activity">
        <div className="doc-tabs" role="tablist" aria-label="RCA, comments and activity">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={cx('doc-tab', tab === t.key && 'is-active')} onClick={() => setTab(t.key)}>
              <t.icon size={16} aria-hidden />
              {t.label}
              {t.count != null && <span className="doc-tab-count">{t.count}</span>}
            </button>
          ))}
        </div>
        <div className="ticket-panel" role="tabpanel">
          {tab === 'rca' && (
            <div className="tdl-rca">
              {/* What the SLA asks NXS to send, in the order it falls due: the reply (T+1),
                  the initial RCA (T+3), and the resolution notes with the fix. */}
              {/* What went to the client, in order. Drafts live in the next step above, not here. */}
              {!ticket.initialResponse && <p className="comments-empty">Nothing has gone to the client yet. Your next step is above.</p>}
              {ticket.initialResponse && <InitialResponse ticket={ticket} />}
              {ticket.diagnosis && <InitialRca ticket={ticket} analysis={analysis} />}
              <ResolutionBlock ticket={ticket} />
            </div>
          )}
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

/** The initial response (T+1): the AI's reply, ready when the ticket arrives; QA checks it and sends it. */
function InitialResponse({ ticket }: { ticket: Ticket }) {
  const { slaOf, responseDraftFor, saveResponseDraft, sendInitialResponse, can } = useStore();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const sent = ticket.initialResponse;
  const canSend = !sent && ticket.status !== 'canceled' && can('ticket.update');
  const shown = sent?.text ?? responseDraftFor(ticket);
  const error = text.trim().length < 20 ? 'Write the reply to the client.' : '';
  return (
    <div className="rca-block" role="group" aria-labelledby="rca-response">
      <header className="rca-head">
        <div>
          <h3 id="rca-response" className="rca-title">
            Initial response
            {!sent && <Badge tone="purple">AI draft</Badge>}
          </h3>
          <p className="rca-sub">
            <DueLine clock={slaOf(ticket).firstResponse} sentAt={sent?.at} />
          </p>
        </div>
        {canSend && !editing && (
          <div className="rca-head-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setText(shown);
                setEditing(true);
              }}
            >
              <PenLine size={15} aria-hidden />
              Edit
            </Button>
            <Button variant="primary" size="sm" onClick={() => sendInitialResponse(ticket.id)}>
              <Send size={15} aria-hidden />
              Send
            </Button>
          </div>
        )}
      </header>
      {editing ? (
        <form
          className="form-stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (error) return;
            saveResponseDraft(ticket.id, text);
            setEditing(false);
          }}
        >
          <Field label="Reply to the client" htmlFor="resp-text" error={error}>
            <TextArea id="resp-text" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="rca-actions">
            <span />
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
        <p className="rca-response-text">{shown}</p>
      )}
    </div>
  );
}

/** The resolution notes as they went to the client with the fix: what was done, the proof, and the deploy. */
function ResolutionBlock({ ticket }: { ticket: Ticket }) {
  const { slaOf, actorName } = useStore();
  const sent = ticket.handoffs[ticket.handoffs.length - 1];
  const deployed = ticket.status === 'resolved' ? [...ticket.activity].reverse().find((a) => a.kind === 'resolution') : undefined;
  if (!sent) return null;
  return (
    <div className="rca-block" role="group" aria-labelledby="rca-resolution">
      <header className="rca-head">
        <div>
          <h3 id="rca-resolution" className="rca-title">
            Resolution notes
          </h3>
          <p className="rca-sub">
            <DueLine clock={slaOf(ticket).resolution} sentAt={sent.at} sentLabel={`Sent with the fix by ${actorName(sent.by)},`} />
          </p>
        </div>
      </header>
      {sent.note && <p className="rca-response-text">{sent.note}</p>}
      <Attachments files={sent.attachments} />
      {deployed && <p className="rca-sub">Deployed by {actorName(deployed.actor)}, {fmtDateTime(deployed.at)}</p>}
    </div>
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
      <Sparkles size={16} aria-hidden className="ns-working-icon" />
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

function NextStep({ ticket, analysis, onAsk }: { ticket: Ticket; analysis: Analysis; onAsk: () => void }) {
  const { slaOf, assetOf, reporterOf, memberOf, currentUser, responseDraftFor, saveResponseDraft, sendInitialResponse, setSeverity, confirmTriage, changeStatus, setDialog, planTicket, can, now } = useStore();
  const [reply, setReply] = useState<string | null>(null);
  const sla = slaOf(ticket);
  const status = ticket.status;
  const replied = !!ticket.initialResponse;
  const asset = assetOf(ticket.assetId);
  const reporter = reporterOf(ticket);
  const dev = memberOf(ticket.assigneeId);
  const tester = memberOf(ticket.testerId);
  const step = status === 'new' ? (replied ? 'rca' : 'reply') : status;
  const analysing = useAiWork(`read:${ticket.id}`, 2400, step === 'reply');
  const drafting = useAiWork(`rca:${ticket.id}`, 1800, step === 'rca');
  if (status === 'resolved' || status === 'canceled' || !can('ticket.update')) return null;
  const plan = ticket.plan ?? {};
  const mine = (id: string | null) => id === currentUser.id;
  const fixDue = `Fix due ${fmtDateTime(sla.resolution.due)}`;
  const every = ticket.severity === 'critical' ? 'every hour' : ticket.severity === 'medium' ? 'every 4 hours' : 'when it is fixed';

  // Where the two New steps stand, ticked as they go.
  const newSteps = step === 'reply' || step === 'rca' ? (
    <ol className="ns-progress" aria-label="Steps while New">
      <li className={cx(replied ? 'is-done' : 'is-now')}>
        {replied ? <Check size={13} aria-hidden /> : <span>1</span>}
        Initial response
        {replied && <em>sent {fmtTime(ticket.initialResponse!.at)}{ticket.initialResponse!.at <= sla.firstResponse.due ? ', on time' : ''}</em>}
      </li>
      <li className={cx(replied ? 'is-now' : 'is-later')}>
        <span>2</span>
        Initial RCA and assign
      </li>
    </ol>
  ) : null;

  let title = '';
  let due: ReactNode = null;
  let body: ReactNode = null;
  let actions: ReactNode = null;

  if (step === 'reply') {
    title = 'Send the initial response';
    due = <DueLine clock={sla.firstResponse} />;
    const text = reply ?? responseDraftFor(ticket);
    body = !analysing.done ? (
      <AiWorking lines={[`Reading ${reporter?.name.split(' ')[0] ?? 'the client'}’s report`, `Checking ${asset?.name ?? 'the asset'} and earlier tickets`, 'Drafting your reply']} line={analysing.line} />
    ) : (
      <div className="ns-fade">
        <div className="ns-found">
          <p className="ns-label">
            <Sparkles size={14} aria-hidden /> What the AI found
          </p>
          <p className="ns-text">{analysis.problem}</p>
          <div className="ns-facts">
            <span className="muted">Priority</span>
            <BadgeSelect<Severity> id="ns-priority" label="Priority" value={ticket.severity ?? undefined} options={SEVERITIES.map((v) => ({ value: v, label: SEVERITY_LABEL[v], tone: SEVERITY_TONE[v] }))} onChange={(v) => setSeverity(ticket.id, v)} />
            <span className="muted">{reply === null ? 'The reply below tells the client this. Change it and the reply follows.' : 'The reply below tells the client this.'}</span>
          </div>
        </div>
        <label className="ns-label" htmlFor="ns-reply">
          Your reply to {reporter?.name.split(' ')[0] ?? 'the client'}
        </label>
        <TextArea
          id="ns-reply"
          rows={5}
          value={text}
          onChange={(e) => setReply(e.target.value)}
          onBlur={() => reply != null && saveResponseDraft(ticket.id, reply)}
        />
      </div>
    );
    actions = analysing.done && (
      <>
        <Button variant="secondary" onClick={onAsk}>
          <MessageSquare size={15} aria-hidden />
          Ask AI about this report
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            if (reply != null) saveResponseDraft(ticket.id, reply);
            sendInitialResponse(ticket.id);
            setReply(null);
          }}
        >
          <Send size={15} aria-hidden />
          Send initial response
        </Button>
      </>
    );
  } else if (step === 'rca') {
    title = 'Send the initial RCA and assign';
    due = <DueLine clock={sla.initialRca} />;
    body = !drafting.done ? (
      <AiWorking lines={['Reading the report and your reply', 'Finding the likely cause', 'Drafting the RCA']} line={drafting.line} />
    ) : (
      <div className="ns-fade">
        <InitialRca ticket={ticket} analysis={analysis} embedded />
        <div className="ns-facts ns-assign">
          <span className="muted">Goes to</span>
          <AssignMenu ticket={ticket} id="ns-assign" />
          <span className="muted">as</span>
          <BadgeSelect<TaskType> id="ns-task" label="Task type" value={plan.taskType} options={TASK_TYPES.map((x) => ({ value: x, label: TASK_TYPE_LABEL[x], tone: TASK_TONE[x] }))} onChange={(v) => planTicket(ticket.id, { taskType: v })} />
        </div>
      </div>
    );
    actions = drafting.done && (
      <>
        <Button variant="secondary" onClick={onAsk}>
          <MessageSquare size={15} aria-hidden />
          Ask AI about the cause
        </Button>
        <Button variant="primary" onClick={() => confirmTriage(ticket.id)}>
          <Send size={15} aria-hidden />
          Send RCA and assign {dev?.name.split(' ')[0] ?? ''}
        </Button>
      </>
    );
  } else if (step === 'in_progress') {
    title = mine(ticket.assigneeId) ? 'Fix it and send it to testing' : `With ${dev?.name.split(' ')[0] ?? 'the team'} now`;
    due = <span className="rca-due">{fixDue}</span>;
    body = (
      <p className="ns-text">
        {mine(ticket.assigneeId) ? 'The cause and the fix are in the RCA below.' : `Nothing for you until the fix reaches testing.`} The client hears from us {every} while it’s being fixed; the AI sends those updates.
      </p>
    );
    actions = mine(ticket.assigneeId) && (
      <Button variant="primary" onClick={() => changeStatus(ticket.id, 'waiting_testing')}>
        Send to testing
        <ArrowRight size={15} aria-hidden />
      </Button>
    );
  } else if (step === 'blocked') {
    title = 'Blocked';
    body = <p className="ns-text">The reason is above. Once it’s cleared, unblock it and the work carries on.</p>;
    actions = (
      <Button variant="primary" onClick={() => setDialog({ type: 'unblock', ticketId: ticket.id })}>
        Unblock
      </Button>
    );
  } else if (step === 'waiting_testing') {
    title = mine(ticket.testerId) ? 'Start testing the fix' : `Waiting for ${tester?.name.split(' ')[0] ?? 'QA'} to test it`;
    due = <DueLine clock={sla.resolution} />;
    body = <p className="ns-text">{dev?.name.split(' ')[0] ?? 'The developer'} has finished the fix. The client has been told it is in testing.</p>;
    actions = mine(ticket.testerId) && (
      <Button variant="primary" onClick={() => changeStatus(ticket.id, 'on_testing')}>
        Start testing
        <ArrowRight size={15} aria-hidden />
      </Button>
    );
  } else if (step === 'on_testing') {
    title = 'Test the fix, then send it to deploy';
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
      <>
        <Button variant="secondary" onClick={() => changeStatus(ticket.id, 'in_progress')}>
          Send back to {dev?.name.split(' ')[0] ?? 'the developer'}
        </Button>
        <Button variant="primary" onClick={() => changeStatus(ticket.id, 'ready_to_deploy')}>
          Passed: send to deploy
          <ArrowRight size={15} aria-hidden />
        </Button>
      </>
    );
  } else if (step === 'ready_to_deploy') {
    const sent = ticket.handoffs[ticket.handoffs.length - 1];
    title = `Waiting for ${reporter?.name.split(' ')[0] ?? 'the client'} to deploy`;
    body = <p className="ns-text">The fix and its resolution notes went to the client{sent ? ` ${fmtRelative(sent.at, now).toLowerCase()}` : ''}. Nothing to do until they deploy it or reply.</p>;
  }

  return (
    <section className={cx('ns', `is-${step}`)} aria-labelledby="ns-title" key={step}>
      {newSteps}
      <header className="ns-head">
        <div>
          <p className="ns-kicker">{actions ? 'Your next step' : 'Now'}</p>
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

function InitialRca({ ticket, analysis, onAsk, embedded }: { ticket: Ticket; analysis: Analysis; onAsk?: () => void; embedded?: boolean }) {
  const { saveInitialRca, saveRcaDraft, slaOf, can } = useStore();
  const shared = ticket.diagnosis;
  const draft = ticket.rcaDraft ?? analysis;
  const shown = shared ?? draft;
  const shownProblem = shown.problem ?? analysis.problem;
  // Only QA edits it, while checking the AI's read in New. Once confirmed it is what the client was sent:
  // later findings go in the comments, not back into this.
  const canEdit = ticket.status === 'new' && can('ticket.update');
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState('');
  const [issue, setIssue] = useState('');
  const [fix, setFix] = useState('');
  const [hours, setHours] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const critical = ticket.severity === 'critical';
  const sla = slaOf(ticket);
  const open = () => {
    setProblem(shownProblem);
    setIssue(shown.issue);
    setFix(shown.fix);
    setHours(String(shared?.fixBy ? Math.round((shared.fixBy - ticket.createdAt) / HOUR_MS) : (ticket.rcaDraft?.hours ?? analysis.hours)));
    setSubmitted(false);
    setEditing(true);
  };
  const errors = {
    problem: problem.trim().length < 10 ? 'Say what the issue is.' : '',
    issue: issue.trim().length < 10 ? 'Say what is causing it.' : '',
    fix: fix.trim().length < 10 ? 'Say how it will be fixed.' : '',
    hours: critical && !(Number(hours) > 0) ? 'Set the hours to fix.' : '',
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (errors.problem || errors.issue || errors.fix || errors.hours) return;
    const h = critical ? Number(hours) : undefined;
    if (shared) saveInitialRca(ticket.id, { problem, issue, fix, fixBy: h ? ticket.createdAt + h * HOUR_MS : shared.fixBy });
    else saveRcaDraft(ticket.id, { problem, issue, fix, hours: h });
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
  const draftHours = !shared && critical ? (ticket.rcaDraft?.hours ?? analysis.hours) : null;
  const fixDue = draftHours ? ticket.createdAt + draftHours * HOUR_MS : sla.resolution.due;
  const shownFix = {
    within: `Within ${span(fixDue - ticket.createdAt)}`,
    note: `${priority}${critical ? ', set in this RCA' : ''}, by ${fmtDateYear(fixDue)}`,
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
        <div>
          <h3 id="rca-initial" className={cx('rca-title', embedded && 'sr-only')}>
            Initial RCA
            {!shared && <Badge tone="purple">AI draft</Badge>}
          </h3>
          {embedded && (
            <p className="ns-label">
              <Sparkles size={14} aria-hidden /> Drafted by AI from the report. Check the cause before you send it.
            </p>
          )}
          <p className={cx('rca-sub', embedded && 'sr-only')}>
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
          {critical ? (
            <Field label="Time to fix, in hours" htmlFor="rca-hours" hint="For P1 the fix deadline comes from this analysis." error={submitted ? errors.hours : ''}>
              <input id="rca-hours" className="input rca-hours" type="number" min={1} step={1} value={hours} onChange={(e) => setHours(e.target.value)} />
            </Field>
          ) : (
            <p className="fix-preview">Time to fix follows the priority in the ticket’s properties.</p>
          )}
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
        <dl className="rca-fields">
          <div>
            <dt>Issue</dt>
            <dd>{shownProblem}</dd>
          </div>
          <div>
            <dt>Cause</dt>
            <dd>{shown.issue}</dd>
          </div>
          <div>
            <dt>How it will be fixed</dt>
            <dd>{shown.fix}</dd>
          </div>
          <div>
            <dt>Time to fix</dt>
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
  const list = ticket.comments.filter((c) => c.thread === thread);
  // Who can be mentioned: the team on the internal thread, the client's own people on the client thread.
  const people = thread === 'internal' ? team.map((m) => ({ id: m.id, name: m.name, title: m.title, photo: m.photo })) : (clientOf(ticket.clientId)?.users ?? []).map((u) => ({ id: u.id, name: u.name, title: u.title, photo: undefined }));
  const send = () => {
    if (!text.trim()) return;
    addComment(ticket.id, thread, text);
    setText('');
  };
  const count = (t: 'client' | 'internal') => ticket.comments.filter((c) => c.thread === t).length;
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
          ? 'Shared with the client. Their team reads it in the Client Portal and can reply here.'
          : 'Only the NXS team sees this thread. Nothing here reaches the client.'}
      </p>

      {list.length > 0 ? (
        <ol className="comment-list">
          {list.map((c) => {
            const name = actorName(c.by);
            return (
              <li key={c.id} className="comment">
                <Avatar name={name} size={28} src={c.by.type === 'team' ? memberOf(c.by.id)?.photo : undefined} />
                <div className="comment-body">
                  <p className="comment-meta">
                    <span className="comment-name">{name}</span>
                    <time title={fmtDateTime(c.at)}>{fmtRelative(c.at, now)}</time>
                  </p>
                  <p className="comment-text">{withMentions(c.text, people.map((x) => x.name))}</p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="comments-empty">No comments yet.</p>
      )}

      <CommentBox
        key={thread}
        value={text}
        onChange={setText}
        onSend={send}
        people={people}
        label={thread === 'client' ? 'Comment to the client' : 'Internal comment'}
        placeholder={thread === 'client' ? 'Write to the client… Type @ to mention someone.' : 'Write a note for the team… Type @ to mention someone.'}
      />
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
function TicketAside({ ticket }: { ticket: Ticket }) {
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
  // While QA reviews a new ticket, what the AI filled in is grouped at the top.
  const review = ticket.status === 'new';
  const row = {
    due: running && (
      <Prop icon={Timer} label={`${clockWord(ticket.status, sla)} due`}>
        <span className={cx('prop-due', `tone-${SLA_TONE[clock.state]}`)}>
          <span className="prop-due-main">
            <strong>{clock.due >= now ? `${fmtDuration(clock.due - now)} left` : `${fmtDuration(now - clock.due)} over`}</strong>
          </span>
          <span className="prop-meta">{clock.due >= now ? 'By' : 'Was due'} {fmtDateTime(clock.due)}</span>
        </span>
      </Prop>
    ),
    slaDone: !running && (
      <Prop icon={Timer} label="SLA">
        <span className={cx('prop-sla', `tone-${SLA_TONE[sla.overall]}`)}>{SLA_STATE_LABEL[sla.overall]}</span>
      </Prop>
    ),
    assignee: (
      <Prop icon={User} label="Assigned to">
        <AssignMenu ticket={ticket} id="assign-trigger" />
      </Prop>
    ),
    tester: (
      <Prop icon={FlaskConical} label="Testing">
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
      <Prop icon={Signal} label="Priority">
        {editable ? (
          <BadgeSelect<Severity> id="prop-priority" label="Priority" value={ticket.severity ?? undefined} options={SEVERITIES.map((v) => ({ value: v, label: SEVERITY_LABEL[v], tone: SEVERITY_TONE[v] }))} onChange={(v) => setSeverity(ticket.id, v)} />
        ) : (
          <SeverityBadge severity={ticket.severity} />
        )}
      </Prop>
    ),
    category: (
      <Prop icon={Tag} label="Category">
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
      <Prop icon={Boxes} label="Asset" title={asset?.name}>
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
      <Prop icon={Milestone} label="Sprint plan">
        {editable ? <BadgeSelect id="plan-sprint" label="Sprint plan" value={plan.sprint} options={sprintOptions} onChange={(v) => set({ sprint: v })} /> : plan.sprint ? <Badge tone="purple">{plan.sprint}</Badge> : none}
      </Prop>
    ),
    taskType: (
      <Prop icon={Layers} label="Task type">
        {editable ? <BadgeSelect<TaskType> id="plan-type" label="Task type" value={plan.taskType} options={TASK_TYPES.map((x) => ({ value: x, label: TASK_TYPE_LABEL[x], tone: TASK_TONE[x] }))} onChange={(v) => set({ taskType: v })} /> : plan.taskType ? <Badge tone={TASK_TONE[plan.taskType]}>{TASK_TYPE_LABEL[plan.taskType]}</Badge> : none}
      </Prop>
    ),
    points: (
      <Prop icon={Hash} label="Story points">
        {editable ? <PointsInput value={plan.storyPoints} onChange={(n) => set({ storyPoints: n })} /> : (plan.storyPoints ?? none)}
      </Prop>
    ),
    // Follows the SLA's fix deadline, so it is read, not set.
    expected: (
      <Prop icon={CalendarCheck} label="Expected done" title="From the SLA for this priority">
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

  if (review)
    return (
      <aside className="ticket-aside" aria-label="Ticket details">
        <dl className="props is-rows is-head">{row.due}</dl>
        <dl className="props is-rows">
          {row.created}
          {row.neededBy}
          {row.reporter}
          {row.client}
          {row.tester}
          {row.expected}
        </dl>
        <section className="ai-group" aria-labelledby="ai-group-title">
          <p className="ai-group-head" id="ai-group-title">
            <strong>Suggested by AI</strong> Check before you confirm.
          </p>
          <dl className="props is-rows">
            {row.asset}
            {row.category}
            {row.priority}
            {row.assignee}
            {row.sprint}
            {row.points}
            {row.taskType}
          </dl>
        </section>
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


