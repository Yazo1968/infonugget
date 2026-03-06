import { useState, useCallback } from 'react';
import { useNuggetContext } from '../context/NuggetContext';
import {
  AutoDeckBriefing,
  AutoDeckLod,
  AutoDeckSession,
  AutoDeckStatus,
  BriefingSuggestions,
  Card,
  ParsedPlan,
  ReviewCardState,
  UploadedFile,
} from '../types';
import { flattenCards, cardNamesInScope } from '../utils/cardUtils';
import { CLAUDE_MODEL } from '../utils/constants';
import { RecordUsageFn } from './useTokenUsage';
import {
  parsePlannerResponse,
  parseFinalizerResponse,
  parseProducerResponse,
  parseBriefingMarkdownResponse,
  ProducedCard,
} from '../utils/autoDeck/parsers';
import { AUTO_DECK_LOD_LEVELS, AUTO_DECK_LIMITS, BRIEFING_SUGGESTION_COUNT, BRIEFING_LIMITS, countWords } from '../utils/autoDeck/constants';
import { getUniqueName } from '../utils/naming';
import { estimateTokens } from '../utils/tokenEstimation';
import { useToast } from '../components/ToastNotification';
import { createLogger } from '../utils/logger';
import { useAbortController } from './useAbortController';
import { resolveOrderedDocs } from '../utils/documentResolution';
import { autoDeckApi, chatMessageApi, ChatMessageDocument } from '../utils/api';

