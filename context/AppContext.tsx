import React, { createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react';
import {
  UploadedFile,
  Card,
  Nugget,
  Project,
  InitialPersistedState,
  ChatMessage,
  DocChangeEvent,
  DocChangeMagnitude,
  SourcesLogStats,
  SourcesLogEntry,
  SourcesLogTrigger,
  CustomStyle,
  CardItem,
} from '../types';
import { findCard, flattenCards, mapCardById, mapCards } from '../utils/cardUtils';
import { cleanupNuggetExternalFiles } from '../utils/deletionCleanup';
import { ThemeContext, useThemeContext } from './ThemeContext';
import { NuggetContext, useNuggetContext } from './NuggetContext';
import { ProjectContext, useProjectContext } from './ProjectContext';
import { SelectionContext, useSelectionContext } from './SelectionContext';
import { StyleContext, useStyleContext } from './StyleContext';

// ── Sources Log helpers ──
const SOURCES_LOG_CAP = 20;

/** Default stats when none exist on the nugget */
function getDefaultStats(nugget: Nugget): SourcesLogStats {
  return {
    logsCreated: nugget.sourcesLogStats?.logsCreated ?? 0,
    logsDeleted: nugget.sourcesLogStats?.logsDeleted ?? 0,
    logsArchived: nugget.sourcesLogStats?.logsArchived ?? 0,
    lastUpdated: nugget.sourcesLogStats?.lastUpdated ?? 0,
    rawEventSeq: nugget.sourcesLogStats?.rawEventSeq ?? 0,
    lastCheckpointRawSeq: nugget.sourcesLogStats?.lastCheckpointRawSeq ?? 0,
  };
}

/** Opposite toggle type for cancellation */
const TOGGLE_OPPOSITE: Record<string, string> = {
  enabled: 'disabled',
  disabled: 'enabled',
};

/**
 * Append a raw doc change event to a nugget's internal tracking log.
 * Uses rawEventSeq for monotonic seq assignment. Does NOT create checkpoint entries.
 *
 * Toggle cancellation: when logging an 'enabled' or 'disabled' event, if an
 * un-checkpointed opposite toggle for the same document exists, the two cancel
 * out — the previous event is removed and no new event is added. This prevents
 * noise from repeated activate/deactivate cycles.
 *
 * Pure function — safe to call from any context.
 */
export function appendDocChangeEvent(
  nugget: Nugget,
  eventBase: Omit<DocChangeEvent, 'seq'>,
): Pick<Nugget, 'docChangeLog' | 'sourcesLogStats' | 'domainReviewNeeded' | 'briefReviewNeeded'> {
  const stats = getDefaultStats(nugget);
  const log = [...(nugget.docChangeLog || [])];

  // Toggle cancellation: enabled ↔ disabled
  const opposite = TOGGLE_OPPOSITE[eventBase.type];
  if (opposite) {
    const lastCheckpointSeq = stats.lastCheckpointRawSeq;
    // Find the most recent un-checkpointed opposite toggle for the same doc
    let cancelIdx = -1;
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (e.docId === eventBase.docId && e.type === opposite && e.seq > lastCheckpointSeq) {
        cancelIdx = i;
        break;
      }
    }
    if (cancelIdx !== -1) {
      // Cancel out: remove the previous event, don't add a new one.
      // Also roll back rawEventSeq so the pending-changes count stays accurate.
      log.splice(cancelIdx, 1);
      stats.rawEventSeq = Math.max(stats.lastCheckpointRawSeq, stats.rawEventSeq - 1);
      const stillHasPendingChanges = stats.rawEventSeq > stats.lastCheckpointRawSeq;
      return { docChangeLog: log, sourcesLogStats: stats, domainReviewNeeded: stillHasPendingChanges ? nugget.domainReviewNeeded : false, briefReviewNeeded: stillHasPendingChanges ? nugget.briefReviewNeeded : false };
    }
  }

  stats.rawEventSeq += 1;
  const event: DocChangeEvent = { ...eventBase, seq: stats.rawEventSeq };
  log.push(event);
  return { docChangeLog: log, sourcesLogStats: stats, domainReviewNeeded: true, briefReviewNeeded: true };
}

