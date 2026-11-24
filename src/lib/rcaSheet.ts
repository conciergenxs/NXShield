import type { Attachment, FullRcaContent, RcaAction } from '../types';

/*
 * The full RCA as one spreadsheet: the RCA report template laid out in rows
 * and six columns (A to F). The same layout feeds the grid editor and the
 * .xlsx file, so what QA edits is exactly what the client downloads.
 */

export const SHEET_COLS = 6;

export type SheetCell = {
  v: string;
  /** How many columns it covers, from its own. */
  span?: number;
  kind: 'title' | 'section' | 'head' | 'label' | 'value';
  /** Writes an edit back into the report. Cells without one are fixed. */
  edit?: (d: FullRcaContent, v: string) => void;
  /** A fixed set of values, edited with a picker. */
  options?: string[];
};
export type SheetRow = SheetCell[];

const ACTION_TYPES: RcaAction['type'][] = ['Corrective', 'Preventive', 'Detective', 'Process'];
const ACTION_STATUS: RcaAction['status'][] = ['Open', 'In progress', 'Done'];

const title = (v: string): SheetRow => [{ v, kind: 'title', span: SHEET_COLS }];
const section = (v: string): SheetRow => [{ v, kind: 'section', span: SHEET_COLS }];
const head = (...cols: [string, number][]): SheetRow => cols.map(([v, span]) => ({ v, span, kind: 'head' }));
const blank: SheetRow = [{ v: '', kind: 'label', span: SHEET_COLS }];

/** Label and value rows: the label in A, the value across B to F. */
function pairs(list: [string, string][], key: 'header' | 'summary' | 'details' | 'evidence' | 'resolution' | 'risk' | 'factors'): SheetRow[] {
  return list.map(([k, v], i) => [
    { v: k, kind: 'label' },
    { v, kind: 'value', span: SHEET_COLS - 1, edit: (d, val) => (d[key][i][1] = val) },
  ]);
}

