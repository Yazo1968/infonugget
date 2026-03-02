import React from 'react';
import LogoIcon from './LogoIcon';

export const LoadingScreen: React.FC = () => {
  const isDark = document.documentElement.classList.contains('dark');
  return (
  <div className="h-screen w-full flex flex-col items-center justify-center bg-zinc-50 dark:bg-[#0a0a0a]">
    {/* Logo */}
    <div className="relative mb-8 flex items-center justify-center">
      <LogoIcon size={80} darkMode={isDark} />
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
};
