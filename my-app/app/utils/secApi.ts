import AsyncStorage from '@react-native-async-storage/async-storage';

// secApi.ts
// Centralized SEC API client with request queue, retries, worker-pool concurrency and persistent caching to avoid rate limits.

type SecFetchOptions = {
  cacheTTL?: number; // ms
  force?: boolean; // bypass cache
};

const USER_AGENT = 'SEC_APP (nathanael.yao123@gmail.com)';
const DEFAULT_DELAY_MS = 300; // delay between requests for rate limiting per worker
const MAX_RETRIES = 5;
const PERSISTENT_CACHE_PREFIX = '@secapi:cache:';

type CachedEntry = {
  timestamp: number;
  text: string;
  status: number;
  headers: Record<string, string>;
};

const cache = new Map<string, CachedEntry>();
let queue: Array<() => Promise<void>> = [];
let processing = false;
let runningWorkers = 0;

function wait(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
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
  const concurrency = Math.max(1, (global as any).__SEC_API_CONCURRENCY ?? 4);
  const delayMs = () => (global as any).__SEC_API_DELAY ?? DEFAULT_DELAY_MS;

  const startWorker = async () => {
    runningWorkers++;
    try {
      while (queue.length > 0) {
        const task = queue.shift()!;
        try {
          await task();
        } catch (e) {
          console.warn('secApi task error', e);
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
      if (p && Date.now() - p.timestamp < ttl) {
        cache.set(cacheKey, p);
        return makeResponseFromCache(p);
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
              const retryAfterMs = parseRetryAfter(headersObj['retry-after'] ?? null) ?? backoff;
              const cap = Math.min(retryAfterMs, 60 * 1000);
              await wait(cap);
              backoff = Math.min(backoff * 2, 60 * 1000);
              if (attempt >= MAX_RETRIES) {
                const cacheEntry: CachedEntry = { timestamp: Date.now(), text, status: res.status, headers: headersObj };
                resolve(makeResponseFromCache(cacheEntry));
                break;
              }
              continue; // retry
            }

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
            await wait(backoff);
            backoff = Math.min(backoff * 2, 60 * 1000);
          }
        }
      } catch (err) {
        reject(err);
      }
    };

    queue.push(task);
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
