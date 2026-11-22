import { Fragment, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, Ban, CornerUpLeft, Hourglass, OctagonAlert, Boxes, Building2, CalendarDays, CircleUser, Signal, Tag, Timer, User, Check, ChevronDown, CircleCheck, CircleX, FileText, History, Lock, Plus, Send, ShieldCheck, UserPlus, ClipboardList, CalendarClock, UserRound, Stethoscope, Activity as ActivityIcon } from 'lucide-react';
import type { Activity, Attachment, Ticket, TicketStatus } from '../types';
import { CHANNEL_LABEL, NEXT_STAGE, REQUEST_TYPE_LABEL, STATUS_LABEL, TRANSITIONS, isOpen, isRework, moveLabel } from '../lib/domain';
import { fmtDateTime, fmtDateYear, fmtDuration, fmtRelative } from '../lib/format';
import { SLA_STATE_LABEL } from '../lib/sla';
import { useStore } from '../store';
import { CategoryLabel, ClientLogo, SLA_TONE, STATUS_ICON, STATUS_TONE, SeverityBadge, slaText } from '../components/domain';
import { Button, Card, Empty, cx, usePopover } from '../components/ui';
import { AssignMenu } from '../components/AssignMenu';
import { Attachments, BackHeader, Prop, RequestNotes } from '../components/detail';


/* ---------- Stage: where the ticket is, and the move to make ---------- */

/** The linear path. Reopened and Blocker are detours that sit on the
 *  In progress step. Canceled leaves the path altogether. */
const PATH: TicketStatus[] = ['new', 'in_progress', 'waiting_testing', 'on_testing', 'waiting_approval', 'resolved'];
const PATH_INDEX: Record<TicketStatus, number> = { new: 0, reopened: 1, in_progress: 1, blocked: 1, waiting_testing: 2, on_testing: 3, waiting_approval: 4, resolved: 5, canceled: -1 };
const STATUS_BY_LABEL = Object.fromEntries(Object.entries(STATUS_LABEL).map(([k, v]) => [v, k])) as Record<string, TicketStatus>;

/** The main button: one step along the linear path. Blocker asks where the
 *  work carries on; Waiting for approval has none, the client answers. */
const NEXT_LABEL: Partial<Record<TicketStatus, string>> = {
  new: 'Start work',
  reopened: 'Resume work',
  in_progress: 'Send to testing',
  waiting_testing: 'Start testing',
  on_testing: 'Send for approval',
};

/** The heading of the note under the stages: what to do, or what we wait for. */
const NOTE_TITLE: Record<TicketStatus, string> = {
  new: 'Next step',
  reopened: 'The client declined the fix',
  in_progress: 'Next step',
  blocked: 'Blocker',
  waiting_testing: 'Next step',
  on_testing: 'Next step',
  waiting_approval: 'Done on our side, waiting for the client',
  resolved: 'Approved by the client',
  canceled: 'Canceled',
};
const NOTE_ICON: Record<TicketStatus, typeof Check> = {
  new: ArrowRight,
  reopened: CircleX,
  in_progress: ArrowRight,
  blocked: OctagonAlert,
  waiting_testing: ArrowRight,
  on_testing: ArrowRight,
  waiting_approval: Hourglass,
  resolved: CircleCheck,
  canceled: Ban,
};

/** When the ticket last entered each stage, read from its activity. */
function stageEntries(t: Ticket) {
  const out: Partial<Record<TicketStatus, Activity>> = {};
  for (const a of t.activity) {
    let to: TicketStatus | undefined;
    if (a.kind === 'created') to = 'new';
    else if (a.kind === 'resolution') to = 'resolved';
    else if (a.kind === 'cancellation') to = 'canceled';
    else if (a.kind === 'status') to = STATUS_BY_LABEL[a.text.match(/ to ([^.]+)/)?.[1] ?? ''];
    if (to) out[to] = a;
  }
  return out;
}

