/**
 * Tests for the async read primitive.
 *
 * These matter more than most, because the logic under test is the part that
 * cannot be checked on a device: under Option B there is no simulator and no
 * local Android toolchain, so a race that only appears when two reads overlap
 * would otherwise be discovered by a user tapping quickly between days.
 *
 * Rendered with `react-test-renderer`, already present via `jest-expo`.
 * `@testing-library/react` is deliberately not added — the hook renders no
 * React Native components, and a dev dependency for a wrapper this small is not
 * worth the extra moving part.
 *
 * The focus-refetch path is **not** covered here. expo-router's `useFocusEffect`
 * calls `useNavigation()` before its effect runs, and that throws outright
 * without a navigation container, so it is mocked out below. What stays under
 * test is the hook's own logic, which is where the subtle bugs are; the focus
 * wiring is a two-line call to `reload()` and gets exercised by the first EAS
 * build instead.
 */

import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { type AsyncData, useAsyncData } from './useAsyncData';

// Stubs the hook's only navigation dependency. A partial mock, so the hook
// itself is genuinely exercised and only the focus subscription is bypassed.
jest.mock('expo-router', () => ({
  useFocusEffect: () => undefined,
}));

// React requires this flag before `act` will drive updates in a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Loader<T> = (key: string) => Promise<T>;

type Handle<T> = {
  /**
   * The latest render's hook value.
   *
   * A getter on purpose, and **never destructure it** — destructuring reads a
   * getter once and captures that value, which would silently freeze the test
   * on the very first render. Always write `hook.current`.
   */
  readonly current: AsyncData<T>;
  rerender: (key: string) => void;
  unmount: () => void;
};

/** A promise plus the handles to settle it, so tests control read timing. */
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Never settles. For asserting the loading state, not for testing a timeout. */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/** Minimal `renderHook`, since `@testing-library/react` is not installed. */
function renderHook<T>(makeLoader: Loader<T>, initialKey: string): Handle<T> {
  const box: { current: AsyncData<T> | undefined } = { current: undefined };
  let renderer: ReactTestRenderer | undefined;

  function Harness({ hookKey }: { hookKey: string }) {
    box.current = useAsyncData<T>(() => makeLoader(hookKey), hookKey);
    return null;
  }

  act(() => {
    renderer = create(createElement(Harness, { hookKey: initialKey }));
  });

  return {
    get current() {
      if (box.current === undefined) {
        throw new Error('Hook was never rendered.');
      }
      return box.current;
    },
    rerender: (key) => {
      act(() => {
        renderer?.update(createElement(Harness, { hookKey: key }));
      });
    },
    unmount: () => {
      act(() => {
        renderer?.unmount();
      });
    },
  };
}

