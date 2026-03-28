import { useState, useCallback, useMemo } from 'react';
import { UploadedFile, DocVizProposal, DocVizResult, StylingOptions } from '../types';
import { generateGraphicsApi, chatMessageApi } from '../utils/api';
import { DOCVIZ_SYSTEM_PROMPT, DOCVIZ_USER_PROMPT, parseDocVizResponse } from '../utils/docviz/prompt';
import { buildGraphicsPrompt } from '../utils/docviz/graphicsPrompt';
import { useAbortController } from './useAbortController';
import { useAppContext } from '../context/AppContext';
import { createLogger } from '../utils/logger';

const log = createLogger('useDocViz');

type DocVizStatus = 'idle' | 'analysing' | 'done' | 'error';

export interface UseDocVizReturn {
  proposals: DocVizProposal[];
  status: DocVizStatus;
  error: string | null;
  selectedDocId: string | null;
  setSelectedDocId: (id: string | null) => void;
  analyse: (doc: UploadedFile, sectionHeadings?: string[]) => Promise<void>;
  abort: () => void;
  reset: () => void;
  /** The persisted result (document name, timestamp) — null if no analysis yet */
  persistedResult: DocVizResult | undefined;
  /** Which rows are currently generating images */
  generatingRows: Record<number, boolean>;
  /** Generate a graphic for a specific proposal using a screenshot of the data section */
  generateGraphic: (proposalIndex: number, activeType: string, settings: StylingOptions, screenshotBase64: string) => Promise<void>;
  /** Delete a generated graphic from a proposal */
  deleteGraphic: (proposalIndex: number) => void;
  /** Delete all proposals for a given section */
  deleteSectionProposals: (sectionTitle: string) => void;
  /** Delete a single proposal by index */
  deleteProposal: (proposalIndex: number) => void;
  /** Rename a proposal's visual_title */
  renameProposal: (proposalIndex: number, newTitle: string) => void;
}

