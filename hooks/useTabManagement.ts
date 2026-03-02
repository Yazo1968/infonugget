import { useState, useCallback, useEffect, useMemo } from 'react';
import type { Nugget } from '../types';
import { useNuggetContext } from '../context/NuggetContext';
import { useProjectContext } from '../context/ProjectContext';
import { useSelectionContext } from '../context/SelectionContext';
import { useAppContext } from '../context/AppContext';

interface UseTabManagementParams {
  handleCreateNugget: (nugget: Nugget) => void;
  handleCopyNuggetToProject: (nuggetId: string, targetProjectId: string) => Promise<void>;
  handleUploadDocuments: (files: FileList) => void;
}

export function useTabManagement({
  handleCreateNugget,
  handleCopyNuggetToProject,
  handleUploadDocuments,
}: UseTabManagementParams) {
  const { nuggets, selectedNuggetId, updateNugget } = useNuggetContext();
  const { projects, addNuggetToProject } = useProjectContext();
  const { selectEntity } = useSelectionContext();
  const { openProjectId } = useAppContext();

  // ── Derived: open project & its nuggets ──
  const openProject = useMemo(
    () => projects.find((p) => p.id === openProjectId) ?? null,
    [projects, openProjectId],
  );

  const allProjectNuggets = useMemo(
    () =>
      (openProject?.nuggetIds ?? [])
        .map((nid) => nuggets.find((n) => n.id === nid))
        .filter((n): n is Nugget => !!n),
    [openProject?.nuggetIds, nuggets],
  );

  // ── Tab state ──
  const [openTabIds, setOpenTabIds] = useState<Set<string>>(new Set());

  // Reset open tabs when project changes — open all nuggets by default
  useEffect(() => {
    setOpenTabIds(new Set(allProjectNuggets.map((n) => n.id)));
  }, [openProjectId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset on project switch only

  // Auto-add newly created nuggets to open tabs, remove deleted ones
  useEffect(() => {
    const allIds = new Set(allProjectNuggets.map((n) => n.id));
    setOpenTabIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      // Add any new nugget IDs not in the set
      for (const id of allIds) {
        if (!next.has(id)) { next.add(id); changed = true; }
      }
      // Remove IDs that no longer exist in the project
      for (const id of next) {
        if (!allIds.has(id)) { next.delete(id); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [allProjectNuggets]);

  const projectNuggetsForTabs = useMemo(
    () => allProjectNuggets.filter((n) => openTabIds.has(n.id)),
    [allProjectNuggets, openTabIds],
  );

  // ── Handlers ──
  const handleOpenTab = useCallback(
    (nuggetId: string) => {
      setOpenTabIds((prev) => {
        const next = new Set(prev);
        next.add(nuggetId);
        return next;
      });
      selectEntity({ nuggetId });
    },
    [selectEntity],
  );

  const handleCloseTab = useCallback(
    (nuggetId: string) => {
      setOpenTabIds((prev) => {
        const next = new Set(prev);
        next.delete(nuggetId);
        return next;
      });
      // If closing the selected tab, select another open tab
      if (nuggetId === selectedNuggetId) {
        const remaining = allProjectNuggets.filter((n) => n.id !== nuggetId && openTabIds.has(n.id));
        if (remaining.length > 0) {
          selectEntity({ nuggetId: remaining[0].id });
        }
      }
    },
    [selectedNuggetId, allProjectNuggets, openTabIds, selectEntity],
  );

  const handleTabCreateNugget = useCallback(
    (name: string, files: File[]) => {
      if (!openProjectId) return;
      const now = Date.now();
      const nugget: Nugget = {
        id: `nugget-${now}-${Math.random().toString(36).substr(2, 9)}`,
        name,
        type: 'insights',
        documents: [],
        cards: [],
        createdAt: now,
        lastModifiedAt: now,
      };
      handleCreateNugget(nugget);
      addNuggetToProject(openProjectId, nugget.id);
      selectEntity({ nuggetId: nugget.id });
      // Upload files after nugget is selected (handleUploadDocuments uses selectedNuggetId)
      if (files.length > 0) {
        const dt = new DataTransfer();
        files.forEach((f) => dt.items.add(f));
        setTimeout(() => handleUploadDocuments(dt.files), 50);
      }
    },
    [openProjectId, handleCreateNugget, addNuggetToProject, selectEntity, handleUploadDocuments],
  );

  const handleTabRenameNugget = useCallback(
    (id: string, newName: string) => {
      updateNugget(id, (n) => ({ ...n, name: newName, lastModifiedAt: Date.now() }));
    },
    [updateNugget],
  );

  const handleTabDuplicateNugget = useCallback(
    async (nuggetId: string) => {
      if (!openProjectId) return;
      await handleCopyNuggetToProject(nuggetId, openProjectId);
    },
    [openProjectId, handleCopyNuggetToProject],
  );

  return {
    openProject,
    allProjectNuggets,
    projectNuggetsForTabs,
    openTabIds,
    handleOpenTab,
    handleCloseTab,
    handleTabCreateNugget,
    handleTabRenameNugget,
    handleTabDuplicateNugget,
  };
}
