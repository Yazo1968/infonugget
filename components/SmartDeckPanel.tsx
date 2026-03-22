import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { marked } from 'marked';
import { UploadedFile, AutoDeckBriefing, AutoDeckLod, SmartDeckSession } from '../types';
import { useThemeContext } from '../context/ThemeContext';
import PanelRequirements from './PanelRequirements';
import {
  LOD_LEVELS,
  estimateCardCount,
  countWords,
  LodConfig,
} from '../utils/deckShared/constants';
import { usePanelOverlay } from '../hooks/usePanelOverlay';
import { SmartDeckGenerateConfig } from '../hooks/useSmartDeck';
import { sanitizeHtml } from '../utils/sanitize';

// ── Props ──

interface SmartDeckPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  documents: UploadedFile[];
  tabBarRef?: React.RefObject<HTMLElement | null>;
  briefing?: AutoDeckBriefing;
  onOpenBriefTab?: () => void;
  onOpenSourcesTab?: () => void;
  domain?: string;
  domainReviewNeeded?: boolean;
  briefReviewNeeded?: boolean;
  // Generation props
  session?: SmartDeckSession | null;
  onGenerate?: (config: SmartDeckGenerateConfig) => Promise<void>;
  onAcceptCards?: () => void;
  onAbort?: () => void;
  onReset?: () => void;
}

// ── Component ──

