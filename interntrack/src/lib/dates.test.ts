import {
  addDays,
  allTimeRange,
  compareISO,
  dayOfWeek,
  daysInMonth,
  formatDisplayDate,
  formatMonthLabel,
  isFutureISODate,
  isValidISODate,
  monthRange,
  parseISODate,
  toISODate,
  todayISODate,
  weekRange,
} from './dates';

// 2026-09-27 is a Sunday. Anchored fixtures below depend on that.
const SUNDAY = '2026-09-27';
const MONDAY = '2026-09-28';
const SATURDAY = '2026-10-03';

describe('parseISODate', () => {
  it('parses a well-formed date', () => {
    expect(parseISODate('2026-09-27')).toEqual({ year: 2026, month: 9, day: 27 });
  });

  it('rejects malformed strings', () => {
    expect(parseISODate('')).toBeNull();
    expect(parseISODate('2026-9-27')).toBeNull();
    expect(parseISODate('26-09-27')).toBeNull();
    expect(parseISODate('2026/09/27')).toBeNull();
    expect(parseISODate('2026-09-27T00:00:00Z')).toBeNull();
    expect(parseISODate('not a date')).toBeNull();
  });

  it('rejects days that do not exist', () => {
    expect(parseISODate('2026-02-30')).toBeNull();
    expect(parseISODate('2026-04-31')).toBeNull();
    expect(parseISODate('2026-13-01')).toBeNull();
    expect(parseISODate('2026-00-10')).toBeNull();
    expect(parseISODate('2026-01-00')).toBeNull();
    expect(parseISODate('2026-09-32')).toBeNull();
  });

  it('accepts 29 February only in a leap year', () => {
    expect(parseISODate('2028-02-29')).not.toBeNull();
    expect(parseISODate('2026-02-29')).toBeNull();
    expect(parseISODate('2000-02-29')).not.toBeNull();
    expect(parseISODate('1900-02-29')).toBeNull();
  });

  it('round-trips through toISODate', () => {
    for (const iso of ['2026-01-01', '2026-12-31', '2028-02-29', '2026-09-27']) {
      const parsed = parseISODate(iso);
      expect(parsed).not.toBeNull();
      expect(toISODate(parsed!)).toBe(iso);
    }
  });
});

describe('isValidISODate', () => {
  it('is the boolean form of parseISODate', () => {
    expect(isValidISODate('2026-09-27')).toBe(true);
    expect(isValidISODate('2026-02-31')).toBe(false);
    expect(isValidISODate('')).toBe(false);
  });
});

