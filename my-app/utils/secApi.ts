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
// Default persistent cache TTL: 24 hours (increased from 6 hours for better multi-user performance)
const DEFAULT_PERSISTENT_TTL_MS = 24 * 60 * 60 * 1000;
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
  } catch (e) { }
}

async function clearAllPersistentCache() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const secKeys = keys.filter(k => k.startsWith(PERSISTENT_CACHE_PREFIX));
    if (secKeys.length) await AsyncStorage.multiRemove(secKeys);
  } catch (e) { }
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
            } catch (e) { }

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

export function scheduleDailyPrefetch(urls: string[]) {
  void prefetchDaily(urls);
  const id = setInterval(() => {
    void prefetchDaily(urls);
  }, DEFAULT_PERSISTENT_TTL_MS);
  return () => clearInterval(id);
}

/**
 * MARKET DATA (GITHUB SOURCE)
 * Pulls stock prices from rreichel3/US-Stock-Symbols repository.
 * Data is updated regularly via GitHub Actions.
 */
const GITHUB_SOURCE_URLS = [
  'https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/refs/heads/main/nasdaq/nasdaq_full_tickers.json',
  'https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/refs/heads/main/nyse/nyse_full_tickers.json',
  'https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/refs/heads/main/amex/amex_full_tickers.json'
];

export interface StockQuote {
  price: number;
  change: number;
  percent: number;
  currency: string;
  lastUpdated: number;
  marketCap?: number;
  volume?: number;
  peRatio?: number;
  earningsTimestamp?: number;
  previousClose?: number;
  preMarketPrice?: number;
  postMarketPrice?: number;
  marketState?: string;
  dividendRate?: number;
  dividendYield?: number;
}

export interface DividendEvent {
  date: number;
  amount: number;
}

export interface HistoryPoint {
  timestamp: number;
  price: number;
}

// Internal cache for the full ticker lists to avoid redundant downloads
let tickerListsCache: any[] | null = null;
let lastTickerCacheUpdate = 0;

const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

async function fetchYahoo(path: string): Promise<any> {
  const hosts = [...YAHOO_HOSTS];
  // Randomize initial host to load balance
  if (Math.random() > 0.5) hosts.reverse();

  for (const host of hosts) {
    const url = `https://${host}${path}`;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        }
      });

      if (res.status === 429) {
        warn(`Yahoo 429 on ${host}, trying next...`);
        await new Promise(r => setTimeout(r, 1000)); // wait 1s
        continue;
      }

      if (res.ok) {
        return await res.json();
      }
      // For other errors (404, 500), maybe try next too?
      warn(`Yahoo ${res.status} on ${host}, trying next...`);
    } catch (e) {
      warn(`Yahoo fetch failed on ${host}: ${e}`);
    }
  }
  throw new Error("All Yahoo hosts failed");
}

/**
 * Fetch a quote from Yahoo Finance unofficial API.
 * Uses a browser-like User-Agent to avoid immediate blocks.
 */
async function fetchYahooQuote(symbol: string): Promise<StockQuote | null> {
  const upperSymbol = symbol.toUpperCase();

  // 1. Try v7 Quote API (Preferred for Dividends/PE)
  // const v7Url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${upperSymbol}`;
  const v7Path = `/v7/finance/quote?symbols=${upperSymbol}`;

  try {
    const data = await fetchYahoo(v7Path);
    const result = data?.quoteResponse?.result?.[0];
    if (result) {
      const price = result.regularMarketPrice || result.postMarketPrice || 0;
      const prevClose = result.regularMarketPreviousClose || price;
      const change = result.regularMarketChange || (price - prevClose);
      const percent = result.regularMarketChangePercent || (prevClose > 0 ? (change / prevClose) * 100 : 0);

      return {
        price,
        change,
        percent,
        currency: result.currency || 'USD',
        lastUpdated: Date.now(),
        marketCap: result.marketCap,
        volume: result.regularMarketVolume,
        peRatio: result.trailingPE,
        dividendRate: result.dividendRate,
        dividendYield: result.dividendYield,
        previousClose: prevClose,
        marketState: result.marketState
      };
    }
  } catch (err) {
    warn(`Error fetching quote from Yahoo v7 for ${upperSymbol}: ${err}`);
  }

  // 2. Fallback to v8 Chart API (Reliable for Price)
  const v8Path = `/v8/finance/chart/${upperSymbol}?interval=1d&range=1d&includePrePost=true`;
  try {
    const data = await fetchYahoo(v8Path);
    const result = data?.chart?.result?.[0]?.meta;

    if (!result) {
      warn(`No data found in Yahoo Finance v8 response for ${upperSymbol}`);
      return null;
    }

    // Capture standard fields from chart meta
    const price = result.regularMarketPrice || result.previousClose || 0;
    const prevClose = result.chartPreviousClose || result.previousClose || price;
    const change = price - prevClose;
    const percent = prevClose > 0 ? (change / prevClose) * 100 : 0;

    return {
      price,
      change,
      percent,
      currency: result.currency || 'USD',
      lastUpdated: Date.now(),
      marketCap: result.marketCap,
      volume: result.regularMarketVolume,
      // Missing PE/Dividends in v8 meta
    };
  } catch (err) {
    error(`Error fetching from Yahoo Finance (v8 fallback) for ${upperSymbol}:`, err);
    return null;
  }
}

