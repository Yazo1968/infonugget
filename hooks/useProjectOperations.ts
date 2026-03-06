import { useState, useCallback, useRef, useEffect } from 'react';
import { useNuggetContext } from '../context/NuggetContext';
import { useProjectContext } from '../context/ProjectContext';
import { useSelectionContext } from '../context/SelectionContext';
import { Nugget, Project, UploadedFile, CardItem, isCardFolder, PendingFileUpload } from '../types';
import { getUniqueName } from '../utils/naming';
import { uploadToFilesAPI } from '../utils/ai';
import { processFileToDocument, fileToBase64, base64ToBlob } from '../utils/fileProcessing';
import { flattenBookmarks } from '../utils/pdfBookmarks';
import type { PdfProcessorResult } from '../components/PdfProcessorModal';
import { useToast } from '../components/ToastNotification';
import { generateSubject } from '../utils/subjectGeneration';
import { RecordUsageFn } from './useTokenUsage';
import { createLogger } from '../utils/logger';

const log = createLogger('ProjectOps');

/** Re-upload a document's content to the Files API, returning a new fileId (or undefined on failure). */
async function reuploadDocToFilesAPI(doc: UploadedFile): Promise<string | undefined> {
  try {
    if (doc.sourceType === 'native-pdf' && doc.pdfBase64) {
      return await uploadToFilesAPI(base64ToBlob(doc.pdfBase64, 'application/pdf'), doc.name, 'application/pdf');
    } else if (doc.content) {
      return await uploadToFilesAPI(doc.content, doc.name, 'text/plain');
    }
  } catch (err) {
    log.warn('Files API re-upload failed for', doc.name, err);
  }
  return undefined;
}

/** Deep-clone a CardItem[], giving each card and folder a new ID. */
function cloneCardItems(items: CardItem[]): CardItem[] {
  return items.map((item) =>
    isCardFolder(item)
      ? {
          ...item,
          id: crypto.randomUUID(),
          cards: item.cards.map((c) => ({
            ...c,
            id: `card-${Math.random().toString(36).substr(2, 9)}`,
          })),
        }
      : { ...item, id: `card-${Math.random().toString(36).substr(2, 9)}` }
  );
}

/** Ref bridge: askPdfProcessor from useDocumentOperations, set in App.tsx after both hooks are created. */
export type AskPdfProcessorFn = (pdfBase64: string, fileName: string) => Promise<PdfProcessorResult | 'cancel' | 'discard' | 'convert-to-markdown'>;

export interface UseProjectOperationsParams {
  recordUsage: RecordUsageFn;
  askPdfProcessorRef?: React.RefObject<AskPdfProcessorFn | null>;
}

/**
 * Project & nugget operations — creation, duplication, copy/move, subject management.
 * Extracted from App.tsx for domain separation (item 4.2).
 */
