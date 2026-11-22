import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

/* Front-end only sign-in for the prototype. There is no API yet: any email
   and password sign in, and the session is a flag kept in this browser.
   NXS staff and client users sign in separately, so both can be signed in
   at once in one browser. */

export type SessionKind = 'team' | 'client';

export interface Session {
  email: string;
  /** For a client session: the client user it belongs to. */
  userId?: string;
}

const KEY: Record<SessionKind, string> = { team: 'nxshield.session', client: 'nxshield.portal' };
export const SIGN_IN_PATH: Record<SessionKind, string> = { team: '/login', client: '/portal/login' };
export const HOME_PATH: Record<SessionKind, string> = { team: '/', client: '/portal' };

interface AuthValue {
  sessions: Record<SessionKind, Session | null>;
  signIn: (kind: SessionKind, session: Session) => void;
  signOut: (kind: SessionKind) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

function readSession(kind: SessionKind): Session | null {
  try {
    const raw = localStorage.getItem(KEY[kind]);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<Record<SessionKind, Session | null>>(() => ({ team: readSession('team'), client: readSession('client') }));

  const signIn = useCallback((kind: SessionKind, session: Session) => {
    const next = { ...session, email: session.email.trim().toLowerCase() };
    try {
      localStorage.setItem(KEY[kind], JSON.stringify(next));
    } catch {
      // Storage can be blocked; the session then lasts until reload.
    }
    setSessions((s) => ({ ...s, [kind]: next }));
  }, []);

  const signOut = useCallback((kind: SessionKind) => {
    try {
      localStorage.removeItem(KEY[kind]);
    } catch {
      // Nothing stored, nothing to clear.
    }
    setSessions((s) => ({ ...s, [kind]: null }));
  }, []);

  const value = useMemo(() => ({ sessions, signIn, signOut }), [sessions, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** The session of one kind, with sign in and sign out bound to it. */
export function useAuth(kind: SessionKind = 'team') {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  const { sessions, signIn, signOut } = ctx;
  return useMemo(
    () => ({ session: sessions[kind], signIn: (s: Session) => signIn(kind, s), signOut: () => signOut(kind) }),
    [sessions, signIn, signOut, kind],
  );
}

/** Wraps a set of pages: without a session, go to sign in and come back after. */
export function RequireAuth({ kind = 'team' }: { kind?: SessionKind }) {
  const { session } = useAuth(kind);
  const location = useLocation();
  if (!session) return <Navigate to={SIGN_IN_PATH[kind]} replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}
