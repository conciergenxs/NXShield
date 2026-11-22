import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, LoaderCircle, MailCheck } from 'lucide-react';
import { HOME_PATH, SIGN_IN_PATH, useAuth, type SessionKind } from '../auth';
import { Button, Field } from '../components/ui';
import { useStore } from '../store';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// No API yet, so a short pause stands in for the request.
const FAKE_LATENCY = 700;

type LocationState = { from?: string; email?: string } | null;

/* The same pages serve NXS staff and client users; only the words change. */
const COPY: Record<SessionKind, { title: string; sub: string; footer: string; artLine: string; artBy: string }> = {
  team: {
    title: 'Sign in to NXShield',
    sub: 'Use your NXS work account.',
    footer: 'No account yet? Ask your NXShield admin for access.',
    artLine: 'Every client issue, tied to its asset and tracked against its SLA.',
    artBy: 'NXShield, the support desk of NXS Agency',
  },
  client: {
    title: 'Sign in to the Client Portal',
    sub: 'Report an issue to NXS and follow it until it’s fixed.',
    footer: 'No account yet? Ask your NXS account manager to add you.',
    artLine: 'Report an issue, follow the fix, and approve it when it works.',
    artBy: 'NXS Client Portal',
  },
};

/* ---------- Shell: a framed card on the left, the brand artwork on the right ---------- */