/**
 * Fetch historical price data from Yahoo Finance.
 * @param symbol The stock ticker symbol.
 * @param range Valid ranges: '1d', '5d', '1mo', '6mo', '1y', '5y', 'max'.
 * @param interval Valid intervals: '1m', '2m', '5m', '15m', '30m', '60m', '1h', '1d', '5d', '1wk', '1mo', '3mo'.
 */
export async function fetchStockHistory(
  symbol: string,
  range: string = '1mo',
  interval: string = '1d',
  includePrePost: boolean = false
): Promise<HistoryPoint[]> {
  const upperSymbol = symbol.toUpperCase();
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${upperSymbol}?interval=${interval}&range=${range}${includePrePost ? '&includePrePost=true' : ''}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      }
    });

    if (!res.ok) {
      warn(`Yahoo Finance History API returned status ${res.status} for ${upperSymbol}`);
      return [];
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0];

    if (!result || !result.timestamp || !result.indicators?.quote?.[0]?.close) {
      warn(`No history data found in Yahoo Finance response for ${upperSymbol}`);
      return [];
    }

    const timestamps = result.timestamp as number[];
    const prices = result.indicators.quote[0].close as (number | null)[];

    const history: HistoryPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (prices[i] !== null && prices[i] !== undefined) {
        history.push({
          timestamp: timestamps[i] * 1000, // Yahoo uses seconds
          price: prices[i]!
        });
      }
    }

    return history;
  } catch (err) {
    error(`Error fetching history from Yahoo Finance for ${upperSymbol}:`, err);
    return [];
  }
}

export async function fetchDividendHistory(symbol: string, range: string = '5y'): Promise<DividendEvent[]> {
  const upperSymbol = symbol.toUpperCase();
  const path = `/v8/finance/chart/${upperSymbol}?interval=1mo&range=${range}&events=div`;

  try {
    const data = await fetchYahoo(path);
    const events = data?.chart?.result?.[0]?.events?.dividends;

    if (!events) return [];

    const dividends: DividendEvent[] = [];
    for (const key in events) {
      const div = events[key];
      if (div && div.amount) {
        dividends.push({
          date: div.date * 1000,
          amount: div.amount
        });
      }
    }
    return dividends.sort((a, b) => a.date - b.date);
  } catch (err) {
    warn(`Error fetching dividends for ${upperSymbol}: ${err}`);
    return [];
  }
}
/**
 * Search for tickers, companies, and other financial instruments using Yahoo Finance.
 * Supports global markets, crypto, and ETFs.
 */
