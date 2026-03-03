import React, { useState, useRef, useEffect } from 'react';
import { useThemeContext } from '../context/ThemeContext';
import LogoIcon from './LogoIcon';
import { TokenUsageTotals, formatTokens, formatCost } from '../hooks/useTokenUsage';

interface HeaderBarProps {
  onReturnToLanding: () => void;
  usageTotals: TokenUsageTotals;
  resetUsage: () => void;
}

function HeaderBar({ onReturnToLanding, usageTotals, resetUsage }: HeaderBarProps) {
  const { darkMode, toggleDarkMode } = useThemeContext();

  // ── Local state ──
  const [showUsageDropdown, setShowUsageDropdown] = useState(false);
  const usageDropdownRef = useRef<HTMLDivElement>(null);

  // ── Effects ──

  // Close usage dropdown on outside click
  useEffect(() => {
    if (!showUsageDropdown) return;
    const handler = (e: MouseEvent) => {
      if (usageDropdownRef.current && !usageDropdownRef.current.contains(e.target as Node)) {
        setShowUsageDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showUsageDropdown]);

  return (
    <header className="shrink-0 flex flex-col pt-2 border-b border-zinc-100 dark:border-zinc-700 relative z-[110]">
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
          </span>
        </button>

      {/* Right: dark mode toggle + token/cost counter */}
      <div className="w-48 shrink-0 flex items-center justify-end gap-1 relative" ref={usageDropdownRef}>
        <button
          onClick={toggleDarkMode}
          className="w-6 h-6 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
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
      </div>
    </header>
  );
}

export default HeaderBar;
