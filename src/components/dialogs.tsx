import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Braces, Check, Globe, ImagePlus, Radar, Search, Trash2, Upload } from 'lucide-react';
import type { AssetCategory, Attachment, MonitorMethod, SlaExclusionKind, TaskType, TicketStatus } from '../types';
import { SLA_EXCLUSION_HINT, SLA_EXCLUSION_LABEL, ASSET_CATEGORIES, ASSET_CATEGORY_LABEL, AVAILABILITY_LABEL, UNBLOCK_TO, moveLabel, MONITOR_INTERVALS, MONITOR_METHODS, MONITOR_METHOD_HINT, MONITOR_METHOD_LABEL, STATUS_LABEL, TASK_TYPES, TASK_TYPE_LABEL } from '../lib/domain';
import { useStore } from '../store';
import { verifiedDraft } from '../lib/rcaAi';
import { Avatar, Button, Field, Modal, Select, TextArea, cx } from './ui';
import { RichInput } from './RichInput';
import { Dropdown } from './pickers';
import { clock } from '../data/seed';

export function Dialogs() {
  const { dialog } = useStore();
  if (!dialog) return null;
  if (dialog.type === 'cancel') return <CancelTicketDialog ticketId={dialog.ticketId} />;
  if (dialog.type === 'resolve') return <ResolveTicketDialog ticketId={dialog.ticketId} />;
  if (dialog.type === 'block') return <BlockTicketDialog ticketId={dialog.ticketId} />;
  if (dialog.type === 'move-note') return <MoveNoteDialog ticketId={dialog.ticketId} to={dialog.to} />;
  if (dialog.type === 'request-approval') return <RequestApprovalDialog ticketId={dialog.ticketId} />;
  if (dialog.type === 'sla-exclusion') return <SlaExclusionDialog ticketId={dialog.ticketId} />;
  if (dialog.type === 'unblock') return <UnblockTicketDialog ticketId={dialog.ticketId} />;
  if (dialog.type === 'add-client') return <AddClientDialog />;
  if (dialog.type === 'add-user') return <AddClientUserDialog clientId={dialog.clientId} />;
  if (dialog.type === 'add-asset') return <AddAssetDialog clientId={dialog.clientId} />;
  if (dialog.type === 'assign') return <AssignDialog ticketId={dialog.ticketId} then={dialog.then} />;
  return null;
}



/** The ticket a dialog acts on: its id and title, quietly, above the form. */
function DialogSubject({ id, title }: { id: string; title: string }) {
  return (
    <div className="dialog-subject">
      <span className="dialog-subject-id">{id}</span>
      <span className="dialog-subject-title">{title}</span>
    </div>
  );
}

/* ---------- Cancel a ticket ---------- */

const CANCEL_PRESETS = ['Client withdrew the request', 'Duplicate of another ticket', 'Could not be reproduced', 'Out of scope', 'Other'];

function CancelTicketDialog({ ticketId }: { ticketId: string }) {
  const { ticketOf, changeStatus, setDialog } = useStore();
  const ticket = ticketOf(ticketId);
  const [preset, setPreset] = useState(CANCEL_PRESETS[0]);
  const [details, setDetails] = useState('');
  const [submitted, setSubmitted] = useState(false);
  if (!ticket) return null;
  const needsDetails = preset === 'Other';
  const error = needsDetails && details.trim().length < 5 ? 'Explain why this ticket is canceled.' : '';
  const close = () => setDialog(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (error) return;
    const reason = needsDetails ? details.trim() : details.trim() ? `${preset}. ${details.trim()}` : `${preset}.`;
    if (changeStatus(ticket.id, 'canceled', { reason })) close();
  };

  return (
    <Modal
      title="Cancel this ticket?"
      description="The work stops here. The client sees it as canceled, and the reason goes into the activity history."
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Keep ticket
          </Button>
          <Button variant="danger" type="submit" form="cancel-ticket">
            Cancel ticket
          </Button>
        </>
      }
    >
      <form id="cancel-ticket" className="form-stack" onSubmit={submit} noValidate>
        <DialogSubject id={ticket.id} title={ticket.title} />
        <Field label="Reason" htmlFor="cl-reason">
          <Select id="cl-reason" value={preset} onChange={setPreset} options={CANCEL_PRESETS.map((p) => ({ value: p, label: p }))} />
        </Field>
        <Field label="Details" optional={!needsDetails} htmlFor="cl-details" error={submitted ? error : ''}>
          <TextArea id="cl-details" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Confirmed by phone with their marketing lead on 14 Nov." data-autofocus />
        </Field>
      </form>
    </Modal>
  );
}

