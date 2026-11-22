import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { initials } from '../lib/format';

type Cx = string | false | null | undefined;
export const cx = (...parts: Cx[]) => parts.filter(Boolean).join(' ');

/* ---------- Button ---------- */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', icon, children, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', !children && 'btn-icon', className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

/* ---------- Card ---------- */

export function Card({ children, className, flush }: { children: ReactNode; className?: string; flush?: boolean }) {
  return <section className={cx('card', flush && 'card-flush', className)}>{children}</section>;
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <header className="card-header">
      <div>
        <h2 className="card-title">{title}</h2>
        {description && <p className="card-desc">{description}</p>}
      </div>
      {action && <div className="card-action">{action}</div>}
    </header>
  );
}

/* ---------- Page header ---------- */

/**
 * The page header sits on the colour band (see Layout), so everything inside it
 * uses the on-dark styles under .hero. `children` renders below the title row,
 * for tabs or filters that belong with the header.
 */
export function PageHeader({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-header hero" data-hero>
      <div className="page-header-row">
        <div className="page-header-text">
          <h1 className="page-title">{title}</h1>
          {description && <p className="page-desc">{description}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {children && <div className="page-header-tools">{children}</div>}
    </header>
  );
}

/* ---------- Form controls ---------- */

export interface Option<T extends string = string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  /** Shown inside the control before the value, e.g. "Client". */
  prefix?: string;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function Select<T extends string>({ value, onChange, options, prefix, ariaLabel, size = 'md', disabled, className, id }: SelectProps<T>) {
  return (
    <span className={cx('select', size === 'sm' && 'select-sm', disabled && 'is-disabled', className)}>
      {prefix && <span className="select-prefix">{prefix}</span>}
      <select id={id} value={value} disabled={disabled} aria-label={ariaLabel ?? prefix} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={15} aria-hidden className="select-caret" />
    </span>
  );
}

/** Long text that grows with what is typed, from `rows` lines up to a cap,
 *  then scrolls. No corner handle to drag. */
export function TextArea({ value, rows = 3, className, ...rest }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
  }, [value]);
  return <textarea ref={ref} rows={rows} value={value} className={cx('input', 'textarea', className)} {...rest} />;
}

export function Field({ label, hint, error, children, htmlFor, optional }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string; optional?: boolean }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {optional && <span className="field-optional">Optional</span>}
      </label>
      {children}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: Option<T>[]; ariaLabel: string }) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} className={cx(o.value === value && 'is-active')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={cx('toggle', checked && 'is-on')} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

/** Small multi-select rendered as toggleable chips. */
export function ChipSet<T extends string>({ value, onChange, options, ariaLabel }: { value: T[]; onChange: (v: T[]) => void; options: Option<T>[]; ariaLabel: string }) {
  return (
    <div className="chipset" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={o.value} type="button" aria-pressed={on} className={cx('chip', on && 'is-on')} onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}>
            {on && <Check size={13} aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Badge ---------- */

export type Tone = 'neutral' | 'purple' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'indigo' | 'pink';

export function Badge({ tone = 'neutral', children, dot, icon }: { tone?: Tone; children: ReactNode; dot?: boolean; icon?: ReactNode }) {
  return (
    <span className={cx('badge', `tone-${tone}`)}>
      {dot && <span className="badge-dot" aria-hidden />}
      {icon}
      {children}
    </span>
  );
}

/* ---------- Avatar ---------- */

const AVATAR_TINTS = [
  ['#F9E9FF', '#51007A'],
  ['#ECEFFF', '#0E39FC'],
  ['#E6F6EF', '#12684A'],
  ['#FFF1DC', '#8A5209'],
  ['#FFEBFA', '#C2009A'],
  ['#ECEAF0', '#3F3B4D'],
];

export function Avatar({ name, size = 28, src }: { name: string; size?: number; src?: string }) {
  if (src) return <img className="avatar avatar-img" src={src} alt="" aria-hidden style={{ width: size, height: size }} />;
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const [bg, fg] = AVATAR_TINTS[hash % AVATAR_TINTS.length];
  return (
    <span className="avatar" aria-hidden style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.round(size * 0.4) }}>
      {initials(name)}
    </span>
  );
}

/* ---------- Popover ---------- */

export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

/* ---------- Modal ---------- */

export function Modal({ title, description, onClose, children, footer, width = 520 }: { title: string; description?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Runs once per dialog: move focus in, and hand it back on close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    const previous = document.activeElement as HTMLElement | null;
    // The field marked data-autofocus wins; otherwise the first field in the dialog.
    const target = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>('input, select, textarea');
    target?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    // Centred in the viewport. A tall form scrolls inside its body, so the title and the buttons stay in view.
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={panel} style={{ maxWidth: width }}>
        <header className="modal-header">
          <div className="modal-heading">
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="modal-close" aria-label="Close dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

/* ---------- Empty state ---------- */

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="empty-text">{children}</p>}
      {action}
    </div>
  );
}

/* ---------- Definition list row ---------- */

export function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="meta-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
