import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge, cx, usePopover, type Tone } from './ui';
import { fmtDateYear, fromDateInput, startOfDay, toDateInput } from '../lib/format';

/* Custom form controls that open our own popover instead of the browser's:
   a single-choice dropdown and a date picker. Both start empty and show a
   placeholder until something is picked. */

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  /** Secondary line inside the menu only. */
  description?: string;
  /** Shown but not pickable, e.g. something coming later. */
  disabled?: boolean;
  /** A small tag beside the label, such as "Coming soon". */
  badge?: string;
}

interface DropdownProps<T extends string> {
  id?: string;
  value: T | '';
  onChange: (value: T) => void;
  options: DropdownOption<T>[];
  placeholder: string;
  invalid?: boolean;
}

export function Dropdown<T extends string>({ id, value, onChange, options, placeholder, invalid }: DropdownProps<T>) {
  const { open, setOpen, ref } = usePopover();
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const [active, setActive] = useState(0);
  const current = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    setActive(selectedIndex >= 0 ? selectedIndex : Math.max(0, options.findIndex((o) => !o.disabled)));
    listRef.current?.focus();
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (i: number) => {
    if (options[i]?.disabled) return;
    onChange(options[i].value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onListKey = (e: KeyboardEvent) => {
    // Arrow keys and Home/End skip options that can't be picked.
    const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
    const step = (dir: 1 | -1) => setActive((a) => (dir === 1 ? enabled.find((i) => i > a) : [...enabled].reverse().find((i) => i < a)) ?? a);
    if (e.key === 'ArrowDown') step(1);
    else if (e.key === 'ArrowUp') step(-1);
    else if (e.key === 'Home') setActive(enabled[0] ?? 0);
    else if (e.key === 'End') setActive(enabled[enabled.length - 1] ?? 0);
    else if (e.key === 'Enter' || e.key === ' ') choose(active);
    else if (e.key === 'Tab') return setOpen(false);
    else if (e.key === 'Escape') triggerRef.current?.focus();
    else if (e.key.length === 1) {
      const i = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setActive(i);
      return;
    } else return;
    e.preventDefault();
  };

  return (
    <div className={cx('dropdown', open && 'is-open', invalid && 'is-invalid')} ref={ref}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-invalid={invalid || undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={onTriggerKey}
      >
        <span className={cx('dropdown-value', !current && 'is-placeholder')}>{current ? current.label : placeholder}</span>
        <ChevronDown size={16} aria-hidden className="dropdown-caret" />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          className="dropdown-menu"
          role="listbox"
          tabIndex={-1}
          aria-labelledby={id}
          aria-activedescendant={`${listId}-${active}`}
          onKeyDown={onListKey}
        >
          {options.map((o, i) => {
            const selected = i === selectedIndex;
            return (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                data-index={i}
                data-value={o.value}
                role="option"
                aria-selected={selected}
                aria-disabled={o.disabled || undefined}
                className={cx('dropdown-option', i === active && !o.disabled && 'is-active', selected && 'is-selected', o.disabled && 'is-disabled')}
                onMouseEnter={() => !o.disabled && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
              >
                <span className="dropdown-option-text">
                  <span className="dropdown-option-label">
                    {o.label}
                    {o.badge && <span className="dropdown-option-badge">{o.badge}</span>}
                  </span>
                  {o.description && <span className="dropdown-option-desc">{o.description}</span>}
                </span>
                {selected && <Check size={16} aria-hidden className="dropdown-check" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------- Date picker ---------- */

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const addDays = (ts: number, n: number) => {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
};
const monthStart = (ts: number) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};
const addMonths = (ts: number, n: number) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
};

interface DatePickerProps {
  id?: string;
  /** YYYY-MM-DD, or '' for none. */
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Earliest day that can be picked. */
  min?: number;
  /** Today, for the marker; the app's clock rather than the machine's. */
  today: number;
  invalid?: boolean;
}

export function DatePicker({ id, value, onChange, placeholder, min, today, invalid }: DatePickerProps) {
  const { open, setOpen, ref } = usePopover();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const picked = fromDateInput(value);
  const minDay = min != null ? startOfDay(min) : null;
  const todayDay = startOfDay(today);
  const [focus, setFocus] = useState(picked ?? Math.max(todayDay, minDay ?? todayDay));
  const [month, setMonth] = useState(monthStart(focus));

  useEffect(() => {
    if (!open) return;
    const start = picked ?? Math.max(todayDay, minDay ?? todayDay);
    setFocus(start);
    setMonth(monthStart(start));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) gridRef.current?.querySelector<HTMLElement>(`[data-day="${toDateInput(focus)}"]`)?.focus();
  }, [focus, open]);

  const days = useMemo(() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7; // weeks start on Monday
    const start = addDays(month, -offset);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month]);

  const disabled = (d: number) => minDay != null && d < minDay;
  const choose = (d: number) => {
    if (disabled(d)) return;
    onChange(toDateInput(d));
    setOpen(false);
    triggerRef.current?.focus();
  };
  const moveTo = (to: number) => {
    const d = minDay != null && to < minDay ? minDay : to;
    setFocus(d);
    if (monthStart(d) !== month) setMonth(monthStart(d));
  };

  const onGridKey = (e: KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) moveTo(addDays(focus, step[e.key]));
    else if (e.key === 'PageUp') moveTo(addMonths(focus, -1));
    else if (e.key === 'PageDown') moveTo(addMonths(focus, 1));
    else if (e.key === 'Escape') triggerRef.current?.focus();
    else return;
    e.preventDefault();
  };

  const canGoBack = minDay == null || month > monthStart(minDay);

  return (
    <div className={cx('dropdown', 'datepicker', open && 'is-open', invalid && 'is-invalid')} ref={ref}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="dropdown-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        onClick={() => setOpen(!open)}
      >
        <span className={cx('dropdown-value', picked == null && 'is-placeholder')}>{picked != null ? fmtDateYear(picked) : placeholder}</span>
        <CalendarDays size={16} aria-hidden className="dropdown-caret" />
      </button>
      {open && (
        <div className="dropdown-menu datepicker-panel" role="dialog" aria-label="Choose a date">
          <div className="datepicker-head">
            <button type="button" className="datepicker-nav" aria-label="Previous month" disabled={!canGoBack} onClick={() => setMonth(addMonths(month, -1))}>
              <ChevronLeft size={18} />
            </button>
            <span className="datepicker-month" aria-live="polite">
              {MONTH.format(month)}
            </span>
            <button type="button" className="datepicker-nav" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="datepicker-grid" role="grid" ref={gridRef} onKeyDown={onGridKey}>
            {WEEKDAYS.map((w) => (
              <span key={w} className="datepicker-weekday" aria-hidden>
                {w}
              </span>
            ))}
            {days.map((d) => {
              const key = toDateInput(d);
              const outside = monthStart(d) !== month;
              const off = disabled(d);
              return (
                <button
                  key={key}
                  type="button"
                  data-day={key}
                  tabIndex={d === focus ? 0 : -1}
                  disabled={off}
                  aria-label={DAY_LABEL.format(d)}
                  aria-pressed={d === picked}
                  className={cx('datepicker-day', outside && 'is-outside', d === todayDay && 'is-today', d === picked && 'is-selected')}
                  onClick={() => choose(d)}
                >
                  {new Date(d).getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Badge select ---------- */

export interface BadgeOption<T extends string> {
  value: T;
  label: string;
  tone: Tone;
  /** Secondary line inside the menu only. */
  description?: string;
}

/**
 * A value shown as its badge, changeable in place: click the badge, pick
 * another. Used for properties that read as tags, like sprint and task type.
 */
export function BadgeSelect<T extends string>({ id, label, value, options, onChange }: { id?: string; label: string; value: T | undefined; options: BadgeOption<T>[]; onChange: (value: T) => void }) {
  const { open, setOpen, ref } = usePopover();
  const current = options.find((o) => o.value === value);
  const pick = (v: T) => {
    setOpen(false);
    if (v !== value) onChange(v);
  };
  return (
    <div className={cx('dropdown badge-select', open && 'is-open')} ref={ref}>
      <button id={id} type="button" className="badge-select-trigger" aria-haspopup="true" aria-expanded={open} aria-label={`${label}: ${current?.label ?? 'not set'}. Change`} onClick={() => setOpen(!open)}>
        {current ? <Badge tone={current.tone}>{current.label}</Badge> : <span className="muted">Not set</span>}
        <ChevronDown size={14} aria-hidden className="badge-select-caret" />
      </button>
      {open && (
        <ul className="dropdown-menu" aria-label={label}>
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <li key={o.value}>
                <button type="button" className={cx('dropdown-option', selected && 'is-selected')} aria-pressed={selected} onClick={() => pick(o.value)}>
                  <span className="dropdown-option-text">
                    <span className="dropdown-option-label">
                      <Badge tone={o.tone}>{o.label}</Badge>
                    </span>
                    {o.description && <span className="dropdown-option-desc">{o.description}</span>}
                  </span>
                  {selected && <Check size={16} aria-hidden className="dropdown-check" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