export function useProjectOperations({ recordUsage, askPdfProcessorRef }: UseProjectOperationsParams) {
  const { nuggets, addNugget, updateNugget, setSelectedNuggetId } = useNuggetContext();
  const { projects, setProjects, addProject, addNuggetToProject, removeNuggetFromProject } = useProjectContext();
  const { setSelectionLevel } = useSelectionContext();

  const { addToast } = useToast();

  // ── Nugget modal state ──
  const [showNuggetCreation, setShowNuggetCreation] = useState(false);
  const [nuggetCreationProjectId, setNuggetCreationProjectId] = useState<string | null>(null);

  // ── Project modal state ──
  const [showProjectCreation, setShowProjectCreation] = useState(false);
  const [projectCreationChainToNugget, setProjectCreationChainToNugget] = useState(false);

  // ── Subject regeneration state ──
  const [isRegeneratingSubject, setIsRegeneratingSubject] = useState(false);

  // ── Subject auto-generation on first upload ──
  const pendingSubjectGenRef = useRef<string | null>(null); // nuggetId awaiting subject gen
  const subjectGenDocIdsRef = useRef<Set<string>>(new Set()); // doc IDs to wait for

  // ── Cross-hook communication: let useDocumentOperations trigger subject auto-gen ──
  const setSubjectGenPending = useCallback((nuggetId: string, docIds: string[]) => {
    pendingSubjectGenRef.current = nuggetId;
    subjectGenDocIdsRef.current = new Set(docIds);
  }, []);

  // ── Nugget creation ──

  const handleCreateNugget = useCallback(
    (nugget: Nugget, pendingFiles?: PendingFileUpload[]) => {
      addNugget(nugget);
      setSelectedNuggetId(nugget.id);
      setSelectionLevel('nugget');
      // Add to target project if specified
      if (nuggetCreationProjectId) {
        addNuggetToProject(nuggetCreationProjectId, nugget.id);
        setNuggetCreationProjectId(null);
      }

      // If pending files are provided, process them in background and update nugget via updateNugget
      // (uses explicit nuggetId — safe for async, no selectedNuggetId dependency)
      if (pendingFiles && pendingFiles.length > 0) {
        // Track for subject auto-generation once all docs are ready
        pendingSubjectGenRef.current = nugget.id;
        subjectGenDocIdsRef.current = new Set(pendingFiles.map((pf) => pf.placeholderId));

        // Separate markdown files (parallel) from native-PDFs (sequential with modal)
        const mdPending = pendingFiles.filter((pf) => pf.mode === 'markdown');
        const pdfPending = pendingFiles.filter((pf) => pf.mode === 'native-pdf');

        // Process markdown files in parallel (fire-and-forget)
        for (const pf of mdPending) {
          (async () => {
            try {
              let processed = await processFileToDocument(pf.file, pf.placeholderId);
              if (processed.content) {
                try {
                  const fileId = await uploadToFilesAPI(processed.content, pf.file.name, 'text/plain');
                  processed = { ...processed, fileId };
                } catch (err) {
                  log.warn('Files API upload failed (will use inline fallback):', err);
                }
              }
              updateNugget(nugget.id, (n) => ({
                ...n,
                documents: n.documents.map((d) => (d.id === pf.placeholderId ? processed : d)),
                lastModifiedAt: Date.now(),
              }));
            } catch (err) {
              log.error(`Processing failed for ${pf.file.name}:`, err);
              updateNugget(nugget.id, (n) => ({
                ...n,
                documents: n.documents.map((d) => (d.id === pf.placeholderId ? { ...d, status: 'error' as const } : d)),
              }));
              addToast({
                type: 'error',
                message: `Failed to process "${pf.file.name}"`,
                detail: err instanceof Error ? err.message : 'An unexpected error occurred.',
                duration: 10000,
              });
            }
          })();
        }

        // Process native-PDF files sequentially — each opens PdfProcessorModal for Gemini analysis
        if (pdfPending.length > 0) {
          (async () => {
            for (const pf of pdfPending) {
              try {
                const pdfBase64 = await fileToBase64(pf.file);

                // Update placeholder so it's visible as processing
                updateNugget(nugget.id, (n) => ({
                  ...n,
                  documents: n.documents.map((d) =>
                    d.id === pf.placeholderId
                      ? { ...d, sourceType: 'native-pdf' as const, pdfBase64, status: 'processing' as const }
                      : d,
                  ),
                }));

                // Open PdfProcessorModal via ref bridge
                const askPdfProcessor = askPdfProcessorRef?.current;
                if (!askPdfProcessor) {
                  // Fallback: store directly without bookmarks (ref not wired yet — shouldn't happen)
                  let pdfFileId: string | undefined;
                  try {
                    pdfFileId = await uploadToFilesAPI(base64ToBlob(pdfBase64, 'application/pdf'), pf.file.name, 'application/pdf');
                  } catch { /* best-effort */ }
                  updateNugget(nugget.id, (n) => ({
                    ...n,
                    documents: n.documents.map((d) =>
                      d.id === pf.placeholderId
                        ? { ...d, status: 'ready' as const, progress: 100, bookmarks: [], bookmarkSource: 'manual' as const, structure: [], fileId: pdfFileId, createdAt: Date.now(), originalName: pf.file.name, version: 1, sourceOrigin: { type: 'uploaded' as const, timestamp: Date.now() } }
                        : d,
                    ),
                    lastModifiedAt: Date.now(),
                  }));
                  continue;
                }

                const result = await askPdfProcessor(pdfBase64, pf.file.name);

                if (result === 'discard' || result === 'cancel') {
                  // Remove document from the nugget + remove from subject tracking
                  updateNugget(nugget.id, (n) => ({
                    ...n,
                    documents: n.documents.filter((d) => d.id !== pf.placeholderId),
                    lastModifiedAt: Date.now(),
                  }));
                  subjectGenDocIdsRef.current.delete(pf.placeholderId);
                } else if (result === 'convert-to-markdown') {
                  // Reset to markdown mode and re-process
                  updateNugget(nugget.id, (n) => ({
                    ...n,
                    documents: n.documents.map((d) =>
                      d.id === pf.placeholderId
                        ? { ...d, sourceType: 'markdown' as const, pdfBase64: undefined, bookmarks: undefined, bookmarkSource: undefined, structure: [], status: 'processing' as const, progress: 0 }
                        : d,
                    ),
                  }));
                  try {
                    let processed = await processFileToDocument(pf.file, pf.placeholderId);
                    if (processed.content) {
                      try {
                        const fileId = await uploadToFilesAPI(processed.content, pf.file.name, 'text/plain');
                        processed = { ...processed, fileId };
                      } catch { /* best-effort */ }
                    }
                    updateNugget(nugget.id, (n) => ({
                      ...n,
                      documents: n.documents.map((d) => (d.id === pf.placeholderId ? processed : d)),
                      lastModifiedAt: Date.now(),
                    }));
                  } catch (err) {
                    updateNugget(nugget.id, (n) => ({
                      ...n,
                      documents: n.documents.map((d) => (d.id === pf.placeholderId ? { ...d, status: 'error' as const } : d)),
                    }));
                  }
                } else {
                  // Accept with bookmarks — upload to Files API and commit
                  const { pdfBase64: processedBase64, bookmarks, bookmarkSource } = result;
                  let pdfFileId: string | undefined;
                  try {
                    pdfFileId = await uploadToFilesAPI(base64ToBlob(processedBase64, 'application/pdf'), pf.file.name, 'application/pdf');
                  } catch (err) {
                    log.warn('Native PDF Files API upload failed:', err);
                  }
                  const structure = bookmarks.length > 0 ? flattenBookmarks(bookmarks) : [];
                  updateNugget(nugget.id, (n) => ({
                    ...n,
                    documents: n.documents.map((d) =>
                      d.id === pf.placeholderId
                        ? {
                            ...d,
                            pdfBase64: processedBase64,
                            bookmarks,
                            bookmarkSource,
                            structure,
                            status: 'ready' as const,
                            progress: 100,
                            createdAt: Date.now(),
                            originalName: pf.file.name,
                            version: 1,
                            sourceOrigin: { type: 'uploaded' as const, timestamp: Date.now() },
                            fileId: pdfFileId,
                          }
                        : d,
                    ),
                    lastModifiedAt: Date.now(),
                  }));
                }
              } catch (err) {
                log.error(`Processing failed for ${pf.file.name}:`, err);
                updateNugget(nugget.id, (n) => ({
                  ...n,
                  documents: n.documents.map((d) => (d.id === pf.placeholderId ? { ...d, status: 'error' as const } : d)),
                }));
                addToast({
                  type: 'error',
                  message: `Failed to process "${pf.file.name}"`,
                  detail: err instanceof Error ? err.message : 'An unexpected error occurred.',
                  duration: 10000,
                });
              }
            }
          })();
        }
      } else {
        // No pending files — docs are already ready (shouldn't happen with new flow, but defensive)
        const readyDocs = nugget.documents.filter(
          (d) => d.status === 'ready' && (d.content || d.fileId || d.pdfBase64),
        );
        if (readyDocs.length > 0 && !nugget.subject) {
          (async () => {
            try {
              const subject = await generateSubject(readyDocs, recordUsage);
              updateNugget(nugget.id, (n) => ({ ...n, subject, lastModifiedAt: Date.now() }));
              addToast({
                type: 'info',
                message: `Subject: ${subject}`,
                detail: 'Edit via Sources Manager > Subject',
                duration: 8000,
              });
            } catch (err) {
              log.warn('Subject auto-generation failed for new nugget:', err);
              addToast({
                type: 'warning',
                message: 'Could not auto-generate subject',
                detail: 'You can set it manually via Sources Manager > Subject.',
                duration: 8000,
              });
            }
          })();
        }
      }
    },
    [addNugget, setSelectedNuggetId, nuggetCreationProjectId, addNuggetToProject, updateNugget, recordUsage, addToast, setSelectionLevel],
  );

  // ── Project creation ──

  const handleCreateProject = useCallback(
    (name: string, description: string): string => {
      const now = Date.now();
      const id = `project-${now}-${Math.random().toString(36).substr(2, 9)}`;
      const project: Project = {
        id,
        name,
        description: description || undefined,
        nuggetIds: [],
        createdAt: now,
        lastModifiedAt: now,
      };
      addProject(project);
      return id;
    },
    [addProject],
  );

  // ── Copy nugget to project ──

  const handleCopyNuggetToProject = useCallback(
    async (nuggetId: string, targetProjectId: string) => {
      const nugget = nuggets.find((n) => n.id === nuggetId);
      if (!nugget) return;
      const now = Date.now();
      const newNuggetId = `nugget-${now}-${Math.random().toString(36).substr(2, 9)}`;
      // Get existing nugget names in the target project for dedup
      const targetProject = projects.find((p) => p.id === targetProjectId);
      const targetNuggetNames = targetProject
        ? targetProject.nuggetIds.map((nid) => nuggets.find((n) => n.id === nid)?.name || '').filter(Boolean)
        : [];
      // Re-upload documents to Files API so each copy gets its own fileId
      const clonedDocs = await Promise.all(
        nugget.documents.map(async (d) => {
          const newFileId = d.fileId ? await reuploadDocToFilesAPI(d) : undefined;
          return { ...d, id: `doc-${Math.random().toString(36).substr(2, 9)}`, fileId: newFileId };
        }),
      );
      const copiedNugget: Nugget = {
        ...nugget,
        id: newNuggetId,
        name: getUniqueName(`${nugget.name} (copy)`, targetNuggetNames),
        documents: clonedDocs,
        cards: cloneCardItems(nugget.cards),
        messages: [...(nugget.messages || [])],
        createdAt: now,
        lastModifiedAt: now,
      };
      addNugget(copiedNugget);
      addNuggetToProject(targetProjectId, newNuggetId);
    },
    [nuggets, projects, addNugget, addNuggetToProject],
  );

  // ── Duplicate project ──

  const handleDuplicateProject = useCallback(
    async (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;
      const now = Date.now();
      const newProjectId = `project-${now}-${Math.random().toString(36).substr(2, 9)}`;
      const newNuggetIds: string[] = [];

      // Deep-clone each nugget, re-uploading documents to Files API
      for (const nuggetId of project.nuggetIds) {
        const nugget = nuggets.find((n) => n.id === nuggetId);
        if (!nugget) continue;
        const newNuggetId = `nugget-${now}-${Math.random().toString(36).substr(2, 9)}-${newNuggetIds.length}`;
        const clonedDocs = await Promise.all(
          nugget.documents.map(async (d) => {
            const newFileId = d.fileId ? await reuploadDocToFilesAPI(d) : undefined;
            return { ...d, id: `doc-${Math.random().toString(36).substr(2, 9)}`, fileId: newFileId };
          }),
        );
        const copiedNugget: Nugget = {
          ...nugget,
          id: newNuggetId,
          name: nugget.name, // keep same name — it's in a different project
          documents: clonedDocs,
          cards: cloneCardItems(nugget.cards),
          messages: [...(nugget.messages || [])],
          createdAt: now,
          lastModifiedAt: now,
        };
        addNugget(copiedNugget);
        newNuggetIds.push(newNuggetId);
      }

      // Create the new project with cloned nugget IDs
      const newProject: Project = {
        id: newProjectId,
        name: getUniqueName(
          `${project.name} (copy)`,
          projects.map((p) => p.name),
        ),
        description: project.description,
        nuggetIds: newNuggetIds,
        createdAt: now,
        lastModifiedAt: now,
      };
      addProject(newProject);
    },
    [nuggets, projects, addNugget, addProject],
  );

  // ── Move nugget to project ──

  const handleMoveNuggetToProject = useCallback(
    (nuggetId: string, sourceProjectId: string, targetProjectId: string) => {
      // Auto-rename if name collides in target project
      const nugget = nuggets.find((n) => n.id === nuggetId);
      if (nugget) {
        const targetProject = projects.find((p) => p.id === targetProjectId);
        const targetNuggetNames = targetProject
          ? targetProject.nuggetIds.map((nid) => nuggets.find((n) => n.id === nid)?.name || '').filter(Boolean)
          : [];
        const uniqueName = getUniqueName(nugget.name, targetNuggetNames);
        if (uniqueName !== nugget.name) {
          updateNugget(nuggetId, (n) => ({ ...n, name: uniqueName, lastModifiedAt: Date.now() }));
        }
      }
      removeNuggetFromProject(sourceProjectId, nuggetId);
      addNuggetToProject(targetProjectId, nuggetId);
    },
    [nuggets, projects, removeNuggetFromProject, addNuggetToProject, updateNugget],
  );

  // ── Create project for nugget (copy or move) ──

  const handleCreateProjectForNugget = useCallback(
    async (nuggetId: string, projectName: string, mode: 'copy' | 'move', sourceProjectId: string) => {
      const now = Date.now();
      const newProjectId = `project-${now}-${Math.random().toString(36).substr(2, 9)}`;
      // Auto-increment project name if it already exists
      const uniqueProjectName = getUniqueName(
        projectName,
        projects.map((p) => p.name),
      );

      if (mode === 'move') {
        // Move: create project with the nuggetId already included, remove from source
        const newProject: Project = {
          id: newProjectId,
          name: uniqueProjectName,
          nuggetIds: [nuggetId],
          createdAt: now,
          lastModifiedAt: now,
        };
        // Single setProjects call: add new project + remove nugget from source
        setProjects((prev) => [
          ...prev.map((p) =>
            p.id === sourceProjectId
              ? { ...p, nuggetIds: p.nuggetIds.filter((id) => id !== nuggetId), lastModifiedAt: now }
              : p,
          ),
          newProject,
        ]);
      } else {
        // Copy: duplicate the nugget, re-upload documents to Files API
        const nugget = nuggets.find((n) => n.id === nuggetId);
        if (!nugget) return;
        const newNuggetId = `nugget-${now}-${Math.random().toString(36).substr(2, 9)}`;
        const clonedDocs = await Promise.all(
          nugget.documents.map(async (d) => {
            const newFileId = d.fileId ? await reuploadDocToFilesAPI(d) : undefined;
            return { ...d, id: `doc-${Math.random().toString(36).substr(2, 9)}`, fileId: newFileId };
          }),
        );
        const copiedNugget: Nugget = {
          ...nugget,
          id: newNuggetId,
          name: `${nugget.name} (copy)`,
          documents: clonedDocs,
          cards: cloneCardItems(nugget.cards),
          messages: [...(nugget.messages || [])],
          createdAt: now,
          lastModifiedAt: now,
        };
        const newProject: Project = {
          id: newProjectId,
          name: uniqueProjectName,
          nuggetIds: [newNuggetId],
          createdAt: now,
          lastModifiedAt: now,
        };
        addNugget(copiedNugget);
        setProjects((prev) => [...prev, newProject]);
      }
    },
    [nuggets, projects, addNugget, setProjects],
  );

  // ── Subject modal handlers ──

  const handleSaveSubject = useCallback(
    (nuggetId: string, subject: string) => {
      updateNugget(nuggetId, (n) => ({ ...n, subject, subjectReviewNeeded: false, lastModifiedAt: Date.now() }));
    },
    [updateNugget],
  );

  const handleRegenerateSubject = useCallback(
    async (nuggetId: string) => {
      const nugget = nuggets.find((n) => n.id === nuggetId);
      if (!nugget) return;
      const readyDocs = nugget.documents.filter((d) => d.status === 'ready' && (d.content || d.fileId || d.pdfBase64));
      if (readyDocs.length === 0) {
        addToast({
          type: 'warning',
          message: 'No processed documents available to generate subject from.',
          duration: 6000,
        });
        return;
      }
      setIsRegeneratingSubject(true);
      try {
        const subject = await generateSubject(readyDocs, recordUsage);
        updateNugget(nuggetId, (n) => ({ ...n, subject, subjectReviewNeeded: false, lastModifiedAt: Date.now() }));
        addToast({ type: 'success', message: 'Subject regenerated successfully.', duration: 4000 });
      } catch (err) {
        log.warn('Subject regeneration failed:', err);
        addToast({
          type: 'error',
          message: 'Failed to regenerate subject.',
          detail: err instanceof Error ? err.message : 'Unknown error',
          duration: 8000,
        });
      } finally {
        setIsRegeneratingSubject(false);
      }
    },
    [nuggets, updateNugget, recordUsage, addToast],
  );

  // ── Subject auto-generation watcher ──
  // Watches nuggets state; when all tracked docs reach 'ready', triggers generation
  useEffect(() => {
    const nuggetId = pendingSubjectGenRef.current;
    if (!nuggetId) return;
    const trackedIds = subjectGenDocIdsRef.current;
    if (trackedIds.size === 0) return;

    const nugget = nuggets.find((n) => n.id === nuggetId);
    if (!nugget) {
      pendingSubjectGenRef.current = null;
      return;
    }

    // Check if all tracked docs have finished processing (ready or error)
    const allDone = [...trackedIds].every((docId) => {
      const doc = nugget.documents.find((d) => d.id === docId);
      return doc && (doc.status === 'ready' || doc.status === 'error');
    });
    if (!allDone) return;

    // All done — clear refs and trigger generation
    pendingSubjectGenRef.current = null;
    subjectGenDocIdsRef.current = new Set();

    // Use ALL ready docs in the nugget (not just the batch) so subject covers the full document set
    const allReadyDocs = nugget.documents.filter((d) => d.status === 'ready' && (d.content || d.fileId || d.pdfBase64));
    if (allReadyDocs.length === 0) {
      addToast({
        type: 'warning',
        message: 'Could not generate subject — no documents processed successfully.',
        duration: 6000,
      });
      return;
    }

    (async () => {
      try {
        const subject = await generateSubject(allReadyDocs, recordUsage);
        updateNugget(nuggetId, (n) => ({ ...n, subject, lastModifiedAt: Date.now() }));
        addToast({
          type: 'info',
          message: `Subject: ${subject}`,
          detail: 'Edit via Sources Manager > Subject',
          duration: 8000,
        });
      } catch (err) {
        log.warn('Subject auto-generation failed:', err);
        addToast({
          type: 'warning',
          message: 'Could not auto-generate subject',
          detail: 'You can set it manually via Sources Manager > Subject.',
          duration: 8000,
        });
      }
    })();
  }, [nuggets, updateNugget, recordUsage, addToast]);

  return {
    // Nugget modal state
    showNuggetCreation,
    setShowNuggetCreation,
    nuggetCreationProjectId,
    setNuggetCreationProjectId,
    // Project modal state
    showProjectCreation,
    setShowProjectCreation,
    projectCreationChainToNugget,
    setProjectCreationChainToNugget,
    // Subject regeneration state
    isRegeneratingSubject,
    // Callbacks
    handleCreateNugget,
    handleCreateProject,
    handleCopyNuggetToProject,
    handleDuplicateProject,
    handleMoveNuggetToProject,
    handleCreateProjectForNugget,
    handleSaveSubject,
    handleRegenerateSubject,
    // Cross-hook communication
    setSubjectGenPending,
  };
}