describe('todayISODate', () => {
  it('uses local calendar fields, not UTC (R-4)', () => {
    // 23:30 local on the 27th. If this read UTC it could report the 28th
    // (or the 26th in a negative offset), which is exactly the bug R-4 bans.
    const lateEvening = new Date(2026, 8, 27, 23, 30, 0);
    expect(todayISODate(lateEvening)).toBe(SUNDAY);

    const earlyMorning = new Date(2026, 8, 27, 0, 5, 0);
    expect(todayISODate(earlyMorning)).toBe(SUNDAY);
  });

  it('pads single-digit months and days', () => {
    expect(todayISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('isFutureISODate', () => {
  const now = new Date(2026, 8, 27, 12, 0, 0);

  it('treats today as not future', () => {
    expect(isFutureISODate(SUNDAY, now)).toBe(false);
  });

  it('detects later days', () => {
    expect(isFutureISODate(MONDAY, now)).toBe(true);
    expect(isFutureISODate('2027-01-01', now)).toBe(true);
  });

  it('treats earlier days as not future', () => {
    expect(isFutureISODate('2026-09-26', now)).toBe(false);
    expect(isFutureISODate('2020-01-01', now)).toBe(false);
  });

  it('is false for invalid input rather than throwing', () => {
    expect(isFutureISODate('nonsense', now)).toBe(false);
  });
});

describe('addDays', () => {
  it('moves within a month', () => {
    expect(addDays('2026-09-27', 1)).toBe(MONDAY);
    expect(addDays('2026-09-28', -1)).toBe(SUNDAY);
  });

  it('rolls over month boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-03-31', 1)).toBe('2026-04-01');
  });

  it('rolls over year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('handles the leap day in both directions', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    // 2026 is not a leap year: 28 Feb is followed by 1 Mar.
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('handles a zero offset', () => {
    expect(addDays(SUNDAY, 0)).toBe(SUNDAY);
  });

  it('throws on invalid input', () => {
    expect(() => addDays('2026-02-31', 1)).toThrow(RangeError);
  });
});

describe('dayOfWeek / daysInMonth', () => {
  it('reports the day of week, Sunday = 0', () => {
    expect(dayOfWeek(SUNDAY)).toBe(0);
    expect(dayOfWeek(MONDAY)).toBe(1);
    expect(dayOfWeek(SATURDAY)).toBe(6);
  });

  it('reports month lengths including leap years', () => {
    expect(daysInMonth('2026-01-15')).toBe(31);
    expect(daysInMonth('2026-02-15')).toBe(28);
    expect(daysInMonth('2028-02-15')).toBe(29);
    expect(daysInMonth('2026-04-15')).toBe(30);
  });
});

describe('weekRange (Monday to Sunday, R-5)', () => {
  it('starts the week on Monday when given a Sunday', () => {
    expect(weekRange(SUNDAY)).toEqual({ start: '2026-09-21', end: '2026-09-27' });
  });

  it('starts the week on Monday when given a Monday', () => {
    expect(weekRange(MONDAY)).toEqual({ start: MONDAY, end: '2026-10-04' });
  });

  it('is stable for every day of the same week', () => {
    const expected = { start: '2026-09-28', end: '2026-10-04' };
    for (const iso of ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']) {
      expect(weekRange(iso)).toEqual(expected);
    }
  });

  it('never produces a partial week across a month boundary (R-5)', () => {
    // The week containing 1 Oct starts 28 Sep, so it is a full 7 days even
    // though it straddles two months.
    expect(weekRange('2026-10-01')).toEqual({ start: '2026-09-28', end: '2026-10-04' });
  });

  it('handles a week spanning a year boundary', () => {
    expect(weekRange('2027-01-01')).toEqual({ start: '2026-12-28', end: '2027-01-03' });
  });

  it('handles a leap day inside the week', () => {
    expect(weekRange('2028-02-29')).toEqual({ start: '2028-02-28', end: '2028-03-05' });
  });
});

describe('monthRange', () => {
  it('covers a 31-day month', () => {
    expect(monthRange('2026-09-27')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
  });

  it('covers February in common and leap years', () => {
    expect(monthRange('2026-02-15')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthRange('2028-02-15')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });

  it('covers a 30-day month', () => {
    expect(monthRange('2026-04-10')).toEqual({ start: '2026-04-01', end: '2026-04-30' });
  });

  it('handles December and January', () => {
    expect(monthRange('2026-12-15')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
    expect(monthRange('2027-01-05')).toEqual({ start: '2027-01-01', end: '2027-01-31' });
  });
});

describe('compareISO / allTimeRange', () => {
  it('orders dates', () => {
    expect(compareISO('2026-09-27', '2026-09-28')).toBeLessThan(0);
    expect(compareISO('2026-09-28', '2026-09-27')).toBeGreaterThan(0);
    expect(compareISO('2026-09-27', '2026-09-27')).toBe(0);
  });

  it('spans every representable date', () => {
    expect(allTimeRange()).toEqual({ start: '0000-01-01', end: '9999-12-31' });
    expect('2026-09-27' > allTimeRange().start).toBe(true);
    expect('2026-09-27' < allTimeRange().end).toBe(true);
  });
});

describe('formatting', () => {
  it('formats a display date with an explicit locale', () => {
    expect(formatDisplayDate('2026-09-27', 'en-GB')).toBe('Sun, 27 Sept 2026');
  });

  it('formats a month label with an explicit locale', () => {
    expect(formatMonthLabel('2026-09-27', 'en-GB')).toBe('September 2026');
  });

  it('throws on invalid input', () => {
    expect(() => formatDisplayDate('2026-13-01', 'en-GB')).toThrow(RangeError);
    expect(() => formatMonthLabel('nope', 'en-GB')).toThrow(RangeError);
  });
});
