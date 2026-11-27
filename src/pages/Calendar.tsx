import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Ticket } from '../types';
import { isOpen, severityRank } from '../lib/domain';
import { fmtDateTime, fmtDuration, fmtTime, startOfDay } from '../lib/format';
import { useStore } from '../store';
import { SLA_TONE, SeverityBadge } from '../components/domain';
import { Card, cx, usePopover } from '../components/ui';
import { FilterButton, FilterChips, useFilterMenu } from '../components/FilterMenu';
import { TicketsHeader, TicketsToolbar, useSharedTicketFilters } from './Tickets';
import { useScopedTickets, useTicketScope } from '../components/scope';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Bar rows per week. Bars are never cut; one that does not fit counts in its days' "+N more". */
const LANES = 4;

const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

const monthStart = (ts: number) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};
const shiftMonth = (ts: number, by: number) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth() + by, 1).getTime();
};
const addDays = (ts: number, n: number) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
};

/** One open ticket on the calendar: from the day it came in to the day it is due. */
interface Span {
  ticket: Ticket;
  start: number; // midnight of the first day
  end: number; // midnight of the last day
  due: number;
  late: boolean;
  tone: string;
  note: string;
  /** Shown at the right end of the bar: the due time, or how late it is. */
  endLabel: string;
}

/** The part of a span that falls in one week, placed on a lane. */
interface Segment {
  span: Span;
  col: number;
  len: number;
  lane: number;
  fromBefore: boolean;
  toAfter: boolean;
}

