/**
 * Tests for the progress bar.
 *
 * R-6 has three clauses and each has an AC, so each gets its own block:
 * an unset target hides the bar, the fill clamps at 100%, and the true numbers
 * stay readable underneath.
 *
 * This is a pure view, so `react-test-renderer` is enough. No database, no
 * clock, no navigation container.
 */

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { formatDuration } from '@/lib/hours';

import { hasTarget, ProgressBar } from './ProgressBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOUR = 60;

function mount(props: Parameters<typeof ProgressBar>[0]): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<ProgressBar {...props} />);
  });
  return renderer;
}

const byTestId = (r: ReactTestRenderer, id: string): ReactTestInstance => {
  const m = r.root.findAllByProps({ testID: id });
  if (m.length === 0) throw new Error(`No node with testID "${id}".`);
  return m[0];
};

const hasTestId = (r: ReactTestRenderer, id: string): boolean =>
  r.root.findAllByProps({ testID: id }).length > 0;

/** The fill's width, as a percentage of the track. */
const fillPercent = (r: ReactTestRenderer): number => {
  const style = byTestId(r, 'progress-fill').props.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
  return Number(String(flat.width).replace('%', ''));
};

const caption = (r: ReactTestRenderer): string =>
  String(byTestId(r, 'progress-caption').props.children);