const SmartDeckPanel: React.FC<SmartDeckPanelProps> = ({
  isOpen,
  onToggle,
  documents,
  tabBarRef,
  briefing: propBriefing,
  onOpenBriefTab,
  onOpenSourcesTab,
  domain,
  domainReviewNeeded,
  briefReviewNeeded,
  session,
  onGenerate,
  onAcceptCards,
  onAbort,
  onReset,
}) => {
  const { darkMode } = useThemeContext();
  const { shouldRender, overlayStyle } = usePanelOverlay({
    isOpen,
    defaultWidth: Math.min(window.innerWidth * 0.5, 700),
    minWidth: 300,
    anchorRef: tabBarRef,
  });

  // ── Configuration state (local UI only) ──
  const [selectedLod, setSelectedLod] = useState<AutoDeckLod | null>(null);
  const [cardMin, setCardMin] = useState<string>('');
  const [cardMax, setCardMax] = useState<string>('');
  const [includeCover, setIncludeCover] = useState(false);
  const [includeClosing, setIncludeClosing] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());

  // Available documents (have content)
  const availableDocs = documents.filter((d) => d.content || d.fileId || d.pdfBase64);

  // ── Derived values ──
  const selectedDocs = availableDocs.filter((d) => d.enabled !== false);
  const totalWordCount = selectedDocs.reduce((sum, d) => sum + (d.content ? countWords(d.content) : 0), 0);
  const estimate = selectedLod ? estimateCardCount(totalWordCount, selectedLod) : null;

  const hasBriefing = propBriefing?.objective?.trim() || propBriefing?.audience?.trim() || propBriefing?.type?.trim();
  const hasDomain = !!domain?.trim();
  const preFlightOk = hasDomain && !domainReviewNeeded && !briefReviewNeeded;
  const canGenerate =
    propBriefing?.objective?.trim() &&
    propBriefing?.audience?.trim() &&
    propBriefing?.type?.trim() &&
    selectedLod &&
    selectedDocs.length > 0 &&
    preFlightOk;

  // ── Colors ──
  const stripBg = 'rgb(100,160,230)';
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

  // ── Handle generate click ──
  const handleGenerate = () => {
    if (!canGenerate || !onGenerate || !propBriefing || !selectedLod) return;
    const pMin = cardMin ? parseInt(cardMin, 10) : undefined;
    const pMax = cardMax ? parseInt(cardMax, 10) : undefined;
    onGenerate({
      briefing: {
        ...propBriefing,
        minCards: pMin && pMin >= 5 && pMin <= 50 ? pMin : undefined,
        maxCards: pMax && pMax >= 5 && pMax <= 50 ? pMax : undefined,
        includeCover,
        includeClosing,
      },
      lod: selectedLod,
      includeCover,
      includeClosing,
    });
  };

  // ── Toggle card expand in review ──
  const toggleCardExpand = (num: number) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });
  };

  // ── Status-based rendering ──
  const status = session?.status;

  // ── Generating view ──
  const renderGeneratingView = () => (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center', justifyContent: 'center', padding: '40px 20px', gap: '20px' }}>
      {/* Spinner */}
      <div style={{ width: '40px', height: '40px', border: `3px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, borderTopColor: darkMode ? '#4db8e0' : '#2289b5', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ fontSize: '14px', fontWeight: 600, color: inputColor }}>Generating presentation...</div>
      <div style={{ fontSize: '12px', color: hintColor }}>This may take 30-60 seconds for large decks.</div>
      {onAbort && (
        <button
          onClick={onAbort}
          style={{
            padding: '8px 20px',
            borderRadius: '6px',
            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}`,
            backgroundColor: 'transparent',
            color: darkMode ? '#f87171' : '#dc2626',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Abort
        </button>
      )}
    </div>
  );

  // ── Review view ──
  const renderReviewView = () => {
    if (!session) return null;
    const cards = session.generatedCards;
    const totalWords = cards.reduce((sum, c) => sum + c.wordCount, 0);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        {/* Summary bar */}
        <div
          style={{
            padding: '12px 20px',
            backgroundColor: darkMode ? 'rgba(42,159,212,0.08)' : 'rgba(42,159,212,0.05)',
            borderBottom: `1px solid ${darkMode ? 'rgba(42,159,212,0.15)' : 'rgba(42,159,212,0.1)'}`,
            display: 'flex',
            gap: '16px',
            alignItems: 'center',
            fontSize: '12px',
            color: darkMode ? '#93afc5' : '#5a7a8f',
            flexShrink: 0,
          }}
        >
          <span><strong style={{ color: darkMode ? '#5abdd9' : '#1a7aaa' }}>{cards.length}</strong> cards</span>
          <span style={{ width: '1px', height: '14px', backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }} />
          <span><strong style={{ color: darkMode ? '#5abdd9' : '#1a7aaa' }}>{session.lod}</strong> detail</span>
          <span style={{ width: '1px', height: '14px', backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }} />
          <span>{totalWords.toLocaleString()} words total</span>
        </div>

        {/* Card list */}
        <div className="[&>*]:max-w-2xl [&>*]:mx-auto" style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          {cards.map((card) => {
            const isExpanded = expandedCards.has(card.number);
            const isCover = session.includeCover && card.number === 0;
            const isClosing = session.includeClosing && card.number === cards[cards.length - 1].number && card.number !== 0;

            return (
              <div
                key={card.number}
                style={{
                  marginBottom: '8px',
                  borderRadius: '8px',
                  border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'white',
                  overflow: 'hidden',
                }}
              >
                {/* Card header */}
                <button
                  onClick={() => toggleCardExpand(card.number)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 14px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  {/* Chevron */}
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={hintColor}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>

                  {/* Card number */}
                  <span style={{ fontSize: '11px', fontWeight: 600, color: hintColor, flexShrink: 0, minWidth: '20px' }}>
                    #{card.number}
                  </span>

                  {/* Title */}
                  <span style={{ fontSize: '13px', fontWeight: 600, color: inputColor, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {card.title}
                  </span>

                  {/* Badge */}
                  {(isCover || isClosing) && (
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        backgroundColor: darkMode ? 'rgba(42,159,212,0.15)' : 'rgba(42,159,212,0.1)',
                        color: darkMode ? '#4db8e0' : '#2289b5',
                        flexShrink: 0,
                      }}
                    >
                      {isCover ? 'COVER' : 'CLOSING'}
                    </span>
                  )}

                  {/* Word count */}
                  <span style={{ fontSize: '11px', color: hintColor, flexShrink: 0 }}>
                    {card.wordCount}w
                  </span>
                </button>

                {/* Expanded content — rendered markdown */}
                {isExpanded && (
                  <div
                    className="document-prose chat-prose"
                    style={{
                      padding: '0 14px 12px 36px',
                      borderTop: `1px solid ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
                      paddingTop: '10px',
                      maxHeight: '300px',
                      overflowY: 'auto',
                    }}
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(marked.parse(card.content, { async: false }) as string) }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Action buttons */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
            display: 'flex',
            gap: '10px',
            flexShrink: 0,
            maxWidth: '42rem',
            marginLeft: 'auto',
            marginRight: 'auto',
            width: '100%',
          }}
        >
          <button
            onClick={onAcceptCards}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: darkMode ? '#2289b5' : '#1a7aaa',
              color: 'white',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Accept All ({cards.length} cards)
          </button>
          <button
            onClick={() => { onReset?.(); setExpandedCards(new Set()); }}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}`,
              backgroundColor: 'transparent',
              color: inputColor,
              fontWeight: 500,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Regenerate
          </button>
          <button
            onClick={() => { onReset?.(); setExpandedCards(new Set()); }}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}`,
              backgroundColor: 'transparent',
              color: darkMode ? '#f87171' : '#dc2626',
              fontWeight: 500,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  // ── Accepting view ──
  const renderAcceptingView = () => (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center', justifyContent: 'center', padding: '40px 20px', gap: '16px' }}>
      <div style={{ width: '40px', height: '40px', border: `3px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, borderTopColor: darkMode ? '#4db8e0' : '#2289b5', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <div style={{ fontSize: '14px', fontWeight: 600, color: inputColor }}>Creating cards...</div>
    </div>
  );

  // ── Complete view ──
  const renderCompleteView = () => (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center', justifyContent: 'center', padding: '40px 20px', gap: '16px' }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={darkMode ? '#34d399' : '#059669'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
      <div style={{ fontSize: '16px', fontWeight: 600, color: inputColor }}>Presentation created</div>
      <div style={{ fontSize: '13px', color: hintColor }}>
        {session?.generatedCards.length} cards have been added to your nugget.
      </div>
      <button
        onClick={() => { onReset?.(); setExpandedCards(new Set()); }}
        style={{
          marginTop: '8px',
          padding: '10px 24px',
          borderRadius: '8px',
          border: 'none',
          backgroundColor: darkMode ? '#2289b5' : '#1a7aaa',
          color: 'white',
          fontWeight: 600,
          fontSize: '13px',
          cursor: 'pointer',
        }}
      >
        New Deck
      </button>
    </div>
  );

  // ── Error view ──
  const renderErrorView = () => (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center', justifyContent: 'center', padding: '40px 20px', gap: '16px', textAlign: 'center' }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={darkMode ? '#f87171' : '#dc2626'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
      <div style={{ fontSize: '14px', fontWeight: 600, color: inputColor }}>Generation failed</div>
      <div style={{ fontSize: '12px', color: hintColor, maxWidth: '400px' }}>{session?.error}</div>
      <button
        onClick={() => { onReset?.(); setExpandedCards(new Set()); }}
        style={{
          marginTop: '8px',
          padding: '10px 24px',
          borderRadius: '8px',
          border: 'none',
          backgroundColor: darkMode ? '#2289b5' : '#1a7aaa',
          color: 'white',
          fontWeight: 600,
          fontSize: '13px',
          cursor: 'pointer',
        }}
      >
        Try Again
      </button>
    </div>
  );

  // ── Config view ──
  const renderConfigView = () => (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
    <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
    <div className="max-w-2xl mx-auto">
      {/* ── Domain (read-only) ── */}
      <div style={{ marginBottom: '20px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
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
            Domain
          </div>
          {hasDomain && onOpenBriefTab && (
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
              Edit Domain
            </button>
          )}
        </div>
        {hasDomain ? (
          <div
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
              backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'white',
              fontSize: '13px',
              color: inputColor,
              lineHeight: 1.5,
            }}
          >
            {domain}
          </div>
        ) : (
          <div
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              border: `2px dashed ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
              fontSize: '12px',
              color: hintColor,
              textAlign: 'center',
            }}
          >
            No domain generated yet
            {onOpenBriefTab && (
              <span> — <button onClick={onOpenBriefTab} style={{ color: darkMode ? '#4db8e0' : '#2289b5', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: '12px' }}>Open Brief</button></span>
            )}
          </div>
        )}
      </div>

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

      {/* ── Active Documents (read-only list) ── */}
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
            Active Documents
            <span style={{ fontWeight: 400, textTransform: 'none', fontSize: '11px', opacity: 0.7, marginLeft: '6px' }}>
              ({selectedDocs.length})
            </span>
          </div>
          {onOpenSourcesTab && (
            <button
              onClick={onOpenSourcesTab}
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
              Edit Sources
            </button>
          )}
        </div>

        {selectedDocs.length > 0 ? (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
              backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'white',
            }}
          >
            {selectedDocs.map((doc, i) => (
              <div
                key={doc.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '5px 4px',
                  borderBottom: i < selectedDocs.length - 1
                    ? `1px solid ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`
                    : 'none',
                }}
              >
                <span style={{ fontSize: '12px', opacity: 0.5, flexShrink: 0 }}>
                  {doc.sourceType === 'native-pdf' ? '\u{1F4C4}' : '\u{1F4DD}'}
                </span>
                <span
                  style={{
                    fontSize: '12px',
                    color: inputColor,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {doc.name}
                </span>
                {doc.sourceType === 'native-pdf' && !doc.content && (
                  <span
                    style={{
                      fontSize: '10px',
                      color: darkMode ? '#fbbf24' : '#d97706',
                      flexShrink: 0,
                    }}
                  >
                    PDF
                  </span>
                )}
              </div>
            ))}
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
              No active documents
            </div>
            {onOpenSourcesTab && (
              <button
                onClick={onOpenSourcesTab}
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
                Add Sources
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
          {(Object.values(LOD_LEVELS) as LodConfig[]).map((lod) => {
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

      {/* Content metrics — input word count + estimated output range */}
      {selectedLod && totalWordCount > 0 && (() => {
        const lodCfg = LOD_LEVELS[selectedLod];
        const pMin = cardMin ? parseInt(cardMin, 10) : NaN;
        const pMax = cardMax ? parseInt(cardMax, 10) : NaN;
        const effMin = !isNaN(pMin) ? Math.max(5, Math.min(50, pMin)) : estimate?.min ?? 0;
        const effMax = !isNaN(pMax) ? Math.max(5, Math.min(50, pMax)) : estimate?.max ?? 0;
        const outMin = effMin * lodCfg.wordCountMin;
        const outMax = effMax * lodCfg.wordCountMax;
        const hasPdfNoContent = selectedDocs.some((d) => d.sourceType === 'native-pdf' && !d.content);
        return (
          <div
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              backgroundColor: darkMode ? 'rgba(42,159,212,0.08)' : 'rgba(42,159,212,0.05)',
              border: `1px solid ${darkMode ? 'rgba(42,159,212,0.15)' : 'rgba(42,159,212,0.1)'}`,
              marginBottom: '20px',
              fontSize: '12px',
              color: darkMode ? '#93afc5' : '#5a7a8f',
            }}
          >
            <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
              <span style={{ fontWeight: 600, minWidth: '48px', color: darkMode ? '#5abdd9' : '#1a7aaa' }}>Input</span>
              <span>
                {totalWordCount.toLocaleString()} words &middot; {selectedDocs.length} document
                {selectedDocs.length !== 1 ? 's' : ''}
              </span>
            </div>
            {effMin > 0 && effMax > 0 && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', marginTop: '5px' }}>
                <span style={{ fontWeight: 600, minWidth: '48px', color: darkMode ? '#5abdd9' : '#1a7aaa' }}>Output</span>
                <span>
                  ~{outMin.toLocaleString()}&ndash;{outMax.toLocaleString()} words &middot; {effMin}&ndash;{effMax} cards
                  &times; {lodCfg.label} {lodCfg.wordCountMin}&ndash;{lodCfg.wordCountMax}/card
                </span>
              </div>
            )}
            {hasPdfNoContent && (
              <div style={{ fontSize: '11px', marginTop: '6px', opacity: 0.65 }}>
                Word counts exclude PDF documents without extracted text
              </div>
            )}
          </div>
        );
      })()}

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
        disabled={!canGenerate}
        onClick={handleGenerate}
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
        Generate Presentation
      </button>
      {!canGenerate && selectedDocs.length > 0 && (
        <div style={{ fontSize: '11px', textAlign: 'center', marginTop: '6px' }}>
          {!hasDomain && (
            <div style={{ color: darkMode ? '#f59e0b' : '#d97706', marginBottom: '2px' }}>
              Generate a domain before planning
              {onOpenBriefTab && (
                <> — <button onClick={onOpenBriefTab} style={{ color: darkMode ? '#4db8e0' : '#2289b5', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: '11px' }}>Open Brief</button></>
              )}
            </div>
          )}
          {hasDomain && domainReviewNeeded && (
            <div style={{ color: darkMode ? '#f59e0b' : '#d97706', marginBottom: '2px' }}>
              Review domain changes before planning
              {onOpenBriefTab && (
                <> — <button onClick={onOpenBriefTab} style={{ color: darkMode ? '#4db8e0' : '#2289b5', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: '11px' }}>Open Brief</button></>
              )}
            </div>
          )}
          {briefReviewNeeded && (
            <div style={{ color: darkMode ? '#f59e0b' : '#d97706', marginBottom: '2px' }}>
              Review briefing changes before planning
              {onOpenBriefTab && (
                <> — <button onClick={onOpenBriefTab} style={{ color: darkMode ? '#4db8e0' : '#2289b5', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: '11px' }}>Open Brief</button></>
              )}
            </div>
          )}
          {!hasBriefing && (
            <div style={{ color: hintColor }}>
              Set a briefing to enable generation
            </div>
          )}
        </div>
      )}
    </div>
    </div>
    </div>
  );

  // ── Determine which view to render ──
  const renderContent = () => {
    if (availableDocs.length === 0) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
          <PanelRequirements level="sources" />
        </div>
      );
    }

    switch (status) {
      case 'generating':
        return renderGeneratingView();
      case 'reviewing':
        return renderReviewView();
      case 'accepting':
        return renderAcceptingView();
      case 'complete':
        return renderCompleteView();
      case 'error':
        return renderErrorView();
      default:
        return renderConfigView();
    }
  };

  if (!shouldRender) return null;

  return createPortal(
    <div
      data-panel-overlay
      className="fixed z-[104] flex flex-col bg-white dark:bg-zinc-900 border shadow-[5px_0_6px_rgba(0,0,0,0.35)] overflow-hidden"
      style={{
        borderColor,
        ...overlayStyle,
      }}
    >
      {/* Section header */}
      <div className="shrink-0 h-[36px] flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900">
        <div className="h-full w-[36px] shrink-0 flex items-center justify-center" style={{ backgroundColor: darkMode ? 'rgb(28,48,74)' : 'rgb(200,220,245)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500 dark:text-zinc-400">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8" />
            <path d="M12 17v4" />
          </svg>
        </div>
        <span className="text-[13px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">SmartDeck</span>
      </div>
      {renderContent()}
    </div>,
    document.body,
  );
};

export default React.memo(SmartDeckPanel);
