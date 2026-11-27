import { useEffect, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { RcaRow } from '../types';
import { useStore } from '../store';
import { Attachments } from '../components/detail';
import { Empty } from '../components/ui';

/*
 * The full RCA as a page of its own, opened in a new tab from the Client
 * Portal: NXS's RCA report template (header, then ten sections), readable by
 * anyone with the link. No sign-in, no app around it.
 *
 * Two shapes only: label and value for anything with two parts, a table for
 * anything with more. Files sit where they belong: the client's own under the
 * symptoms, the proof under the resolution.
 */

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="report-section" aria-labelledby={`rs-${n}`}>
      <h2 id={`rs-${n}`} className="report-h2">
        <span className="report-h2-n">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A table, for parts with more than two columns. Columns listed in `tight` never wrap. */
function Table({ head, rows, tight = [] }: { head: string[]; rows: string[][]; tight?: number[] }) {
  return (
    <div className="report-table-wrap">
      <table className="report-table">
        <thead>
          <tr>
            {head.map((h, j) => (
              <th key={h} scope="col" className={tight.includes(j) ? 'is-tight' : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j} className={tight.includes(j) ? 'is-tight' : undefined}>
                  {v || '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Label and value, the one shape every two-part section of the report uses. */
function Fields({ rows }: { rows: RcaRow[] }) {
  return (
    <dl className="report-kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ReportPage() {
  const { id } = useParams();
  const { ticketOf, fullRcaDraftFor } = useStore();
  const ticket = ticketOf(id);

  useEffect(() => {
    document.title = ticket ? `RCA Report · ${ticket.id} · NXS` : 'RCA Report · NXS';
  }, [ticket]);

  if (!ticket) {
    return (
      <div className="report-page">
        <div className="band" aria-hidden />
        <main className="report-sheet">
          <Empty title="We can’t find this report">The link may be wrong, or the report was moved.</Empty>
        </main>
      </div>
    );
  }
  const c = fullRcaDraftFor(ticket);
  const handoff = ticket.handoffs[ticket.handoffs.length - 1];

  return (
    <div className="report-page">
      <div className="band" aria-hidden />
      <main className="report-sheet">
        <header className="report-head">
          <p className="report-brand">
            <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
              <rect width="32" height="32" rx="9" fill="#c11fff" />
              <path d="M16 6.5l8 3v6.2c0 4.6-3.2 8.2-8 9.8-4.8-1.6-8-5.2-8-9.8V9.5z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
              <path d="M12.5 15.8l2.6 2.6 4.6-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            NXShield
          </p>
          <p className="report-kicker">
            Root Cause Analysis (RCA) Report · <span className="ticket-id">{ticket.id}</span>
          </p>
          <h1 className="report-title">{ticket.title}</h1>
          <dl className="report-facts">
            {c.header.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </header>

        <Section n={1} title="Executive Summary">
          <Fields rows={c.summary} />
        </Section>

        <Section n={2} title="Incident Details">
          <Fields rows={c.details} />
        </Section>

        <Section n={3} title="Timeline of Events">
          <Table head={['Time', 'Event', 'Who']} rows={c.timeline} tight={[0, 2]} />
        </Section>

        <Section n={4} title="Symptoms and Evidence">
          <Fields rows={c.evidence.filter(([k]) => k !== 'Screenshots / attachments')} />
          {ticket.attachments.length > 0 && (
            <>
              <h3 className="report-h3">From the report</h3>
              <Attachments files={ticket.attachments} />
            </>
          )}
        </Section>

        <Section n={5} title="Root Cause Analysis">
          <p className="report-method">Method: {c.method}</p>
          <Table head={['Level', 'Question', 'Answer']} rows={c.whys} tight={[0]} />
          <div className="report-callout">
            <p className="report-callout-label">Root cause</p>
            <p className="report-callout-text">{c.rootCause}</p>
          </div>
          <h3 className="report-h3">Contributing factors</h3>
          <Fields rows={c.factors} />
          <h3 className="report-h3">Looking back</h3>
          <Fields
            rows={[
              ['Went well', c.wentWell],
              ['Didn’t go well', c.didntGoWell],
            ]}
          />
        </Section>

        <Section n={6} title="Resolution">
          <Fields rows={c.resolution} />
          <h3 className="report-h3">Steps taken</h3>
          <ol className="report-steps">
            {c.steps.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ol>
          {handoff && handoff.attachments.length > 0 && (
            <>
              <h3 className="report-h3">Proof it’s fixed</h3>
              <Attachments files={handoff.attachments} />
            </>
          )}
        </Section>

        <Section n={7} title="Corrective and Preventive Actions">
          <Table head={['#', 'Action', 'Type', 'Owner', 'Due', 'Status']} rows={c.actions.map((a, i) => [String(i + 1), a.action, a.type, a.owner, a.due, a.status])} tight={[0, 2, 3, 4, 5]} />
        </Section>

        <Section n={8} title="Lessons Learned">
          <ul className="report-points">
            {c.lessons.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Section>

        <Section n={9} title="Recurrence Risk">
          <Fields rows={c.risk} />
        </Section>

        <Section n={10} title="Sign-off">
          <Table head={['Role', 'Name', 'Date']} rows={c.signoff} tight={[2]} />
        </Section>
      </main>
    </div>
  );
}
