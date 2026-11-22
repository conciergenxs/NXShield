import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Attachment, TicketRequest } from '../types';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, FileCode, FileText, Image as ImageIcon, Play, Video, X, type LucideIcon } from 'lucide-react';

/**
 * Above a detail page's container: a way back, the page name and one line
 * about it. Back returns to the list as it was left (filters, view); a direct
 * visit lands on `fallback`.
 */
export function BackHeader({ title, description, fallback, backLabel, actions }: { title: string; description: string; fallback: string; backLabel: string; actions?: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const back = () => (location.key !== 'default' ? navigate(-1) : navigate(fallback));
  return (
    <header className="page-header hero detail-hero" data-hero>
      <div className="page-header-row">
        <div className="page-header-text">
          <div className="detail-hero-title">
            <button type="button" className="back-btn" aria-label={backLabel} onClick={back}>
              <ArrowLeft size={20} aria-hidden />
            </button>
            <h1 className="page-title">{title}</h1>
          </div>
          <p className="page-desc">{description}</p>
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </header>
  );
}

/** One fact in a detail page's side column: a small label with its icon, above a one-line value. */
export function Prop({ icon: Icon, label, title, children }: { icon: LucideIcon; label: string; title?: string; children: ReactNode }) {
  return (
    <div className="prop">
      <dt>
        <Icon size={14} aria-hidden />
        {label}
      </dt>
      <dd title={title}>{children}</dd>
    </div>
  );
}

/** A request's reason and references, under its description. Links in the references open in a new tab. */
export function RequestNotes({ request }: { request: TicketRequest | undefined }) {
  if (!request || (!request.reason && !request.references)) return null;
  const parts = request.references.split(/(\s+)/);
  return (
    <dl className="request-notes">
      {request.reason && (
        <div>
          <dt>Reason</dt>
          <dd>{request.reason}</dd>
        </div>
      )}
      {request.references && (
        <div>
          <dt>References</dt>
          <dd>
            {parts.map((p, i) =>
              /^https?:\/\/\S+$/.test(p) ? (
                <a key={i} href={p} target="_blank" rel="noreferrer">
                  {p}
                </a>
              ) : (
                p
              ),
            )}
          </dd>
        </div>
      )}
    </dl>
  );
}

/* ---------- Attachments: pictures and videos shown, files listed ---------- */

const FILE_ICON: Record<Attachment['kind'], LucideIcon> = { image: ImageIcon, doc: FileText, log: FileCode, video: Video };

/** The sample tickets carry file names only, so their pictures are drawn as a
 *  plain page sketch. Real uploads show the file itself. */
function sketch(name: string) {
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const phone = /iphone|android|mobile|phone|app/i.test(name);
  const [w, h] = phone ? [360, 640] : [640, 400];
  const accent = ['#C11FFF', '#0E39FC', '#12805A', '#E08A2E', '#C2009A'][hash % 5];
  const rows = Array.from({ length: phone ? 7 : 4 }, (_, i) => {
    const y = (phone ? 150 : 120) + i * (phone ? 62 : 58);
    const len = 0.45 + ((hash >> i) % 5) / 10;
    return `<rect x="28" y="${y}" width="${Math.round((w - 56) * len)}" height="14" rx="7" fill="#DEDBE6"/><rect x="28" y="${y + 22}" width="${Math.round((w - 56) * (len - 0.2))}" height="10" rx="5" fill="#ECEAF0"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#F6F5FA"/><rect width="${w}" height="56" fill="#fff"/><circle cx="34" cy="28" r="10" fill="${accent}"/><rect x="54" y="22" width="96" height="12" rx="6" fill="#DEDBE6"/><rect x="28" y="${phone ? 76 : 76}" width="${w - 56}" height="${phone ? 56 : 28}" rx="10" fill="${accent}" opacity="0.16"/>${rows}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
const previewOf = (f: Attachment) => f.url ?? sketch(f.name);

export function Attachments({ files }: { files: Attachment[] }) {
  const [open, setOpen] = useState<Attachment | null>(null);
  if (!files.length) return null;
  const media = files.filter((f) => f.kind === 'image' || f.kind === 'video');
  const others = files.filter((f) => f.kind !== 'image' && f.kind !== 'video');
  return (
    <div className="attachments-block">
      {media.length > 0 && (
        <ul className="media-grid">
          {media.map((f) => (
            <li key={f.id}>
              <button type="button" className="media-tile" onClick={() => setOpen(f)} aria-label={`Open ${f.name}`}>
                <span className="media-frame">
                  {f.kind === 'video' && f.url ? <video src={f.url} muted preload="metadata" /> : <img src={previewOf(f)} alt="" loading="lazy" />}
                  {f.kind === 'video' && (
                    <span className="media-play" aria-hidden>
                      <Play size={18} />
                    </span>
                  )}
                </span>
                <span className="media-caption">
                  <span className="truncate">{f.name}</span>
                  <span className="muted">{f.size}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <ul className="attachments">
          {others.map((f) => {
            const Icon = FILE_ICON[f.kind];
            return (
              <li key={f.id} className="attachment">
                <Icon size={18} aria-hidden />
                <span className="truncate">{f.name}</span>
                <span className="muted">{f.size}</span>
              </li>
            );
          })}
        </ul>
      )}
      {open && <Lightbox file={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Lightbox({ file, onClose }: { file: Attachment; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={file.name} onClick={onClose}>
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lightbox-name">
          <span className="truncate">{file.name}</span>
          <span className="lightbox-size">{file.size}</span>
        </span>
        {file.url && (
          <a className="lightbox-btn" href={file.url} download={file.name} aria-label={`Download ${file.name}`}>
            <Download size={18} />
          </a>
        )}
        <button type="button" className="lightbox-btn" onClick={onClose} aria-label="Close preview" autoFocus>
          <X size={18} />
        </button>
      </div>
      <div className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
        {file.kind === 'video' && file.url ? <video src={file.url} controls autoPlay /> : <img src={previewOf(file)} alt={file.name} />}
      </div>
    </div>,
    document.body,
  );
}
