import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase } from '../utils/supabase';
import type { User, Session } from '@supabase/supabase-js';

// ── Auth context — Supabase session management ──

export interface UserProfile {
  displayName: string | null;
  avatarInitials: string | null;
  avatarUrl: string | null;
  devMode: boolean;
}

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  passwordRecovery: boolean;
  clearPasswordRecovery: () => void;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
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
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  const clearPasswordRecovery = useCallback(() => setPasswordRecovery(false), []);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('display_name, avatar_initials, avatar_url, dev_mode')
      .eq('id', userId)
      .single();
    if (data) {
      setProfile({
        displayName: data.display_name,
        avatarInitials: data.avatar_initials,
        avatarUrl: data.avatar_url,
        devMode: data.dev_mode ?? false,
      });
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user.id);
  }, [user, fetchProfile]);

  useEffect(() => {
    // Listen for auth state changes (fires INITIAL_SESSION, SIGNED_IN, etc.)
    // With detectSessionInUrl: true, Supabase auto-handles PKCE code exchange
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
      }
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) fetchProfile(s.user.id);
      else setProfile(null);
      setLoading(false);
    });

    // Fallback: if nothing has fired within 3s, check directly
    const timeout = setTimeout(async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      setSession(prev => prev ?? s);
      setUser(prev => prev ?? s?.user ?? null);
      if (s?.user) fetchProfile(s.user.id);
      setLoading(false);
    }, 3000);

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    // Clear React state immediately so the UI redirects to landing page,
    // then tell Supabase to clean up the stored session
    setSession(null);
    setUser(null);
    setProfile(null);
    await supabase.auth.signOut({ scope: 'local' });
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, passwordRecovery, clearPasswordRecovery, signInWithEmail, signUpWithEmail, signInWithGoogle, resetPassword, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
