/**
 * Read-only access to the settings table.
 *
 * ## Why this is separate from the `T-41` settings screen
 *
 * `T-41` owns editing. Today only needs to *read* two things: the required-hours
 * target, for R-6's progress bar, and `programStartDate`, because R-6 says
 * entries dated before it are excluded from progress. Both change on a different
 * screen, and both are needed here, so this hook exists now rather than in `T-41`.
 *
 * Read-only on purpose. There is no `updateSettings` here, because the write path
 * is `T-41`'s and having two of them would let the two disagree about what a
 * valid setting is. `readSettingsFromValues` in the repository is the single
 * place that decides that.
 *
 * Same shape as every other read in the app: local query, refetch on focus, no
 * cache. See [[InternTrack Architecture]].
 */

import { useSQLiteContext } from 'expo-sqlite';
import { useCallback } from 'react';

import { type Settings, readSettings } from '@/db/repositories/settings.repo';

import { type AsyncData, useAsyncData } from './useAsyncData';

/**
 * The whole settings row, for the screens that need more than one field.
 *
 * Refetches on focus so returning from `T-41`'s editor shows the new target
 * without any cache invalidation.
 */
export function useSettings(): AsyncData<Settings> {
  const db = useSQLiteContext();

  const load = useCallback(() => readSettings(db), [db]);

  return useAsyncData(load, 'settings', { refetchOnFocus: true });
}

/**
 * The required-hours target in minutes, or `0` when unset.
 *
 * The `0` is the point: R-6 says an unset target hides the progress bar, and
 * `ProgressBar` hides on exactly this value. Returning the number directly means
 * the screen cannot forget that convention and substitute a default.
 */
export function useRequiredMinutes(): AsyncData<number> {
  const db = useSQLiteContext();

  const load = useCallback(
    async () => (await readSettings(db)).requiredMinutes,
    [db],
  );

  return useAsyncData(load, 'settings:requiredMinutes', { refetchOnFocus: true });
}
