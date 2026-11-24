import { useEffect, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { RcaRow } from '../types';
import { useStore } from '../store';
import { Attachments } from '../components/detail';
import { Empty } from '../components/ui';

/*
 * The full RCA as a page of its own, opened in a new tab from the Client
 * Portal: NXS's RCA report template (header, then ten sections), readable by
 * anyone with the link, with the document to download. No sign-in, no app
 * around it.
 */

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="report-section" aria-labelledby={`rs-${n}`}>
      <h2 id={`rs-${n}`} className="report-h2">
        {n}. {title}
      </h2>
      {children}
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="report-table-wrap">
      <table className="report-table">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j} className={v.startsWith('[To confirm') ? 'is-todo' : undefined}>
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

function Points({ rows }: { rows: RcaRow[] }) {
  return (
    <ul className="report-points">
      {rows.map(([k, v]) => (
        <li key={k}>
          <strong>{k}:</strong> <span className={v.startsWith('[To confirm') ? 'is-todo' : undefined}>{v}</span>
        </li>
      ))}
    </ul>
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
          {handoff && handoff.attachments.length > 0 && (
            <div className="report-files">
              <Attachments files={handoff.attachments} />
            </div>
          )}
        </header>

        <Section n={1} title="Executive Summary">
          <Points rows={c.summary} />
        </Section>
        <Section n={2} title="Incident Details">
          <Table head={['Item', 'Details']} rows={c.details} />
        </Section>
        <Section n={3} title="Timeline of Events">
          <Table head={['Time', 'Event', 'Who']} rows={c.timeline} />
        </Section>
        <Section n={4} title="Symptoms and Evidence">
          <Points rows={c.evidence} />
        </Section>
        <Section n={5} title="Root Cause Analysis">
          <p className="report-p">
            <strong>Method used:</strong> {c.method}
          </p>
          <Table head={['Level', 'Question', 'Answer']} rows={c.whys} />
          <p className="report-p report-callout">
            <strong>Root cause statement:</strong> {c.rootCause}
          </p>
          <h3 className="report-h3">Contributing factors</h3>
          <Table head={['Category', 'Findings']} rows={c.factors} />
          <ul className="report-points">
            <li>
              <strong>Went well:</strong> {c.wentWell}
            </li>
            <li>
              <strong>Didn’t go well:</strong> {c.didntGoWell}
            </li>
          </ul>
        </Section>
        <Section n={6} title="Resolution">
          <Points rows={c.resolution} />
          <p className="report-p">
            <strong>Steps taken:</strong>
          </p>
          <ol className="report-steps">
            {c.steps.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ol>
        </Section>
        <Section n={7} title="Corrective and Preventive Actions">
          <Table head={['#', 'Action', 'Type', 'Owner', 'Due date', 'Status']} rows={c.actions.map((a, i) => [String(i + 1), a.action, a.type, a.owner, a.due, a.status])} />
          <p className="report-note">Corrective fixes the issue now, Preventive stops it coming back, Detective spots it sooner, Process changes how the work is done.</p>
        </Section>
        <Section n={8} title="Lessons Learned">
          <ul className="report-points">
            {c.lessons.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Section>
        <Section n={9} title="Recurrence Risk">
          <Table head={['Item', 'Assessment']} rows={c.risk} />
        </Section>
        <Section n={10} title="Sign-off">
          <Table head={['Role', 'Name', 'Date']} rows={c.signoff} />
        </Section>
      </main>
    </div>
  );
}