describe('ProgressBar', () => {
  describe('R-6: an unset target hides the bar (the AC)', () => {
    it('renders nothing at all when requiredMinutes is 0', () => {
      // Not a 0% bar, and not a hidden bar with a stray label: there is no
      // target, so there is no progress to report.
      const r = mount({ totalMinutes: 40 * HOUR, requiredMinutes: 0 });
      expect(r.toJSON()).toBeNull();
    });

    it('does not render a caption or a track either', () => {
      const r = mount({ totalMinutes: 40 * HOUR, requiredMinutes: 0 });
      expect(hasTestId(r, 'progress-caption')).toBe(false);
      expect(hasTestId(r, 'progress-track')).toBe(false);
    });

    it('never divides by zero, even with a large total', () => {
      // The failure this guards is Infinity% or NaN% leaking into a width, not
      // a crash. Returning null is the observable proof that the division never
      // happened: there is no width and no caption to be NaN.
      expect(() => mount({ totalMinutes: 9999 * HOUR, requiredMinutes: 0 })).not.toThrow();
      const r = mount({ totalMinutes: 9999 * HOUR, requiredMinutes: 0 });
      expect(r.toJSON()).toBeNull();
    });

    it('treats a negative target as unset, since it is not a real target', () => {
      const r = mount({ totalMinutes: 10 * HOUR, requiredMinutes: -60 });
      expect(r.toJSON()).toBeNull();
    });

    it('hasTarget agrees with what the component does', () => {
      expect(hasTarget(0)).toBe(false);
      expect(hasTarget(-1)).toBe(false);
      expect(hasTarget(NaN)).toBe(false);
      expect(hasTarget(Infinity)).toBe(false);
      expect(hasTarget(1)).toBe(true);
      expect(hasTarget(300 * HOUR)).toBe(true);
    });
  });

  describe('R-6: the fill clamps at 100% but the numbers do not', () => {
    it('fills fully when the target is exceeded', () => {
      const r = mount({ totalMinutes: 412 * HOUR, requiredMinutes: 300 * HOUR });
      expect(fillPercent(r)).toBe(100);
    });

    it('still reports the true, over-target numbers', () => {
      // The whole point of R-6's second clause. If the caption were capped too,
      // a record of 412 h would read as 300 h and the surplus would be invisible.
      // `formatDuration` drops a zero minute part, so this is "412h of 300h".
      const r = mount({ totalMinutes: 412 * HOUR, requiredMinutes: 300 * HOUR });
      expect(caption(r)).toBe('412h of 300h');
      expect(caption(r)).not.toBe('300h of 300h');
    });

    it('keeps the surplus visible rather than rounding it away', () => {
      // 7h 30m of 7h: the bar is full, the hours are not the same, and both
      // must be readable.
      const r = mount({ totalMinutes: 7 * HOUR + 30, requiredMinutes: 7 * HOUR });
      expect(fillPercent(r)).toBe(100);
      expect(caption(r)).toBe('7h 30m of 7h');
    });

    it('does not emit a width above 100%, which Android mis-renders', () => {
      // 5000 h against a 300 h target is 1666%. `Math.min(1, ...)` is what stops
      // that reaching the layout engine; without it this asserts 1667.
      const r = mount({ totalMinutes: 5000 * HOUR, requiredMinutes: 300 * HOUR });
      expect(fillPercent(r)).toBe(100);
      expect(fillPercent(r)).toBeLessThanOrEqual(100);
    });

    it('fills in proportion below the target', () => {
      // Exact values, so a wrong formula cannot hide behind rounding.
      expect(fillPercent(mount({ totalMinutes: 0, requiredMinutes: 100 * HOUR }))).toBe(0);
      expect(fillPercent(mount({ totalMinutes: 50 * HOUR, requiredMinutes: 100 * HOUR }))).toBe(50);
      expect(fillPercent(mount({ totalMinutes: 25 * HOUR, requiredMinutes: 100 * HOUR }))).toBe(25);
    });

    it('rounds the fill to a whole percent, not full float noise', () => {
      // 100 minutes of a 300-minute target is 33.333...%. A raw float would put
      // "33.333333333333336%" in a style object.
      const p = fillPercent(mount({ totalMinutes: 100, requiredMinutes: 300 }));
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBe(33);
    });

    it('produces a width the layout engine accepts', () => {
      // A float percentage is legal but unrounded. Assert range and integrality
      // together, since both are properties of the same value. A negative total
      // is covered separately: `formatDuration` throws on one before this point.
      for (const total of [0, 1, 37, 100 * HOUR, 412 * HOUR, 99_999 * HOUR]) {
        const p = fillPercent(mount({ totalMinutes: total, requiredMinutes: 100 * HOUR }));
        expect(Number.isInteger(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('the numbers', () => {
    it('uses formatDuration, so minutes never appear as a decimal hour', () => {
      // R-1: 7.5 + 7.5 != 15 in float, and the same reason totals are rendered
      // as "7h 30m" rather than "7.5 h". Delegating to formatDuration is what
      // guarantees it, so assert the delegation as well as the output.
      const total = 7 * HOUR + 30;
      const target = 20 * HOUR;
      const r = mount({ totalMinutes: total, requiredMinutes: target });
      expect(caption(r)).toBe(`${formatDuration(total)} of ${formatDuration(target)}`);
      expect(caption(r)).toBe('7h 30m of 20h');
      expect(caption(r)).not.toContain('7.5');
    });

    it('shows a real zero when nothing is logged yet', () => {
      // Nothing logged, but a target *is* set, so the bar renders empty with a
      // caption reading "0h", not an absent caption.
      const r = mount({ totalMinutes: 0, requiredMinutes: 300 * HOUR });
      expect(caption(r)).toBe('0h of 300h');
      expect(fillPercent(r)).toBe(0);
    });

    it('renders the optional label when given one', () => {
      const r = mount({ totalMinutes: 10 * HOUR, requiredMinutes: 100 * HOUR, label: 'Overall' });
      expect(r.root.findAllByProps({ children: 'Overall' }).length).toBeGreaterThan(0);
    });

    it('omits the label element entirely when not given one', () => {
      const r = mount({ totalMinutes: 10 * HOUR, requiredMinutes: 100 * HOUR });
      expect(r.root.findAllByProps({ children: 'Overall' }).length).toBe(0);
    });
  });

  it('rejects a negative total instead of rendering a negative bar', () => {
    // `formatDuration` throws on a negative minute count, and it is called
    // during render, so the throw surfaces here. That is deliberate: a negative
    // total is unreachable from SQLite (the CHECK constraint in migration 1
    // forbids it), so this guards against a bad caller, not against user data.
    // A silent "0%" would hide a real bug.
    expect(() => mount({ totalMinutes: -HOUR, requiredMinutes: 100 * HOUR })).toThrow(RangeError);
  });

  it('is announced as a progressbar', () => {
    // `findAllByProps` matches both the composite element and the host View it
    // renders, so two hits is one role, not two.
    const r = mount({ totalMinutes: 50 * HOUR, requiredMinutes: 100 * HOUR });
    const roles = r.root.findAllByProps({ accessibilityRole: 'progressbar' });
    expect(roles.length).toBeGreaterThan(0);
    expect(roles.every((n) => n.props.accessibilityRole === 'progressbar')).toBe(true);
  });
});
