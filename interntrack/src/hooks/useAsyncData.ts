/**
 * The single place async read state is managed.
 *
 * ## Why this exists rather than a query library
 *
 * Every read in this app is a local SQLite query — sub-millisecond, never
 * blocked on a network, and never in a state where it can fail for reasons the
 * user caused. That removes the two things a server-state library exists to
 * solve: there is no latency to hide behind a cache, and nothing to retry.
 * What is left is "run this, hold the result, re-run when the inputs change" —
 * which is this file, in a few dozen lines and no dependency.
 *
 * The re-run triggers are the two that actually occur in this app:
 *
 *   - the **key** changes (you switch to a different day, or another page of
 *     History), and
 *   - the screen **regains focus** (you log today, press back, and expect
 *     History to have moved).
 *
 * See [[InternTrack Architecture]] for why there is deliberately no global
 * mirror of the database in a store.
 *
 * ## The two bugs this is shaped to prevent
 *
 * **A superseded result overwriting a newer one.** `load` is asynchronous and
 * the inputs can change while it is in flight: flip from the 28th to the 29th
 * before the first read lands and two promises are outstanding. Without a guard
 * the slower one wins and the screen shows the 28th under a header saying the
 * 29th. The `cancelled` flag in the effect cleanup discards any result from a
 * run that has been superseded or unmounted, which also makes this correct under
 * StrictMode's double-invoked effects for free.
 *
 * **Stale data for a key you have moved off.** The result is stored *with the
 * key that produced it*, and anything recorded under a different key is treated
 * as if nothing had been read yet. That is why there is no "mark as loading"
 * setState when a key changes: the mismatch already does the job. Flicking the
 * old day's entry onto the screen for one frame while the new day loads is not
 * a thing a user should ever see, and a spinner cannot fix it.
 *
 * ## On `isRefreshing`
 *
 * Deliberately absent. It would mean tracking that a fetch is in flight, which
 * needs a state update at the *start* of an effect — exactly the
 * cascading-render pattern React's own lint rules exist to discourage, since it
 * buys an extra render pass to show a spinner over data that is already
 * correct. Nothing in the MVP needs it. If a later screen genuinely wants a
 * subtle "updated" hint, `T-62` can add it then, with a real reason.
 *
 * Pure React plus `expo-router`'s focus API. No SQLite here (R-8) — the caller
 * closes over the database and hands in a loader.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncData<T> = {
  /**
   * The result, or `undefined` if there is nothing settled for the current key.
   *
   * `undefined` is not the same as a loader that resolved to `undefined`:
   * `useEntryForDate` resolves to `null` for an unlogged day, which is data,
   * whereas `undefined` here means "not read yet". A screen must not treat the
   * second as a reason to prompt for input, or a day already logged would look
   * empty for a frame on every open.
   */
  data: T | undefined;
  /** The failure for the current key, or `undefined`. */
  error: Error | undefined;
  /** Nothing has been read for the current key, so show a spinner. */
  isLoading: boolean;
  /** Re-run now. Safe to call from a button or a focus event. */
  reload: () => void;
};

export type AsyncDataOptions = {
  /**
   * Re-run when the screen regains focus.
   *
   * On for anything a user can change elsewhere in the app, off for data that
   * cannot change while this screen is unfocused. Re-running on focus is what
   * makes "log today, go back, see it in History" work without a cache layer
   * to invalidate.
   */
  refetchOnFocus?: boolean;
};

/** Non-`Error` rejections still need to reach the UI as something displayable. */
function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/** A settled read, tagged with the key it was read for. */
type Record2<T> = { key: string; data?: T; error?: Error };

export function useAsyncData<T>(
  load: () => Promise<T>,
  /**
   * Identity of this query, as a single stable string.
   *
   * A string rather than a dependency array on purpose: it is the same thing a
   * query cache would key on, it cannot be got subtly wrong, and it keeps the
   * effect's dependency list a fixed literal that the hooks lint can check.
   * Callers compose it from the inputs, e.g. `` `range:${from}:${to}` ``.
   */
  key: string,
  options: AsyncDataOptions = {},
): AsyncData<T> {
  const { refetchOnFocus = false } = options;

  const [record, setRecord] = useState<Record2<T> | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // The loader is an inline closure, so it is a new function on every render and
  // cannot be an effect dependency. Holding it in a ref keeps the loading effect
  // keyed on `key` and `reloadToken` alone. This effect is declared *before* the
  // loading effect, so within any one render pass the ref is already current by
  // the time the load starts.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    let cancelled = false;

    loadRef.current().then(
      (value) => {
        if (cancelled) {
          return;
        }
        setRecord({ key, data: value });
      },
      (reason: unknown) => {
        if (cancelled) {
          return;
        }
        setRecord({ key, error: toError(reason) });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [key, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (refetchOnFocus) {
        reload();
      }
      // No cleanup to register: the loading effect already guards its own result.
      return undefined;
    }, [refetchOnFocus, reload]),
  );

  // A record read under some other key says nothing about the current one.
  const current = record !== null && record.key === key ? record : null;

  return {
    data: current?.data,
    error: current?.error,
    isLoading: current === null,
    reload,
  };
}
