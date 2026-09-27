import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Shown while the database is opening and migrating. */
export function DatabaseLoadingScreen() {
  const theme = useTheme();

  return (
    <ThemedView style={styles.centered}>
      <ActivityIndicator color={theme.accent} />
      <ThemedText type="small" themeColor="textSecondary">
        Opening your log…
      </ThemedText>
    </ThemedView>
  );
}

/**
 * Shown when the database could not be opened or migrated.
 *
 * [[InternTrack Architecture]] requires a full-screen error rather than a white
 * screen, and explicitly says nothing is deleted in this state — so the copy
 * reassures rather than offering a destructive shortcut.
 *
 * The "reset app data" escape hatch is deliberately **not** here: it needs
 * `deleteDatabaseAsync` behind a confirmation, and belongs to Settings
 * (`T-41`), not to the boot path.
 */
export function DatabaseErrorScreen({ error }: { error: Error }) {
  const theme = useTheme();

  return (
    <ThemedView style={styles.centered}>
      <ThemedText type="subtitle">Your log could not be opened</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Nothing has been deleted. This is usually a storage or permissions problem.
      </ThemedText>
      <View style={styles.detailBox}>
        <Text style={[styles.detail, { color: theme.textSecondary }]} selectable>
          {error.message}
        </Text>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Restart the app. If it keeps failing, reinstalling will recover from a
        corrupt file — but that erases your log, so try the restart first.
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  detailBox: {
    alignSelf: 'stretch',
  },
  detail: {
    fontSize: 12,
    textAlign: 'center',
  },
});
