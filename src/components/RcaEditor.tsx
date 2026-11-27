import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, Download, RotateCcw, Sparkles, X } from 'lucide-react';
import type { FullRcaContent, Ticket } from '../types';
import { editFullRca } from '../lib/rcaAi';
import { SHEET_COLS, buildSheet, fullRcaXlsx, type SheetCell } from '../lib/rcaSheet';
import { useStore } from '../store';
import { Badge, Button, cx } from './ui';

/*
 * The full RCA editor, as a spreadsheet: the RCA report template in rows and
 * columns A to F, exactly as it downloads. Labels and section titles are
 * fixed; every value cell is typed into in place. The assistant on top
 * changes it in plain words ("Users affected: about 120 orders").
 */

const SUGGESTIONS = ['What’s still to confirm?', 'Users affected: ', 'Make the executive summary shorter', 'Add action: '];
const COL = 'ABCDEF';

/** A value cell: grows with its text like a wrapped cell, no box of its own. */
function ValueCell({ cell, onChange }: { cell: SheetCell; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [cell.v]);
  if (cell.options)
    return (
      <select className="rcg-input rcg-select" value={cell.v} aria-label="Cell value" onChange={(e) => onChange(e.target.value)}>
        {!cell.options.includes(cell.v) && <option>{cell.v}</option>}
        {cell.options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  return <textarea ref={ref} rows={1} className={cx('rcg-input', cell.v.startsWith('[To confirm') && 'is-todo')} aria-label="Cell value" value={cell.v} onChange={(e) => onChange(e.target.value)} />;
}

export function RcaEditor({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const { fullRcaDraftFor, saveFullRcaDraft } = useStore();
  const c = fullRcaDraftFor(ticket);
  const edited = !!ticket.fullRcaDraft;
  const [ask, setAsk] = useState('');
  const [replies, setReplies] = useState<{ q: string; a: string }[]>([]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = buildSheet(ticket.title, c);
  // Every edit works on a copy and is kept on the ticket at once.
  const write = (cell: SheetCell, v: string) => {
    const d: FullRcaContent = JSON.parse(JSON.stringify(c));
    cell.edit!(d, v);
    saveFullRcaDraft(ticket.id, d);
  };
  const send = (q: string) => {
    if (!q.trim()) return;
    const r = editFullRca(c, q);
    saveFullRcaDraft(ticket.id, r.content);
    setReplies((x) => [...x.slice(-2), { q: q.trim(), a: r.reply }]);
    setAsk('');
  };
  const download = async () => {
    const f = await fullRcaXlsx(ticket.id, ticket.title, c);
    const a = document.createElement('a');
    a.href = f.url!;
    a.download = f.name;
    a.click();
  };

  return createPortal(
    <div className="drawer-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer rce" role="dialog" aria-modal="true" aria-labelledby="rce-title">
        <header className="drawer-head">
          <div>
            <h2 id="rce-title" className="drawer-title">
              Full RCA {edited ? <Badge tone="neutral">Edited</Badge> : <Badge tone="purple">AI draft</Badge>}
            </h2>
            <p className="drawer-sub">RCA Report - {ticket.id}.xlsx</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="rce-scroll">
          {/* Ask the AI to change it in plain words. */}
          <div className="rce-ask">
            {replies.map((r, i) => (
              <div key={i} className="rce-exchange">
                <p className="rce-q">{r.q}</p>
                <p className="rce-a">
                  <Sparkles size={14} aria-hidden />
                  {r.a}
                </p>
              </div>
            ))}
            <form
              className="ai-form"
              onSubmit={(e) => {
                e.preventDefault();
                send(ask);
              }}
            >
              <input className="ai-input" aria-label="Ask AI to edit the full RCA" placeholder="Ask AI to edit, e.g. “Users affected: about 120 orders”" value={ask} onChange={(e) => setAsk(e.target.value)} />
              <button type="submit" className="ai-send" aria-label="Send" disabled={!ask.trim()}>
                <ArrowUp size={17} aria-hidden />
              </button>
            </form>
            <div className="ai-starters">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="choice-chip" onClick={() => (s.endsWith(' ') ? setAsk(s) : send(s))}>
                  {s.trim()}
                </button>
              ))}
            </div>
          </div>

          {/* The sheet: column letters on top, row numbers down the side, as it opens in Excel. */}
          <div className="rcg-wrap">
            <table className="rcg" aria-label="Full RCA sheet">
              <colgroup>
                <col className="rcg-num" />
                <col style={{ width: '20%' }} />
                <col style={{ width: '31%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '11%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="rcg-corner" aria-hidden />
                  {COL.split('').map((l) => (
                    <th key={l} scope="col" className="rcg-col">
                      {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={r}>
                    <th scope="row" className="rcg-row">
                      {r + 1}
                    </th>
                    {row.map((cell, i) => (
                      <td key={i} colSpan={Math.min(cell.span ?? 1, SHEET_COLS)} className={cx('rcg-cell', `is-${cell.kind}`, cell.edit && 'is-edit')}>
                        {cell.edit ? <ValueCell cell={cell} onChange={(v) => write(cell, v)} /> : cell.v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="rce-foot">
          <Button variant="secondary" size="sm" disabled={!edited} onClick={() => saveFullRcaDraft(ticket.id, null)}>
            <RotateCcw size={15} aria-hidden />
            Back to the AI draft
          </Button>
          <span className="rce-foot-end">
            <Button variant="secondary" size="sm" onClick={download}>
              <Download size={15} aria-hidden />
              Download .xlsx
            </Button>
            <Button variant="primary" size="sm" onClick={onClose}>
              Done
            </Button>
          </span>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
