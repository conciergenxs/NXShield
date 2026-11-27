import type { AssetCategory, CodeFile, CodeFix, DiffLine, FixImpact, PackageRelease, Ticket } from '../types';

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

/** The checkout's payment fix: a loading and retry state on the page, a retry and timeout on the bank call, tests and copy. */
function paymentFiles(): CodeFile[] {
  return [
    {
      path: 'src/checkout/PaymentStep.tsx',
      note: 'Shows a loading state while the bank replies, a retry when it fails, and the virtual account once it arrives.',
      lines: [
        ctx('export function PaymentStep({ order }: Props) {'),
        ctx('  const va = useVirtualAccount(order.id);'),
        del('  return <VirtualAccount number={va.data.number} />;'),
        add('  const t = useCopy("checkout.payment");'),
        add('  useEffect(() => {'),
        add('    if (va.error) track("va_failed", { orderId: order.id, reason: va.error.code });'),
        add('  }, [va.error, order.id]);'),
        add('  if (va.isLoading) return <PaymentPending label={t("waiting")} />;'),
        add('  if (va.error) {'),
        add('    return (') ,
        add('      <PaymentRetry'),
        add('        message={t(va.error.code === "TIMEOUT" ? "slowBank" : "failed")}'),
        add('        onRetry={va.retry}'),
        add('        onSwitch={() => order.setMethod("card")}'),
        add('      />'),
        add('    );'),
        add('  }'),
        add('  return <VirtualAccount number={va.data.number} expiresAt={va.data.expiresAt} />;'),
        ctx('}'),
      ],
    },
    {
      path: 'src/checkout/useVirtualAccount.ts',
      note: 'Retries the bank call once when it times out, and stops waiting after 20 seconds.',
      lines: [
        ctx('export function useVirtualAccount(orderId: string) {'),
        del('  return useQuery(["va", orderId], () => api.createVa(orderId));'),
        add('  return useQuery(["va", orderId], ({ signal }) => api.createVa(orderId, { signal, timeoutMs: 20_000 }), {'),
        add('    retry: (count, error) => count < 1 && isTimeout(error),'),
        add('    retryDelay: 1500,'),
        add('    staleTime: Infinity,'),
        add('    refetchOnWindowFocus: false,'),
        add('  });'),
        ctx('}'),
        add(''),
        add('const isTimeout = (e: unknown) => e instanceof ApiError && e.code === "TIMEOUT";'),
      ],
    },
    {
      path: 'src/checkout/PaymentPending.tsx',
      note: 'New: the loading state while the bank creates the virtual account.',
      lines: [
        add('export function PaymentPending({ label }: { label: string }) {'),
        add('  return ('),
        add('    <div className="payment-pending" role="status" aria-live="polite">'),
        add('      <Spinner size={20} />'),
        add('      <p>{label}</p>'),
        add('    </div>'),
        add('  );'),
        add('}'),
      ],
    },
    {
      path: 'src/checkout/PaymentRetry.tsx',
      note: 'New: what the shopper sees when the bank fails, with a retry and a way to pay by card.',
      lines: [
        add('export function PaymentRetry({ message, onRetry, onSwitch }: Props) {'),
        add('  return ('),
        add('    <div className="payment-retry" role="alert">'),
        add('      <p>{message}</p>'),
        add('      <Button onClick={onRetry}>Try again</Button>'),
        add('      <Button variant="ghost" onClick={onSwitch}>Pay by card instead</Button>'),
        add('    </div>'),
        add('  );'),
        add('}'),
      ],
    },
    {
      path: 'src/api/payments.ts',
      note: 'Passes the timeout and the abort signal through to the bank call.',
      lines: [
        del('export function createVa(orderId: string) {'),
        del('  return http.post(`/payments/va`, { orderId });'),
        add('export function createVa(orderId: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}) {'),
        add('  return http.post(`/payments/va`, { orderId }, { signal: opts.signal, timeout: opts.timeoutMs });'),
        ctx('}'),
      ],
    },
    {
      path: 'server/routes/va.ts',
      note: 'Answers with a clear TIMEOUT code instead of an empty 500 when the bank is slow.',
      lines: [
        ctx('router.post("/payments/va", async (req, res) => {'),
        del('  const va = await bank.createVa(req.body.orderId);'),
        del('  res.json(va);'),
        add('  try {'),
        add('    const va = await bank.createVa(req.body.orderId, { timeoutMs: 15_000 });'),
        add('    res.json(va);'),
        add('  } catch (e) {'),
        add('    if (e instanceof BankTimeout) return res.status(504).json({ code: "TIMEOUT" });'),
        add('    log.error("va failed", { orderId: req.body.orderId, e });'),
        add('    res.status(502).json({ code: "BANK_ERROR" });'),
        add('  }'),
        ctx('});'),
      ],
    },
    {
      path: 'server/bank/client.ts',
      note: 'Sets a timeout on the bank request and reuses the connection.',
      lines: [
        del('const agent = new https.Agent();'),
        add('const agent = new https.Agent({ keepAlive: true, maxSockets: 50 });'),
        ctx('export async function createVa(orderId: string, opts: { timeoutMs?: number } = {}) {'),
        del('  return post("/va", { orderId });'),
        add('  return post("/va", { orderId }, { agent, timeout: opts.timeoutMs ?? 15_000 });'),
        ctx('}'),
      ],
    },
    {
      path: 'src/checkout/payment.css',
      note: 'Styles for the loading and retry states.',
      lines: [add('.payment-pending,'), add('.payment-retry {'), add('  display: grid;'), add('  gap: 12px;'), add('  padding: 24px;'), add('  text-align: center;'), add('}')],
    },
    { path: 'src/i18n/en.json', note: 'Copy for the new states, in English.', lines: [ctx('"checkout.payment": {'), add('  "waiting": "Getting your virtual account number…",'), add('  "slowBank": "The bank is taking longer than usual.",'), add('  "failed": "We couldn’t get your virtual account number.",'), ctx('}')] },
    { path: 'src/i18n/id.json', note: 'Copy for the new states, in Indonesian.', lines: [ctx('"checkout.payment": {'), add('  "waiting": "Menyiapkan nomor virtual account…",'), add('  "slowBank": "Bank sedang lambat merespons.",'), add('  "failed": "Nomor virtual account gagal dibuat.",'), ctx('}')] },
    { path: 'src/analytics/events.ts', note: 'Tracks failed virtual accounts, so we see it if it happens again.', lines: [ctx('export type Event ='), del('  | "checkout_started";'), add('  | "checkout_started"'), add('  | "va_failed";')] },
    {
      path: 'src/checkout/PaymentStep.test.tsx',
      note: 'Tests for the loading, retry and success states.',
      lines: [
        add('it("shows the pending state while the bank replies", () => {'),
        add('  mockVa({ isLoading: true });'),
        add('  render(<PaymentStep order={order} />);'),
        add('  expect(screen.getByRole("status")).toBeVisible();'),
        add('});'),
        add('it("offers a retry when the bank times out", async () => {'),
        add('  mockVa({ error: new ApiError("TIMEOUT") });'),
        add('  render(<PaymentStep order={order} />);'),
        add('  expect(await screen.findByRole("alert")).toHaveTextContent("taking longer");'),
        add('});'),
      ],
    },
    {
      path: 'server/routes/va.test.ts',
      note: 'The route answers TIMEOUT when the bank is slow.',
      lines: [add('it("answers 504 TIMEOUT when the bank is slow", async () => {'), add('  bank.createVa.mockRejectedValue(new BankTimeout());'), add('  const res = await request(app).post("/payments/va").send({ orderId: "o-1" });'), add('  expect(res.status).toBe(504);'), add('  expect(res.body.code).toBe("TIMEOUT");'), add('});')],
    },
    {
      path: 'e2e/checkout-bank-transfer.spec.ts',
      note: 'An end-to-end run of bank transfer at checkout, with a slow bank.',
      lines: [
        add('test("bank transfer survives a slow bank", async ({ page }) => {'),
        add('  await slowBank(page, 8_000);'),
        add('  await page.goto("/checkout");'),
        add('  await page.getByLabel("Bank transfer").check();'),
        add('  await expect(page.getByText("Getting your virtual account")).toBeVisible();'),
        add('  await expect(page.getByTestId("va-number")).toBeVisible({ timeout: 20_000 });'),
        add('});'),
      ],
    },
  ];
}