const log = createLogger('AutoDeck');

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
  const { selectedNugget, updateNugget, createLogCheckpoint } = useNuggetContext();

  const { addToast } = useToast();

  const [session, setSession] = useState<AutoDeckSession | null>(null);
  const { create: createAbort, abort: abortOp, clear: clearAbort, isAbortError } = useAbortController();
  const { create: createSuggestAbort, abort: abortSuggest, clear: clearSuggestAbort, isAbortError: isSuggestAbortError } = useAbortController();

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
      const orderedSelectedDocs = resolveOrderedDocs(selectedNugget.documents, orderedDocIds);

      if (orderedSelectedDocs.length === 0) {
        addToast({ message: 'No documents selected for Auto-Deck.', type: 'error' });
        return;
      }

      // Create a Sources Log checkpoint — captures document state at Auto-Deck start
      createLogCheckpoint('auto_deck');

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

      // Compute total word count and pre-flight token check (inline docs only — Files API docs handled server-side)
      const inlineContent = orderedSelectedDocs
        .filter((d) => !d.fileId)
        .map((d) => d.content || '');
      const totalWordCount = inlineContent.reduce((sum, c) => sum + countWords(c), 0);

      // Pre-flight token check
      const estimatedInputTokens = estimateTokens(inlineContent.join(''));
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

      const abortController = createAbort();

      try {
        // Build document payload for the Edge Function
        const apiDocs = orderedSelectedDocs.map((d) => ({
          id: d.id,
          name: d.name,
          content: d.fileId ? undefined : (d.content || ''),
          fileId: d.fileId,
          sourceType: d.sourceType,
          structure: d.structure,
        }));

        const response = await autoDeckApi({
          action: 'plan',
          briefing,
          lod,
          subject: selectedNugget?.subject,
          qualityReport: selectedNugget?.dqafReport ?? selectedNugget?.qualityReport,
          documents: apiDocs,
          totalWordCount,
        }, abortController.signal);

        recordUsage?.({
          provider: 'claude',
          model: CLAUDE_MODEL,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          cacheReadTokens: response.usage.cacheReadTokens,
          cacheWriteTokens: response.usage.cacheWriteTokens,
        });

        const result = parsePlannerResponse(response.responseText);

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
        if (isAbortError(err)) return;
        log.error('Planner failed:', err);
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
        clearAbort();
      }
    },
    [selectedNugget, recordUsage, addToast, createLogCheckpoint],
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
    const orderedSelectedDocs = resolveOrderedDocs(selectedNugget.documents, session.orderedDocIds);

    // Compute total word count of inline docs (Files API docs don't count)
    const totalWordCount = orderedSelectedDocs
      .filter((d) => !d.fileId)
      .reduce((sum, d) => sum + (d.content ? countWords(d.content) : 0), 0);

    // Collect excluded cards
    const excludedCards: number[] = [];
    Object.entries(session.reviewState.cardStates).forEach(([numStr, state]) => {
      if (!state.included) excludedCards.push(Number(numStr));
    });

    const abortController = createAbort();

    try {
      // Build document payload for the Edge Function
      const apiDocs = orderedSelectedDocs.map((d) => ({
        id: d.id,
        name: d.name,
        content: d.fileId ? undefined : (d.content || ''),
        fileId: d.fileId,
        sourceType: d.sourceType,
        structure: d.structure,
      }));

      const response = await autoDeckApi({
        action: 'revise',
        briefing: session.briefing,
        lod: session.lod,
        subject: selectedNugget?.subject,
        qualityReport: selectedNugget?.dqafReport ?? selectedNugget?.qualityReport,
        documents: apiDocs,
        totalWordCount,
        revision: {
          previousPlan: session.parsedPlan,
          generalComment: session.reviewState.generalComment,
          cardComments: {},
          excludedCards,
          questionAnswers: session.reviewState.questionAnswers,
        },
      }, abortController.signal);

      recordUsage?.({
        provider: 'claude',
        model: CLAUDE_MODEL,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        cacheReadTokens: response.usage.cacheReadTokens,
        cacheWriteTokens: response.usage.cacheWriteTokens,
      });

      const result = parsePlannerResponse(response.responseText);

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
      if (isAbortError(err)) return;
      log.error('Revision failed:', err);
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
      clearAbort();
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
    const orderedSelectedDocs = resolveOrderedDocs(selectedNugget.documents, session.orderedDocIds);

    // Filter to only included cards
    const includedCards = session.parsedPlan.cards.filter(
      (c) => session.reviewState!.cardStates[c.number]?.included !== false,
    );

    if (includedCards.length === 0) {
      addToast({ message: 'No cards selected. Please include at least one card.', type: 'error' });
      setStatus('reviewing');
      return;
    }

    const abortController = createAbort();

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

        const finResponse = await autoDeckApi({
          action: 'finalize',
          briefing: session.briefing,
          lod: session.lod,
          subject: selectedNugget?.subject,
          plan: filteredPlan,
          questions: session.parsedPlan.questions || [],
          questionAnswers: session.reviewState.questionAnswers,
          generalComment: session.reviewState.generalComment || undefined,
        }, abortController.signal);

        recordUsage?.({
          provider: 'claude',
          model: CLAUDE_MODEL,
          inputTokens: finResponse.usage.inputTokens,
          outputTokens: finResponse.usage.outputTokens,
          cacheReadTokens: finResponse.usage.cacheReadTokens,
          cacheWriteTokens: finResponse.usage.cacheWriteTokens,
        });

        const finResult = parseFinalizerResponse(finResponse.responseText);

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

      // Build document payload for the Edge Function
      const apiDocs = orderedSelectedDocs.map((d) => ({
        id: d.id,
        name: d.name,
        content: d.fileId ? undefined : (d.content || ''),
        fileId: d.fileId,
        sourceType: d.sourceType,
        structure: d.structure,
      }));

      // Batch if needed (>15 cards) — inline batch logic
      const finalCards = finalizedPlan.cards;
      const batchSize = 12;
      const batches: typeof finalCards[] = [];
      if (finalCards.length > 15) {
        for (let i = 0; i < finalCards.length; i += batchSize) {
          batches.push(finalCards.slice(i, i + batchSize));
        }
      } else {
        batches.push(finalCards);
      }

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

        // Scale maxTokens based on batch size and LOD
        const lodConfig = AUTO_DECK_LOD_LEVELS[session.lod];
        const tokensPerCard = Math.ceil(lodConfig.wordCountMax * 1.5 * 1.3); // words→tokens with overhead
        const maxTokens = Math.min(64000, batch.length * tokensPerCard + 500);

        const prodResponse = await autoDeckApi({
          action: 'produce',
          briefing: session.briefing,
          lod: session.lod,
          subject: selectedNugget?.subject,
          qualityReport: selectedNugget?.dqafReport ?? selectedNugget?.qualityReport,
          documents: apiDocs,
          planCards: batch,
          batchContext,
          maxTokens,
        }, abortController.signal);

        recordUsage?.({
          provider: 'claude',
          model: CLAUDE_MODEL,
          inputTokens: prodResponse.usage.inputTokens,
          outputTokens: prodResponse.usage.outputTokens,
          cacheReadTokens: prodResponse.usage.cacheReadTokens,
          cacheWriteTokens: prodResponse.usage.cacheWriteTokens,
        });

        const result = parseProducerResponse(prodResponse.responseText);
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

      // If placeholders were NOT used, create cards the legacy way (root level)
      if (!placeholderFns || placeholderMap.size === 0) {
        const existingCardNames = cardNamesInScope(selectedNugget.cards);
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

      if (isAbortError(err)) {
        return;
      }

      log.error('Submit failed:', err);
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
      clearAbort();
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
    abortOp();
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
    abortOp();
    setSession(null);
  }, []);

  /** Go back to reviewing state from an error (preserves plan + review state) */
  const retryFromReview = useCallback(() => {
    setSession((prev) => {
      if (!prev || !prev.parsedPlan) return prev;
      return { ...prev, status: 'reviewing', error: null };
    });
  }, []);

  // ── Briefing suggestions (pre-session, one-shot call) ──

  const generateBriefingSuggestions = useCallback(
    async (
      subject: string | undefined,
      documents: UploadedFile[],
      totalWordCount: number,
    ): Promise<BriefingSuggestions> => {
      const controller = createSuggestAbort();
      try {
        // Map documents to ChatMessageDocument format (fileId enables Files API on server)
        const chatDocs: ChatMessageDocument[] = documents.map((d) => ({
          name: d.name,
          fileId: d.fileId,
          sourceType: d.sourceType,
          ...(d.content ? { content: d.content } : {}),
        }));

        // Build a natural-language prompt that produces structured markdown tables
        const docList = documents.map((d) => `- ${d.name}`).join('\n');
        const subjectLine = subject ? `The subject/topic is: "${subject}".` : '';
        const prompt = [
          `I have ${documents.length} document(s) totaling ~${totalWordCount.toLocaleString()} words:`,
          docList,
          '',
          subjectLine,
          '',
          `Based on the actual content of these documents, suggest ${BRIEFING_SUGGESTION_COUNT} options for EACH of the following 5 briefing fields for a presentation deck. Each option must have a short label (2–5 words) and a brief description sentence.`,
          '',
          'The 5 fields and their description-sentence word limits:',
          `1. **Objective** — Why are we making this deck? (${BRIEFING_LIMITS.objective.min}–${BRIEFING_LIMITS.objective.max} words per description)`,
          `2. **Audience** — Who will view this deck? (${BRIEFING_LIMITS.audience.min}–${BRIEFING_LIMITS.audience.max} words per description)`,
          `3. **Type** — What kind of deck is this? (${BRIEFING_LIMITS.type.min}–${BRIEFING_LIMITS.type.max} words per description)`,
          `4. **Focus** — What should the deck emphasize? (${BRIEFING_LIMITS.focus.min}–${BRIEFING_LIMITS.focus.max} words per description)`,
          `5. **Tone** — What tone/style should the deck use? (${BRIEFING_LIMITS.tone.min}–${BRIEFING_LIMITS.tone.max} words per description)`,
          '',
          'Format your response as markdown with a ## heading per field, and a table with columns | Label | Brief |',
          'Example:',
          '## 1. Objective',
          '| Label | Brief |',
          '|---|---|',
          '| **Capital Raise** | Secure Series A funding by demonstrating market traction and growth potential |',
          '',
          'Important:',
          '- Base every suggestion on the actual document content — not generic options.',
          '- Labels should be concise and distinct from each other.',
          '- Description sentences should be specific to these documents.',
          '- Do NOT include any other commentary — just the 5 sections with tables.',
        ].join('\n');

        const response = await chatMessageApi(
          {
            action: 'send_message',
            userText: prompt,
            documents: chatDocs,
            subject,
            conversationHistory: [],
          },
          controller.signal,
        );

        recordUsage?.({
          provider: 'claude',
          model: CLAUDE_MODEL,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          cacheReadTokens: response.usage.cacheReadTokens,
          cacheWriteTokens: response.usage.cacheWriteTokens,
        });

        const result = parseBriefingMarkdownResponse(response.responseText);
        if (result.status !== 'ok') {
          throw new Error(result.error);
        }
        return result.suggestions;
      } catch (err: any) {
        if (isSuggestAbortError(err)) throw err;
        log.error('Briefing suggestions failed:', err);
        throw err;
      } finally {
        clearSuggestAbort();
      }
    },
    [recordUsage],
  );

  const abortSuggestions = useCallback(() => {
    abortSuggest();
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
    // Briefing suggestions
    generateBriefingSuggestions,
    abortSuggestions,
  };
}