/**
 * Create a Sources Log checkpoint entry from pending raw events.
 * Returns null if there are no pending changes to checkpoint.
 * Pure function — safe to call from any context.
 */
export function createSourcesLogCheckpoint(
  nugget: Nugget,
  trigger: SourcesLogTrigger,
): Pick<Nugget, 'sourcesLog' | 'sourcesLogStats'> | null {
  const stats = getDefaultStats(nugget);
  const rawLog = nugget.docChangeLog || [];

  // Get raw events not yet consumed into a checkpoint
  const pending = rawLog.filter((e) => e.seq > stats.lastCheckpointRawSeq);
  if (pending.length === 0) return null;

  // Create checkpoint entry
  stats.logsCreated += 1;
  const entry: SourcesLogEntry = {
    seq: stats.logsCreated,
    trigger,
    timestamp: Date.now(),
    changes: pending.map((e) => ({
      type: e.type,
      docName: e.docName,
      oldName: e.oldName,
      magnitude: e.magnitude,
    })),
  };

  // Add to sourcesLog with cap
  const sourcesLog = [...(nugget.sourcesLog || []), entry];
  if (sourcesLog.length > SOURCES_LOG_CAP) {
    const overflow = sourcesLog.length - SOURCES_LOG_CAP;
    stats.logsArchived += overflow;
    sourcesLog.splice(0, overflow);
  }

  // Advance checkpoint marker
  stats.lastCheckpointRawSeq = Math.max(...pending.map((e) => e.seq));
  stats.lastUpdated = Date.now();

  return { sourcesLog, sourcesLogStats: stats };
}

// ── Context shape ──
interface AppContextValue {
  // Core state
  activeCardId: string | null;
  setActiveCardId: React.Dispatch<React.SetStateAction<string | null>>;

  // Derived values
  activeCard: Card | null;

  // Nugget state
  nuggets: Nugget[];
  setNuggets: React.Dispatch<React.SetStateAction<Nugget[]>>;
  selectedNuggetId: string | null;
  setSelectedNuggetId: React.Dispatch<React.SetStateAction<string | null>>;

  // Document selection
  selectedDocumentId: string | null;
  setSelectedDocumentId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedDocument: UploadedFile | undefined;

  // Project selection (explicit state for empty-project support)
  selectedProjectId: string | null;

  // Selection level — tracks what the user explicitly clicked (primary highlight)
  selectionLevel: 'project' | 'nugget' | 'document' | null;
  setSelectionLevel: React.Dispatch<React.SetStateAction<'project' | 'nugget' | 'document' | null>>;

  // Unified selection helper (enforces project→nugget→document triple)
  selectEntity: (opts: { projectId?: string; nuggetId?: string; documentId?: string }) => void;

  // Derived nugget values
  selectedNugget: Nugget | undefined;

  // Helpers
  addNugget: (nugget: Nugget) => void;
  deleteNugget: (nuggetId: string) => Promise<void>;
  updateNugget: (nuggetId: string, updater: (n: Nugget) => Nugget) => void;

  updateNuggetCard: (cardId: string, updater: (c: Card) => Card) => void;
  updateNuggetCards: (updater: (c: Card) => Card) => void;
  updateNuggetContentAndCards: (content: string, cards: Card[]) => void;
  appendNuggetMessage: (message: ChatMessage) => void;

  // Nugget document mutation helpers
  addNuggetDocument: (doc: UploadedFile) => void;
  updateNuggetDocument: (docId: string, updated: UploadedFile) => void;
  removeNuggetDocument: (docId: string) => void;
  renameNuggetDocument: (docId: string, newName: string) => void;
  toggleNuggetDocument: (docId: string) => void;

  // Project state
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;

