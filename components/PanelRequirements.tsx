import React from 'react';
import { useNuggetContext } from '../context/NuggetContext';
import { useSelectionContext } from '../context/SelectionContext';

// ── Requirement levels by panel ──
// sources / chat / smart-deck → Project, Nugget, Document
// cards                      → Project, Nugget, Document, Card
// assets                     → Project, Nugget, Document, Card, Image

type RequirementLevel = 'sources' | 'cards' | 'assets';

type Requirement = 'Project' | 'Nugget' | 'Document' | 'Card' | 'Image';

interface PanelRequirementsProps {
  level: RequirementLevel;
  /** For assets level: whether the active card has a generated image. */
  hasImage?: boolean;
  /** Called when user clicks an unmet requirement. */
  onRequirementClick?: (requirement: Requirement) => void;
}

const LEVEL_ITEMS: Record<RequirementLevel, Requirement[]> = {
  sources: ['Nugget', 'Document'],
  cards: ['Nugget', 'Document', 'Card'],
  assets: ['Nugget', 'Document', 'Card', 'Image'],
};

const HINTS: Record<Requirement, string> = {
  Project: '',
  Nugget: 'Create a nugget using the + button in the tab bar.',
  Document: 'Upload documents in the Sources panel.',
  Card: 'Generate cards from the Sources panel or Chat.',
  Image: 'Select a card and click Generate in the toolbar.',
};

const CheckIcon: React.FC = () => (
  <svg
    className="w-3 h-3 text-emerald-500 shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={3}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const CrossIcon: React.FC = () => (
  <svg
    className="w-3 h-3 text-zinc-300 dark:text-zinc-600 shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={3}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const PanelRequirements: React.FC<PanelRequirementsProps> = ({ level, hasImage = false, onRequirementClick }) => {
  const { selectedNugget } = useNuggetContext();
  const { selectedProjectId, activeCard: _activeCard } = useSelectionContext();

  const flags: Record<Requirement, boolean> = {
    Project: !!selectedProjectId,
    Nugget: !!selectedNugget,
    Document: (selectedNugget?.documents.filter((d) => d.enabled !== false).length ?? 0) > 0,
    Card: (selectedNugget?.cards.length ?? 0) > 0,
    Image: hasImage,
  };

  const items = LEVEL_ITEMS[level];
  const firstMissing = items.find((r) => !flags[r]);

  // All requirements met — nothing to show
  if (!firstMissing) return null;

  return (
    <div className="flex flex-col items-center gap-2.5 py-4">
      <div className="flex items-center gap-3.5 flex-wrap justify-center px-2">
        {items.map((item) => {
          const met = flags[item];
          const isNextStep = item === firstMissing;
          const clickable = !met && onRequirementClick;

          // ── Next-step pill: prominent accent button ──
          if (isNextStep && clickable) {
            return (
              <button
                key={item}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full cursor-pointer hover:opacity-90 transition-opacity animate-[req-blink_2s_ease-in-out_infinite]"
                style={{ backgroundColor: 'rgba(42, 159, 212, 0.1)', border: '1px solid rgba(42, 159, 212, 0.3)' }}
                onClick={() => onRequirementClick(item)}
              >
                <svg className="w-3 h-3 shrink-0" style={{ color: 'var(--accent-blue)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                <span className="text-[11px] leading-none font-medium" style={{ color: 'var(--accent-blue)' }}>
                  {item}
                </span>
              </button>
            );
          }

          const inner = (
            <>
              {met ? <CheckIcon /> : <CrossIcon />}
              <span
                className={`text-[11px] leading-none ${
                  met ? 'text-zinc-500 dark:text-zinc-400' : clickable ? 'text-zinc-400 dark:text-zinc-500 underline underline-offset-2 decoration-dotted' : 'text-zinc-300 dark:text-zinc-600'
                }`}
              >
                {item}
              </span>
            </>
          );
          return clickable ? (
            <button
              key={item}
              className="flex items-center gap-1 hover:opacity-80 transition-opacity cursor-pointer"
              onClick={() => onRequirementClick(item)}
            >
              {inner}
            </button>
          ) : (
            <div key={item} className="flex items-center gap-1">
              {inner}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-light">{HINTS[firstMissing]}</p>

      <style>{`
        @keyframes req-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
};

export default PanelRequirements;
