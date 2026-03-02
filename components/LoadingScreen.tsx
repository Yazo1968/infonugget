import React from 'react';

export const LoadingScreen: React.FC = () => (
  <div className="h-screen w-full flex flex-col items-center justify-center bg-zinc-50 dark:bg-[#0a0a0a]">
    {/* Logo */}
    <div className="relative mb-8">
      <div
        className="absolute inset-0 rounded-full animate-pulse"
        style={{ boxShadow: '0 0 60px 20px rgba(42, 159, 212, 0.12)' }}
      />
      <div className="w-20 h-20 bg-accent-blue rounded-full flex items-center justify-center shadow-2xl relative z-10">
        <div className="w-7 h-7 bg-white rounded-md rotate-45" />
      </div>
    </div>

    {/* Wordmark */}
    <h1 className="text-4xl tracking-tighter mb-3">
      <span className="font-light italic text-zinc-400 dark:text-zinc-500">info</span>
      <span className="font-semibold not-italic text-zinc-900 dark:text-white">nugget</span>
    </h1>

    {/* Loading message */}
    <p className="text-xs font-light text-zinc-400 dark:text-zinc-500">Loading your workspace...</p>
  </div>
);
