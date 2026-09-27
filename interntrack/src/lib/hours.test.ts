import {
  MAX_MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  clampToDay,
  formatDuration,
  splitMinutes,
  toHoursText,
  toMinutes,
} from './hours';

describe('toMinutes', () => {
  it('converts whole and decimal hours', () => {
    expect(toMinutes('7')).toBe(420);
    expect(toMinutes('8')).toBe(480);
    expect(toMinutes('7.5')).toBe(450);
    expect(toMinutes('7.25')).toBe(435);
    expect(toMinutes('7.55')).toBe(453);
  });

  it('accepts a comma decimal separator and surrounding whitespace', () => {
    expect(toMinutes('7,5')).toBe(450);
    expect(toMinutes('  7.5  ')).toBe(450);
    expect(toMinutes('0.5')).toBe(30);
  });

  it('rounds away binary floating point error', () => {
    // 8.3 * 60 === 497.99999999999994 in IEEE 754.
    expect(toMinutes('8.3')).toBe(498);
    // 0.1 * 60 === 6.000000000000001.
    expect(toMinutes('0.1')).toBe(6);
  });

  it('accepts the boundary values', () => {
    expect(toMinutes('24')).toBe(MAX_MINUTES_PER_DAY);
    expect(toMinutes('24.00')).toBe(MAX_MINUTES_PER_DAY);
  });

  it('rejects zero and negative durations', () => {
    expect(toMinutes('0')).toBeNull();
    expect(toMinutes('0.0')).toBeNull();
    expect(toMinutes('0.00')).toBeNull();
    expect(toMinutes('-1')).toBeNull();
    expect(toMinutes('-0.5')).toBeNull();
  });

  it('rejects durations over 24 hours', () => {
    expect(toMinutes('24.01')).toBeNull();
    expect(toMinutes('25')).toBeNull();
    expect(toMinutes('100')).toBeNull();
  });

  it('rejects empty and non-numeric input', () => {
    expect(toMinutes('')).toBeNull();
    expect(toMinutes('   ')).toBeNull();
    expect(toMinutes('.')).toBeNull();
    expect(toMinutes('7.')).toBeNull();
    expect(toMinutes('abc')).toBeNull();
    expect(toMinutes('7h')).toBeNull();
    expect(toMinutes('1e3')).toBeNull();
    expect(toMinutes('NaN')).toBeNull();
    expect(toMinutes('Infinity')).toBeNull();
  });

  it('rejects more than two decimal places rather than silently rounding', () => {
    // 7.333h would round to 440 minutes but reformat to "7.33 h" (439.8 min).
    // Rejecting keeps the stored-minutes / displayed-value round trip exact.
    expect(toMinutes('7.333')).toBeNull();
    expect(toMinutes('0.005')).toBeNull();
  });

  it('rejects malformed digit groups', () => {
    expect(toMinutes('1.2.3')).toBeNull();
    expect(toMinutes('1,5,5')).toBeNull();
    expect(toMinutes('007')).toBeNull();
  });
});

describe('splitMinutes', () => {
  it('splits whole and leftover minutes', () => {
    expect(splitMinutes(480)).toEqual({ hours: 8, minutes: 0 });
    expect(splitMinutes(450)).toEqual({ hours: 7, minutes: 30 });
    expect(splitMinutes(90)).toEqual({ hours: 1, minutes: 30 });
    expect(splitMinutes(45)).toEqual({ hours: 0, minutes: 45 });
    expect(splitMinutes(0)).toEqual({ hours: 0, minutes: 0 });
  });

  it('is lossless for every whole minute in a day (R-1)', () => {
    for (let total = 0; total <= MAX_MINUTES_PER_DAY; total += 1) {
      const { hours, minutes } = splitMinutes(total);
      expect(hours * MINUTES_PER_HOUR + minutes).toBe(total);
      expect(minutes).toBeGreaterThanOrEqual(0);
      expect(minutes).toBeLessThan(MINUTES_PER_HOUR);
    }
  });

  it('rejects non-integer and negative input', () => {
    expect(() => splitMinutes(-1)).toThrow(RangeError);
    expect(() => splitMinutes(7.5)).toThrow(RangeError);
  });
});

