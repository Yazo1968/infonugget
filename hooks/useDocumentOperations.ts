import { useState, useCallback, useRef } from 'react';
import { useNuggetContext } from '../context/NuggetContext';
import { appendDocChangeEvent } from '../context/AppContext';
import { useProjectContext } from '../context/ProjectContext';
import { useSelectionContext } from '../context/SelectionContext';
import { CLAUDE_MODEL } from '../utils/constants';
import { BookmarkNode, Card, DetailLevel, Heading, UploadedFile, Nugget, isCoverLevel } from '../types';
import { flattenCards, cardNamesInScope, findParentFolder } from '../utils/cardUtils';
import { getUniqueName } from '../utils/naming';
import {
  callClaude,
  uploadToFilesAPI,
  deleteFromFilesAPI,
} from '../utils/ai';
import { retrieveChunksApi, chatMessageApi } from '../utils/api';
import type { RetrievedChunk } from '../types';
import {
  createPlaceholderDocument,
  processFileToDocument,
  base64ToBlob,
  fileToBase64,
} from '../utils/fileProcessing';
import type { PdfProcessorResult } from '../components/PdfProcessorModal';
import { headingsToBookmarks, flattenBookmarks, writeBookmarksToPdf } from '../utils/pdfBookmarks';
import { buildContentPrompt, buildSectionFocus } from '../utils/prompts/contentGeneration';
import { buildCoverContentPrompt } from '../utils/prompts/coverGeneration';
import { resolveEnabledDocs } from '../utils/documentResolution';
import { useToast } from '../components/ToastNotification';
import { RecordUsageFn } from './useTokenUsage';
import { createLogger } from '../utils/logger';
import { importDocumentToStore } from '../utils/fileSearchStore';

const log = createLogger('DocOps');

// Layout directives are generated at image generation time via Gemini Flash (useCardGeneration.ts).
// Claude only synthesizes content — no directive generation in synthesis prompts.

/**
 * Parse headings from a Gemini File Search retrieval response.
 * Attempts JSON extraction first, then falls back to line-by-line heuristic parsing.
 */
