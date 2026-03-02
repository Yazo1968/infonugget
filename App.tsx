import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import ZoomOverlay from './components/ZoomOverlay';
import AssetsPanel from './components/AssetsPanel';
import {
  StylingOptions,
  ReferenceImage,
  Nugget,
  DetailLevel,
  ChatMessage,
  isCardFolder,
} from './types';
import {
  DEFAULT_STYLING,
  registerCustomStyles,
  uploadToFilesAPI,
  deleteFromFilesAPI,
} from './utils/ai';
import { LandingPage } from './components/LandingPage';
import SourcesPanel from './components/SourcesPanel';
import ChatPanel from './components/ChatPanel';
import AutoDeckPanel from './components/AutoDeckPanel';
import CardsPanel, { PanelEditorHandle } from './components/CardsPanel';
import ErrorBoundary from './components/ErrorBoundary';
import PanelTabBar from './components/PanelTabBar';
import QualityPanel from './components/QualityPanel';
import NuggetTabBar from './components/NuggetTabBar';
import HeaderBar from './components/HeaderBar';

import { UnsavedChangesDialog } from './components/Dialogs';
import { useAppContext } from './context/AppContext';
import { useNuggetContext } from './context/NuggetContext';
import { useProjectContext } from './context/ProjectContext';
import { useSelectionContext } from './context/SelectionContext';
import { useStyleContext } from './context/StyleContext';
import { useThemeContext } from './context/ThemeContext';
import { useCardGeneration } from './hooks/useCardGeneration';
import { useCardOperations } from './hooks/useCardOperations';
import { useImageOperations } from './hooks/useImageOperations';
import { useProjectOperations, AskPdfProcessorFn } from './hooks/useProjectOperations';
import { useDocumentOperations } from './hooks/useDocumentOperations';
import { useInsightsLab } from './hooks/useInsightsLab';
import { useDocumentQualityCheck } from './hooks/useDocumentQualityCheck';
import { useAutoDeck } from './hooks/useAutoDeck';
import { useTokenUsage, TokenUsageTotals } from './hooks/useTokenUsage';
import { useTabManagement } from './hooks/useTabManagement';
import { useStylingSync } from './hooks/useStylingSync';
import { storage } from './components/StorageProvider';
import {
  base64ToBlob,
} from './utils/fileProcessing';
import { flattenCards } from './utils/cardUtils';
import { useToast } from './components/ToastNotification';
import PdfUploadChoiceDialog from './components/PdfUploadChoiceDialog';
import PdfProcessorModal from './components/PdfProcessorModal';
import PanelRequirements from './components/PanelRequirements';
import StyleStudioModal from './components/StyleStudioModal';
import { SubjectEditModal } from './components/SubjectEditModal';
import FolderPickerDialog from './components/FolderPickerDialog';

