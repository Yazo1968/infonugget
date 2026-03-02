import { useState, useCallback, useRef } from 'react';
import { useNuggetContext } from '../context/NuggetContext';
import {
  AutoDeckBriefing,
  AutoDeckLod,
  AutoDeckSession,
  AutoDeckStatus,
  Card,
  ParsedPlan,
  ReviewCardState,
} from '../types';
import { flattenCards } from '../utils/cardUtils';
import { callClaude, callClaudeWithFileApiDocs } from '../utils/ai';
import { RecordUsageFn } from './useTokenUsage';
import { buildPlannerPrompt, buildFinalizerPrompt } from '../utils/prompts/autoDeckPlanner';
import { buildProducerPrompt, batchPlan } from '../utils/prompts/autoDeckProducer';
import { buildQualityWarningsBlock } from '../utils/prompts/qualityCheck';
import {
  parsePlannerResponse,
  parseFinalizerResponse,
  parseProducerResponse,
  ProducedCard,
} from '../utils/autoDeck/parsers';
import { AUTO_DECK_LOD_LEVELS, AUTO_DECK_LIMITS, countWords } from '../utils/autoDeck/constants';
import { getUniqueName } from '../utils/naming';
import { estimateTokens } from '../utils/tokenEstimation';
import { useToast } from '../components/ToastNotification';

/**
 * Auto-Deck orchestration hook.
 *
 * Manages the full two-agent pipeline:
 *   1. Planner — analyzes documents, produces a card plan
 *   2. User review — approve, revise, or exclude cards
 *   3. Producer — writes content for each approved card
 *   4. Card creation — adds cards to the nugget
 *
 * State machine: CONFIGURING → PLANNING → CONFLICT/REVIEWING → REVISING/PRODUCING → COMPLETE
 */
