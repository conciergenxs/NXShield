import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUp, Ban, Rocket, Boxes, CalendarCheck, CalendarDays, CircleCheck, CircleUser, Layers, Signal, X } from 'lucide-react';
import type { Ticket, TicketStatus } from '../types';
import { PORTAL_STATUS_LABEL, TASK_TYPE_LABEL, portalStatus } from '../lib/domain';
import { fmtDate, fmtDateTime, fmtDuration, fmtRelative, fmtTime, fmtWeekday } from '../lib/format';
import { useStore } from '../store';
import { Prop } from '../components/detail';
import { STATUS_ICON, STATUS_TONE, SeverityBadge } from '../components/domain';
import { Avatar, Badge, Button, Card, Empty, cx } from '../components/ui';
import { usePortalUser } from './shared';
import { CLIENT_STARTERS, clientAnswer } from './assistant';
import { Timeline } from './Timeline';

/*
 * A ticket from the client's side, in the dashboard's own frame: the header,
 * the stages, then one timeline (what comes next on top, then everything that
 * happened, down to their report), the comments under it, and the details on
 * the right. Everything
 * is signed by NXS, never by a person.
 */

const PATH: TicketStatus[] = ['new', 'in_progress', 'ready_to_deploy', 'resolved'];
const TASK_TONE = { frontend: 'blue', backend: 'green' } as const;

/** When the ticket first reached each step the client sees. */
function reachedAt(t: Ticket, step: TicketStatus): number | undefined {
  if (step === 'new') return t.createdAt;
  // In progress from the moment NXS took it on, not from the AI's first reply.
  if (step === 'in_progress') return t.activity.find((a) => a.kind === 'status' && a.text.startsWith('Status changed from New to'))?.at ?? t.diagnosis?.at;
  if (step === 'ready_to_deploy') return t.handoffs[t.handoffs.length - 1]?.at;
  if (step === 'resolved') return t.resolvedAt ?? undefined;
  return undefined;
}