function StageBlock({ ticket }: { ticket: Ticket }) {
  const { memberOf, reporterOf, actorName, changeStatus, setDialog, can, now } = useStore();
  const menu = usePopover();
  const entries = useMemo(() => stageEntries(ticket), [ticket]);
  const status = ticket.status;
  const at = PATH_INDEX[status];
  const done = status === 'resolved' || status === 'canceled';
  const since = entries[status];
  const member = memberOf(ticket.assigneeId);
  const reporter = reporterOf(ticket);
  const Icon = STATUS_ICON[status];

  const next = NEXT_STAGE[status];
  const blocked = status === 'blocked';
  // Button one walks the linear path, one step forward at a time. Button two
  // lists every move this stage allows, the next step first and marked, then
  // the moves off the path (rework, Blocker, resolve without approval, cancel,
  // reopen), each of which asks why, so nothing moves without a trace.
  const moves = TRANSITIONS[status]
    .filter((s) => s !== 'canceled' || can('ticket.cancel'))
    .sort((a, b) => Number(b === next) - Number(a === next));
  const move = (to: TicketStatus) => {
    menu.setOpen(false);
    if (to === 'resolved') setDialog({ type: 'resolve', ticketId: ticket.id });
    else changeStatus(ticket.id, to);
  };
  const primaryLabel = blocked ? 'Unblock' : next === 'in_progress' && !ticket.assigneeId ? 'Assign' : next ? NEXT_LABEL[status] ?? `Move to ${STATUS_LABEL[next]}` : '';
  const onPrimary = () => (blocked ? setDialog({ type: 'unblock', ticketId: ticket.id }) : next && move(next));

  const declined = [...ticket.feedback].reverse().find((f) => f.decision === 'declined');
  const blocker = blocked ? ticket.blockers[ticket.blockers.length - 1] : undefined;
  // The reason this stage was entered, when NXS sent the work back or reopened it.
  const lastNote = ticket.moveNotes[ticket.moveNotes.length - 1];
  const moveNote = lastNote && lastNote.to === status && since && lastNote.at >= since.at - 1000 && (!declined || lastNote.at > declined.at) ? lastNote : undefined;
  // A resolve forced from the menu carries its reason in the activity log.
  const resolution = [...ticket.activity].reverse().find((a) => a.kind === 'resolution');
  const skipped = resolution?.text.includes('without client approval') ? resolution : undefined;
  const handoff = status === 'waiting_approval' ? ticket.handoffs[ticket.handoffs.length - 1] : undefined;
  // While work moves, the note carries what was found. Progress updates live in Activity.
  const working = status === 'in_progress' || status === 'waiting_testing' || status === 'on_testing';
  const found = working && !moveNote ? ticket.diagnosis : undefined;
  const noteTitle = status === 'resolved' && skipped ? 'Resolved without client approval' : moveNote ? moveLabel(moveNote.from, moveNote.to).title : handoff ? 'Sent to the client for approval' : found ? 'What’s wrong and the fix' : NOTE_TITLE[status];
  const NoteIcon = moveNote && isRework(moveNote.from, moveNote.to) ? CornerUpLeft : NOTE_ICON[status];
  const who = member?.name ?? 'Support';
  const situation: Record<TicketStatus, string> = {
    new: `Not started yet. ${who} handles this asset, so it went straight to them. Start work when they pick it up, or reassign it from the side.`,
    reopened: moveNote ? 'Reopened by NXS. Resume work to pick it back up.' : 'The fix did not hold. Resume work to pick it back up.',
    in_progress: moveNote ? `${who} picks it back up. Send it to testing again once this is fixed.` : `${who} is working on it. Send it to testing when the fix is ready.`,
    blocked: 'Work is on hold. Unblock it once this clears, back to In progress or straight to testing. The client still sees In progress.',
    waiting_testing: 'The fix is ready and waiting for a tester. Start testing when someone picks it up. The client still sees In progress.',
    on_testing: 'The fix is being tested. If it passes, send it to the client for approval with a note. If it fails, move it back to In progress.',
    waiting_approval: `${reporter?.name ?? 'The client'} is reviewing it in the Client Portal: approving resolves the ticket, declining moves it to Reopened.`,
    resolved: skipped ? `${actorName(skipped.actor)} skipped the approval. ${skipped.text.split('Reason: ')[1] ?? ''}` : `${reporter?.name ?? 'The client'} approved the fix.`,
    canceled: ticket.cancellation ? `${actorName(ticket.cancellation.by)} canceled it on ${fmtDateTime(ticket.cancellation.at)}. ${ticket.cancellation.reason}` : 'This ticket was canceled.',
  };
  // The words that explain the stage, highlighted: why it is blocked, or why the client declined.
  const quote: { text: string; by: string; at: number; files?: Attachment[] } | undefined = blocker
    ? { text: blocker.details, by: actorName(blocker.by), at: blocker.at }
    : handoff
      ? { text: handoff.note, by: actorName(handoff.by), at: handoff.at, files: handoff.attachments }
      : moveNote
      ? { text: moveNote.reason, by: actorName(moveNote.by), at: moveNote.at }
      : status === 'reopened' && declined
      ? { text: declined.note || 'No reason given.', by: reporter?.name ?? 'The client', at: declined.at, files: declined.attachments }
      : undefined;
  const endedAt = status === 'resolved' ? ticket.resolvedAt : status === 'canceled' ? ticket.canceledAt : null;

  return (
    <section className="main-block" aria-labelledby="stage-title">
      <div className="stage-head">
        <span className={cx('stage-chip', `tone-${STATUS_TONE[status]}`)} aria-hidden>
          <Icon size={18} />
        </span>
        <div className="stage-head-text">
          <h2 id="stage-title" className="block-title">
            {STATUS_LABEL[status]}
          </h2>
          <p className="muted">{done ? `${STATUS_LABEL[status]} ${fmtRelative(endedAt ?? ticket.updatedAt, now).toLowerCase()}` : since ? `In this stage for ${fmtDuration(now - since.at)}` : 'Current stage'}</p>
        </div>
        {can('ticket.update') && (primaryLabel || moves.length > 0) && (
          <div className="stage-actions">
            {moves.length > 0 && (
              <div className="popover-anchor" ref={menu.ref}>
                <Button size="sm" aria-expanded={menu.open} aria-haspopup="menu" onClick={() => menu.setOpen(!menu.open)}>
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
            {primaryLabel && (
              <Button variant="primary" size="sm" onClick={onPrimary}>
                {primaryLabel}
                <ArrowRight size={15} aria-hidden />
              </Button>
            )}
          </div>
        )}
      </div>

      {status !== 'canceled' && (
        <ol className="pipeline" aria-label="Ticket stages">
          {PATH.map((step, i) => {
            const passed = i < at || (done && i === at);
            const state = passed ? 'done' : i === at ? 'current' : 'todo';
            const shown: TicketStatus = state === 'current' && !done ? status : step;
            const StepIcon = state === 'done' ? CircleCheck : STATUS_ICON[shown];
            // A todo step can still have been visited before, like testing before a failed test.
            const entry = state === 'current' ? since : entries[step];
            return (
              <li key={step} className={cx('pipeline-step', `is-${state}`, state === 'current' && `tone-${STATUS_TONE[shown]}`)} aria-current={state === 'current' ? 'step' : undefined}>
                <span className="pipeline-name">
                  <StepIcon size={15} aria-hidden />
                  <span className="truncate">{STATUS_LABEL[shown]}</span>
                </span>
                <span className="pipeline-time" title={entry ? `${actorName(entry.actor)}, ${fmtDateTime(entry.at)}` : undefined}>
                  {state === 'todo' ? (entry ? `Earlier, ${fmtDateTime(entry.at)}` : 'Not yet') : entry ? (state === 'current' && !done ? 'Now' : fmtDateTime(entry.at)) : 'Skipped'}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <div className={cx('stage-note', `tone-${STATUS_TONE[status]}`, (quote || found) && 'is-highlight')}>
        <span className="stage-note-icon" aria-hidden>
          <NoteIcon size={16} />
        </span>
        <div className="stage-note-body">
          <p className="stage-note-title">{noteTitle}</p>
          {found && <DiagnosisNote diagnosis={found} />}
          {quote && (
            <blockquote className="stage-quote">
              <p>{quote.text}</p>
              {quote.files && quote.files.length > 0 && <Attachments files={quote.files} />}
              <footer>
                {quote.by}, <time title={fmtDateTime(quote.at)}>{fmtRelative(quote.at, now).toLowerCase()}</time>
              </footer>
            </blockquote>
          )}
          <p className="stage-note-text">{situation[status]}</p>
        </div>
      </div>
    </section>
  );
}

/** What is wrong and how it will be fixed, as sent to the client when work started. */
function DiagnosisNote({ diagnosis }: { diagnosis: { issue: string; fix: string } }) {
  return (
    <dl className="diagnosis">
      <div>
        <dt>What’s wrong</dt>
        <dd>{diagnosis.issue}</dd>
      </div>
      <div>
        <dt>How we’ll fix it</dt>
        <dd>{diagnosis.fix}</dd>
      </div>
    </dl>
  );
}

/* ---------- The client's brief and the ticket's activity ---------- */

/* Activity is a log of updates: stage moves, progress, what was found, what
   blocked it, what went for approval. There are no comments on a ticket. */
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
};

type Tab = 'brief' | 'activity';

const TABS: { key: Tab; label: string; icon: typeof Check }[] = [
  { key: 'brief', label: 'Client brief', icon: FileText },
  { key: 'activity', label: 'Activity', icon: History },
];

/** The headline of one activity line, as staff read it. */
function activityLine(a: Activity) {
  if (a.kind === 'handoff') return 'Sent to the client for approval';
  if (a.kind === 'diagnosis') return 'Shared what’s wrong and how it will be fixed';
  return a.staffText ?? a.text;
}

function TicketTabs({ ticket }: { ticket: Ticket }) {
  const { actorName, now } = useStore();
  const [tab, setTab] = useState<Tab>('brief');
  const history = useMemo(() => [...ticket.activity].reverse(), [ticket.activity]);

  return (
    <section className="main-block is-joined" aria-label="Ticket content">
      <div className="doc-tabs" role="tablist" aria-label="Ticket content">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} aria-controls="ticket-panel" className={cx('doc-tab', tab === t.key && 'is-active')} onClick={() => setTab(t.key)}>
            <t.icon size={16} aria-hidden />
            {t.label}
            {t.key === 'activity' && <span className="doc-tab-count">{history.length}</span>}
          </button>
        ))}
      </div>

      <div id="ticket-panel" className="ticket-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'brief' ? (
          <>
            <p className="description">{ticket.description}</p>
            <RequestNotes request={ticket.request} />
            <Attachments files={ticket.attachments} />
          </>
        ) : (
          <ol className="timeline">
            {history.map((a) => {
              const KindIcon = KIND_ICON[a.kind];
              const found = a.kind === 'diagnosis' ? ticket.diagnosis : undefined;
              const sent = a.kind === 'handoff' ? ticket.handoffs.find((h) => Math.abs(h.at - a.at) < 5000) : undefined;
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
                    {sent && <p className="timeline-quote">{a.text}</p>}
                    {found && <DiagnosisNote diagnosis={found} />}
                    {sent && sent.attachments.length > 0 && <Attachments files={sent.attachments} />}
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
  );
}

/* ---------- Page ---------- */

export function TicketDetail() {
  const { id } = useParams();
  const { ticketOf, clientOf, assetOf, memberOf, reporterOf, slaOf, now } = useStore();
  const ticket = ticketOf(id);

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

  const client = clientOf(ticket.clientId);
  const asset = assetOf(ticket.assetId);
  const reporter = reporterOf(ticket);
  const sla = slaOf(ticket);
  const clock = sla.active;
  const running = clock.completedAt == null && isOpen(ticket);
  const logger = memberOf(ticket.source.loggedBy);

  return (
    <div className="page">
      <BackHeader title="Ticket detail" description="Where the ticket stands, what the client reported, and everything that has happened since." fallback="/tickets" backLabel="Back to tickets" />

      {/* Everything about the ticket lives in one container: its title on
          top, the work on the left, the small facts on the right. */}
      <Card className="ticket-card">
        <header className="ticket-card-head">
          <span className="ticket-id ticket-id-lg">{ticket.id}</span>
          <h2 className="ticket-card-title">{ticket.title}</h2>
        </header>

        <div className="ticket-body">
          <div className="ticket-main">
            <StageBlock ticket={ticket} />
            <TicketTabs ticket={ticket} />
          </div>

          <aside className="ticket-aside" aria-label="Ticket details">
            <dl className="props">
              <Prop icon={Building2} label="Client">
                {client ? (
                  <Link to={`/clients/${client.id}`} className="prop-link">
                    <ClientLogo client={client} size={20} />
                    <span className="truncate">{client.name}</span>
                  </Link>
                ) : (
                  '—'
                )}
              </Prop>
              <Prop icon={Boxes} label="Asset">
                {asset ? (
                  <Link to={`/clients/${asset.clientId}?tab=assets`} className="prop-link">
                    <span className="truncate">{asset.name}</span>
                  </Link>
                ) : (
                  '—'
                )}
              </Prop>
              <Prop icon={CircleUser} label="Reported by" title={reporter?.title}>
                {reporter?.name ?? '—'}
              </Prop>
              <Prop icon={User} label="Assigned to">
                <AssignMenu ticket={ticket} id="assign-trigger" />
              </Prop>
              {/* Severity is the client's call when they raise the ticket. */}
              <Prop icon={Signal} label="Priority">
                <SeverityBadge severity={ticket.severity} />
              </Prop>
              <Prop icon={Timer} label={running ? (sla.activeLabel === 'First response' ? 'Response due' : 'Resolution due') : 'SLA'}>
                {running ? (
                  <>
                    <span className={cx('prop-sla', `tone-${SLA_TONE[clock.state]}`)}>{slaText(clock)}</span>
                    <span className="prop-meta">({fmtDateTime(clock.due)})</span>
                  </>
                ) : (
                  <span className={cx('prop-sla', `tone-${SLA_TONE[sla.overall]}`)}>{SLA_STATE_LABEL[sla.overall]}</span>
                )}
              </Prop>
              <Prop icon={Tag} label="Category">
                <CategoryLabel category={ticket.category} short />
              </Prop>
              {/* What the client asked for, when it came through the portal. */}
              {ticket.request && (
                <>
                  <Prop icon={ClipboardList} label="Request">
                    {REQUEST_TYPE_LABEL[ticket.request.type]}
                  </Prop>
                  <Prop icon={CalendarClock} label="Needed by">
                    {ticket.request.neededBy ? fmtDateYear(ticket.request.neededBy) : <span className="muted">No date given</span>}
                  </Prop>
                  <Prop icon={UserRound} label="Requested by">
                    {ticket.request.requestedBy}
                  </Prop>
                </>
              )}
              <Prop icon={CalendarDays} label="Created" title={fmtRelative(ticket.createdAt, now)}>
                {fmtDateTime(ticket.createdAt)}
                <span className="prop-meta">{ticket.source.channel === 'portal' ? `via ${CHANNEL_LABEL.portal}` : `by ${logger?.name ?? 'NXS'}`}</span>
              </Prop>
            </dl>
          </aside>
        </div>
      </Card>
    </div>
  );
}