/** A fix for a page that shows the wrong thing or nothing at all. */
function frontendFiles(t: Pick<Ticket, 'title'>): CodeFile[] {
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

/** What the AI writes about a fix of each kind: the PR title, what changed, its impact and package news. */
interface FixStory {
  scope: string;
  changes: string[];
  impact: FixImpact;
  packages: PackageRelease[];
  commits: number;
}

const npm = (name: string, installed: string, latest: string, bump: PackageRelease['bump'], note: string, maintainer: string): PackageRelease => ({
  name,
  installed,
  latest,
  bump,
  note,
  maintainer,
  url: `https://www.npmjs.com/package/${name}?activeTab=versions`,
});

const PAYMENT_STORY: FixStory = {
  scope: 'checkout',
  changes: [
    'Shows a loading state while the bank creates the virtual account, and a retry when it fails.',
    'Retries the bank call once when it times out, and stops waiting after 20 seconds.',
    'Answers with a clear TIMEOUT code instead of an empty error when the bank is slow.',
    'Adds the copy for the new states, in English and Indonesian.',
    'Adds unit and end-to-end tests for bank transfer with a slow bank.',
  ],
  impact: {
    risk: 'medium',
    breaking: false,
    areas: ['Checkout', 'Payments API', 'Bank client'],
    notes: [
      'Card and e-wallet payments go through the same step and keep working as before.',
      'Orders already waiting for a virtual account get it on the next refresh.',
      'Failed virtual accounts are now tracked, so a repeat shows up on the dashboard.',
    ],
  },
  packages: [npm('axios', '1.7.2', '1.7.9', 'patch', 'Fixes for request timeouts and aborted requests.', 'Axios')],
  commits: 4,
};

const frontendStory = (t: Pick<Ticket, 'title'>): FixStory => ({
  scope: slug(t.title).split('-').slice(0, 2).join('-'),
  changes: ['Fixes what the page shows in the case from the report.', 'Keeps the layout in place on small screens.'],
  impact: {
    risk: 'low',
    breaking: false,
    areas: ['Page view', 'Styles'],
    notes: ['Only this page’s component and its styles change.', 'Pages that share the layout keep their size; the change adds a minimum height only.'],
  },
  packages: [npm('react-router-dom', '6.26.1', '6.28.0', 'minor', 'Small fixes to navigation and data loading.', 'Remix')],
  commits: 2,
});

const backendStory = (t: Pick<Ticket, 'title'>): FixStory => {
  const sync = /sync|feed|import|connector|stock|orders/i.test(t.title);
  return sync
    ? {
        scope: 'sync',
        changes: ['Stops dropping records the source sends late.', 'Logs the records it still skips, with their IDs.', 'Adds a test for the case in the report.'],
        impact: {
          risk: 'medium',
          breaking: false,
          areas: ['Data sync', 'Worker'],
          notes: ['Records that arrived late since the last run are picked up on the next sync.', 'The skipped-record log goes to the existing sync channel.'],
        },
        packages: [npm('zod', '3.23.8', '3.24.1', 'minor', 'Faster parsing and clearer error messages.', 'Colin McDonnell')],
        commits: 3,
      }
    : {
        scope: 'reports',
        changes: ['Counts each record once in the report.', 'Leaves out the records that don’t belong in it.', 'Adds a test for the case in the report.'],
        impact: {
          risk: 'low',
          breaking: false,
          areas: ['Reports'],
          notes: ['Past reports are rebuilt with the fix the next time they’re opened.', 'Exports use the same query and get the same fix.'],
        },
        packages: [],
        commits: 2,
      };
};

export function codeFixFor(t: Pick<Ticket, 'id' | 'title' | 'plan'>, category: AssetCategory | undefined, fixPlan: string): CodeFix {
  const backend = t.plan?.taskType === 'backend';
  // Payments touch the page, the API and the bank client: a bigger fix, fourteen files and about a hundred lines.
  const payment = /bank transfer|checkout|payment/i.test(t.title);
  const files = payment ? paymentFiles() : backend ? backendFiles(t) : frontendFiles(t);
  const story = payment ? PAYMENT_STORY : backend ? backendStory(t) : frontendStory(t);
  const n = Number(t.id.replace(/\D/g, '')) || 0;
  const title = t.title.charAt(0).toLowerCase() + t.title.slice(1);
  return {
    repo: `nxs-tech/${REPO[category ?? 'consumer_website']}`,
    branch: `fix/${t.id.toLowerCase()}-${slug(t.title)}`,
    summary: fixPlan,
    pr: { number: 300 + (n % 400), title: `fix(${story.scope}): ${title}`, commits: story.commits },
    changes: story.changes,
    impact: story.impact,
    packages: story.packages,
    files,
    revision: 0,
  };
}

export const countLines = (f: CodeFix) =>
  f.files.reduce((n, x) => ({ add: n.add + x.lines.filter((l) => l.t === '+').length, del: n.del + x.lines.filter((l) => l.t === '-').length }), { add: 0, del: 0 });

/** The AI's revision of its fix from a plain instruction. Simulated from the words. */
export function reviseCodeFix(f: CodeFix, q: string): { fix: CodeFix; reply: string; changed: string[] } {
  const text = q.trim();
  const next: CodeFix = { ...f, files: f.files.map((x) => ({ ...x, lines: [...x.lines] })), changes: [...f.changes], pr: { ...f.pr, commits: f.pr.commits + 1 }, revision: f.revision + 1 };
  if (/test/i.test(text)) {
    const path = next.files[0].path.replace(/\.(tsx?|css)$/, '.test.ts');
    if (next.files.some((x) => x.path === path)) return { fix: f, reply: `There’s already a test in ${path}.`, changed: [] };
    next.changes.push('Adds a test for the case in the report.');
    next.files.push({ path, note: 'A test for the case in the report.', lines: [add('it("works for the case in the report", async () => {'), add('  render(<Subject case="from-report" />);'), add('  expect(await screen.findByRole("main")).toBeVisible();'), add('});')] });
    return { fix: next, reply: `Added a test in ${path}.`, changed: [path] };
  }
  if (/log|monitor|alert|track/i.test(text)) {
    const file = next.files[0];
    file.lines.splice(Math.max(1, file.lines.length - 1), 0, add('  metrics.increment("fix.' + file.path.split('/').pop()!.replace(/\..*$/, '') + '");'));
    next.changes.push('Adds a metric, so we see it if it happens again.');
    return { fix: next, reply: `Added a metric in ${file.path} so we see if it happens again.`, changed: [file.path] };
  }
  if (/simpl|smaller|less|minimal|revert/i.test(text)) {
    if (next.files.length < 2) return { fix: f, reply: 'It’s already the smallest change that fixes it.', changed: [] };
    const dropped = next.files.pop()!;
    next.changes = next.changes.filter((c) => !c.toLowerCase().includes(dropped.note.toLowerCase().slice(0, 24)));
    return { fix: next, reply: `Kept it smaller: dropped the change to ${dropped.path}.`, changed: [] };
  }
  if (/retry|timeout|time out|slow|late/i.test(text)) {
    const file = next.files[next.files.length - 1];
    file.lines.push(add('// Gives up after 10 seconds and shows the retry state.'), add('export const TIMEOUT_MS = 10_000;'));
    next.changes.push('Gives up after 10 seconds and shows the retry state.');
    return { fix: next, reply: `Added a 10-second limit in ${file.path}.`, changed: [file.path] };
  }
  return { fix: f, reply: 'What should change? For example “add a test”, “add logging”, “keep it smaller” or “add a timeout”.', changed: [] };
}
