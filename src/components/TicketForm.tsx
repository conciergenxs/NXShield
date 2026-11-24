import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Attachment, Client } from '../types';
import { Dropdown } from './pickers';
import { RichInput } from './RichInput';
import { Button, Field } from './ui';

export interface TicketFormValues {
  clientId: string;
  reporterId: string;
  title: string;
  description: string;
  attachments: Attachment[];
}

interface Props {
  /** The clients a ticket can be for. Staff pick one; in the portal there is only theirs. */
  clients: Client[];
  /** NXS logging a ticket picks the client and the client's PIC who reported it. */
  chooseClient: boolean;
  /** In the portal: the signed-in client user, who is the reporter. */
  meId?: string;
  presetClientId?: string | null;
  /** Prefix for field ids, so the portal and the dashboard forms stay apart. */
  idPrefix: string;
  submitLabel: string;
  cancelTo: string;
  onSubmit: (values: TicketFormValues) => void;
}

/**
 * Creating a ticket: a title and what happened, with screenshots or other
 * files in the same box. Nothing else to choose. The AI reads it and fills in
 * the asset, the category, the priority and who works on it; QA checks that.
 * NXS logging a ticket for a client also says which client and which of
 * their PICs reported it.
 */
export function TicketForm({ clients, chooseClient, meId, presetClientId, idPrefix: p, submitLabel, cancelTo, onSubmit }: Props) {
  const initialClient = clients.find((c) => c.id === presetClientId)?.id ?? (chooseClient ? '' : (clients[0]?.id ?? ''));
  const [clientId, setClientId] = useState(initialClient);
  const [reporterId, setReporterId] = useState(chooseClient ? '' : (meId ?? ''));
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const client = clients.find((c) => c.id === clientId);
  const errors = {
    client: chooseClient && !clientId ? 'Choose a client.' : '',
    reporter: reporterId ? '' : 'Choose who reported it.',
    title: title.trim().length < 5 ? 'Add a short title.' : '',
    details: details.trim().length < 10 ? 'Describe what happened.' : '',
  };
  const firstError = (Object.keys(errors) as (keyof typeof errors)[]).find((k) => errors[k]);
  const err = (k: keyof typeof errors) => (submitted ? errors[k] : '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (firstError) {
      document.getElementById(`${p}-${firstError}`)?.focus();
      return;
    }
    onSubmit({ clientId, reporterId, title: title.trim(), description: details.trim(), attachments: files });
  };

  return (
    <form className="portal-form" onSubmit={submit} noValidate>
      {chooseClient && (
        <>
          <Field label="Client" htmlFor={`${p}-client`} error={err('client')}>
            <Dropdown
              id={`${p}-client`}
              value={clientId}
              onChange={(id) => {
                setClientId(id);
                setReporterId('');
              }}
              placeholder="Select a client"
              invalid={!!err('client')}
              options={clients.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>
          <Field label="Reported by" htmlFor={`${p}-reporter`} hint="The client’s PIC who reported it." error={err('reporter')}>
            <Dropdown
              id={`${p}-reporter`}
              value={reporterId}
              onChange={setReporterId}
              placeholder={client ? 'Select a person' : 'Choose a client first'}
              invalid={!!err('reporter')}
              options={(client?.users ?? []).map((u) => ({ value: u.id, label: u.name, description: u.title }))}
            />
          </Field>
        </>
      )}
      <Field label="Title" htmlFor={`${p}-title`} error={err('title')}>
        <input id={`${p}-title`} className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Checkout page shows a blank screen" maxLength={120} aria-invalid={!!err('title') || undefined} />
      </Field>
      <Field label="Description" htmlFor={`${p}-details`} error={err('details')}>
        <RichInput
          id={`${p}-details`}
          value={details}
          onChange={setDetails}
          files={files}
          onFilesChange={setFiles}
          rows={5}
          invalid={!!err('details')}
          placeholder="What happened, where, and who is affected? Add screenshots or a screen recording if you have them."
        />
      </Field>

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