export async function yahooSearch(query: string): Promise<any[]> {
  if (!query || query.length < 1) return [];

  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&enableFuzzyQuery=false&quotesQueryId=tss_match_query_v2`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      }
    });

    if (!res.ok) {
      warn(`Yahoo Search failed for ${query}: ${res.status}`);
      return [];
    }

    const data = await res.json();
    return data.quotes || [];
  } catch (err) {
    error(`Error searching Yahoo Finance for ${query}:`, err);
    return [];
  }
}

export async function fetchStockPrice(symbol: string): Promise<StockQuote> {
  const upperSymbol = symbol.toUpperCase();
  const CACHE_KEY = `quote:${upperSymbol}`;

  // 1. Check quote memory cache (5 min TTL)
  const cachedQuote = cache.get(CACHE_KEY);
  if (cachedQuote && (Date.now() - cachedQuote.timestamp) < 5 * 60 * 1000) {
    return JSON.parse(cachedQuote.text);
  }

  // 2. Try Yahoo Finance as Primary Source
  info(`Fetching price for ${upperSymbol} from Yahoo Finance (Primary)`);
  const yahooQuote = await fetchYahooQuote(upperSymbol);

  if (yahooQuote && yahooQuote.price > 0) {
    // Update cache
    cache.set(CACHE_KEY, {
      timestamp: Date.now(),
      text: JSON.stringify(yahooQuote),
      status: 200,
      headers: {}
    });
    return yahooQuote;
  }

  // 3. Fallback to GitHub Source
  info(`Yahoo failed for ${upperSymbol}, falling back to GitHub source...`);
  try {
    const TICKER_LIST_TTL = 12 * 60 * 60 * 1000;
    if (!tickerListsCache || (Date.now() - lastTickerCacheUpdate) > TICKER_LIST_TTL) {
      info('Refreshing ticker lists from GitHub...');
      const lists = await Promise.all(GITHUB_SOURCE_URLS.map(async url => {
        const res = await fetch(url);
        return res.json();
      }));
      tickerListsCache = lists.flat();
      lastTickerCacheUpdate = Date.now();
    }

    const entry = tickerListsCache?.find(item => item.symbol === upperSymbol);

    if (entry) {
      const priceStr = entry.lastsale?.replace('$', '') || '0';
      const quote: StockQuote = {
        price: parseFloat(priceStr),
        change: parseFloat(entry.netchange || '0'),
        percent: parseFloat(entry.pctchange?.replace('%', '') || '0'),
        currency: 'USD',
        lastUpdated: Date.now()
      };

      // Update cache
      cache.set(CACHE_KEY, {
        timestamp: Date.now(),
        text: JSON.stringify(quote),
        status: 200,
        headers: {}
      });

      return quote;
    }

    warn(`Symbol ${upperSymbol} not found in any source`);
    return { price: 0, change: 0, percent: 0, currency: 'USD', lastUpdated: 0 };
  } catch (err) {
    error(`Failed to fetch stock price for ${upperSymbol}:`, err);
    return { price: 0, change: 0, percent: 0, currency: 'USD', lastUpdated: 0 };
  }
}
/**
 * Fetch the closing price for a specific date.
 * Tries to find the exact date, or falls back to the closest previous trading day if it's a weekend/holiday.
 */
export async function fetchPriceForDate(symbol: string, date: Date): Promise<number | null> {
  // We need to fetch enough history to ensure we cover the date.
  // Yahoo's "range" is relative to "now", preventing us from easily asking for a specific historical window
  // in the past without calculating the range string.
  // However, we can just fetch a large enough range (e.g. '1y' or '5y' or 'max') if the date is far back,
  // or calculate the number of days difference.

  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  let range = '1mo';
  if (diffDays > 1825) range = 'max'; // > 5 years
  else if (diffDays > 365) range = '5y'; // > 1 year
  else if (diffDays > 30) range = '1y'; // > 1 month
  else if (diffDays > 5) range = '1mo'; // > 5 days

  // Fetch history
  const history = await fetchStockHistory(symbol, range, '1d');

  if (!history || history.length === 0) return null;

  // Find the entry for the specific date.
  // Compare year/month/day
  const targetYMD = date.toISOString().split('T')[0];

  // Try to find exact match first
  const exactMatch = history.find(p => {
    const pointDate = new Date(p.timestamp);
    return pointDate.toISOString().split('T')[0] === targetYMD;
  });

  if (exactMatch) return exactMatch.price;

  // If no exact match (weekend/holiday), find the closest PREVIOUS date.
  // Filter for points before the target date
  const previousPoints = history.filter(p => p.timestamp < date.getTime());

  if (previousPoints.length > 0) {
    // Sort by timestamp descending to get the latest one before the target date
    previousPoints.sort((a, b) => b.timestamp - a.timestamp);
    return previousPoints[0].price;
  }

  return null;
}