/** Let the already-queued promise continuations run, then let React re-render. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useAsyncData', () => {
  it('starts out loading, then settles into data', async () => {
    const read = deferred<string>();
    const hook = renderHook(() => read.promise, 'a');

    expect(hook.current.isLoading).toBe(true);
    expect(hook.current.data).toBeUndefined();

    await act(async () => {
      read.resolve('loaded');
    });
    await settle();

    expect(hook.current.isLoading).toBe(false);
    expect(hook.current.data).toBe('loaded');
    expect(hook.current.error).toBeUndefined();
    hook.unmount();
  });

  it('runs the loader once per key', async () => {
    let calls = 0;
    const hook = renderHook(async () => {
      calls += 1;
      return calls;
    }, 'a');

    await settle();
    expect(calls).toBe(1);
    expect(hook.current.data).toBe(1);

    // An unrelated re-render with the same key must not re-read.
    hook.rerender('a');
    expect(calls).toBe(1);

    // A different key is a different question, so it does re-read.
    hook.rerender('b');
    await settle();
    expect(calls).toBe(2);
    hook.unmount();
  });

  // The race the hook exists to prevent.
  it('discards a slow result from a superseded key', async () => {
    const slow = deferred<string>();
    const fast = deferred<string>();

    const hook = renderHook((key) => (key === 'a' ? slow.promise : fast.promise), 'a');

    // Move to the next key while the first read is still in flight.
    hook.rerender('b');

    await act(async () => {
      fast.resolve('B');
    });
    await settle();
    expect(hook.current.data).toBe('B');

    // The stale read now lands. It must not overwrite the newer answer, or the
    // screen shows the previous day under the current day's header.
    await act(async () => {
      slow.resolve('A');
    });
    await settle();
    expect(hook.current.data).toBe('B');
    hook.unmount();
  });

  it('does not show the previous key data while a new key loads', async () => {
    const first = deferred<string>();
    const hook = renderHook((key) => (key === 'a' ? first.promise : pending<string>()), 'a');

    await act(async () => {
      first.resolve('day 28');
    });
    await settle();
    expect(hook.current.data).toBe('day 28');

    // Switching to a day that never resolves: the old day's entry must not sit
    // there under a header that now says something else.
    hook.rerender('b');
    expect(hook.current.isLoading).toBe(true);
    expect(hook.current.data).toBeUndefined();
    hook.unmount();
  });

  it('surfaces a rejection as an Error', async () => {
    const boom = new Error('database is locked');
    const hook = renderHook(async () => {
      throw boom;
    }, 'a');

    await settle();

    expect(hook.current.error).toBe(boom);
    expect(hook.current.isLoading).toBe(false);
    expect(hook.current.data).toBeUndefined();
    hook.unmount();
  });

  it('wraps a non-Error rejection so the UI always gets something displayable', async () => {
    // SQLite drivers reject with all sorts of things.
    const hook = renderHook(async () => {
      throw 'a bare string';
    }, 'a');

    await settle();

    expect(hook.current.error).toBeInstanceOf(Error);
    expect(hook.current.error?.message).toBe('a bare string');
    hook.unmount();
  });

  it('preserves a null result, which means "read, and there is nothing there"', async () => {
    // An unlogged day resolves to null. Treating that as "not loaded yet" would
    // make a day that is already logged look empty for a frame on every open.
    const hook = renderHook(async () => null, 'a');

    await settle();

    expect(hook.current.isLoading).toBe(false);
    expect(hook.current.data).toBeNull();
    hook.unmount();
  });

  it('re-reads on reload', async () => {
    let calls = 0;
    const hook = renderHook(async () => {
      calls += 1;
      return calls;
    }, 'a');

    await settle();
    expect(hook.current.data).toBe(1);

    await act(async () => {
      hook.current.reload();
    });
    await settle();

    expect(calls).toBe(2);
    expect(hook.current.data).toBe(2);
    hook.unmount();
  });

  it('keeps a stable reload identity across renders', async () => {
    // Screens pass this into memoised children and into useCallback deps.
    const hook = renderHook(async () => 'x', 'a');

    await settle();
    const first = hook.current.reload;
    hook.rerender('a');
    expect(hook.current.reload).toBe(first);
    hook.unmount();
  });

  it('clears a previous error once the re-read succeeds', async () => {
    let shouldFail = true;
    const hook = renderHook(async () => {
      if (shouldFail) {
        throw new Error('nope');
      }
      return 'ok';
    }, 'a');

    await settle();
    expect(hook.current.error).toBeInstanceOf(Error);

    shouldFail = false;
    await act(async () => {
      hook.current.reload();
    });
    await settle();

    expect(hook.current.error).toBeUndefined();
    expect(hook.current.data).toBe('ok');
    hook.unmount();
  });

  it('does not carry an old key error into a new key', async () => {
    const hook = renderHook(async (key) => {
      if (key === 'a') {
        throw new Error('a failed');
      }
      return 'b is fine';
    }, 'a');

    await settle();
    expect(hook.current.error).toBeInstanceOf(Error);

    hook.rerender('b');
    // The new key has its own outcome; it must not inherit the old failure.
    expect(hook.current.error).toBeUndefined();
    expect(hook.current.isLoading).toBe(true);

    await settle();
    expect(hook.current.data).toBe('b is fine');
    hook.unmount();
  });

  it('drops an in-flight result when unmounted', async () => {
    // Setting state after unmount is the leak this guards against, and React
    // logs a warning for it that would otherwise be easy to miss in CI.
    const read = deferred<string>();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const hook = renderHook(() => read.promise, 'a');

    hook.unmount();
    await act(async () => {
      read.resolve('too late');
    });
    await settle();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