  // Project helpers
  addProject: (project: Project) => void;
  deleteProject: (projectId: string) => Promise<void>;
  updateProject: (projectId: string, updater: (p: Project) => Project) => void;
  addNuggetToProject: (projectId: string, nuggetId: string) => void;
  removeNuggetFromProject: (projectId: string, nuggetId: string) => void;

  // Token usage (initial persisted totals for hydration)
  initialTokenUsageTotals?: Record<string, number>;

  // Custom styles (global, user-created)
  customStyles: CustomStyle[];
  addCustomStyle: (style: CustomStyle) => void;
  updateCustomStyle: (id: string, updates: Partial<CustomStyle>) => void;
  deleteCustomStyle: (id: string) => void;
  replaceCustomStyles: (styles: CustomStyle[]) => void;

  // Dark mode
  darkMode: boolean;
  toggleDarkMode: () => void;

  // Landing ↔ Workspace navigation
  openProjectId: string | null;
  setOpenProjectId: React.Dispatch<React.SetStateAction<string | null>>;
}

// Minimal context for members not covered by any focused context
interface AppContextRemainder {
  openProjectId: string | null;
  setOpenProjectId: React.Dispatch<React.SetStateAction<string | null>>;
  initialTokenUsageTotals?: Record<string, number>;
}

const AppContext = createContext<AppContextRemainder | null>(null);

// ── Composition hook — merges all 5 focused contexts + remainder ──
export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used inside <AppProvider>');
  const theme = useThemeContext();
  const nugget = useNuggetContext();
  const project = useProjectContext();
  const selection = useSelectionContext();
  const style = useStyleContext();
  return { ...ctx, ...theme, ...nugget, ...project, ...selection, ...style };
}

