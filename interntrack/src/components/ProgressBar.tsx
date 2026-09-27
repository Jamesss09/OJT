/**
 * Progress toward the required-hours target.
 *
 * A pure view: it takes two numbers and renders them. It does no arithmetic on
 * totals, reads no clock, and knows nothing about the database. Everything it
 * displays is passed in already resolved, which is what makes it exhaustively
 * testable without a device.
 *
 * ## R-6, in three parts
 *
 * 1. `requiredMinutes === 0` means unset, and the whole component renders
 *    `null`. Not "0%" and not a hidden zero-height bar with a stray label: if
 *    the intern has not set a target there is no progress to show, and inventing
 *    a bar implies a target that does not exist.
 *
 * 2. The *fill* is clamped to 100% but the *text* is not. Someone who has done
 *    412 hours against a 300-hour requirement must be able to see that. Capping
 *    the number as well as the bar would quietly misreport the record, which is
 *    the one thing a progress display must not do.
 *
 * 3. `progress = totalMinutes / requiredMinutes`. `requiredMinutes` is checked
 *    for 0 above, so this division is never by zero. The fill is clamped to a
 *    maximum of 1, because R-6 says the *bar* caps at 100% and a width above
 *    100 is invalid for flex. The lower end needs no clamp: a negative total
 *    cannot reach here, for the reason below.
 *
 * One thing this does not handle: a negative `totalMinutes`. `formatDuration`
 * throws `RangeError` on one, and it is called during render, so the error
 * surfaces instead of rendering an empty bar. That is the right outcome. A
 * negative total cannot come from the database — migration 1's CHECK constraint
 * forbids it — so it means a bad caller, and rendering "0%" would bury a real
 * bug behind a plausible-looking bar.
 */

import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration } from '@/lib/hours';

export type ProgressBarProps = {
  /** Sum of logged minutes, already restricted to after the programme start (R-6). */
  totalMinutes: number;
  /** The target. `0` means unset, and hides the bar. */
  requiredMinutes: number;
  /** Optional caption above the numbers, e.g. "Overall". */
  label?: string | undefined;
};

/** True for a target that actually means something. */
export function hasTarget(requiredMinutes: number): boolean {
  return Number.isFinite(requiredMinutes) && requiredMinutes > 0;
}

export function ProgressBar({ totalMinutes, requiredMinutes, label }: ProgressBarProps) {
  const theme = useTheme();

  if (!hasTarget(requiredMinutes)) {
    return null;
  }

  // Safe because requiredMinutes > 0 above.
  const ratio = totalMinutes / requiredMinutes;
  // `ratio` is kept unclamped for the caption, so overachievement stays visible
  // in the numbers even though the bar is full (R-6).
  const fill = Math.min(1, ratio);
  // Rounded to a whole percent. One third of a target is otherwise handed to
  // the layout engine as "33.333333333333336%", which is noise in a style object
  // and makes the width impossible to assert on.
  //
  // `fill` is `Math.min(1, ratio)`, so fillPercent is at most 100 and the bar
  // can never exceed the track.
  const fillPercent = Math.round(fill * 100);

  return (
    <View style={styles.wrapper} accessibilityRole="progressbar">
      {label ? (
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
      ) : null}

      <ThemedText type="smallBold" testID="progress-caption">
        {`${formatDuration(totalMinutes)} of ${formatDuration(requiredMinutes)}`}
      </ThemedText>

      <View
        testID="progress-track"
        style={[styles.track, { backgroundColor: theme.backgroundElement }]}
      >
        <View
          testID="progress-fill"
          style={[
            styles.fill,
            { backgroundColor: theme.accent },
            // Fraction of the track. A plain percentage string would be simpler
            // and wrong at the edges: percentage can exceed 100 and Android
            // silently mis-renders an over-wide child.
            { width: `${fillPercent}%` },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.one,
  },
  track: {
    height: 10,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.full,
  },
});
