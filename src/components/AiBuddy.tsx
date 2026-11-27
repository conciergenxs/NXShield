import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { cx } from './ui';

/*
 * The AI, as a small glass shield with two glowing eyes. It floats while it
 * waits, blinks, looks around when nobody is moving, follows the cursor with
 * its eyes and a little tilt, looks down at the composer while you type,
 * thinks while the AI works and smiles when it's done. Everything moves on
 * springs, written straight to CSS variables, so React doesn't re-render
 * per frame. With reduced motion it sits still and only blinks.
 */

export type Mood = 'neutral' | 'happy' | 'curious' | 'surprised' | 'sleepy' | 'thinking' | 'wink' | 'attentive' | 'shy' | 'peek' | 'oops';

interface Props {
  /** The AI is working on an answer. */
  busy?: boolean;
  /** Big, in the middle of an empty chat; small, beside the chat's title, once it has messages. */
  size?: 'big' | 'small';
  /** A point on screen to look at instead of the cursor, read every frame; null goes back to the cursor. */
  lookAt?: () => { x: number; y: number } | null;
  /** A mood the page keeps it in, like shy while a password is typed; null lets it be itself again. */
  hold?: Mood | null;
  /** Plays a reaction once each time `n` changes: a happy hop, or a shake of the head. */
  cue?: { kind: 'hop' | 'no'; n: number } | null;
}

/** A spring toward a target: stiff enough to feel alive, damped enough not to wobble. */
function spring(state: { x: number; v: number }, target: number, k: number, d: number) {
  state.v += (target - state.x) * k;
  state.v *= d;
  state.x += state.v;
}

