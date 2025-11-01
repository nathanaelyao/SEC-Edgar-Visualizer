import AsyncStorage from '@react-native-async-storage/async-storage';
import { debug, info, warn, error } from './logger';

// secApi.ts
// Centralized SEC API client with request queue, retries, worker-pool concurrency and persistent caching to avoid rate limits.

type SecFetchOptions = {
  cacheTTL?: number; // ms
  force?: boolean; // bypass cache
  priority?: boolean; // if true, enqueue at front
  staleWhileRevalidate?: boolean; // if true (default) return stale cache immediately and refresh in background
};

const USER_AGENT = 'SEC_APP (nathanael.yao123@gmail.com)';
const DEFAULT_DELAY_MS = 100; // delay between requests for rate limiting per worker (raised to be safer)
const DEFAULT_CONCURRENCY = 5; // safer default concurrency for initial release
// Default persistent cache TTL: 6 hours
const DEFAULT_PERSISTENT_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_RETRIES = 5;
const PERSISTENT_CACHE_PREFIX = '@secapi:cache:';

type CachedEntry = {
  timestamp: number;
  text: string;
  status: number;
  headers: Record<string, string>;
};

const cache = new Map<string, CachedEntry>();
// track last time we triggered a background refresh for a URL to avoid repeated revalidation
const lastBackgroundRefresh = new Map<string, number>();
let queue: Array<() => Promise<void>> = [];
let processing = false;
let runningWorkers = 0;

// auto-throttle state
let recent429Count = 0;
let throttleTimer: any = null;
let throttledUntil = 0;

function wait(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function jitter(ms: number) {
  // add 0-30% random jitter to avoid too large overshoots
  const variance = Math.max(1, Math.floor(ms * 0.3));
  const delta = Math.floor(Math.random() * variance);
  return ms + delta;
}

function parseRetryAfter(header?: string | null): number | null {
  if (!header) return null;
  const sec = parseInt(header, 10);
  if (!isNaN(sec)) return sec * 1000;
  const date = Date.parse(header);
  if (!isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

async function readPersistentCache(key: string): Promise<CachedEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(PERSISTENT_CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    return parsed;
  } catch (e) {
    return null;
  }
}

async function writePersistentCache(key: string, entry: CachedEntry) {
  try {
    await AsyncStorage.setItem(PERSISTENT_CACHE_PREFIX + key, JSON.stringify(entry));
  } catch (e) {
    // ignore write errors
  }
}

async function removePersistentCache(key: string) {
  try {
    await AsyncStorage.removeItem(PERSISTENT_CACHE_PREFIX + key);
  } catch (e) {}
}

async function clearAllPersistentCache() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const secKeys = keys.filter(k => k.startsWith(PERSISTENT_CACHE_PREFIX));
    if (secKeys.length) await AsyncStorage.multiRemove(secKeys);
  } catch (e) {}
}

async function processQueue() {
  if (processing) return;
  processing = true;

  // concurrency can be tuned at runtime by setting global.__SEC_API_CONCURRENCY
  const concurrency = Math.max(1, (global as any).__SEC_API_CONCURRENCY ?? DEFAULT_CONCURRENCY);
  const delayMs = () => (global as any).__SEC_API_DELAY ?? DEFAULT_DELAY_MS;

  const startWorker = async () => {
    runningWorkers++;
    try {
      while (queue.length > 0) {
        const task = queue.shift()!;
        try {
          await task();
        } catch (e) {
          warn('secApi task error', e);
        }
        await wait(delayMs());
      }
    } finally {
      runningWorkers--;
    }
  };

  const toStart = Math.min(concurrency, Math.max(1, queue.length));
  for (let i = 0; i < toStart; i++) startWorker();

  // wait for all workers to finish
  while (runningWorkers > 0) {
    await wait(50);
  }

  processing = false;
}

function makeResponseFromCache(entry: CachedEntry) {
  return {
    ok: entry.status >= 200 && entry.status < 300,
    status: entry.status,
    headers: entry.headers,
    text: async () => entry.text,
    json: async () => {
      try {
        return JSON.parse(entry.text);
      } catch (e) {
        throw e;
      }
    },
  } as const;
}

