import { useState, useMemo, useEffect, useRef, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import LogoIcon from './LogoIcon';

type AuthMode = 'signin' | 'signup';
type AuthView = 'signin' | 'signup' | 'forgot' | 'reset-sent' | 'confirmation-sent';

interface AuthPageProps {
  initialMode?: AuthMode;
  onBackToLanding: () => void;
}

/** Map Supabase error messages to user-friendly text */
function friendlyError(msg: string): string {
  if (msg.includes('Invalid login credentials')) return 'Incorrect email or password. Please try again.';
  if (msg.includes('Email not confirmed')) return 'Please check your email and confirm your account first.';
  if (msg.includes('User already registered')) return 'An account with this email already exists. Try signing in instead.';
  if (msg.includes('rate limit') || msg.includes('too many requests')) return 'Too many attempts. Please wait a moment and try again.';
  if (msg.includes('Password should be at least')) return 'Password must be at least 6 characters.';
  if (msg.includes('Unable to validate email')) return 'Please enter a valid email address.';
  return msg;
}

export default function AuthPage({ initialMode = 'signin', onBackToLanding }: AuthPageProps) {
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, resetPassword } = useAuth();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [forgotPwd, setForgotPwd] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Dark mode — follows theme-init.js / localStorage
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem('infonugget-dark-mode');
    if (stored !== null) return stored === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('infonugget-dark-mode', String(darkMode));
  }, [darkMode]);

  // Compute current view for transition key
  const currentView: AuthView = resetSent
    ? 'reset-sent'
    : confirmationSent
    ? 'confirmation-sent'
    : forgotPwd
    ? 'forgot'
    : mode;

  // Track view changes for transition animation
  const [viewKey, setViewKey] = useState(0);
  const prevViewRef = useRef<AuthView>(currentView);
  useEffect(() => {
    if (currentView !== prevViewRef.current) {
      prevViewRef.current = currentView;
      setViewKey((k) => k + 1);
    }
  }, [currentView]);

  // Password strength checks (signup only)
  const passwordChecks = useMemo(() => ({
    minLength: password.length >= 6,
  }), [password]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'signin') {
        const { error: err } = await signInWithEmail(email, password);
        if (err) setError(friendlyError(err));
      } else {
        if (!passwordChecks.minLength) {
          setError('Password must be at least 6 characters.');
          return;
        }
        const { error: err } = await signUpWithEmail(email, password);
        if (err) {
          setError(friendlyError(err));
        } else {
          setConfirmationSent(true);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    const { error: err } = await signInWithGoogle();
    if (err) setError(friendlyError(err));
  };

  const handleForgotPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { error: err } = await resetPassword(email);
      if (err) setError(friendlyError(err));
      else setResetSent(true);
    } finally {
      setLoading(false);
    }
  };

  const Spinner = () => (
    <svg className="animate-spin h-4 w-4 mx-auto" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );

  // ── Header bar (shared across all auth views) ──
  const header = (
    <div className="flex items-center justify-between mb-6">
      <button
        onClick={onBackToLanding}
        className={`flex items-center gap-1.5 text-sm transition-colors ${
          darkMode
            ? 'text-zinc-400 hover:text-zinc-200'
            : 'text-zinc-500 hover:text-zinc-700'
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back
      </button>
      <button
        onClick={() => setDarkMode((d) => !d)}
        className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
          darkMode
            ? 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
            : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200'
        }`}
        title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {darkMode ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>
    </div>
  );

  // ── Render view content based on current state ──
  const renderContent = () => {
    // Reset sent screen
    if (resetSent) {
      return (
        <>
          <div className="text-center">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${darkMode ? 'bg-accent-blue/15' : 'bg-accent-blue/10'}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-blue">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </div>
            <h2 className={`text-lg font-semibold mb-2 ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>Check your email</h2>
            <p className={`text-sm mb-6 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
              We sent a password reset link to <strong className={darkMode ? 'text-zinc-200' : 'text-zinc-700'}>{email}</strong>.
            </p>
            <button
              onClick={() => { setResetSent(false); setForgotPwd(false); setMode('signin'); }}
              className="text-sm text-accent-blue hover:brightness-110"
            >
              Back to sign in
            </button>
          </div>
        </>
      );
    }

    // Confirmation sent screen (after signup)
    if (confirmationSent) {
      return (
        <>
          <div className="text-center">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${darkMode ? 'bg-accent-blue/15' : 'bg-accent-blue/10'}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-blue">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </div>
            <h2 className={`text-lg font-semibold mb-2 ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>Check your email</h2>
            <p className={`text-sm mb-6 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
              We sent a confirmation link to <strong className={darkMode ? 'text-zinc-200' : 'text-zinc-700'}>{email}</strong>. Click the link to activate your account.
            </p>
            <button
              onClick={() => { setConfirmationSent(false); setMode('signin'); }}
              className="text-sm text-accent-blue hover:brightness-110"
            >
              Back to sign in
            </button>
          </div>
        </>
      );
    }

    // Forgot password form
    if (forgotPwd) {
      return (
        <>
          <div className="text-center mb-6">
            <h1 className={`text-xl font-bold mb-1 ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>Reset password</h1>
            <p className={`text-sm ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
              Enter your email and we&apos;ll send you a reset link.
            </p>
          </div>

          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div>
              <label htmlFor="reset-email" className={`block text-sm font-medium mb-1 ${darkMode ? 'text-zinc-300' : 'text-zinc-700'}`}>
                Email
              </label>
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue focus:border-transparent ${
                  darkMode
                    ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                    : 'border-zinc-300 bg-white text-zinc-900'
                }`}
                placeholder="you@example.com"
              />
            </div>

            {error && (
              <div className={`text-sm rounded-lg px-3 py-2 ${darkMode ? 'text-red-400 bg-red-900/20 border border-red-800' : 'text-red-500 bg-red-50 border border-red-200'}`}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2.5 bg-accent-blue hover:brightness-110 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-all"
            >
              {loading ? <Spinner /> : 'Send Reset Link'}
            </button>
          </form>

          <p className={`text-center text-sm mt-6 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
            <button
              onClick={() => { setForgotPwd(false); setError(null); }}
              className="text-accent-blue hover:brightness-110"
            >
              Back to sign in
            </button>
          </p>
        </>
      );
    }

    // Main sign in / sign up form
    return (
      <>
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-3">
            <LogoIcon size={40} darkMode={darkMode} />
          </div>
          <h1 className={`text-xl font-bold ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>
            <span className="font-light italic">info</span>
            <span className="font-semibold not-italic">nugget</span>
          </h1>
          <p className={`text-sm mt-1 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
            {mode === 'signin' ? 'Sign in to your account' : 'Create a new account'}
          </p>
        </div>

        {/* Google OAuth */}
        <button
          onClick={handleGoogleSignIn}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 border rounded-lg text-sm font-medium transition-colors ${
            darkMode
              ? 'border-zinc-700 text-zinc-300 bg-zinc-800 hover:bg-zinc-750'
              : 'border-zinc-300 text-zinc-700 bg-white hover:bg-zinc-50'
          }`}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 my-6">
          <div className={`flex-1 h-px ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'}`} />
          <span className={`text-xs ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>or</span>
          <div className={`flex-1 h-px ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'}`} />
        </div>

        {/* Email/Password Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className={`block text-sm font-medium mb-1 ${darkMode ? 'text-zinc-300' : 'text-zinc-700'}`}>
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue focus:border-transparent ${
                darkMode
                  ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                  : 'border-zinc-300 bg-white text-zinc-900'
              }`}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className={`block text-sm font-medium mb-1 ${darkMode ? 'text-zinc-300' : 'text-zinc-700'}`}>
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className={`w-full px-3 py-2 pr-10 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue focus:border-transparent ${
                  darkMode
                    ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                    : 'border-zinc-300 bg-white text-zinc-900'
                }`}
                placeholder={mode === 'signup' ? 'Min. 6 characters' : 'Your password'}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className={`absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded transition-colors ${
                  darkMode
                    ? 'text-zinc-500 hover:text-zinc-300'
                    : 'text-zinc-400 hover:text-zinc-600'
                }`}
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>

            {/* Password strength (signup only) */}
            {mode === 'signup' && password.length > 0 && (
              <div className="mt-1.5">
                <div className={`text-[11px] flex items-center gap-1 ${passwordChecks.minLength ? 'text-green-500' : darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  {passwordChecks.minLength ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /></svg>
                  )}
                  At least 6 characters
                </div>
              </div>
            )}

            {/* Forgot password link (signin only) */}
            {mode === 'signin' && (
              <div className="mt-1.5 text-right">
                <button
                  type="button"
                  onClick={() => { setForgotPwd(true); setError(null); }}
                  className={`text-[12px] transition-colors ${darkMode ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-600'}`}
                >
                  Forgot password?
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className={`text-sm rounded-lg px-3 py-2 ${darkMode ? 'text-red-400 bg-red-900/20 border border-red-800' : 'text-red-500 bg-red-50 border border-red-200'}`}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2.5 bg-accent-blue hover:brightness-110 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-all"
          >
            {loading ? <Spinner /> : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {/* Toggle mode */}
        <p className={`text-center text-sm mt-6 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
          {mode === 'signin' ? (
            <>
              Don&apos;t have an account?{' '}
              <button onClick={() => { setMode('signup'); setError(null); }} className="text-accent-blue hover:brightness-110">
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button onClick={() => { setMode('signin'); setError(null); }} className="text-accent-blue hover:brightness-110">
                Sign in
              </button>
            </>
          )}
        </p>

        {/* Terms / Privacy (signup only) */}
        {mode === 'signup' && (
          <p className={`text-center text-[11px] mt-4 ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
            By creating an account, you agree to our{' '}
            <a href="/terms" className="underline hover:text-accent-blue">Terms of Service</a>
            {' '}and{' '}
            <a href="/privacy" className="underline hover:text-accent-blue">Privacy Policy</a>.
          </p>
        )}
      </>
    );
  };

  return (
    <div className={`min-h-screen flex items-center justify-center px-4 ${darkMode ? 'bg-[#0a0a0a]' : 'bg-zinc-50'}`}>
      <div className={`w-full max-w-sm p-8 rounded-xl shadow-lg border ${darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}>
        {header}
        <div key={viewKey} className="auth-view-enter">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
