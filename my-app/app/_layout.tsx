import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/useColorScheme';
import { scheduleDailyPrefetch } from '@/utils/secApi';
import { initReleaseDefaults, initSentryIfAvailable } from '@/utils/initRelease';

// Prevent the splash screen from auto-hiding before asset loading is complete.
try {
  SplashScreen.preventAutoHideAsync().catch(() => {
    /* ignore already registered errors */
  });
} catch (e) {
  // Benign in dev
}

import { ThemeProvider as CustomThemeProvider, useTheme } from '@/context/ThemeContext';

function RootLayoutContent({ loaded }: { loaded: boolean }) {
  const { isDark } = useTheme();

  if (!loaded) {
    return null;
  }

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="SearchResultsScreen"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="HoldingsScreen"
          options={{
            headerShown: false
          }}
        />
      </Stack>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

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
    initReleaseDefaults();
    void initSentryIfAvailable();

    const cleanup = scheduleDailyPrefetch([
      'https://www.sec.gov/files/company_tickers.json',
    ]);
    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }, [loaded]);

  return (
    <CustomThemeProvider>
      <RootLayoutContent loaded={loaded} />
    </CustomThemeProvider>
  );
}