export function AiBuddy({ busy, size = 'big', lookAt, hold = null, cue }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [mood, setMood] = useState<Mood>('neutral');
  const [blink, setBlink] = useState(false);
  const moodRef = useRef<Mood>('neutral');
  const busyRef = useRef(!!busy);
  const lookAtRef = useRef(lookAt);
  lookAtRef.current = lookAt;
  const holdRef = useRef<Mood | null>(hold);
  /** When you last typed in its chat: it watches the composer while you write, then looks back up. */
  const typedAt = useRef(0);
  const hoverRef = useRef(false);
  const wasBusy = useRef(!!busy);
  const uid = useId().replace(/:/g, '');
  const [pressed, setPressed] = useState(false);
  const [sparks, setSparks] = useState<{ id: number; a: number; d: number; h: number }[]>([]);
  const turn = useRef(0);
  // The click reaction lives in state, so a re-render never wipes it; a new key restarts its animation.
  const [reaction, setReaction] = useState<{ kind: string; n: number } | null>(null);
  /** Each click gets an answer, a different one each time: a hop and a wink, a spin, a jelly wobble, a shy giggle. */
  const react = () => {
    const el = root.current;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const kinds = busyRef.current ? ['wiggle'] : ['hop', 'spin', 'jelly', 'giggle'];
    const kind = kinds[turn.current++ % kinds.length];
    if (!busyRef.current && !holdRef.current) show(kind === 'spin' ? 'surprised' : kind === 'giggle' ? 'happy' : 'wink', 650);
    if (!reduce) {
      setReaction({ kind, n: turn.current });
      burst();
    }
  };
  /** Little stars popping out around it. */
  const burst = () => {
    const born = Date.now();
    const k = (root.current?.offsetWidth ?? 176) / 176;
    const stars = Array.from({ length: 6 }, (_, i) => ({ id: born + i, a: i * 60 + Math.random() * 40 - 20, d: (46 + Math.random() * 26) * k, h: Math.random() }));
    setSparks((s) => [...s, ...stars]);
    window.setTimeout(() => setSparks((s) => s.filter((x) => x.id < born || x.id > born + 5)), 800);
  };

  const show = (m: Mood, ms?: number) => {
    moodRef.current = m;
    setMood(m);
    if (ms) {
      window.setTimeout(() => {
        if (moodRef.current === m) {
          // Back to the mood the page holds it in, if any.
          const back = holdRef.current ?? 'neutral';
          moodRef.current = back;
          setMood(back);
        }
      }, ms);
    }
  };

  // The page's held mood: shy while you type a password, peeking when it's shown.
  useEffect(() => {
    const was = holdRef.current;
    holdRef.current = hold;
    if (busyRef.current) return;
    if (hold) show(hold);
    else if (was && moodRef.current === was) show('neutral');
  }, [hold]);

  // A reaction the page asks for: a hop when you're in, a shake when something's missing.
  useEffect(() => {
    if (!cue) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (cue.kind === 'hop') show('happy');
    else show('oops', 1400);
    if (reduce) return;
    turn.current++;
    setReaction({ kind: cue.kind, n: turn.current });
    if (cue.kind === 'hop') burst();
  }, [cue?.n]);

  // Thinking while the AI works; a smile when the answer lands.
  useEffect(() => {
    busyRef.current = !!busy;
    if (busy) show('thinking');
    else if (wasBusy.current) show(holdRef.current ?? 'happy', holdRef.current ? undefined : 1600);
    wasBusy.current = !!busy;
  }, [busy]);

  // Blinks now and then, sometimes twice.
  useEffect(() => {
    let t = 0;
    const next = () => {
      t = window.setTimeout(
        () => {
          setBlink(true);
          window.setTimeout(() => setBlink(false), 130);
          if (Math.random() < 0.25) {
            window.setTimeout(() => setBlink(true), 260);
            window.setTimeout(() => setBlink(false), 390);
          }
          next();
        },
        2400 + Math.random() * 3200,
      );
    };
    next();
    return () => window.clearTimeout(t);
  }, []);

  // Watches you type in the chat it sits in.
  useEffect(() => {
    const chat = root.current?.closest('.rca-chat');
    if (!chat) return;
    const on = (e: Event) => {
      if (!(e.target instanceof HTMLTextAreaElement)) return;
      typedAt.current = performance.now();
      if (!busyRef.current && moodRef.current !== 'attentive') show('attentive');
    };
    chat.addEventListener('input', on);
    return () => chat.removeEventListener('input', on);
  }, []);

  // The motion: gaze, tilt, float and squash, on springs, every frame.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const gx = { x: 0, v: 0 };
    const gy = { x: 0, v: 0 };
    const tx = { x: 0, v: 0 };
    const ty = { x: 0, v: 0 };
    const sq = { x: 1, v: 0 };
    let pointer: { x: number; y: number } | null = null;
    let lastMove = performance.now();
    let wander = { x: 0, y: 0, until: 0 };
    let nextMood = performance.now() + 5000;
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      const was = performance.now() - lastMove;
      lastMove = performance.now();
      // Woken up by the cursor: a little surprise.
      if (was > 9000 && moodRef.current === 'sleepy') show('surprised', 700);
    };
    const onLeave = () => (pointer = null);
    window.addEventListener('pointermove', onMove);
    document.addEventListener('pointerleave', onLeave);

    const frame = (now: number) => {
      const r = el.getBoundingClientRect();
      const cx0 = r.left + r.width / 2;
      const cy0 = r.top + r.height * 0.45;
      const idle = now - lastMove;
      let aimX = 0;
      let aimY = 0;
      if (busyRef.current) {
        // Thinking: looks up and to the side, eyes drifting as if reading something.
        aimX = Math.sin(now / 520) * 0.55;
        aimY = -0.55 + Math.sin(now / 900) * 0.1;
      } else if (lookAtRef.current?.()) {
        // The page points it somewhere: the text you're typing, or away from your password.
        const p = lookAtRef.current()!;
        const dx = p.x - cx0;
        const dy = p.y - cy0;
        const dist = Math.hypot(dx, dy) || 1;
        const reach = Math.min(1, dist / (r.width * 0.9));
        aimX = (dx / dist) * reach;
        aimY = (dy / dist) * reach;
      } else if (now - typedAt.current < 1600) {
        // Watches the composer under it.
        aimX = -0.15 + Math.sin(now / 700) * 0.12;
        aimY = 0.85;
      } else if (pointer && idle < 3500) {
        const dx = pointer.x - cx0;
        const dy = pointer.y - cy0;
        const dist = Math.hypot(dx, dy) || 1;
        // Full turn of the eyes once the cursor is a little away; softer when it's right on top.
        const reach = Math.min(1, dist / 160);
        aimX = (dx / dist) * reach;
        aimY = (dy / dist) * reach;
      } else {
        // Nobody's moving: it looks around on its own, in quick glances.
        if (now > wander.until) {
          const look = Math.random() < 0.3 ? { x: 0, y: 0 } : { x: (Math.random() * 2 - 1) * 0.9, y: (Math.random() * 2 - 1) * 0.6 };
          wander = { ...look, until: now + 900 + Math.random() * 1800 };
        }
        aimX = wander.x;
        aimY = wander.y;
        // A mood now and then, and sleepy after a long while.
        if (holdRef.current) {
          // Held in a mood by the page: no wandering moods of its own.
        } else if (idle > 14000 && moodRef.current === 'neutral') show('sleepy');
        else if (now > nextMood && moodRef.current === 'neutral' && idle < 14000) {
          const pick = (['curious', 'happy', 'wink', 'curious'] as Mood[])[Math.floor(Math.random() * 4)];
          show(pick, pick === 'wink' ? 450 : 1400);
          nextMood = now + 6000 + Math.random() * 6000;
        }
      }
      if (moodRef.current === 'sleepy' && idle < 1000) show('neutral');
      if (moodRef.current === 'attentive' && now - typedAt.current > 1600 && !busyRef.current && !holdRef.current) show('neutral');

      if (reduce) {
        gx.x = aimX;
        gy.x = aimY;
      } else {
        // Eyes are quick; the body follows slower and less.
        spring(gx, aimX, 0.14, 0.72);
        spring(gy, aimY, 0.14, 0.72);
        spring(tx, aimX, 0.05, 0.82);
        spring(ty, aimY, 0.05, 0.82);
        spring(sq, hoverRef.current ? 1.04 : 1, 0.12, 0.7);
      }
      const float = reduce ? 0 : Math.sin(now / 1100) * 6;
      // Gaze in pixels, scaled to the size it's drawn at.
      const k = el.offsetWidth / 156;
      el.style.setProperty('--gx', `${(gx.x * 11 * k).toFixed(2)}px`);
      el.style.setProperty('--gy', `${(gy.x * 8 * k).toFixed(2)}px`);
      el.style.setProperty('--ry', `${(tx.x * 14).toFixed(2)}deg`);
      el.style.setProperty('--rx', `${(-ty.x * 10).toFixed(2)}deg`);
      el.style.setProperty('--float', `${float.toFixed(2)}px`);
      el.style.setProperty('--shadow', `${(1 - float / 30).toFixed(3)}`);
      el.style.setProperty('--sq', sq.x.toFixed(3));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <div
      ref={root}
      className={cx('ai-buddy', `is-${size}`, `mood-${mood}`, blink && 'is-blinking', pressed && 'is-pressed')}
      aria-hidden
      // Smiles while the cursor is on it.
      onPointerEnter={() => {
        hoverRef.current = true;
        if (!busyRef.current && !holdRef.current) show('happy');
      }}
      onPointerLeave={() => {
        hoverRef.current = false;
        setPressed(false);
        if (moodRef.current === 'happy' && !holdRef.current) show('neutral');
      }}
      // Squashes the moment it's pressed, so every click answers at once; the reaction plays on release.
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        setPressed(true);
      }}
      onPointerUp={() => {
        if (!pressed) return;
        setPressed(false);
        react();
      }}
    >
      <div className="ai-buddy-body">
        <div key={reaction?.n ?? 0} className={cx('ai-buddy-react', reaction && `is-${reaction.kind}`)}>
          <svg className="ai-buddy-shell" viewBox="0 0 200 200">
            <defs>
              <linearGradient id={`${uid}-rim`} x1="0.1" y1="0" x2="0.9" y2="1">
                <stop offset="0" stopColor="#e08bff" />
                <stop offset="0.45" stopColor="#a77cff" />
                <stop offset="1" stopColor="#6c9dff" />
              </linearGradient>
              <linearGradient id={`${uid}-bevel`} x1="0.2" y1="0" x2="0.7" y2="1">
                <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
                <stop offset="0.35" stopColor="#fff" stopOpacity="0.18" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
              <radialGradient id={`${uid}-glass`} cx="0.45" cy="0.35" r="0.75">
                <stop offset="0" stopColor="#231c44" />
                <stop offset="0.55" stopColor="#120e24" />
                <stop offset="1" stopColor="#0a0816" />
              </radialGradient>
              <radialGradient id={`${uid}-under`} cx="0.35" cy="1" r="0.75">
                <stop offset="0" stopColor="#b45cff" stopOpacity="0.55" />
                <stop offset="0.6" stopColor="#6d55ff" stopOpacity="0.12" />
                <stop offset="1" stopColor="#6d55ff" stopOpacity="0" />
              </radialGradient>
              <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
              <radialGradient id={`${uid}-spot-fill`} cx="148" cy="54" r="30" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#fff" stopOpacity="1" />
                <stop offset="0.55" stopColor="#fff" stopOpacity="0.6" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </radialGradient>
              <mask id={`${uid}-spot`} maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
                <rect x="0" y="0" width="200" height="200" fill={`url(#${uid}-spot-fill)`} />
              </mask>
              <filter id={`${uid}-bloom`} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="1.8" />
              </filter>
              <filter id={`${uid}-glow`} x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="11" />
              </filter>
              <filter id={`${uid}-soft`} x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.2" />
              </filter>
              <clipPath id={`${uid}-inner`}>
                <path d={SHIELD} transform={INSET} />
              </clipPath>
            </defs>
            {/* Light it throws on what's around it. */}
            <path className="ai-buddy-halo" d={SHIELD} fill={`url(#${uid}-rim)`} filter={`url(#${uid}-glow)`} />
            {/* The thick glass rim, lit from the top left. */}
            <path d={SHIELD} fill={`url(#${uid}-rim)`} />
            <path d={SHIELD} fill="none" stroke={`url(#${uid}-bevel)`} strokeWidth="2.5" />
            {/* The dark glass inside, with purple light pooling at the bottom and a shadow under the rim. */}
            <path d={SHIELD} transform={INSET} fill={`url(#${uid}-glass)`} />
            <g clipPath={`url(#${uid}-inner)`}>
              <rect x="0" y="0" width="200" height="200" fill={`url(#${uid}-under)`} />
              <path d={SHIELD} transform={INSET} fill="none" stroke="#000" strokeOpacity="0.55" strokeWidth="9" filter={`url(#${uid}-soft)`} />
              <ellipse cx="78" cy="58" rx="62" ry="30" fill={`url(#${uid}-sheen)`} transform="rotate(-14 78 58)" />
            </g>
            <path d={SHIELD} transform={INSET} fill="none" stroke={`url(#${uid}-bevel)`} strokeOpacity="0.5" strokeWidth="1.4" />
            {/* Where the light catches the curve. Not a drawn shape: the glass's own outline, a little inside the rim,
                lit only around the top right corner and fading out both ways, so it follows the curve exactly. */}
            <g className="ai-buddy-shine" mask={`url(#${uid}-spot)`}>
              <path d={SHIELD} transform={SHINE_AT} fill="none" stroke="#fff" strokeWidth="5" opacity="0.35" filter={`url(#${uid}-bloom)`} />
              <path d={SHIELD} transform={SHINE_AT} fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
            </g>
          </svg>
          <div className="ai-buddy-face">
            <span className="ai-buddy-eyeglow" />
            <span className="ai-buddy-eye is-left" />
            <span className="ai-buddy-eye is-right" />
            <span className="ai-buddy-blush is-left" />
            <span className="ai-buddy-blush is-right" />
          </div>
        </div>
        {sparks.map((sp) => (
          <span key={sp.id} className="ai-buddy-spark" style={{ '--a': `${sp.a}deg`, '--d': `${sp.d}px`, '--h': sp.h } as CSSProperties} />
        ))}
      </div>
      <span className="ai-buddy-floor" />
    </div>
  );
}

