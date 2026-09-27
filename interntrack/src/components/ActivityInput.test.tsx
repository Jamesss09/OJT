/**
 * Tests for the activity field.
 *
 * The AC is "whitespace-only input is blocked by R-3". Rather than assert a
 * hardcoded error string, these tests run the real `validateEntry` and feed its
 * output into the real component — so the assertion is that the R-3 rule
 * reaches the screen, not that a string was typed into a prop. If someone
 * changes the message in `T-13`, these still pass; if they change the *rule*,
 * these fail.
 *
 * Rendered with `react-test-renderer` (already present via `jest-expo`),
 * matching the hook and `HourInput` tests.
 */

import { useState } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { ACTIVITY_MAX_LENGTH, validateEntry } from '@/lib/validation';

import { ActivityInput, type ActivityInputProps } from './ActivityInput';
import { HourInput, type HourInputProps } from './HourInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DATE = '2026-09-28';
const HOURS = '7.5';

/**
 * A fixed clock, so the date in the fixture never becomes a future date and
 * starts failing these tests the day after they were written.
 */
const NOW = new Date(2026, 8, 28, 12, 0, 0);

/** The real R-3 message for `activity`, or `undefined` when it is accepted. */
function activityError(activity: string): string | undefined {
  const result = validateEntry({ dateISO: DATE, hoursText: HOURS, activity }, NOW);
  return result.ok ? undefined : result.errors.activity;
}

/** Controlled wrapper, so typing exercises the real `onChangeText` loop. */
function ActivityHarness(props: Partial<ActivityInputProps> & { initial?: string }) {
  const { initial = '', ...rest } = props;
  const [value, setValue] = useState(initial);
  return <ActivityInput value={value} onChangeText={setValue} {...rest} />;
}

/** The same shape for the hours field, so the two can be compared honestly. */
function HoursHarness(props: Partial<HourInputProps> & { initial?: string }) {
  const { initial = '', ...rest } = props;
  const [value, setValue] = useState(initial);
  return <HourInput value={value} onChangeText={setValue} {...rest} />;
}

function render(element: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(element);
  });
  return renderer;
}

const mountActivity = (props: Partial<ActivityInputProps> & { initial?: string } = {}) =>
  render(<ActivityHarness {...props} />);

const mountHours = (props: Partial<HourInputProps> & { initial?: string } = {}) =>
  render(<HoursHarness {...props} />);

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

function textOf(node: ReactTestInstance): string {
  return String(node.props.children);
}

function type(renderer: ReactTestRenderer, text: string): void {
  act(() => {
    byTestId(renderer, 'activity-input').props.onChangeText(text);
  });
}

function blur(renderer: ReactTestRenderer, testID = 'activity-input'): void {
  act(() => {
    byTestId(renderer, testID).props.onBlur();
  });
}

const counter = (renderer: ReactTestRenderer) => textOf(byTestId(renderer, 'activity-counter'));

