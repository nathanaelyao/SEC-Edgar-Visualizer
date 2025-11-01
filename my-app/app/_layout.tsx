import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/useColorScheme';
import { scheduleDailyPrefetch } from './utils/secApi';
import { initReleaseDefaults, initSentryIfAvailable } from './utils/initRelease';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  useEffect(() => {
    if (!loaded) return;
    // Prefetch commonly used SEC resources daily to keep cache fresh and reduce rate pressure
    // initialize conservative defaults for release and optionally Sentry
    initReleaseDefaults();
    void initSentryIfAvailable();

    const cleanup = scheduleDailyPrefetch([
      'https://www.sec.gov/files/company_tickers.json',
      // add other frequently-accessed endpoints or CIK submissions here
    ]);
    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <ThemeProvider value={ DefaultTheme}>
      <Stack>
        
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen 
          name="SearchResultsScreen" 
          options={{ headerShown: false }}
        />
        <Stack.Screen 
          name="HoldingsScreen" 
          options={{ 
            // title: 'Portfolio Holdings', 
            headerShown: false
            // or
            // headerTitle: 'My Investments', 
          }} 
        />

      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
