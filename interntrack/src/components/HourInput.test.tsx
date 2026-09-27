/**
 * Tests for the hours field.
 *
 * The AC is "rejects > 24 h inline before submit", but the more valuable thing
 * to pin down here is the R-1 echo: the field must show a duration that is
 * exact for every minute value. A `minutes → "7.5 h"` formatter was deleted in
 * `T-11` precisely because it lied, and `7.01` is the case that proves it — the
 * decimal reading is `7.01`, the true duration is `7h 1m`, and the two are not
 * the same number of minutes.
 *
 * Rendered with `react-test-renderer` (already present via `jest-expo`) rather
 * than `@testing-library/react-native`, for the same reason as the hook tests:
 * one small dependency already in the tree beats a new one for a wrapper this
 * small. Interactions go through the `TextInput`'s props, which is all this
 * component exposes.
 */

import { useState } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { MAX_MINUTES_PER_DAY, formatDuration, toMinutes } from '@/lib/hours';

import { HourInput, type HourInputProps } from './HourInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Controlled wrapper, so typing exercises the real `onChangeText` loop. */
function Harness({ initial = '', ...rest }: Partial<HourInputProps> & { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <HourInput value={value} onChangeText={setValue} {...rest} />;
}

function mount(props: Partial<HourInputProps> & { initial?: string } = {}): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Harness {...props} />);
  });
  return renderer;
}

/** Outermost node carrying `testID`; the composite is the one with handlers. */
function byTestId(renderer: ReactTestRenderer, testID: string): ReactTestInstance {
  const matches = renderer.root.findAllByProps({ testID });
  if (matches.length === 0) {
    throw new Error(`No node with testID "${testID}".`);
  }
  return matches[0];
}

function hasTestId(renderer: ReactTestRenderer, testID: string): boolean {
  return renderer.root.findAllByProps({ testID }).length > 0;
}

/** The text a themed `Text` was asked to render. */
function textOf(node: ReactTestInstance): string {
  return String(node.props.children);
}

function echoOf(renderer: ReactTestRenderer): string | null {
  return hasTestId(renderer, 'hour-echo') ? textOf(byTestId(renderer, 'hour-echo')) : null;
}

/** Type `text` into the field, the way a keystroke would. */
function type(renderer: ReactTestRenderer, text: string): void {
  act(() => {
    byTestId(renderer, 'hour-input').props.onChangeText(text);
  });
}

function blur(renderer: ReactTestRenderer): void {
  act(() => {
    byTestId(renderer, 'hour-input').props.onBlur();
  });
}

describe('HourInput', () => {
  describe('the echo (R-1)', () => {
    it('shows nothing for an empty field', () => {
      const renderer = mount();
      expect(echoOf(renderer)).toBeNull();
    });

    it('shows the exact duration for a decimal entry', () => {
      // The headline case: 7.5 h is 450 minutes, and "7h 30m" says so.
      const renderer = mount({ initial: '7.5' });
      expect(echoOf(renderer)).toBe('7h 30m');
    });

    it('does not round-trip through decimal hours', () => {
      // 7.01 h is 420.6 minutes, stored as 421. Displaying "7.01 h" would show a
      // figure that converts back to 420 — a silent 1-minute lie. The deleted
      // formatter did exactly this for 2 of every 3 values.
      const renderer = mount({ initial: '7.01' });
      expect(echoOf(renderer)).toBe('7h 1m');
      expect(echoOf(renderer)).not.toBe('7.01 h');
    });

    it('agrees with formatDuration for every minute value it accepts', () => {
      // A property check, not an example: for all of these the echo must equal
      // `formatDuration` and must never contain a bare decimal hour figure.
      const inputs = ['0.5', '1', '1.25', '2.5', '7.5', '7.01', '12.34', '23.59', '24'];
      for (const input of inputs) {
        const renderer = mount({ initial: input });
        const minutes = toMinutes(input);
        expect(minutes).not.toBeNull();
        expect(echoOf(renderer)).toBe(formatDuration(minutes as number));
      }
    });

    it('shows no echo for input that is not yet a duration', () => {
      // `null` from `toMinutes` means empty, mid-typing, or malformed. None of
      // them has a duration to echo, and inventing one would be a guess.
      for (const input of ['', '7.', 'abc', '7.333', '25', '-1', '0']) {
        const renderer = mount({ initial: input });
        expect(echoOf(renderer)).toBeNull();
      }
    });

    it('accepts a full 24-hour day', () => {
      const renderer = mount({ initial: '24' });
      expect(toMinutes('24')).toBe(MAX_MINUTES_PER_DAY);
      expect(echoOf(renderer)).toBe('24h');
    });

    it('announces the converted value, since a screen reader cannot see it', () => {
      // The echo is visual only. Without this, the converted figure would be
      // unavailable to anyone not looking at the screen.
      const renderer = mount({ initial: '7.5' });
      const input = byTestId(renderer, 'hour-input');
      expect(String(input.props.accessibilityHint)).toContain('7h 30m');
    });
  });

  describe('inline errors (the AC)', () => {
    const error = 'Enter hours between 0 and 24, e.g. 7.5.';

    it('stays quiet before the field has been blurred', () => {
      // Showing this while someone types `7.` on the way to `7.5` reports an
      // error they have not made.
      const renderer = mount({ initial: '25', error });
      expect(hasTestId(renderer, 'hour-error')).toBe(false);
    });

    it('rejects > 24 h inline as soon as the field is left', () => {
      // The AC: rejected before submit, not at submit.
      const renderer = mount({ initial: '25', error });
      blur(renderer);

      expect(hasTestId(renderer, 'hour-error')).toBe(true);
      expect(textOf(byTestId(renderer, 'hour-error'))).toBe(error);
    });

    it('shows the error without a blur when a parent reveals it', () => {
      // R-13: a failed submit focuses the first invalid field. Focusing does
      // not blur, so without `revealError` the intern would see a focused field
      // with no explanation.
      const renderer = mount({ initial: '25', error, revealError: true });
      expect(hasTestId(renderer, 'hour-error')).toBe(true);
    });

    it('shows nothing when the field is valid', () => {
      const renderer = mount({ initial: '7.5', revealError: true });
      expect(hasTestId(renderer, 'hour-error')).toBe(false);
    });

    it('ignores an empty error string rather than rendering a gap', () => {
      const renderer = mount({ initial: '7.5', error: '', revealError: true });
      expect(hasTestId(renderer, 'hour-error')).toBe(false);
    });

    it('forwards the blur to the parent', () => {
      const onBlur = jest.fn();
      const renderer = mount({ initial: '7.5', onBlur });
      blur(renderer);
      expect(onBlur).toHaveBeenCalledTimes(1);
    });
  });

  it('reports every keystroke to the parent', () => {
    // Controlled input: if this regressed, the field would be untypable.
    const renderer = mount();
    type(renderer, '7');
    expect(byTestId(renderer, 'hour-input').props.value).toBe('7');

    type(renderer, '7.5');
    expect(byTestId(renderer, 'hour-input').props.value).toBe('7.5');
    expect(echoOf(renderer)).toBe('7h 30m');
  });

  it('lets a parent clear the field back to empty', () => {
    const renderer = mount({ initial: '7.5' });
    type(renderer, '');
    expect(echoOf(renderer)).toBeNull();
  });
});
