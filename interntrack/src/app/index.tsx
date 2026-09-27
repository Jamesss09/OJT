import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

/**
 * Placeholder for the Today screen.
 *
 * Replaced by the real log flow in T-24. It exists so the router has at least
 * one valid route and so `npx tsc --noEmit` has something to check.
 */
export default function TodayScreen() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle">InternTrack</ThemedText>
      <ThemedText type="small">Scaffold OK — this screen is replaced in T-24.</ThemedText>
      <View style={styles.spacer} />
      <ThemedText type="small" themeColor="textSecondary">
        Phase 1 complete. No database, no native modules used yet.
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  spacer: {
    height: 24,
  },
});
