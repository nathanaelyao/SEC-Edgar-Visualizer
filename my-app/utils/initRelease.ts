// initRelease.ts
// Centralized runtime initializers for release: tune secApi defaults and optionally initialize Sentry if available.
import { setConcurrency, setRateLimitDelay } from './secApi';
import { debug } from './logger';

export function initReleaseDefaults() {
  try {
    // sensible defaults to reduce risk of 429s for initial release
    (global as any).__SEC_API_CONCURRENCY = (global as any).__SEC_API_CONCURRENCY ?? 5;
    (global as any).__SEC_API_DELAY = (global as any).__SEC_API_DELAY ?? 200; // ms between requests per worker
    (global as any).__SEC_API_THROTTLE_MS = (global as any).__SEC_API_THROTTLE_MS ?? 2 *5* 1000;
    (global as any).__SEC_API_THROTTLE_DELAY_MS = (global as any).__SEC_API_THROTTLE_DELAY_MS ?? 400;
    (global as any).__SEC_API_THROTTLE_CONCURRENCY = (global as any).__SEC_API_THROTTLE_CONCURRENCY ?? 3;
    (global as any).__SEC_API_429_DECAY_MS = (global as any).__SEC_API_429_DECAY_MS ?? 1 * 10 * 1000;

    // Apply to exported setters too (they use globals internally)
    setConcurrency((global as any).__SEC_API_CONCURRENCY);
    setRateLimitDelay((global as any).__SEC_API_DELAY);
  } catch (e) {
    // noop
  }
}

export async function initSentryIfAvailable() {
  // optional Sentry integration: will attempt dynamic import if package is installed.
  // This avoids hard dependency during dev. To enable, install @sentry/react-native or sentry-expo and set SENTRY_DSN env var.
  const dsn = (global as any).__SENTRY_DSN ?? process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    // try sentry-expo first
    const SentryExpoMod: any = await import('sentry-expo');
    const SentryExpo: any = SentryExpoMod?.default ?? SentryExpoMod;
    if (SentryExpo) {
      try {
        SentryExpo.init?.({ dsn, enableInExpoDevelopment: false, debug: false });
        debug('Sentry (sentry-expo) initialized');
        return;
      } catch (e) {
        // try next
      }
    }
  } catch (e) {
    // not installed or failed
  }
  try {
    const SentryRNMod: any = await import('@sentry/react-native');
    const SentryRN: any = SentryRNMod?.default ?? SentryRNMod;
    if (SentryRN) {
      try {
        SentryRN.init?.({ dsn });
        debug('Sentry (@sentry/react-native) initialized');
        return;
      } catch (e) {
        // ignore
      }
    }
  } catch (e2) {
    // not installed
  }
}
