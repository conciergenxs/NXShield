import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { Ticket } from '../types';
import { isOpen } from '../lib/domain';
import { useStore } from '../store';
import { Assignee } from './domain';
import { Avatar, cx } from './ui';

const MENU_W = 300;

/**
 * Who owns a ticket, changeable in place. Every ticket has someone from the
 * moment it is created (whoever is plotted on the asset); this only hands it
 * over, it doesn't start the work.
 *
 * The menu is drawn on top of the page, outside any table, so a scrolling
 * table never clips it, and clicks inside it never reach the row underneath.
 */
export function AssignMenu({ ticket, variant = 'field', id, role = 'assignee' }: { ticket: Ticket; variant?: 'field' | 'cell'; id?: string; role?: 'assignee' | 'tester' }) {
  const { team, openLoad, memberOf, assignTicket, setTester, can, currentUser } = useStore();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // Handing a ticket on from someone to someone else: who it goes to, and an optional note for them.
  const [handoff, setHandoff] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const currentId = role === 'tester' ? ticket.testerId : ticket.assigneeId;
  const member = memberOf(currentId);

  // Every opening starts with an empty search and the first person highlighted.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setHandoff(null);
      setNote('');
    }
  }, [open]);

  // Place the menu under the trigger, or above it when there is no room below.
  const place = () => {
    if (!trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < 340 && r.top > window.innerHeight - r.bottom;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - MENU_W - 8);
    setPos({ top: up ? r.top - 6 : r.bottom + 6, left, up });
  };
  useLayoutEffect(() => {
    if (open) place();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    // Scrolling the list inside the menu leaves it alone; scrolling the page moves
    // it along with its trigger, and closes it only once the trigger is out of view.
    const onScroll = (e: Event) => {
      if (menu.current?.contains(e.target as Node)) return;
      const r = trigger.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) return setOpen(false);
      place();
    };
    const onResize = () => place();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  // Leads assign; whoever holds the ticket now, or its QA, can hand it on.
  const holds = ticket.assigneeId === currentUser.id || ticket.testerId === currentUser.id;
  if ((!can('ticket.assign') && !holds) || !isOpen(ticket)) return <Assignee member={member} size={variant === 'cell' ? 24 : 22} />;

  // The fewest open tickets first.
  const ordered = [...team].sort((a, b) => openLoad(a.id) - openLoad(b.id) || a.name.localeCompare(b.name));
  const term = query.trim().toLowerCase();
  const matches = term ? ordered.filter((m) => m.name.toLowerCase().includes(term)) : ordered;
  const finish = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const pick = (memberId: string) => {
    if (memberId === currentId) return finish();
    if (role === 'tester') {
      setTester(ticket.id, memberId);
      return finish();
    }
    // Moving it off someone asks for an optional note; a first assignment goes straight through.
    if (ticket.assigneeId) {
      setHandoff(memberId);
      return;
    }
    assignTicket(ticket.id, memberId);
    finish();
  };
  const confirmHandoff = () => {
    if (!handoff) return;
    assignTicket(ticket.id, handoff, undefined, note);
    finish();
  };
  const target = handoff ? memberOf(handoff) : undefined;
  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (matches.length ? (i + step + matches.length) % matches.length : 0));
    } else if (e.key === 'Enter' && matches[active]) {
      e.preventDefault();
      pick(matches[active].id);
    }
  };

  return (
    // The cell sits in a clickable row; keep its clicks to itself.
    <div className="assign-menu-wrap" onClick={(e) => e.stopPropagation()}>
      <button
        ref={trigger}
        type="button"
        id={id}
        className={cx('assign-trigger', `is-${variant}`, !member && 'is-empty')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={variant === 'cell' ? `Assigned to ${member?.name ?? 'nobody'}, change` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {member ? <Avatar name={member.name} size={24} src={member.photo} /> : <span className="avatar avatar-empty" aria-hidden style={{ width: 24, height: 24 }} />}
        <span className="truncate">{member ? member.name : variant === 'cell' ? 'Unassigned' : 'Not assigned yet'}</span>
        <ChevronDown size={16} aria-hidden className="assign-trigger-caret" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menu}
            className={cx('popover assign-menu is-floating', pos.up && 'is-up')}
            style={{ top: pos.top, left: pos.left, width: MENU_W }}
            role="dialog"
            aria-label={`Assign ${ticket.id}`}
            onClick={(e) => e.stopPropagation()}
          >
            {target ? (
              <div className="handoff">
                <p className="handoff-title">
                  Move it from {member?.name ?? 'nobody'} to {target.name}
                </p>
                <label className="handoff-label" htmlFor={`handoff-${ticket.id}`}>
                  Note for {target.name.split(' ')[0]} (optional)
                </label>
                <textarea
                  id={`handoff-${ticket.id}`}
                  className="input"
                  rows={3}
                  autoFocus
                  value={note}
                  placeholder="e.g. This is a frontend issue: the widget renders the data wrong."
                  onChange={(e) => setNote(e.target.value)}
                />
                <p className="handoff-hint">It goes to the internal comments.</p>
                <div className="handoff-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setHandoff(null)}>
                    Back
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={confirmHandoff}>
                    Move to {target.name.split(' ')[0]}
                  </button>
                </div>
              </div>
            ) : (
              <>
            <label className="assign-search">
              <Search size={16} aria-hidden />
              <input
                autoFocus
                type="text"
                placeholder="Search team"
                aria-label="Search team"
                aria-controls={`assign-list-${ticket.id}`}
                aria-activedescendant={matches[active] ? `assign-opt-${ticket.id}-${matches[active].id}` : undefined}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onSearchKey}
              />
            </label>
            <div className="assign-list-scroll" id={`assign-list-${ticket.id}`} role="listbox" aria-label="Team">
              {matches.length === 0 && <p className="assign-empty">No one matches “{query.trim()}”.</p>}
              {matches.map((m, i) => {
                const selected = m.id === currentId;
                return (
                  <button
                    key={m.id}
                    id={`assign-opt-${ticket.id}-${m.id}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    tabIndex={-1}
                    className={cx('assign-option', selected && 'is-selected', i === active && 'is-active')}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(m.id)}
                  >
                    <Avatar name={m.name} size={30} src={m.photo} />
                    <span className="assign-option-main">
                      <span className="assign-option-name">{m.name}</span>
                      <span className="assign-option-role">{m.title}</span>
                    </span>
                    {selected ? <Check size={16} aria-label="Assigned" className="assign-option-check" /> : <span className="assign-option-load">{openLoad(m.id)} open</span>}
                  </button>
                );
              })}
            </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
