import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Asset, Attachment, Category, Client, Severity } from '../types';
import { Bell, CalendarCheck, Check, LifeBuoy, MessageSquare, X } from 'lucide-react';
import { CATEGORY_HINT, CATEGORY_LABEL, NEW_TICKET_CATEGORIES, OPEN_TICKET_CATEGORIES, PRIORITY_PROMISE, PRIORITY_QUESTIONS, priorityFromAnswers } from '../lib/domain';
import { fmtDate, fmtTarget, fmtWeekday } from '../lib/format';
import { useStore } from '../store';
import { Dropdown } from './pickers';
import { RichInput } from './RichInput';
import { SeverityBadge } from './domain';
import { Button, Field, cx } from './ui';

const PRIORITY_TONE: Record<Severity, string> = { critical: 'red', high: 'orange', medium: 'yellow', low: 'neutral' };

export interface TicketFormValues {
  clientId: string;
  assetId: string;
  reporterId: string;
  title: string;
  description: string;
  attachments: Attachment[];
  category: Category;
  /** From the impact questions; null for categories without a priority. */
  severity: Severity | null;
}

interface Props {
  /** The clients a ticket can be for. Staff pick one; in the portal there is only theirs. */
  clients: Client[];
  assets: Asset[];
  chooseClient: boolean;
  /** The signed-in client user, marked "(you)" in Requested by. */
  meId?: string;
  presetClientId?: string | null;
  presetAssetId?: string | null;
  /** Prefix for field ids, so the portal and the dashboard forms stay apart. */
  idPrefix: string;
  submitLabel: string;
  cancelTo: string;
  onSubmit: (values: TicketFormValues) => void;
}

/**
 * Creating a ticket, the same for a client in the portal and for NXS logging
 * one on their behalf. In order: who is asking, about which asset, what
 * happened (with screenshots and files in the same box), what kind of issue,
 * and for a Tech issue, three impact questions that set the priority, P1 to
 * P4. There is no due date to pick: the priority's SLA sets it.
 */