function AuthShell({ kind, top, children, footer }: { kind: SessionKind; top: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-frame">
        <main className="auth-card">
          <div className="auth-top">{top}</div>
          <div className="auth-body">{children}</div>
          {footer && <p className="auth-footer">{footer}</p>}
        </main>
        <aside className="auth-art" aria-hidden>
          <div className="auth-art-copy">
            <p className="auth-art-line">{COPY[kind].artLine}</p>
            <p className="auth-art-by">{COPY[kind].artBy}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function AuthBrand({ kind }: { kind: SessionKind }) {
  return (
    <span className="auth-brand">
      <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="9" fill="#C11FFF" />
        <path d="M16 6.5l8 3v6.2c0 4.6-3.2 8.2-8 9.8-4.8-1.6-8-5.2-8-9.8V9.5z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
        <path d="M12.5 15.8l2.6 2.6 4.6-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      NXShield
      {kind === 'client' && <span className="auth-brand-tag">Client Portal</span>}
    </span>
  );
}

function BackToSignIn({ kind, email }: { kind: SessionKind; email: string }) {
  return (
    <Link to={SIGN_IN_PATH[kind]} state={{ email }} className="auth-back">
      <span className="auth-back-icon" aria-hidden>
        <ArrowLeft size={16} />
      </span>
      Back to sign in
    </Link>
  );
}

function SubmitButton({ busy, children, busyLabel }: { busy: boolean; children: ReactNode; busyLabel: string }) {
  return (
    <Button variant="primary" type="submit" className="auth-submit" disabled={busy} aria-busy={busy}>
      {busy ? (
        <>
          <LoaderCircle size={18} className="auth-spin" aria-hidden />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

/* ---------- Sign in ---------- */

export function Login({ kind = 'team' }: { kind?: SessionKind }) {
  const { session, signIn } = useAuth(kind);
  const { clients } = useStore();
  const navigate = useNavigate();
  const state = useLocation().state as LocationState;
  const [email, setEmail] = useState(state?.email ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const home = state?.from ?? HOME_PATH[kind];
  if (session && !busy) return <Navigate to={home} replace />;

  const errors = {
    email: !email.trim() ? 'Enter your work email.' : !EMAIL_RE.test(email.trim()) ? 'Enter a valid email, for example name@company.com.' : '',
    password: !password ? 'Enter your password.' : '',
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (errors.email || errors.password) {
      document.getElementById(errors.email ? 'login-email' : 'login-password')?.focus();
      return;
    }
    setBusy(true);
    timer.current = window.setTimeout(() => {
      if (kind === 'client') {
        // No API: a known client user's email signs in as them; any other
        // email opens the portal as the first client user, for trying it out.
        const users = clients.flatMap((c) => c.users);
        const user = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase()) ?? users[0];
        signIn({ email, userId: user?.id });
      } else {
        signIn({ email });
      }
      navigate(home, { replace: true });
    }, FAKE_LATENCY);
  };

  return (
    <AuthShell kind={kind} top={<AuthBrand kind={kind} />} footer={COPY[kind].footer}>
      <h1 className="auth-title">{COPY[kind].title}</h1>
      <p className="auth-sub">{COPY[kind].sub}</p>
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field label={kind === 'team' ? 'Work email' : 'Email'} htmlFor="login-email" error={submitted ? errors.email : ''}>
          <input
            id="login-email"
            type="email"
            className="input auth-input"
            autoComplete="username"
            inputMode="email"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus={!email}
            aria-invalid={submitted && !!errors.email}
          />
        </Field>
        <div className="field">
          <div className="auth-label-row">
            <label className="field-label" htmlFor="login-password">
              Password
            </label>
            <Link to={`${SIGN_IN_PATH[kind]}/forgot`} state={{ email: email.trim() }} className="auth-link">
              Forgot password?
            </Link>
          </div>
          <div className="auth-password">
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              className="input auth-input"
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus={!!email}
              aria-invalid={submitted && !!errors.password}
            />
            <button type="button" className="auth-reveal" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {submitted && errors.password && <p className="field-error">{errors.password}</p>}
        </div>
        <SubmitButton busy={busy} busyLabel="Signing in">
          Sign in
        </SubmitButton>
      </form>
    </AuthShell>
  );
}

/* ---------- Forgot password ---------- */

export function ForgotPassword({ kind = 'team' }: { kind?: SessionKind }) {
  const { session } = useAuth(kind);
  const state = useLocation().state as LocationState;
  const [email, setEmail] = useState(state?.email ?? '');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [resent, setResent] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (session) return <Navigate to={HOME_PATH[kind]} replace />;

  const error = !email.trim() ? 'Enter your work email.' : !EMAIL_RE.test(email.trim()) ? 'Enter a valid email, for example name@company.com.' : '';

  const send = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (error) {
      document.getElementById('forgot-email')?.focus();
      return;
    }
    setBusy(true);
    timer.current = window.setTimeout(() => {
      setBusy(false);
      setSentTo(email.trim());
    }, FAKE_LATENCY);
  };

  if (sentTo) {
    return (
      <AuthShell kind={kind} top={<BackToSignIn kind={kind} email={sentTo} />}>
        <span className="auth-icon" aria-hidden>
          <MailCheck size={24} />
        </span>
        <h1 className="auth-title">Check your email</h1>
        <p className="auth-sub">
          If <strong>{sentTo}</strong> has {kind === 'team' ? 'an NXShield' : 'a Client Portal'} account, a link to set a new password is on its way. It works for 30 minutes.
        </p>
        <div className="auth-form">
          <Link to={SIGN_IN_PATH[kind]} state={{ email: sentTo }} className="btn btn-primary auth-submit">
            Back to sign in
          </Link>
          <p className="auth-resend" aria-live="polite">
            {resent ? (
              'We sent the link again.'
            ) : (
              <>
                Nothing yet? Check spam, or{' '}
                <button type="button" className="auth-link" onClick={() => setResent(true)}>
                  send it again
                </button>
                .
              </>
            )}
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell kind={kind} top={<BackToSignIn kind={kind} email={email.trim()} />}>
      <h1 className="auth-title">Reset your password</h1>
      <p className="auth-sub">Enter your {kind === 'team' ? 'work ' : ''}email and we’ll send you a link to set a new one.</p>
      <form className="auth-form" onSubmit={send} noValidate>
        <Field label={kind === 'team' ? 'Work email' : 'Email'} htmlFor="forgot-email" error={submitted ? error : ''}>
          <input
            id="forgot-email"
            type="email"
            className="input auth-input"
            autoComplete="username"
            inputMode="email"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            aria-invalid={submitted && !!error}
          />
        </Field>
        <SubmitButton busy={busy} busyLabel="Sending link">
          Send reset link
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
