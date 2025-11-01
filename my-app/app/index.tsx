import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';

export default function IndexRedirect() {
  const router = useRouter();

  useEffect(() => {
    // replace current route with the search tab so there's no visible flash
    router.replace('/(tabs)/search');
  }, [router]);

  return null;
}