export function TicketForm({ clients, assets, chooseClient, meId, presetClientId, presetAssetId, idPrefix: p, submitLabel, cancelTo, onSubmit }: Props) {
  const { policyOf, now } = useStore();
  const initialClient = clients.find((c) => c.id === presetClientId)?.id ?? (chooseClient ? '' : (clients[0]?.id ?? ''));
  const [clientId, setClientId] = useState(initialClient);
  const assetsOf = (id: string) => assets.filter((a) => a.clientId === id);
  const pickAsset = (id: string, preset?: string | null) => {
    const list = assetsOf(id);
    return list.some((a) => a.id === preset) ? preset! : list.length === 1 ? list[0].id : '';
  };
  const [assetId, setAssetId] = useState(pickAsset(initialClient, presetAssetId));
  const [reporterId, setReporterId] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [category, setCategory] = useState<Category | ''>('');
  const [answers, setAnswers] = useState<(boolean | null)[]>([null, null, null]);
  const [submitted, setSubmitted] = useState(false);

  const client = clients.find((c) => c.id === clientId);
  const people = client?.users ?? [];
  const clientAssets = assetsOf(clientId);
  const tech = category === 'tech';
  const priority = tech ? priorityFromAnswers(answers) : null;
  // Before a client is picked, the default policy gives the timings.
  const targets = policyOf(clientId).targets;

  const errors = {
    client: chooseClient && !clientId ? 'Choose a client.' : '',
    requestedBy: reporterId ? '' : 'Choose who is asking.',
    asset: assetId ? '' : 'Choose an asset.',
    title: title.trim().length < 5 ? 'Add a short title.' : '',
    details: details.trim().length < 10 ? 'Describe what happened.' : '',
    category: category ? '' : 'Choose a category.',
    impact: tech && !priority ? 'Answer the questions to set the priority.' : '',
  };
  const firstError = (Object.keys(errors) as (keyof typeof errors)[]).find((k) => errors[k]);
  const err = (k: keyof typeof errors) => (submitted ? errors[k] : '');

  const changeClient = (id: string) => {
    setClientId(id);
    setAssetId(pickAsset(id));
    setReporterId('');
  };
  const answer = (i: number, yes: boolean) => setAnswers((prev) => prev.map((v, j) => (j < i ? v : j === i ? yes : null)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (firstError || !category) {
      const target = firstError === 'impact' ? `${p}-q${answers.findIndex((a) => a == null)}-yes` : `${p}-${firstError}`;
      document.getElementById(target)?.focus();
      return;
    }
    onSubmit({ clientId, assetId, reporterId, title: title.trim(), description: details.trim(), attachments: files, category, severity: tech ? priority : null });
  };

  return (
    <form className="portal-form" onSubmit={submit} noValidate>
      {chooseClient && (
        <Field label="Client" htmlFor={`${p}-client`} error={err('client')}>
          <Dropdown id={`${p}-client`} value={clientId} onChange={changeClient} placeholder="Select a client" invalid={!!err('client')} options={clients.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
      )}
      <Field label="Requested by" htmlFor={`${p}-requestedBy`} error={err('requestedBy')}>
        <Dropdown
          id={`${p}-requestedBy`}
          value={reporterId}
          onChange={setReporterId}
          placeholder={client ? 'Select a person' : 'Choose a client first'}
          invalid={!!err('requestedBy')}
          options={people.map((u) => ({ value: u.id, label: u.id === meId ? `${u.name} (you)` : u.name, description: u.title }))}
        />
      </Field>
      <Field label="Asset" htmlFor={`${p}-asset`} error={err('asset')}>
        <Dropdown id={`${p}-asset`} value={assetId} onChange={setAssetId} placeholder={client ? 'Select an asset' : 'Choose a client first'} invalid={!!err('asset')} options={clientAssets.map((a) => ({ value: a.id, label: a.name }))} />
      </Field>
      <Field label="Title" htmlFor={`${p}-title`} error={err('title')}>
        <input id={`${p}-title`} className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Checkout page shows a blank screen" maxLength={120} aria-invalid={!!err('title') || undefined} />
      </Field>
      <Field label="Details" htmlFor={`${p}-details`} error={err('details')}>
        <RichInput
          id={`${p}-details`}
          value={details}
          onChange={setDetails}
          files={files}
          onFilesChange={setFiles}
          rows={4}
          invalid={!!err('details')}
          placeholder="What happened, where, and who is affected?"
        />
      </Field>
      <Field label="Issue category" htmlFor={`${p}-category`} error={err('category')}>
        <Dropdown
          id={`${p}-category`}
          value={category}
          onChange={(c) => {
            setCategory(c);
            setAnswers([null, null, null]);
          }}
          placeholder="Select a category"
          invalid={!!err('category')}
          // Only Tech has its impact questions so far; the others show, but wait.
          options={NEW_TICKET_CATEGORIES.map((c) => {
            const open = OPEN_TICKET_CATEGORIES.includes(c);
            return { value: c, label: CATEGORY_LABEL[c], description: CATEGORY_HINT[c], disabled: !open, badge: open ? undefined : 'Coming soon' };
          })}
        />
      </Field>

      {tech && (
        <fieldset className="impact" aria-describedby={err('impact') ? `${p}-impact-error` : undefined}>
          <legend className="field-label">How serious is it?</legend>
          <p className="impact-intro">A few yes or no questions. Your answers set the priority, which decides how fast NXS responds.</p>
          <ol className="impact-list">
            {PRIORITY_QUESTIONS.map((q, i) => {
              // Each question opens once the one above it is a no.
              if (i > 0 && answers[i - 1] !== false) return null;
              return (
                <li key={q.severity} className={cx('impact-q', answers[i] === true && 'is-yes', answers[i] === false && 'is-no')}>
                  <span className="impact-num" aria-hidden>
                    {i + 1}
                  </span>
                  <p className="impact-text" id={`${p}-q${i}-text`}>
                    {q.text}
                  </p>
                  <span className="impact-yn" role="radiogroup" aria-labelledby={`${p}-q${i}-text`}>
                    <button type="button" id={`${p}-q${i}-yes`} role="radio" aria-checked={answers[i] === true} className={cx('impact-btn', 'is-yes', answers[i] === true && 'is-on')} onClick={() => answer(i, true)}>
                      <Check size={15} aria-hidden />
                      Yes
                    </button>
                    <button type="button" id={`${p}-q${i}-no`} role="radio" aria-checked={answers[i] === false} className={cx('impact-btn', 'is-no', answers[i] === false && 'is-on')} onClick={() => answer(i, false)}>
                      <X size={15} aria-hidden />
                      No
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
          {err('impact') && (
            <p className="field-error" id={`${p}-impact-error`}>
              {err('impact')}
            </p>
          )}
        </fieldset>
      )}

      {priority && (
        <section className={cx('impact-result', `tone-${PRIORITY_TONE[priority]}`)} aria-live="polite" aria-labelledby={`${p}-result-title`}>
          <div className="impact-result-head">
            <SeverityBadge severity={priority} />
            <div>
              <p className="impact-result-title" id={`${p}-result-title`}>
                Based on your answers, this is {PRIORITY_PROMISE[priority].word === 'urgent' ? 'an urgent issue' : `${PRIORITY_PROMISE[priority].word} priority`}
              </p>
              <p className="impact-result-meaning">Because {PRIORITY_PROMISE[priority].because}.</p>
            </div>
          </div>
          <div className="impact-next">
            <p className="impact-next-title">What happens next</p>
            <ul className="impact-steps">
              <li>
                <MessageSquare size={16} aria-hidden />
                <span>
                  NXS replies within <strong>{fmtTarget(targets[priority].firstResponseMins)}</strong>, {PRIORITY_PROMISE[priority].hours}.
                </span>
              </li>
              {(priority === 'critical' || PRIORITY_PROMISE[priority].stopgap) && (
                <li>
                  <LifeBuoy size={16} aria-hidden />
                  <span>
                    If it takes longer to fix, we’ll get you a way around it{' '}
                    <strong>{priority === 'critical' ? `within ${fmtTarget(targets.critical.resolutionMins / 2)}` : PRIORITY_PROMISE[priority].stopgap}</strong>.
                  </span>
                </li>
              )}
              <li>
                <Bell size={16} aria-hidden />
                <span>
                  You get an update <strong>{PRIORITY_PROMISE[priority].updates}</strong>.
                </span>
              </li>
              <li>
                <CalendarCheck size={16} aria-hidden />
                <span>
                  We aim to have it fixed by <strong>{fmtWeekday(now + targets[priority].resolutionMins * 60_000)}, {fmtDate(now + targets[priority].resolutionMins * 60_000)}</strong>.
                </span>
              </li>
            </ul>
          </div>
        </section>
      )}

      <div className="portal-form-actions">
        <Link to={cancelTo} className="btn btn-secondary">
          Cancel
        </Link>
        <Button variant="primary" type="submit">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