function parseHeadingsFromResponse(responseText: string): Heading[] {
  if (!responseText.trim()) return [];

  // Try JSON extraction first (Gemini may return a JSON array)
  try {
    const cleaned = responseText
      .replace(/```(?:json)?\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      const parsed = JSON.parse(arrayMatch[0]) as Array<{ level: number; title: string; page?: number }>;
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].title) {
        return parsed.map((entry, i) => ({
          level: entry.level || 1,
          text: entry.title,
          id: `h-${i}-${Math.random().toString(36).substr(2, 4)}`,
          selected: false,
          page: typeof entry.page === 'number' ? entry.page : 0,
        }));
      }
    }
  } catch {
    // JSON parse failed — fall through to heuristic
  }

  // Heuristic: parse numbered/bulleted lines with heading-like patterns
  const headings: Heading[] = [];
  const lines = responseText.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Match patterns like "1. Introduction", "- Chapter 1: Overview", "## Methods"
    const bulletMatch = line.match(/^(?:[-*•]|\d+[.)]\s*)\s*(.+)/);
    const mdMatch = line.match(/^(#{1,6})\s+(.+)/);

    let title: string | null = null;
    let level = 1;

    if (mdMatch) {
      level = mdMatch[1].length;
      title = mdMatch[2].trim();
    } else if (bulletMatch) {
      title = bulletMatch[1].trim();
      // Infer level from indentation of original line
      const indent = line.length - line.trimStart().length;
      level = indent >= 4 ? 2 : 1;
    }

    if (title && title.length > 2 && title.length < 200) {
      // Strip trailing punctuation that doesn't belong in a heading
      title = title.replace(/[:]\s*$/, '').trim();
      headings.push({
        level,
        text: title,
        id: `h-${headings.length}-${Math.random().toString(36).substr(2, 4)}`,
        selected: false,
        page: 0,
      });
    }
  }

  return headings;
}

export interface UseDocumentOperationsParams {
  recordUsage: RecordUsageFn;
  onDomainGenPending: (nuggetId: string, docIds: string[]) => void;
  createPlaceholderCards: (titles: string[], detailLevel: DetailLevel, options?: { sourceDocuments?: string[]; targetFolderId?: string }) => { id: string; title: string }[];
  fillPlaceholderCard: (cardId: string, detailLevel: DetailLevel, content: string, newTitle?: string) => void;
  removePlaceholderCard: (cardId: string, detailLevel: DetailLevel) => void;
}

/**
 * Document operations — save, TOC, copy/move, upload, PDF choice, content generation.
 * Extracted from App.tsx for domain separation (item 4.2).
 */
export function useDocumentOperations({
  recordUsage,
  onDomainGenPending,
  createPlaceholderCards,
  fillPlaceholderCard,
  removePlaceholderCard,
}: UseDocumentOperationsParams) {
  const { selectedNugget, nuggets, updateNugget, addNugget, addNuggetDocument, updateNuggetDocument, removeNuggetDocument } = useNuggetContext();
  const { projects, addNuggetToProject } = useProjectContext();
  const { setActiveCardId } = useSelectionContext();

  // Ref to track latest nuggets — avoids stale closure when reading geminiStoreName
  // after addNugget completes but before re-render propagates to selectedNugget.
  const nuggetsRef = useRef(nuggets);
  nuggetsRef.current = nuggets;

  const { addToast } = useToast();

  // ── PDF choice dialog state (convert to MD or keep as PDF) ──
  const [pdfChoiceDialog, setPdfChoiceDialog] = useState<{ file: File; fileName: string } | null>(null);
  const pdfChoiceResolverRef = useRef<((result: 'keep-pdf' | 'markdown' | 'cancel') => void) | null>(null);

  // ── PDF processor modal state (shown after user chooses "keep as PDF") ──
  const [pdfProcessorDialog, setPdfProcessorDialog] = useState<{ pdfBase64: string; fileName: string } | null>(null);
  const pdfProcessorResolverRef = useRef<((result: PdfProcessorResult | 'cancel' | 'discard' | 'convert-to-markdown') => void) | null>(null);

  // ── Source-side generation spinner state (lifted from SourcesPanel to survive panel collapse) ──
  const [generatingSourceIds, setGeneratingSourceIds] = useState<Set<string>>(new Set());

  // ── TOC hard lock state (blocks all UI except SourcesPanel while TOC is dirty) ──
  const [tocLockActive, setTocLockActive] = useState(false);

  // ── Content generation from source documents ──

  const handleGenerateCardContent = useCallback(
    async (_editorCardId: string, detailLevel: DetailLevel, cardTitle: string, sourceDocName?: string, existingCardId?: string) => {
      if (!selectedNugget || !cardTitle) return;
      // Track this generation in lifted state so spinners survive panel collapse
      setGeneratingSourceIds((prev) => {
        const next = new Set(prev);
        next.add(_editorCardId);
        return next;
      });

      const enabledDocs = resolveEnabledDocs(selectedNugget.documents);
      const docsWithFileId = enabledDocs.filter((d) => d.fileId);

      // ── Direct Content (Snapshot): use raw section text as-is, no AI synthesis ──
      // For markdown docs: extract text client-side. For PDFs: fall through to AI path.
      if (detailLevel === 'DirectContent') {
        const inlineDocs = enabledDocs.filter((d) => d.content);
        const inlineContent = inlineDocs.map((d) => d.content).join('\n\n---\n\n');

        if (inlineContent) {
          // Markdown path: extract section text locally
          const isWholeDoc = _editorCardId === '__whole_document__';
          let directText: string;
          if (isWholeDoc) {
            directText = inlineContent.trim();
          } else {
            // Find the heading line in raw markdown that matches the plain-text cardTitle.
            // Heading text from the DOM (textContent) may differ from raw markdown due to inline
            // formatting (e.g. `## **Bold Title**` → DOM text "Bold Title").
            // Strategy: scan all heading lines, strip inline markdown, match by plain text.
            const headingLineRegex = /^(#{1,6})\s+(.+)$/gm;
            let lineMatch: RegExpExecArray | null;
            let foundMatch: { index: number; fullLength: number; level: number } | null = null;
            while ((lineMatch = headingLineRegex.exec(inlineContent)) !== null) {
              // Strip common inline markdown: **bold**, *italic*, __bold__, _italic_, `code`, [links](url), ~~strike~~
              const plainText = lineMatch[2]
                .replace(/\*\*(.+?)\*\*/g, '$1')
                .replace(/__(.+?)__/g, '$1')
                .replace(/\*(.+?)\*/g, '$1')
                .replace(/_(.+?)_/g, '$1')
                .replace(/`(.+?)`/g, '$1')
                .replace(/~~(.+?)~~/g, '$1')
                .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                .trim();
              if (plainText === cardTitle) {
                foundMatch = { index: lineMatch.index, fullLength: lineMatch[0].length, level: lineMatch[1].length };
                break;
              }
            }
            const startOffset = foundMatch ? foundMatch.index : 0;
            const headingLevel = foundMatch ? foundMatch.level : 1;
            const nextHeadingRegex = new RegExp(`^#{1,${headingLevel}}\\s+`, 'gm');
            nextHeadingRegex.lastIndex = startOffset + (foundMatch ? foundMatch.fullLength : 0);
            const nextMatch = nextHeadingRegex.exec(inlineContent);
            directText = inlineContent.substring(startOffset, nextMatch ? nextMatch.index : inlineContent.length).trim();
          }
          // Strip the leading heading line (card title is already shown separately)
          // then re-add a clean H1 to keep card rendering consistent
          directText = directText.replace(/^\s*#{1,6}\s+[^\n]*\n*/, '').trimStart();
          directText = `# ${cardTitle}\n\n${directText}`;

          // Scope uniqueness to the card's parent folder (or root)
          const parentFolder = existingCardId
            ? findParentFolder(selectedNugget.cards, existingCardId)
            : undefined;
          const uniqueCardName = getUniqueName(
            cardTitle,
            cardNamesInScope(selectedNugget.cards, parentFolder?.id),
          );

          if (existingCardId) {
            fillPlaceholderCard(existingCardId, detailLevel, directText, uniqueCardName);
            setActiveCardId(existingCardId);
          } else {
            const newCardId = `card-${crypto.randomUUID()}`;
            const cardSourceDocs = sourceDocName ? [sourceDocName] : enabledDocs.map((d) => d.name);

            const newCard: Card = {
              id: newCardId,
              text: uniqueCardName,
              level: 1,
              selected: false,
              synthesisMap: { [detailLevel]: directText },
              isSynthesizingMap: {},
              detailLevel,
              createdAt: Date.now(),
              sourceDocuments: cardSourceDocs,
            };

            updateNugget(selectedNugget.id, (n) => ({
              ...n,
              cards: [...n.cards, newCard],
              lastModifiedAt: Date.now(),
            }));

            setActiveCardId(newCardId);
          }
          setGeneratingSourceIds((prev) => {
            const next = new Set(prev);
            next.delete(_editorCardId);
            return next;
          });
          return;
        }
        // No inline content (native PDF) — fall through to AI path below
        // which will use a verbatim extraction prompt
      }

      // Build section focus early — needed for both chunk retrieval query and prompt
      const sectionFocus = buildSectionFocus(cardTitle, enabledDocs);

      // ── Chunk retrieval (preferred) or Files API fallback ──
      let retrievedChunks: RetrievedChunk[] | null = null;

      if (selectedNugget.geminiStoreName) {
        // Prefer chunk-based retrieval via Gemini File Search
        try {
          const queryText = sectionFocus
            ? `${cardTitle}\n${sectionFocus}`
            : cardTitle;
          const result = await retrieveChunksApi({
            storeName: selectedNugget.geminiStoreName,
            queryText,
          });
          if (result.chunks.length > 0) {
            retrievedChunks = result.chunks;
            log.info(`Retrieved ${result.chunks.length} chunks for "${cardTitle}"`);
          } else {
            log.warn(`Chunk retrieval returned 0 chunks for "${cardTitle}" — falling back to Files API`);
          }
        } catch (err: any) {
          log.warn('Chunk retrieval failed, falling back to Files API:', err.message);
        }
      }

      // Legacy fallback: Files API document blocks
      let resolvedDocs = docsWithFileId;
      if (!retrievedChunks) {
        if (resolvedDocs.length === 0) {
          const uploadable = enabledDocs.filter((d) => d.content || d.pdfBase64);
          if (uploadable.length === 0) {
            addToast({
              type: 'error',
              message: 'No uploadable documents found',
              detail: 'Documents must have content before AI synthesis can work.',
              duration: 8000,
            });
            setGeneratingSourceIds((prev) => {
              const next = new Set(prev);
              next.delete(_editorCardId);
              return next;
            });
            return;
          }

          addToast({ type: 'info', message: 'Uploading documents to Files API...', duration: 4000 });
          for (const doc of uploadable) {
            try {
              let newFileId: string | undefined;
              if (doc.sourceType === 'native-pdf' && doc.pdfBase64) {
                newFileId = await uploadToFilesAPI(
                  base64ToBlob(doc.pdfBase64, 'application/pdf'),
                  doc.name,
                  'application/pdf',
                );
              } else if (doc.content) {
                newFileId = await uploadToFilesAPI(doc.content, doc.name, 'text/plain');
              }
              if (newFileId) {
                updateNuggetDocument(doc.id, { ...doc, fileId: newFileId });
                // Update local reference for the current generation call
                (doc as any).fileId = newFileId;
              }
            } catch (err: any) {
              log.warn(`Auto-upload failed for "${doc.name}":`, err);
              addToast({
                type: 'error',
                message: `Files API upload failed for "${doc.name}"`,
                detail: err.message || 'Check Edge Function secrets and network connection.',
                duration: 8000,
              });
            }
          }

          // Re-check after upload attempts
          resolvedDocs = enabledDocs.filter((d) => d.fileId);
          if (resolvedDocs.length === 0) {
            setGeneratingSourceIds((prev) => {
              const next = new Set(prev);
              next.delete(_editorCardId);
              return next;
            });
            return;
          }
        }
      }

      // Build unified content prompt (sectionFocus already computed above)
      const isSnapshot = detailLevel === 'DirectContent';
      const isCover = !isSnapshot && isCoverLevel(detailLevel);
      const nuggetDomain = selectedNugget?.domain;

      let finalPrompt: string;
      let systemRole: string;

      if (isSnapshot) {
        // Snapshot for PDF: ask AI to reproduce the section content verbatim
        const isWholeDoc = _editorCardId === '__whole_document__';
        const snapshotPrompt = isWholeDoc
          ? `Extract and reproduce the ENTIRE document content as markdown. Preserve all text, data, tables, and structure exactly as they appear. Do not summarize, condense, or rephrase — reproduce the content faithfully. Use proper markdown formatting (headings, lists, tables, bold, etc.) to represent the document's structure.`
          : `Extract and reproduce the content of the section "${cardTitle}" (including all its sub-sections and nested content) as markdown. Preserve all text, data, tables, and structure exactly as they appear in that section. Do not summarize, condense, or rephrase — reproduce the content faithfully. Use proper markdown formatting (headings, lists, tables, bold, etc.) to represent the section's structure.`;
        finalPrompt = sectionFocus ? `${sectionFocus}\n\n${snapshotPrompt}` : snapshotPrompt;
        systemRole = 'You are a precise document extraction tool. You reproduce document content exactly as written, converting it into clean markdown format. You never summarize, interpret, or add information.';
      } else {
        const contentPrompt = isCover
          ? buildCoverContentPrompt(cardTitle, detailLevel, nuggetDomain)
          : buildContentPrompt(cardTitle, detailLevel, nuggetDomain);
        finalPrompt = sectionFocus ? `${sectionFocus}\n\n${contentPrompt}` : contentPrompt;
        systemRole = isCover
          ? 'You are an expert cover slide content designer. You create bold, concise titles, subtitles, and taglines for presentation cover slides. Follow the format and word count requirements precisely.'
          : 'You are an expert content synthesizer. You extract, restructure, and condense document content into infographic-ready text. Follow the formatting and word count requirements precisely.';
      }

      // Create placeholder card before the AI call so it appears instantly with a spinner
      // If existingCardId is provided (batch folder path), skip creation and use existing placeholder
      const cardSourceDocs = sourceDocName ? [sourceDocName] : enabledDocs.map((d) => d.name);
      let placeholderId: string;
      if (existingCardId) {
        placeholderId = existingCardId;
      } else {
        const placeholders = createPlaceholderCards([cardTitle], detailLevel, { sourceDocuments: cardSourceDocs });
        placeholderId = placeholders[0]?.id;
        if (!placeholderId) return;
      }

      try {
        const systemBlocks: Array<{ text: string; cache: boolean }> = [{ text: systemRole, cache: false }];

        // Build user message: chunks (preferred) or Files API document blocks (fallback)
        let userContent: any[];
        if (retrievedChunks) {
          // Chunk-based context: inline text from retrieved chunks
          const chunkContext = retrievedChunks.map((c) =>
            `--- Chunk from "${c.documentName}" ---\n${c.text}\n--- End Chunk ---`
          ).join('\n\n');
          const contextPreamble = 'The following are relevant excerpts from the source documents. Synthesize content based on these excerpts.\n\n';
          userContent = [{ type: 'text' as const, text: contextPreamble + chunkContext + '\n\n' + finalPrompt }];
        } else {
          // Legacy: Files API document blocks
          const docBlocks = resolvedDocs.map((d) => ({
            type: 'document' as const,
            source: { type: 'file' as const, file_id: d.fileId! },
            title: d.name,
          }));
          userContent = [...docBlocks, { type: 'text' as const, text: finalPrompt }];
        }
        const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [
          {
            role: 'user' as const,
            content: userContent,
          },
        ];

        const maxTokens = isSnapshot
          ? 4096
          : isCover
            ? detailLevel === 'TakeawayCard'
              ? 350
              : 256
            : detailLevel === 'Executive'
              ? 300
              : detailLevel === 'Standard'
                ? 600
                : 1200;

        const { text: rawSynthesized, usage: claudeUsage } = await callClaude('', {
          systemBlocks,
          messages,
          maxTokens,
        });

        recordUsage({
          provider: 'claude',
          model: CLAUDE_MODEL,
          inputTokens: claudeUsage.input_tokens,
          outputTokens: claudeUsage.output_tokens,
          cacheReadTokens: claudeUsage.cache_read_input_tokens,
          cacheWriteTokens: claudeUsage.cache_creation_input_tokens,
        });

        // Strip any residual XML tags Claude may have wrapped around the content
        const contentMatch = rawSynthesized.match(/<card_content>([\s\S]*?)<\/card_content>/);
        let synthesizedText = contentMatch ? contentMatch[1].trim() : rawSynthesized.trim();
        if (!isCover) {
          // Strip any leading H1 that Claude may have included, then re-add with the correct title
          synthesizedText = synthesizedText.replace(/^\s*#\s+[^\n]*\n*/, '');
          synthesizedText = `# ${cardTitle}\n\n${synthesizedText.trimStart()}`;
        }

        // Fill the placeholder card with the synthesized content
        fillPlaceholderCard(placeholderId, detailLevel, synthesizedText);
        setActiveCardId(placeholderId);
      } catch (err: any) {
        log.error('Generate card content failed:', err);
        addToast({
          type: 'error',
          message: `Content generation failed for "${cardTitle}"`,
          detail: err.message || 'Unknown error',
          duration: 8000,
        });
        removePlaceholderCard(placeholderId, detailLevel);
      } finally {
        setGeneratingSourceIds((prev) => {
          const next = new Set(prev);
          next.delete(_editorCardId);
          return next;
        });
      }
    },
    [selectedNugget, updateNugget, setActiveCardId, recordUsage, createPlaceholderCards, fillPlaceholderCard, removePlaceholderCard],
  );

  // ── Document save ──

  const handleSaveDocument = useCallback(
    async (docId: string, newContent: string) => {
      if (!selectedNugget) return;
      const doc = selectedNugget.documents.find((d) => d.id === docId);
      if (!doc) return;
      // Re-upload to Files API with updated content
      let fileId = doc.fileId;
      try {
        if (doc.fileId) await deleteFromFilesAPI(doc.fileId);
        fileId = await uploadToFilesAPI(newContent, doc.name, 'text/plain');
      } catch (err) {
        log.warn('Files API re-upload failed (will use inline fallback):', err);
      }
      updateNuggetDocument(docId, {
        ...doc,
        content: newContent,
        fileId,
        lastEditedAt: Date.now(),
        version: (doc.version ?? 1) + 1,
      });
    },
    [selectedNugget, updateNuggetDocument],
  );

  // ── Save TOC / bookmark changes ──

  const handleSaveToc = useCallback(
    async (docId: string, newStructure: Heading[]) => {
      if (!selectedNugget) return;
      const doc = selectedNugget.documents.find((d) => d.id === docId);
      if (!doc) return;

      // Convert flat headings to bookmark tree if this is a native PDF
      const newBookmarks = doc.sourceType === 'native-pdf' ? headingsToBookmarks(newStructure) : undefined;

      // Write bookmarks into the PDF for export if available
      let newPdfBase64 = doc.pdfBase64;
      if (newBookmarks && newBookmarks.length > 0 && doc.pdfBase64) {
        try {
          newPdfBase64 = await writeBookmarksToPdf(doc.pdfBase64, newBookmarks);
        } catch (err) {
          log.warn('Failed to write bookmarks into PDF:', err);
        }
      }

      // Update document in nugget state
      updateNuggetDocument(docId, {
        ...doc,
        structure: newStructure,
        bookmarks: newBookmarks ?? doc.bookmarks,
        bookmarkSource: newBookmarks ? ('manual' as const) : doc.bookmarkSource,
        pdfBase64: newPdfBase64,
        version: (doc.version ?? 1) + 1,
      });

      // Log TOC update for chat notification
      updateNugget(selectedNugget.id, (n) => ({
        ...n,
        ...appendDocChangeEvent(n, {
          type: 'toc_updated' as const,
          docId,
          docName: doc.name,
          timestamp: Date.now(),
        }),
        lastModifiedAt: Date.now(),
      }));
    },
    [selectedNugget, updateNuggetDocument, updateNugget],
  );

  // ── Copy/move document ──

  const handleCopyMoveDocument = useCallback(
    async (docId: string, targetNuggetId: string, mode: 'copy' | 'move') => {
      if (!selectedNugget) return;
      const doc = selectedNugget.documents.find((d) => d.id === docId);
      if (!doc) return;
      // Auto-increment name if it collides in target nugget
      const targetNugget = nuggets.find((n) => n.id === targetNuggetId);
      const targetDocNames = targetNugget ? targetNugget.documents.map((d) => d.name) : [];
      const uniqueDocName = getUniqueName(doc.name, targetDocNames, true);
      // Copy the document to the target nugget with a new ID
      const newDocId = `doc-${crypto.randomUUID()}`;
      // Upload the copy to Files API so it has its own file_id
      let copyFileId: string | undefined;
      try {
        if (doc.sourceType === 'native-pdf' && doc.pdfBase64) {
          copyFileId = await uploadToFilesAPI(
            base64ToBlob(doc.pdfBase64, 'application/pdf'),
            uniqueDocName,
            'application/pdf',
          );
        } else if (doc.content) {
          copyFileId = await uploadToFilesAPI(doc.content, uniqueDocName, 'text/plain');
        }
      } catch (err) {
        log.warn('Files API upload for document copy failed:', err);
      }
      // Derive source project name for origin tracking
      const sourceProject = projects.find((p) => p.nuggetIds.includes(selectedNugget.id));
      const docCopy: UploadedFile = {
        ...doc,
        id: newDocId,
        name: uniqueDocName,
        fileId: copyFileId,
        originalName: doc.originalName ?? doc.name,
        sourceOrigin: {
          type: mode === 'copy' ? 'copied' : 'moved',
          sourceProjectName: sourceProject?.name,
          sourceNuggetName: selectedNugget.name,
          timestamp: Date.now(),
        },
        createdAt: Date.now(),
        version: 1,
        lastEditedAt: undefined,
        lastRenamedAt: undefined,
        lastEnabledAt: undefined,
        lastDisabledAt: undefined,
      };
      // Add to target nugget
      updateNugget(targetNuggetId, (n) => ({
        ...n,
        documents: [...n.documents, docCopy],
        lastModifiedAt: Date.now(),
      }));
      // If move, also remove from source nugget (and delete the original's Files API file)
      if (mode === 'move') {
        if (doc.fileId) await deleteFromFilesAPI(doc.fileId);
        removeNuggetDocument(docId);
      }
    },
    [selectedNugget, nuggets, projects, updateNugget, removeNuggetDocument],
  );

  // ── Create nugget with document ──

  const handleCreateNuggetWithDoc = useCallback(
    async (nuggetName: string, docId: string) => {
      if (!selectedNugget) return;
      const doc = selectedNugget.documents.find((d) => d.id === docId);
      if (!doc) return;
      // Auto-increment nugget name within the same project
      const sourceProject = projects.find((p) => p.nuggetIds.includes(selectedNugget.id));
      const projectNuggetNames = sourceProject
        ? sourceProject.nuggetIds.map((nid) => nuggets.find((n) => n.id === nid)?.name || '').filter(Boolean)
        : nuggets.map((n) => n.name);
      const uniqueNuggetName = getUniqueName(nuggetName, projectNuggetNames);
      const newDocId = `doc-${crypto.randomUUID()}`;
      // Upload the copy to Files API so it has its own file_id
      let copyFileId: string | undefined;
      try {
        if (doc.sourceType === 'native-pdf' && doc.pdfBase64) {
          copyFileId = await uploadToFilesAPI(
            base64ToBlob(doc.pdfBase64, 'application/pdf'),
            doc.name,
            'application/pdf',
          );
        } else if (doc.content) {
          copyFileId = await uploadToFilesAPI(doc.content, doc.name, 'text/plain');
        }
      } catch (err) {
        log.warn('Files API upload for new nugget doc copy failed:', err);
      }
      const docCopy: UploadedFile = {
        ...doc,
        id: newDocId,
        fileId: copyFileId,
        originalName: doc.originalName ?? doc.name,
        sourceOrigin: {
          type: 'copied',
          sourceProjectName: sourceProject?.name,
          sourceNuggetName: selectedNugget.name,
          timestamp: Date.now(),
        },
        createdAt: Date.now(),
        version: 1,
        lastEditedAt: undefined,
        lastRenamedAt: undefined,
        lastEnabledAt: undefined,
        lastDisabledAt: undefined,
      };
      const newNugget: Nugget = {
        id: `nugget-${crypto.randomUUID()}`,
        name: uniqueNuggetName,
        type: 'insights',
        documents: [docCopy],
        cards: [],
        messages: [],
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
      };
      await addNugget(newNugget);
      // Add to same project as the source nugget
      if (sourceProject) {
        addNuggetToProject(sourceProject.id, newNugget.id);
      }
    },
    [selectedNugget, projects, nuggets, addNugget, addNuggetToProject],
  );

  // ── PDF choice dialog (convert or keep) ──

  const askPdfChoice = useCallback(
    (file: File, fileName: string): Promise<'keep-pdf' | 'markdown' | 'cancel'> => {
      return new Promise((resolve) => {
        pdfChoiceResolverRef.current = resolve;
        setPdfChoiceDialog({ file, fileName });
      });
    },
    [],
  );

  // ── PDF processor modal (bookmark editing after choosing "keep as PDF") ──

  const askPdfProcessor = useCallback(
    (pdfBase64: string, fileName: string): Promise<PdfProcessorResult | 'cancel' | 'discard' | 'convert-to-markdown'> => {
      return new Promise((resolve) => {
        pdfProcessorResolverRef.current = resolve;
        setPdfProcessorDialog({ pdfBase64, fileName });
      });
    },
    [],
  );

  /** Helper: commit a markdown-converted document (PDF or .md) */
  const commitMarkdownDoc = useCallback(
    (file: File, placeholder: UploadedFile, uniqueName: string) => {
      processFileToDocument(file, placeholder.id)
        .then(async (processed) => {
          let fileId: string | undefined;
          if (processed.content) {
            try {
              fileId = await uploadToFilesAPI(processed.content, uniqueName, 'text/plain');
            } catch (err) {
              log.warn('Files API upload failed:', err);
              addToast({
                type: 'warning',
                message: `Files API upload failed for "${uniqueName}"`,
                detail: 'AI synthesis will be unavailable for this document. Check your network connection and try re-uploading.',
                duration: 8000,
              });
            }
          }
          updateNuggetDocument(placeholder.id, { ...processed, name: uniqueName, fileId });
          // Fire-and-forget: import to Gemini File Search Store
          if (selectedNugget?.geminiStoreName && processed.content) {
            importDocumentToStore(
              selectedNugget.id, selectedNugget.geminiStoreName,
              uniqueName, btoa(unescape(encodeURIComponent(processed.content))), 'text/plain',
            ).then((geminiDocName) => {
              updateNuggetDocument(placeholder.id, {
                ...processed, name: uniqueName, fileId,
                geminiDocumentName: geminiDocName,
                geminiImportStatus: geminiDocName ? 'ready' as const : 'error' as const,
              });
            });
          }
        })
        .catch((err) => {
          updateNuggetDocument(placeholder.id, { ...placeholder, status: 'error' as const });
          addToast({
            type: 'error',
            message: `Failed to process "${uniqueName}"`,
            detail: err instanceof Error ? err.message : 'The document could not be processed.',
            duration: 10000,
          });
        });
    },
    [selectedNugget, updateNuggetDocument, addToast],
  );

  // ── Upload documents ──

  const handleUploadDocuments = useCallback(
    async (files: FileList) => {
      const needsDomain = !selectedNugget?.domain;
      const batchDocIds: string[] = [];
      const currentDocNames = [...(selectedNugget?.documents || []).map((d) => d.name)];
      const allFiles = Array.from(files);

      // Separate PDFs and non-PDFs
      const pdfFiles = allFiles.filter((f) => f.name.endsWith('.pdf') || f.type === 'application/pdf');
      const mdFiles = allFiles.filter((f) => !f.name.endsWith('.pdf') && f.type !== 'application/pdf');

      // Process PDFs one at a time: choice dialog first, then processor modal if kept as PDF
      for (const file of pdfFiles) {
        const uniqueName = getUniqueName(file.name, currentDocNames, true);
        currentDocNames.push(uniqueName);

        // Step 1: Ask user to convert to markdown or keep as PDF
        const choice = await askPdfChoice(file, uniqueName);
        if (choice === 'cancel') continue;

        const placeholder = createPlaceholderDocument(file);
        placeholder.name = uniqueName;
        addNuggetDocument(placeholder);
        if (needsDomain) batchDocIds.push(placeholder.id);

        if (choice === 'markdown') {
          // User chose "Convert to Markdown"
          commitMarkdownDoc(file, placeholder, uniqueName);
        }
        // Read geminiStoreName from ref to avoid stale closure after addNugget
        const latestNugget = nuggetsRef.current.find((n) => n.id === selectedNugget?.id);
        const geminiStoreName = latestNugget?.geminiStoreName || selectedNugget?.geminiStoreName;

        log.info(`PDF choice: ${choice}, geminiStoreName: ${geminiStoreName || 'NONE'}, selectedNugget.id: ${selectedNugget?.id}`);

        if (choice !== 'markdown' && geminiStoreName) {
          // ── Fast path: File Search import (bypasses Gemini Flash heading extraction) ──
          // Commit PDF immediately as 'processing' so it shows in the Sources panel
          const pdfBase64 = await fileToBase64(file);

          const pdfDoc: UploadedFile = {
            id: placeholder.id,
            name: uniqueName,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            sourceType: 'native-pdf' as const,
            pdfBase64,
            bookmarks: [],
            bookmarkSource: 'ai_generated' as const,
            structure: [],
            status: 'processing' as const,
            progress: 50,
            geminiImportStatus: 'importing' as const,
            createdAt: Date.now(),
            originalName: file.name,
            version: 1,
            sourceOrigin: { type: 'uploaded' as const, timestamp: Date.now() },
          };
          updateNuggetDocument(placeholder.id, pdfDoc);

          // Async pipeline: Files API upload + File Search import + heading extraction
          (async () => {
            try {
            addToast({ type: 'info', message: `Processing "${uniqueName}"...`, duration: 5000 });
            // 1. Upload to Files API (legacy fallback — non-blocking)
            let pdfFileId: string | undefined;
            try {
              pdfFileId = await uploadToFilesAPI(
                base64ToBlob(pdfBase64, 'application/pdf'),
                uniqueName,
                'application/pdf',
              );
            } catch (err) {
              log.warn('Native PDF Files API upload failed:', err);
            }

            // 2. Import to File Search Store
            addToast({ type: 'info', message: `Importing "${uniqueName}" to File Search...`, duration: 5000 });
            let geminiDocName: string | undefined;
            try {
              geminiDocName = await importDocumentToStore(
                selectedNugget!.id, geminiStoreName!,
                uniqueName, pdfBase64, 'application/pdf',
              );
            } catch (err) {
              log.warn('File Search import failed:', err);
            }

            // Update status immediately after import — don't wait for heading extraction
            if (geminiDocName) {
              updateNugget(selectedNugget!.id, (n) => ({
                ...n,
                documents: n.documents.map((d) =>
                  d.id === placeholder.id ? { ...d, geminiDocumentName: geminiDocName, geminiImportStatus: 'ready' as const } : d,
                ),
                lastModifiedAt: Date.now(),
              }));
              addToast({ type: 'success', message: `"${uniqueName}" indexed and ready`, duration: 4000 });
            }

            // 3. TOC extraction will be triggered manually by the user — not automatic

            // 4. Final update — set document as ready with file ID
            updateNugget(selectedNugget!.id, (n) => ({
              ...n,
              documents: n.documents.map((d) =>
                d.id === placeholder.id
                  ? {
                      ...pdfDoc,
                      fileId: pdfFileId,
                      status: 'ready' as const,
                      progress: 100,
                    }
                  : d,
              ),
              lastModifiedAt: Date.now(),
            }));
            } catch (pipelineErr: any) {
              log.error('PDF pipeline IIFE crashed:', pipelineErr);
              addToast({ type: 'error', message: `PDF processing failed: ${pipelineErr.message || 'Unknown error'}`, duration: 10000 });
              updateNugget(selectedNugget!.id, (n) => ({
                ...n,
                documents: n.documents.map((d) => d.id === placeholder.id ? { ...pdfDoc, status: 'error' as const, progress: 0, geminiImportStatus: 'error' as const } : d),
                lastModifiedAt: Date.now(),
              }));
            }
          })();
        } else {
          // ── Fallback: no File Search Store — use legacy Gemini Flash path via PdfProcessorModal ──
          const pdfBase64 = await fileToBase64(file);

          // Update placeholder so the modal can display the PDF
          updateNuggetDocument(placeholder.id, {
            ...placeholder,
            sourceType: 'native-pdf' as const,
            pdfBase64,
            status: 'processing' as const,
          });

          // Open the PDF Processor Modal — Gemini Flash runs automatically inside
          const result = await askPdfProcessor(pdfBase64, uniqueName);

          if (result === 'discard') {
            removeNuggetDocument(placeholder.id);
            addToast({ type: 'info', message: 'PDF discarded', duration: 3000 });
          } else if (result === 'convert-to-markdown') {
            updateNuggetDocument(placeholder.id, {
              ...placeholder,
              sourceType: 'markdown' as const,
              pdfBase64: undefined,
              bookmarks: undefined,
              bookmarkSource: undefined,
              structure: [],
              status: 'processing' as const,
              progress: 0,
            });
            commitMarkdownDoc(file, placeholder, uniqueName);
            addToast({ type: 'info', message: 'Converting PDF to markdown...', duration: 3000 });
          } else if (result === 'cancel') {
            removeNuggetDocument(placeholder.id);
            addToast({ type: 'info', message: 'PDF discarded', duration: 3000 });
          } else {
            const { pdfBase64: processedBase64, bookmarks, bookmarkSource } = result;

            let pdfFileId: string | undefined;
            try {
              pdfFileId = await uploadToFilesAPI(
                base64ToBlob(processedBase64, 'application/pdf'),
                uniqueName,
                'application/pdf',
              );
            } catch (err) {
              log.warn('Native PDF Files API upload failed:', err);
              addToast({
                type: 'warning',
                message: `Files API upload failed for "${uniqueName}"`,
                detail: 'AI synthesis will be unavailable for this PDF. Check your network connection and try re-uploading.',
                duration: 8000,
              });
            }

            const structure = bookmarks.length > 0
              ? flattenBookmarks(bookmarks)
              : [];

            const pdfDoc: UploadedFile = {
              id: placeholder.id,
              name: uniqueName,
              size: file.size,
              type: file.type,
              lastModified: file.lastModified,
              sourceType: 'native-pdf' as const,
              pdfBase64: processedBase64,
              bookmarks,
              bookmarkSource,
              structure,
              status: 'ready' as const,
              progress: 100,
              createdAt: Date.now(),
              originalName: file.name,
              version: 1,
              sourceOrigin: { type: 'uploaded' as const, timestamp: Date.now() },
              fileId: pdfFileId,
            };
            updateNuggetDocument(placeholder.id, pdfDoc);
            // Fire-and-forget: import to Gemini File Search Store
            if (selectedNugget?.geminiStoreName && processedBase64) {
              importDocumentToStore(
                selectedNugget.id, selectedNugget.geminiStoreName,
                uniqueName, processedBase64, 'application/pdf',
              ).then((geminiDocName) => {
                updateNuggetDocument(placeholder.id, {
                  ...pdfDoc,
                  geminiDocumentName: geminiDocName,
                  geminiImportStatus: geminiDocName ? 'ready' as const : 'error' as const,
                });
              });
            }
          }
        }
      }

      // Process markdown files (no dialog needed)
      for (const file of mdFiles) {
        const uniqueName = getUniqueName(file.name, currentDocNames, true);
        currentDocNames.push(uniqueName);

        const placeholder = createPlaceholderDocument(file);
        placeholder.name = uniqueName;
        addNuggetDocument(placeholder);
        if (needsDomain) batchDocIds.push(placeholder.id);

        commitMarkdownDoc(file, placeholder, uniqueName);
      }

      // Trigger subject auto-generation for first upload batch
      if (needsDomain && batchDocIds.length > 0 && selectedNugget) {
        onDomainGenPending(selectedNugget.id, batchDocIds);
      }
    },
    [selectedNugget, addNuggetDocument, updateNuggetDocument, removeNuggetDocument, askPdfChoice, askPdfProcessor, commitMarkdownDoc, addToast, onDomainGenPending],
  );

  return {
    // PDF choice dialog
    pdfChoiceDialog,
    pdfChoiceResolverRef,
    setPdfChoiceDialog,
    // PDF processor modal
    pdfProcessorDialog,
    pdfProcessorResolverRef,
    setPdfProcessorDialog,
    // Source generation spinner
    generatingSourceIds,
    // TOC lock
    tocLockActive,
    setTocLockActive,
    // Callbacks
    handleGenerateCardContent,
    handleSaveDocument,
    handleSaveToc,
    handleCopyMoveDocument,
    handleCreateNuggetWithDoc,
    handleUploadDocuments,
    // Exposed for cross-hook use (NuggetCreationModal path in useProjectOperations)
    askPdfProcessor,
  };
}
