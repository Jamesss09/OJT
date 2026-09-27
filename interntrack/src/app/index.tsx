/**
 * Today — the screen the app opens on, and the core of the whole thing.
 *
 * The intern opens this, types two things, and saves. Everything else in the app
 * is a view of what happens here. So this screen optimises for one number: the
 * time from opening the app to a saved entry.
 *
 * ## Shape of the screen
 *
 *   - a header with today's date and whether the day is logged
 *   - a summary: hours this week, and progress toward the target (R-6)
 *   - the two inputs (`HourInput`, `ActivityInput`)
 *   - save, and delete once there is something to delete
 *
 * There is no "edit" button on this screen. Logging a day twice *is* editing it,
 * because R-2 makes `entry_date` unique and the repository upserts. A separate
 * edit affordance would imply two rows, which is precisely the mistake R-2
 * exists to prevent.
 *
 * ## What is deliberately not here
 *
 * **No date picker.** Today logs today. Backdating is `T-25`'s job, reached from
 * History, and adding a picker here would make "which day am I logging?" a
 * question the intern has to answer before every entry. R-3 already refuses a
 * future date, and this screen never offers one.
 *
 * **No local copy of the totals.** Everything comes from SQLite through the
 * hooks, which refetch on focus. A save reloads the queries it affects; nothing
 * is mirrored into component state that could disagree with the database.
 *
 * ## The empty state
 *
 * An unlogged day shows an empty form and a clear prompt. This is the state the
 * app is in most often at the start, so it is treated as a first-class screen
 * rather than a fallback. Once a day is logged the form is pre-filled with what
 * was stored, so correcting a typo is the same gesture as logging the first
 * time — the intern never has to think about which mode they are in.
 */

import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ActivityInput } from '@/components/ActivityInput';
import { HourInput } from '@/components/HourInput';
import { ProgressBar } from '@/components/ProgressBar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useEntryForDate, useLogEntryMutation, useOverallTotals, useRangeTotals } from '@/hooks/useEntries';
import { useSettings } from '@/hooks/useSettings';
import { useTheme } from '@/hooks/use-theme';
import { formatDisplayDate, todayISODate, weekRange } from '@/lib/dates';
import { formatDuration, toHoursText } from '@/lib/hours';
import { type EntryDraft, type FieldErrors, validateEntry } from '@/lib/validation';

