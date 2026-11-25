import type { AssetCategory, CodeFile, CodeFix, DiffLine, Ticket } from '../types';

/*
 * The AI's code fix, simulated: from the ticket's words, the asset and the
 * kind of work it picks the files a fix like this touches and writes a small
 * diff for each. A real version would read the repository and open a branch.
 */

export const REPO: Record<AssetCategory, string> = {
  consumer_website: 'consumer-website',
  marketing_dashboard: 'martech-dashboard',
  omnichannel_dashboard: 'omnichannel-dashboard',
  lms_app: 'lms-app',
};

const slug = (x: string) =>
  x
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 4)
    .join('-');

const ctx = (text: string): DiffLine => ({ t: ' ', text });
const add = (text: string): DiffLine => ({ t: '+', text });
const del = (text: string): DiffLine => ({ t: '-', text });

/** A fix for a page that shows the wrong thing or nothing at all. */
function frontendFiles(t: Pick<Ticket, 'title'>): CodeFile[] {
  const pay = /bank transfer|checkout|payment/i.test(t.title);
  if (pay)
    return [
      {
        path: 'src/checkout/PaymentStep.tsx',
        note: 'Shows a loading state while the bank replies, and the virtual account once it arrives.',
        lines: [
          ctx('export function PaymentStep({ order }: Props) {'),
          ctx('  const va = useVirtualAccount(order.id);'),
          del('  return <VirtualAccount number={va.data.number} />;'),
          add('  if (va.isLoading) return <PaymentPending />;'),
          add('  if (va.error) return <PaymentRetry onRetry={va.retry} />;'),
          add('  return <VirtualAccount number={va.data.number} />;'),
          ctx('}'),
        ],
      },
      {
        path: 'src/checkout/useVirtualAccount.ts',
        note: 'Retries the bank call once when it times out.',
        lines: [
          ctx('export function useVirtualAccount(orderId: string) {'),
          del('  return useQuery(["va", orderId], () => api.createVa(orderId));'),
          add('  return useQuery(["va", orderId], () => api.createVa(orderId), {'),
          add('    retry: 1,'),
          add('    retryDelay: 1500,'),
          add('  });'),
          ctx('}'),
        ],
      },
    ];
  return [
    {
      path: 'src/components/' + slug(t.title).replace(/-/g, '_') + '.tsx',
      note: 'Fixes what the page shows in the case from the report.',
      lines: [
        ctx('export function View({ data }: Props) {'),
        del('  return <Layout items={data.items} />;'),
        add('  const items = data.items ?? [];'),
        add('  if (!items.length) return <EmptyState />;'),
        add('  return <Layout items={items} />;'),
        ctx('}'),
      ],
    },
    {
      path: 'src/styles/layout.css',
      note: 'Keeps it in place on small screens.',
      lines: [ctx('.layout {'), del('  position: absolute;'), add('  position: relative;'), add('  min-height: 240px;'), ctx('}')],
    },
  ];
}

/** A fix for data that is wrong, late or missing. */
function backendFiles(t: Pick<Ticket, 'title'>): CodeFile[] {
  const sync = /sync|feed|import|connector|stock|orders/i.test(t.title);
  return [
    {
      path: sync ? 'services/sync/worker.ts' : 'services/reports/build.ts',
      note: sync ? 'Stops dropping records the source sends late, and logs the ones it skips.' : 'Counts each record once and leaves out the ones that don’t belong.',
      lines: sync
        ? [
            ctx('for (const record of batch) {'),
            del('  if (record.updatedAt < lastRun) continue;'),
            add('  if (record.updatedAt < lastRun - LATE_WINDOW) {'),
            add('    log.warn("skipped late record", record.id);'),
            add('    continue;'),
            add('  }'),
            ctx('  await upsert(record);'),
            ctx('}'),
          ]
        : [ctx('const rows = await query(range);'), del('return rows.map(toLine);'), add('const unique = dedupeBy(rows, (r) => r.orderId);'), add('return unique.filter(isCounted).map(toLine);')],
    },
    {
      path: sync ? 'services/sync/worker.test.ts' : 'services/reports/build.test.ts',
      note: 'A test for the case in the report.',
      lines: [
        add(`it("${t.title.replace(/"/g, '')}", async () => {`),
        add('  const result = await run(fixture("from-report"));'),
        add('  expect(result).toMatchSnapshot();'),
        add('});'),
      ],
    },
  ];
}

export function codeFixFor(t: Pick<Ticket, 'id' | 'title' | 'plan'>, category: AssetCategory | undefined, fixPlan: string): CodeFix {
  const backend = t.plan?.taskType === 'backend';
  const files = backend ? backendFiles(t) : frontendFiles(t);
  return {
    repo: `nxs-tech/${REPO[category ?? 'consumer_website']}`,
    branch: `fix/${t.id.toLowerCase()}-${slug(t.title)}`,
    summary: fixPlan,
    files,
    revision: 0,
  };
}

export const countLines = (f: CodeFix) =>
  f.files.reduce((n, x) => ({ add: n.add + x.lines.filter((l) => l.t === '+').length, del: n.del + x.lines.filter((l) => l.t === '-').length }), { add: 0, del: 0 });

/** The AI's revision of its fix from a plain instruction. Simulated from the words. */
export function reviseCodeFix(f: CodeFix, q: string): { fix: CodeFix; reply: string; changed: string[] } {
  const text = q.trim();
  const next: CodeFix = { ...f, files: f.files.map((x) => ({ ...x, lines: [...x.lines] })), revision: f.revision + 1 };
  if (/test/i.test(text)) {
    const path = next.files[0].path.replace(/\.(tsx?|css)$/, '.test.ts');
    if (next.files.some((x) => x.path === path)) return { fix: f, reply: `There’s already a test in ${path}.`, changed: [] };
    next.files.push({ path, note: 'A test for the case in the report.', lines: [add('it("works for the case in the report", async () => {'), add('  render(<Subject case="from-report" />);'), add('  expect(await screen.findByRole("main")).toBeVisible();'), add('});')] });
    return { fix: next, reply: `Added a test in ${path}.`, changed: [path] };
  }
  if (/log|monitor|alert|track/i.test(text)) {
    const file = next.files[0];
    file.lines.splice(Math.max(1, file.lines.length - 1), 0, add('  metrics.increment("fix.' + file.path.split('/').pop()!.replace(/\..*$/, '') + '");'));
    return { fix: next, reply: `Added a metric in ${file.path} so we see if it happens again.`, changed: [file.path] };
  }
  if (/simpl|smaller|less|minimal|revert/i.test(text)) {
    if (next.files.length < 2) return { fix: f, reply: 'It’s already the smallest change that fixes it.', changed: [] };
    const dropped = next.files.pop()!;
    return { fix: next, reply: `Kept it smaller: dropped the change to ${dropped.path}.`, changed: [] };
  }
  if (/retry|timeout|time out|slow|late/i.test(text)) {
    const file = next.files[next.files.length - 1];
    file.lines.push(add('// Gives up after 10 seconds and shows the retry state.'), add('export const TIMEOUT_MS = 10_000;'));
    return { fix: next, reply: `Added a 10-second limit in ${file.path}.`, changed: [file.path] };
  }
  return { fix: f, reply: 'What should change? For example “add a test”, “add logging”, “keep it smaller” or “add a timeout”.', changed: [] };
}