const App: React.FC = () => {
  // ── Focused context hooks ──
  const {
    nuggets, selectedNuggetId, selectedNugget,
    selectedDocumentId, setSelectedDocumentId,
    deleteNugget, updateNugget,
    updateNuggetDocument, removeNuggetDocument, renameNuggetDocument, toggleNuggetDocument,
  } = useNuggetContext();
  const { projects, deleteProject, updateProject } = useProjectContext();
  const { activeCard, selectEntity } = useSelectionContext();
  const { customStyles, addCustomStyle: _addCustomStyle, updateCustomStyle: _updateCustomStyle, deleteCustomStyle: _deleteCustomStyle, replaceCustomStyles } = useStyleContext();
  const { darkMode, toggleDarkMode } = useThemeContext();
  const { initialTokenUsageTotals, openProjectId, setOpenProjectId } = useAppContext();

  // ── Token / cost tracking (persisted to IndexedDB) ──
  const {
    totals: usageTotals,
    recordUsage,
    resetUsage,
  } = useTokenUsage(storage, initialTokenUsageTotals as unknown as TokenUsageTotals | undefined);

  const { addToast } = useToast();

  // ── Reference image style anchoring (shared between useCardGeneration and useImageOperations) ──
  const [referenceImage, setReferenceImage] = useState<ReferenceImage | null>(null);
  const [useReferenceImage, setUseReferenceImage] = useState(false);

  // Ref bridge: useStylingSync (called after useCardGeneration) owns menuDraftOptions state.
  // useCardGeneration receives the latest value via this ref, updated each render.
  const menuDraftOptionsRef = useRef<StylingOptions>(
    selectedNugget?.stylingOptions || DEFAULT_STYLING,
  );

  const {
    genStatus,
    activeLogicTab,
    setActiveLogicTab,
    manifestCards,
    setManifestCards,
    currentSynthesisContent: _currentSynthesisContent,
    contentDirty: _contentDirty,
    selectedCount: _selectedCount,
    generateCard,
    handleGenerateAll: _handleGenerateAll,
    executeBatchCardGeneration,
    handleImageModified: _handleImageModified,
  } = useCardGeneration(menuDraftOptionsRef.current, referenceImage, useReferenceImage, recordUsage);

  // ── Styling sync (card auto-select, logic tab ↔ detail level, nugget ↔ toolbar) ──
  const {
    menuDraftOptions,
    setMenuDraftOptions,
    committedSettings,
    nuggetCards,
  } = useStylingSync({
    activeLogicTab,
    setActiveLogicTab,
  });
  menuDraftOptionsRef.current = menuDraftOptions;

  // ── Insights workflow hooks ──
  const {
    messages: insightsMessages,
    isLoading: insightsLabLoading,
    sendMessage: sendInsightsMessage,
    stopResponse: stopInsightsResponse,
    clearMessages: clearInsightsMessages,
    pendingDocChanges,
    hasConversation: insightsHasConversation,
    handleDocChangeContinue,
    handleDocChangeStartFresh,
  } = useInsightsLab(recordUsage);

  // ── Document quality check ──
  const {
    qualityReport,
    effectiveStatus: qualityStatus,
    isChecking: qualityIsChecking,
    checkError: qualityCheckError,
    runQualityCheck,
    dismissReport: dismissQualityReport,
  } = useDocumentQualityCheck(selectedNugget, updateNugget, recordUsage);

  // ── Card operations (selection, manipulation, creation, cross-nugget, placeholders) ──
  const {
    toggleInsightsCardSelection,
    toggleSelectAllInsightsCards,
    selectInsightsCardExclusive,
    selectInsightsCardRange,
    deselectAllInsightsCards,
    insightsSelectedCount,
    reorderInsightsCards,
    reorderCardItem,
    deleteInsightsCard,
    deleteSelectedInsightsCards,
    renameInsightsCard,
    handleSaveCardContent,
    handleCreateCustomCard,
    handleSaveAsCard,
    handleCopyMoveCard,
    handleCopyMoveFolder,
    createPlaceholderCards,
    createPlaceholderCardsInFolder,
    fillPlaceholderCard,
    removePlaceholderCard,
    createEmptyFolder,
    createCustomCardInFolder,
    renameFolder,
    deleteFolder,
    duplicateFolder,
    toggleFolderCollapsed,
    toggleFolderSelection,
  } = useCardOperations();

  // ── Auto-Deck workflow hook ──
  const {
    session: autoDeckSession,
    startPlanning: autoDeckStartPlanning,
    revisePlan: autoDeckRevisePlan,
    approvePlan: autoDeckApprovePlan,
    abort: autoDeckAbort,
    reset: autoDeckReset,
    retryFromReview: autoDeckRetryFromReview,
    toggleCardIncluded: autoDeckToggleCardIncluded,
    setQuestionAnswer: autoDeckSetQuestionAnswer,
    setAllRecommended: autoDeckSetAllRecommended,
    setGeneralComment: autoDeckSetGeneralComment,
  } = useAutoDeck(recordUsage, { createPlaceholderCards, createPlaceholderCardsInFolder, fillPlaceholderCard, removePlaceholderCard });

  // ── Ref bridge: askPdfProcessor (from useDocumentOperations) → useProjectOperations ──
  const askPdfProcessorRef = useRef<AskPdfProcessorFn | null>(null);

  // ── Project & nugget operations (creation, duplication, copy/move, subject) ──
  const {
    setNuggetCreationProjectId,
    subjectEditNuggetId,
    setSubjectEditNuggetId,
    isRegeneratingSubject,
    handleCreateNugget,
    handleCreateProject,
    handleCopyNuggetToProject,
    handleSaveSubject,
    handleRegenerateSubject,
    setSubjectGenPending,
  } = useProjectOperations({ recordUsage, askPdfProcessorRef });

  // ── Document operations (save, TOC, copy/move, upload, content generation) ──
  const {
    pdfChoiceDialog,
    pdfChoiceResolverRef,
    setPdfChoiceDialog,
    pdfProcessorDialog,
    pdfProcessorResolverRef,
    setPdfProcessorDialog,
    generatingSourceIds,
    tocLockActive,
    setTocLockActive,
    handleGenerateCardContent,
    handleSaveDocument,
    handleSaveToc,
    handleUploadDocuments,
    askPdfProcessor,
  } = useDocumentOperations({
    recordUsage,
    onSubjectGenPending: setSubjectGenPending,
    createPlaceholderCards,
    fillPlaceholderCard,
    removePlaceholderCard,
  });

  // Wire the ref bridge (synchronous assignment — safe for async consumers)
  askPdfProcessorRef.current = askPdfProcessor;

  // ── Chat placeholder wrappers ──
  const handleChatCreatePlaceholder = useCallback(
    (promptText: string, detailLevel: DetailLevel): string | null => {
      const placeholderTitle = promptText.length > 50 ? promptText.substring(0, 50) + '...' : promptText;
      const placeholders = createPlaceholderCards([placeholderTitle], detailLevel);
      return placeholders[0]?.id ?? null;
    },
    [createPlaceholderCards],
  );

  const handleChatFillPlaceholder = useCallback(
    (cardId: string, detailLevel: DetailLevel, content: string, newTitle?: string) => {
      fillPlaceholderCard(cardId, detailLevel, content, newTitle);
    },
    [fillPlaceholderCard],
  );

  // ── Batch folder creation for Sources panel batch generation ──
  const handleCreateBatchFolder = useCallback(
    (titles: string[], detailLevel: DetailLevel | DetailLevel[], sourceDocName: string): string[] | null => {
      const folderResult = createPlaceholderCardsInFolder(titles, detailLevel, {
        sourceDocuments: [sourceDocName],
      });
      if (!folderResult) return null;
      return folderResult.cards.map((c) => c.id);
    },
    [createPlaceholderCardsInFolder],
  );

  // ── Folder picker for single-card generation (no loose cards policy) ──
  type PendingFolderSelection =
    | { type: 'sourceGeneration'; headingId: string; detailLevel: DetailLevel; cardTitle: string; sourceDocName: string }
    | { type: 'chatSaveAsCard'; message: ChatMessage; editedContent: string };

  const [pendingFolderSelection, setPendingFolderSelection] = useState<PendingFolderSelection | null>(null);

  const handleGenerateCardContentWrapped = useCallback(
    (headingId: string, detailLevel: DetailLevel, cardTitle: string, sourceDocName?: string, existingCardId?: string) => {
      if (existingCardId) {
        // Batch path — folder already created, proceed directly
        handleGenerateCardContent(headingId, detailLevel, cardTitle, sourceDocName, existingCardId);
      } else {
        // Single card — need folder selection
        setPendingFolderSelection({
          type: 'sourceGeneration',
          headingId,
          detailLevel,
          cardTitle,
          sourceDocName: sourceDocName || '',
        });
      }
    },
    [handleGenerateCardContent],
  );

  const handleSaveAsCardWrapped = useCallback(
    (message: ChatMessage, editedContent: string) => {
      setPendingFolderSelection({
        type: 'chatSaveAsCard',
        message,
        editedContent,
      });
    },
    [],
  );

  const handleFolderSelectedForPending = useCallback(
    (folderId: string) => {
      const pending = pendingFolderSelection;
      if (!pending) return;

      if (pending.type === 'sourceGeneration') {
        const cardSourceDocs = pending.sourceDocName ? [pending.sourceDocName] : [];
        const placeholders = createPlaceholderCards(
          [pending.cardTitle], pending.detailLevel,
          { sourceDocuments: cardSourceDocs, targetFolderId: folderId },
        );
        const placeholderId = placeholders[0]?.id;
        if (placeholderId) {
          handleGenerateCardContent(
            pending.headingId, pending.detailLevel, pending.cardTitle,
            pending.sourceDocName, placeholderId,
          );
        }
      } else if (pending.type === 'chatSaveAsCard') {
        handleSaveAsCard(pending.message, pending.editedContent, folderId);
      }

      setPendingFolderSelection(null);
    },
    [pendingFolderSelection, createPlaceholderCards, handleGenerateCardContent, handleSaveAsCard],
  );

  const handleCreateFolderForPending = useCallback(
    (folderName: string) => {
      const folderId = createEmptyFolder(folderName);
      if (folderId) handleFolderSelectedForPending(folderId);
    },
    [createEmptyFolder, handleFolderSelectedForPending],
  );

  // ── Style Studio modal state ──
  const [showStyleStudio, setShowStyleStudio] = useState(false);

  // ── Register custom styles into runtime maps on mount and after changes ──
  useEffect(() => {
    registerCustomStyles(customStyles);
  }, [customStyles]);

  // ── Panel accordion state (only one panel can be open at a time) ──
  // null = all collapsed
  const [expandedPanel, setExpandedPanel] = useState<'sources' | 'chat' | 'auto-deck' | 'cards' | 'quality' | null>(null);
  // selectedDocumentId is now in AppContext (with guard effect for auto-selection)

  // ── Unsaved-changes gating for panel/nugget switching ──
  const cardsPanelRef = useRef<PanelEditorHandle>(null);
  const sourcesPanelRef = useRef<PanelEditorHandle>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const panelSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [appPendingAction, setAppPendingAction] = useState<(() => void) | null>(null);
  const [appPendingDirtyPanel, setAppPendingDirtyPanel] = useState<'cards' | 'sources' | null>(null);

  const appGatedAction = useCallback((action: () => void) => {
    if (cardsPanelRef.current?.isDirty) {
      setAppPendingDirtyPanel('cards');
      setAppPendingAction(() => action);
      return;
    }
    if (sourcesPanelRef.current?.isDirty) {
      setAppPendingDirtyPanel('sources');
      setAppPendingAction(() => action);
      return;
    }
    action();
  }, []);

  // ── Breadcrumb navigation handlers ──
  const handleBreadcrumbDocSelect = useCallback(
    (docId: string) => {
      selectEntity({ documentId: docId });
      appGatedAction(() => setExpandedPanel('sources'));
    },
    [appGatedAction, selectEntity, setExpandedPanel],
  );

  const handleAppDialogSave = useCallback(() => {
    const panel = appPendingDirtyPanel;
    if (panel === 'cards') cardsPanelRef.current?.save();
    else if (panel === 'sources') sourcesPanelRef.current?.save();
    // After saving, re-check: is the OTHER panel dirty?
    const otherRef = panel === 'cards' ? sourcesPanelRef : cardsPanelRef;
    const otherLabel = panel === 'cards' ? 'sources' : 'cards';
    if (otherRef.current?.isDirty) {
      setAppPendingDirtyPanel(otherLabel as 'cards' | 'sources');
      return;
    }
    const action = appPendingAction;
    setAppPendingAction(null);
    setAppPendingDirtyPanel(null);
    action?.();
  }, [appPendingAction, appPendingDirtyPanel]);

  const handleAppDialogDiscard = useCallback(() => {
    const panel = appPendingDirtyPanel;
    if (panel === 'cards') cardsPanelRef.current?.discard();
    else if (panel === 'sources') sourcesPanelRef.current?.discard();
    const otherRef = panel === 'cards' ? sourcesPanelRef : cardsPanelRef;
    const otherLabel = panel === 'cards' ? 'sources' : 'cards';
    if (otherRef.current?.isDirty) {
      setAppPendingDirtyPanel(otherLabel as 'cards' | 'sources');
      return;
    }
    const action = appPendingAction;
    setAppPendingAction(null);
    setAppPendingDirtyPanel(null);
    action?.();
  }, [appPendingAction, appPendingDirtyPanel]);

  const handleAppDialogCancel = useCallback(() => {
    setAppPendingAction(null);
    setAppPendingDirtyPanel(null);
  }, []);

  // ── Nugget's owned documents (per-nugget, no shared library) ──
  const nuggetDocs = useMemo(() => {
    if (!selectedNugget) return [];
    return selectedNugget.documents;
  }, [selectedNugget]);

  // ── Landing ↔ Workspace navigation ──
  const handleOpenProject = useCallback((projectId: string) => {
    setOpenProjectId(projectId);
    selectEntity({ projectId });
  }, [setOpenProjectId, selectEntity]);

  const handleReturnToLanding = useCallback(() => {
    setOpenProjectId(null);
  }, [setOpenProjectId]);

  // ── Nugget tab bar: ordered nuggets for the open project ──
  const {
    openProject,
    allProjectNuggets,
    projectNuggetsForTabs,
    openTabIds,
    handleOpenTab,
    handleCloseTab,
    handleTabCreateNugget,
    handleTabRenameNugget,
    handleTabDuplicateNugget,
  } = useTabManagement({
    handleCreateNugget,
    handleCopyNuggetToProject,
    handleUploadDocuments,
  });
  const [emptyDragging, setEmptyDragging] = useState(false);

  // ── Image operations (zoom, reference image, card images, downloads, generation wrappers) ──
  const {
    zoomState,
    setZoomState,
    openZoom,
    closeZoom,
    handleStampReference,
    handleReferenceImageModified,
    handleDeleteReference,
    handleInsightsImageModified,
    handleDeleteCardImage,
    handleDeleteCardVersions,
    handleDeleteAllCardImages,
    handleDownloadImage,
    handleDownloadSelectedImages,
    wrappedGenerateCard,
    wrappedExecuteBatch,
    mismatchDialog,
    setMismatchDialog,
  } = useImageOperations({
    activeCard,
    activeLogicTab,
    committedSettings,
    menuDraftOptions,
    referenceImage,
    setReferenceImage,
    useReferenceImage,
    setUseReferenceImage,
    generateCard,
    executeBatchCardGeneration,
  });

  // ── Global keyboard shortcuts ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setZoomState({ imageUrl: null, cardId: null, cardText: null });
        setManifestCards(null);
        setExpandedPanel(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [setZoomState, setManifestCards, setExpandedPanel]);

  // ── Click-outside to close overlay panels ──
  useEffect(() => {
    if (!expandedPanel) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-panel-overlay]')) return;
      if (target.closest('[data-panel-strip]')) return;
      if (target.closest('[data-breadcrumb-dropdown]')) return;
      // Don't close when clicking portal-rendered menus, modals, dialogs
      // Walk up through nested .fixed elements (e.g. backdrop → menu) to find one portaled to body
      let fixed: Element | null = target.closest('.fixed');
      while (fixed) {
        if (fixed.parentElement === document.body) return;
        fixed = fixed.parentElement?.closest('.fixed') ?? null;
      }
      appGatedAction(() => setExpandedPanel(null));
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [expandedPanel, appGatedAction]);

  // ── Shared nugget list props (used by both SourcesPanel and CardsPanel) ──
  const otherNuggetsList = useMemo(
    () => nuggets.filter((n) => n.id !== selectedNugget?.id).map((n) => ({ id: n.id, name: n.name })),
    [nuggets, selectedNugget?.id],
  );

  const projectNuggetsList = useMemo(
    () =>
      projects.map((p) => ({
        projectId: p.id,
        projectName: p.name,
        nuggets: p.nuggetIds
          .filter((nid) => nid !== selectedNugget?.id)
          .map((nid) => nuggets.find((n) => n.id === nid))
          .filter((n): n is Nugget => !!n)
          .map((n) => ({ id: n.id, name: n.name })),
      })),
    [projects, nuggets, selectedNugget?.id],
  );

  return (
    <div className="min-h-screen bg-white">
      {!openProjectId ? (
        <LandingPage
          projects={projects}
          nuggets={nuggets}
          onOpenProject={handleOpenProject}
          onCreateProject={(name: string) => {
            const projectId = handleCreateProject(name, '');
            handleOpenProject(projectId);
          }}
          onRenameProject={(id, newName) => {
            updateProject(id, (p) => ({ ...p, name: newName, lastModifiedAt: Date.now() }));
          }}
          onDeleteProject={(id) => {
            deleteProject(id);
          }}
          darkMode={darkMode}
          toggleDarkMode={toggleDarkMode}
        />
      ) : (
        <>
          {/* PDF Upload Choice dialog (convert to MD or keep as PDF) */}
          {pdfChoiceDialog && (
            <PdfUploadChoiceDialog
              fileName={pdfChoiceDialog.fileName}
              onConvertToMarkdown={() => {
                pdfChoiceResolverRef.current?.('markdown');
                pdfChoiceResolverRef.current = null;
                setPdfChoiceDialog(null);
              }}
              onKeepAsPdf={() => {
                pdfChoiceResolverRef.current?.('keep-pdf');
                pdfChoiceResolverRef.current = null;
                setPdfChoiceDialog(null);
              }}
              onCancel={() => {
                pdfChoiceResolverRef.current?.('cancel');
                pdfChoiceResolverRef.current = null;
                setPdfChoiceDialog(null);
              }}
            />
          )}

          {/* PDF Processor modal (bookmark editing after choosing "keep as PDF") */}
          {pdfProcessorDialog && (
            <PdfProcessorModal
              pdfBase64Input={pdfProcessorDialog.pdfBase64}
              fileName={pdfProcessorDialog.fileName}
              onAccept={(result) => {
                pdfProcessorResolverRef.current?.(result);
                pdfProcessorResolverRef.current = null;
                setPdfProcessorDialog(null);
              }}
              onCancel={() => {
                pdfProcessorResolverRef.current?.('cancel');
                pdfProcessorResolverRef.current = null;
                setPdfProcessorDialog(null);
              }}
              onDiscard={() => {
                pdfProcessorResolverRef.current?.('discard');
                pdfProcessorResolverRef.current = null;
                setPdfProcessorDialog(null);
              }}
              onConvertToMarkdown={() => {
                pdfProcessorResolverRef.current?.('convert-to-markdown');
                pdfProcessorResolverRef.current = null;
                setPdfProcessorDialog(null);
              }}
            />
          )}

          {/* Style Studio modal */}
          {showStyleStudio && (
            <StyleStudioModal
              onClose={() => setShowStyleStudio(false)}
            />
          )}

          {/* Subject edit modal */}
          {subjectEditNuggetId &&
            (() => {
              const nugget = nuggets.find((n) => n.id === subjectEditNuggetId);
              if (!nugget) return null;
              return (
                <SubjectEditModal
                  nuggetId={nugget.id}
                  nuggetName={nugget.name}
                  currentSubject={nugget.subject || ''}
                  isRegenerating={isRegeneratingSubject}
                  onSave={handleSaveSubject}
                  onRegenerate={handleRegenerateSubject}
                  onClose={() => setSubjectEditNuggetId(null)}
                />
              );
            })()}

          {/* App-level unsaved changes dialog (for nugget/panel switching) */}
          {appPendingAction && appPendingDirtyPanel && (
            <UnsavedChangesDialog
              title={`Unsaved changes in ${appPendingDirtyPanel === 'cards' ? 'Cards' : 'Sources'} editor`}
              description="You have unsaved edits. Save or discard them to continue."
              onSave={handleAppDialogSave}
              onDiscard={handleAppDialogDiscard}
              onCancel={handleAppDialogCancel}
            />
          )}

          {/* Zoom Overlay */}
          {zoomState.imageUrl && <ZoomOverlay zoomState={zoomState} onClose={closeZoom} />}

          <div
            className="flex flex-col h-screen overflow-hidden"
            style={{
              background: darkMode ? '#18181b' : 'linear-gradient(180deg, #f0f4f8 0%, #e8edf2 40%, #f5f7fa 100%)',
            }}
          >
            {/* Header bar — always visible */}
            <HeaderBar
              expandedPanel={expandedPanel}
              onReturnToLanding={handleReturnToLanding}
              onBreadcrumbDocSelect={handleBreadcrumbDocSelect}
              usageTotals={usageTotals}
              resetUsage={resetUsage}
            />


            {/* Nugget tab bar */}
            <NuggetTabBar
              projectNuggets={projectNuggetsForTabs}
              allProjectNuggets={allProjectNuggets}
              selectedNuggetId={selectedNuggetId}
              onSelectNugget={(id) =>
                appGatedAction(() => {
                  setReferenceImage(null);
                  setUseReferenceImage(false);
                  selectEntity({ nuggetId: id });
                })
              }
              onCreateNugget={handleTabCreateNugget}
              onRenameNugget={handleTabRenameNugget}
              onDeleteNugget={deleteNugget}
              onDuplicateNugget={handleTabDuplicateNugget}
              onCloseTab={handleCloseTab}
              onOpenTab={handleOpenTab}

              darkMode={darkMode}
            />

            {/* 5-panel row: Tab Bar | Sources | Chat | Auto-Deck | Cards | Assets */}
            <main className="flex flex-1 overflow-hidden gap-[4px] p-[4px]">
              {/* Vertical tab bar for expandable panels */}
              <PanelTabBar
                ref={tabBarRef}
                expandedPanel={expandedPanel}
                onTogglePanel={(panel) =>
                  appGatedAction(() => setExpandedPanel((prev) => {
                    if (prev === panel) return null;
                    if (prev !== null) {
                      // Collapse first, then expand after animation
                      if (panelSwitchTimerRef.current) clearTimeout(panelSwitchTimerRef.current);
                      panelSwitchTimerRef.current = setTimeout(() => {
                        panelSwitchTimerRef.current = null;
                        setExpandedPanel(panel);
                      }, 420);
                      return null;
                    }
                    return panel;
                  }))
                }
                hasSelectedNugget={!!selectedNugget}
                darkMode={darkMode}
                qualityStatus={qualityStatus}
              />

              {selectedNugget ? (
                <>
                  {/* Hard lock overlay — blocks all UI while TOC has unsaved changes (SourcesPanel at z-[107] stays above) */}
                  {tocLockActive && expandedPanel === 'sources' && (
                    <div className="fixed inset-0 z-[106] bg-black/20 cursor-not-allowed" />
                  )}

                  {/* Quality Check Panel */}
                  <ErrorBoundary name="Quality">
                    <QualityPanel
                      isOpen={expandedPanel === 'quality'}
                      tabBarRef={tabBarRef}
                      onToggle={() =>
                        appGatedAction(() => setExpandedPanel((prev) => (prev === 'quality' ? null : 'quality')))
                      }
                      qualityReport={qualityReport}
                      effectiveStatus={qualityStatus}
                      isChecking={qualityIsChecking}
                      checkError={qualityCheckError}
                      onRunCheck={runQualityCheck}
                      onDismiss={() => {
                        dismissQualityReport();
                        setExpandedPanel('sources');
                      }}
                      onFixDocuments={() => {
                        setExpandedPanel('sources');
                      }}
                      documents={nuggetDocs}
                    />
                  </ErrorBoundary>

                  {/* Panel 2: Sources */}
                  <ErrorBoundary name="Sources">
                    <SourcesPanel
                      ref={sourcesPanelRef}
                      isOpen={expandedPanel === 'sources'}
                      tabBarRef={tabBarRef}
                      onToggle={() =>
                        appGatedAction(() => setExpandedPanel((prev) => (prev === 'sources' ? null : 'sources')))
                      }
                      documents={nuggetDocs}
                      onSaveDocument={handleSaveDocument}
                      onGenerateCardContent={handleGenerateCardContentWrapped}
                      onCreateBatchFolder={handleCreateBatchFolder}
                      generatingSourceIds={generatingSourceIds}
                      onSaveToc={handleSaveToc}
                      onDirtyChange={setTocLockActive}
                      onUpload={handleUploadDocuments}
                    />
                  </ErrorBoundary>

                  {/* Panel 3: Chat */}
                  <ErrorBoundary name="Chat">
                    <ChatPanel
                      isOpen={expandedPanel === 'chat'}
                      tabBarRef={tabBarRef}
                      onToggle={() =>
                        appGatedAction(() => setExpandedPanel((prev) => (prev === 'chat' ? null : 'chat')))
                      }
                      messages={insightsMessages}
                      isLoading={insightsLabLoading}
                      onSendMessage={sendInsightsMessage}
                      onSaveAsCard={handleSaveAsCardWrapped}
                      onClearChat={() => {
                        clearInsightsMessages();
                      }}
                      onStop={stopInsightsResponse}
                      documents={nuggetDocs}
                      pendingDocChanges={pendingDocChanges}
                      hasConversation={insightsHasConversation}
                      onDocChangeContinue={handleDocChangeContinue}
                      onDocChangeStartFresh={handleDocChangeStartFresh}
                      onCreatePlaceholder={handleChatCreatePlaceholder}
                      onFillPlaceholderCard={handleChatFillPlaceholder}
                      onRemovePlaceholderCard={removePlaceholderCard}
                    />
                  </ErrorBoundary>

                  {/* Panel 4: Auto-Deck */}
                  <ErrorBoundary name="Auto-Deck">
                    <AutoDeckPanel
                      isOpen={expandedPanel === 'auto-deck'}
                      tabBarRef={tabBarRef}
                      onToggle={() =>
                        appGatedAction(() => setExpandedPanel((prev) => (prev === 'auto-deck' ? null : 'auto-deck')))
                      }
                      documents={nuggetDocs}
                      session={autoDeckSession}
                      onStartPlanning={autoDeckStartPlanning}
                      onRevisePlan={autoDeckRevisePlan}
                      onApprovePlan={autoDeckApprovePlan}
                      onAbort={autoDeckAbort}
                      onReset={autoDeckReset}
                      onToggleCardIncluded={autoDeckToggleCardIncluded}
                      onSetQuestionAnswer={autoDeckSetQuestionAnswer}
                      onSetAllRecommended={autoDeckSetAllRecommended}
                      onSetGeneralComment={autoDeckSetGeneralComment}
                      onRetryFromReview={autoDeckRetryFromReview}
                    />
                  </ErrorBoundary>

                  {/* Panel 5: Cards & Assets (portal overlay) */}
                  <ErrorBoundary name="Cards">
                    <CardsPanel
                      ref={cardsPanelRef}
                      isOpen={expandedPanel === 'cards'}
                      tabBarRef={tabBarRef}
                      onToggle={() =>
                        appGatedAction(() => setExpandedPanel((prev) => (prev === 'cards' ? null : 'cards')))
                      }
                      cards={nuggetCards}
                      hasSelectedNugget={!!selectedNugget}
                      onToggleSelection={toggleInsightsCardSelection}
                      onSelectExclusive={selectInsightsCardExclusive}
                      onSelectRange={selectInsightsCardRange}
                      onSelectAll={toggleSelectAllInsightsCards}
                      onDeselectAll={deselectAllInsightsCards}
                      onDeleteCard={deleteInsightsCard}
                      onDeleteSelectedCards={deleteSelectedInsightsCards}
                      onRenameCard={renameInsightsCard}
                      onCopyMoveCard={handleCopyMoveCard}
                      otherNuggets={otherNuggetsList}
                      projectNuggets={projectNuggetsList}
                      onSaveCardContent={handleSaveCardContent}
                      detailLevel={activeLogicTab}
                      onGenerateCardImage={wrappedGenerateCard}
                      onReorderCards={reorderInsightsCards}
                      onReorderCardItem={reorderCardItem}
                      onToggleFolderCollapsed={toggleFolderCollapsed}
                      onToggleFolderSelection={toggleFolderSelection}
                      onRenameFolder={renameFolder}
                      onDeleteFolder={deleteFolder}
                      onDuplicateFolder={duplicateFolder}
                      onCopyMoveFolder={handleCopyMoveFolder}
                      onCreateEmptyFolder={createEmptyFolder}
                      onCreateCustomCardInFolder={createCustomCardInFolder}
                      assetsSlot={
                        selectedNugget.documents.length > 0 ? (
                          <AssetsPanel
                            committedSettings={committedSettings}
                            menuDraftOptions={menuDraftOptions}
                            setMenuDraftOptions={setMenuDraftOptions}
                            activeLogicTab={activeLogicTab}
                            setActiveLogicTab={setActiveLogicTab}
                            genStatus={genStatus}
                            onGenerateCard={wrappedGenerateCard}
                            onGenerateAll={() => {
                              const cards = flattenCards(selectedNugget?.cards || []);
                              const selected = cards.filter((c) => c.selected);
                              if (selected.length === 0) {
                                alert('Please select cards first.');
                                return;
                              }
                              setManifestCards(selected);
                            }}
                            selectedCount={insightsSelectedCount}
                            onZoomImage={openZoom}
                            onImageModified={handleInsightsImageModified}
                            contentDirty={false}
                            currentContent={activeCard?.synthesisMap?.[activeCard?.detailLevel || activeLogicTab] || ''}
                            onDownloadImage={handleDownloadImage}
                            onDownloadSelectedImages={handleDownloadSelectedImages}
                            referenceImage={referenceImage}
                            onStampReference={handleStampReference}
                            useReferenceImage={useReferenceImage}
                            onToggleUseReference={() => setUseReferenceImage((prev) => !prev)}
                            onReferenceImageModified={handleReferenceImageModified}
                            onDeleteReference={handleDeleteReference}
                            mismatchDialog={mismatchDialog}
                            onDismissMismatch={() => setMismatchDialog(null)}
                            manifestCards={manifestCards}
                            onExecuteBatch={wrappedExecuteBatch}
                            onCloseManifest={() => setManifestCards(null)}
                            onDeleteCardImage={handleDeleteCardImage}
                            onDeleteCardVersions={handleDeleteCardVersions}
                            onDeleteAllCardImages={handleDeleteAllCardImages}
                            onUsage={recordUsage}
                            onOpenStyleStudio={() => setShowStyleStudio(true)}
                          />
                        ) : undefined
                      }
                    />
                  </ErrorBoundary>

                  {/* Main content area — branded empty state */}
                  <div className="flex-1 flex flex-col items-center justify-center text-center px-8 transition-colors duration-200">
                    <div className="w-12 h-12 bg-accent-blue rounded-full flex items-center justify-center shadow-lg shadow-[rgba(42,159,212,0.2)] mb-5">
                      <div className="w-4 h-4 bg-white rounded-sm rotate-45" />
                    </div>
                    <h2 className="text-xl tracking-tight mb-1">
                      <span className="font-light italic">info</span>
                      <span className="font-semibold not-italic">nugget</span>
                    </h2>
                    <PanelRequirements
                      level="sources"
                      onRequirementClick={(req) => {
                        if (req === 'Document') setExpandedPanel('sources');
                      }}
                    />
                  </div>
                </>
              ) : (
                <div
                  className="flex-1 flex flex-col items-center justify-center text-center px-8 transition-colors duration-200"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setEmptyDragging(true);
                  }}
                  onDragLeave={() => setEmptyDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setEmptyDragging(false);
                  }}
                  style={emptyDragging ? { backgroundColor: 'rgba(42, 159, 212, 0.04)' } : undefined}
                >
                  <div
                    className={`w-12 h-12 bg-accent-blue rounded-full flex items-center justify-center shadow-lg shadow-[rgba(42,159,212,0.2)] mb-5 transition-transform duration-300 ${emptyDragging ? 'scale-110' : ''}`}
                  >
                    <div className="w-4 h-4 bg-white rounded-sm rotate-45" />
                  </div>
                  <h2 className="text-xl tracking-tight mb-1">
                    <span className="font-light italic">info</span>
                    <span className="font-semibold not-italic">nugget</span>
                  </h2>
                  {emptyDragging ? (
                    <p className="text-zinc-400 text-sm font-light mb-6 max-w-xs">Drop to upload</p>
                  ) : (
                    <>
                      <PanelRequirements
                        level="sources"
                        onRequirementClick={(req) => {
                          if (req === 'Document') setExpandedPanel('sources');
                        }}
                      />
                    </>
                  )}
                </div>
              )}
            </main>

            {/* Footer */}
            <footer className="shrink-0 flex items-center justify-center py-1.5 border-t border-zinc-100 dark:border-zinc-700 bg-white dark:bg-zinc-900 relative z-[102]">
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 tracking-wide">
                <span className="font-light italic tracking-tight">info</span>
                <span className="font-semibold not-italic tracking-tight">nugget</span>
                <span className="ml-1">
                  is AI powered and can make mistakes. Please double-check generated content and cards.
                </span>
              </p>
            </footer>
          </div>
        </>
      )}
      {/* Folder picker dialog for single-card generation (no loose cards) */}
      {pendingFolderSelection && selectedNugget && (
        <FolderPickerDialog
          folders={selectedNugget.cards.filter(isCardFolder)}
          onSelect={handleFolderSelectedForPending}
          onCreateAndSelect={handleCreateFolderForPending}
          onCancel={() => setPendingFolderSelection(null)}
        />
      )}
    </div>
  );
};

export default App;