// ── Provider ──
export const AppProvider: React.FC<{
  children: React.ReactNode;
  initialState?: InitialPersistedState;
}> = ({ children, initialState }) => {
  // Core state
  const [openProjectId, setOpenProjectId] = useState<string | null>(initialState?.openProjectId ?? null);
  const [activeCardId, setActiveCardId] = useState<string | null>(initialState?.activeCardId ?? null);

  // Nugget state (documents are now owned per-nugget, no global library)
  const [nuggets, setNuggets] = useState<Nugget[]>(initialState?.nuggets ?? []);
  const [selectedNuggetId, setSelectedNuggetId] = useState<string | null>(initialState?.selectedNuggetId ?? null);

  // Document selection (context-level, synced with nugget)
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(initialState?.selectedDocumentId ?? null);

  // Project state
  const [projects, setProjects] = useState<Project[]>(initialState?.projects ?? []);

  // Project selection (explicit state so empty projects can be selected)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialState?.selectedProjectId ?? null);

  // Selection level — tracks what the user explicitly clicked (for primary vs context highlight)
  const [selectionLevel, setSelectionLevel] = useState<'project' | 'nugget' | 'document' | null>(() => {
    if (initialState?.selectedDocumentId) return 'document';
    if (initialState?.selectedNuggetId) return 'nugget';
    if (initialState?.selectedProjectId) return 'project';
    return null;
  });

  // Custom styles state (global, not per-nugget)
  const [customStyles, setCustomStyles] = useState<CustomStyle[]>(initialState?.customStyles ?? []);

  // Dark mode
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const stored = localStorage.getItem('infonugget-dark-mode');
    if (stored !== null) return stored === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('infonugget-dark-mode', String(darkMode));
  }, [darkMode]);

  const toggleDarkMode = useCallback(() => setDarkMode((prev) => !prev), []);

  // Derived: selected nugget
  const selectedNugget = useMemo(() => nuggets.find((n) => n.id === selectedNuggetId), [nuggets, selectedNuggetId]);

  // Derived: selected document
  const selectedDocument = useMemo(
    () => selectedNugget?.documents.find((d) => d.id === selectedDocumentId),
    [selectedNugget, selectedDocumentId],
  );

  // ── Unified selection helper: enforces project → nugget → document triple ──
  const selectEntity = useCallback(
    (opts: { projectId?: string; nuggetId?: string; documentId?: string }) => {
      const { projectId, nuggetId, documentId } = opts;

      if (documentId) {
        // Find the nugget that owns this document, then derive parent project
        const ownerNugget = nuggets.find((n) => n.documents.some((d) => d.id === documentId));
        if (!ownerNugget) return;
        const parentProject = projects.find((p) => p.nuggetIds.includes(ownerNugget.id));
        setSelectionLevel('document');
        setSelectedProjectId(parentProject?.id ?? null);
        setSelectedNuggetId(ownerNugget.id);
        setSelectedDocumentId(documentId);
        return;
      }
      if (nuggetId) {
        const parentProject = projects.find((p) => p.nuggetIds.includes(nuggetId));
        setSelectionLevel('nugget');
        setSelectedProjectId(parentProject?.id ?? null);
        setSelectedNuggetId(nuggetId);
        const nugget = nuggets.find((n) => n.id === nuggetId);
        const firstDoc = nugget?.documents.find((d) => d.enabled !== false);
        setSelectedDocumentId(firstDoc?.id ?? null);
        return;
      }
      if (projectId) {
        const project = projects.find((p) => p.id === projectId);
        if (!project) return;
        setSelectionLevel('project');
        setSelectedProjectId(projectId);
        if (project.nuggetIds.length > 0) {
          // Cascade to first nugget + first doc
          const firstNuggetId = project.nuggetIds[0];
          setSelectedNuggetId(firstNuggetId);
          const firstNugget = nuggets.find((n) => n.id === firstNuggetId);
          const firstDoc = firstNugget?.documents.find((d) => d.enabled !== false);
          setSelectedDocumentId(firstDoc?.id ?? null);
        } else {
          // Empty project — clear nugget & doc selection
          setSelectedNuggetId(null);
          setSelectedDocumentId(null);
        }
        return;
      }
    },
    [nuggets, projects],
  );

  // ── Guard effect: keep selectedProjectId in sync ──
  useEffect(() => {
    // If a nugget is selected, ensure selectedProjectId matches its parent
    if (selectedNuggetId) {
      const parentProject = projects.find((p) => p.nuggetIds.includes(selectedNuggetId));
      if (parentProject && parentProject.id !== selectedProjectId) {
        setSelectedProjectId(parentProject.id);
      }
      return;
    }
    // If no nugget but we have a selectedProjectId, verify the project still exists
    if (selectedProjectId && !projects.some((p) => p.id === selectedProjectId)) {
      setSelectedProjectId(null);
    }
  }, [selectedNuggetId, projects]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Guard effect: keep selectedDocumentId valid when nugget/docs change ──
  useEffect(() => {
    if (!selectedNuggetId) {
      setSelectedDocumentId(null);
      return;
    }
    const nugget = nuggets.find((n) => n.id === selectedNuggetId);
    if (!nugget) {
      setSelectedDocumentId(null);
      return;
    }
    // If current doc is still in this nugget, keep it
    if (selectedDocumentId && nugget.documents.some((d) => d.id === selectedDocumentId)) return;
    // Auto-select first enabled doc
    const firstDoc = nugget.documents.find((d) => d.enabled !== false);
    setSelectedDocumentId(firstDoc?.id ?? null);
  }, [selectedNuggetId, nuggets]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Guard effect: clear openProjectId if the project was deleted ──
  useEffect(() => {
    if (openProjectId && !projects.some((p) => p.id === openProjectId)) {
      setOpenProjectId(null);
    }
  }, [openProjectId, projects]);

  // Derived: currently active card (always a Card, never a CardFolder)
  const activeCard = useMemo((): Card | null => {
    const items = selectedNugget?.cards ?? [];
    if (items.length === 0) return null;
    if (activeCardId) {
      const found = findCard(items, activeCardId);
      if (found) return found;
    }
    // Fallback: first card in the tree
    const allCards = flattenCards(items);
    return allCards[0] || null;
  }, [selectedNugget, activeCardId]);

  // Nugget helpers
  const addNugget = useCallback((nugget: Nugget) => {
    setNuggets((prev) => [...prev, nugget]);
  }, []);

  const deleteNugget = useCallback(
    async (nuggetId: string) => {
      // Storage-first: clean up external files before removing from state
      const nugget = nuggets.find((n) => n.id === nuggetId);
      if (nugget) {
        await cleanupNuggetExternalFiles(nugget);
      }
      // Then remove from state
      setNuggets((prev) => prev.filter((n) => n.id !== nuggetId));
      setProjects((prev) =>
        prev.map((p) =>
          p.nuggetIds.includes(nuggetId)
            ? { ...p, nuggetIds: p.nuggetIds.filter((id) => id !== nuggetId), lastModifiedAt: Date.now() }
            : p,
        ),
      );
      if (selectedNuggetId === nuggetId) {
        setSelectedNuggetId(null);
        setSelectionLevel(null);
      }
    },
    [nuggets, selectedNuggetId],
  );

  const updateNugget = useCallback((nuggetId: string, updater: (n: Nugget) => Nugget) => {
    setNuggets((prev) => prev.map((n) => (n.id === nuggetId ? updater(n) : n)));
  }, []);

  // ── Unified nugget helpers ──

  const updateNuggetCard = useCallback(
    (cardId: string, updater: (c: Card) => Card) => {
      if (!selectedNuggetId) return;

      setNuggets((prev) =>
        prev.map((n) =>
          n.id === selectedNuggetId ? { ...n, cards: mapCardById(n.cards, cardId, updater), lastModifiedAt: Date.now() } : n,
        ),
      );
    },
    [selectedNuggetId],
  );

  const updateNuggetCards = useCallback(
    (updater: (c: Card) => Card) => {
      if (!selectedNuggetId) return;

      setNuggets((prev) =>
        prev.map((n) =>
          n.id === selectedNuggetId ? { ...n, cards: mapCards(n.cards, updater), lastModifiedAt: Date.now() } : n,
        ),
      );
    },
    [selectedNuggetId],
  );

  const updateNuggetContentAndCards = useCallback(
    (content: string, cards: CardItem[]) => {
      if (!selectedNuggetId) return;
      setNuggets((prev) =>
        prev.map((n) => (n.id === selectedNuggetId ? { ...n, cards, lastModifiedAt: Date.now() } : n)),
      );
    },
    [selectedNuggetId],
  );

  const appendNuggetMessage = useCallback(
    (message: ChatMessage) => {
      if (!selectedNuggetId) return;
      setNuggets((prev) =>
        prev.map((n) =>
          n.id === selectedNuggetId
            ? { ...n, messages: [...(n.messages || []), message], lastModifiedAt: Date.now() }
            : n,
        ),
      );
    },
    [selectedNuggetId],
  );

  // ── Nugget document mutation helpers ──

  const addNuggetDocument = useCallback(
    (doc: UploadedFile) => {
      if (!selectedNuggetId) return;
      setNuggets((prev) =>
        prev.map((n) => {
          if (n.id !== selectedNuggetId) return n;
          const logUpdate = appendDocChangeEvent(n, { type: 'added', docId: doc.id, docName: doc.name, timestamp: Date.now() });
          return {
            ...n,
            documents: [...n.documents, doc],
            ...logUpdate,
            lastModifiedAt: Date.now(),
          };
        }),
      );
    },
    [selectedNuggetId],
  );

  const updateNuggetDocument = useCallback(
    (docId: string, updated: UploadedFile) => {
      if (!selectedNuggetId) return;
      setNuggets((prev) =>
        prev.map((n) => {
          if (n.id !== selectedNuggetId) return n;
          // Only log if the doc was already fully processed (skip placeholder→ready transitions)
          const existing = n.documents.find((d) => d.id === docId);
          const shouldLog = existing && existing.status === 'ready' && updated.status === 'ready';
          if (!shouldLog) {
            return {
              ...n,
              documents: n.documents.map((d) => (d.id === docId ? updated : d)),
              lastModifiedAt: Date.now(),
            };
          }
          // Compute magnitude for enriched logging
          const existingHeadings = (existing.structure || []).map((h) => h.text);
          const updatedHeadings = (updated.structure || []).map((h) => h.text);
          const magnitude: DocChangeMagnitude = {
            charCountBefore: existing.content?.length ?? 0,
            charCountAfter: updated.content?.length ?? 0,
            headingCountBefore: existingHeadings.length,
            headingCountAfter: updatedHeadings.length,
            headingTextChanged:
              existingHeadings.length !== updatedHeadings.length ||
              existingHeadings.some((t, i) => t !== updatedHeadings[i]),
          };
          const logUpdate = appendDocChangeEvent(n, {
            type: 'updated',
            docId,
            docName: updated.name,
            timestamp: Date.now(),
            magnitude,
          });
          return {
            ...n,
            documents: n.documents.map((d) => (d.id === docId ? updated : d)),
            ...logUpdate,
            lastModifiedAt: Date.now(),
          };
        }),
      );
    },
    [selectedNuggetId],
  );

  const removeNuggetDocument = useCallback(
    (docId: string) => {
      if (!selectedNuggetId) return;
      setNuggets((prev) =>
        prev.map((n) => {
          if (n.id !== selectedNuggetId) return n;
          const doc = n.documents.find((d) => d.id === docId);
          const logUpdate = appendDocChangeEvent(n, {
            type: 'removed',
            docId,
            docName: doc?.name || 'Unknown',
            timestamp: Date.now(),
          });
          return {
            ...n,
            documents: n.documents.filter((d) => d.id !== docId),
            ...logUpdate,
            lastModifiedAt: Date.now(),
          };
        }),
      );
    },
    [selectedNuggetId],
  );

  const renameNuggetDocument = useCallback(
    (docId: string, newName: string) => {
      if (!selectedNuggetId) return;
      setNuggets((prev) =>
        prev.map((n) => {
          if (n.id !== selectedNuggetId) return n;
          const doc = n.documents.find((d) => d.id === docId);
          const logUpdate = appendDocChangeEvent(n, {
            type: 'renamed',
            docId,
            docName: newName,
            oldName: doc?.name,
            timestamp: Date.now(),
          });
          return {
            ...n,
            documents: n.documents.map((d) =>
              d.id === docId ? { ...d, name: newName, lastRenamedAt: Date.now(), version: (d.version ?? 1) + 1 } : d,
            ),
            ...logUpdate,
            lastModifiedAt: Date.now(),
          };
        }),
      );
    },
    [selectedNuggetId],
  );

  const toggleNuggetDocument = useCallback(
    (docId: string) => {
      if (!selectedNuggetId) return;
      // Capture current state before toggle
      const nugget = nuggets.find((n) => n.id === selectedNuggetId);
      const doc = nugget?.documents.find((d) => d.id === docId);
      const wasEnabled = doc?.enabled !== false;

      setNuggets((prev) =>
        prev.map((n) => {
          if (n.id !== selectedNuggetId) return n;
          const logUpdate = appendDocChangeEvent(n, {
            type: wasEnabled ? 'disabled' : 'enabled',
            docId,
            docName: doc?.name || 'Unknown',
            timestamp: Date.now(),
          });
          return {
            ...n,
            documents: n.documents.map((d) =>
              d.id === docId
                ? {
                    ...d,
                    enabled: !(d.enabled !== false),
                    ...(wasEnabled ? { lastDisabledAt: Date.now() } : { lastEnabledAt: Date.now() }),
                  }
                : d,
            ),
            ...logUpdate,
            lastModifiedAt: Date.now(),
          };
        }),
      );
    },
    [selectedNuggetId, nuggets, appendDocChangeEvent],
  );

  // ── Sources Log management operations (operate on checkpoint entries, not raw events) ──

  const deleteDocChangeLogEntry = useCallback(
    (entrySeq: number) => {
      if (!selectedNuggetId) return;
      setNuggets((prev) =>
        prev.map((n) => {
          if (n.id !== selectedNuggetId) return n;
          const log = (n.sourcesLog || []).filter((e) => e.seq !== entrySeq);
          const removed = (n.sourcesLog || []).length - log.length;
          if (removed === 0) return n;
          const stats = getDefaultStats(n);
          stats.logsDeleted += removed;
          return {
            ...n,
            sourcesLog: log,
            sourcesLogStats: stats,
            lastModifiedAt: Date.now(),
          };
        }),
      );
    },
    [selectedNuggetId],
  );

  const deleteAllDocChangeLogEntries = useCallback(() => {
    if (!selectedNuggetId) return;
    setNuggets((prev) =>
      prev.map((n) => {
        if (n.id !== selectedNuggetId) return n;
        const count = (n.sourcesLog || []).length;
        if (count === 0) return n;
        const stats = getDefaultStats(n);
        stats.logsDeleted += count;
        return {
          ...n,
          sourcesLog: [],
          sourcesLogStats: stats,
          lastModifiedAt: Date.now(),
        };
      }),
    );
  }, [selectedNuggetId]);

  const renameDocChangeLogEntry = useCallback(
    (entrySeq: number, newLabel: string) => {
      if (!selectedNuggetId) return;
      setNuggets((prev) =>
        prev.map((n) => {
          if (n.id !== selectedNuggetId) return n;
          return {
            ...n,
            sourcesLog: (n.sourcesLog || []).map((e) =>
              e.seq === entrySeq ? { ...e, userLabel: newLabel } : e,
            ),
            lastModifiedAt: Date.now(),
          };
        }),
      );
    },
    [selectedNuggetId],
  );

  const createLogCheckpoint = useCallback(
    (trigger: SourcesLogTrigger) => {
      if (!selectedNuggetId) return;
      setNuggets((prev) =>
        prev.map((n) => {
          if (n.id !== selectedNuggetId) return n;
          const update = createSourcesLogCheckpoint(n, trigger);
          if (!update) return n; // no pending changes
          return { ...n, ...update, lastModifiedAt: Date.now() };
        }),
      );
    },
    [selectedNuggetId],
  );

  // ── Project helpers ──

  const addProject = useCallback((project: Project) => {
    setProjects((prev) => [...prev, project]);
  }, []);

  const deleteProject = useCallback(
    async (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (project) {
        // Storage-first: clean up all external files across all nuggets
        const nuggetsToDel = project.nuggetIds
          .map((nid) => nuggets.find((n) => n.id === nid))
          .filter((n): n is Nugget => !!n);
        await Promise.allSettled(nuggetsToDel.map((n) => cleanupNuggetExternalFiles(n)));
        // Remove all nuggets from state in a single batch
        const nuggetIdSet = new Set(project.nuggetIds);
        setNuggets((prev) => prev.filter((n) => !nuggetIdSet.has(n.id)));
        if (selectedNuggetId && nuggetIdSet.has(selectedNuggetId)) {
          setSelectedNuggetId(null);
          setSelectionLevel(null);
        }
      }
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    },
    [projects, nuggets, selectedNuggetId],
  );

  const updateProject = useCallback((projectId: string, updater: (p: Project) => Project) => {
    setProjects((prev) => prev.map((p) => (p.id === projectId ? updater(p) : p)));
  }, []);

  const addNuggetToProject = useCallback((projectId: string, nuggetId: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId ? { ...p, nuggetIds: [...p.nuggetIds, nuggetId], lastModifiedAt: Date.now() } : p,
      ),
    );
  }, []);

  const removeNuggetFromProject = useCallback((projectId: string, nuggetId: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? { ...p, nuggetIds: p.nuggetIds.filter((id) => id !== nuggetId), lastModifiedAt: Date.now() }
          : p,
      ),
    );
  }, []);

  // Custom style helpers
  const addCustomStyle = useCallback((style: CustomStyle) => {
    setCustomStyles((prev) => [...prev, style]);
  }, []);

  const updateCustomStyle = useCallback((id: string, updates: Partial<CustomStyle>) => {
    setCustomStyles((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates, lastModifiedAt: Date.now() } : s)));
  }, []);

  const deleteCustomStyle = useCallback((id: string) => {
    setCustomStyles((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const replaceCustomStyles = useCallback((styles: CustomStyle[]) => {
    setCustomStyles(styles);
  }, []);

  // ── Memoized context slices ──

  const themeValue = useMemo(
    () => ({ darkMode, toggleDarkMode }),
    [darkMode, toggleDarkMode],
  );

  const nuggetValue = useMemo(
    () => ({
      nuggets, setNuggets,
      selectedNuggetId, setSelectedNuggetId,
      selectedNugget,
      selectedDocumentId, setSelectedDocumentId,
      selectedDocument,
      addNugget, deleteNugget, updateNugget,
      updateNuggetCard, updateNuggetCards, updateNuggetContentAndCards, appendNuggetMessage,
      addNuggetDocument, updateNuggetDocument, removeNuggetDocument, renameNuggetDocument, toggleNuggetDocument,
      deleteDocChangeLogEntry, deleteAllDocChangeLogEntries, renameDocChangeLogEntry, createLogCheckpoint,
    }),
    [
      nuggets, selectedNuggetId, selectedNugget, selectedDocumentId, selectedDocument,
      addNugget, deleteNugget, updateNugget,
      updateNuggetCard, updateNuggetCards, updateNuggetContentAndCards, appendNuggetMessage,
      addNuggetDocument, updateNuggetDocument, removeNuggetDocument, renameNuggetDocument, toggleNuggetDocument,
      deleteDocChangeLogEntry, deleteAllDocChangeLogEntries, renameDocChangeLogEntry, createLogCheckpoint,
    ],
  );

  const projectValue = useMemo(
    () => ({
      projects, setProjects,
      addProject, deleteProject, updateProject,
      addNuggetToProject, removeNuggetFromProject,
    }),
    [projects, addProject, deleteProject, updateProject, addNuggetToProject, removeNuggetFromProject],
  );

  const selectionValue = useMemo(
    () => ({
      activeCardId, setActiveCardId, activeCard,
      selectedProjectId,
      selectionLevel, setSelectionLevel,
      selectEntity,
    }),
    [activeCardId, activeCard, selectedProjectId, selectionLevel, selectEntity],
  );

  const styleValue = useMemo(
    () => ({
      customStyles,
      addCustomStyle, updateCustomStyle, deleteCustomStyle, replaceCustomStyles,
    }),
    [customStyles, addCustomStyle, updateCustomStyle, deleteCustomStyle, replaceCustomStyles],
  );

  // ── Minimal remainder (members not in any focused context) ──

  const remainderValue = useMemo<AppContextRemainder>(
    () => ({
      openProjectId,
      setOpenProjectId,
      initialTokenUsageTotals: initialState?.tokenUsageTotals,
    }),
    [openProjectId, initialState?.tokenUsageTotals],
  );

  return (
    <ThemeContext.Provider value={themeValue}>
      <ProjectContext.Provider value={projectValue}>
        <NuggetContext.Provider value={nuggetValue}>
          <SelectionContext.Provider value={selectionValue}>
            <StyleContext.Provider value={styleValue}>
              <AppContext.Provider value={remainderValue}>{children}</AppContext.Provider>
            </StyleContext.Provider>
          </SelectionContext.Provider>
        </NuggetContext.Provider>
      </ProjectContext.Provider>
    </ThemeContext.Provider>
  );
};