export function buildSheet(ticketTitle: string, c: FullRcaContent): SheetRow[] {
  const rows: SheetRow[] = [];
  rows.push(title('Root Cause Analysis (RCA) Report'), title(ticketTitle), blank);
  rows.push(head(['Field', 1], ['Details', 5]), ...pairs(c.header, 'header'), blank);

  rows.push(section('1. Executive Summary'), ...pairs(c.summary, 'summary'), blank);
  rows.push(section('2. Incident Details'), head(['Item', 1], ['Details', 5]), ...pairs(c.details, 'details'), blank);

  rows.push(section('3. Timeline of Events'), head(['Time', 1], ['Event', 4], ['Who', 1]));
  c.timeline.forEach((r, i) =>
    rows.push([
      { v: r[0], kind: 'value', edit: (d, v) => (d.timeline[i][0] = v) },
      { v: r[1], kind: 'value', span: 4, edit: (d, v) => (d.timeline[i][1] = v) },
      { v: r[2], kind: 'value', edit: (d, v) => (d.timeline[i][2] = v) },
    ]),
  );
  rows.push(blank);

  rows.push(section('4. Symptoms and Evidence'), ...pairs(c.evidence, 'evidence'), blank);

  rows.push(section('5. Root Cause Analysis'), [
    { v: 'Method used', kind: 'label' },
    { v: c.method, kind: 'value', span: 5, edit: (d, v) => (d.method = v), options: ['5 Whys', 'Fishbone (Ishikawa)', 'Fault tree', 'Change analysis'] },
  ]);
  rows.push(head(['Level', 1], ['Question', 2], ['Answer', 3]));
  c.whys.forEach((r, i) =>
    rows.push([
      { v: r[0], kind: 'label' },
      { v: r[1], kind: 'label', span: 2 },
      { v: r[2], kind: 'value', span: 3, edit: (d, v) => (d.whys[i][2] = v) },
    ]),
  );
  rows.push([
    { v: 'Root cause statement', kind: 'label' },
    { v: c.rootCause, kind: 'value', span: 5, edit: (d, v) => (d.rootCause = v) },
  ]);
  rows.push(head(['Contributing factors', 1], ['Findings', 5]), ...pairs(c.factors, 'factors'));
  rows.push(
    [
      { v: 'Went well', kind: 'label' },
      { v: c.wentWell, kind: 'value', span: 5, edit: (d, v) => (d.wentWell = v) },
    ],
    [
      { v: 'Didn’t go well', kind: 'label' },
      { v: c.didntGoWell, kind: 'value', span: 5, edit: (d, v) => (d.didntGoWell = v) },
    ],
    blank,
  );

  rows.push(section('6. Resolution'), ...pairs(c.resolution, 'resolution'));
  c.steps.forEach((x, i) =>
    rows.push([
      { v: `Step ${i + 1}`, kind: 'label' },
      { v: x, kind: 'value', span: 5, edit: (d, v) => (d.steps[i] = v) },
    ]),
  );
  rows.push(blank);

  rows.push(section('7. Corrective and Preventive Actions'), head(['#', 1], ['Action', 1], ['Type', 1], ['Owner', 1], ['Due date', 1], ['Status', 1]));
  c.actions.forEach((a, i) =>
    rows.push([
      { v: String(i + 1), kind: 'label' },
      { v: a.action, kind: 'value', edit: (d, v) => (d.actions[i].action = v) },
      { v: a.type, kind: 'value', options: ACTION_TYPES, edit: (d, v) => (d.actions[i].type = v as RcaAction['type']) },
      { v: a.owner, kind: 'value', edit: (d, v) => (d.actions[i].owner = v) },
      { v: a.due, kind: 'value', edit: (d, v) => (d.actions[i].due = v) },
      { v: a.status, kind: 'value', options: ACTION_STATUS, edit: (d, v) => (d.actions[i].status = v as RcaAction['status']) },
    ]),
  );
  rows.push(blank);

  rows.push(section('8. Lessons Learned'));
  c.lessons.forEach((x, i) =>
    rows.push([
      { v: `Lesson ${i + 1}`, kind: 'label' },
      { v: x, kind: 'value', span: 5, edit: (d, v) => (d.lessons[i] = v) },
    ]),
  );
  rows.push(blank);

  rows.push(section('9. Recurrence Risk'), head(['Item', 1], ['Assessment', 5]));
  c.risk.forEach(([k, v], i) =>
    rows.push([
      { v: k, kind: 'label' },
      { v, kind: 'value', span: 5, options: i < 2 ? ['Low', 'Medium', 'High'] : undefined, edit: (d, val) => (d.risk[i][1] = val) },
    ]),
  );
  rows.push(blank);

  rows.push(section('10. Sign-off'), head(['Role', 2], ['Name', 2], ['Date', 2]));
  c.signoff.forEach((r, i) =>
    rows.push([
      { v: r[0], kind: 'label', span: 2 },
      { v: r[1], kind: 'value', span: 2, edit: (d, v) => (d.signoff[i][1] = v) },
      { v: r[2], kind: 'value', span: 2, edit: (d, v) => (d.signoff[i][2] = v) },
    ]),
  );
  return rows;
}

/** The sheet as a real .xlsx file: the same rows, merged cells for spans, readable column widths. */
export async function fullRcaXlsx(ticketId: string, ticketTitle: string, c: FullRcaContent): Promise<Attachment> {
  const XLSX = await import('xlsx');
  const rows = buildSheet(ticketTitle, c);
  const aoa: string[][] = [];
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
  rows.forEach((row, r) => {
    const line: string[] = [];
    let col = 0;
    for (const cell of row) {
      const span = cell.span ?? 1;
      line[col] = cell.v;
      for (let k = 1; k < span; k++) line[col + k] = '';
      if (span > 1) merges.push({ s: { r, c: col }, e: { r, c: col + span - 1 } });
      col += span;
    }
    aoa.push(line);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = [{ wch: 28 }, { wch: 40 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'RCA Report');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return { id: `att-ai-${Date.now()}`, name: `RCA Report - ${ticketId}.xlsx`, size: `${Math.max(1, Math.round(blob.size / 1000))} KB`, kind: 'doc', url: URL.createObjectURL(blob) };
}
