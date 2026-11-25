import { useLayoutEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { Avatar, Button, cx } from './ui';

/* The comment box, shared by the dashboard and the Client Portal: text, the
   send button, and @ to mention one of this thread's people. */

/** A comment's text with @mentions of known people set apart. */
export function withMentions(text: string, names: string[]) {
  if (!names.length) return text;
  const escaped = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(@(?:${escaped.join('|')}))`, 'g'));
  return parts.map((p, i) => (i % 2 ? <span key={i} className="mention">{p}</span> : p));
}

export type Mentionable = { id: string; name: string; title?: string; photo?: string };

/** The comment box: text, the send button inside it, and @ to pick someone from this thread's people. */
export function CommentBox({ value, onChange, onSend, people, label, placeholder, sendLabel = 'Comment' }: { value: string; onChange: (v: string) => void; onSend: () => void; people: Mentionable[]; label: string; placeholder: string; sendLabel?: string }) {
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // Where the caret goes after a mention is inserted, set in the same render so
  // the next keystroke lands after the name.
  const nextCaret = useRef<number | null>(null);
  // The word being typed after an @, if the caret sits right after it.
  const typing = value.slice(0, caret).match(/(^|\s)@([^\s@]*)$/);
  const term = typing?.[2].toLowerCase() ?? '';
  const matches = typing && !dismissed ? people.filter((p) => p.name.toLowerCase().includes(term)).slice(0, 6) : [];
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    if (nextCaret.current != null) {
      el.focus();
      el.setSelectionRange(nextCaret.current, nextCaret.current);
      nextCaret.current = null;
    }
  }, [value]);
  const track = (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? el.value.length);
  const pick = (p: Mentionable) => {
    if (!typing) return;
    const start = caret - typing[2].length - 1;
    const next = `${value.slice(0, start)}@${p.name} ${value.slice(caret)}`;
    onChange(next);
    const at = start + p.name.length + 2;
    nextCaret.current = at;
    setCaret(at);
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((i) => (i + step + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[Math.min(active, matches.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onSend();
    }
  };
  return (
    <form
      className="comment-box"
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      {matches.length > 0 && (
        <ul className="mention-menu" role="listbox" aria-label="People to mention">
          {matches.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={cx('mention-option', i === active && 'is-active')}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
              >
                <Avatar name={p.name} size={24} src={p.photo} />
                <span className="mention-name">{p.name}</span>
                {p.title && <span className="mention-title">{p.title}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={box}
        rows={2}
        className="comment-input"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          track(e.target);
          setDismissed(false);
          setActive(0);
        }}
        onKeyDown={onKey}
        onKeyUp={(e) => track(e.currentTarget)}
        onClick={(e) => track(e.currentTarget)}
      />
      <div className="comment-box-foot">
        <Button variant="primary" size="sm" type="submit" disabled={!value.trim()}>
          <Send size={15} aria-hidden />
          {sendLabel}
        </Button>
      </div>
    </form>
  );
}