describe('ActivityInput', () => {
  describe('R-3 rejects whitespace-only input (the AC)', () => {
    it('is refused by the validator, not merely tolerated', () => {
      // The rule itself, asserted where it lives.
      expect(activityError('   ')).toBe('Describe what you did.');
      expect(activityError('\n\t ')).toBe('Describe what you did.');
      expect(activityError('')).toBe('Describe what you did.');
    });

    it('accepts an activity that is only surrounded by whitespace', () => {
      // Trimming happens before the emptiness check, so a real description with
      // a stray leading space is fine.
      expect(activityError('  Wired the report query  ')).toBeUndefined();
    });

    it('surfaces the validator message inline after a blur', () => {
      const renderer = mountActivity({ initial: '   ', error: activityError('   ') });
      blur(renderer);
      expect(textOf(byTestId(renderer, 'activity-error'))).toBe('Describe what you did.');
    });

    it('counts a whitespace-only field as zero characters', () => {
      // The honest hint at why saving is being refused: the box has three
      // visible spaces and the counter says 0 / 2000.
      const renderer = mountActivity({ initial: '   ' });
      expect(counter(renderer)).toBe(`0 / ${ACTIVITY_MAX_LENGTH}`);
    });
  });

  describe('the 2000-character cap', () => {
    const over = 'x'.repeat(ACTIVITY_MAX_LENGTH + 1);
    const at = 'x'.repeat(ACTIVITY_MAX_LENGTH);

    it('rejects over-length input per R-3', () => {
      expect(activityError(over)).toBe(
        `Keep this under ${ACTIVITY_MAX_LENGTH} characters (currently ${ACTIVITY_MAX_LENGTH + 1}).`,
      );
    });

    it('accepts input exactly at the cap', () => {
      // Off-by-one boundary. 2000 is legal, 2001 is not.
      expect(activityError(at)).toBeUndefined();
    });

    it('hard-caps the field, making the invalid state unreachable', () => {
      // The user cannot type or paste past 2000, so this component can never
      // produce a value that trips the over-length branch above. The branch
      // stays as defence in depth for other callers, such as a JSON restore.
      const renderer = mountActivity();
      expect(byTestId(renderer, 'activity-input').props.maxLength).toBe(ACTIVITY_MAX_LENGTH);
    });

    it('counts the trimmed length, not the raw one', () => {
      // 2000 characters plus trailing whitespace is over the raw limit but
      // legal once trimmed, and the counter must agree with validation.
      const renderer = mountActivity({ initial: `${at}\n\n` });
      expect(counter(renderer)).toBe(`${ACTIVITY_MAX_LENGTH} / ${ACTIVITY_MAX_LENGTH}`);
      expect(activityError(`${at}\n\n`)).toBeUndefined();
    });

    it('warns as the cap approaches, and not before', () => {
      // A field comfortably inside the limit should not sit permanently in the
      // warning colour, or the warning stops meaning anything.
      const roomy = mountActivity({ initial: 'Reviewed the migration' });
      expect(byTestId(roomy, 'activity-counter').props.themeColor).toBe('textSecondary');

      const nearly = mountActivity({ initial: 'x'.repeat(ACTIVITY_MAX_LENGTH - 10) });
      expect(byTestId(nearly, 'activity-counter').props.themeColor).toBe('danger');
    });

    it('announces the remaining budget, since the counter is not a label', () => {
      const renderer = mountActivity({ initial: 'abc' });
      const input = byTestId(renderer, 'activity-input');
      expect(String(input.props.accessibilityHint)).toContain(
        `${ACTIVITY_MAX_LENGTH - 3} left`,
      );
    });
  });

  describe('inline errors', () => {
    it('stays quiet before the field has been blurred', () => {
      const renderer = mountActivity({ initial: '   ', error: activityError('   ') });
      expect(hasTestId(renderer, 'activity-error')).toBe(false);
    });

    it('shows the error without a blur when a parent reveals it', () => {
      // R-13: a failed submit focuses this field, and focusing does not blur.
      const renderer = mountActivity({
        initial: '   ',
        error: activityError('   '),
        revealError: true,
      });
      expect(hasTestId(renderer, 'activity-error')).toBe(true);
    });

    it('shows nothing when the field is valid', () => {
      const renderer = mountActivity({ initial: 'Did the thing', revealError: true });
      expect(hasTestId(renderer, 'activity-error')).toBe(false);
    });

    it('ignores an empty error string rather than rendering a gap', () => {
      const renderer = mountActivity({ initial: 'Did the thing', error: '', revealError: true });
      expect(hasTestId(renderer, 'activity-error')).toBe(false);
    });

    it('forwards the blur to the parent', () => {
      const onBlur = jest.fn();
      const renderer = mountActivity({ initial: 'Did the thing', onBlur });
      blur(renderer);
      expect(onBlur).toHaveBeenCalledTimes(1);
    });
  });

  it('reports every keystroke to the parent', () => {
    // Controlled input: if this regressed, the field would be untypable.
    const renderer = mountActivity();
    type(renderer, 'Reviewed');
    expect(byTestId(renderer, 'activity-input').props.value).toBe('Reviewed');
    expect(counter(renderer)).toBe(`8 / ${ACTIVITY_MAX_LENGTH}`);
  });

  it('is multiline', () => {
    // A single-line field would make a paragraph unreadable and hide the tail
    // of the description the intern just typed.
    const renderer = mountActivity();
    expect(byTestId(renderer, 'activity-input').props.multiline).toBe(true);
  });

  it('does not trim the value as the intern types', () => {
    // Trimming mid-typing moves the caret and eats the space being typed into.
    // R-3's trim belongs to `validateEntry`, at submit.
    const renderer = mountActivity();
    type(renderer, '  Reviewed  ');
    expect(byTestId(renderer, 'activity-input').props.value).toBe('  Reviewed  ');
  });
});

describe('the two fields behave the same way', () => {
  it('gates both errors behind a blur', () => {
    // The form reads as one thing, so the two fields should report problems at
    // the same moment. If one is changed and the other is not, the form becomes
    // inconsistent in a way that is easy to miss.
    const activity = mountActivity({ initial: '   ', error: 'boom' });
    const hours = mountHours({ initial: '25', error: 'boom' });

    expect(hasTestId(activity, 'activity-error')).toBe(false);
    expect(hasTestId(hours, 'hour-error')).toBe(false);

    blur(activity);
    blur(hours, 'hour-input');

    expect(hasTestId(activity, 'activity-error')).toBe(true);
    expect(hasTestId(hours, 'hour-error')).toBe(true);
  });

  it('reveals both errors early when a parent asks', () => {
    // R-13 applies to the form, not to one field, so a submit that fails has to
    // light up both messages at once.
    const activity = mountActivity({ initial: '   ', error: 'boom', revealError: true });
    const hours = mountHours({ initial: '25', error: 'boom', revealError: true });

    expect(hasTestId(activity, 'activity-error')).toBe(true);
    expect(hasTestId(hours, 'hour-error')).toBe(true);
  });

  it('derives both readouts from the stored value, so neither can lie', () => {
    // Surrounded-by-whitespace input is trimmed before it is stored, so the
    // echo and the counter must describe the stored text rather than the raw
    // one, or the screen and the database will disagree.
    const hours = mountHours({ initial: ' 7.5 ' });
    const activity = mountActivity({ initial: '  Done  ' });

    expect(textOf(byTestId(hours, 'hour-echo'))).toBe('7h 30m');
    expect(counter(activity)).toBe(`4 / ${ACTIVITY_MAX_LENGTH}`);
  });
});
