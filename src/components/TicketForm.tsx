import { useRef, useState, type FormEvent } from 'react';
import { Clapperboard, Play, Plus, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Attachment, Category, Client } from '../types';
import { CATEGORIES, CATEGORY_LABEL } from '../lib/domain';
import { Dropdown } from './pickers';
import { toAttachment } from './RichInput';
import { Button, Field, TextArea, cx } from './ui';

export interface TicketFormValues {
  clientId: string;
  reporterId: string;
  category: Category;
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
 * Creating a ticket: its category, a title and what happened, with
 * screenshots or other files in the same box. The category is the reporter's
 * call, from the ones their PIC may raise (set in Settings); with only one,
 * it is picked for them. The AI reads the rest, fills in the asset, the
 * priority and who works on it, and sends the first reply; the client's PM
 * reviews it.
 * NXS logging a ticket for a client also says which client and which of
 * their PICs reported it.
 */
export function TicketForm({ clients, chooseClient, meId, presetClientId, idPrefix: p, submitLabel, cancelTo, onSubmit }: Props) {
  const initialClient = clients.find((c) => c.id === presetClientId)?.id ?? (chooseClient ? '' : (clients[0]?.id ?? ''));
  const [clientId, setClientId] = useState(initialClient);
  const [reporterId, setReporterId] = useState(chooseClient ? '' : (meId ?? ''));
  const [category, setCategory] = useState<Category | ''>('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [videoError, setVideoError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const client = clients.find((c) => c.id === clientId);
  const reporter = client?.users.find((u) => u.id === reporterId);
  // What this PIC may raise, in the usual order; one choice is made for them.
  const allowed = CATEGORIES.filter((c) => reporter?.categories.includes(c));
  const picked: Category | '' = allowed.length === 1 ? allowed[0] : allowed.includes(category as Category) ? category : '';
  const errors = {
    client: chooseClient && !clientId ? 'Choose a client.' : '',
    reporter: reporterId ? '' : 'Choose who reported it.',
    category: !reporter ? '' : allowed.length === 0 ? `${reporter.name} can’t raise tickets yet. Set their categories in Settings › Workspace.` : picked ? '' : 'Choose a category.',
    title: title.trim().length < 5 ? 'Add a short title.' : '',
    details: details.trim().length < 10 ? 'Describe what happened.' : '',
    video: files.length === 0 ? 'Add a screen recording of the incident.' : '',
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
    onSubmit({ clientId, reporterId, category: picked as Category, title: title.trim(), description: details.trim(), attachments: files });
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
          <Field label="Reported by" htmlFor={`${p}-reporter`} error={err('reporter')}>
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
      {(reporter || !chooseClient) && (
        <Field label="Category" htmlFor={`${p}-category`} error={err('category')}>
          {/* All three are shown; the ones this PIC may not raise are disabled. */}
          <div className="cat-choices" role="radiogroup" id={`${p}-category`} aria-label="Category" tabIndex={-1}>
            {CATEGORIES.map((c) => {
              const off = !allowed.includes(c);
              return (
                <label key={c} className={cx('cat-choice', picked === c && 'is-on', off && 'is-off')} aria-disabled={off || undefined}>
                  <input type="radio" name={`${p}-category`} value={c} checked={picked === c} disabled={off} onChange={() => setCategory(c)} />
                  <span className="cat-choice-text">
                    <strong>{CATEGORY_LABEL[c]}</strong>
                  </span>
                </label>
              );
            })}
          </div>
        </Field>
      )}
      <Field label="Title" htmlFor={`${p}-title`} error={err('title')}>
        <input id={`${p}-title`} className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Checkout page shows a blank screen" maxLength={120} aria-invalid={!!err('title') || undefined} />
      </Field>
      <Field label="Description" htmlFor={`${p}-details`} error={err('details')}>
        <TextArea id={`${p}-details`} rows={5} value={details} onChange={(e) => setDetails(e.target.value)} aria-invalid={!!err('details') || undefined} placeholder="What happened, where, and who is affected?" />
      </Field>
      <Field label="Screen recording of the incident" htmlFor={`${p}-video`} error={videoError || err('video')}>
        <VideoDrop id={`${p}-video`} files={files} onChange={setFiles} onReject={setVideoError} invalid={!!(videoError || err('video'))} />
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

/** Screen recordings only: pick or drop video files; anything else is turned away. */
function VideoDrop({ id, files, onChange, onReject, invalid }: { id: string; files: Attachment[]; onChange: (files: Attachment[]) => void; onReject: (error: string) => void; invalid?: boolean }) {
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const add = (list: FileList | File[]) => {
    const all = [...list];
    const videos = all.filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(f.name));
    onReject(videos.length < all.length ? 'Only video files can be added here.' : '');
    if (videos.length) onChange([...files, ...videos.map(toAttachment)]);
  };
  const some = files.length > 0;
  return (
    <div
      className={cx('video-drop', some && 'has-files', dragging && 'is-dragging', invalid && 'is-invalid')}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        add(e.dataTransfer.files);
      }}
    >
      {some && (
        <ul className="video-drop-files" aria-label="Screen recordings">
          {files.map((f) => (
            <VideoItem key={f.id} file={f} onRemove={() => onChange(files.filter((x) => x.id !== f.id))} />
          ))}
        </ul>
      )}
      {some ? (
        <button id={id} type="button" className="video-drop-pick is-add" onClick={() => picker.current?.click()}>
          <span className="video-drop-line">
            <Plus size={16} aria-hidden />
            <strong>{dragging ? 'Drop the video to add it' : 'Add another video'}</strong>
            {!dragging && <span className="muted">or drop it here</span>}
          </span>
        </button>
      ) : (
        // The whole area opens the picker; the button is the keyboard way in.
        <div className="video-drop-pick" onClick={() => picker.current?.click()}>
          <span className="video-drop-icon" aria-hidden>
            <Clapperboard size={18} />
          </span>
          <span className="video-drop-line">
            <strong>{dragging ? 'Drop the video to add it' : 'Upload video'}</strong>
            {!dragging && <span className="muted">or drop it here</span>}
          </span>
          <small>MP4, MOV or WebM</small>
          <button
            id={id}
            type="button"
            className="btn btn-secondary btn-sm video-drop-choose"
            onClick={(e) => {
              e.stopPropagation();
              picker.current?.click();
            }}
          >
            Choose file
          </button>
        </div>
      )}
      <input
        ref={picker}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
        multiple
        hidden
        onChange={(e) => {
          add(e.target.files ?? []);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/** One added recording: its first frame, name, size and length. */
function VideoItem({ file, onRemove }: { file: Attachment; onRemove: () => void }) {
  const [length, setLength] = useState<string | null>(null);
  return (
    <li className="video-drop-file">
      <span className="video-drop-thumb">
        {file.url && (
          <video
            src={`${file.url}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d)) setLength(`${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}`);
            }}
          />
        )}
        <Play size={14} aria-hidden />
      </span>
      <span className="video-drop-meta">
        <span className="truncate">{file.name}</span>
        <small>{length ? `${file.size} · ${length}` : file.size}</small>
      </span>
      <button type="button" className="icon-btn" aria-label={`Remove ${file.name}`} onClick={onRemove}>
        <X size={15} aria-hidden />
      </button>
    </li>
  );
}
