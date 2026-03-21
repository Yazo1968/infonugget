import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import ZoomOverlay from './components/ZoomOverlay';
import AssetsPanel from './components/AssetsPanel';
import {
  StylingOptions,
  ReferenceImage,
  Nugget,
  DetailLevel,
  ChatMessage,
  Card,
  isCardFolder,
} from './types';
import {
  DEFAULT_STYLING,
  registerCustomStyles,
  uploadToFilesAPI,
  deleteFromFilesAPI,
} from './utils/ai';
import { Dashboard } from './components/Dashboard';
import SourcesPanel from './components/SourcesPanel';
import ChatPanel from './components/ChatPanel';
import SmartDeckPanel from './components/SmartDeckPanel';
import DocVizPanel from './components/DocVizPanel';
import ComposerPanel from './components/ComposerPanel';
import CardsPanel, { PanelEditorHandle } from './components/CardsPanel';
import ErrorBoundary from './components/ErrorBoundary';
import PanelTabBar from './components/PanelTabBar';
import SubjectQualityPanel from './components/SubjectQualityPanel';
import NuggetTabBar from './components/NuggetTabBar';
import HeaderBar from './components/HeaderBar';
import LogoIcon from './components/LogoIcon';

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
import { useSmartDeck } from './hooks/useSmartDeck';
import { useBriefingSuggestions } from './hooks/useBriefingSuggestions';
import { useTokenUsage, TokenUsageTotals } from './hooks/useTokenUsage';
import { useTabManagement } from './hooks/useTabManagement';
import { useStylingSync } from './hooks/useStylingSync';
import { useNuggetCloseTracker } from './hooks/useNuggetCloseTracker';
import { useFilesApiSync } from './hooks/useFilesApiSync';
import { storage } from './components/StorageProvider';
import {
  base64ToBlob,
} from './utils/fileProcessing';
import { flattenCards, findFolder, findParentFolder } from './utils/cardUtils';
import { exportFolderToDocx } from './utils/exportDocx';
import { useToast } from './components/ToastNotification';
import PdfUploadChoiceDialog from './components/PdfUploadChoiceDialog';
import PdfProcessorModal from './components/PdfProcessorModal';
import PanelRequirements from './components/PanelRequirements';
import StyleStudioModal from './components/StyleStudioModal';
import FolderPickerDialog from './components/FolderPickerDialog';
import ExportImagesModal from './components/ExportImagesModal';
import FootnoteBar from './components/FootnoteBar';