/* ---------- Blocker: why the work stopped, and where it picks up again ---------- */

function BlockTicketDialog({ ticketId }: { ticketId: string }) {
  const { ticketOf, changeStatus, setDialog } = useStore();
  const ticket = ticketOf(ticketId);
  const [details, setDetails] = useState('');
  const [submitted, setSubmitted] = useState(false);
  if (!ticket) return null;
  const error = details.trim().length < 5 ? 'Say what is blocking the work.' : '';
  const close = () => setDialog(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (error) return;
    if (changeStatus(ticket.id, 'blocked', { reason: details })) close();
  };

  return (
    <Modal
      title="Move to Blocked"
      description="Work pauses until this clears. Only NXS sees it; the client still sees In progress."
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="block-ticket">
            Move to Blocked
          </Button>
        </>
      }
    >
      <form id="block-ticket" className="form-stack" onSubmit={submit} noValidate>
        <DialogSubject id={ticket.id} title={ticket.title} />
        <Field label="What’s blocking it?" htmlFor="bk-details" error={submitted ? error : ''}>
          <TextArea id="bk-details" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="The store locator page has no UI design yet." data-autofocus />
        </Field>
      </form>
    </Modal>
  );
}

/* ---------- Outside the SLA: one of the SLA's exclusions applies ---------- */

const EXCLUSION_KINDS = Object.keys(SLA_EXCLUSION_LABEL) as SlaExclusionKind[];

function SlaExclusionDialog({ ticketId }: { ticketId: string }) {
  const { ticketOf, setSlaExclusion, setDialog } = useStore();
  const ticket = ticketOf(ticketId);
  const [kind, setKind] = useState<SlaExclusionKind | ''>('');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  if (!ticket) return null;
  const close = () => setDialog(null);
  const current = ticket.slaExclusion;

  if (current)
    return (
      <Modal
        title="Count against the SLA again?"
        description="Its deadlines start counting again, and late ones show as late."
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Keep outside
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setSlaExclusion(ticket.id, null);
                close();
              }}
            >
              Count it again
            </Button>
          </>
        }
      >
        <div className="form-stack">
          <DialogSubject id={ticket.id} title={ticket.title} />
          <p className="dialog-note">
            Outside the SLA as <strong>{SLA_EXCLUSION_LABEL[current.kind].toLowerCase()}</strong>. {current.note}
          </p>
        </div>
      </Modal>
    );

  const errors = { kind: kind ? '' : 'Choose a reason.', note: note.trim().length < 5 ? 'Say what happened.' : '' };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (errors.kind || errors.note) return;
    setSlaExclusion(ticket.id, { kind: kind as SlaExclusionKind, note });
    close();
  };
  return (
    <Modal
      title="Mark outside the SLA"
      description="Only for the SLA’s exclusions. Its deadlines stop counting; the ticket stays open and keeps moving."
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="sla-exclusion">
            Mark outside SLA
          </Button>
        </>
      }
    >
      <form id="sla-exclusion" className="form-stack" onSubmit={submit} noValidate>
        <DialogSubject id={ticket.id} title={ticket.title} />
        <Field label="Reason" htmlFor="ex-kind" error={submitted ? errors.kind : ''}>
          <Dropdown
            id="ex-kind"
            value={kind}
            onChange={(v) => setKind(v as SlaExclusionKind)}
            placeholder="Choose a reason"
            invalid={submitted && !!errors.kind}
            options={EXCLUSION_KINDS.map((k) => ({ value: k, label: SLA_EXCLUSION_LABEL[k], description: SLA_EXCLUSION_HINT[k] }))}
          />
        </Field>
        <Field label="What happened" htmlFor="ex-note" error={submitted ? errors.note : ''}>
          <TextArea id="ex-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: the WhatsApp provider was down from 10:00 to 11:30." />
        </Field>
      </form>
    </Modal>
  );
}

/* ---------- Ready to deploy: testing passed; the resolution notes and proof go to the client ---------- */

