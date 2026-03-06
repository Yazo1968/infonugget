import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../utils/supabase';
import { createLogger } from '../utils/logger';

const log = createLogger('NuggetCloseTracker');

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/**
 * Records `nugget_last_closed_at` when the user navigates away from a nugget.
 *
 * Detects three scenarios:
 *  1. Nugget switch — selectedNuggetId changes from A → B (or A → null)
 *  2. Browser / tab close — visibilitychange → 'hidden'
 *  3. Logout — triggers visibilitychange as the page transitions
 *
 * Uses a direct Supabase DB update (not through React context or debounced
 * persistence) so it works reliably during page unload. The `visibilitychange`
 * path uses `fetch` with `keepalive: true` to survive page teardown.
 */
export function useNuggetCloseTracker(selectedNuggetId: string | null): void {
  const prevNuggetIdRef = useRef<string | null>(null);
  // Cache the access token synchronously for use during unload
  const accessTokenRef = useRef<string | null>(null);

  // Keep the access token ref up to date
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      accessTokenRef.current = session?.access_token ?? null;
    });
    // Seed the initial value
    supabase.auth.getSession().then(({ data: { session } }) => {
      accessTokenRef.current = session?.access_token ?? null;
    });
    return () => subscription.unsubscribe();
  }, []);

  // Fire-and-forget DB update for normal (non-unload) context
  const recordClose = useCallback(async (nuggetId: string) => {
    try {
      await supabase
        .from('nuggets')
        .update({ nugget_last_closed_at: new Date().toISOString() })
        .eq('id', nuggetId);
      log.debug(`Recorded close for nugget ${nuggetId}`);
    } catch (err) {
      log.warn('Failed to record nugget close:', err);
    }
  }, []);

  // ── Scenario 1: Nugget selection changes ──
  useEffect(() => {
    const prevId = prevNuggetIdRef.current;
    if (prevId && prevId !== selectedNuggetId) {
      recordClose(prevId);
    }
    prevNuggetIdRef.current = selectedNuggetId;
  }, [selectedNuggetId, recordClose]);

  // ── Scenario 2 & 3: Browser close / tab hidden / logout ──
  useEffect(() => {
    const handleVisibilityHidden = () => {
      if (document.visibilityState !== 'hidden') return;
      const currentId = prevNuggetIdRef.current;
      const token = accessTokenRef.current;
      if (!currentId || !token || !SUPABASE_URL) return;

      // Use raw fetch with keepalive — the Supabase JS client may not complete
      // during page unload, but keepalive requests survive teardown.
      const url = `${SUPABASE_URL}/rest/v1/nuggets?id=eq.${encodeURIComponent(currentId)}`;
      try {
        fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${token}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ nugget_last_closed_at: new Date().toISOString() }),
          keepalive: true,
        }).catch(() => {
          // Silently ignore — best-effort during unload
        });
      } catch {
        // Silently ignore
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityHidden);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityHidden);
    };
  }, []);
}
