/**
 * Tests for the read-only settings hooks.
 *
 * Thin by design — the parsing and clamping all live in the repository and are
 * tested there. What is worth asserting here is the shape the screen depends on:
 * `useRequiredMinutes` must hand back `0` for an unset target, because `0` is
 * exactly what makes `ProgressBar` hide itself (R-6). If that convention drifted
 * to `undefined` or a default like 8 h, the bar would appear claiming a target
 * nobody set.
 *
 * Mocked: `expo-router` for `useFocusEffect` (it calls `useNavigation()` before
 * its effect and throws without a navigation container) and `expo-sqlite` for
 * `useSQLiteContext`. Everything below the hook is real, running the real
 * migration and the real repository.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createElement } from 'react';

import { migrateDatabase } from '@/db/client';
import { createTestDatabase, type TestDatabase } from '@/db/testing/nodeSqliteTestDouble';
import { writeSettings } from '@/db/repositories/settings.repo';

import { useRequiredMinutes, useSettings } from './useSettings';

jest.mock('expo-router', () => ({
  useFocusEffect: () => undefined,
}));

// `mock`-prefixed: Jest's babel plugin rejects out-of-scope names in a factory.
let mockDb: TestDatabase;

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: () => mockDb,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handle<T> = {
  /** Latest render's value. Never destructure this - the getter is the point. */
  readonly current: T;
  unmount: () => void;
};

function renderHook<T>(useHook: () => T): Handle<T> {
  const box: { current: T | undefined } = { current: undefined };
  let renderer: ReactTestRenderer | undefined;

  function Harness() {
    box.current = useHook();
    return null;
  }

  act(() => {
    // `createElement` rather than JSX: this is a `.ts` file, and the sibling
    // `useEntries.test.ts` does the same.
    renderer = create(createElement(Harness));
  });

  return {
    get current() {
      if (box.current === undefined) throw new Error('Hook was never rendered.');
      return box.current;
    },
    unmount: () => {
      act(() => {
        renderer?.unmount();
      });
    },
  };
}

/** Let every queued promise continuation run, then re-render. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(async () => {
  mockDb = createTestDatabase();
  await migrateDatabase(mockDb);
});

afterEach(() => {
  mockDb?.close();
});

describe('useSettings', () => {
  it('returns the defaults when nothing has been written yet', async () => {
    const hook = renderHook(() => useSettings());
    await settle();
    expect(hook.current.data?.internName).toBe('');
    // `undefined`, not `null`: `AsyncData.error` is absent on success, and a
    // screen that checks `=== null` would treat this as a failure.
    expect(hook.current.error).toBeUndefined();
    expect(hook.current.isLoading).toBe(false);
    hook.unmount();
  });

  it('returns what was written', async () => {
    await writeSettings(mockDb, { internName: 'James', requiredMinutes: 600 });
    const hook = renderHook(() => useSettings());
    await settle();
    expect(hook.current.data?.internName).toBe('James');
    expect(hook.current.data?.requiredMinutes).toBe(600);
    hook.unmount();
  });
});

describe('useRequiredMinutes', () => {
  it('is 0 when no target is set, which is what hides the progress bar', async () => {
    // R-6. The assertion is the exact number, not merely "falsy": a default
    // of 8h here would put a bar on screen claiming a target nobody entered.
    const hook = renderHook(() => useRequiredMinutes());
    await settle();
    expect(hook.current.data).toBe(0);
    hook.unmount();
  });

  it('is the stored target once one is set', async () => {
    await writeSettings(mockDb, { requiredMinutes: 450 });
    const hook = renderHook(() => useRequiredMinutes());
    await settle();
    expect(hook.current.data).toBe(450);
    hook.unmount();
  });

  it('stays 0 rather than inventing a target from the daily one', async () => {
    // dailyTargetMinutes is a real setting and is NOT a programme total.
    // Confusing the two would be a plausible and completely wrong bar.
    await writeSettings(mockDb, { dailyTargetMinutes: 480, requiredMinutes: 0 });
    const hook = renderHook(() => useRequiredMinutes());
    await settle();
    expect(hook.current.data).toBe(0);
    hook.unmount();
  });
});