export function useDocViz(): UseDocVizReturn {
  const { selectedNugget, updateNugget } = useAppContext();

  // Derive proposals from the nugget's persisted docVizResult
  const persistedResult = selectedNugget?.docVizResult;
  const persistedProposals = useMemo(() => persistedResult?.proposals ?? [], [persistedResult]);

  const [status, setStatus] = useState<DocVizStatus>(persistedProposals.length > 0 ? 'done' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(persistedResult?.documentId ?? null);
  const [generatingRows, setGeneratingRows] = useState<Record<number, boolean>>({});
  const { create: createAbort, abort: abortOp, isAbortError } = useAbortController();

  const analyse = useCallback(async (doc: UploadedFile, sectionHeadings?: string[]) => {
    if (!doc.fileId) {
      setError('Document has no file ID. Please wait for upload to complete.');
      setStatus('error');
      return;
    }

    setStatus('analysing');
    setError(null);

    const controller = createAbort();

    try {
      // Build user prompt — optionally scoped to specific sections
      let userPrompt = DOCVIZ_USER_PROMPT;
      if (sectionHeadings && sectionHeadings.length > 0) {
        const sectionList = sectionHeadings.map((h) => `- "${h}"`).join('\n');
        userPrompt = `Focus your analysis ONLY on the following section(s) of the document:\n${sectionList}\n\nIgnore all other sections. For the specified section(s):\n\n${DOCVIZ_USER_PROMPT}`;
      }

      const scope = sectionHeadings?.length ? `sections: ${sectionHeadings.join(', ')}` : 'full document';
      log.info(`Analysing document: ${doc.name} (fileId: ${doc.fileId}) [${scope}]`);

      const response = await chatMessageApi({
        action: 'docviz_analyse',
        userText: userPrompt,
        systemPrompt: DOCVIZ_SYSTEM_PROMPT,
        documents: [{ name: doc.name, fileId: doc.fileId }],
        maxTokens: 16000,
        thinking: { budgetTokens: 10000 },
        geminiStoreName: selectedNugget?.geminiStoreName,
      }, controller.signal);

      const text = response.responseText;
      const usage = response.usage;

      log.info(`DocViz response received (${usage.inputTokens} in / ${usage.outputTokens} out)`);

      const parsed = parseDocVizResponse(text);

      // Persist to nugget record
      // If section-scoped, append to existing proposals (avoid duplicates by section_ref)
      if (selectedNugget) {
        const existingProposals = selectedNugget.docVizResult?.proposals ?? [];
        let mergedProposals: DocVizProposal[];

        if (sectionHeadings && sectionHeadings.length > 0 && existingProposals.length > 0) {
          // Remove old proposals from these sections, then add new ones
          const newSectionRefs = new Set(parsed.map((p) => p.section_ref));
          const kept = existingProposals.filter((p) => !newSectionRefs.has(p.section_ref));
          mergedProposals = [...kept, ...parsed];
        } else {
          mergedProposals = parsed;
        }

        const result: DocVizResult = {
          documentId: doc.id,
          documentName: doc.name,
          proposals: mergedProposals,
          analysedAt: Date.now(),
        };
        updateNugget(selectedNugget.id, (n) => ({
          ...n,
          docVizResult: result,
          lastModifiedAt: Date.now(),
        }));
      }

      setStatus('done');
      log.info(`DocViz found ${parsed.length} visual proposals`);
    } catch (err) {
      if (isAbortError(err)) {
        log.info('DocViz analysis aborted by user');
        setStatus('idle');
        return;
      }
      const message = err instanceof Error ? err.message : 'Unknown error during analysis';
      log.error('DocViz analysis failed:', message);
      setError(message);
      // If we have existing proposals, stay in 'done' so results aren't hidden
      const hasExisting = (selectedNugget?.docVizResult?.proposals?.length ?? 0) > 0;
      setStatus(hasExisting ? 'done' : 'error');
    }
  }, [createAbort, isAbortError, selectedNugget, updateNugget]);

  const generateGraphic = useCallback(async (
    proposalIndex: number,
    activeType: string,
    settings: StylingOptions,
    screenshotBase64: string,
  ) => {
    if (!selectedNugget) return;
    const proposal = persistedProposals[proposalIndex];
    if (!proposal) return;

    setGeneratingRows((prev) => ({ ...prev, [proposalIndex]: true }));

    try {
      // Build the text prompt from template — no AI call
      const prompt = buildGraphicsPrompt(activeType, settings, proposal.visual_title, proposal.description, proposal.section_ref);
      log.info(`Generating graphic for proposal ${proposalIndex}: ${activeType} — ${proposal.visual_title}`);
      log.debug('Prompt:', prompt);
      log.debug('Screenshot size:', Math.round(screenshotBase64.length / 1024), 'KB');

      const response = await generateGraphicsApi({
        nuggetId: selectedNugget.id,
        proposalIndex,
        prompt,
        screenshotBase64,
        aspectRatio: settings.aspectRatio,
        resolution: settings.resolution,
      });

      log.info(`Graphic generated: ${response.imageUrl}`);

      // Update local nugget state with the image URL (triggers auto-persist)
      updateNugget(selectedNugget.id, (n) => {
        if (!n.docVizResult) return n;
        const updatedProposals = [...n.docVizResult.proposals];
        if (updatedProposals[proposalIndex]) {
          updatedProposals[proposalIndex] = {
            ...updatedProposals[proposalIndex],
            imageUrl: response.imageUrl,
            storagePath: response.storagePath,
            lastPrompt: prompt,
          };
        }
        return {
          ...n,
          docVizResult: { ...n.docVizResult, proposals: updatedProposals },
          lastModifiedAt: Date.now(),
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Image generation failed';
      log.error(`Graphic generation failed for proposal ${proposalIndex}:`, message);
      setError(message);
    } finally {
      setGeneratingRows((prev) => ({ ...prev, [proposalIndex]: false }));
    }
  }, [selectedNugget, persistedProposals, updateNugget]);

  const deleteGraphic = useCallback((proposalIndex: number) => {
    if (!selectedNugget) return;
    updateNugget(selectedNugget.id, (n) => {
      if (!n.docVizResult) return n;
      const updatedProposals = [...n.docVizResult.proposals];
      if (updatedProposals[proposalIndex]) {
        const { imageUrl: _, storagePath: __, ...rest } = updatedProposals[proposalIndex];
        updatedProposals[proposalIndex] = rest;
      }
      return {
        ...n,
        docVizResult: { ...n.docVizResult, proposals: updatedProposals },
        lastModifiedAt: Date.now(),
      };
    });
    log.info(`Deleted graphic for proposal ${proposalIndex}`);
  }, [selectedNugget, updateNugget]);

  const deleteSectionProposals = useCallback((sectionTitle: string) => {
    if (!selectedNugget) return;
    updateNugget(selectedNugget.id, (n) => {
      if (!n.docVizResult) return n;
      const filtered = n.docVizResult.proposals.filter((p) => p.section_ref !== sectionTitle);
      return {
        ...n,
        docVizResult: { ...n.docVizResult, proposals: filtered },
        lastModifiedAt: Date.now(),
      };
    });
    log.info(`Deleted all proposals for section "${sectionTitle}"`);
  }, [selectedNugget, updateNugget]);

  const deleteProposal = useCallback((proposalIndex: number) => {
    if (!selectedNugget) return;
    updateNugget(selectedNugget.id, (n) => {
      if (!n.docVizResult) return n;
      const filtered = n.docVizResult.proposals.filter((_, idx) => idx !== proposalIndex);
      return {
        ...n,
        docVizResult: { ...n.docVizResult, proposals: filtered },
        lastModifiedAt: Date.now(),
      };
    });
    log.info(`Deleted proposal ${proposalIndex}`);
  }, [selectedNugget, updateNugget]);

  const renameProposal = useCallback((proposalIndex: number, newTitle: string) => {
    if (!selectedNugget) return;
    updateNugget(selectedNugget.id, (n) => {
      if (!n.docVizResult) return n;
      const updatedProposals = [...n.docVizResult.proposals];
      if (updatedProposals[proposalIndex]) {
        updatedProposals[proposalIndex] = { ...updatedProposals[proposalIndex], visual_title: newTitle };
      }
      return {
        ...n,
        docVizResult: { ...n.docVizResult, proposals: updatedProposals },
        lastModifiedAt: Date.now(),
      };
    });
    log.info(`Renamed proposal ${proposalIndex} to "${newTitle}"`);
  }, [selectedNugget, updateNugget]);

  const abort = useCallback(() => {
    abortOp();
    setStatus('idle');
  }, [abortOp]);

  const reset = useCallback(() => {
    abortOp();
    // Clear persisted result
    if (selectedNugget) {
      updateNugget(selectedNugget.id, (n) => ({
        ...n,
        docVizResult: undefined,
        lastModifiedAt: Date.now(),
      }));
    }
    setStatus('idle');
    setError(null);
    setSelectedDocId(null);
  }, [abortOp, selectedNugget, updateNugget]);

  return {
    proposals: persistedProposals,
    status,
    error,
    selectedDocId,
    setSelectedDocId,
    analyse,
    abort,
    reset,
    persistedResult,
    generatingRows,
    generateGraphic,
    deleteGraphic,
    deleteSectionProposals,
    deleteProposal,
    renameProposal,
  };
}
