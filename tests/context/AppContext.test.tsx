import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { AppProvider, useAppContext } from '../../context/AppContext';
import type { Nugget, Project, UploadedFile, InitialPersistedState } from '../../types';

// ── Mock localStorage and matchMedia for jsdom ──
const localStorageMock: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => localStorageMock[key] ?? null,
    setItem: (key: string, val: string) => {
      localStorageMock[key] = val;
    },
    removeItem: (key: string) => {
      delete localStorageMock[key];
    },
    clear: () => {
      for (const key of Object.keys(localStorageMock)) delete localStorageMock[key];
    },
  },
  writable: true,
});

Object.defineProperty(globalThis, 'matchMedia', {
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
  writable: true,
});

// ── Fixtures ──

function makeNugget(overrides: Partial<Nugget> = {}): Nugget {
  return {
    id: `nugget-${crypto.randomUUID()}`,
    name: 'Test Nugget',
    type: 'insights',
    documents: [],
    cards: [],
    createdAt: Date.now(),
    lastModifiedAt: Date.now(),
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: `proj-${crypto.randomUUID()}`,
    name: 'Test Project',
    nuggetIds: [],
    createdAt: Date.now(),
    lastModifiedAt: Date.now(),
    ...overrides,
  };
}

function makeDocument(overrides: Partial<UploadedFile> = {}): UploadedFile {
  return {
    id: `doc-${crypto.randomUUID()}`,
    name: 'test.md',
    size: 100,
    type: 'text/markdown',
    lastModified: Date.now(),
    content: '# Test',
    status: 'ready',
    progress: 100,
    ...overrides,
  };
}

function makeWrapper(initialState?: Partial<InitialPersistedState>) {
  const state: InitialPersistedState = {
    nuggets: [],
    projects: [],
    selectedNuggetId: null,
    activeCardId: null,
    workflowMode: 'insights',
    ...initialState,
  };
  return ({ children }: { children: React.ReactNode }) => (
    <AppProvider initialState={state}>{children}</AppProvider>
  );
}

// ── Tests ──

describe('AppContext — Project CRUD', () => {
  it('starts with empty projects', () => {
    const { result } = renderHook(() => useAppContext(), { wrapper: makeWrapper() });
    expect(result.current.projects).toEqual([]);
  });

  it('addProject adds a project', () => {
    const { result } = renderHook(() => useAppContext(), { wrapper: makeWrapper() });
    const project = makeProject({ name: 'New Project' });

    act(() => {
      result.current.addProject(project);
    });

    expect(result.current.projects).toHaveLength(1);
    expect(result.current.projects[0].name).toBe('New Project');
  });

  it('updateProject modifies an existing project', () => {
    const project = makeProject({ name: 'Original' });
    const { result } = renderHook(() => useAppContext(), {
      wrapper: makeWrapper({ projects: [project] }),
    });

    act(() => {
      result.current.updateProject(project.id, (p) => ({ ...p, name: 'Updated' }));
    });

    expect(result.current.projects[0].name).toBe('Updated');
  });

  it('deleteProject removes the project and its nuggets', async () => {
    const nugget = makeNugget({ id: 'n1' });
    const project = makeProject({ id: 'p1', nuggetIds: ['n1'] });
    const { result } = renderHook(() => useAppContext(), {
      wrapper: makeWrapper({ projects: [project], nuggets: [nugget] }),
    });

    await act(async () => {
      await result.current.deleteProject('p1');
    });

    expect(result.current.projects).toHaveLength(0);
    expect(result.current.nuggets).toHaveLength(0);
  });
});

describe('AppContext — Nugget CRUD', () => {
  it('addNugget adds a nugget', () => {
    const { result } = renderHook(() => useAppContext(), { wrapper: makeWrapper() });
    const nugget = makeNugget({ name: 'Research' });

    act(() => {
      result.current.addNugget(nugget);
    });

    expect(result.current.nuggets).toHaveLength(1);
    expect(result.current.nuggets[0].name).toBe('Research');
  });

  it('deleteNugget removes nugget and cleans up project references', async () => {
    const nugget = makeNugget({ id: 'n1' });
    const project = makeProject({ id: 'p1', nuggetIds: ['n1', 'n2'] });
    const { result } = renderHook(() => useAppContext(), {
      wrapper: makeWrapper({ nuggets: [nugget], projects: [project] }),
    });

    await act(async () => {
      await result.current.deleteNugget('n1');
    });

    expect(result.current.nuggets).toHaveLength(0);
    // Project should have the nuggetId removed
    expect(result.current.projects[0].nuggetIds).toEqual(['n2']);
  });

  it('updateNugget applies updater function', () => {
    const nugget = makeNugget({ id: 'n1', name: 'Original' });
    const { result } = renderHook(() => useAppContext(), {
      wrapper: makeWrapper({ nuggets: [nugget] }),
    });

    act(() => {
      result.current.updateNugget('n1', (n) => ({ ...n, name: 'Modified', subject: 'New subject' }));
    });

    expect(result.current.nuggets[0].name).toBe('Modified');
    expect(result.current.nuggets[0].subject).toBe('New subject');
  });

  it('addNuggetToProject links a nugget to a project', () => {
    const project = makeProject({ id: 'p1', nuggetIds: [] });
    const { result } = renderHook(() => useAppContext(), {
      wrapper: makeWrapper({ projects: [project] }),
    });

    act(() => {
      result.current.addNuggetToProject('p1', 'n1');
    });

    expect(result.current.projects[0].nuggetIds).toContain('n1');
  });

  it('removeNuggetFromProject unlinks a nugget', () => {
    const project = makeProject({ id: 'p1', nuggetIds: ['n1', 'n2'] });
    const { result } = renderHook(() => useAppContext(), {
      wrapper: makeWrapper({ projects: [project] }),
    });

    act(() => {
      result.current.removeNuggetFromProject('p1', 'n1');
    });

    expect(result.current.projects[0].nuggetIds).toEqual(['n2']);
  });
});