/** The four steps the client sees, as the dashboard's stage cards. */
function Stages({ ticket }: { ticket: Ticket }) {
  const { now } = useStore();
  const stage = portalStatus(ticket.status);
  if (stage === 'canceled') return null;
  const at = PATH.indexOf(stage);
  const done = stage === 'resolved';
  return (
    <ol className="tdl-stages" aria-label="Ticket stages">
      {PATH.map((step, i) => {
        const state = i < at || (done && i === at) ? 'done' : i === at ? 'current' : 'todo';
        const reached = reachedAt(ticket, step);
        const Icon = state === 'done' ? CircleCheck : STATUS_ICON[step];
        const last = ticket.feedback[ticket.feedback.length - 1];
        const approved = step === 'ready_to_deploy' && last?.decision === 'approved' && last.at >= (reached ?? 0);
        const when = state === 'todo' ? 'Not yet' : state === 'current' ? (step === 'ready_to_deploy' ? (approved ? 'Approved, NXS is deploying' : 'Waiting for you') : reached ? `For ${fmtDuration(now - reached)}` : 'Now') : reached ? fmtDateTime(reached) : '—';
        return (
          <li key={step} className={cx('tdl-stage', `is-${state}`, state === 'current' && `tone-${STATUS_TONE[step]}`)} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="tdl-stage-name">
              <Icon size={15} aria-hidden />
              <span>{PORTAL_STATUS_LABEL[step]}</span>
            </span>
            <span className="tdl-stage-time">{when}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** An estimate in the details: the date in the accent, a rough hour (rounded up to the
 *  half hour) or how it went under it, the way the dashboard shows its deadline. */
function Eta({ ts, note, tone = 'purple' }: { ts?: number; note: string; tone?: string }) {
  return (
    <span className={cx('prop-due', `tone-${tone}`)}>
      <span className="prop-due-main">
        <strong>{ts ? `${fmtWeekday(ts)}, ${fmtDate(ts)}` : 'Taking a little longer'}</strong>
      </span>
      <span className="prop-meta">{note}</span>
    </span>
  );
}
const around = (ts: number) => `Around ${fmtTime(Math.ceil(ts / 1_800_000) * 1_800_000)}`;

/** How the fix landed against its estimate, in a few words. */
function early(at: number, due: number) {
  const days = Math.floor((due - at) / 86_400_000);
  if (at > due) return 'later than estimated';
  return days >= 1 ? `${days} ${days === 1 ? 'day' : 'days'} early` : 'on time';
}


/* ---------- Details ---------- */

function PortalAside({ ticket, userId, onAsk }: { ticket: Ticket; userId: string; onAsk: () => void }) {
  const { slaOf, assetOf, reporterOf, now } = useStore();
  const sla = slaOf(ticket);
  const stage = portalStatus(ticket.status);
  const reporter = reporterOf(ticket);
  const asset = assetOf(ticket.assetId);
  // Until NXS confirms it, the asset and priority are only the AI's guess.
  const confirmed = !!ticket.diagnosis;
  // The next thing NXS owes: the reply, then the analysis, then the fix.
  const replied = !!ticket.firstRespondedAt;
  const clock = stage === 'new' ? (replied ? sla.initialRca : sla.firstResponse) : sla.resolution;
  const running = (stage === 'new' || stage === 'in_progress') && clock.completedAt == null;
  const fixedAt = ticket.handoffs[ticket.handoffs.length - 1]?.at;

  return (
    <aside className="ticket-aside pt-aside" aria-label="Ticket details">
      {(running || fixedAt) && (
        <dl className="props is-rows is-head">
          {/* Like a delivery estimate: when to expect it, not a countdown. NXS keeps the clock. */}
          {running && (
            <Prop icon={CalendarCheck} label={stage === 'new' ? (replied ? 'Analysis expected' : 'Reply expected') : 'Estimated fix'}>
              {clock.due >= now ? <Eta ts={clock.due} note={around(clock.due)} /> : <Eta note="We’re still on it." tone="orange" />}
            </Prop>
          )}
          {!running && fixedAt && (
            <Prop icon={CalendarCheck} label="Fixed on">
              <Eta ts={fixedAt} note={`${early(fixedAt, sla.resolution.due).replace(/^./, (c) => c.toUpperCase())}`} />
            </Prop>
          )}
        </dl>
      )}
      <dl className="props is-rows">
        <Prop icon={CalendarDays} label="Created" title={fmtRelative(ticket.createdAt, now)}>
          {fmtDateTime(ticket.createdAt)}
        </Prop>
        <Prop icon={CircleUser} label="Reported by">
          {reporter ? (
            <span className="prop-link">
              <Avatar name={reporter.name} size={20} />
              <span className="truncate">{reporter.id === userId ? 'You' : reporter.name}</span>
            </span>
          ) : (
            '—'
          )}
        </Prop>
        {/* Asset, priority and task type are set when NXS confirms the report; until then they aren't shown. */}
        {confirmed && (
          <>
            <Prop icon={Boxes} label="Asset" title={asset?.name}>
              {asset?.name ?? '—'}
            </Prop>
            <Prop icon={Signal} label="Priority">
              <SeverityBadge severity={ticket.severity} />
            </Prop>
            <Prop icon={Layers} label="Task type">
              {ticket.plan?.taskType ? <Badge tone={TASK_TONE[ticket.plan.taskType]}>{TASK_TYPE_LABEL[ticket.plan.taskType]}</Badge> : <span className="muted">Not set</span>}
            </Prop>
          </>
        )}
      </dl>
    </aside>
  );
}

/** Ask about the ticket: answers come from its own data, like asking where a delivery is. */
function AskDrawer({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const { slaOf, now } = useStore();
  const [thread, setThread] = useState<{ q: string; a: string }[]>([]);
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [thread.length]);
  const ask = (q: string) => {
    if (!q.trim()) return;
    setThread((t) => [...t, { q: q.trim(), a: clientAnswer(q, ticket, slaOf(ticket), now) }]);
    setText('');
  };
  const unasked = CLIENT_STARTERS.filter((q) => !thread.some((x) => x.q === q));
  return createPortal(
    <div className="drawer-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="pt-ask-title">
        <header className="drawer-head">
          <div>
            <h2 id="pt-ask-title" className="drawer-title">
              Ask AI
            </h2>
            <p className="drawer-sub">About {ticket.id}. Answers come from the RCA and the latest updates.</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </header>
        <div className="ask-ai">
          <div className="ai-scroll" ref={scroller}>
            {thread.length === 0 && (
              <div className="ai-a">
                <span className="ai-mark" aria-hidden>
                  AI
                </span>
                <div className="ai-a-body">
                  <p className="ai-a-text">Hi! Ask me how this ticket is going: when it will be fixed, what’s happening now, or what you need to do.</p>
                </div>
              </div>
            )}
            {thread.map((x, i) => (
              <div key={i} className="ai-exchange">
                <div className="ai-q">
                  <p>{x.q}</p>
                </div>
                <div className="ai-a">
                  <span className="ai-mark" aria-hidden>
                    AI
                  </span>
                  <div className="ai-a-body">
                    <p className="ai-a-text">{x.a}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="ai-foot">
            {unasked.length > 0 && (
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
              <input className="ai-input" aria-label="Ask about this ticket" placeholder="Ask about this ticket…" value={text} onChange={(e) => setText(e.target.value)} />
              <button type="submit" className="ai-send" aria-label="Send" disabled={!text.trim()}>
                <ArrowUp size={17} aria-hidden />
              </button>
            </form>
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

/* ---------- Page ---------- */

export function PortalTicket() {
  const { id } = useParams();
  const { reviewFix, toast, now } = useStore();
  const { user, tickets } = usePortalUser();
  const ticket = tickets.find((t) => t.id === id);
  const [asking, setAsking] = useState(false);

  if (!user) return null;
  if (!ticket) {
    return (
      <div className="page">
        <Card>
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
        </Card>
      </div>
    );
  }
  const stage = portalStatus(ticket.status);
  const StatusIcon = STATUS_ICON[stage];
  const sent = ticket.handoffs[ticket.handoffs.length - 1];
  const lastFeedback = ticket.feedback[ticket.feedback.length - 1];
  const awaitingApproval = ticket.status === 'ready_to_deploy' && !(lastFeedback?.decision === 'approved' && sent && lastFeedback.at >= sent.at);
  const deploy = () => {
    if (reviewFix(ticket.id, user.id, 'approved', '')) toast(`Approved. NXS deploys ${ticket.id} next.`);
  };

  return (
    <div className="page">
      <Card className="ticket-card tdl">
        <header className="tdl-head">
          <Link to="/portal" className="back-btn" aria-label="Back to tickets">
            <ArrowLeft size={20} aria-hidden />
          </Link>
          <div className="tdl-head-text">
            <span className="ticket-id">{ticket.id}</span>
            <h1 className="tdl-title">{ticket.title}</h1>
          </div>
          {/* The client's one action, beside the title: approving the fix that's waiting on them. */}
          {awaitingApproval && (
            <div className="tdl-actions">
              <Button variant="primary" onClick={deploy}>
                <Rocket size={15} aria-hidden />
                Approve deploy
              </Button>
            </div>
          )}
          {/* The stage cards below say where it stands; only a canceled ticket, which has none, shows it here. */}
          {stage === 'canceled' && (
            <div className="tdl-actions">
              <span className={cx('tdl-status', `tone-${STATUS_TONE[stage]}`)}>
                <StatusIcon size={15} aria-hidden />
                {PORTAL_STATUS_LABEL[stage]}
              </span>
            </div>
          )}
        </header>
        <Stages ticket={ticket} />
        {stage === 'canceled' && ticket.cancellation && (
          <div className={cx('tdl-banner', 'tone-neutral')}>
            <Ban size={17} aria-hidden className="tdl-banner-icon" />
            <div className="tdl-banner-body">
              <p>
                <strong>Canceled.</strong> {ticket.cancellation.reason}
              </p>
              <p className="tdl-banner-meta">NXS, {fmtRelative(ticket.cancellation.at, now).toLowerCase()}</p>
            </div>
          </div>
        )}

        <div className="ticket-body">
          <div className="ticket-main">
            <Timeline ticket={ticket} userId={user.id} />
          </div>
          <PortalAside ticket={ticket} userId={user.id} onAsk={() => setAsking(true)} />
        </div>
      </Card>
      {asking && <AskDrawer ticket={ticket} onClose={() => setAsking(false)} />}
    </div>
  );
}
