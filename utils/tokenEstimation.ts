import { ChatMessage } from '../types';
import { ClaudeMessage } from './ai';

// ─────────────────────────────────────────────────────────────────
// Token Estimation & Message Pruning
// ─────────────────────────────────────────────────────────────────
// Lightweight pre-flight token estimation to prevent context window
// overflow (200K token limit). Uses a character-based heuristic
// (~4 chars per token for English text) — conservative enough to
// avoid overflow while not being so aggressive that it over-prunes.
// ─────────────────────────────────────────────────────────────────

/** Claude's context window (input tokens). */
const MODEL_CONTEXT_WINDOW = 200_000;

/** Safety margin to account for heuristic imprecision and API overhead. */
const SAFETY_MARGIN_TOKENS = 2_000;

/** Average characters per token for Claude (English text). */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate the token count of a string using the character heuristic.
 * This is intentionally simple — no dependencies, runs in O(n).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Compute the token budget available for conversation messages.
 * Subtracts system blocks + output reservation + safety margin from the context window.
 *
 * Returns <= 0 if documents alone exceed the context window.
 */
export function computeMessageBudget(systemBlocks: Array<{ text: string }>, maxOutputTokens: number): number {
  const systemTokens = systemBlocks.reduce((sum, block) => sum + estimateTokens(block.text), 0);
  return MODEL_CONTEXT_WINDOW - SAFETY_MARGIN_TOKENS - systemTokens - maxOutputTokens;
}

/**
 * Prune conversation history to fit within a token budget.
 *
 * Strategy:
 * 1. Filter out isCardContent assistant responses (already saved as cards, redundant)
 * 2. Convert remaining history to Claude message format
 * 3. Walk backwards from newest, accumulating messages until budget exhausted
 * 4. If messages were dropped, prepend a context notice
 * 5. Append the new user message
 *
 * Preserves: most recent messages (highest relevance), message ordering
 * Drops: oldest messages first, card content responses first
 */
export function pruneMessages(
  history: ChatMessage[],
  currentUserText: string,
  tokenBudget: number,
): { claudeMessages: ClaudeMessage[]; dropped: number } {
  // Phase 1: Filter out card content responses (they're saved as cards, no need to replay)
  const filtered = history.filter((m) => !(m.isCardContent && m.role === 'assistant'));

  // Phase 2: Convert to Claude message format.
  // System messages become user/assistant pairs to maintain turn alternation.
  // Consecutive system messages are merged into a single pair to save tokens.
  const allMessages: ClaudeMessage[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const msg = filtered[i];
    if (msg.role === 'system') {
      // Collect consecutive system messages into one block
      let merged = msg.content;
      while (i + 1 < filtered.length && filtered[i + 1].role === 'system') {
        i++;
        merged += '\n\n' + filtered[i].content;
      }
      allMessages.push({ role: 'user', content: merged });
      allMessages.push({ role: 'assistant', content: 'Noted.' });
      continue;
    }
    allMessages.push({ role: msg.role, content: msg.content });
  }

  // Phase 3: Build the new user message and reserve its budget
  const newUserMsg: ClaudeMessage = { role: 'user', content: currentUserText };
  let remaining = tokenBudget - estimateTokens(currentUserText);

  if (remaining <= 0) {
    // Even the user message alone exceeds the budget — send just the user message
    return { claudeMessages: [newUserMsg], dropped: allMessages.length };
  }

  // Phase 4: Walk backwards from most recent, accumulating messages that fit
  const kept: ClaudeMessage[] = [];
  let dropped = 0;

  for (let i = allMessages.length - 1; i >= 0; i--) {
    const msg = allMessages[i];
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    const cost = estimateTokens(content);
    if (cost <= remaining) {
      kept.unshift(msg);
      remaining -= cost;
    } else {
      dropped++;
    }
  }

  // Phase 5: If messages were dropped, inject a context notice at the start
  if (dropped > 0) {
    const notice: ClaudeMessage = {
      role: 'user',
      content: `[Note: ${dropped} earlier messages were trimmed to fit the context window. The conversation continues from the remaining messages below.]`,
    };
    const ack: ClaudeMessage = {
      role: 'assistant',
      content: "Understood. I'll continue based on the available conversation context and the source documents.",
    };
    const noticeCost = estimateTokens(notice.content as string) + estimateTokens(ack.content as string);

    if (noticeCost <= remaining) {
      kept.unshift(notice, ack);
    }
  }

  // Phase 6: Append the new user message
  kept.push(newUserMsg);

  return { claudeMessages: kept, dropped };
}
