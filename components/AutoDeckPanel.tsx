import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { UploadedFile, AutoDeckBriefing, AutoDeckLod, AutoDeckSession } from '../types';
import { useThemeContext } from '../context/ThemeContext';
import PanelRequirements from './PanelRequirements';
import {
  AUTO_DECK_LOD_LEVELS,
  AUTO_DECK_LIMITS,
  estimateCardCount,
  countWords,
  LodConfig,
} from '../utils/autoDeck/constants';
import { usePanelOverlay } from '../hooks/usePanelOverlay';

// ── Props ──

interface AutoDeckPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  documents: UploadedFile[];
  // Hook bindings
  session: AutoDeckSession | null;
  onStartPlanning: (briefing: AutoDeckBriefing, lod: AutoDeckLod, orderedDocIds: string[]) => Promise<void>;
  onRevisePlan: () => Promise<void>;
  onApprovePlan: () => Promise<void>;
  onAbort: () => void;
  onReset: () => void;
  onToggleCardIncluded: (cardNumber: number) => void;
  onSetQuestionAnswer: (questionId: string, optionKey: string) => void;
  onSetAllRecommended: () => void;
  onSetGeneralComment: (comment: string) => void;
  onRetryFromReview: () => void;
  tabBarRef?: React.RefObject<HTMLElement | null>;
  // Briefing (read from nugget, edited via Brief & Quality panel)
  briefing?: AutoDeckBriefing;
  onOpenBriefTab?: () => void;
}

// ── Component ──

