import { useState, useCallback, useRef } from 'react';
import { useNuggetContext } from '../context/NuggetContext';
import { useProjectContext } from '../context/ProjectContext';
import { useSelectionContext } from '../context/SelectionContext';
import { BookmarkNode, Card, DetailLevel, Heading, UploadedFile, Nugget, isCoverLevel } from '../types';
import { flattenCards } from '../utils/cardUtils';
import { getUniqueName } from '../utils/naming';
import {
  callClaude,
  uploadToFilesAPI,
  deleteFromFilesAPI,
} from '../utils/ai';
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
import { useToast } from '../components/ToastNotification';
import { RecordUsageFn } from './useTokenUsage';

export interface UseDocumentOperationsParams {
  recordUsage: RecordUsageFn;
  onSubjectGenPending: (nuggetId: string, docIds: string[]) => void;
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
  onSubjectGenPending,
  createPlaceholderCards,
  fillPlaceholderCard,
  removePlaceholderCard,
}: UseDocumentOperationsParams) {
  const { selectedNugget, nuggets, updateNugget, addNugget, addNuggetDocument, updateNuggetDocument, removeNuggetDocument } = useNuggetContext();
  const { projects, addNuggetToProject } = useProjectContext();
  const { setActiveCardId } = useSelectionContext();

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

      const enabledDocs = selectedNugget.documents.filter((d) => d.enabled !== false);
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

          // Check uniqueness against all cards in the nugget (nugget-wide)
          const uniqueCardName = getUniqueName(
            cardTitle,
            flattenCards(selectedNugget.cards).map((c) => c.text),
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

      // AI synthesis requires docs on Files API
      if (docsWithFileId.length === 0) {
        setGeneratingSourceIds((prev) => {
          const next = new Set(prev);
          next.delete(_editorCardId);
          return next;
        });
        return;
      }

      // Build unified section focus + content prompt
      const isSnapshot = detailLevel === 'DirectContent';
      const isCover = !isSnapshot && isCoverLevel(detailLevel);
      const nuggetSubject = selectedNugget?.subject;
      const sectionFocus = buildSectionFocus(cardTitle, enabledDocs);

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
          ? buildCoverContentPrompt(cardTitle, detailLevel, nuggetSubject)
          : buildContentPrompt(cardTitle, detailLevel, nuggetSubject);
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

        // Build user message with document blocks + section focus + content prompt
        const docBlocks = docsWithFileId.map((d) => ({
          type: 'document' as const,
          source: { type: 'file' as const, file_id: d.fileId! },
          title: d.name,
        }));
        const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [
          {
            role: 'user' as const,
            content: [...docBlocks, { type: 'text' as const, text: finalPrompt }],
          },
        ];

        const { text: rawSynthesized, usage: claudeUsage } = await callClaude('', {
          systemBlocks,
          messages,
          maxTokens: isSnapshot
            ? 4096
            : isCover
              ? detailLevel === 'TakeawayCard'
                ? 350
                : 256
              : detailLevel === 'Executive'
                ? 300
                : detailLevel === 'Standard'
                  ? 600
                  : 1200,
        });

        recordUsage({
          provider: 'claude',
          model: 'claude-sonnet-4-6',
          inputTokens: claudeUsage.input_tokens,
          outputTokens: claudeUsage.output_tokens,
          cacheReadTokens: claudeUsage.cache_read_input_tokens,
          cacheWriteTokens: claudeUsage.cache_creation_input_tokens,
        });

        let synthesizedText = rawSynthesized;
        if (!isCover) {
          // Strip any leading H1 that Claude may have included, then re-add with the correct title
          synthesizedText = synthesizedText.replace(/^\s*#\s+[^\n]*\n*/, '');
          synthesizedText = `# ${cardTitle}\n\n${synthesizedText.trimStart()}`;
        }

        // Fill the placeholder card with the synthesized content
        fillPlaceholderCard(placeholderId, detailLevel, synthesizedText);
        setActiveCardId(placeholderId);
      } catch (err) {
        console.error('Generate card content failed:', err);
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
        if (doc.fileId) deleteFromFilesAPI(doc.fileId);
        fileId = await uploadToFilesAPI(newContent, doc.name, 'text/plain');
      } catch (err) {
        console.warn('[App] Files API re-upload failed (will use inline fallback):', err);
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
          console.warn('[App] Failed to write bookmarks into PDF:', err);
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
        docChangeLog: [
          ...(n.docChangeLog || []),
          {
            type: 'toc_updated' as const,
            docId,
            docName: doc.name,
            timestamp: Date.now(),
          },
        ],
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
        console.warn('[App] Files API upload for document copy failed:', err);
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
        if (doc.fileId) deleteFromFilesAPI(doc.fileId);
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
        console.warn('[App] Files API upload for new nugget doc copy failed:', err);
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
      addNugget(newNugget);
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
              console.warn('[App] Files API upload failed (will use inline fallback):', err);
            }
          }
          updateNuggetDocument(placeholder.id, { ...processed, name: uniqueName, fileId });
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
    [updateNuggetDocument, addToast],
  );

  // ── Upload documents ──

  const handleUploadDocuments = useCallback(
    async (files: FileList) => {
      const needsSubject = !selectedNugget?.subject;
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
        if (needsSubject) batchDocIds.push(placeholder.id);

        if (choice === 'markdown') {
          // User chose "Convert to Markdown"
          commitMarkdownDoc(file, placeholder, uniqueName);
        } else {
          // Step 2: User chose "Keep as PDF" — get base64, open modal for Gemini analysis
          // Files API upload is deferred until the user confirms (Save) in the modal
          const pdfBase64 = await fileToBase64(file);

          // Update placeholder so the modal can display the PDF
          updateNuggetDocument(placeholder.id, {
            ...placeholder,
            sourceType: 'native-pdf' as const,
            pdfBase64,
            status: 'processing' as const,
          });

          // Open the PDF Processor Modal — Gemini runs automatically inside
          const result = await askPdfProcessor(pdfBase64, uniqueName);

          if (result === 'discard') {
            // User wants to remove the PDF entirely — no Files API cleanup needed (never uploaded)
            removeNuggetDocument(placeholder.id);
            addToast({ type: 'info', message: 'PDF discarded', duration: 3000 });
          } else if (result === 'convert-to-markdown') {
            // User wants Gemini markdown conversion instead
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
            // Cancel = discard since no bookmarks were confirmed
            removeNuggetDocument(placeholder.id);
            addToast({ type: 'info', message: 'PDF discarded', duration: 3000 });
          } else {
            // User accepted with bookmarks — now upload to Files API and commit
            const { pdfBase64: processedBase64, bookmarks, bookmarkSource } = result;

            let pdfFileId: string | undefined;
            try {
              pdfFileId = await uploadToFilesAPI(
                base64ToBlob(processedBase64, 'application/pdf'),
                uniqueName,
                'application/pdf',
              );
            } catch (err) {
              console.warn('[App] Native PDF Files API upload failed:', err);
            }

            const structure = bookmarks.length > 0
              ? flattenBookmarks(bookmarks)
              : [];

            updateNuggetDocument(placeholder.id, {
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
            });
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
        if (needsSubject) batchDocIds.push(placeholder.id);

        commitMarkdownDoc(file, placeholder, uniqueName);
      }

      // Trigger subject auto-generation for first upload batch
      if (needsSubject && batchDocIds.length > 0 && selectedNugget) {
        onSubjectGenPending(selectedNugget.id, batchDocIds);
      }
    },
    [selectedNugget, addNuggetDocument, updateNuggetDocument, removeNuggetDocument, askPdfChoice, askPdfProcessor, commitMarkdownDoc, addToast, onSubjectGenPending],
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
