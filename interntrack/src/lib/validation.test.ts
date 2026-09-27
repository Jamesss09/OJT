import {
  ACTIVITY_MAX_LENGTH,
  type EntryDraft,
  FIELD_ORDER,
  firstInvalidField,
  validateEntry,
} from './validation';

const NOW = new Date(2026, 8, 27, 12, 0, 0); // Sun 27 Sep 2026, local

function draft(overrides: Partial<EntryDraft> = {}): EntryDraft {
  return {
    dateISO: '2026-09-27',
    hoursText: '7.5',
    activity: 'Shadowed the support team and fixed two tickets.',
    ...overrides,
  };
}

describe('validateEntry — happy path', () => {
  it('accepts a valid draft and normalises it', () => {
    const result = validateEntry(draft(), NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        entryDate: '2026-09-27',
        minutes: 450,
        activity: 'Shadowed the support team and fixed two tickets.',
      });
    }
  });

  it('trims surrounding whitespace off the activity', () => {
    const result = validateEntry(draft({ activity: '   wrote docs   ' }), NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.activity).toBe('wrote docs');
    }
  });

  it('accepts today and past dates', () => {
    expect(validateEntry(draft({ dateISO: '2026-09-27' }), NOW).ok).toBe(true);
    expect(validateEntry(draft({ dateISO: '2020-01-01' }), NOW).ok).toBe(true);
  });

  it('accepts the boundary durations', () => {
    expect(validateEntry(draft({ hoursText: '0.5' }), NOW).ok).toBe(true);
    expect(validateEntry(draft({ hoursText: '24' }), NOW).ok).toBe(true);
  });
});

describe('validateEntry — date (R-3)', () => {
  it('rejects a future date', () => {
    const result = validateEntry(draft({ dateISO: '2026-09-28' }), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.dateISO).toMatch(/hasn't happened/);
    }
  });

  it('rejects a date that does not exist', () => {
    const result = validateEntry(draft({ dateISO: '2026-02-30' }), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.dateISO).toMatch(/does not exist/);
    }
  });

  it('rejects a malformed date', () => {
    for (const dateISO of ['', '26-09-27', '2026-9-27', 'today', '2026-09-27T00:00:00Z']) {
      expect(validateEntry(draft({ dateISO }), NOW).ok).toBe(false);
    }
  });

  it('distinguishes "does not exist" from "in the future"', () => {
    const future = validateEntry(draft({ dateISO: '2027-01-01' }), NOW);
    const impossible = validateEntry(draft({ dateISO: '2026-02-31' }), NOW);
    if (!future.ok && !impossible.ok) {
      expect(future.errors.dateISO).not.toBe(impossible.errors.dateISO);
    }
  });
});

describe('validateEntry — hours (R-3)', () => {
  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['zero', '0'],
    ['negative', '-1'],
    ['over 24', '24.01'],
    ['far over 24', '100'],
    ['not a number', 'abc'],
    ['too many decimals', '7.333'],
  ])('rejects %s hours', (_label, hoursText) => {
    const result = validateEntry(draft({ hoursText }), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.hoursText).toMatch(/between 0 and 24/);
    }
  });

  it('reports the error against the hours field, not the date', () => {
    const result = validateEntry(draft({ hoursText: '0' }), NOW);
    if (!result.ok) {
      expect(result.errors.hoursText).toBeDefined();
      expect(result.errors.dateISO).toBeUndefined();
    }
  });
});

describe('validateEntry — activity (R-3)', () => {
  it('rejects an empty activity', () => {
    const result = validateEntry(draft({ activity: '' }), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.activity).toMatch(/Describe what you did/);
    }
  });

  it('rejects a whitespace-only activity', () => {
    expect(validateEntry(draft({ activity: '   \n\t  ' }), NOW).ok).toBe(false);
  });

  it(`accepts exactly ${ACTIVITY_MAX_LENGTH} characters`, () => {
    expect(validateEntry(draft({ activity: 'x'.repeat(ACTIVITY_MAX_LENGTH) }), NOW).ok).toBe(true);
  });

  it(`rejects ${ACTIVITY_MAX_LENGTH + 1} characters and reports the length`, () => {
    const result = validateEntry(draft({ activity: 'x'.repeat(ACTIVITY_MAX_LENGTH + 1) }), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.activity).toContain(String(ACTIVITY_MAX_LENGTH + 1));
    }
  });
});

describe('validateEntry — collects every error at once', () => {
  it('reports all three fields in a single pass', () => {
    const result = validateEntry(
      { dateISO: '2027-01-01', hoursText: '99', activity: '  ' },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.dateISO).toBeDefined();
      expect(result.errors.hoursText).toBeDefined();
      expect(result.errors.activity).toBeDefined();
    }
  });
});

describe('firstInvalidField (R-13)', () => {
  it('returns null for a valid draft', () => {
    const result = validateEntry(draft(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      expect(firstInvalidField(result.errors)).toBeNull();
    }
  });

  it('picks the earliest field in form order, not object key order', () => {
    const result = validateEntry({ dateISO: '2027-01-01', hoursText: '99', activity: '' }, NOW);
    if (!result.ok) {
      expect(firstInvalidField(result.errors)).toBe('dateISO');
    }

    const onlyActivity = validateEntry(draft({ activity: '' }), NOW);
    if (!onlyActivity.ok) {
      expect(firstInvalidField(onlyActivity.errors)).toBe('activity');
    }
  });

  it('finds a bad hours value — regression test for a key mismatch', () => {
    // Regression: the hours error was once keyed `hours` while the form field is
    // `hoursText`, so the message was unreachable and focusing silently fell
    // through to no field at all. `tsc` caught the type error; the tests missed
    // it because they asserted `errors.hours`, matching the bug.
    const onlyHours = validateEntry(draft({ hoursText: '0' }), NOW);
    expect(onlyHours.ok).toBe(false);
    if (!onlyHours.ok) {
      expect(Object.keys(onlyHours.errors)).toEqual(['hoursText']);
      expect(firstInvalidField(onlyHours.errors)).toBe('hoursText');
    }
  });

  it('keys every error by a real form field name', () => {
    const result = validateEntry({ dateISO: 'nope', hoursText: '99', activity: '' }, NOW);
    if (!result.ok) {
      for (const key of Object.keys(result.errors)) {
        expect(FIELD_ORDER).toContain(key);
      }
    }
  });
});