export function useAutoDeck(
  recordUsage?: RecordUsageFn,
  placeholderFns?: {
    createPlaceholderCards: (titles: string[], detailLevel: import('../types').DetailLevel, options?: { sourceDocuments?: string[]; autoDeckSessionId?: string }) => { id: string; title: string }[];
    createPlaceholderCardsInFolder?: (titles: string[], detailLevel: import('../types').DetailLevel, options?: { sourceDocuments?: string[]; autoDeckSessionId?: string; folderName?: string }) => { folderId: string; cards: { id: string; title: string }[] } | null;
    fillPlaceholderCard: (cardId: string, detailLevel: import('../types').DetailLevel, content: string, newTitle?: string) => void;
    removePlaceholderCard: (cardId: string, detailLevel: import('../types').DetailLevel) => void;
  },
) {
  const { selectedNugget, updateNugget } = useNuggetContext();

  const { addToast } = useToast();

  const [session, setSession] = useState<AutoDeckSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Helpers ──

  const updateSession = useCallback((updater: (s: AutoDeckSession) => AutoDeckSession) => {
    setSession((prev) => (prev ? updater(prev) : prev));
  }, []);

  const setStatus = useCallback(
    (status: AutoDeckStatus) => {
      updateSession((s) => ({ ...s, status }));
    },
    [updateSession],
  );

  // ── Actions ──

  /**
   * Start the planning phase: send documents to the Planner agent.
   * @param orderedDocIds — document IDs in the user's chosen order (only these are sent)
   */
  const startPlanning = useCallback(
    async (briefing: AutoDeckBriefing, lod: AutoDeckLod, orderedDocIds: string[]) => {
      if (!selectedNugget) return;

      // Resolve documents in the user-specified order
      const allNuggetDocs = selectedNugget.documents.filter((d) => d.content || d.fileId || d.pdfBase64);
      const orderedSelectedDocs = orderedDocIds
        .map((id) => allNuggetDocs.find((d) => d.id === id))
        .filter(Boolean) as typeof allNuggetDocs;

      if (orderedSelectedDocs.length === 0) {
        addToast({ message: 'No documents selected for Auto-Deck.', type: 'error' });
        return;
      }

      // Create new session
      const sessionId = `autodeck-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const newSession: AutoDeckSession = {
        id: sessionId,
        nuggetId: selectedNugget.id,
        briefing,
        lod,
        orderedDocIds,
        status: 'planning',
        parsedPlan: null,
        conflicts: null,
        reviewState: null,
        producedCards: [],
        revisionCount: 0,
        error: null,
        createdAt: Date.now(),
      };
      setSession(newSession);

      // Split documents: inline (content) vs Files API (fileId only, e.g. native PDFs)
      const fileApiDocs = orderedSelectedDocs.filter((d) => d.fileId && !d.content);
      const inlineDocs = orderedSelectedDocs.filter((d) => d.content);

      // Build inline document context for prompt — preserving user-specified order
      const docs = inlineDocs.map((d) => ({
        id: d.id,
        name: d.name,
        wordCount: d.content ? countWords(d.content) : 0,
        content: d.content || '',
      }));
      // Files API docs included in metadata but content sent via document blocks
      const fileApiDocsMeta = fileApiDocs.map((d) => ({
        id: d.id,
        name: d.name,
        wordCount: d.structure?.reduce((sum, h) => sum + (h.wordCount ?? 0), 0) ?? 0,
        content: '', // content sent via Files API document blocks, not inline
      }));
      const allDocsMeta = orderedDocIds
        .map((id) => {
          const inlineDoc = docs.find((d) => d.id === id);
          if (inlineDoc) return inlineDoc;
          return fileApiDocsMeta.find((d) => d.id === id);
        })
        .filter(Boolean) as typeof docs;

      const totalWordCount = docs.reduce((sum, d) => sum + d.wordCount, 0);

      // Pre-flight token check (only inline docs — Files API docs don't count toward input tokens)
      const estimatedInputTokens = estimateTokens(docs.map((d) => d.content).join(''));
      if (estimatedInputTokens > 180000) {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                status: 'error',
                error: 'Documents are too large for a single API call. Consider splitting into smaller nuggets.',
              }
            : prev,
        );
        return;
      }

      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        const { systemBlocks, messages } = buildPlannerPrompt({
          briefing,
          lod,
          subject: selectedNugget?.subject,
          documents: allDocsMeta,
          totalWordCount,
        });

        // Inject quality warnings (if dismissed red report exists)
        const plannerQualityWarnings = buildQualityWarningsBlock(selectedNugget?.qualityReport);
        if (plannerQualityWarnings) {
          systemBlocks.push({ text: plannerQualityWarnings, cache: false });
        }

        const { text: rawResponse } = await callClaudeWithFileApiDocs({
          fileApiDocs: fileApiDocs.map((d) => ({ fileId: d.fileId!, name: d.name })),
          systemBlocks,
          messages,
          maxTokens: 16384,
          temperature: 0.1,
          signal: abortController.signal,
          recordUsage,
        });

        const result = parsePlannerResponse(rawResponse);

        if (result.status === 'conflict') {
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  status: 'conflict',
                  conflicts: result.conflicts,
                }
              : prev,
          );
        } else if (result.status === 'ok') {
          // Initialize review state with all cards included
          const cardStates: Record<number, ReviewCardState> = {};
          result.plan.cards.forEach((c) => {
            cardStates[c.number] = { included: true };
          });

          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  status: 'reviewing',
                  parsedPlan: result.plan,
                  reviewState: {
                    generalComment: '',
                    cardStates,
                    questionAnswers: {},
                    decision: 'pending',
                  },
                }
              : prev,
          );
        } else {
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  status: 'error',
                  error: result.error,
                }
              : prev,
          );
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.error('[useAutoDeck] Planner failed:', err);
        setSession((prev) =>
          prev
            ? {
                ...prev,
                status: 'error',
                error: `Planning failed: ${err.message}`,
              }
            : prev,
        );
      } finally {
        abortRef.current = null;
      }
    },
    [selectedNugget, recordUsage, addToast],
  );

  /**
   * Revise the plan: send previous plan + user feedback back to the Planner.
   */
  const revisePlan = useCallback(async () => {
    if (!session || !session.parsedPlan || !session.reviewState || !selectedNugget) return;
    if (session.revisionCount >= AUTO_DECK_LIMITS.maxRevisions) {
      addToast({ message: `Maximum revision limit (${AUTO_DECK_LIMITS.maxRevisions}) reached.`, type: 'error' });
      return;
    }

    setStatus('revising');

    // Resolve documents in the same order as the original session
    const allNuggetDocs = selectedNugget.documents.filter((d) => d.content || d.fileId || d.pdfBase64);
    const orderedSelectedDocs = session.orderedDocIds
      .map((id) => allNuggetDocs.find((d) => d.id === id))
      .filter(Boolean) as typeof allNuggetDocs;

    // Split documents: inline vs Files API
    const fileApiDocs = orderedSelectedDocs.filter((d) => d.fileId && !d.content);
    const inlineDocs = orderedSelectedDocs.filter((d) => d.content);

    const docs = inlineDocs.map((d) => ({
      id: d.id,
      name: d.name,
      wordCount: d.content ? countWords(d.content) : 0,
      content: d.content || '',
    }));
    const fileApiDocsMeta = fileApiDocs.map((d) => ({
      id: d.id,
      name: d.name,
      wordCount: d.structure?.reduce((sum, h) => sum + (h.wordCount ?? 0), 0) ?? 0,
      content: '',
    }));
    const allDocsMeta = session.orderedDocIds
      .map((id) => {
        const inlineDoc = docs.find((d) => d.id === id);
        if (inlineDoc) return inlineDoc;
        return fileApiDocsMeta.find((d) => d.id === id);
      })
      .filter(Boolean) as typeof docs;

    const totalWordCount = docs.reduce((sum, d) => sum + d.wordCount, 0);

    // Collect excluded cards and question answers
    const excludedCards: number[] = [];
    Object.entries(session.reviewState.cardStates).forEach(([numStr, state]) => {
      if (!state.included) excludedCards.push(Number(numStr));
    });

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const { systemBlocks, messages } = buildPlannerPrompt({
        briefing: session.briefing,
        lod: session.lod,
        subject: selectedNugget?.subject,
        documents: allDocsMeta,
        totalWordCount,
        revision: {
          previousPlan: session.parsedPlan,
          generalComment: session.reviewState.generalComment,
          cardComments: {},
          excludedCards,
          questionAnswers: session.reviewState.questionAnswers,
        },
      });

      // Inject quality warnings (if dismissed red report exists)
      const revisionQualityWarnings = buildQualityWarningsBlock(selectedNugget?.qualityReport);
      if (revisionQualityWarnings) {
        systemBlocks.push({ text: revisionQualityWarnings, cache: false });
      }

      const { text: rawResponse } = await callClaudeWithFileApiDocs({
        fileApiDocs: fileApiDocs.map((d) => ({ fileId: d.fileId!, name: d.name })),
        systemBlocks,
        messages,
        maxTokens: 16384,
        temperature: 0.1,
        signal: abortController.signal,
        recordUsage,
      });

      const result = parsePlannerResponse(rawResponse);

      if (result.status === 'ok') {
        const cardStates: Record<number, ReviewCardState> = {};
        result.plan.cards.forEach((c) => {
          cardStates[c.number] = { included: true };
        });

        setSession((prev) =>
          prev
            ? {
                ...prev,
                status: 'reviewing',
                parsedPlan: result.plan,
                reviewState: {
                  generalComment: '',
                  cardStates,
                  questionAnswers: {},
                  decision: 'pending',
                },
                revisionCount: prev.revisionCount + 1,
              }
            : prev,
        );
      } else if (result.status === 'conflict') {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                status: 'conflict',
                conflicts: result.conflicts,
                revisionCount: prev.revisionCount + 1,
              }
            : prev,
        );
      } else {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                status: 'error',
                error: result.error,
              }
            : prev,
        );
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('[useAutoDeck] Revision failed:', err);
      setSession((prev) =>
        prev
          ? {
              ...prev,
              status: 'error',
              error: `Revision failed: ${err.message}`,
            }
          : prev,
      );
    } finally {
      abortRef.current = null;
    }
  }, [session, selectedNugget, recordUsage, setStatus, addToast]);

  /**
   * Submit the reviewed plan: finalize (AI bakes in decisions) then produce content.
   *
   * Phase 1 — Finalize: Send draft plan + MCQ answers + excluded cards + general comment
   *   to the planner AI, which outputs a clean, self-contained plan.
   * Phase 2 — Produce: Send the finalized plan to the producer AI to write card content.
   */
  const approvePlan = useCallback(async () => {
    if (!session || !session.parsedPlan || !session.reviewState || !selectedNugget) return;

    // Resolve documents in the same order as the original session
    const allNuggetDocs = selectedNugget.documents.filter((d) => d.content || d.fileId || d.pdfBase64);
    const orderedSelectedDocs = session.orderedDocIds
      .map((id) => allNuggetDocs.find((d) => d.id === id))
      .filter(Boolean) as typeof allNuggetDocs;

    // Split documents: inline vs Files API
    const fileApiDocs = orderedSelectedDocs.filter((d) => d.fileId && !d.content);
    const inlineDocs = orderedSelectedDocs.filter((d) => d.content);

    const inlineDocsWithWordCount = inlineDocs.map((d) => ({
      id: d.id,
      name: d.name,
      wordCount: d.content ? countWords(d.content) : 0,
      content: d.content || '',
    }));
    const fileApiDocsMeta = fileApiDocs.map((d) => ({
      id: d.id,
      name: d.name,
      wordCount: d.structure?.reduce((sum, h) => sum + (h.wordCount ?? 0), 0) ?? 0,
      content: '',
    }));
    const allDocsMetaWithWordCount = session.orderedDocIds
      .map((id) => {
        const inlineDoc = inlineDocsWithWordCount.find((d) => d.id === id);
        if (inlineDoc) return inlineDoc;
        return fileApiDocsMeta.find((d) => d.id === id);
      })
      .filter(Boolean) as typeof inlineDocsWithWordCount;

    const _totalWordCount = inlineDocsWithWordCount.reduce((sum, d) => sum + d.wordCount, 0);

    // Filter to only included cards
    const includedCards = session.parsedPlan.cards.filter(
      (c) => session.reviewState!.cardStates[c.number]?.included !== false,
    );

    if (includedCards.length === 0) {
      addToast({ message: 'No cards selected. Please include at least one card.', type: 'error' });
      setStatus('reviewing');
      return;
    }

    const abortController = new AbortController();
    abortRef.current = abortController;

    // Hoist so catch block can access for cleanup
    const placeholderMap = new Map<string, string>(); // title → cardId

    try {
      // ── Phase 1: Finalize ──
      // Build a filtered plan with only included cards for the finalizer
      const filteredPlan: ParsedPlan = {
        ...session.parsedPlan,
        cards: includedCards,
      };

      const hasQuestions = session.parsedPlan.questions && session.parsedPlan.questions.length > 0;
      const hasAnsweredQuestions = hasQuestions && Object.keys(session.reviewState.questionAnswers).length > 0;
      const hasGeneralComment = !!session.reviewState.generalComment?.trim();

      // Only run the finalizer if there are actual decisions or feedback to incorporate
      let finalizedPlan: ParsedPlan;

      if (hasAnsweredQuestions || hasGeneralComment) {
        setStatus('finalizing');

        // Finalizer only restructures the plan — does NOT need source documents
        const { systemBlocks: finSystemBlocks, messages: finMessages } = buildFinalizerPrompt({
          briefing: session.briefing,
          lod: session.lod,
          subject: selectedNugget?.subject,
          plan: filteredPlan,
          questions: session.parsedPlan.questions || [],
          questionAnswers: session.reviewState.questionAnswers,
          generalComment: session.reviewState.generalComment || undefined,
        });

        const { text: finRawResponse, usage: finUsage } = await callClaude('', {
          systemBlocks: finSystemBlocks,
          messages: finMessages,
          maxTokens: 16384,
          temperature: 0.1,
          signal: abortController.signal,
        });

        recordUsage?.({
          provider: 'claude',
          model: 'claude-sonnet-4-6',
          inputTokens: finUsage?.input_tokens ?? 0,
          outputTokens: finUsage?.output_tokens ?? 0,
          cacheReadTokens: finUsage?.cache_read_input_tokens ?? 0,
          cacheWriteTokens: finUsage?.cache_creation_input_tokens ?? 0,
        });

        const finResult = parseFinalizerResponse(finRawResponse);

        if (finResult.status !== 'ok') {
          throw new Error(finResult.status === 'error' ? finResult.error : 'Finalizer returned unexpected status');
        }

        finalizedPlan = finResult.plan;

        // Update session with finalized plan
        setSession((prev) =>
          prev
            ? {
                ...prev,
                parsedPlan: finalizedPlan,
              }
            : prev,
        );
      } else {
        // No decisions to incorporate — use the filtered plan as-is
        finalizedPlan = filteredPlan;
      }

      // ── Phase 2: Produce ──
      setStatus('producing');

      // Build producer doc metadata (without wordCount, matching ProducerPromptParams)
      const producerDocsMeta = allDocsMetaWithWordCount.map(({ id, name, content }) => ({ id, name, content }));

      // Batch if needed (>15 cards)
      const finalCards = finalizedPlan.cards;
      const batches = finalCards.length > 15 ? batchPlan(finalCards, 12) : [finalCards];

      const enabledDocNames = orderedSelectedDocs.map((d) => d.name);
      const detailLevel = AUTO_DECK_LOD_LEVELS[session.lod].detailLevel;

      // Create placeholder cards from the plan so they appear instantly with spinners
      if (placeholderFns) {
        const titles = finalCards.map((c) => c.title);
        if (placeholderFns.createPlaceholderCardsInFolder && titles.length >= 2) {
          const folderResult = placeholderFns.createPlaceholderCardsInFolder(titles, detailLevel, {
            sourceDocuments: enabledDocNames,
            autoDeckSessionId: session.id,
          });
          if (folderResult) {
            for (const p of folderResult.cards) {
              placeholderMap.set(p.title, p.id);
            }
          }
        } else {
          // Fallback for single card
          const placeholders = placeholderFns.createPlaceholderCards(titles, detailLevel, {
            sourceDocuments: enabledDocNames,
            autoDeckSessionId: session.id,
          });
          for (const p of placeholders) {
            placeholderMap.set(p.title, p.id);
          }
        }
      }

      const allProducedCards: ProducedCard[] = [];

      for (const batch of batches) {
        // Build batch context: tell the producer about other cards in the deck to avoid repetition
        let batchContext: string | undefined;
        if (batches.length > 1) {
          const otherCards = finalCards.filter((c) => !batch.includes(c));
          batchContext =
            `IMPORTANT: You are writing cards ${batch[0].number}–${batch[batch.length - 1].number} of a ${finalCards.length}-card deck.\n` +
            `Other cards in the deck (do NOT repeat their content):\n` +
            otherCards.map((c) => `  Card ${c.number}: ${c.title} — ${c.description}`).join('\n');
        }

        const { systemBlocks, messages } = buildProducerPrompt({
          briefing: session.briefing,
          lod: session.lod,
          subject: selectedNugget?.subject,
          plan: batch,
          documents: producerDocsMeta,
          batchContext,
        });

        // Inject quality warnings (if dismissed red report exists)
        const producerQualityWarnings = buildQualityWarningsBlock(selectedNugget?.qualityReport);
        if (producerQualityWarnings) {
          systemBlocks.push({ text: producerQualityWarnings, cache: false });
        }

        // Scale maxTokens based on batch size and LOD
        const lodConfig = AUTO_DECK_LOD_LEVELS[session.lod];
        const tokensPerCard = Math.ceil(lodConfig.wordCountMax * 1.5 * 1.3); // words→tokens with overhead
        const maxTokens = Math.min(64000, batch.length * tokensPerCard + 500);

        const { text: rawResponse } = await callClaudeWithFileApiDocs({
          fileApiDocs: fileApiDocs.map((d) => ({ fileId: d.fileId!, name: d.name })),
          systemBlocks,
          messages,
          maxTokens,
          signal: abortController.signal,
          recordUsage,
        });

        const result = parseProducerResponse(rawResponse);
        if (result.status === 'ok') {
          allProducedCards.push(...result.cards);
          // Fill placeholders for this batch as content arrives
          if (placeholderFns) {
            for (const pc of result.cards) {
              const cardId = placeholderMap.get(pc.title);
              if (cardId) {
                placeholderFns.fillPlaceholderCard(cardId, detailLevel, `# ${pc.title}\n\n${pc.content}`);
                placeholderMap.delete(pc.title); // Remove filled entries so cleanup only targets unfilled
              }
            }
          }
        } else {
          throw new Error(result.error);
        }
      }

      // If placeholders were NOT used, create cards the legacy way
      if (!placeholderFns || placeholderMap.size === 0) {
        const existingCardNames = flattenCards(selectedNugget.cards).map((c) => c.text);
        const newCards: Card[] = allProducedCards.map((pc) => {
          const uniqueName = getUniqueName(pc.title, [
            ...existingCardNames,
            ...allProducedCards.filter((p) => p !== pc).map((p) => p.title),
          ]);
          existingCardNames.push(uniqueName);
          return {
            id: `card-${Math.random().toString(36).substr(2, 9)}`,
            level: 1,
            text: uniqueName,
            detailLevel,
            synthesisMap: { [detailLevel]: `# ${pc.title}\n\n${pc.content}` },
            createdAt: Date.now(),
            lastEditedAt: Date.now(),
            sourceDocuments: enabledDocNames,
            autoDeckSessionId: session.id,
          };
        });

        updateNugget(selectedNugget.id, (n) => ({
          ...n,
          cards: [...n.cards, ...newCards],
          lastModifiedAt: Date.now(),
        }));
      }

      setSession((prev) =>
        prev
          ? {
              ...prev,
              status: 'complete',
              producedCards: allProducedCards,
            }
          : prev,
      );

      addToast({ message: `${allProducedCards.length} cards generated successfully.`, type: 'success' });
    } catch (err: any) {
      // Remove unfilled placeholders on any error
      if (placeholderFns && placeholderMap.size > 0) {
        const dl = session ? AUTO_DECK_LOD_LEVELS[session.lod].detailLevel : 'Standard' as any;
        for (const [, cardId] of placeholderMap) {
          placeholderFns.removePlaceholderCard(cardId, dl);
        }
      }

      if (err.name === 'AbortError') {
        return;
      }

      console.error('[useAutoDeck] Submit failed:', err);
      setSession((prev) =>
        prev
          ? {
              ...prev,
              status: 'error',
              error: `Content generation failed: ${err.message}`,
            }
          : prev,
      );
    } finally {
      abortRef.current = null;
    }
  }, [session, selectedNugget, recordUsage, updateNugget, setStatus, addToast, placeholderFns]);

  // ── Review state helpers ──

  const toggleCardIncluded = useCallback(
    (cardNumber: number) => {
      updateSession((s) => {
        if (!s.reviewState) return s;
        const current = s.reviewState.cardStates[cardNumber];
        return {
          ...s,
          reviewState: {
            ...s.reviewState,
            cardStates: {
              ...s.reviewState.cardStates,
              [cardNumber]: { ...current, included: !current.included },
            },
          },
        };
      });
    },
    [updateSession],
  );

  const setQuestionAnswer = useCallback(
    (questionId: string, optionKey: string) => {
      updateSession((s) => {
        if (!s.reviewState) return s;
        return {
          ...s,
          reviewState: {
            ...s.reviewState,
            questionAnswers: {
              ...s.reviewState.questionAnswers,
              [questionId]: optionKey,
            },
          },
        };
      });
    },
    [updateSession],
  );

  const setAllRecommended = useCallback(() => {
    updateSession((s) => {
      if (!s.reviewState || !s.parsedPlan?.questions) return s;
      const answers: Record<string, string> = {};
      s.parsedPlan.questions.forEach((q) => {
        answers[q.id] = q.recommendedKey;
      });
      return {
        ...s,
        reviewState: { ...s.reviewState, questionAnswers: answers },
      };
    });
  }, [updateSession]);

  const setGeneralComment = useCallback(
    (comment: string) => {
      updateSession((s) => {
        if (!s.reviewState) return s;
        return {
          ...s,
          reviewState: {
            ...s.reviewState,
            generalComment: comment,
          },
        };
      });
    },
    [updateSession],
  );

  // ── Abort / Reset ──

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSession((prev) => {
      if (!prev) return prev;
      // Go back to reviewing if we were finalizing/producing/revising, otherwise reset
      if (prev.status === 'finalizing' || prev.status === 'producing' || prev.status === 'revising') {
        return { ...prev, status: prev.parsedPlan ? 'reviewing' : 'configuring' };
      }
      if (prev.status === 'planning') {
        return { ...prev, status: 'configuring' };
      }
      return prev;
    });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSession(null);
  }, []);

  /** Go back to reviewing state from an error (preserves plan + review state) */
  const retryFromReview = useCallback(() => {
    setSession((prev) => {
      if (!prev || !prev.parsedPlan) return prev;
      return { ...prev, status: 'reviewing', error: null };
    });
  }, []);

  return {
    session,
    // Actions
    startPlanning,
    revisePlan,
    approvePlan,
    abort,
    reset,
    retryFromReview,
    // Review helpers
    toggleCardIncluded,
    setQuestionAnswer,
    setAllRecommended,
    setGeneralComment,
  };
}