export function CalendarView() {
  const { now, slaOf, clientOf, assetOf } = useStore();
  const { portal } = useTicketScope();
  const tickets = useScopedTickets();
  // Under each ticket in a day's list: the client for staff, the product for a client.
  const subName = (t: Ticket) => (portal ? assetOf(t.assetId)?.name : clientOf(t.clientId)?.name) ?? '';
  const [month, setMonth] = useState(() => monthStart(now));
  const { q, setQ, fields, match, clearShown, hasActive } = useSharedTicketFilters('calendar');
  const today = startOfDay(now);

  // Weeks shown: from the Monday on or before the 1st to the Sunday on or after the last day.
  const weeks = useMemo(() => {
    const first = new Date(month);
    const lead = (first.getDay() + 6) % 7;
    const start = addDays(month, -lead);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const count = Math.ceil((lead + last.getDate()) / 7);
    return Array.from({ length: count }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
  }, [month]);

  // Open tickets only: the bar runs from creation to the resolution deadline,
  // or on to today when the ticket is already past it.
  const spans = useMemo(() => {
    const out: Span[] = [];
    for (const t of tickets) {
      if (!isOpen(t) || !match(t)) continue;
      const sla = slaOf(t);
      const due = sla.resolution.due;
      const late = due < now;
      out.push({
        ticket: t,
        start: startOfDay(t.createdAt),
        end: startOfDay(Math.max(due, late ? now : due)),
        due,
        late,
        tone: SLA_TONE[sla.overall],
        note: late ? `${fmtDuration(now - due)} overdue` : `Due in ${fmtDuration(due - now)}`,
        endLabel: late ? `${fmtDuration(now - due)} late` : `Due ${fmtTime(due)}`,
      });
    }
    // Google Calendar's rule: earliest start first, and on the same start the
    // longer bar first, so long bars get a row and fill the days they cross.
    return out.sort((a, b) => a.start - b.start || b.end - a.end || a.due - b.due || severityRank(b.ticket.severity) - severityRank(a.ticket.severity));
  }, [tickets, match, now, slaOf]);

  const monthEnd = shiftMonth(month, 1);
  const inMonth = spans.filter((s) => s.start < monthEnd && s.end >= month).length;

  const filterMenu = useFilterMenu(fields);

  return (
    <div className="page">
      <TicketsHeader view="calendar" />

      <Card flush className="tickets-card calendar-wrap">
        <TicketsToolbar
          view="calendar"
          search={q}
          onSearch={setQ}
          placeholder={portal ? 'Search ID, title, asset' : 'Search ID, title, client, asset'}
          filter={<FilterButton menu={filterMenu} ariaLabel="Filter calendar" />}
          chips={<FilterChips menu={filterMenu} onClearAll={hasActive ? clearShown : undefined} />}
        />

        <div className="cal-bar">
          <div className="cal-nav">
            <h2 className="cal-month" aria-live="polite">
              {monthFmt.format(month)}
            </h2>
            <span className="cal-total">
              {inMonth} open {inMonth === 1 ? 'ticket' : 'tickets'}
            </span>
            <div className="cal-arrows">
              <button type="button" className="cal-arrow" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
                <ChevronLeft size={18} aria-hidden />
              </button>
              <button type="button" className="cal-today" onClick={() => setMonth(monthStart(now))} disabled={month === monthStart(now)}>
                Today
              </button>
              <button type="button" className="cal-arrow" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
                <ChevronRight size={18} aria-hidden />
              </button>
            </div>
          </div>
          <ul className="cal-legend" aria-label="Bar colours">
            <li>
              <span className="cal-key tone-purple" aria-hidden /> On track
            </li>
            <li>
              <span className="cal-key tone-orange" aria-hidden /> Due soon
            </li>
            <li>
              <span className="cal-key is-late tone-red" aria-hidden /> Overdue
            </li>
          </ul>
        </div>

        <div className="cal" aria-label={`${monthFmt.format(month)}, open tickets from the day they came in to the day they are due`}>
          <div className="cal-head" aria-hidden>
            {WEEKDAYS.map((w) => (
              <span key={w} className="cal-weekday">
                {w}
              </span>
            ))}
          </div>
          {weeks.map((days) => (
            <Week key={days[0]} days={days} spans={spans} month={month} today={today} subName={subName} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function Week({ days, spans, month, today, subName }: { days: number[]; spans: Span[]; month: number; today: number; subName: (t: Ticket) => string }) {
  const { ticketPath } = useTicketScope();
  const first = days[0];
  const last = days[6];
  const thisMonth = new Date(month).getMonth();

  // Cut each span to this week, then stack the pieces. Overdue bars go first so
  // they are never folded into "+N more"; the rest follow Google Calendar's way:
  // by the day they start in this week (a bar carried over from last week
  // starts on Monday), longest first, each on the first lane free for all its days.
  const { shown, perDay } = useMemo(() => {
    const taken: boolean[][] = [];
    const segs: Segment[] = [];
    const perDay: Span[][] = days.map(() => []);
    const pieces = spans
      .filter((span) => span.end >= first && span.start <= last)
      .map((span, order) => ({
        span,
        order,
        col: Math.max(0, Math.round((span.start - first) / 86_400_000)),
        endCol: Math.min(6, Math.round((span.end - first) / 86_400_000)),
      }))
      .sort((a, b) => Number(b.span.late) - Number(a.span.late) || a.col - b.col || b.endCol - a.endCol || a.order - b.order);
    for (const { span, col, endCol } of pieces) {
      for (let c = col; c <= endCol; c++) perDay[c].push(span);
      let lane = 0;
      while (taken[lane]?.slice(col, endCol + 1).some(Boolean)) lane++;
      taken[lane] ??= Array(7).fill(false);
      for (let c = col; c <= endCol; c++) taken[lane][c] = true;
      segs.push({ span, col, len: endCol - col + 1, lane, fromBefore: span.start < first, toAfter: span.end > last });
    }
    return { shown: segs.filter((g) => g.lane < LANES), perDay };
  }, [days, spans, first, last]);

  return (
    <div className="cal-week">
      <div className="cal-week-bg" aria-hidden>
        {days.map((d) => (
          <span key={d} className={cx('cal-cell', new Date(d).getMonth() !== thisMonth && 'is-outside', d === today && 'is-today')} />
        ))}
      </div>
      <div className="cal-week-grid" style={{ gridTemplateRows: `34px repeat(${LANES}, 26px) 24px` }}>
        {days.map((d, i) => (
          <DayHead key={d} day={d} col={i} spans={perDay[i]} hidden={perDay[i].length - shown.filter((g) => i >= g.col && i < g.col + g.len).length} outside={new Date(d).getMonth() !== thisMonth} isToday={d === today} subName={subName} />
        ))}
        {shown.map(({ span, col, len, lane, fromBefore, toAfter }) => (
          <Link
            key={span.ticket.id}
            to={ticketPath(span.ticket.id)}
            className={cx('cal-span', `tone-${span.tone}`, span.late && 'is-late', fromBefore && 'from-before', toAfter && 'to-after')}
            style={{ gridColumn: `${col + 1} / span ${len}`, gridRow: lane + 2 }}
            title={`${span.ticket.id} · ${span.ticket.title}\nCame in ${fmtDateTime(span.ticket.createdAt)} · due ${fmtDateTime(span.due)}${span.late ? ` (${span.note})` : ''}`}
          >
            <span className="cal-span-id">{span.ticket.id}</span>
            <span className="cal-span-title">{span.ticket.title}</span>
            {!toAfter && <span className="cal-span-end">{span.endLabel}</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** The date in each cell, "+N more" under the bars, and the day's full list. */
function DayHead({ day, col, spans, hidden, outside, isToday, subName }: { day: number; col: number; spans: Span[]; hidden: number; outside: boolean; isToday: boolean; subName: (t: Ticket) => string }) {
  const pop = usePopover();
  const { ticketPath } = useTicketScope();
  const label = dayFmt.format(day);
  return (
    <>
      <div className={cx('cal-day-head', outside && 'is-outside', isToday && 'is-today')} style={{ gridColumn: col + 1, gridRow: 1 }}>
        <span className="cal-date">{new Date(day).getDate()}</span>
        {spans.length > 0 && (
          <button type="button" className="cal-count" aria-label={`${spans.length} open on ${label}`} onClick={() => pop.setOpen(true)}>
            {spans.length}
          </button>
        )}
      </div>
      {hidden > 0 && (
        <button type="button" className="cal-more" style={{ gridColumn: col + 1, gridRow: LANES + 2 }} onClick={() => pop.setOpen(true)}>
          +{hidden} more
        </button>
      )}
      {pop.open && (
        <div className="popover-anchor cal-pop-anchor" style={{ gridColumn: col + 1, gridRow: 1 }} ref={pop.ref}>
          <div className={cx('popover cal-pop', col >= 4 && 'to-left')} role="dialog" aria-label={label}>
            <p className="cal-pop-title">{label}</p>
            <ul className="cal-pop-list">
              {spans.map((s) => (
                <li key={s.ticket.id}>
                  <Link to={ticketPath(s.ticket.id)} className="cal-pop-row">
                    <span className={cx('cal-pop-dot', `tone-${s.tone}`)} aria-hidden />
                    <span className="cal-pop-main">
                      <span className="cal-item-id">{s.ticket.id}</span>
                      <span className="cal-pop-name">{s.ticket.title}</span>
                      <span className="cal-pop-meta">
                        {subName(s.ticket)}, <span className={cx('cal-pop-note', `tone-${s.tone}`)}>{s.note}</span>
                      </span>
                    </span>
                    <SeverityBadge severity={s.ticket.severity} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
