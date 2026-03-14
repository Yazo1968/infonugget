import { useState, useEffect, type FormEvent } from 'react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../context/AuthContext';
import LogoIcon from './LogoIcon';

interface ProfileSetupProps {
  onComplete: () => void;
}

export default function ProfileSetup({ onComplete }: ProfileSetupProps) {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dark mode — read from localStorage / system preference
  const [darkMode] = useState(() => {
    const stored = localStorage.getItem('infonugget-dark-mode');
    if (stored !== null) return stored === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Pre-fill from Google OAuth metadata if available
  useEffect(() => {
    if (user?.user_metadata?.full_name) {
      setDisplayName(user.user_metadata.full_name);
    } else if (user?.user_metadata?.name) {
      setDisplayName(user.user_metadata.name);
    }
  }, [user]);

  /** Derive 2-letter initials from a name. Single word → first two letters. */
  const deriveInitials = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = displayName.trim();
    if (!trimmed) {
      setError('Please enter a display name.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { error: dbError } = await supabase
        .from('profiles')
        .update({
          display_name: trimmed,
          avatar_initials: deriveInitials(trimmed),
          updated_at: new Date().toISOString(),
        })
        .eq('id', user!.id);
      if (dbError) {
        setError(dbError.message);
      } else {
        onComplete();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    // Set a placeholder so they aren't asked again
    setLoading(true);
    const fallback = user?.email?.split('@')[0] ?? 'User';
    await supabase
      .from('profiles')
      .update({
        display_name: fallback,
        avatar_initials: deriveInitials(fallback),
        updated_at: new Date().toISOString(),
      })
      .eq('id', user!.id);
    onComplete();
  };

  return (
    <div className={`min-h-screen flex items-center justify-center px-4 ${darkMode ? 'bg-[#0a0a0a]' : 'bg-zinc-50'}`}>
      <div className={`w-full max-w-sm p-8 rounded-xl shadow-lg border ${darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}>
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="flex justify-center mb-4">
            <LogoIcon size={48} darkMode={darkMode} />
          </div>
          <h1 className={`text-lg font-bold mb-1 ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>
            Welcome to InfoNugget
          </h1>
          <p className={`text-sm ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
            What should we call you?
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="display-name" className={`block text-sm font-medium mb-1 ${darkMode ? 'text-zinc-300' : 'text-zinc-700'}`}>
              Display Name
            </label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoFocus
              maxLength={50}
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue focus:border-transparent ${
                darkMode
                  ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                  : 'border-zinc-300 bg-white text-zinc-900'
              }`}
              placeholder="Your name"
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
            {loading ? (
              <svg className="animate-spin h-4 w-4 mx-auto" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : 'Continue'}
          </button>
        </form>

        <button
          onClick={handleSkip}
          disabled={loading}
          className={`w-full text-center text-[12px] mt-3 py-1.5 transition-colors ${
            darkMode ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-600'
          }`}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
