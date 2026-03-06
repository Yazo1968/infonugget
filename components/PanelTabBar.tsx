import React, { forwardRef } from 'react';

type PanelId = 'sources' | 'chat' | 'auto-deck' | 'cards' | 'quality';

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
    // Default blue — overridden dynamically based on qualityStatus
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
    id: 'auto-deck',
    label: 'Auto-Deck',
    requiresNugget: true,
    color: { dark: 'rgb(84,148,218)', light: 'rgb(84,148,218)' },
    dimColor: { dark: 'rgb(45,82,125)', light: 'rgb(45,82,125)' },
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="18" rx="2" />
        <line x1="8" y1="7" x2="16" y2="7" />
        <line x1="8" y1="11" x2="16" y2="11" />
        <line x1="8" y1="15" x2="12" y2="15" />
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

interface PanelTabBarProps {
  expandedPanel: PanelId | null;
  onTogglePanel: (panel: PanelId) => void;
  hasSelectedNugget: boolean;
  darkMode: boolean;
  disabledPanels?: PanelId[];
  qualityStatus?: QualityStatus;
}

const PanelTabBar = forwardRef<HTMLDivElement, PanelTabBarProps>(
  ({ expandedPanel, onTogglePanel, hasSelectedNugget, darkMode, disabledPanels, qualityStatus }, ref) => {
    // Resolve dynamic colors for the quality tab
    const getTabColors = (tab: TabConfig) => {
      if (tab.id === 'quality' && qualityStatus && QUALITY_COLORS[qualityStatus]) {
        return QUALITY_COLORS[qualityStatus];
      }
      return { color: tab.color, dimColor: tab.dimColor };
    };

    return (
      <div
        ref={ref}
        data-panel-strip
        className="flex flex-col shrink-0 w-8 overflow-visible border-r-2"
        style={{ backgroundColor: 'transparent', borderColor: 'rgb(84,148,218)' }}
      >
        {TABS.map((tab, tabIndex) => {
          const isActive = expandedPanel === tab.id;
          const isDisabled = (tab.requiresNugget && !hasSelectedNugget) || disabledPanels?.includes(tab.id);
          const colors = getTabColors(tab);
          return (
            <button
              key={tab.id}
              onClick={() => !isDisabled && onTogglePanel(tab.id)}
              className={`flex flex-col items-center justify-center gap-1.5 px-1 py-4 transition-colors relative rounded-l-[12px] -mt-2 first:mt-0 ${
                isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'
              }`}
              style={{
                backgroundColor: isDisabled
                  ? colors.dimColor[darkMode ? 'dark' : 'light']
                  : colors.color[darkMode ? 'dark' : 'light'],
                color: isDisabled ? 'rgba(255,255,255,0.3)' : 'white',
                zIndex: TABS.length - tabIndex,
                boxShadow: isActive
                  ? '0 3px 6px rgba(0,0,0,0.4)'
                  : '0 3px 6px rgba(0,0,0,0.4)',
              }}
              title={isDisabled ? `Create a nugget to access ${tab.label}` : tab.label}
              aria-disabled={isDisabled || undefined}
            >
              <div className="w-4 h-4 flex items-center justify-center">{tab.icon}</div>
              <span className="text-[9px] font-semibold uppercase leading-none tracking-wider" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}>
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