export default function TodayScreen() {
  const theme = useTheme();
  const router = useRouter();

  // Read once per mount rather than per render. `todayISODate` is the only
  // function in the app that reads the device clock (R-4), and it must not
  // produce a new date mid-render, which would change the query key and reload
  // the day's entry for no reason.
  const [today] = useState(() => todayISODate());
  const { start: weekStart, end: weekEnd } = useMemo(() => weekRange(today), [today]);

  const entry = useEntryForDate(today);
  const week = useRangeTotals(weekStart, weekEnd);
  const overall = useOverallTotals();
  const settings = useSettings();
  const { save, remove, isPending } = useLogEntryMutation();

  // The draft is seeded from the stored entry once it arrives, and from there on
  // it is the intern's. Re-seeding on every render would fight the person typing.
  const [draft, setDraft] = useState<EntryDraft>({ dateISO: today, hoursText: '', activity: '' });
  const [seededFrom, setSeededFrom] = useState<number | undefined>(undefined);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [revealErrors, setRevealErrors] = useState(false);
  const [saveFailure, setSaveFailure] = useState<string | undefined>(undefined);

  // Seed from the stored entry the first time it lands for today. Keyed on the
  // entry's id so a later refetch does not stomp on typing, but a genuine change
  // (the entry was edited elsewhere) does refresh the form.
  //
  // The hours come back through `toHoursText`, which is verified to round-trip
  // every legal minute count, so re-saving an untouched field stores the same
  // minutes it started with. See that function for why 2 decimal places are
  // enough.
  const loadedId = entry.data?.id;
  if (loadedId !== undefined && loadedId !== seededFrom) {
    setSeededFrom(loadedId);
    setDraft({
      dateISO: today,
      hoursText: entry.data ? toHoursText(entry.data.minutes) : '',
      activity: entry.data?.activity ?? '',
    });
  }

  const logged = entry.data !== undefined && entry.data !== null;
  const loading = entry.isLoading;

  const requiredMinutes = settings.data?.requiredMinutes ?? 0;
  const weekMinutes = week.data?.totalMinutes ?? 0;
  const totalMinutes = overall.data?.totalMinutes ?? 0;

  const handleChange = useCallback(
    (field: keyof EntryDraft) => (value: string) => {
      setDraft((current) => ({ ...current, [field]: value }));
      setErrors((current) => {
        if (current[field] === undefined) return current;
        const next = { ...current };
        delete next[field];
        return next;
      });
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setSaveFailure(undefined);
    const result = validateEntry(draft);

    if (!result.ok) {
      // Reveal every message, not just the first: the intern is looking at a
      // form, and fixing one field at a time by re-submitting is slower than
      // showing both. R-13's focus-the-first-field concern is `T-25`'s; here the
      // fields are all on screen together.
      setErrors(result.errors);
      setRevealErrors(true);
      return;
    }

    setErrors({});
    setRevealErrors(false);
    const saved = await save(result.value);

    if (!saved.ok) {
      // Keep the draft. Losing a paragraph because a write failed is the worst
      // thing this screen could do.
      setSaveFailure(saved.error.message);
      return;
    }

    setSeededFrom(saved.entry.id);
    // Re-read the day's entry and the totals. The mutation deliberately does not
    // refetch anything itself, so the screen says what it wants refreshed.
    entry.reload();
    week.reload();
    overall.reload();
  }, [draft, save, entry, week, overall]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      'Remove this day?',
      'The entry and its description are deleted. This cannot be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const result = await remove(today);
            if (result.ok) {
              setDraft({ dateISO: today, hoursText: '', activity: '' });
              setSeededFrom(undefined);
              setErrors({});
              setRevealErrors(false);
              entry.reload();
              week.reload();
              overall.reload();
            }
          },
        },
      ],
    );
  }, [remove, today, entry, week, overall]);

  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <View style={styles.header}>
          <ThemedText type="title" style={styles.title}>
            Today
          </ThemedText>
          <ThemedText themeColor="textSecondary" testID="today-date">
            {formatDisplayDate(today)}
          </ThemedText>
        </View>

        <View style={styles.statusRow}>
          <ThemedText
            type="smallBold"
            themeColor={logged ? 'accent' : 'textSecondary'}
            testID="today-status">
            {loading ? 'Loading…' : logged ? 'Logged' : 'Not logged yet'}
          </ThemedText>
          {logged ? (
            <Pressable onPress={handleDelete} accessibilityRole="button" testID="today-delete">
              <ThemedText type="small" themeColor="danger">
                Delete
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        <ThemedView
          type="backgroundElement"
          style={[styles.summary, { borderColor: theme.border }]}
          testID="today-summary">
          <SummaryRow label="This week" value={formatDuration(weekMinutes)} testID="week-total" />
          <SummaryRow
            label="Total logged"
            value={formatDuration(totalMinutes)}
            testID="overall-total"
          />
          <ProgressBar
            totalMinutes={totalMinutes}
            requiredMinutes={requiredMinutes}
            label="Progress"
          />
        </ThemedView>

        <ThemedView style={styles.form}>
          {/* The field shows "7.33" for a stored 7h 20m, the only 2-decimal form
              that exists and round-trips. State the real duration so the number
              in the field is not a puzzle. */}
          {logged && entry.data ? (
            <ThemedText type="small" themeColor="textSecondary" testID="stored-hours">
              {`Logged as ${formatDuration(entry.data.minutes)}.`}
            </ThemedText>
          ) : null}

          <HourInput
            value={draft.hoursText}
            onChangeText={handleChange('hoursText')}
            error={errors.hoursText}
            revealError={revealErrors}
          />
          <ActivityInput
            value={draft.activity}
            onChangeText={handleChange('activity')}
            error={errors.activity}
            revealError={revealErrors}
          />

          {saveFailure ? (
            <ThemedText type="small" themeColor="danger" testID="save-error">
              {`Could not save: ${saveFailure}`}
            </ThemedText>
          ) : null}

          <Pressable
            onPress={handleSave}
            disabled={isPending}
            accessibilityRole="button"
            accessibilityState={{ disabled: isPending }}
            testID="today-save"
            style={({ pressed }) => [
              styles.save,
              { backgroundColor: theme.accent },
              (pressed || isPending) && styles.savePressed,
            ]}>
            <ThemedText type="default" style={styles.saveLabel}>
              {isPending ? 'Saving…' : logged ? 'Update' : 'Save day'}
            </ThemedText>
          </Pressable>
        </ThemedView>

        <Pressable
          onPress={() => router.push('/history')}
          accessibilityRole="button"
          testID="today-history-link"
          style={styles.footerLink}>
          <ThemedText type="linkPrimary">See past days →</ThemedText>
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

function SummaryRow({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View style={styles.summaryRow}>
      <ThemedText themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="smallBold" testID={testID}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
  header: {
    gap: Spacing.one,
  },
  title: {
    fontSize: 34,
    lineHeight: 40,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summary: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  form: {
    gap: Spacing.four,
  },
  save: {
    paddingVertical: Spacing.three,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  savePressed: {
    opacity: 0.7,
  },
  saveLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  footerLink: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
});