describe('formatDuration', () => {
  it('formats exactly, never losing minutes', () => {
    expect(formatDuration(450)).toBe('7h 30m');
    expect(formatDuration(480)).toBe('8h');
    expect(formatDuration(0)).toBe('0h');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(59)).toBe('59m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(61)).toBe('1h 1m');
    expect(formatDuration(MAX_MINUTES_PER_DAY)).toBe('24h');
  });

  it('does not lose a trailing zero minute count', () => {
    // The classic bug: "10.00".replace(/\.?0+$/, "") === "1".
    expect(formatDuration(600)).toBe('10h');
    expect(formatDuration(660)).toBe('11h');
    expect(formatDuration(120)).toBe('2h');
  });

  it('distinguishes 30m from 3m and 5m from 50m (R-1)', () => {
    // A 2-decimal formatter cannot do this correctly: 30 min is 0.5h but
    // 3 min is 0.05h, and 50 min is 0.833...h with no exact 2-dp form.
    expect(formatDuration(30)).toBe('30m');
    expect(formatDuration(3)).toBe('3m');
    expect(formatDuration(50)).toBe('50m');
  });

  it('rejects non-integer and negative input', () => {
    expect(() => formatDuration(-1)).toThrow(RangeError);
    expect(() => formatDuration(7.5)).toThrow(RangeError);
  });
});

describe('exact totals (R-1)', () => {
  it('sums a 7-day week without float drift', () => {
    // 4.5h x 7 === 31.5h === 1890 minutes exactly.
    const day = toMinutes('4.5') as number;
    expect(day).toBe(270);

    const total = Array.from({ length: 7 }, () => day).reduce((acc, m) => acc + m, 0);
    expect(total).toBe(1890);
    expect(formatDuration(total)).toBe('31h 30m');
  });

  it('sums an awkward week with no representable decimal total', () => {
    // 7h 20m x 5 === 2200 min === 36h 40m. As a decimal that is 36.666...h,
    // which is exactly why no decimal-hours output formatter exists.
    const day = toMinutes('7.33') as number;
    expect(day).toBe(440);

    const total = Array.from({ length: 5 }, () => day).reduce((acc, m) => acc + m, 0);
    expect(total).toBe(2200);
    expect(formatDuration(total)).toBe('36h 40m');
  });
});

describe('clampToDay', () => {
  it('clamps into the legal range', () => {
    expect(clampToDay(-5)).toBe(0);
    expect(clampToDay(0)).toBe(0);
    expect(clampToDay(300)).toBe(300);
    expect(clampToDay(2000)).toBe(MAX_MINUTES_PER_DAY);
  });
});

describe('toHoursText', () => {
  it('renders the common values the way they were typed', () => {
    expect(toHoursText(480)).toBe('8');
    expect(toHoursText(450)).toBe('7.5');
    expect(toHoursText(60)).toBe('1');
  });

  it('keeps two decimals where they are needed', () => {
    expect(toHoursText(90)).toBe('1.5');
    expect(toHoursText(440)).toBe('7.33');
  });

  /**
   * The property the whole function exists for, checked exhaustively.
   *
   * I expected this to fail for most values. One minute is 0.0166…h, so it seemed
   * obvious that a 2-decimal hour form could not represent it, and that an edit
   * form pre-filling from stored minutes would lose a minute somewhere. Running
   * all 1440 legal counts says otherwise: 2dp is 0.005h = 0.3 min of resolution,
   * comfortably inside the ±0.5 min that `toMinutes` rounds away.
   *
   * If `HOURS_INPUT` ever gains a third decimal place, or the rounding changes,
   * this fails rather than the app quietly writing the wrong hours.
   */
  it('round-trips every legal minute count through the input format', () => {
    for (let minutes = 1; minutes <= MAX_MINUTES_PER_DAY; minutes++) {
      const text = toHoursText(minutes);
      expect(toMinutes(text)).toBe(minutes);
    }
  });

  it('produces text the input regex accepts', () => {
    // The same property from the other side: if `toHoursText` emitted anything
    // `toMinutes` rejects, re-saving an untouched edit form would fail.
    for (let minutes = 1; minutes <= MAX_MINUTES_PER_DAY; minutes++) {
      expect(toMinutes(toHoursText(minutes))).not.toBeNull();
    }
  });

  it('is not a decimal-hours formatter, and does not claim to be', () => {
    // `toHoursText(440)` is "7.33" while the real value is 7h 20m. That is
    // acceptable for a form field precisely because it round-trips, and is not
    // acceptable for text a person reads, which is why `formatDuration` exists
    // and is used for every displayed total.
    expect(toHoursText(440)).toBe('7.33');
    expect(formatDuration(440)).toBe('7h 20m');
  });

  it('rejects a non-integer minute count rather than rounding it', () => {
    // Same contract as the rest of the module: `assertWholeMinutes` throws.
    expect(() => toHoursText(7.5)).toThrow(RangeError);
  });

  it('renders zero as "0", which R-3 would reject as an entry', () => {
    // Not reachable from the database - no entry can be 0 minutes - but stated
    // so the behaviour is recorded rather than left to be discovered.
    expect(toHoursText(0)).toBe('0');
    expect(toMinutes(toHoursText(0))).toBeNull();
  });
});