const App: React.FC = () => {
  // ── Focused context hooks ──
  const {
    nuggets, selectedNuggetId, selectedNugget,
    selectedDocumentId, setSelectedDocumentId,
    deleteNugget, updateNugget,
    updateNuggetDocument, removeNuggetDocument, renameNuggetDocument, toggleNuggetDocument,
    deleteDocChangeLogEntry, deleteAllDocChangeLogEntries, renameDocChangeLogEntry, createLogCheckpoint,
  } = useNuggetContext();
  const { projects, deleteProject, updateProject } = useProjectContext();
  const { activeCard, selectEntity } = useSelectionContext();
  const { customStyles, addCustomStyle: _addCustomStyle, updateCustomStyle: _updateCustomStyle, deleteCustomStyle: _deleteCustomStyle, replaceCustomStyles } = useStyleContext();
  const { darkMode, toggleDarkMode } = useThemeContext();
  const { initialTokenUsageTotals, openProjectId, setOpenProjectId } = useAppContext();

  // ── Files API lifecycle hooks ──
  useNuggetCloseTracker(selectedNuggetId);  // Records nugget_last_closed_at on navigation
  useFilesApiSync();                         // Re-uploads documents with null fileId on nugget open

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
    initiateChat: initiateInsightsChat,
    handleDocChangeContinue,
    handleDocChangeStartFresh,
  } = useInsightsLab(recordUsage);

  // ── Document quality check (DQAF v2) ──
  const {
    dqafReport,
    effectiveStatus: qualityStatus,
    isChecking: qualityIsChecking,
    checkError: qualityCheckError,
    runQualityCheck,
    abortQualityCheck,
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

  // ── SmartDeck workflow hook ──
  const {
    session: smartDeckSession,
    generate: smartDeckGenerate,
    acceptCards: smartDeckAcceptCards,
    abort: smartDeckAbort,
    reset: smartDeckReset,
  } = useSmartDeck(recordUsage, { createPlaceholderCards, createPlaceholderCardsInFolder, fillPlaceholderCard, removePlaceholderCard });

  const { generateBriefingSuggestions, abortSuggestions: abortBriefingSuggestions } = useBriefingSuggestions(recordUsage);

  // ── Ref bridge: askPdfProcessor (from useDocumentOperations) → useProjectOperations ──
  const askPdfProcessorRef = useRef<AskPdfProcessorFn | null>(null);

  // ── Project & nugget operations (creation, duplication, copy/move, subject) ──
  const {
    setNuggetCreationProjectId,
    isRegeneratingDomain,
    handleCreateNugget,
    handleCreateProject,
    handleCopyNuggetToProject,
    handleSaveDomain,
    handleRegenerateDomain,
    setDomainGenPending,
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
    onDomainGenPending: setDomainGenPending,
    createPlaceholderCards,
    fillPlaceholderCard,
    removePlaceholderCard,
  });

  // Wire the ref bridge (synchronous assignment — safe for async consumers)
  askPdfProcessorRef.current = askPdfProcessor;

  // ── Chat card generation via folder picker ──
  // Ref to stash placeholder info so ChatPanel's fill callback can find it
  const chatPendingPlaceholderRef = useRef<{ cardId: string; level: DetailLevel } | null>(null);

  const handleChatRequestCardGeneration = useCallback(
    (promptText: string, detailLevel: DetailLevel) => {
      setPendingFolderSelection({ type: 'chatGenerateCard', promptText, detailLevel });
    },
    [],
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

  // ── Folder picker for card operations ──
  type PendingFolderSelection =
    | { type: 'chatSaveAsCard'; message: ChatMessage; editedContent: string }
    | { type: 'chatGenerateCard'; promptText: string; detailLevel: DetailLevel }
    | { type: 'sourceGeneration'; headingId: string; detailLevel: DetailLevel; cardTitle: string; sourceDocName: string };

  const [pendingFolderSelection, setPendingFolderSelection] = useState<PendingFolderSelection | null>(null);
  const [exportImagesFolderId, setExportImagesFolderId] = useState<string | null>(null);

  const handleGenerateCardContentWrapped = useCallback(
    (headingId: string, detailLevel: DetailLevel, cardTitle: string, sourceDocName?: string, existingCardId?: string) => {
      if (existingCardId) {
        // Updating existing card — no folder selection needed
        handleGenerateCardContent(headingId, detailLevel, cardTitle, sourceDocName, existingCardId);
      } else {
        // New card — show folder picker
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

      if (pending.type === 'chatSaveAsCard') {
        handleSaveAsCard(pending.message, pending.editedContent, folderId);
      } else if (pending.type === 'chatGenerateCard') {
        const placeholderTitle = pending.promptText.length > 50
          ? pending.promptText.substring(0, 50) + '...'
          : pending.promptText;
        const placeholders = createPlaceholderCards([placeholderTitle], pending.detailLevel, { targetFolderId: folderId });
        const placeholderId = placeholders[0]?.id ?? null;
        if (placeholderId) {
          chatPendingPlaceholderRef.current = { cardId: placeholderId, level: pending.detailLevel };
        }
        // Send the chat message now that the placeholder is placed in the folder
        sendInsightsMessage(pending.promptText, true, pending.detailLevel);
      } else if (pending.type === 'sourceGeneration') {
        // Create a placeholder card in the selected folder, then generate content
        const placeholders = createPlaceholderCards([pending.cardTitle], pending.detailLevel, { targetFolderId: folderId });
        const placeholderId = placeholders[0]?.id ?? null;
        if (placeholderId) {
          handleGenerateCardContent(pending.headingId, pending.detailLevel, pending.cardTitle, pending.sourceDocName, placeholderId);
        }
      }

      setPendingFolderSelection(null);
    },
    [pendingFolderSelection, handleSaveAsCard, createPlaceholderCards, sendInsightsMessage, handleGenerateCardContent],
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
  const [expandedPanel, setExpandedPanel] = useState<'sources' | 'chat' | 'smart-deck' | 'docviz' | 'composer' | 'cards' | 'quality' | null>('sources');
  const [qualityActiveTab, setQualityActiveTab] = useState<'logs' | 'brief' | 'assessment'>('brief');
  // selectedDocumentId is now in AppContext (with guard effect for auto-selection)

  // ── Unsaved-changes gating for panel/nugget switching ──
  const cardsPanelRef = useRef<PanelEditorHandle>(null);
  const sourcesPanelRef = useRef<PanelEditorHandle>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const panelSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [appPendingAction, setAppPendingAction] = useState<(() => void) | null>(null);
  const [appPendingDirtyPanel, setAppPendingDirtyPanel] = useState<'cards' | 'sources' | 'brief' | null>(null);

  // Brief draft-mode dirty tracking (set via SubjectQualityPanel callback)
  const [briefLockActive, setBriefLockActive] = useState(false);
  const briefSaveRef = useRef<(() => void) | null>(null);
  const briefDiscardRef = useRef<(() => void) | null>(null);

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
    if (briefLockActive) {
      setAppPendingDirtyPanel('brief');
      setAppPendingAction(() => action);
      return;
    }
    action();
  }, [briefLockActive]);

  const handleAppDialogSave = useCallback(() => {
    const panel = appPendingDirtyPanel;
    if (panel === 'cards') cardsPanelRef.current?.save();
    else if (panel === 'sources') sourcesPanelRef.current?.save();
    else if (panel === 'brief') {
      briefSaveRef.current?.();
      setBriefLockActive(false); // Explicit clear — panel may unmount before effect propagates
    }
    // After saving, re-check: is another panel dirty?
    if (panel !== 'brief') {
      const otherRef = panel === 'cards' ? sourcesPanelRef : cardsPanelRef;
      const otherLabel = panel === 'cards' ? 'sources' : 'cards';
      if (otherRef.current?.isDirty) {
        setAppPendingDirtyPanel(otherLabel as 'cards' | 'sources');
        return;
      }
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
    else if (panel === 'brief') {
      briefDiscardRef.current?.();
      setBriefLockActive(false); // Explicit clear — panel may unmount before effect propagates
    }
    if (panel !== 'brief') {
      const otherRef = panel === 'cards' ? sourcesPanelRef : cardsPanelRef;
      const otherLabel = panel === 'cards' ? 'sources' : 'cards';
      if (otherRef.current?.isDirty) {
        setAppPendingDirtyPanel(otherLabel as 'cards' | 'sources');
        return;
      }
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
    handleSetActiveImage,
    handleDeleteAlbumImage,
    albumActionPending,
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
        setExpandedPanel('sources');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [setZoomState, setManifestCards, setExpandedPanel]);

  // ── Download folder content as DOCX ──
  const handleDownloadContent = useCallback(
    async (folderId: string) => {
      if (!selectedNugget) return;
      const folder = findFolder(selectedNugget.cards, folderId);
      if (!folder) return;

      const selectedCards = folder.cards.filter((c) => c.selected);
      if (selectedCards.length === 0) {
        addToast({ type: 'warning', message: 'No cards selected. Select cards first.' });
        return;
      }

      try {
        const count = await exportFolderToDocx({
          projectName: openProject?.name || 'Untitled Project',
          nuggetName: selectedNugget.name,
          folder,
          documents: selectedNugget.documents,
        });
        if (count === 0) {
          addToast({ type: 'warning', message: 'No card content to export. Generate card content first.' });
        } else {
          addToast({ type: 'success', message: `Downloaded ${count} card${count > 1 ? 's' : ''} as DOCX.` });
        }
      } catch (err) {
        console.error('DOCX export failed:', err);
        addToast({ type: 'error', message: 'Failed to generate DOCX file.' });
      }
    },
    [selectedNugget, openProject, addToast],
  );

  const handleExportImages = useCallback((folderId: string) => {
    setExportImagesFolderId(folderId);
  }, []);

  // ── Click-outside to close overlay panels ──
  useEffect(() => {
    if (!expandedPanel) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-panel-overlay]')) return;
      if (target.closest('[data-panel-strip]')) return;
      if (target.closest('[data-breadcrumb-dropdown]')) return;
      if (target.closest('header')) return;
      // Don't close when clicking portal-rendered menus, modals, dialogs
      // Walk up through nested .fixed elements (e.g. backdrop → menu) to find one portaled to body
      let fixed: Element | null = target.closest('.fixed');
      while (fixed) {
        if (fixed.parentElement === document.body) return;
        fixed = fixed.parentElement?.closest('.fixed') ?? null;
      }
      appGatedAction(() => setExpandedPanel('sources'));
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
    <div className="min-h-screen bg-white overflow-x-hidden">
      {!openProjectId ? (
        <Dashboard
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


          {/* App-level unsaved changes dialog (for nugget/panel switching) */}
          {appPendingAction && appPendingDirtyPanel && (
            <UnsavedChangesDialog
              title={`Unsaved changes in ${appPendingDirtyPanel === 'cards' ? 'Cards' : appPendingDirtyPanel === 'brief' ? 'Domain & Brief' : 'Sources'} editor`}
              description="You have unsaved edits. Save or discard them to continue."
              saveLabel={appPendingDirtyPanel === 'brief' ? 'Update' : undefined}
              onSave={handleAppDialogSave}
              onDiscard={handleAppDialogDiscard}
              onCancel={handleAppDialogCancel}
            />
          )}

          {/* Zoom Overlay */}
          {zoomState.imageUrl && <ZoomOverlay zoomState={zoomState} onClose={closeZoom} />}

          <div
            className="flex flex-col h-screen w-screen overflow-hidden"
            style={{
              background: darkMode ? '#18181b' : 'linear-gradient(180deg, #f0f4f8 0%, #e8edf2 40%, #f5f7fa 100%)',
            }}
          >
            {/* Header bar — always visible */}
            <HeaderBar
              onReturnToLanding={handleReturnToLanding}
              usageTotals={usageTotals}
              resetUsage={resetUsage}
              projectName={openProject?.name}
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
                    if (prev === panel) return 'sources';
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
                onGoHome={handleReturnToLanding}
              />

              {selectedNugget ? (
                <>
                  {/* Hard lock overlay — blocks all UI while TOC has unsaved changes (SourcesPanel at z-[107] stays above) */}
                  {tocLockActive && expandedPanel === 'sources' && (
                    <div className="fixed inset-0 z-[106] bg-black/20 cursor-not-allowed" />
                  )}

                  {/* Brief & Quality Panel */}
                  <ErrorBoundary name="Quality">
                    <SubjectQualityPanel
                      isOpen={expandedPanel === 'quality'}
                      activeTab={qualityActiveTab}
                      onTabChange={setQualityActiveTab}
                      tabBarRef={tabBarRef}
                      onToggle={() =>
                        appGatedAction(() => setExpandedPanel((prev) => (prev === 'quality' ? null : 'quality')))
                      }
                      nuggetId={selectedNugget.id}
                      nuggetName={selectedNugget.name}
                      currentDomain={selectedNugget.domain || ''}
                      isRegeneratingDomain={isRegeneratingDomain}
                      domainReviewNeeded={!!selectedNugget.domainReviewNeeded}
                      onSaveDomain={handleSaveDomain}
                      onRegenerateDomain={handleRegenerateDomain}
                      onDismissDomainReview={(id) => updateNugget(id, (n) => ({ ...n, domainReviewNeeded: false }))}
                      briefReviewNeeded={!!selectedNugget.briefReviewNeeded}
                      onDismissBriefReview={(id) => updateNugget(id, (n) => ({ ...n, briefReviewNeeded: false }))}
                      sourcesLog={selectedNugget.sourcesLog || []}
                      sourcesLogStats={selectedNugget.sourcesLogStats ?? { logsCreated: 0, logsDeleted: 0, logsArchived: 0, lastUpdated: 0, rawEventSeq: 0, lastCheckpointRawSeq: 0 }}
                      hasPendingChanges={(selectedNugget.sourcesLogStats?.rawEventSeq ?? 0) > (selectedNugget.sourcesLogStats?.lastCheckpointRawSeq ?? 0)}
                      onDeleteLogEntry={deleteDocChangeLogEntry}
                      onDeleteAllLogEntries={deleteAllDocChangeLogEntries}
                      onRenameLogEntry={renameDocChangeLogEntry}
                      onCreateLogEntry={() => createLogCheckpoint('manual')}
                      briefing={selectedNugget.briefing}
                      briefingSuggestions={selectedNugget.briefingSuggestions}
                      onBriefingChange={(briefing) => updateNugget(selectedNugget.id, (n) => ({ ...n, briefing, briefReviewNeeded: false }))}
                      onSuggestionsChange={(briefingSuggestions) => updateNugget(selectedNugget.id, (n) => ({ ...n, briefingSuggestions }))}
                      onBriefDirtyChange={setBriefLockActive}
                      briefSaveRef={briefSaveRef}
                      briefDiscardRef={briefDiscardRef}
                      documents={nuggetDocs}
                      subject={selectedNugget.domain}
                      onGenerateSuggestions={generateBriefingSuggestions}
                      onAbortSuggestions={abortBriefingSuggestions}
                      dqafReport={dqafReport}
                      effectiveStatus={qualityStatus}
                      isChecking={qualityIsChecking}
                      checkError={qualityCheckError}
                      onRunCheck={runQualityCheck}
                      onAbortCheck={abortQualityCheck}
                      onFixDocuments={() => {
                        setExpandedPanel('sources');
                      }}
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
                      onFillPlaceholderCard={handleChatFillPlaceholder}
                      onRemovePlaceholderCard={removePlaceholderCard}
                      onRequestCardGeneration={handleChatRequestCardGeneration}
                      externalPlaceholderRef={chatPendingPlaceholderRef}
                      onInitiateChat={initiateInsightsChat}
                      qualityStatus={qualityStatus}
                      onViewLog={() => appGatedAction(() => { setQualityActiveTab('logs'); setExpandedPanel('quality'); })}
                    />
                  </ErrorBoundary>

                  {/* Panel 4: SmartDeck */}
                  <ErrorBoundary name="SmartDeck">
                    <SmartDeckPanel
                      isOpen={expandedPanel === 'smart-deck'}
                      tabBarRef={tabBarRef}
                      onToggle={() =>
                        appGatedAction(() => setExpandedPanel((prev) => (prev === 'smart-deck' ? null : 'smart-deck')))
                      }
                      documents={nuggetDocs}
                      briefing={selectedNugget?.briefing}
                      domain={selectedNugget?.domain}
                      domainReviewNeeded={selectedNugget?.domainReviewNeeded}
                      briefReviewNeeded={selectedNugget?.briefReviewNeeded}
                      onOpenBriefTab={() => appGatedAction(() => { setQualityActiveTab('brief'); setExpandedPanel('quality'); })}
                      onOpenSourcesTab={() => appGatedAction(() => setExpandedPanel('sources'))}
                      session={smartDeckSession}
                      onGenerate={smartDeckGenerate}
                      onAcceptCards={smartDeckAcceptCards}
                      onAbort={smartDeckAbort}
                      onReset={smartDeckReset}
                    />
                  </ErrorBoundary>

                  {/* Panel 5: DocViz */}
                  <ErrorBoundary name="DocViz">
                    <DocVizPanel
                      isOpen={expandedPanel === 'docviz'}
                      tabBarRef={tabBarRef}
                      documents={nuggetDocs}
                      menuDraftOptions={menuDraftOptions}
                      setMenuDraftOptions={setMenuDraftOptions}
                      onOpenStyleStudio={() => setShowStyleStudio(true)}
                      onZoomImage={setZoomState}
                    />
                  </ErrorBoundary>

                  {/* Panel 6: Composer */}
                  <ErrorBoundary name="Composer">
                    <ComposerPanel
                      isOpen={expandedPanel === 'composer'}
                      tabBarRef={tabBarRef}
                      cards={nuggetCards}
                      projectName={openProject?.name || 'Untitled Project'}
                      nuggetName={selectedNugget?.name || 'Untitled Nugget'}
                      documents={nuggetDocs}
                      branding={openProject?.branding}
                      onUpdateBranding={(b) => {
                        if (openProject) {
                          updateProject(openProject.id, (p) => ({ ...p, branding: b, lastModifiedAt: Date.now() }));
                        }
                      }}
                    />
                  </ErrorBoundary>

                  {/* Panel 7: Cards & Assets (portal overlay) */}
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
                      onGenerateBatchCards={setManifestCards}
                      onReorderCards={reorderInsightsCards}
                      onReorderCardItem={reorderCardItem}
                      onToggleFolderCollapsed={toggleFolderCollapsed}
                      onToggleFolderSelection={toggleFolderSelection}
                      onRenameFolder={renameFolder}
                      onDeleteFolder={deleteFolder}
                      onDuplicateFolder={duplicateFolder}
                      onCopyMoveFolder={handleCopyMoveFolder}
                      onDownloadContent={handleDownloadContent}
                      onExportImages={handleExportImages}
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
                              const allItems = selectedNugget?.cards || [];
                              let scopeCards: Card[];
                              if (activeCard) {
                                const parentFolder = findParentFolder(allItems, activeCard.id);
                                scopeCards = parentFolder ? parentFolder.cards.filter((c): c is Card => !isCardFolder(c)) : flattenCards(allItems);
                              } else {
                                scopeCards = flattenCards(allItems);
                              }
                              const selected = scopeCards.filter((c) => c.selected);
                              if (selected.length === 0) {
                                alert('Please select cards first.');
                                return;
                              }
                              setManifestCards(selected);
                            }}
                            selectedCount={(() => {
                              const allItems = selectedNugget?.cards || [];
                              if (activeCard) {
                                const pf = findParentFolder(allItems, activeCard.id);
                                if (pf) return pf.cards.filter((c): c is Card => !isCardFolder(c) && !!c.selected).length;
                              }
                              return insightsSelectedCount;
                            })()}
                            onZoomImage={openZoom}
                            onImageModified={handleInsightsImageModified}
                            contentDirty={false}
                            currentContent={activeCard?.synthesisMap?.[activeCard?.detailLevel || activeLogicTab] || ''}
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
                            onSetActiveImage={handleSetActiveImage}
                            onDeleteAlbumImage={handleDeleteAlbumImage}
                            albumActionPending={albumActionPending}
                            onUsage={recordUsage}
                            onOpenStyleStudio={() => setShowStyleStudio(true)}
                          />
                        ) : undefined
                      }
                    />
                  </ErrorBoundary>

                  {/* Main content area — branded empty state */}
                  <div className="flex-1 flex flex-col items-center justify-center text-center px-8 transition-colors duration-200">
                    <div className="mb-5">
                      <LogoIcon size={48} darkMode={darkMode} />
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
                  <div className={`mb-5 transition-transform duration-300 ${emptyDragging ? 'scale-110' : ''}`}>
                    <LogoIcon size={48} darkMode={darkMode} />
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

            {/* Footnote bar — surfaces actionable notices */}
            <FootnoteBar
              sourcesLogStats={selectedNugget?.sourcesLogStats}
              domainReviewNeeded={selectedNugget?.domainReviewNeeded}
              briefReviewNeeded={selectedNugget?.briefReviewNeeded}
              qualityStatus={qualityStatus}
              onOpenSourcesLog={() => appGatedAction(() => { setQualityActiveTab('logs'); setExpandedPanel('quality'); })}
              onOpenDomainEdit={() => appGatedAction(() => { setQualityActiveTab('brief'); setExpandedPanel('quality'); })}
              onOpenBriefEdit={() => appGatedAction(() => { setQualityActiveTab('brief'); setExpandedPanel('quality'); })}
              onOpenQualityPanel={() => appGatedAction(() => { setQualityActiveTab('assessment'); setExpandedPanel('quality'); })}
            />

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
      {/* Export Images modal */}
      {exportImagesFolderId && selectedNugget && (() => {
        const folder = findFolder(selectedNugget.cards, exportImagesFolderId);
        if (!folder) return null;
        return (
          <ExportImagesModal
            folder={folder}
            darkMode={darkMode}
            onClose={() => setExportImagesFolderId(null)}
          />
        );
      })()}
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
