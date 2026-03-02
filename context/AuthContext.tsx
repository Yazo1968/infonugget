import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase } from '../utils/supabase';
import type { User, Session } from '@supabase/supabase-js';

// ── Auth context — Supabase session management ──

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Handle PKCE code exchange explicitly if code is in the URL
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      console.log('[Auth] PKCE code detected in URL, exchanging...');
      supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
        if (error) {
          console.error('[Auth] PKCE exchange failed:', error.message);
        } else {
          console.log('[Auth] PKCE exchange success, user:', data.session?.user?.email);
          setSession(data.session);
          setUser(data.session?.user ?? null);
          setLoading(false);
          // Clean up the URL
          window.history.replaceState({}, '', window.location.pathname);
        }
      });
    }

    // Also handle hash-based tokens (implicit flow fallback)
    const hash = window.location.hash;
    if (hash && hash.includes('access_token')) {
      console.log('[Auth] Hash tokens detected in URL');
    }

    // Listen for auth state changes (also fires INITIAL_SESSION)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      console.log('[Auth] onAuthStateChange:', event, s?.user?.email ?? 'no user');
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    // Fallback: if nothing has fired within 3s, check directly
    const timeout = setTimeout(async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      console.log('[Auth] Fallback getSession:', s?.user?.email ?? 'no session');
      setSession(prev => prev ?? s);
      setUser(prev => prev ?? s?.user ?? null);
      setLoading(false);
    }, 3000);

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, loading, signInWithEmail, signUpWithEmail, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
