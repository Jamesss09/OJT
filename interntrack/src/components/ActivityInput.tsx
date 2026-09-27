/**
 * The activity field — what the intern actually did that day.
 *
 * ## Why the counter counts the *trimmed* length
 *
 * R-3 caps `activity` at 2000 characters **after** `.trim()`, and
 * `validateEntry` checks the trimmed string. Counting the raw text would let
 * the counter and the error message disagree: 2000 characters plus a trailing
 * newline is 2001 raw, so the counter would say over the limit while
 * validation said fine. The number shown is the number that gets stored.
 *
 * It also means a field containing only spaces reads `0 / 2000`, which is an
 * honest hint at why saving is being refused.
 *
 * ## Why there is a `maxLength` here but not on `HourInput`
 *
 * The two fields look like the same decision and are not.
 *
 * `HourInput` has no `maxLength` because truncating a pasted `7.333` to `7.33`
 * silently changes **a number** — the stored figure would disagree with the
 * text the intern can see. A quantitative lie in a timesheet is not defensible.
 *
 * Here, `maxLength` truncates the *tail* of an over-long description. That is
 * still data loss, but it is not a lie: the intern typed or pasted too much,
 * the counter visibly stops at 2000, and the shortfall is visible rather than
 * hidden. More to the point, the cap makes the invalid state **impossible**
 * instead of merely rejected — `validateEntry`'s over-length branch stays as
 * defence in depth for other callers, such as a future JSON restore, but this
 * component cannot produce a value that trips it.
 *
 * ## Why nothing is trimmed on blur
 *
 * Trimming while someone is typing moves the caret and eats the space they are
 * about to type into. R-3's "trims on save" belongs to `validateEntry`, which
 * runs once, at submit.
 */

import { useCallback, useState } from 'react';
import { type TextInput, StyleSheet, TextInput as RNTextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ACTIVITY_MAX_LENGTH } from '@/lib/validation';

/**
 * How close to the cap the counter turns red.
 *
 * 200 characters is roughly three or four sentences — enough warning to finish
 * a thought and cut, without the counter spending the whole session in the
 * error colour and becoming background noise.
 */
const COUNTER_WARN_THRESHOLD = 200;

export type ActivityInputProps = {
  /** The draft's `activity` — raw text, exactly as typed. Controlled. */
  value: string;
  onChangeText: (text: string) => void;
  /**
   * The message from `validateEntry(draft).errors.activity`, or `undefined`
   * when the field is fine. Rendering is this component's job; deciding *when*
   * the form believes it is wrong is the caller's.
   */
  error?: string | undefined;
  /**
   * Show `error` before the field has been blurred.
   *
   * For R-13: a submit fails and the form focuses the first invalid field.
   * Focusing does not blur, so without this the intern would be staring at a
   * focused field with no explanation of why it was singled out.
   */
  revealError?: boolean;
  onBlur?: (() => void) | undefined;
  /** Forwarded so a parent can focus the field (R-13). */
  inputRef?: React.Ref<TextInput> | undefined;
  testID?: string | undefined;
};

export function ActivityInput({
  value,
  onChangeText,
  error,
  revealError = false,
  onBlur,
  inputRef,
  testID = 'activity-input',
}: ActivityInputProps) {
  const theme = useTheme();
  const [touched, setTouched] = useState(false);

  const handleBlur = useCallback(() => {
    setTouched(true);
    onBlur?.();
  }, [onBlur]);

  // What R-3 actually caps, and therefore what gets stored.
  const storedLength = value.trim().length;
  const remaining = ACTIVITY_MAX_LENGTH - storedLength;
  const nearCap = remaining <= COUNTER_WARN_THRESHOLD;

  const showError = (touched || revealError) && error !== undefined && error !== '';

  return (
    <ThemedView>
      <View style={styles.labelRow}>
        <ThemedText type="smallBold">What did you do?</ThemedText>
        <ThemedText
          type="small"
          themeColor={nearCap ? 'danger' : 'textSecondary'}
          testID="activity-counter"
        >
          {`${storedLength} / ${ACTIVITY_MAX_LENGTH}`}
        </ThemedText>
      </View>

      <RNTextInput
        ref={inputRef}
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        onBlur={handleBlur}
        multiline
        numberOfLines={5}
        // Without this a multiline field centres its first line and grows
        // upward off the top of the well.
        textAlignVertical="top"
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.background, borderColor: theme.border },
          showError && { borderColor: theme.danger },
        ]}
        placeholder="Trained the new intern on the build process."
        placeholderTextColor={theme.textSecondary}
        maxLength={ACTIVITY_MAX_LENGTH}
        accessibilityLabel="What you did that day"
        accessibilityHint={`Up to ${ACTIVITY_MAX_LENGTH} characters. ${remaining} left.`}
      />

      {showError ? (
        <ThemedText type="small" themeColor="danger" testID="activity-error">
          {error}
        </ThemedText>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  input: {
    marginTop: Spacing.one,
    // Tall enough to read a paragraph in, short enough that the counter and the
    // error beneath it stay visible without scrolling on a small phone.
    minHeight: 108,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.md,
    fontSize: 16,
    lineHeight: 22,
  },
});
