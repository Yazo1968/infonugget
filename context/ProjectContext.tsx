import { createContext, useContext } from 'react';
import type { Project } from '../types';

// ── Project context — project state, CRUD, nugget-to-project membership ──

export interface ProjectContextValue {
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;

  addProject: (project: Project) => void;
  deleteProject: (projectId: string) => Promise<void>;
  updateProject: (projectId: string, updater: (p: Project) => Project) => void;
  addNuggetToProject: (projectId: string, nuggetId: string) => void;
  removeNuggetFromProject: (projectId: string, nuggetId: string) => void;
}

export const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjectContext must be used inside <AppProvider>');
  return ctx;
}
