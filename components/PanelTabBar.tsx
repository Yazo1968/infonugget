import React, { forwardRef, useState, useCallback, useRef } from 'react';

type PanelId = 'sources' | 'chat' | 'auto-presentor' | 'cards' | 'quality';

type QualityStatus = 'green' | 'amber' | 'red' | 'stale' | null;

interface TabConfig {
  id: PanelId;
  label: string;
  icon: React.ReactNode;
  requiresNugget: boolean;
  color: { dark: string; light: string };
  dimColor: { dark: string; light: string };
}

const TABS: TabConfig[] = [
  {
    id: 'sources',
    label: 'Sources',
    requiresNugget: true,
    color: { dark: 'rgb(23,80,172)', light: 'rgb(23,80,172)' },
    dimColor: { dark: 'rgb(12,42,95)', light: 'rgb(12,42,95)' },
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        <path d="M10 9H8" />
        <path d="M16 13H8" />
        <path d="M16 17H8" />
      </svg>
    ),
  },
  {
    id: 'quality',
    label: 'Brief & Quality',
    requiresNugget: true,
    color: { dark: 'rgb(51,115,196)', light: 'rgb(51,115,196)' },
    dimColor: { dark: 'rgb(28,62,110)', light: 'rgb(28,62,110)' },
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    id: 'chat',
    label: 'Chat',
    requiresNugget: true,
    color: { dark: 'rgb(51,115,196)', light: 'rgb(51,115,196)' },
    dimColor: { dark: 'rgb(28,62,110)', light: 'rgb(28,62,110)' },
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: 'auto-presentor',
    label: 'Auto-Presentor',
    requiresNugget: true,
    color: { dark: 'rgb(100,160,230)', light: 'rgb(100,160,230)' },
    dimColor: { dark: 'rgb(52,86,130)', light: 'rgb(52,86,130)' },
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8" />
        <path d="M12 17v4" />
      </svg>
    ),
  },
  {
    id: 'cards',
    label: 'Cards & Assets',
    requiresNugget: true,
    color: { dark: 'rgb(120,170,230)', light: 'rgb(120,170,230)' },
    dimColor: { dark: 'rgb(60,90,130)', light: 'rgb(60,90,130)' },
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect width="16" height="16" x="3" y="3" rx="2" ry="2" />
        <path d="M3 9h18" />
        <path d="M9 21V9" />
      </svg>
    ),
  },
];

// Dynamic colors for the quality tab based on check status
const QUALITY_COLORS: Record<string, { color: { dark: string; light: string }; dimColor: { dark: string; light: string } }> = {
  green: {
    color: { dark: 'rgb(34,160,90)', light: 'rgb(34,160,90)' },
    dimColor: { dark: 'rgb(18,88,50)', light: 'rgb(18,88,50)' },
  },
  amber: {
    color: { dark: 'rgb(210,160,30)', light: 'rgb(190,145,25)' },
    dimColor: { dark: 'rgb(115,88,16)', light: 'rgb(105,80,14)' },
  },
  red: {
    color: { dark: 'rgb(200,50,50)', light: 'rgb(200,50,50)' },
    dimColor: { dark: 'rgb(110,28,28)', light: 'rgb(110,28,28)' },
  },
  stale: {
    color: { dark: 'rgb(210,160,30)', light: 'rgb(190,145,25)' },
    dimColor: { dark: 'rgb(115,88,16)', light: 'rgb(105,80,14)' },
  },
};

const COLLAPSED_WIDTH = 36;
const EXPANDED_WIDTH = 160;

interface PanelTabBarProps {
  expandedPanel: PanelId | null;
  onTogglePanel: (panel: PanelId) => void;
  hasSelectedNugget: boolean;
  darkMode: boolean;
  disabledPanels?: PanelId[];
  qualityStatus?: QualityStatus;
  onGoHome?: () => void;
}

const PanelTabBar = forwardRef<HTMLDivElement, PanelTabBarProps>(
  ({ expandedPanel, onTogglePanel, hasSelectedNugget, darkMode, disabledPanels, qualityStatus, onGoHome }, ref) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const getTabColors = (tab: TabConfig) => {
      if (tab.id === 'quality' && qualityStatus && QUALITY_COLORS[qualityStatus]) {
        return QUALITY_COLORS[qualityStatus];
      }
      return { color: tab.color, dimColor: tab.dimColor };
    };

    const handleMouseEnter = useCallback(() => {
      if (collapseTimerRef.current) {
        clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = null;
      }
      setIsExpanded(true);
    }, []);

    const handleMouseLeave = useCallback(() => {
      collapseTimerRef.current = setTimeout(() => {
        setIsExpanded(false);
        collapseTimerRef.current = null;
      }, 200);
    }, []);

    const handleClick = useCallback(
      (tab: TabConfig, isDisabled: boolean) => {
        if (isDisabled) return;
        onTogglePanel(tab.id);
        setIsExpanded(false);
      },
      [onTogglePanel],
    );

    return (
      <div
        ref={ref}
        data-panel-strip
        className="flex flex-col shrink-0 overflow-hidden border-r transition-[width] duration-200 ease-in-out relative z-[135]"
        style={{
          width: isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
          backgroundColor: darkMode ? '#18181b' : '#ffffff',
          borderColor: darkMode ? 'rgba(100,160,230,0.25)' : 'rgba(30,90,180,0.2)',
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Home button */}
        {onGoHome && (
          <button
            onClick={() => { onGoHome(); setIsExpanded(false); }}
            className="flex items-center gap-2.5 px-2.5 py-3 transition-colors duration-150 cursor-pointer hover:bg-white/5"
            style={{
              color: 'rgb(84,148,218)',
              borderBottom: `1px solid ${darkMode ? 'rgba(100,160,230,0.15)' : 'rgba(30,90,180,0.1)'}`,
            }}
            title="Dashboard"
          >
            <div className="w-4 h-4 flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <span
              className="text-[11px] font-medium whitespace-nowrap overflow-hidden transition-opacity duration-200"
              style={{ opacity: isExpanded ? 1 : 0 }}
            >
              Dashboard
            </span>
          </button>
        )}

        {TABS.map((tab) => {
          const isActive = expandedPanel === tab.id;
          const isDisabled = (tab.requiresNugget && !hasSelectedNugget) || disabledPanels?.includes(tab.id);
          const colors = getTabColors(tab);
          const mode = darkMode ? 'dark' : 'light';

          return (
            <button
              key={tab.id}
              onClick={() => handleClick(tab, !!isDisabled)}
              className={`flex items-center gap-2.5 px-2.5 py-3 transition-colors duration-150 relative ${
                isDisabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-white/5'
              }`}
              style={{
                backgroundColor: isActive
                  ? darkMode
                    ? 'rgba(100,160,230,0.15)'
                    : 'rgba(30,90,180,0.10)'
                  : undefined,
                color: isDisabled
                  ? 'rgba(120,120,120,0.5)'
                  : colors.color[mode],
                borderLeft: isActive
                  ? `2px solid ${colors.color[mode]}`
                  : '2px solid transparent',
              }}
              title={isDisabled ? `Create a nugget to access ${tab.label}` : tab.label}
              aria-disabled={isDisabled || undefined}
            >
              <div className="w-4 h-4 flex items-center justify-center shrink-0">{tab.icon}</div>
              <span
                className="text-[11px] font-medium whitespace-nowrap overflow-hidden transition-opacity duration-200"
                style={{ opacity: isExpanded ? 1 : 0 }}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    );
  },
);

PanelTabBar.displayName = 'PanelTabBar';

export default PanelTabBar;
