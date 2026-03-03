import React, { useState, useEffect } from 'react';
import { createLogger } from '../utils/logger';
import { UploadedFile, InsightsSession, Nugget, Project, InitialPersistedState, CustomStyle } from '../types';

const log = createLogger('Storage');
import { AppProvider, useAppContext } from '../context/AppContext';
import { useNuggetContext } from '../context/NuggetContext';
import { useProjectContext } from '../context/ProjectContext';
import { useSelectionContext } from '../context/SelectionContext';
import { useStyleContext } from '../context/StyleContext';
import { IndexedDBBackend } from '../utils/storage/IndexedDBBackend';
import { SupabaseBackend } from '../utils/storage/SupabaseBackend';
import { StorageBackend } from '../utils/storage/StorageBackend';
import {
  deserializeFile,
  deserializeCard,
  deserializeCardItems,
  deserializeNugget,
  deserializeNuggetDocument,
  deserializeProject,
  serializeCard,
  serializeNugget,
  serializeNuggetDocument,
  serializeProject,
  extractImages,
} from '../utils/storage/serialize';
import { usePersistence } from '../hooks/usePersistence';
import { LoadingScreen } from './LoadingScreen';
import { useAuth } from '../context/AuthContext';

// ── Storage instance (set dynamically based on auth state) ──

let _storage: StorageBackend = new IndexedDBBackend();

export function getStorage(): StorageBackend {
  return _storage;
}

// Legacy export for backward compatibility (App.tsx imports this)
export { _storage as storage };

// ── Persistence connector (auto-save, renders nothing) ──

const PersistenceConnector: React.FC = () => {
  const { nuggets, selectedNuggetId, selectedDocumentId } = useNuggetContext();
  const { projects } = useProjectContext();
  const { activeCardId, selectedProjectId } = useSelectionContext();
  const { customStyles } = useStyleContext();
  const { openProjectId } = useAppContext();

  usePersistence({
    storage: _storage,
    activeCardId,
    nuggets,
    projects,
    selectedNuggetId,
    selectedDocumentId,
    selectedProjectId,
    openProjectId,
    customStyles,
  });

  return null;
};

// ── Startup integrity check: clean up orphaned data ──

async function cleanupOrphanedData(storageBackend: StorageBackend, hydratedNuggetIds: Set<string>): Promise<void> {
  try {
    // Find nugget IDs in storage that weren't hydrated (orphans from crash/incomplete save)
    const storedNuggetIds = await storageBackend.loadAllNuggetIds();
    let orphanCount = 0;
    for (const id of storedNuggetIds) {
      if (!hydratedNuggetIds.has(id)) {
        log.warn('Cleaning up orphaned nugget:', id);
        await storageBackend.deleteNugget(id);
        await storageBackend.deleteNuggetDocuments(id);
        await storageBackend.deleteNuggetHeadings(id);
        await storageBackend.deleteNuggetImages(id);
        orphanCount++;
      }
    }
    if (orphanCount > 0) {
      log.log(`Cleaned up ${orphanCount} orphaned nugget(s)`);
    }

    // Belt and suspenders: clear any remaining legacy store data
    await storageBackend.clearLegacyStores();
  } catch (err) {
    // Non-fatal — log and continue, don't block app startup
    log.warn('Orphan cleanup failed (non-fatal):', err);
  }
}

// ── Hydration logic ──