function RequestApprovalDialog({ ticketId }: { ticketId: string }) {
  const { ticketOf, assetOf, changeStatus, setDialog } = useStore();
  const ticket = ticketOf(ticketId);
  // Drafted already, so it only needs checking and anything specific added.
  const [note, setNote] = useState(() => (ticket ? verifiedDraft(assetOf(ticket.assetId)?.name ?? 'the asset') : ''));
  const [files, setFiles] = useState<Attachment[]>([]);
  const [submitted, setSubmitted] = useState(false);
  if (!ticket) return null;
  const errors = {
    note: note.trim().length < 10 ? 'Say what was done.' : '',
    proof: files.length === 0 ? 'Add at least one screenshot or video as proof.' : '',
  };
  const close = () => setDialog(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (errors.note || errors.proof) return;
    if (changeStatus(ticket.id, 'ready_to_deploy', { handoff: { note, attachments: files } })) close();
  };

  return (
    <Modal
      title="Ready to deploy"
      description="Testing passed. The resolution notes and proof go to the client, who reads them and deploys."
      onClose={close}
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="request-approval">
            Send to client
          </Button>
        </>
      }
    >
      <form id="request-approval" className="form-stack" onSubmit={submit} noValidate>
        <DialogSubject id={ticket.id} title={ticket.title} />
        <Field label="Resolution notes" htmlFor="ra-note" hint="Drafted for you; add anything specific to this fix. Attach screenshots or a video as proof." error={submitted ? errors.note || errors.proof : ''}>
          <RichInput
            id="ra-note"
            value={note}
            onChange={setNote}
            files={files}
            onFilesChange={setFiles}
            invalid={submitted && !!(errors.note || errors.proof)}
            placeholder="What was done, and how was it checked?"
            autoFocus
          />
        </Field>
      </form>
    </Modal>
  );
}

/* ---------- Rework or reopen: say why ---------- */

function MoveNoteDialog({ ticketId, to }: { ticketId: string; to: TicketStatus }) {
  const { ticketOf, changeStatus, setDialog } = useStore();
  const ticket = ticketOf(ticketId);
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  if (!ticket) return null;
  const label = moveLabel(ticket.status, to);
  const error = reason.trim().length < 5 ? 'Add a short reason.' : '';
  const close = () => setDialog(null);
  const placeholder: Partial<Record<TicketStatus, string>> = {
    on_testing: 'The map pins still point to the old addresses on Safari.',
    waiting_testing: 'Two outlets are still missing their opening hours.',
    ready_to_deploy: 'Found a layout bug on small phones before the client checked.',
    resolved: 'The client reported the same issue again on the new variants.',
    canceled: 'The client wants this after all; the duplicate was closed instead.',
  };
  const description =
    ticket.status === 'resolved' || ticket.status === 'canceled'
      ? 'It goes back to the assignee as In progress.'
      : ticket.status === 'ready_to_deploy'
        ? `It goes back to In progress and leaves the client’s review. The client sees In progress again.`
        : 'It goes back to In progress. Send it to testing again once fixed.';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (error) return;
    if (changeStatus(ticket.id, to, { reason })) close();
  };

  return (
    <Modal
      title={label.title}
      description={description}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="move-note">
            {ticket.status === 'resolved' || ticket.status === 'canceled' ? 'Reopen ticket' : 'Move to In progress'}
          </Button>
        </>
      }
    >
      <form id="move-note" className="form-stack" onSubmit={submit} noValidate>
        <DialogSubject id={ticket.id} title={ticket.title} />
        <Field label={label.ask} htmlFor="mv-reason" error={submitted ? error : ''}>
          <TextArea id="mv-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder[ticket.status]} data-autofocus />
        </Field>
      </form>
    </Modal>
  );
}

const UNBLOCK_HINT: Partial<Record<TicketStatus, string>> = {
  in_progress: 'There is still work to do on the fix.',
  waiting_testing: 'The fix is ready. Send it to testing.',
};

