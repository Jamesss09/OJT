/**
 * The hours field.
 *
 * ## Why the echo is "7h 30m" and not "7.5 h"
 *
 * R-1 makes decimal hours an **input** format only. A `minutes → "7.5 h"`
 * formatter was written, caught by its own tests, and deleted: 1 minute is
 * 0.0167 h, so only every third value lands on a 2-decimal boundary and the
 * other two were being displayed wrong. This echo therefore uses
 * `formatDuration()`, which is exact for every minute value. The intern still
 * sees the text they typed in the field itself, so nothing is hidden.
 *
 * ## Why there is no `maxLength`
 *
 * The input grammar is 5 characters at most, so `maxLength={5}` looks free. It
 * is not: it would silently truncate a **pasted** `7.333` to `7.33`, changing
 * what gets stored. That is rounding dressed up as a length limit, and R-1
 * already rejected that trade-off for the same reason. Over-long input is
 * rejected by `validateEntry` with a message instead.
 *
 * ## Why errors wait for a blur
 *
 * Showing "Enter hours between 0 and 24" the moment someone types `7.` — while
 * they are halfway through typing `7.5` — is an error they did not make. The
 * message appears once the field has lost focus, or immediately when a parent
 * passes `revealError` because a failed submit is focusing this field (R-13).
 */

import { useCallback, useState } from 'react';
import { type TextInput, StyleSheet, TextInput as RNTextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration, toMinutes } from '@/lib/hours';

export type HourInputProps = {
  /** The draft's `hoursText` — raw text, exactly as typed. Controlled. */
  value: string;
  onChangeText: (text: string) => void;
  /**
   * The message from `validateEntry(draft).errors.hoursText`, or `undefined`
   * when the field is fine. Rendering is this component's job; deciding *when*
   * the form believes it is wrong is the caller's.
   */
  error?: string | undefined;
  /**
   * Show `error` before the field has been blurred.
   *
   * For R-13: a submit fails, and the form focuses the first invalid field.
   * Focusing does not blur, so without this the intern would be staring at a
   * focused field with no explanation of why it was singled out.
   */
  revealError?: boolean;
  onBlur?: (() => void) | undefined;
  /** Forwarded so a parent can focus the field (R-13). */
  inputRef?: React.Ref<TextInput> | undefined;
  testID?: string | undefined;
};

export function HourInput({
  value,
  onChangeText,
  error,
  revealError = false,
  onBlur,
  inputRef,
  testID = 'hour-input',
}: HourInputProps) {
  const theme = useTheme();
  const [touched, setTouched] = useState(false);

  const handleBlur = useCallback(() => {
    setTouched(true);
    onBlur?.();
  }, [onBlur]);

  // `null` covers three genuinely different states — empty, mid-typing, and
  // malformed — and none of them should be echoed, because there is no duration
  // to echo yet. Distinguishing them here would mean duplicating the input
  // grammar that `hours.ts` already owns.
  const minutes = toMinutes(value);
  const echo = minutes === null ? null : formatDuration(minutes);

  const showError = (touched || revealError) && error !== undefined && error !== '';

  return (
    <ThemedView>
      <ThemedText type="smallBold">Hours</ThemedText>

      <View style={[styles.well, showError && { borderColor: theme.danger }]}>
        <RNTextInput
          ref={inputRef}
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          onBlur={handleBlur}
          // `inputMode` is the cross-platform form and takes precedence over
          // `keyboardType` in RN, so setting both would be decorative.
          inputMode="decimal"
          style={[styles.input, { color: theme.text }]}
          placeholder="7.5"
          placeholderTextColor={theme.textSecondary}
          // A screen reader cannot see the visual echo, so the converted value
          // is announced as part of the field. `7.5` is announced as "7 hours 30
          // minutes" rather than being left to mental arithmetic.
          accessibilityLabel="Hours worked"
          accessibilityHint={
            echo === null ? 'Up to 24 hours. Decimals allowed.' : `That is ${echo}.`
          }
        />

        {echo === null ? null : (
          <ThemedText type="small" themeColor="textSecondary" testID="hour-echo">
            {echo}
          </ThemedText>
        )}
      </View>

      {showError ? (
        <ThemedText type="small" themeColor="danger" testID="hour-error">
          {error}
        </ThemedText>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  well: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  input: {
    // Wide enough for `24.00` on a large font setting, but the echo sits to the
    // right rather than below so the row height does not jump as it appears.
    flex: 1,
    fontSize: 20,
    minWidth: 80,
    paddingVertical: Spacing.one,
  },
});
