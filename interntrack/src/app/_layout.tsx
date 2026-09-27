import { Suspense, useCallback, useState } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DatabaseErrorScreen, DatabaseLoadingScreen } from '@/components/database/DatabaseStatus';
import { DATABASE_NAME, initDatabase } from '@/db/client';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [databaseError, setDatabaseError] = useState<Error | null>(null);

  // `onError` is only called on a failure, so it must be referentially stable
  // or the provider would re-run initialisation on every render.
  const handleDatabaseError = useCallback((error: Error) => {
    setDatabaseError(error);
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StatusBar style="auto" />
      {databaseError ? (
        <DatabaseErrorScreen error={databaseError} />
      ) : (
        // Suspense holds the first screen back until `onInit` has finished, so
        // no screen can query a table that does not exist yet.
        <Suspense fallback={<DatabaseLoadingScreen />}>
          <SQLiteProvider
            databaseName={DATABASE_NAME}
            onInit={initDatabase}
            onError={handleDatabaseError}
            useSuspense>
            <SafeAreaProvider>
              <Stack>
                <Stack.Screen name="index" options={{ title: 'Today' }} />
                <Stack.Screen name="history" options={{ title: 'History' }} />
                <Stack.Screen name="reports" options={{ title: 'Reports' }} />
                <Stack.Screen name="settings" options={{ title: 'Settings' }} />
                {/* Modal-style: you arrive here from History, so it gets a back button. */}
                <Stack.Screen
                  name="log/[date]"
                  options={{ title: 'Edit day', presentation: 'modal' }}
                />
              </Stack>
            </SafeAreaProvider>
          </SQLiteProvider>
        </Suspense>
      )}
    </ThemeProvider>
  );
}
