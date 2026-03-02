import { useEffect, useRef, useCallback } from 'react';
import { Nugget, Project, CustomStyle } from '../types';
import { StorageBackend, StoredImage } from '../utils/storage/StorageBackend';
import {
  serializeNugget,
  serializeNuggetDocument,
  serializeProject,
  serializeCardItems,
  extractImages,
} from '../utils/storage/serialize';
import { flattenCards } from '../utils/cardUtils';

const APP_STATE_DEBOUNCE_MS = 300;
const DATA_DEBOUNCE_MS = 1500;

interface PersistenceOptions {
  storage: StorageBackend;
  activeCardId: string | null;
  nuggets: Nugget[];
  projects: Project[];
  selectedNuggetId: string | null;
  selectedDocumentId: string | null;
  selectedProjectId: string | null;
  openProjectId: string | null;
  customStyles: CustomStyle[];
}

export function usePersistence({
  storage,
  activeCardId,
  nuggets,
  projects,
  selectedNuggetId,
  selectedDocumentId,
  selectedProjectId,
  openProjectId,
  customStyles,
}: PersistenceOptions): void {
  const appStateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nuggetsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customStylesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track whether initial hydration is done to avoid saving the hydrated state right back
  const hydrationDone = useRef(false);
  useEffect(() => {
    // Skip the first render (which is the hydrated state)
    const timer = setTimeout(() => {
      hydrationDone.current = true;
    }, DATA_DEBOUNCE_MS + 500);
    return () => clearTimeout(timer);
  }, []);

  // Stable reference to latest values for save functions
  const latestRef = useRef({ nuggets, projects, customStyles });
  useEffect(() => {
    latestRef.current = { nuggets, projects, customStyles };
  });

  // ── App state save (lightweight) ──
  useEffect(() => {
    if (!storage.isReady() || !hydrationDone.current) return;
    if (appStateTimer.current) clearTimeout(appStateTimer.current);
    appStateTimer.current = setTimeout(() => {
      storage
        .saveAppState({ selectedNuggetId, selectedDocumentId, selectedProjectId, activeCardId, openProjectId })
        .catch((err) => console.warn('[Persistence] Failed to save app state:', err));
    }, APP_STATE_DEBOUNCE_MS);
    return () => {
      if (appStateTimer.current) clearTimeout(appStateTimer.current);
    };
  }, [selectedNuggetId, selectedDocumentId, selectedProjectId, activeCardId, openProjectId, storage]);

  // ── Nuggets save (includes per-nugget documents) ──
  // Track previous nugget references for dirty detection via object identity
  const prevNuggetsRef = useRef<Map<string, Nugget>>(new Map());

  const saveAllNuggets = useCallback(async () => {
    const { nuggets: currentNuggets } = latestRef.current;
    const prevMap = prevNuggetsRef.current;
    const currentIds = new Set(currentNuggets.map((n) => n.id));

    let savedCount = 0;

    for (const nugget of currentNuggets) {
      // Skip if nugget object reference is unchanged (not dirty)
      if (prevMap.get(nugget.id) === nugget) continue;
      savedCount++;

      // Serialize everything for this nugget
      const storedNugget = serializeNugget(nugget);
      const { headings: storedCards, folders } = serializeCardItems(nugget.cards, nugget.id);
      storedNugget.folders = folders;

      // Collect ALL images for this nugget (flatten folders to get all Card objects)
      const allImages: StoredImage[] = [];
      for (const card of flattenCards(nugget.cards)) {
        allImages.push(...extractImages(card, nugget.id));
      }

      // Collect documents (only ready ones)
      const storedDocs = nugget.documents
        .filter((d) => d.status === 'ready')
        .map((d) => serializeNuggetDocument(nugget.id, d));

      // Atomic save: nugget + headings + images + docs in one transaction
      await storage.saveNuggetDataAtomic(nugget.id, storedNugget, storedCards, allImages, storedDocs);

      // Clean up orphaned documents (outside atomic tx — acceptable, only removes stale data)
      const existingDocs = await storage.loadNuggetDocuments(nugget.id);
      const currentDocIds = new Set(storedDocs.map((d) => d.docId));
      for (const sd of existingDocs) {
        if (!currentDocIds.has(sd.docId)) {
          await storage.deleteNuggetDocument(nugget.id, sd.docId);
        }
      }

      // Clean up orphaned images (deleted from cardUrlMap but still in IndexedDB)
      const storedImages = await storage.loadNuggetImages(nugget.id);
      const currentImageKeys = new Set(allImages.map((img) => `${img.headingId}:${img.level}`));
      for (const img of storedImages) {
        if (!currentImageKeys.has(`${img.headingId}:${img.level}`)) {
          await storage.deleteNuggetImage(nugget.id, img.headingId, img.level);
        }
      }
    }

    // Clean up deleted nuggets (lightweight ID enumeration, no full deserialization)
    const storedNuggetIds = await storage.loadAllNuggetIds();
    for (const id of storedNuggetIds) {
      if (!currentIds.has(id)) {
        await storage.deleteNugget(id);
        await storage.deleteNuggetDocuments(id);
        await storage.deleteNuggetHeadings(id);
        await storage.deleteNuggetImages(id);
      }
    }

    // Update snapshot for next dirty comparison
    prevNuggetsRef.current = new Map(currentNuggets.map((n) => [n.id, n]));
    return savedCount;
  }, [storage]);

  useEffect(() => {
    if (!storage.isReady() || !hydrationDone.current) return;
    if (nuggetsTimer.current) clearTimeout(nuggetsTimer.current);
    nuggetsTimer.current = setTimeout(() => {
      const total = latestRef.current.nuggets.length;
      saveAllNuggets()
        .then((saved) => console.log(`[Persistence] Nuggets saved: ${saved}/${total} dirty`))
        .catch((err) => console.warn('[Persistence] Failed to save nuggets:', err));
    }, DATA_DEBOUNCE_MS);
    return () => {
      if (nuggetsTimer.current) clearTimeout(nuggetsTimer.current);
    };
  }, [nuggets, saveAllNuggets, storage]);

  // ── Projects save ──
  const saveAllProjects = useCallback(async () => {
    const { projects: currentProjects } = latestRef.current;

    for (const project of currentProjects) {
      await storage.saveProject(serializeProject(project));
    }

    // Clean up deleted projects
    const storedProjects = await storage.loadProjects();
    const currentProjectIds = new Set(currentProjects.map((p) => p.id));
    for (const sp of storedProjects) {
      if (!currentProjectIds.has(sp.id)) {
        await storage.deleteProject(sp.id);
      }
    }
  }, [storage]);

  useEffect(() => {
    if (!storage.isReady() || !hydrationDone.current) return;
    if (projectsTimer.current) clearTimeout(projectsTimer.current);
    projectsTimer.current = setTimeout(() => {
      console.log('[Persistence] Saving projects...', latestRef.current.projects.length);
      saveAllProjects()
        .then(() => console.log('[Persistence] Projects saved successfully'))
        .catch((err) => console.warn('[Persistence] Failed to save projects:', err));
    }, DATA_DEBOUNCE_MS);
    return () => {
      if (projectsTimer.current) clearTimeout(projectsTimer.current);
    };
  }, [projects, saveAllProjects, storage]);

  // ── Custom styles save ──
  useEffect(() => {
    if (!storage.isReady() || !hydrationDone.current) return;
    if (customStylesTimer.current) clearTimeout(customStylesTimer.current);
    customStylesTimer.current = setTimeout(() => {
      storage
        .saveCustomStyles(latestRef.current.customStyles)
        .then(() => console.log('[Persistence] Custom styles saved:', latestRef.current.customStyles.length))
        .catch((err) => console.warn('[Persistence] Failed to save custom styles:', err));
    }, APP_STATE_DEBOUNCE_MS);
    return () => {
      if (customStylesTimer.current) clearTimeout(customStylesTimer.current);
    };
  }, [customStyles, storage]);
}