function UnblockTicketDialog({ ticketId }: { ticketId: string }) {
  const { ticketOf, changeStatus, setDialog } = useStore();
  const ticket = ticketOf(ticketId);
  const [to, setTo] = useState<TicketStatus>('in_progress');
  if (!ticket) return null;
  const blocker = ticket.blockers[ticket.blockers.length - 1];
  const close = () => setDialog(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (changeStatus(ticket.id, to)) close();
  };

  return (
    <Modal
      title="Unblock"
      description={blocker ? `Where does the work carry on now that this has cleared? “${blocker.details}”` : 'Where does the work carry on?'}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="unblock-ticket">
            Move to {STATUS_LABEL[to]}
          </Button>
        </>
      }
    >
      <form id="unblock-ticket" className="form-stack" onSubmit={submit} noValidate>
        <div className="choice-cards unblock-choices" role="radiogroup" aria-label="Carry on in">
          {UNBLOCK_TO.map((s) => (
            <label key={s} className={cx('choice-card', to === s && 'is-selected')}>
              <input type="radio" name="ub-to" id={`ub-to-${s}`} value={s} checked={to === s} onChange={() => setTo(s)} className="sr-only" />
              <span className="choice-card-head">
                <span className="choice-card-name">{STATUS_LABEL[s]}</span>
              </span>
              <span className="choice-card-hint">{UNBLOCK_HINT[s]}</span>
            </label>
          ))}
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Resolve without client approval ---------- */

const RESOLVE_PRESETS = ['Client approved outside the portal', 'No response from the client', 'Other'];

function ResolveTicketDialog({ ticketId }: { ticketId: string }) {
  const { ticketOf, reporterOf, changeStatus, setDialog } = useStore();
  const ticket = ticketOf(ticketId);
  const [preset, setPreset] = useState(RESOLVE_PRESETS[0]);
  const [details, setDetails] = useState('');
  const [submitted, setSubmitted] = useState(false);
  if (!ticket) return null;
  const reporter = reporterOf(ticket);
  const needsDetails = preset === 'Other';
  const error = needsDetails && details.trim().length < 5 ? 'Explain why the client approval is skipped.' : '';
  const close = () => setDialog(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (error) return;
    const reason = needsDetails ? details.trim() : details.trim() ? `${preset}. ${details.trim()}` : `${preset}.`;
    if (changeStatus(ticket.id, 'resolved', { reason })) close();
  };

  return (
    <Modal
      title="Resolve without client approval?"
      description={`${
        ticket.status === 'ready_to_deploy' ? `${reporter?.name ?? 'The client'} hasn’t approved the fix yet.` : `It hasn’t gone to ${reporter?.name ?? 'the client'} to approve yet.`
      } The reason goes into the activity history.`}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="resolve-ticket">
            Resolve anyway
          </Button>
        </>
      }
    >
      <form id="resolve-ticket" className="form-stack" onSubmit={submit} noValidate>
        <DialogSubject id={ticket.id} title={ticket.title} />
        <Field label="Reason" htmlFor="rs-reason">
          <Select id="rs-reason" value={preset} onChange={setPreset} options={RESOLVE_PRESETS.map((p) => ({ value: p, label: p }))} />
        </Field>
        <Field label="Details" optional={!needsDetails} htmlFor="rs-details" error={submitted ? error : ''}>
          <TextArea id="rs-details" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Approved by email from their marketing lead on 17 Nov." data-autofocus />
        </Field>
      </form>
    </Modal>
  );
}

/* ---------- Add a client ---------- */

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
const LOGO_MAX_BYTES = 2_000_000;

function initialsOf(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
}

