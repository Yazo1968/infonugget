import './globals.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { StorageProvider } from './components/StorageProvider';
import { ToastProvider } from './components/ToastNotification';
import { AuthProvider, useAuth } from './context/AuthContext';
import AuthPage from './components/AuthPage';

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="text-zinc-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
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