export async function secFetch(url: string, opts?: SecFetchOptions) {
  const cacheKey = encodeURIComponent(url);
  const ttl = opts?.cacheTTL ?? 5 * 60 * 1000; // default 5 minutes

  if (!opts?.force) {
    const entry = cache.get(cacheKey);
    if (entry && Date.now() - entry.timestamp < ttl) {
      return makeResponseFromCache(entry);
    }
    // try persistent cache
    try {
      const p = await readPersistentCache(cacheKey);
      if (p) {
        const age = Date.now() - p.timestamp;
        // if still fresh
        if (age < ttl) {
          cache.set(cacheKey, p);
          return makeResponseFromCache(p);
        }

        // stale entry: support stale-while-revalidate to return quickly and refresh in background
        const allowSWR = opts?.staleWhileRevalidate !== false;
        if (allowSWR) {
          cache.set(cacheKey, p);
          // only schedule a background refresh if we haven't for this URL recently
          const last = lastBackgroundRefresh.get(cacheKey) ?? 0;
          const now = Date.now();
          const BACKGROUND_REFRESH_DEBOUNCE_MS = 60 * 1000; // 1 minute
          if (now - last > BACKGROUND_REFRESH_DEBOUNCE_MS) {
            lastBackgroundRefresh.set(cacheKey, now);
            // refresh in low priority background without awaiting
            setTimeout(() => {
              try {
                void secFetch(url, { force: true, priority: false, staleWhileRevalidate: false });
              } catch (e) {
                // ignore
              }
            }, 0);
          }
          return makeResponseFromCache(p);
        }
      }
    } catch (e) {
      // ignore persistent cache errors
    }
  }

  return new Promise<any>((resolve, reject) => {
    const task = async () => {
      try {
        let attempt = 0;
        let backoff = 500;
        while (true) {
          attempt++;
          try {
            // If we're currently in a throttled period, pause before making request
            if (Date.now() < throttledUntil) {
              await wait((global as any).__SEC_API_DELAY_THROTTLE_MS ?? 2000);
            }

            const res = await global.fetch(url, {
              headers: {
                'User-Agent': USER_AGENT,
                Accept: '*/*',
              },
            });

            const text = await res.text();

            const headersObj: Record<string, string> = {};
            try {
              res.headers && (res.headers as any).forEach((v: string, k: string) => (headersObj[k.toLowerCase()] = v));
            } catch (e) {}

            // handle 429 Rate Limit responses by honoring Retry-After
            if (res.status === 429) {
              // increment recent 429 counter and schedule decay
              recent429Count++;
              if (throttleTimer) clearTimeout(throttleTimer);
              throttleTimer = setTimeout(() => { recent429Count = Math.max(0, recent429Count - 1); }, (global as any).__SEC_API_429_DECAY_MS ?? (2 * 60 * 1000)); // decay after 2m by default

              // if many 429s recently, throttle aggressively
              if (recent429Count >= 3) {
                // set throttledUntil for 2 minutes
                throttledUntil = Date.now() + ((global as any).__SEC_API_THROTTLE_MS ?? (2 * 60 * 1000));
                // increase global delay and reduce concurrency
                (global as any).__SEC_API_DELAY = Math.max((global as any).__SEC_API_DELAY ?? DEFAULT_DELAY_MS, (global as any).__SEC_API_THROTTLE_DELAY_MS ?? 2000);
                (global as any).__SEC_API_CONCURRENCY = Math.max(1, Math.min((global as any).__SEC_API_CONCURRENCY ?? 1, (global as any).__SEC_API_THROTTLE_CONCURRENCY ?? 2));
                info('secApi: entering aggressive throttle mode', { recent429Count, throttledUntil, delay: (global as any).__SEC_API_DELAY, concurrency: (global as any).__SEC_API_CONCURRENCY });
              }

              const retryAfterMs = parseRetryAfter(headersObj['retry-after'] ?? null) ?? backoff;
              const cap = Math.min(retryAfterMs, 60 * 1000);
              // add jitter to avoid thundering reattempts
              await wait(jitter(cap));
              backoff = Math.min(backoff * 2, 60 * 1000);
              if (attempt >= MAX_RETRIES) {
                const cacheEntry: CachedEntry = { timestamp: Date.now(), text, status: res.status, headers: headersObj };
                resolve(makeResponseFromCache(cacheEntry));
                break;
              }
              continue; // retry
            }

            // reset recent429Count on successful response
            recent429Count = Math.max(0, recent429Count - 1);

            const cacheEntry: CachedEntry = {
              timestamp: Date.now(),
              text,
              status: res.status,
              headers: headersObj,
            };

            if (res.status >= 200 && res.status < 300) {
              cache.set(cacheKey, cacheEntry);
              // persist successful responses asynchronously
              void writePersistentCache(cacheKey, cacheEntry);
            }

            resolve(makeResponseFromCache(cacheEntry));
            break;
          } catch (err: any) {
            if (attempt >= MAX_RETRIES) {
              reject(err);
              break;
            }
            // use jittered backoff for network errors
            await wait(jitter(backoff));
            backoff = Math.min(backoff * 2, 60 * 1000);
          }
        }
      } catch (err) {
        reject(err);
      }
    };

    if (opts?.priority) {
      queue.unshift(task);
    } else {
      queue.push(task);
    }
    void processQueue();
  });
}

