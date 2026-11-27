import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { CornerDownRight, Reply, Send } from 'lucide-react';
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
export function CommentBox({ value, onChange, onSend, onCancel, people, label, placeholder, sendLabel = 'Comment' }: { value: string; onChange: (v: string) => void; onSend: () => void; /** Shows a Cancel beside the send button. */ onCancel?: () => void; people: Mentionable[]; label: string; placeholder: string; sendLabel?: string }) {
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
        {onCancel && (
          <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button variant="primary" size="sm" type="submit" disabled={!value.trim()}>
          <Send size={15} aria-hidden />
          {sendLabel}
        </Button>
      </div>
    </form>
  );
}

/* ---------- Threads, like the comments under a video ----------
   Each comment that starts a thread, then its replies one step in, joined by
   a line. A reply says whom it answers. Anyone can reply to any comment; the
   reply joins that comment's thread. NXS people show by name, with "NXS
   Support" beside it, and their own photo. */

/** Who wrote a comment, as the thread shows them. */
export interface CommentAuthor {
  name: string;
  photo?: string;
  /** "NXS Support" for the team, "Client" for the client's people where it helps. */
  tag?: string;
  nxs?: boolean;
}

interface ThreadComment {
  id: string;
  at: number;
  text: string;
  parentId?: string;
  replyingTo?: string;
}

export function CommentThreads<C extends ThreadComment>({
  comments,
  authorOf,
  when,
  people,
  onReply,
  replyLabel,
}: {
  comments: C[];
  authorOf: (c: C) => CommentAuthor;
  when: (c: C) => { short: string; full: string };
  people: Mentionable[];
  /** Post a reply to one comment. */
  onReply: (text: string, to: C) => void;
  replyLabel: string;
}) {
  const [replying, setReplying] = useState<string | null>(null);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  // The reply box opens ready to type, after the @name it starts with.
  useLayoutEffect(() => {
    if (!replying) return;
    const box = listRef.current?.querySelector<HTMLTextAreaElement>('.ct-compose textarea');
    if (!box) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }, [replying]);
  const byId = new Map(comments.map((c) => [c.id, c]));
  // Newest first: the threads, and the replies inside each.
  const roots = comments.filter((c) => !c.parentId || !byId.has(c.parentId)).sort((a, b) => b.at - a.at);
  const repliesOf = (root: C) => comments.filter((c) => c.parentId === root.id).sort((a, b) => b.at - a.at);
  const names = people.map((p) => p.name);
  const open = (c: C) => {
    setReplying(c.id);
    // Answering a reply names its author, as on most comment threads.
    const a = authorOf(c);
    setText(a.nxs || !a.name ? '' : `@${a.name} `);
  };
  const send = (to: C) => {
    if (!text.trim()) return;
    onReply(text, to);
    setText('');
    setReplying(null);
  };
  const item = (c: C, reply: boolean) => {
    const a = authorOf(c);
    const to = c.replyingTo ? byId.get(c.replyingTo) : undefined;
    const toName = to && to.id !== c.parentId ? authorOf(to).name : undefined;
    const w = when(c);
    return (
      <div className={cx('ct-item', reply && 'is-reply', a.nxs && 'is-nxs')}>
        <Avatar name={a.name} size={reply ? 26 : 32} src={a.photo} />
        <div className="ct-body">
          <p className="ct-meta">
            <span className="ct-name">{a.name}</span>
            {a.tag && <span className={cx('ct-tag', a.nxs && 'is-nxs')}>{a.tag}</span>}
            <time title={w.full}>{w.short}</time>
          </p>
          {toName && (
            <p className="ct-to">
              <CornerDownRight size={13} aria-hidden />
              replying to {toName}
            </p>
          )}
          <p className="ct-text">{withMentions(c.text, names)}</p>
          <button type="button" className="ct-reply-btn" onClick={() => open(c)}>
            <Reply size={14} aria-hidden />
            Reply
          </button>
        </div>
      </div>
    );
  };
  // The reply box opens right under the comment it answers, not at the end of the thread.
  const compose = (target: C) => (
    <li className="ct-compose">
      <CommentBox
        key={target.id}
        value={text}
        onChange={setText}
        onSend={() => send(target)}
        onCancel={() => setReplying(null)}
        people={people}
        label={replyLabel}
        placeholder={`Reply to ${authorOf(target).name}…`}
        sendLabel="Reply"
      />
    </li>
  );
  return (
    <ol ref={listRef} className="ct-list" aria-label="Comments">
      {roots.map((root) => {
        const replies = repliesOf(root);
        const target = replying ? byId.get(replying) : undefined;
        const inThread = !!target && (target.id === root.id || replies.some((r) => r.id === target.id));
        return (
          <li key={root.id} className={cx('ct-thread', (replies.length > 0 || inThread) && 'has-replies')}>
            {item(root, false)}
            {(replies.length > 0 || inThread) && (
              <ol className="ct-replies">
                {target?.id === root.id && compose(target)}
                {replies.map((r) => (
                  <Fragment key={r.id}>
                    <li>{item(r, true)}</li>
                    {target?.id === r.id && compose(target)}
                  </Fragment>
                ))}
              </ol>
            )}
          </li>
        );
      })}
    </ol>
  );
}
