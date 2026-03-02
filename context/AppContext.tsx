import React, { createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react';
import {
  UploadedFile,
  Card,
  Nugget,
  Project,
  InitialPersistedState,
  ChatMessage,
  DocChangeEvent,
  CustomStyle,
  CardItem,
} from '../types';
import { findCard, flattenCards, mapCardById, mapCards } from '../utils/cardUtils';
import { deleteFromFilesAPI } from '../utils/ai';
import { ThemeContext, useThemeContext } from './ThemeContext';
import { NuggetContext, useNuggetContext } from './NuggetContext';
import { ProjectContext, useProjectContext } from './ProjectContext';
import { SelectionContext, useSelectionContext } from './SelectionContext';
import { StyleContext, useStyleContext } from './StyleContext';

// ── Context shape ──
interface AppContextValue {
  // Core state
  isProjectsPanelOpen: boolean;
  setIsProjectsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
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
  deleteNugget: (nuggetId: string) => void;
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
  deleteProject: (projectId: string) => void;
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
  isProjectsPanelOpen: boolean;
  setIsProjectsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
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
  const [isProjectsPanelOpen, setIsProjectsPanelOpen] = useState(true);
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
    (nuggetId: string) => {
      // Clean up Files API files for all documents in this nugget
      setNuggets((prev) => {
        const nugget = prev.find((n) => n.id === nuggetId);
        if (nugget) {
          for (const doc of nugget.documents) {
            if (doc.fileId) deleteFromFilesAPI(doc.fileId);
          }
        }
        return prev.filter((n) => n.id !== nuggetId);
      });
      // Also remove from whichever project contains it
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
    [selectedNuggetId],
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
      const event: DocChangeEvent = { type: 'added', docId: doc.id, docName: doc.name, timestamp: Date.now() };
      setNuggets((prev) =>
        prev.map((n) =>
          n.id === selectedNuggetId
            ? {
                ...n,
                documents: [...n.documents, doc],
                docChangeLog: [...(n.docChangeLog || []), event],
                lastModifiedAt: Date.now(),
              }
            : n,
        ),
      );
    },
    [selectedNuggetId],
  );

  const updateNuggetDocument = useCallback(
    (docId: string, updated: UploadedFile) => {
      if (!selectedNuggetId) return;
      const event: DocChangeEvent = { type: 'updated', docId, docName: updated.name, timestamp: Date.now() };
      setNuggets((prev) =>
        prev.map((n) => {
          if (n.id !== selectedNuggetId) return n;
          // Only log if the doc was already fully processed (skip placeholder→ready transitions)
          const existing = n.documents.find((d) => d.id === docId);
          const shouldLog = existing && existing.status === 'ready' && updated.status === 'ready';
          return {
            ...n,
            documents: n.documents.map((d) => (d.id === docId ? updated : d)),
            ...(shouldLog ? { docChangeLog: [...(n.docChangeLog || []), event] } : {}),
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
          const event: DocChangeEvent = {
            type: 'removed',
            docId,
            docName: doc?.name || 'Unknown',
            timestamp: Date.now(),
          };
          return {
            ...n,
            documents: n.documents.filter((d) => d.id !== docId),
            docChangeLog: [...(n.docChangeLog || []), event],
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
          const event: DocChangeEvent = {
            type: 'renamed',
            docId,
            docName: newName,
            oldName: doc?.name,
            timestamp: Date.now(),
          };
          return {
            ...n,
            documents: n.documents.map((d) =>
              d.id === docId ? { ...d, name: newName, lastRenamedAt: Date.now(), version: (d.version ?? 1) + 1 } : d,
            ),
            docChangeLog: [...(n.docChangeLog || []), event],
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

      const event: DocChangeEvent = {
        type: wasEnabled ? 'disabled' : 'enabled',
        docId,
        docName: doc?.name || 'Unknown',
        timestamp: Date.now(),
      };
      setNuggets((prev) =>
        prev.map((n) =>
          n.id === selectedNuggetId
            ? {
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
                docChangeLog: [...(n.docChangeLog || []), event],
                lastModifiedAt: Date.now(),
              }
            : n,
        ),
      );
    },
    [selectedNuggetId, nuggets],
  );

  // ── Project helpers ──

  const addProject = useCallback((project: Project) => {
    setProjects((prev) => [...prev, project]);
  }, []);

  const deleteProject = useCallback(
    (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (project) {
        // Cascade: delete all nuggets and clean up their Files API files
        for (const nuggetId of project.nuggetIds) {
          setNuggets((prev) => {
            const nugget = prev.find((n) => n.id === nuggetId);
            if (nugget) {
              for (const doc of nugget.documents) {
                if (doc.fileId) deleteFromFilesAPI(doc.fileId);
              }
            }
            return prev.filter((n) => n.id !== nuggetId);
          });
          if (selectedNuggetId === nuggetId) {
            setSelectedNuggetId(null);
            setSelectionLevel(null);
          }
        }
      }
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    },
    [projects, selectedNuggetId],
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
    }),
    [
      nuggets, selectedNuggetId, selectedNugget, selectedDocumentId, selectedDocument,
      addNugget, deleteNugget, updateNugget,
      updateNuggetCard, updateNuggetCards, updateNuggetContentAndCards, appendNuggetMessage,
      addNuggetDocument, updateNuggetDocument, removeNuggetDocument, renameNuggetDocument, toggleNuggetDocument,
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
      isProjectsPanelOpen,
      setIsProjectsPanelOpen,
      openProjectId,
      setOpenProjectId,
      initialTokenUsageTotals: initialState?.tokenUsageTotals,
    }),
    [isProjectsPanelOpen, openProjectId, initialState?.tokenUsageTotals],
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
