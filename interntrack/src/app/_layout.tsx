import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useColorScheme } from '@/hooks/use-color-scheme';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        {/* Placeholder route set. Real navigators land in T-05. */}
        <Stack.Screen name="index" options={{ title: 'Today' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
