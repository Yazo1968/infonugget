import './globals.css';
import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { StorageProvider } from './components/StorageProvider';
import { ToastProvider } from './components/ToastNotification';
import { AuthProvider, useAuth } from './context/AuthContext';
import AuthPage from './components/AuthPage';
import LandingPage from './components/LandingPage';
import ProfileSetup from './components/ProfileSetup';
import { supabase } from './utils/supabase';

type PreAuthPage = 'landing' | 'signin' | 'signup';

function AuthGate() {
  const { user, loading } = useAuth();
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

  const handleProfileComplete = useCallback(() => {
    setNeedsProfile(false);
  }, []);

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
