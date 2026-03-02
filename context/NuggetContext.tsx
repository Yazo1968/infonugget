import { createContext, useContext } from 'react';
import type { Nugget, UploadedFile, Card, CardItem, ChatMessage } from '../types';

// ── Nugget context — nugget state, CRUD, card helpers, document mutation helpers ──

export interface NuggetContextValue {
  // Nugget state
  nuggets: Nugget[];
  setNuggets: React.Dispatch<React.SetStateAction<Nugget[]>>;
  selectedNuggetId: string | null;
  setSelectedNuggetId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedNugget: Nugget | undefined;

  // Document selection (tightly coupled with nugget — doc helpers depend on selectedNuggetId)
  selectedDocumentId: string | null;
  setSelectedDocumentId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedDocument: UploadedFile | undefined;

  // Nugget CRUD
  addNugget: (nugget: Nugget) => void;
  deleteNugget: (nuggetId: string) => void;
  updateNugget: (nuggetId: string, updater: (n: Nugget) => Nugget) => void;

  // Card helpers (operate on selected nugget)
  updateNuggetCard: (cardId: string, updater: (c: Card) => Card) => void;
  updateNuggetCards: (updater: (c: Card) => Card) => void;
  updateNuggetContentAndCards: (content: string, cards: CardItem[]) => void;
  appendNuggetMessage: (message: ChatMessage) => void;

  // Document mutation helpers (operate on selected nugget)
  addNuggetDocument: (doc: UploadedFile) => void;
  updateNuggetDocument: (docId: string, updated: UploadedFile) => void;
  removeNuggetDocument: (docId: string) => void;
  renameNuggetDocument: (docId: string, newName: string) => void;
  toggleNuggetDocument: (docId: string) => void;
}

export const NuggetContext = createContext<NuggetContextValue | null>(null);

export function useNuggetContext(): NuggetContextValue {
  const ctx = useContext(NuggetContext);
  if (!ctx) throw new Error('useNuggetContext must be used inside <AppProvider>');
  return ctx;
}