describe('AppContext — Document operations', () => {
  it('addNuggetDocument adds a document to the selected nugget', () => {
    const nugget = makeNugget({ id: 'n1' });
    const { result } = renderHook(() => useAppContext(), {
      wrapper: makeWrapper({ nuggets: [nugget], selectedNuggetId: 'n1' }),
    });

    const doc = makeDocument({ name: 'new-file.md' });
    act(() => {
      result.current.addNuggetDocument(doc);
    });

    expect(result.current.nuggets[0].documents).toHaveLength(1);
    expect(result.current.nuggets[0].documents[0].name).toBe('new-file.md');
    // Should also add a docChangeLog entry
    expect(result.current.nuggets[0].docChangeLog).toHaveLength(1);
    expect(result.current.nuggets[0].docChangeLog![0].type).toBe('added');
  });

  it('removeNuggetDocument removes a document from the selected nugget', () => {
    const doc = makeDocument({ id: 'd1' });
    const nugget = makeNugget({ id: 'n1', documents: [doc] });
    const { result } = renderHook(() => useAppContext(), {
      wrapper: makeWrapper({ nuggets: [nugget], selectedNuggetId: 'n1' }),
    });

    act(() => {
      result.current.removeNuggetDocument('d1');
    });

    expect(result.current.nuggets[0].documents).toHaveLength(0);
    expect(result.current.nuggets[0].docChangeLog).toHaveLength(1);
    expect(result.current.nuggets[0].docChangeLog![0].type).toBe('removed');
  });

  it('renameNuggetDocument updates the name and logs the change', () => {
    const doc = makeDocument({ id: 'd1', name: 'old-name.md' });
    const nugget = makeNugget({ id: 'n1', documents: [doc] });
    const { result } = renderHook(() => useAppContext(), {
      wrapper: makeWrapper({ nuggets: [nugget], selectedNuggetId: 'n1' }),
    });

    act(() => {
      result.current.renameNuggetDocument('d1', 'new-name.md');
    });

    expect(result.current.nuggets[0].documents[0].name).toBe('new-name.md');
    expect(result.current.nuggets[0].docChangeLog![0].type).toBe('renamed');
    expect(result.current.nuggets[0].docChangeLog![0].oldName).toBe('old-name.md');
  });
});

describe('AppContext — Selection', () => {
  it('selectEntity sets project → nugget → document triple', () => {
    const doc = makeDocument({ id: 'd1' });
    const nugget = makeNugget({ id: 'n1', documents: [doc] });
    const project = makeProject({ id: 'p1', nuggetIds: ['n1'] });
    const { result } = renderHook(() => useAppContext(), {
      wrapper: makeWrapper({ nuggets: [nugget], projects: [project] }),
    });

    act(() => {
      result.current.selectEntity({ projectId: 'p1' });
    });

    expect(result.current.selectedProjectId).toBe('p1');
    expect(result.current.selectedNuggetId).toBe('n1');
    // Should auto-select first enabled document
    expect(result.current.selectedDocumentId).toBe('d1');
    expect(result.current.selectionLevel).toBe('project');
  });

  it('selectEntity with nuggetId derives parent project', () => {
    const doc = makeDocument({ id: 'd1' });
    const nugget = makeNugget({ id: 'n1', documents: [doc] });
    const project = makeProject({ id: 'p1', nuggetIds: ['n1'] });
    const { result } = renderHook(() => useAppContext(), {
      wrapper: makeWrapper({ nuggets: [nugget], projects: [project] }),
    });

    act(() => {
      result.current.selectEntity({ nuggetId: 'n1' });
    });

    expect(result.current.selectedProjectId).toBe('p1');
    expect(result.current.selectedNuggetId).toBe('n1');
    expect(result.current.selectionLevel).toBe('nugget');
  });

  it('selectEntity with documentId derives parent nugget and project', () => {
    const doc = makeDocument({ id: 'd1' });
    const nugget = makeNugget({ id: 'n1', documents: [doc] });
    const project = makeProject({ id: 'p1', nuggetIds: ['n1'] });
    const { result } = renderHook(() => useAppContext(), {
      wrapper: makeWrapper({ nuggets: [nugget], projects: [project] }),
    });

    act(() => {
      result.current.selectEntity({ documentId: 'd1' });
    });

    expect(result.current.selectedProjectId).toBe('p1');
    expect(result.current.selectedNuggetId).toBe('n1');
    expect(result.current.selectedDocumentId).toBe('d1');
    expect(result.current.selectionLevel).toBe('document');
  });
});