/** The highlight's line: the glass outline drawn a little further in than the rim's inside edge. */
const SHINE_AT = 'translate(100 103) scale(0.77) translate(-100 -103)';

/** Inside the rim: the same shield, smaller, around its middle. */
const INSET = 'translate(100 103) scale(0.84) translate(-100 -103)';
/** The shield: a soft point on top, full sides, a rounded point at the bottom. */
const SHIELD = 'M100 22 C118 22 156 36 166 46 C176 56 179 78 178 106 C176 142 140 170 100 182 C60 170 24 142 22 106 C21 78 24 56 34 46 C44 36 82 22 100 22 Z';

/** The AI at the top of a chat in the focus view: big in the middle while it's empty, with a line on what to ask; small beside the title once you talk. */
export function ChatBuddy({ busy, empty, title, hint }: { busy?: boolean; empty: boolean; title: string; hint: string }) {
  return (
    <div className={cx('ai-buddy-wrap', empty ? 'is-empty' : 'is-chatting')}>
      <AiBuddy busy={busy} size={empty ? 'big' : 'small'} />
      {empty ? (
        <div className="ai-buddy-copy">
          <p className="ai-buddy-title">{title}</p>
          <p className="ai-buddy-hint">{hint}</p>
        </div>
      ) : (
        <span className="ai-buddy-label">Conversation with the AI</span>
      )}
    </div>
  );
}
