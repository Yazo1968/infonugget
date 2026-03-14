import './globals.css';
import React, { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { StorageProvider } from './components/StorageProvider';
import { ToastProvider } from './components/ToastNotification';
import { AuthProvider, useAuth } from './context/AuthContext';
import AuthPage from './components/AuthPage';
import LandingPage from './components/LandingPage';
import ProfileSetup from './components/ProfileSetup';
import { supabase } from './utils/supabase';

// ── Set New Password — shown after clicking email reset link ──

function SetNewPassword() {
  const { clearPasswordRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const checks = useMemo(() => ({
    minLength: password.length >= 8,
    hasLower: /[a-z]/.test(password),
    hasUpper: /[A-Z]/.test(password),
    hasDigit: /\d/.test(password),
    hasSymbol: /[^a-zA-Z0-9]/.test(password),
  }), [password]);
  const valid = Object.values(checks).every(Boolean);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || password !== confirmPassword) return;
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      setError(err.message);
      setSaving(false);
    } else {
      setSuccess(true);
      setTimeout(() => clearPasswordRecovery(), 1500);
    }
  }, [valid, password, confirmPassword, clearPasswordRecovery]);

  const checkItem = (label: string, ok: boolean) => (
    <span className={`text-xs ${ok ? 'text-emerald-500' : 'text-zinc-400'}`}>
      {ok ? '\u2713' : '\u2022'} {label}
    </span>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-800 p-8">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 text-center mb-1">
          Set New Password
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center mb-6">
          Choose a new password for your account.
        </p>

        {success ? (
          <div className="text-center">
            <div className="text-emerald-500 text-sm font-medium mb-2">Password updated successfully!</div>
            <p className="text-xs text-zinc-400">Redirecting...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                New Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {checkItem('8+ chars', checks.minLength)}
                {checkItem('lowercase', checks.hasLower)}
                {checkItem('uppercase', checks.hasUpper)}
                {checkItem('number', checks.hasDigit)}
                {checkItem('symbol', checks.hasSymbol)}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
              )}
            </div>

            {error && (
              <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={!valid || password !== confirmPassword || saving}
              className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

type PreAuthPage = 'landing' | 'signin' | 'signup';

function AuthGate() {
  const { user, loading, passwordRecovery, refreshProfile } = useAuth();
  const [page, setPage] = useState<PreAuthPage>('landing');
  const [profileChecked, setProfileChecked] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);

  // Reset to landing page when user signs out
  useEffect(() => {
    if (!user) setPage('landing');
  }, [user]);

  // Check if authenticated user has a display_name set
  useEffect(() => {
    if (!user) {
      setProfileChecked(false);
      setNeedsProfile(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .single();
      if (!cancelled) {
        setNeedsProfile(!data?.display_name);
        setProfileChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const handleProfileComplete = useCallback(async () => {
    await refreshProfile();
    setNeedsProfile(false);
  }, [refreshProfile]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="text-zinc-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (!user) {
    if (page === 'landing') {
      return (
        <LandingPage
          onGetStarted={() => setPage('signup')}
          onSignIn={() => setPage('signin')}
        />
      );
    }
    return (
      <AuthPage
        initialMode={page === 'signup' ? 'signup' : 'signin'}
        onBackToLanding={() => setPage('landing')}
      />
    );
  }

  // Wait for profile check before rendering app or profile setup
  if (!profileChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="text-zinc-400 text-sm">Loading...</div>
      </div>
    );
  }

  // Show profile setup for new users without a display name
  if (needsProfile) {
    return <ProfileSetup onComplete={handleProfileComplete} />;
  }

  // Show password reset form when user arrives via recovery email link
  if (passwordRecovery) {
    return <SetNewPassword />;
  }

  return (
    <StorageProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StorageProvider>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  </React.StrictMode>,
);