function AddClientDialog() {
  const { clients, addClient, setDialog, toast } = useStore();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [logo, setLogo] = useState<string | undefined>();
  const [logoError, setLogoError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const close = () => setDialog(null);
  const taken = clients.some((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  const errors = {
    name: name.trim().length < 2 ? 'Enter the client’s name.' : taken ? 'A client with this name already exists.' : '',
    industry: industry.trim().length < 3 ? 'Add a few words on what they do.' : '',
  };

  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) return setLogoError('Use a PNG, JPG, SVG or WebP image.');
    if (file.size > LOGO_MAX_BYTES) return setLogoError('Keep the image under 2 MB.');
    const reader = new FileReader();
    reader.onload = () => {
      setLogo(String(reader.result));
      setLogoError('');
    };
    reader.readAsDataURL(file);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (errors.name || errors.industry) return;
    const client = addClient({ name, industry, logoImage: logo });
    close();
    navigate('/settings/workspace');
    toast(`${client.name} added. Next, add the people who raise tickets.`);
  };

  const initials = initialsOf(name);
  return (
    <Modal
      title="Add client"
      description="You can add their users and assets right after."
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="add-client">
            Add client
          </Button>
        </>
      }
    >
      <form id="add-client" className="form-stack" onSubmit={submit} noValidate>
        {/* One row: the preview (click it to pick a file too), what it accepts, and the button. */}
        <div className="logo-field">
          <label htmlFor="ac-logo" className={cx('logo-preview', logo && 'has-image')} title={logo ? 'Replace logo' : 'Upload logo'}>
            {logo ? <img src={logo} alt="" /> : initials || <ImagePlus size={20} aria-hidden />}
          </label>
          <div className="logo-field-text">
            <span className="field-label">
              Logo <span className="field-optional">Optional</span>
            </span>
            {logoError ? <p className="field-error">{logoError}</p> : <p className="field-hint">PNG, JPG, SVG or WebP, up to 2 MB</p>}
          </div>
          <div className="logo-field-actions">
            {logo && (
              <button type="button" className="logo-remove" aria-label="Remove logo" title="Remove logo" onClick={() => setLogo(undefined)}>
                <Trash2 size={16} aria-hidden />
              </button>
            )}
            <label className="btn btn-secondary btn-sm logo-upload">
              <Upload size={15} aria-hidden />
              {logo ? 'Replace' : 'Upload'}
              <input
                id="ac-logo"
                type="file"
                accept={LOGO_TYPES.join(',')}
                className="sr-only"
                onChange={(e) => {
                  pickLogo(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>
        <Field label="Client name" htmlFor="ac-name" error={submitted ? errors.name : ''}>
          <input id="ac-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Aroma Abadi" maxLength={60} data-autofocus />
        </Field>
        <Field label="Short description" htmlFor="ac-industry" error={submitted ? errors.industry : ''}>
          <input id="ac-industry" className="input" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Fragrance & personal care" maxLength={48} />
        </Field>
      </form>
    </Modal>
  );
}

/* ---------- Add a client user ---------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AddClientUserDialog({ clientId }: { clientId: string }) {
  const { clientOf, addClientUser, setDialog, toast } = useStore();
  const client = clientOf(clientId);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitted, setSubmitted] = useState(false);
  if (!client) return null;
  const close = () => setDialog(null);
  const errors = {
    name: name.trim().length < 2 ? 'Enter their full name.' : '',
    email: !EMAIL_RE.test(email.trim()) ? 'Enter a valid work email, for example name@company.com.' : '',
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (errors.name || errors.email) return;
    const user = addClientUser(client.id, { name: name.trim(), title: title.trim(), email: email.trim(), phone: phone.trim() });
    toast(`${user.name} added to ${client.name}`);
    close();
  };

  return (
    <Modal
      title="Add client user"
      description={`Someone at ${client.name} who can raise tickets.`}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="add-user">
            Add user
          </Button>
        </>
      }
    >
      <form id="add-user" className="form-grid" onSubmit={submit} noValidate>
        <div className="span-2">
          <Field label="Full name" htmlFor="au-name" error={submitted ? errors.name : ''}>
            <input id="au-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lucky Salim" data-autofocus />
          </Field>
        </div>
        <div className="span-2">
          <Field label="Job title" htmlFor="au-title" optional>
            <input id="au-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="E-commerce Manager" />
          </Field>
        </div>
        <Field label="Work email" htmlFor="au-email" error={submitted ? errors.email : ''}>
          <input id="au-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
        </Field>
        <Field label="Phone" htmlFor="au-phone" optional>
          <input id="au-phone" type="tel" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+62 812 0000 0000" />
        </Field>
      </form>
    </Modal>
  );
}

/* ---------- Add an asset ---------- */

const MONITOR_ICON: Record<MonitorMethod, typeof Activity> = { health_url: Globe, status_api: Braces, uptime_service: Radar };

/** Where a check usually lives for each method, built from the asset's URL. */
function suggestEndpoint(method: MonitorMethod, url: string) {
  const base = url.trim().replace(/\/+$/, '');
  if (!base || method === 'uptime_service') return '';
  return method === 'health_url' ? `${base}/health` : `${base}/api/status`;
}

function AddAssetDialog({ clientId }: { clientId: string }) {
  const { clientOf, addAsset, setDialog, toast, team } = useStore();
  const client = clientOf(clientId);
  const [name, setName] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [category, setCategory] = useState<AssetCategory>(ASSET_CATEGORIES[0]);
  const [url, setUrl] = useState('');
  const [environment, setEnvironment] = useState<'Production' | 'Staging'>('Production');
  const [method, setMethod] = useState<MonitorMethod>('health_url');
  const [endpoint, setEndpoint] = useState('');
  const [endpointTouched, setEndpointTouched] = useState(false);
  const [token, setToken] = useState('');
  const [interval, setIntervalMins] = useState(MONITOR_INTERVALS[0]);
  const [submitted, setSubmitted] = useState(false);
  if (!client) return null;
  const close = () => setDialog(null);
  // Until someone edits the check URL by hand, it follows the asset URL.
  const checkUrl = endpointTouched ? endpoint : suggestEndpoint(method, url);
  const isUrl = (v: string) => /^https?:\/\/[^\s.]+\.[^\s]+$/.test(v.trim());
  const errors = {
    owner: ownerId ? '' : 'Choose who handles it.',
    name: name.trim().length < 2 ? 'Name the asset the way the client knows it.' : '',
    url: !isUrl(url) ? 'Enter the full address, starting with https://.' : '',
    endpoint: !isUrl(checkUrl) ? 'Enter the URL NXShield should check, starting with https://.' : '',
  };
  const needsToken = method !== 'health_url';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (errors.name || errors.url || errors.endpoint || errors.owner) return;
    const asset = addAsset(client.id, {
      ownerId,
      name: name.trim(),
      category,
      url: url.trim(),
      environment,
      monitor: { method, endpoint: checkUrl.trim(), intervalMins: interval, hasToken: needsToken && token.trim().length > 0 },
    });
    toast(`${asset.name} added. Its status appears after the first check.`);
    close();
  };

  return (
    <Modal
      title="Add asset"
      description={`An asset NXS builds or manages for ${client.name}.`}
      onClose={close}
      width={640}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="add-asset">
            Add asset
          </Button>
        </>
      }
    >
      <form id="add-asset" className="form-blocks" onSubmit={submit} noValidate>
        <section className="form-block" aria-labelledby="aa-asset-title">
          <h3 id="aa-asset-title" className="form-block-title">
            Details
          </h3>
          <div className="form-grid">
            <div className="span-2">
              <Field label="Asset name" htmlFor="aa-name" error={submitted ? errors.name : ''}>
                <input id="aa-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Consumer Website" data-autofocus />
              </Field>
            </div>
            <div className="span-2">
              <Field label="Address" htmlFor="aa-url" error={submitted ? errors.url : ''}>
                <input id="aa-url" type="url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.client.example" />
              </Field>
            </div>
            <div className="span-2">
              <Field label="Handled by" htmlFor="aa-owner" hint="The NXS person on this project. New tickets go to them." error={submitted ? errors.owner : ''}>
                <Select id="aa-owner" value={ownerId} onChange={setOwnerId} options={[{ value: '', label: 'Select a person' }, ...team.map((m) => ({ value: m.id, label: `${m.name}, ${m.title}` }))]} />
              </Field>
            </div>
            <Field label="Category" htmlFor="aa-category">
              <Select id="aa-category" value={category} onChange={setCategory} options={ASSET_CATEGORIES.map((c) => ({ value: c, label: ASSET_CATEGORY_LABEL[c] }))} />
            </Field>
            <Field label="Environment" htmlFor="aa-env">
              <Select
                id="aa-env"
                value={environment}
                onChange={setEnvironment}
                options={[
                  { value: 'Production', label: 'Production' },
                  { value: 'Staging', label: 'Staging' },
                ]}
              />
            </Field>
          </div>
        </section>

        {/* The status is read from a check, never switched by hand. */}
        <section className="form-block" aria-labelledby="aa-check-title">
          <h3 id="aa-check-title" className="form-block-title">
            Live status check
          </h3>
          <p className="form-block-sub">The status updates on its own from this check.</p>

          <div className="choice-cards" role="radiogroup" aria-label="Check method">
            {MONITOR_METHODS.map((m) => {
              const Icon = MONITOR_ICON[m];
              return (
                <label key={m} className={cx('choice-card', method === m && 'is-selected')}>
                  <input type="radio" name="aa-method" id={`aa-method-${m}`} value={m} checked={method === m} onChange={() => setMethod(m)} className="sr-only" />
                  <span className="choice-card-head">
                    <span className="choice-card-icon" aria-hidden>
                      <Icon size={16} />
                    </span>
                    <span className="choice-card-name">{MONITOR_METHOD_LABEL[m]}</span>
                  </span>
                  <span className="choice-card-hint">{MONITOR_METHOD_HINT[m]}</span>
                </label>
              );
            })}
          </div>

          <div className="form-grid check-grid">
            <Field label={method === 'uptime_service' ? 'Monitor API URL' : 'Check URL'} htmlFor="aa-endpoint" error={submitted ? errors.endpoint : ''}>
              <input
                id="aa-endpoint"
                type="url"
                className="input"
                value={checkUrl}
                onChange={(e) => {
                  setEndpointTouched(true);
                  setEndpoint(e.target.value);
                }}
                placeholder={method === 'uptime_service' ? 'https://uptime.example/api/v2/monitors/123' : 'https://www.client.example/health'}
              />
            </Field>
            <Field label="Check every" htmlFor="aa-interval">
              <Select id="aa-interval" value={String(interval)} onChange={(v) => setIntervalMins(Number(v))} options={MONITOR_INTERVALS.map((n) => ({ value: String(n), label: n === 1 ? '1 minute' : `${n} minutes` }))} />
            </Field>
            {needsToken && (
              <div className="span-2">
                <Field label="API token" htmlFor="aa-token" optional hint="Stored securely and never shown again.">
                  <input id="aa-token" type="password" className="input" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste the token" />
                </Field>
              </div>
            )}
          </div>
        </section>
      </form>
    </Modal>
  );
}

/* ---------- Assign support ---------- */

function AssignDialog({ ticketId, then }: { ticketId: string; then?: TicketStatus }) {
  const { ticketOf, team, deptOf, openLoad, assignTicket, setDialog } = useStore();
  const ticket = ticketOf(ticketId);
  const [selected, setSelected] = useState<string>(ticket?.assigneeId ?? '');
  const [query, setQuery] = useState('');
  if (!ticket) return null;
  const close = () => setDialog(null);
  // Who can take it now: available first, then the fewest open tickets.
  const free = (a: string) => (a === 'available' ? 0 : a === 'busy' ? 1 : 2);
  const ordered = [...team].sort((a, b) => free(a.availability) - free(b.availability) || openLoad(a.id) - openLoad(b.id) || a.name.localeCompare(b.name));
  const term = query.trim().toLowerCase();
  const matches = term ? ordered.filter((m) => `${m.name} ${m.title} ${m.level} ${deptOf(m.departmentId)?.name ?? ''}`.toLowerCase().includes(term)) : ordered;
  const submit = () => {
    if (!selected) return;
    assignTicket(ticket.id, selected, then);
    close();
  };

  return (
    <Modal
      title={`Assign ${ticket.id}`}
      description={ticket.title}
      onClose={close}
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!selected} onClick={submit}>
            {then ? `Assign and move to ${STATUS_LABEL[then]}` : 'Assign'}
          </Button>
        </>
      }
    >
      <label className="assign-search assign-dialog-search">
        <Search size={16} aria-hidden />
        <input
          autoFocus
          type="text"
          placeholder="Search by name, role or team"
          aria-label="Search the team"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) {
              e.preventDefault();
              setSelected(matches[0].id);
            }
          }}
        />
        <span className="assign-dialog-count">{matches.length} of {team.length}</span>
      </label>
      <ul className="assign-list" role="radiogroup" aria-label="Support member">
        {matches.length === 0 && <li className="assign-empty">No one matches “{query.trim()}”.</li>}
        {matches.map((m) => {
          const isSelected = selected === m.id;
          return (
            <li key={m.id}>
              <label className={cx('assign-row', isSelected && 'is-selected')}>
                <input className="sr-only" type="radio" name="assignee" value={m.id} checked={isSelected} onChange={() => setSelected(m.id)} />
                <Avatar name={m.name} size={36} src={m.photo} />
                <span className="assign-main">
                  <span className="assign-name">{m.name}</span>
                  <span className="assign-role">
                    {m.title}, {m.level} {deptOf(m.departmentId)?.name}
                  </span>
                </span>
                <span className="assign-side">
                  <span className={cx('assign-status', `is-${m.availability}`)}>{AVAILABILITY_LABEL[m.availability]}</span>
                  <span className="assign-load">{openLoad(m.id)} open</span>
                </span>
                <span className={cx('assign-check', isSelected && 'is-on')} aria-hidden>
                  {isSelected && <Check size={14} strokeWidth={3} />}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
