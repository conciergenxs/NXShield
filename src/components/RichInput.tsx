import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { FileCode, FileText, Image as ImageIcon, Paperclip, Video, X, type LucideIcon } from 'lucide-react';
import type { Attachment } from '../types';
import { TextArea, cx } from './ui';

const FILE_ICON: Record<Attachment['kind'], LucideIcon> = { image: ImageIcon, doc: FileText, log: FileCode, video: Video };

function fileKind(name: string): Attachment['kind'] {
  if (/\.(png|jpe?g|gif|webp|heic|avif)$/i.test(name)) return 'image';
  if (/\.(mp4|mov|webm)$/i.test(name)) return 'video';
  if (/\.(log|txt|json|har)$/i.test(name)) return 'log';
  return 'doc';
}
const fileSize = (bytes: number) => (bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);

let seq = 0;
/** A picked, pasted or dropped file as an attachment. Pictures and videos keep a local link so they can be shown. */
export function toAttachment(f: File): Attachment {
  // Pasted screenshots arrive as "image.png"; give them a name worth reading.
  const name = f.name && f.name !== 'image.png' ? f.name : `screenshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
  const kind = f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : fileKind(name);
  return { id: `att-in-${Date.now()}-${++seq}`, name, size: fileSize(f.size), kind, url: kind === 'image' || kind === 'video' ? URL.createObjectURL(f) : undefined };
}

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  files: Attachment[];
  onFilesChange: (files: Attachment[]) => void;
  placeholder?: string;
  rows?: number;
  invalid?: boolean;
  autoFocus?: boolean;
}

/**
 * One box for a message and what goes with it, like a chat input: type the
 * text, then paste a screenshot, drop files on it or pick them with the clip.
 * Attachments sit inside the box, under the text.
 */
export function RichInput({ id, value, onChange, files, onFilesChange, placeholder, rows = 4, invalid, autoFocus }: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const add = (list: FileList | File[]) => {
    const picked = [...list].map(toAttachment);
    if (picked.length) onFilesChange([...files, ...picked]);
  };
  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');

  const onPaste = (e: ClipboardEvent) => {
    if (e.clipboardData.files.length) {
      e.preventDefault();
      add(e.clipboardData.files);
    }
  };

  return (
    <div
      className={cx('rich-input', dragging && 'is-dragging', invalid && 'is-invalid')}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        add(e.dataTransfer.files);
      }}
    >
      <TextArea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} onPaste={onPaste} placeholder={placeholder} aria-invalid={invalid || undefined} data-autofocus={autoFocus || undefined} />

      {files.length > 0 && (
        <ul className="rich-input-files" aria-label="Attached">
          {files.map((f) => {
            const Icon = FILE_ICON[f.kind];
            const picture = f.kind === 'image' && f.url;
            return (
              <li key={f.id} className={cx('rich-input-file', picture && 'is-picture')} title={`${f.name}, ${f.size}`}>
                {picture ? (
                  <img src={f.url} alt={f.name} />
                ) : (
                  <>
                    <Icon size={16} aria-hidden />
                    <span className="truncate">{f.name}</span>
                    <span className="muted">{f.size}</span>
                  </>
                )}
                <button type="button" className="rich-input-remove" aria-label={`Remove ${f.name}`} onClick={() => onFilesChange(files.filter((x) => x.id !== f.id))}>
                  <X size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="rich-input-bar">
        <button type="button" className="rich-input-attach" onClick={() => picker.current?.click()}>
          <Paperclip size={15} aria-hidden />
          Add screenshots or files
        </button>
        <span className="rich-input-hint">or paste and drop them here</span>
        <input
          ref={picker}
          id={`${id}-files`}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            add(e.target.files ?? []);
            e.target.value = '';
          }}
        />
      </div>

      {dragging && (
        <div className="rich-input-drop" aria-hidden>
          Drop to attach
        </div>
      )}
    </div>
  );
}