export function clearSecCache() {
  cache.clear();
  void clearAllPersistentCache();
}

export function setRateLimitDelay(ms: number) {
  (global as any).__SEC_API_DELAY = ms;
}

export function setConcurrency(n: number) {
  (global as any).__SEC_API_CONCURRENCY = Math.max(1, Math.floor(n));
}

/**
 * Simple stress-test helper to exercise secFetch under load.
 * - urls: single URL or array of URLs to request
 * - totalRequests: total number of requests to issue (default 20)
 * - parallel: number of concurrent promises to start at once (default 4)
 * - delayMs: optional delay between starting batches to avoid immediate bursts (default 50)
 * Returns stats object with counts and timings.
 */
export async function secApiStressTest(opts: {
  urls: string | string[];
  totalRequests?: number;
  parallel?: number;
  delayMs?: number;
}): Promise<any> {
  const urls = Array.isArray(opts.urls) ? opts.urls : [opts.urls];
  const total = Math.max(1, opts.totalRequests ?? 20);
  const parallel = Math.max(1, opts.parallel ?? 4);
  const delayBetweenBatches = Math.max(0, opts.delayMs ?? 50);

  const stats = {
    total,
    success: 0,
    rateLimit: 0,
    otherErrors: 0,
    errors: 0,
    latencies: [] as number[],
  };

  const tasks: (() => Promise<void>)[] = [];
  for (let i = 0; i < total; i++) {
    const url = urls[i % urls.length];
    tasks.push(async () => {
      const start = Date.now();
      try {
        const res = await secFetch(url, { priority: false });
        const status = res.status;
        const dur = Date.now() - start;
        stats.latencies.push(dur);
        if (status === 429) {
          stats.rateLimit++;
        } else if (status >= 200 && status < 300) {
          stats.success++;
        } else {
          stats.otherErrors++;
        }
      } catch (e) {
        stats.errors++;
        debug('secApiStressTest request error', e);
      }
    });
  }

  // run tasks in batches of `parallel`
  for (let i = 0; i < tasks.length; i += parallel) {
    const batch = tasks.slice(i, i + parallel).map((t) => t());
    await Promise.all(batch);
    if (i + parallel < tasks.length) await wait(delayBetweenBatches);
  }

  const avgLatency = stats.latencies.length > 0 ? stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length : 0;
  const result = { ...stats, avgLatency };
  info('secApiStressTest complete', result);
  return result;
}

/**
 * Prefetch a set of URLs and refresh persistent cache if stale (>24h).
 * Runs non-blocking; uses force=true to update cache.
 */
export async function prefetchDaily(urls: string[]) {
  if (!Array.isArray(urls) || urls.length === 0) return;
  for (const url of urls) {
    try {
      const key = encodeURIComponent(url);
      const p = await readPersistentCache(key);
      if (p && (Date.now() - p.timestamp) < DEFAULT_PERSISTENT_TTL_MS) {
        // still fresh
        continue;
      }
      // refresh in low-priority background (don't await)
      void secFetch(url, { force: true, priority: false });
    } catch (e) {
      // ignore per-url errors
      continue;
    }
  }
}

/**
 * Schedule daily prefetch; returns a cleanup function to cancel the interval.
 * Call this once at app startup with commonly-used SEC endpoints (e.g., company_tickers.json, common CIK submissions)
 */
export function scheduleDailyPrefetch(urls: string[]) {
  void prefetchDaily(urls);
  const id = setInterval(() => {
    void prefetchDaily(urls);
  }, DEFAULT_PERSISTENT_TTL_MS);
  return () => clearInterval(id);
}
