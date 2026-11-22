import { useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, ListFilter, X, type LucideIcon } from 'lucide-react';
import { cx, usePopover, type Option } from './ui';

export interface FilterField {
  key: string;
  label: string;
  icon: LucideIcon;
  value: string;
  /** The value that means "no filter". */
  empty: string;
  options: Option[];
  onChange: (value: string) => void;
  /** Long lists get a search box. */
  searchable?: boolean;
  /** Text for the chip when the option label alone is not enough (a custom date range). */
  chipText?: string;
  /** Picking this value keeps the panel open, to show `extra`. */
  stayOpenOn?: string;
  /** Rendered under the options, for example date inputs. */
  extra?: ReactNode;
}

/**
 * State shared by the Filter button and the row of active-filter chips, so a
 * chip can open the panel straight at its own property.
 */
export function useFilterMenu(fields: FilterField[]) {
  const pop = usePopover();
  const [view, setView] = useState<string | null>(null);
  const openAt = (key: string | null) => {
    setView(key);
    pop.setOpen(true);
  };
  const active = fields.filter((f) => f.value !== f.empty);
  return { ...pop, fields, active, view, setView, openAt };
}
export type FilterMenuState = ReturnType<typeof useFilterMenu>;

const valueLabel = (f: FilterField) => f.chipText ?? f.options.find((o) => o.value === f.value)?.label ?? f.value;

/**
 * One "Filter" button in place of a row of dropdowns. The panel lists the
 * properties; picking one shows its values.
 */
export function FilterButton({ menu, ariaLabel }: { menu: FilterMenuState; ariaLabel: string }) {
  const { open, setOpen, ref, fields, active, view, setView, openAt } = menu;
  const [query, setQuery] = useState('');
  const field = fields.find((f) => f.key === view) ?? null;

  useEffect(() => setQuery(''), [view]);

  const pick = (f: FilterField, value: string) => {
    f.onChange(value);
    if (value !== f.stayOpenOn) setOpen(false);
  };
  const shown = field ? field.options.filter((o) => !query || o.label.toLowerCase().includes(query.trim().toLowerCase())) : [];

  return (
    <div className="filter-menu-wrap" ref={ref}>
      <button
        type="button"
        className={cx('filter-btn', (open || active.length > 0) && 'is-active')}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? setOpen(false) : openAt(null))}
      >
        <ListFilter size={16} aria-hidden />
        Filter
        {active.length > 0 && <span className="filter-btn-count">{active.length}</span>}
      </button>

      {open && (
        <div className="popover filter-menu" role="dialog" aria-label={ariaLabel}>
          {!field ? (
            <>
              <p className="filter-menu-title">Filter by</p>
              <ul className="filter-menu-list">
                {fields.map((f) => {
                  const Icon = f.icon;
                  const on = f.value !== f.empty;
                  return (
                    <li key={f.key}>
                      <button type="button" className="filter-menu-row" onClick={() => setView(f.key)}>
                        <Icon size={16} aria-hidden className="filter-menu-icon" />
                        <span className="filter-menu-name">{f.label}</span>
                        <span className={cx('filter-menu-value truncate', on && 'is-on')}>{on ? valueLabel(f) : ''}</span>
                        <ChevronRight size={15} aria-hidden className="filter-menu-chevron" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <>
              <div className="filter-menu-head">
                <button type="button" className="filter-menu-back" aria-label="Back to all filters" onClick={() => setView(null)}>
                  <ChevronLeft size={16} aria-hidden />
                </button>
                <span className="filter-menu-name">{field.label}</span>
                {field.value !== field.empty && (
                  <button type="button" className="link-btn" onClick={() => pick(field, field.empty)}>
                    Reset
                  </button>
                )}
              </div>
              {field.searchable && (
                <input
                  className="input input-sm filter-menu-search"
                  type="search"
                  placeholder={`Search ${field.label.toLowerCase()}`}
                  aria-label={`Search ${field.label.toLowerCase()}`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                />
              )}
              <ul className="filter-menu-list filter-menu-options">
                {shown.map((o) => {
                  const selected = o.value === field.value;
                  return (
                    <li key={o.value}>
                      <button type="button" className={cx('filter-menu-option', selected && 'is-selected')} aria-pressed={selected} onClick={() => pick(field, o.value)}>
                        <span className="filter-menu-check" aria-hidden>
                          {selected && <Check size={15} />}
                        </span>
                        <span className="truncate">{o.label}</span>
                      </button>
                    </li>
                  );
                })}
                {!shown.length && <li className="filter-menu-none">No matches</li>}
              </ul>
              {field.extra}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Every active filter as a chip, in a row under the toolbar: click a chip to
 * change its value, or its cross to remove it. Renders nothing when no filter
 * is on.
 */
export function FilterChips({ menu, extra, onClearAll }: { menu: FilterMenuState; extra?: ReactNode; onClearAll?: () => void }) {
  if (!menu.active.length && !extra) return null;
  return (
    <div className="filter-chips">
      {menu.active.map((f) => {
        const Icon = f.icon;
        return (
          <span key={f.key} className="filter-chip">
            <button
              type="button"
              className="filter-chip-main"
              // Keep the mousedown from counting as a click outside the open panel.
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => menu.openAt(f.key)}
              aria-label={`${f.label}: ${valueLabel(f)}. Change`}
            >
              <Icon size={14} aria-hidden />
              <span className="filter-chip-label">{f.label}</span>
              <strong className="truncate">{valueLabel(f)}</strong>
            </button>
            <button type="button" className="filter-chip-remove" aria-label={`Remove ${f.label} filter`} onClick={() => f.onChange(f.empty)}>
              <X size={14} aria-hidden />
            </button>
          </span>
        );
      })}
      {extra}
      {onClearAll && (
        <button type="button" className="link-btn filters-clear" onClick={onClearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}
