import React, { useState, useRef, useEffect } from 'react';
import { useThemeContext } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import LogoIcon from './LogoIcon';
import UserAvatar from './UserAvatar';
import EditProfileModal from './EditProfileModal';
import { TokenUsageTotals, formatTokens, formatCost } from '../hooks/useTokenUsage';

interface HeaderBarProps {
  onReturnToLanding: () => void;
  usageTotals: TokenUsageTotals;
  resetUsage: () => void;
  projectName?: string;
}

function HeaderBar({ onReturnToLanding, usageTotals, resetUsage, projectName }: HeaderBarProps) {
  const { darkMode, toggleDarkMode } = useThemeContext();
  const { user, profile, signOut } = useAuth();

  // ── Local state ──
  const [showUsageDropdown, setShowUsageDropdown] = useState(false);
  const usageDropdownRef = useRef<HTMLDivElement>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [showEditProfile, setShowEditProfile] = useState(false);

  // ── Effects ──

  // Close dropdowns on outside click
  useEffect(() => {
    if (!showUsageDropdown && !userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (showUsageDropdown && usageDropdownRef.current && !usageDropdownRef.current.contains(e.target as Node)) {
        setShowUsageDropdown(false);
      }
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showUsageDropdown, userMenuOpen]);

  return (
    <header className="shrink-0 flex flex-col pt-2 relative z-[110]">
      {/* Single row: logo + controls */}
      <div className="h-9 flex items-center justify-between px-5 mb-1">
        <button
          onClick={onReturnToLanding}
          className="flex items-center gap-2 hover:opacity-70 transition-opacity cursor-pointer bg-transparent border-none p-0"
          title="Return to projects"
        >
          <LogoIcon size={28} darkMode={darkMode} className="shrink-0" />
          <span className="text-[17px] tracking-tight text-zinc-900 dark:text-zinc-100">
            <span className="font-light italic">info</span>
            <span className="font-semibold not-italic">nugget</span>
            {projectName && (
              <>
                <span className="font-light text-zinc-300 dark:text-zinc-600 mx-1.5">/</span>
                <span className="font-medium text-zinc-500 dark:text-zinc-400">{projectName}</span>
              </>
            )}
          </span>
        </button>

      {/* Right: token/cost counter + dark mode toggle + avatar */}
      <div className="flex items-center gap-2">
      <div className="shrink-0 flex items-center justify-end gap-1 relative" ref={usageDropdownRef}>
        <button
          onClick={() => setShowUsageDropdown((prev) => !prev)}
          className={`text-[10px] transition-colors font-mono tracking-tight px-2 py-0.5 rounded hover:bg-zinc-50 dark:hover:bg-zinc-700 ${usageTotals.callCount > 0 ? 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300' : 'text-zinc-300 dark:text-zinc-600 hover:text-zinc-400 dark:hover:text-zinc-500'}`}
          aria-expanded={showUsageDropdown}
        >
          {formatCost(usageTotals.totalCost)} ·{' '}
          {formatTokens(usageTotals.totalInputTokens + usageTotals.totalOutputTokens)} tokens
        </button>

        {showUsageDropdown && (
          <div className="absolute top-full right-0 mt-1 w-64 bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-50 py-2 px-3 text-[11px] text-zinc-600 dark:text-zinc-300">
            {/* Claude row */}
            <div className="flex justify-between items-center py-1 border-b border-zinc-50 dark:border-zinc-700">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">Claude</span>
              <span className="font-mono">{formatCost(usageTotals.claudeCost)}</span>
            </div>
            <div className="flex justify-between items-center py-0.5 text-[10px] text-zinc-400 dark:text-zinc-500 pl-2">
              <span>
                In: {formatTokens(usageTotals.claudeInputTokens)} · Out:{' '}
                {formatTokens(usageTotals.claudeOutputTokens)}
              </span>
            </div>

            {/* Gemini row */}
            <div className="flex justify-between items-center py-1 border-b border-zinc-50 dark:border-zinc-700 mt-1">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">Gemini</span>
              <span className="font-mono">{formatCost(usageTotals.geminiCost)}</span>
            </div>
            <div className="flex justify-between items-center py-0.5 text-[10px] text-zinc-400 dark:text-zinc-500 pl-2">
              <span>
                In: {formatTokens(usageTotals.geminiInputTokens)} · Out:{' '}
                {formatTokens(usageTotals.geminiOutputTokens)}
              </span>
            </div>

            {/* Cache savings */}
            {usageTotals.totalCacheReadTokens > 0 && (
              <div className="flex justify-between items-center py-0.5 text-[10px] text-zinc-400 dark:text-zinc-500 mt-1 border-t border-zinc-100 dark:border-zinc-700 pt-1">
                <span>Cache reads</span>
                <span className="font-mono">{formatTokens(usageTotals.totalCacheReadTokens)}</span>
              </div>
            )}

            {/* Total */}
            <div className="flex justify-between items-center py-1 mt-1 border-t border-zinc-100 dark:border-zinc-700 font-medium text-zinc-700 dark:text-zinc-300">
              <span>Total ({usageTotals.callCount} calls)</span>
              <span className="font-mono">{formatCost(usageTotals.totalCost)}</span>
            </div>

            {/* Reset button */}
            <button
              onClick={() => {
                resetUsage();
                setShowUsageDropdown(false);
              }}
              className="w-full mt-1.5 text-[10px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 rounded py-1 transition-colors"
            >
              Reset counters
            </button>
          </div>
        )}
      </div>

        {/* Dark mode toggle */}
        <button
          onClick={toggleDarkMode}
          className="w-6 h-6 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        {/* User avatar menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen((prev) => !prev)}
            title={user?.email ?? 'Account'}
            className="rounded-full transition-opacity hover:opacity-80"
          >
            <UserAvatar size={26} profile={profile} email={user?.email} />
          </button>
          {userMenuOpen && (
            <div className={`absolute right-0 top-full mt-1.5 w-52 rounded-lg shadow-lg border py-1 z-20 ${
              darkMode
                ? 'bg-zinc-900 border-zinc-700'
                : 'bg-white border-zinc-200'
            }`}>
              <div className={`px-3 py-2 text-[11px] truncate border-b ${
                darkMode
                  ? 'text-zinc-400 border-zinc-700'
                  : 'text-zinc-500 border-zinc-100'
              }`}>
                {user?.email}
              </div>
              <button
                onClick={() => { setUserMenuOpen(false); setShowEditProfile(true); }}
                className={`w-full text-left px-3 py-2 text-[11px] flex items-center gap-2 transition-colors ${
                  darkMode
                    ? 'text-zinc-300 hover:bg-zinc-800'
                    : 'text-zinc-700 hover:bg-zinc-50'
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                Edit Profile
              </button>
              <button
                onClick={() => { setUserMenuOpen(false); signOut(); }}
                className={`w-full text-left px-3 py-2 text-[11px] flex items-center gap-2 transition-colors ${
                  darkMode
                    ? 'text-zinc-300 hover:bg-zinc-800'
                    : 'text-zinc-700 hover:bg-zinc-50'
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Edit Profile Modal */}
      {showEditProfile && (
        <EditProfileModal darkMode={darkMode} onClose={() => setShowEditProfile(false)} />
      )}
    </header>
  );
}

export default HeaderBar;