async function hydrateFromStorage(): Promise<InitialPersistedState | null> {
  const storage = _storage;
  await storage.init();

  // Load from all stores in parallel
  const [
    appState,
    storedFiles,
    insightsSessionData,
    insightsDocs,
    insightsHeadingsStored,
    insightsImagesStored,
    storedNuggets,
    storedProjects,
    storedTokenUsage,
    storedCustomStyles,
  ] = await Promise.all([
    storage.loadAppState(),
    storage.loadFiles(),
    storage.loadInsightsSession(),
    storage.loadInsightsDocs(),
    storage.loadInsightsHeadings(),
    storage.loadInsightsImages(),
    storage.loadNuggets(),
    storage.loadProjects(),
    storage.loadTokenUsage(),
    storage.loadCustomStyles(),
  ]);

  log.log('Raw stores:', {
    storedNuggets: storedNuggets.length,
    storedProjects: storedProjects.length,
    storedFiles: storedFiles.length,
    hasInsightsSession: !!insightsSessionData,
  });

  // Reconstitute insights session (legacy stores)
  let insightsSession: InsightsSession | null = null;
  if (insightsSessionData) {
    const iHeadings = insightsHeadingsStored.map((sh) => deserializeCard(sh, insightsImagesStored));
    insightsSession = {
      id: insightsSessionData.id,
      documents: insightsDocs,
      messages: insightsSessionData.messages,
      cards: iHeadings,
    };
  }

  // Reconstitute nuggets — load headings, images, and documents per-nugget
  let nuggets: Nugget[] = [];
  for (const sn of storedNuggets) {
    const [headings, images, nuggetDocs] = await Promise.all([
      storage.loadNuggetHeadings(sn.id),
      storage.loadNuggetImages(sn.id),
      storage.loadNuggetDocuments(sn.id),
    ]);
    const hydratedCards = deserializeCardItems(headings, images, sn.folders);
    const hydratedDocs = nuggetDocs.map((sd) => deserializeNuggetDocument(sd));
    nuggets.push(deserializeNugget(sn, hydratedCards, hydratedDocs));
  }

  // ── Runtime migration: v2 data → v3 (documents were in global library, nuggets had documentIds) ──
  const nuggetsNeedDocMigration = nuggets.length > 0 && nuggets.every((n) => n.documents.length === 0);
  if (nuggetsNeedDocMigration) {
    const oldDocuments = await storage.loadDocuments();
    if (oldDocuments.length > 0) {
      log.log(`Migrating v2→v3: ${oldDocuments.length} documents to embed in nuggets`);
      const docMap = new Map(oldDocuments.map((sd) => [sd.id, deserializeFile(sd)]));

      for (const nugget of nuggets) {
        const rawNugget = storedNuggets.find((sn) => sn.id === nugget.id) as any;
        const oldDocIds: string[] = rawNugget?.documentIds ?? [];
        if (oldDocIds.length > 0) {
          nugget.documents = oldDocIds.map((id) => docMap.get(id)).filter((d): d is UploadedFile => d !== undefined);
          for (const doc of nugget.documents) {
            await storage.saveNuggetDocument(serializeNuggetDocument(nugget.id, doc));
          }
          await storage.saveNugget(serializeNugget(nugget));
        }
      }
      log.log(`v2→v3 migration complete`);
    }
  }

  // ── Runtime migration: v1 data (files + insightsSession but no nuggets) → nuggets ──
  if (nuggets.length === 0 && (storedFiles.length > 0 || insightsSession)) {
    const now = Date.now();

    // Migrate old files → insights nuggets (convert synthesis type to insights)
    for (const sf of storedFiles) {
      if (sf.status !== 'ready') continue;
      const [headings, images] = await Promise.all([storage.loadHeadings(sf.id), storage.loadImages(sf.id)]);
      if (headings.length > 0) {
        const hydratedHeadings = headings.map((sh) => deserializeCard(sh, images));
        const file = deserializeFile(sf, hydratedHeadings);
        const nuggetId = `migrated-${sf.id}`;
        const nugget: Nugget = {
          id: nuggetId,
          name: sf.name.replace(/\.\w+$/, ''),
          type: 'insights',
          documents: [file],
          cards: hydratedHeadings,
          messages: [],
          createdAt: now,
          lastModifiedAt: now,
        };
        nuggets.push(nugget);

        await storage.saveNugget(serializeNugget(nugget));
        await storage.saveNuggetDocument(serializeNuggetDocument(nuggetId, file));
        // Legacy migration: cards are always flat Card[], no folders
        const storedH = hydratedHeadings.map((h) => serializeCard(h, nuggetId));
        await storage.saveNuggetHeadings(nuggetId, storedH);
        for (const h of hydratedHeadings) {
          const imgs = extractImages(h, nuggetId);
          for (const img of imgs) {
            await storage.saveNuggetImage(img);
          }
        }
      }
    }

    // Migrate insights session → insights nugget
    if (insightsSession) {
      const nuggetId = `migrated-insights-${insightsSession.id}`;
      const insightsDocs: UploadedFile[] = insightsSession.documents.map((doc) => ({
        id: doc.id,
        name: doc.name,
        size: doc.size,
        type: doc.type === 'pdf' ? 'application/pdf' : 'text/markdown',
        lastModified: now,
        content: doc.content,
        status: 'ready' as const,
        progress: 100,
      }));

      const nugget: Nugget = {
        id: nuggetId,
        name: 'Migrated Insights',
        type: 'insights',
        documents: insightsDocs,
        cards: insightsSession.cards,
        messages: insightsSession.messages,
        createdAt: now,
        lastModifiedAt: now,
      };
      nuggets.push(nugget);

      await storage.saveNugget(serializeNugget(nugget));
      for (const doc of insightsDocs) {
        await storage.saveNuggetDocument(serializeNuggetDocument(nuggetId, doc));
      }
      // Legacy migration: insightsSession.cards is always flat Card[], no folders
      const storedH = insightsSession.cards.map((h) => serializeCard(h, nuggetId));
      await storage.saveNuggetHeadings(nuggetId, storedH);
      for (const h of insightsSession.cards) {
        const imgs = extractImages(h, nuggetId);
        for (const img of imgs) {
          await storage.saveNuggetImage(img);
        }
      }
    }

    log.log(`Migrated v1→v3: ${nuggets.length} nuggets created`);
  }

  // ── Migration: convert any remaining synthesis-type nuggets to insights ──
  for (const nugget of nuggets) {
    if ((nugget.type as string) === 'synthesis') {
      (nugget as any).type = 'insights';
      if (!nugget.messages) nugget.messages = [];
      await storage.saveNugget(serializeNugget(nugget));
    }
  }

  // ── Reconstitute projects ──
  let projects: Project[] = storedProjects.map((sp) => deserializeProject(sp));

  // ── Migration: existing nuggets but no projects → create default project ──
  if (projects.length === 0 && nuggets.length > 0) {
    const now = Date.now();
    const defaultProject: Project = {
      id: `project-${now}-${Math.random().toString(36).substr(2, 9)}`,
      name: 'My Project',
      nuggetIds: nuggets.map((n) => n.id),
      createdAt: now,
      lastModifiedAt: now,
    };
    projects = [defaultProject];
    await storage.saveProject(serializeProject(defaultProject));
    log.log(`Migrated nuggets→project: created default "My Project" with ${nuggets.length} nuggets`);
  }

  // ── Startup integrity check: clean up orphaned data ──
  const hydratedNuggetIds = new Set(nuggets.map((n) => n.id));
  await cleanupOrphanedData(storage, hydratedNuggetIds);

  // Only return state if there's actually data to restore
  if (nuggets.length === 0 && !storedTokenUsage) return null;

  return {
    nuggets,
    projects,
    selectedNuggetId: appState?.selectedNuggetId ?? null,
    selectedDocumentId: appState?.selectedDocumentId ?? null,
    selectedProjectId: appState?.selectedProjectId ?? null,
    activeCardId: appState?.activeCardId ?? null,
    openProjectId: null, // Always land on dashboard; user opens a project explicitly
    workflowMode: 'insights',
    tokenUsageTotals: storedTokenUsage as Record<string, number> | undefined,
    customStyles: (storedCustomStyles as CustomStyle[] | null) ?? undefined,
  };
}

// ── Provider component ──

export const StorageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [initialState, setInitialState] = useState<InitialPersistedState | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    let cancelled = false;

    // Switch to SupabaseBackend when authenticated
    if (user?.id) {
      _storage = new SupabaseBackend(user.id);
      log.log('Using SupabaseBackend for user:', user.id);
    }

    hydrateFromStorage()
      .then((state) => {
        log.log(
          'Hydration result:',
          state ? `${state.nuggets.length} nuggets, ${state.projects.length} projects` : 'null (no data)',
        );
        if (!cancelled) setInitialState(state);
      })
      .catch((err) => {
        log.error('Hydration failed, starting fresh:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <AppProvider initialState={initialState ?? undefined}>
      <PersistenceConnector />
      {children}
    </AppProvider>
  );
};