const AutoDeckPanel: React.FC<AutoDeckPanelProps> = ({
  isOpen,
  onToggle,
  documents,
  session,
  onStartPlanning,
  onRevisePlan,
  onApprovePlan,
  onAbort,
  onReset,
  onToggleCardIncluded,
  onSetQuestionAnswer,
  onSetAllRecommended,
  onSetGeneralComment,
  onRetryFromReview,
  tabBarRef,
  briefing: propBriefing,
  onOpenBriefTab,
}) => {
  const { darkMode } = useThemeContext();
  const { shouldRender, isClosing, overlayStyle } = usePanelOverlay({
    isOpen,
    defaultWidth: Math.min(window.innerWidth * 0.5, 700),
    minWidth: 300,
    anchorRef: tabBarRef,
  });

  // ── Configuration state (deck generation params only) ──
  const [selectedLod, setSelectedLod] = useState<AutoDeckLod | null>(null);
  const [cardMin, setCardMin] = useState<string>('');
  const [cardMax, setCardMax] = useState<string>('');
  const [includeCover, setIncludeCover] = useState(false);
  const [includeClosing, setIncludeClosing] = useState(false);

  // Available documents (have content)
  const availableDocs = documents.filter((d) => d.content || d.fileId || d.pdfBase64);

  // Reset config when session resets
  useEffect(() => {
    if (!session) {
      setSelectedLod(null);
      setCardMin('');
      setCardMax('');
      setIncludeCover(false);
      setIncludeClosing(false);
    }
  }, [session]);

  // ── Derived values ──
  const selectedDocs = availableDocs.filter((d) => d.enabled !== false);
  const totalWordCount = selectedDocs.reduce((sum, d) => sum + (d.content ? countWords(d.content) : 0), 0);
  const estimate = selectedLod ? estimateCardCount(totalWordCount, selectedLod) : null;

  const status = session?.status ?? 'configuring';
  const hasBriefing = propBriefing?.objective?.trim() || propBriefing?.audience?.trim() || propBriefing?.type?.trim();
  const canGenerate =
    propBriefing?.objective?.trim() &&
    propBriefing?.audience?.trim() &&
    propBriefing?.type?.trim() &&
    selectedLod &&
    selectedDocs.length > 0;
  const includedCount = session?.reviewState
    ? Object.values(session.reviewState.cardStates).filter((s) => s.included).length
    : 0;

  // ── Handlers ──

  const handleGenerate = useCallback(async () => {
    if (!canGenerate || !selectedLod || !propBriefing) return;
    const parsedMin = cardMin ? Math.max(5, Math.min(50, parseInt(cardMin, 10))) : undefined;
    const parsedMax = cardMax ? Math.max(5, Math.min(50, parseInt(cardMax, 10))) : undefined;
    const cleanBriefing: AutoDeckBriefing = {
      audience: propBriefing.audience.trim(),
      type: propBriefing.type.trim(),
      objective: propBriefing.objective.trim(),
      ...(propBriefing.tone?.trim() ? { tone: propBriefing.tone.trim() } : {}),
      ...(propBriefing.focus?.trim() ? { focus: propBriefing.focus.trim() } : {}),
      ...(parsedMin ? { minCards: parsedMin } : {}),
      ...(parsedMax ? { maxCards: parsedMax } : {}),
      ...(includeCover ? { includeCover: true } : {}),
      ...(includeClosing ? { includeClosing: true } : {}),
    };
    await onStartPlanning(
      cleanBriefing,
      selectedLod,
      selectedDocs.map((d) => d.id),
    );
  }, [
    canGenerate,
    propBriefing,
    selectedLod,
    cardMin,
    cardMax,
    includeCover,
    includeClosing,
    selectedDocs,
    onStartPlanning,
  ]);

  // ── Colors ──
  const stripBg = 'rgb(84,148,218)';
  const borderColor = stripBg;
  const inputBg = darkMode ? 'rgba(255,255,255,0.05)' : 'white';
  const inputBorder = darkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
  const inputColor = darkMode ? '#e2e8f0' : '#1e293b';
  const hintColor = darkMode ? '#64748b' : '#94a3b8';
  const labelColor = darkMode ? '#94a3b8' : '#64748b';

  // ── Briefing summary fields ──
  const briefingFields = [
    { key: 'objective' as const, label: 'Objective' },
    { key: 'audience' as const, label: 'Audience' },
    { key: 'type' as const, label: 'Type' },
    { key: 'tone' as const, label: 'Tone' },
    { key: 'focus' as const, label: 'Focus' },
  ];

  // ── Render views ──

  const renderConfigView = () => (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
    <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
    <div className="max-w-2xl mx-auto">
      {/* ── Briefing summary (read-only) ── */}
      <div style={{ marginBottom: '20px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
          }}
        >
          <div
            style={{
              fontSize: '12px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: labelColor,
            }}
          >
            Deck Briefing
          </div>
          {onOpenBriefTab && (
            <button
              onClick={onOpenBriefTab}
              style={{
                fontSize: '11px',
                color: darkMode ? '#4db8e0' : '#2289b5',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: 0,
              }}
            >
              {hasBriefing ? 'Edit Brief' : 'Set Brief'}
            </button>
          )}
        </div>

        {hasBriefing ? (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
              backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'white',
            }}
          >
            {briefingFields.map(({ key, label }) => {
              const value = propBriefing?.[key]?.trim();
              if (!value) return null;
              return (
                <div key={key} style={{ marginBottom: '6px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: labelColor }}>{label}: </span>
                  <span style={{ fontSize: '12px', color: inputColor }}>{value}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              padding: '16px',
              borderRadius: '8px',
              border: `2px dashed ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '12px', color: hintColor, marginBottom: '6px' }}>
              No briefing set yet
            </div>
            {onOpenBriefTab && (
              <button
                onClick={onOpenBriefTab}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: darkMode ? '#1d7ca8' : '#2289b5',
                  color: '#ffffff',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Set Brief
              </button>
            )}
          </div>
        )}
      </div>

      {/* LOD selector */}
      <div style={{ marginBottom: '20px' }}>
        <div
          style={{
            fontSize: '12px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: labelColor,
            marginBottom: '8px',
          }}
        >
          Level of Detail
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {(Object.values(AUTO_DECK_LOD_LEVELS) as LodConfig[]).map((lod) => {
            const isSelected = selectedLod === lod.name;
            return (
              <button
                key={lod.name}
                onClick={() => setSelectedLod(lod.name)}
                style={{
                  flex: 1,
                  padding: '10px 8px',
                  borderRadius: '8px',
                  border: `2px solid ${isSelected ? (darkMode ? '#4db8e0' : '#2289b5') : darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                  backgroundColor: isSelected
                    ? darkMode
                      ? 'rgba(42,159,212,0.15)'
                      : 'rgba(42,159,212,0.08)'
                    : darkMode
                      ? 'rgba(255,255,255,0.03)'
                      : 'white',
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 600, color: darkMode ? '#e2e8f0' : '#1e293b' }}>
                  {lod.label}
                </div>
                <div style={{ fontSize: '11px', color: hintColor }}>
                  {lod.wordCountMin}&ndash;{lod.wordCountMax} words
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Estimate badge */}
      {estimate && (
        <div
          style={{
            padding: '10px 16px',
            borderRadius: '8px',
            backgroundColor: darkMode ? 'rgba(42,159,212,0.1)' : 'rgba(42,159,212,0.06)',
            border: `1px solid ${darkMode ? 'rgba(42,159,212,0.2)' : 'rgba(42,159,212,0.15)'}`,
            marginBottom: '20px',
            fontSize: '13px',
            color: darkMode ? '#5abdd9' : '#1a7aaa',
            textAlign: 'center',
          }}
        >
          Rough estimate:{' '}
          <strong>
            ~{estimate.min}&ndash;{estimate.max} cards
          </strong>
          <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.7 }}>
            AI will determine the optimal count based on content
          </div>
          {selectedDocs.some((d) => d.sourceType === 'native-pdf' && !d.content) && (
            <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.75 }}>
              Estimate excludes PDF documents (word count unavailable)
            </div>
          )}
          {estimate.max > AUTO_DECK_LIMITS.maxCardsWarning && (
            <div style={{ color: darkMode ? '#fbbf24' : '#d97706', fontSize: '12px', marginTop: '4px' }}>
              Large deck — consider Executive LOD or reducing source material.
            </div>
          )}
          {estimate.min < AUTO_DECK_LIMITS.minCards && totalWordCount > 0 && (
            <div style={{ color: darkMode ? '#fbbf24' : '#d97706', fontSize: '12px', marginTop: '4px' }}>
              Source may be too short for this detail level.
            </div>
          )}
        </div>
      )}

      {/* Card count range (optional) */}
      <div style={{ marginBottom: '20px' }}>
        <div
          style={{
            fontSize: '12px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: labelColor,
            marginBottom: '8px',
          }}
        >
          Card Count Range{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', fontSize: '11px', opacity: 0.7 }}>(optional)</span>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '11px', color: hintColor, display: 'block', marginBottom: '3px' }}>Min</label>
            <input
              type="number"
              min={5}
              max={50}
              value={cardMin}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9]/g, '');
                const n = parseInt(v, 10);
                if (v === '' || (n >= 1 && n <= 50)) setCardMin(v);
              }}
              placeholder="5"
              className="focus:outline-none focus:ring-2 focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50"
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: inputColor,
                fontSize: '13px',
                boxSizing: 'border-box',
                textAlign: 'center',
              }}
            />
          </div>
          <div style={{ color: hintColor, fontSize: '13px', paddingTop: '16px' }}>to</div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '11px', color: hintColor, display: 'block', marginBottom: '3px' }}>Max</label>
            <input
              type="number"
              min={5}
              max={50}
              value={cardMax}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9]/g, '');
                const n = parseInt(v, 10);
                if (v === '' || (n >= 1 && n <= 50)) setCardMax(v);
              }}
              placeholder="50"
              className="focus:outline-none focus:ring-2 focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50"
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: inputColor,
                fontSize: '13px',
                boxSizing: 'border-box',
                textAlign: 'center',
              }}
            />
          </div>
        </div>
        {cardMin && parseInt(cardMin, 10) < 5 && (
          <div style={{ fontSize: '11px', color: darkMode ? '#f87171' : '#dc2626', marginTop: '4px' }}>
            Minimum is 5 cards.
          </div>
        )}
        {cardMax && parseInt(cardMax, 10) > 50 && (
          <div style={{ fontSize: '11px', color: darkMode ? '#f87171' : '#dc2626', marginTop: '4px' }}>
            Maximum is 50 cards.
          </div>
        )}
        {cardMin && cardMax && parseInt(cardMin, 10) > parseInt(cardMax, 10) && (
          <div style={{ fontSize: '11px', color: darkMode ? '#f87171' : '#dc2626', marginTop: '4px' }}>
            Min cannot exceed max.
          </div>
        )}
        <div style={{ fontSize: '10px', color: hintColor, marginTop: '4px', fontStyle: 'italic' }}>
          Range: 5–50. Leave blank to let the AI decide.
        </div>
      </div>

      {/* Deck options (checkboxes) */}
      <div style={{ marginBottom: '20px' }}>
        <div
          style={{
            fontSize: '12px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: labelColor,
            marginBottom: '10px',
          }}
        >
          Deck Options
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {(
            [
              {
                checked: includeCover,
                onChange: setIncludeCover,
                label: 'Cover card',
                hint: 'Title slide with deck overview',
              },
              {
                checked: includeClosing,
                onChange: setIncludeClosing,
                label: 'Closing card',
                hint: 'Takeaway or conclusion slide',
              },
            ] as const
          ).map((opt) => (
            <label
              key={opt.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                padding: '6px 10px',
                borderRadius: '6px',
                backgroundColor: opt.checked
                  ? darkMode
                    ? 'rgba(42,159,212,0.1)'
                    : 'rgba(42,159,212,0.05)'
                  : 'transparent',
                transition: 'background-color 0.15s',
              }}
            >
              <input
                type="checkbox"
                checked={opt.checked}
                onChange={(e) => opt.onChange(e.target.checked)}
                style={{ accentColor: darkMode ? '#4db8e0' : '#2289b5', cursor: 'pointer' }}
              />
              <div>
                <div style={{ fontSize: '13px', fontWeight: 500, color: inputColor }}>{opt.label}</div>
                <div style={{ fontSize: '11px', color: hintColor }}>{opt.hint}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={!canGenerate}
        style={{
          width: '100%',
          padding: '12px',
          borderRadius: '8px',
          border: 'none',
          backgroundColor: canGenerate
            ? darkMode
              ? '#2289b5'
              : '#1a7aaa'
            : darkMode
              ? 'rgba(255,255,255,0.08)'
              : 'rgba(0,0,0,0.08)',
          color: canGenerate ? 'white' : darkMode ? '#64748b' : '#94a3b8',
          fontWeight: 600,
          fontSize: '14px',
          cursor: canGenerate ? 'pointer' : 'not-allowed',
          transition: 'all 0.15s',
        }}
      >
        Generate Plan
      </button>
      {!canGenerate && !hasBriefing && selectedDocs.length > 0 && (
        <div style={{ fontSize: '11px', color: hintColor, textAlign: 'center', marginTop: '6px' }}>
          Set a briefing to enable generation
        </div>
      )}
    </div>
    </div>
    </div>
  );

  const renderLoadingView = (message: string) => (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        padding: '40px',
      }}
    >
      {/* Pulsing dots animation */}
      <div style={{ display: 'flex', gap: '6px' }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: darkMode ? '#4db8e0' : '#2289b5',
              animation: `autodeck-pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
      <div style={{ fontSize: '14px', color: darkMode ? '#94a3b8' : '#64748b', textAlign: 'center' }}>{message}</div>
      <button
        onClick={onAbort}
        style={{
          padding: '8px 20px',
          borderRadius: '6px',
          border: `1px solid ${darkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}`,
          backgroundColor: 'transparent',
          color: darkMode ? '#94a3b8' : '#64748b',
          fontSize: '13px',
          cursor: 'pointer',
          marginTop: '8px',
        }}
      >
        Cancel
      </button>
    </div>
  );

  const renderConflictView = () => {
    if (!session?.conflicts) return null;
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
      <div className="max-w-2xl mx-auto">
        {/* Alert banner */}
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '8px',
            backgroundColor: darkMode ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.08)',
            border: `1px solid ${darkMode ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.2)'}`,
            marginBottom: '16px',
          }}
        >
          <div
            style={{ fontWeight: 600, fontSize: '14px', color: darkMode ? '#f87171' : '#dc2626', marginBottom: '4px' }}
          >
            Conflicts Detected
          </div>
          <div style={{ fontSize: '13px', color: darkMode ? '#fca5a5' : '#b91c1c' }}>
            The documents contain contradictory information. Please resolve these conflicts before proceeding.
          </div>
        </div>

        {/* Conflict list */}
        {session.conflicts.map((conflict, i) => (
          <div
            key={i}
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
              backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'white',
              marginBottom: '10px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '8px',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 500, color: darkMode ? '#e2e8f0' : '#1e293b', flex: 1 }}>
                {conflict.description}
              </div>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '10px',
                  backgroundColor:
                    conflict.severity === 'high'
                      ? darkMode
                        ? 'rgba(239,68,68,0.2)'
                        : 'rgba(239,68,68,0.1)'
                      : conflict.severity === 'medium'
                        ? darkMode
                          ? 'rgba(251,191,36,0.2)'
                          : 'rgba(251,191,36,0.1)'
                        : darkMode
                          ? 'rgba(96,165,250,0.2)'
                          : 'rgba(96,165,250,0.1)',
                  color:
                    conflict.severity === 'high'
                      ? darkMode
                        ? '#f87171'
                        : '#dc2626'
                      : conflict.severity === 'medium'
                        ? darkMode
                          ? '#fbbf24'
                          : '#d97706'
                        : darkMode
                          ? '#60a5fa'
                          : '#2563eb',
                  marginLeft: '8px',
                  whiteSpace: 'nowrap',
                }}
              >
                {conflict.severity}
              </span>
            </div>
            <div style={{ fontSize: '12px', color: labelColor }}>
              <div>
                Source A: {conflict.sourceA.document} &mdash; {conflict.sourceA.section}
              </div>
              <div>
                Source B: {conflict.sourceB.document} &mdash; {conflict.sourceB.section}
              </div>
            </div>
          </div>
        ))}

        {/* Back button */}
        <button
          onClick={onReset}
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: '8px',
            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}`,
            backgroundColor: 'transparent',
            color: darkMode ? '#e2e8f0' : '#1e293b',
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
            marginTop: '8px',
          }}
        >
          Back to Configuration
        </button>
      </div>
      </div>
    );
  };

  const renderReviewView = () => {
    if (!session?.parsedPlan || !session.reviewState) return null;
    const { parsedPlan, reviewState } = session;
    const questions = parsedPlan.questions || [];
    const answeredCount = Object.keys(reviewState.questionAnswers).length;
    const totalQuestions = questions.length;

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header strip */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
            alignItems: 'center',
            fontSize: '12px',
          }}
        >
          <span
            style={{
              padding: '3px 10px',
              borderRadius: '10px',
              backgroundColor: darkMode ? 'rgba(42,159,212,0.15)' : 'rgba(42,159,212,0.08)',
              color: darkMode ? '#5abdd9' : '#1a7aaa',
              fontWeight: 600,
            }}
          >
            {session.briefing.type}
          </span>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: '10px',
              backgroundColor: darkMode ? 'rgba(96,165,250,0.15)' : 'rgba(59,130,246,0.08)',
              color: darkMode ? '#93c5fd' : '#2563eb',
              fontWeight: 600,
            }}
          >
            {AUTO_DECK_LOD_LEVELS[parsedPlan.metadata.lod]?.label}
          </span>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: '10px',
              backgroundColor: darkMode ? 'rgba(52,211,153,0.15)' : 'rgba(16,185,129,0.08)',
              color: darkMode ? '#6ee7b7' : '#059669',
              fontWeight: 600,
            }}
          >
            {parsedPlan.cards.length} cards
          </span>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: '10px',
              backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
              color: darkMode ? '#94a3b8' : '#64748b',
            }}
          >
            {parsedPlan.metadata.documentStrategy}
          </span>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
        <div className="max-w-2xl mx-auto">
          {/* Card list (read-only with checkboxes) */}
          <div style={{ marginBottom: '20px' }}>
            <div
              style={{
                fontSize: '12px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: labelColor,
                marginBottom: '8px',
              }}
            >
              Card Plan
            </div>
            {parsedPlan.cards.map((card) => {
              const cardState = reviewState.cardStates[card.number];
              const isIncluded = cardState?.included !== false;
              return (
                <div
                  key={card.number}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: `1px solid ${darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
                    backgroundColor: isIncluded
                      ? darkMode
                        ? 'rgba(255,255,255,0.03)'
                        : 'white'
                      : darkMode
                        ? 'rgba(255,255,255,0.01)'
                        : 'rgba(0,0,0,0.02)',
                    marginBottom: '4px',
                    opacity: isIncluded ? 1 : 0.45,
                    transition: 'opacity 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={isIncluded}
                      onChange={() => onToggleCardIncluded(card.number)}
                      style={{ marginTop: '2px', accentColor: darkMode ? '#4db8e0' : '#2289b5', cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: darkMode ? '#e2e8f0' : '#1e293b' }}>
                        <span style={{ color: hintColor, fontWeight: 400, marginRight: '5px' }}>{card.number}.</span>
                        {card.title}
                      </div>
                      <div style={{ fontSize: '11px', color: labelColor, marginTop: '1px' }}>{card.description}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Decision questions (MCQ) */}
          {questions.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}
              >
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: labelColor,
                  }}
                >
                  Decision Points
                  <span
                    style={{
                      fontWeight: 400,
                      textTransform: 'none',
                      marginLeft: '6px',
                      fontSize: '11px',
                      opacity: 0.7,
                    }}
                  >
                    {answeredCount}/{totalQuestions} answered
                  </span>
                </div>
                <button
                  onClick={onSetAllRecommended}
                  style={{
                    fontSize: '11px',
                    color: darkMode ? '#4db8e0' : '#2289b5',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0,
                  }}
                >
                  Use all recommended
                </button>
              </div>

              {questions.map((q, qi) => {
                const selectedKey = reviewState.questionAnswers[q.id];
                return (
                  <div
                    key={q.id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: '8px',
                      border: `1px solid ${
                        !selectedKey
                          ? darkMode
                            ? 'rgba(251,191,36,0.25)'
                            : 'rgba(217,119,6,0.2)'
                          : darkMode
                            ? 'rgba(255,255,255,0.08)'
                            : 'rgba(0,0,0,0.08)'
                      }`,
                      backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'white',
                      marginBottom: '10px',
                    }}
                  >
                    {/* Question context */}
                    {q.context && (
                      <div style={{ fontSize: '11px', color: hintColor, marginBottom: '4px', fontStyle: 'italic' }}>
                        {q.context}
                      </div>
                    )}
                    {/* Question text */}
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: darkMode ? '#e2e8f0' : '#1e293b',
                        marginBottom: '8px',
                      }}
                    >
                      <span style={{ color: hintColor, fontWeight: 400, marginRight: '5px' }}>Q{qi + 1}.</span>
                      {q.question}
                    </div>
                    {/* Options as radio buttons */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {q.options.map((opt) => {
                        const isSelected = selectedKey === opt.key;
                        const isRecommended = q.recommendedKey === opt.key;
                        return (
                          <label
                            key={opt.key}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '8px',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              backgroundColor: isSelected
                                ? darkMode
                                  ? 'rgba(42,159,212,0.12)'
                                  : 'rgba(42,159,212,0.06)'
                                : 'transparent',
                              border: `1px solid ${
                                isSelected
                                  ? darkMode
                                    ? 'rgba(42,159,212,0.3)'
                                    : 'rgba(42,159,212,0.2)'
                                  : 'transparent'
                              }`,
                              transition: 'all 0.15s',
                            }}
                          >
                            <input
                              type="radio"
                              name={q.id}
                              checked={isSelected}
                              onChange={() => onSetQuestionAnswer(q.id, opt.key)}
                              style={{
                                marginTop: '2px',
                                accentColor: darkMode ? '#4db8e0' : '#2289b5',
                                cursor: 'pointer',
                              }}
                            />
                            <div style={{ flex: 1 }}>
                              <span style={{ fontSize: '12px', color: darkMode ? '#e2e8f0' : '#1e293b' }}>
                                {opt.label}
                              </span>
                              {isRecommended && (
                                <span
                                  style={{
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    marginLeft: '6px',
                                    padding: '1px 6px',
                                    borderRadius: '8px',
                                    backgroundColor: darkMode ? 'rgba(52,211,153,0.15)' : 'rgba(16,185,129,0.1)',
                                    color: darkMode ? '#6ee7b7' : '#059669',
                                  }}
                                >
                                  Recommended
                                </span>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* General comment (escape hatch) */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: labelColor, marginBottom: '6px' }}>
              General feedback (optional)
            </div>
            <textarea
              value={reviewState.generalComment}
              onChange={(e) => onSetGeneralComment(e.target.value)}
              placeholder="Any overall comments about the plan..."
              rows={2}
              className="focus:outline-none focus:ring-2 focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50"
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '8px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: inputColor,
                fontSize: '12px',
                resize: 'vertical',
              }}
            />
          </div>
        </div>
        </div>

        {/* Sticky bottom bar */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
            display: 'flex',
            gap: '10px',
            alignItems: 'center',
            backgroundColor: darkMode ? 'rgb(24,24,27)' : 'white',
          }}
        >
          {session.revisionCount > 0 && (
            <span style={{ fontSize: '11px', color: hintColor, marginRight: 'auto' }}>
              Revision {session.revisionCount} of {AUTO_DECK_LIMITS.maxRevisions}
            </span>
          )}
          <div style={{ flex: session.revisionCount > 0 ? undefined : 1 }} />
          <button
            onClick={onRevisePlan}
            disabled={session.revisionCount >= AUTO_DECK_LIMITS.maxRevisions}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`,
              backgroundColor: 'transparent',
              color:
                session.revisionCount >= AUTO_DECK_LIMITS.maxRevisions
                  ? darkMode
                    ? '#64748b'
                    : '#94a3b8'
                  : darkMode
                    ? '#e2e8f0'
                    : '#1e293b',
              fontWeight: 600,
              fontSize: '13px',
              cursor: session.revisionCount >= AUTO_DECK_LIMITS.maxRevisions ? 'not-allowed' : 'pointer',
            }}
          >
            Revise Plan
          </button>
          <button
            onClick={onApprovePlan}
            disabled={includedCount === 0}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor:
                includedCount > 0
                  ? darkMode
                    ? '#2289b5'
                    : '#1a7aaa'
                  : darkMode
                    ? 'rgba(255,255,255,0.08)'
                    : 'rgba(0,0,0,0.08)',
              color: includedCount > 0 ? 'white' : darkMode ? '#64748b' : '#94a3b8',
              fontWeight: 600,
              fontSize: '13px',
              cursor: includedCount > 0 ? 'pointer' : 'not-allowed',
            }}
          >
            Submit ({includedCount})
          </button>
        </div>
      </div>
    );
  };

  const renderCompleteView = () => (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        padding: '40px',
      }}
    >
      {/* Success icon */}
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          backgroundColor: darkMode ? 'rgba(52,211,153,0.15)' : 'rgba(16,185,129,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke={darkMode ? '#6ee7b7' : '#059669'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div style={{ fontSize: '16px', fontWeight: 600, color: darkMode ? '#e2e8f0' : '#1e293b', textAlign: 'center' }}>
        {session?.producedCards.length || 0} cards generated
      </div>
      <div style={{ fontSize: '13px', color: labelColor, textAlign: 'center' }}>
        Cards have been added to the card list. Select a card and use the Assets Panel to generate images.
      </div>
      <button
        onClick={onReset}
        style={{
          padding: '10px 24px',
          borderRadius: '8px',
          border: `1px solid ${darkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}`,
          backgroundColor: 'transparent',
          color: darkMode ? '#e2e8f0' : '#1e293b',
          fontWeight: 600,
          fontSize: '13px',
          cursor: 'pointer',
          marginTop: '8px',
        }}
      >
        Start New Deck
      </button>
    </div>
  );

  const renderErrorView = () => (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        padding: '40px',
      }}
    >
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          backgroundColor: darkMode ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke={darkMode ? '#f87171' : '#dc2626'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      </div>
      <div style={{ fontSize: '14px', fontWeight: 500, color: darkMode ? '#f87171' : '#dc2626', textAlign: 'center' }}>
        {session?.error || 'An error occurred.'}
      </div>
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={onReset}
          style={{
            padding: '8px 20px',
            borderRadius: '6px',
            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}`,
            backgroundColor: 'transparent',
            color: darkMode ? '#e2e8f0' : '#1e293b',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          Start Over
        </button>
        {session?.parsedPlan && (
          <button
            onClick={onRetryFromReview}
            style={{
              padding: '8px 20px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: darkMode ? '#2289b5' : '#1a7aaa',
              color: 'white',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Back to Review
          </button>
        )}
      </div>
    </div>
  );

  const renderContent = () => {
    switch (status) {
      case 'configuring':
        // Show requirements checklist when documents are missing
        if (availableDocs.length === 0) {
          return (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <PanelRequirements level="sources" />
            </div>
          );
        }
        return renderConfigView();
      case 'planning':
        return renderLoadingView('Analyzing documents and building card plan...');
      case 'revising':
        return renderLoadingView('Revising plan based on your feedback...');
      case 'finalizing':
        return renderLoadingView('Finalizing plan with your decisions...');
      case 'producing':
        return renderLoadingView('Writing card content...');
      case 'conflict':
        return renderConflictView();
      case 'reviewing':
        return renderReviewView();
      case 'complete':
        return renderCompleteView();
      case 'error':
        return renderErrorView();
      default:
        if (availableDocs.length === 0) {
          return (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <PanelRequirements level="sources" />
            </div>
          );
        }
        return renderConfigView();
    }
  };

  return (
    <>
      {/* Portal overlay */}
      {shouldRender &&
        createPortal(
          <>
          <div
            data-panel-overlay
            className="fixed z-[104] flex flex-col bg-white dark:bg-zinc-900 border-4 shadow-[5px_0_6px_rgba(0,0,0,0.35)] overflow-hidden"
            style={{
              borderColor,
              ...overlayStyle,
            }}
          >
            {/* View content */}
            {renderContent()}
          </div>
          </>,
          document.body,
        )}

      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes autodeck-pulse {
          0%, 100% { transform: scale(0.8); opacity: 0.5; }
          50% { transform: scale(1.2); opacity: 1; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
};

export default React.memo(AutoDeckPanel);
