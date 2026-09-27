import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export type ScreenPlaceholderProps = {
  /** Screen name, shown as the heading. */
  title: string;
  /** Which backlog task replaces this placeholder. */
  task: string;
  /** Optional extra line, e.g. a route param proving the route resolved. */
  detail?: string;
};

/**
 * Temporary stand-in for a screen that has not been built yet.
 *
 * Exists so every route in [[InternTrack Architecture]] is reachable from the
 * first commit (T-05) and `tsc` has something to check. Each screen replaces
 * its own placeholder — delete this file once the last one is gone (T-41).
 */
export function ScreenPlaceholder({ title, task, detail }: ScreenPlaceholderProps) {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Not built yet — implemented in {task}.
      </ThemedText>
      {detail ? (
        <View style={styles.badge}>
          <ThemedText type="small" themeColor="textSecondary">
            {detail}
          </ThemedText>
        </View>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  badge: {
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 6,
  },
});
