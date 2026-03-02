import { useRef, useCallback } from 'react';

/**
 * Shared AbortController management hook.
 *
 * Consolidates the identical abort pattern used across useCardGeneration,
 * useInsightsLab, and useAutoDeck:
 *   const controller = new AbortController();
 *   abortRef.current = controller;
 *   ...
 *   abortRef.current?.abort();
 *   abortRef.current = null;
 */
export function useAbortController() {
  const abortRef = useRef<AbortController | null>(null);

  /** Create a new AbortController, replacing any existing one (aborts it first). */
  const create = useCallback((): AbortController => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  }, []);

  /** Create a new AbortController WITHOUT aborting the previous one (for batch scenarios). */
  const createFresh = useCallback((): AbortController => {
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  }, []);

  /** Abort the current controller and clear the ref. */
  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  /** Clear the ref without aborting (for use in finally blocks). */
  const clear = useCallback(() => {
    abortRef.current = null;
  }, []);

  /** Check if an error is an AbortError (common catch-block guard). */
  const isAbortError = (err: unknown): boolean =>
    err instanceof DOMException && err.name === 'AbortError';

  return { abortRef, create, createFresh, abort, clear, isAbortError };
}
