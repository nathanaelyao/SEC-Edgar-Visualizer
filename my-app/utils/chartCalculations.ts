import { Transaction } from './db';
import { fetchStockHistory } from './secApi';
import { convertCurrency } from './currency';

export interface ChartDataPoint {
    timestamp: number | string; // Support both formats for compatibility
    totalValue: number; // Portfolio value at this timestamp
    totalProfit: number; // Profit/loss relative to start value
    returnPercent: number; // Return % relative to start value
    benchmarkReturn?: number; // S&P 500 return % for comparison
}

interface HoldingsSnapshot {
    shares: Record<string, number>; // symbol -> shares
    cash: Record<string, number>; // currency -> amount
}

/**
 * Calculate portfolio holdings and cash at a specific timestamp
 */
function getPortfolioStateAtTime(
    timestamp: number,
    transactions: Transaction[]
): HoldingsSnapshot {
    const shares: Record<string, number> = {};
    const cash: Record<string, number> = {};

    // Sort transactions by date
    const sortedTxs = [...transactions].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Replay all transactions up to this timestamp
    for (const tx of sortedTxs) {
        const txTime = new Date(tx.date).getTime();
        if (txTime > timestamp) break;

        const cur = tx.currency || 'USD';
        if (!cash[cur]) cash[cur] = 0;

        const totalAmt = (tx.type === 'buy' || tx.type === 'sell')
            ? tx.shares * tx.price
            : tx.price;

        if (tx.type === 'deposit') {
            cash[cur] += totalAmt;
        } else if (tx.type === 'withdraw') {
            cash[cur] -= totalAmt;
        } else if (tx.type === 'buy') {
            // Deduct from cash (or treat as implicit deposit if insufficient)
            if (cash[cur] < totalAmt) {
                cash[cur] = 0;
            } else {
                cash[cur] -= totalAmt;
            }
            shares[tx.symbol] = (shares[tx.symbol] || 0) + tx.shares;
        } else if (tx.type === 'sell') {
            cash[cur] += totalAmt;
            shares[tx.symbol] = Math.max(0, (shares[tx.symbol] || 0) - tx.shares);
        }
    }

    return { shares, cash };
}


/**
 * Get price for a symbol at a specific timestamp from historical data
 */
function getPriceAtTime(
    symbol: string,
    timestamp: number,
    priceData: Record<string, { timestamp: number; price: number }[]>
): number {
    const points = priceData[symbol];
    if (!points || points.length === 0) return 0;

    // Try to find exact match
    const exact = points.find(p => p.timestamp === timestamp);
    if (exact) return exact.price;

    // Find most recent price before this timestamp
    const prev = points.filter(p => p.timestamp < timestamp).pop();
    if (prev) return prev.price;

    // If timestamp is before all data, use first available price
    // If timestamp is after all data, use last available price (most recent)
    const next = points.filter(p => p.timestamp > timestamp)[0];
    if (next) return points[0].price; // Timestamp is before all data

    // Timestamp is after all data - use most recent price
    return points[points.length - 1].price;
}

/**
 * Calculate portfolio value at a specific timestamp
 */
function calculatePortfolioValue(
    timestamp: number,
    transactions: Transaction[],
    priceData: Record<string, { timestamp: number; price: number }[]>,
    displayCurrency: string,
    exchangeRates: Record<string, number>
): number {
    const state = getPortfolioStateAtTime(timestamp, transactions);
    let totalValue = 0;

    // Add stock value
    for (const [symbol, shareCount] of Object.entries(state.shares)) {
        if (shareCount <= 0) continue;
        const price = getPriceAtTime(symbol, timestamp, priceData);
        const value = shareCount * price;
        totalValue += convertCurrency(value, 'USD', displayCurrency, exchangeRates);
    }

    // Add cash value
    for (const [currency, amount] of Object.entries(state.cash)) {
        totalValue += convertCurrency(amount, currency, displayCurrency, exchangeRates);
    }

    return totalValue;
}

/**
 * Get start timestamp for a time range
 */
function getStartTimestamp(range: '1D' | '1W' | '1M' | 'YTD' | '1Y' | '5Y' | 'ALL', firstTxDate?: number): number {
    const now = new Date();

    if (range === '1D') {
        const today = new Date(now);
        today.setHours(9, 30, 0, 0); // Market open
        return today.getTime();
    } else if (range === '1W') {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        return weekAgo.getTime();
    } else if (range === '1M') {
        const monthAgo = new Date(now);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        return monthAgo.getTime();
    } else if (range === 'YTD') {
        const yearStart = new Date(now.getFullYear(), 0, 1);
        return yearStart.getTime();
    } else if (range === '1Y') {
        const yearAgo = new Date(now);
        yearAgo.setFullYear(yearAgo.getFullYear() - 1);
        return yearAgo.getTime();
    } else if (range === '5Y') {
        const fiveYearsAgo = new Date(now);
        fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
        return fiveYearsAgo.getTime();
    } else { // ALL
        if (firstTxDate) return firstTxDate;
        return now.getTime();
    }
}

/**
 * Main function to calculate portfolio chart data
 */
export async function calculatePortfolioChart(
    transactions: Transaction[],
    timeRange: '1D' | '1W' | '1M' | 'YTD' | '1Y' | '5Y' | 'ALL',
    displayCurrency: string,
    exchangeRates: Record<string, number>,
    includeBenchmark: boolean = false
): Promise<ChartDataPoint[]> {
    if (transactions.length === 0) {
        return [];
    }

    // Get all unique symbols
    const symbols = Array.from(new Set(transactions.map(t => t.symbol).filter(s => s !== 'USD')));

    // Find first transaction date
    const firstTxTime = Math.min(...transactions.map(t => new Date(t.date).getTime()));
    const firstTxDate = new Date(firstTxTime);
    firstTxDate.setHours(0, 0, 0, 0);

    // Get start timestamp for range
    let startTimestamp = getStartTimestamp(timeRange, firstTxDate.getTime());

    // Don't show data before portfolio existed
    if (startTimestamp < firstTxDate.getTime()) {
        startTimestamp = firstTxDate.getTime();
    }

    // Determine interval and range for API
    let apiRange = '1d';
    let interval = '2m';

    if (timeRange === '1W') {
        apiRange = '5d';
        interval = '15m';
    } else if (timeRange === '1M') {
        apiRange = '1mo';
        interval = '1d';
    } else if (timeRange === 'YTD' || timeRange === '1Y') {
        apiRange = timeRange === 'YTD' ? 'ytd' : '1y';
        interval = '1d';
    } else if (timeRange === '5Y') {
        apiRange = '5y';
        interval = '1wk';
    } else if (timeRange === 'ALL') {
        apiRange = 'max';
        interval = '1d';
    }

    // Fetch historical prices for all symbols
    const pricePromises = symbols.map(s =>
        fetchStockHistory(s, apiRange, interval).then(data => ({ symbol: s, data }))
    );


    const priceResults = await Promise.all(pricePromises);
    const priceData: Record<string, { timestamp: number; price: number }[]> = {};

    priceResults.forEach(res => {
        if (res.data && res.data.length > 0) {
            priceData[res.symbol] = res.data;
        }
    });

    // Check if we have price data for all symbols
    const missingSymbols = symbols.filter(s => !priceData[s] || priceData[s].length === 0);
    if (missingSymbols.length > 0) {
        console.warn(`Missing price data for symbols: ${missingSymbols.join(', ')}`);
        // Return empty array if we're missing critical data
        // This prevents showing incorrect $0 values
        return [];
    }

    // Fetch S&P 500 data if needed
    let spyData: { timestamp: number; price: number }[] = [];
    if (includeBenchmark) {
        spyData = await fetchStockHistory('SPY', apiRange, interval);
    }

    // Collect all timestamps from price data
    const timestampSet = new Set<number>();
    Object.values(priceData).forEach(points => {
        points.forEach(p => {
            if (p.timestamp >= startTimestamp) {
                timestampSet.add(p.timestamp);
            }
        });
    });

    // Add benchmark timestamps
    if (includeBenchmark && spyData.length > 0) {
        spyData.forEach(p => {
            if (p.timestamp >= startTimestamp) {
                timestampSet.add(p.timestamp);
            }
        });
    }

    const timestamps = Array.from(timestampSet).sort((a, b) => a - b);

    // If no market data, use transaction dates
    if (timestamps.length === 0) {
        const txTimestamps = transactions
            .map(t => new Date(t.date).getTime())
            .filter(t => t >= startTimestamp);
        timestamps.push(...txTimestamps, Date.now());
    }

    // Ensure we have at least start and end
    if (timestamps.length === 0) {
        timestamps.push(startTimestamp, Date.now());
    }

    // For 1D view, ensure we start at market open (9:30 AM) even if API data starts later
    if (timeRange === '1D' && timestamps.length > 0 && timestamps[0] > startTimestamp) {
        timestamps.unshift(startTimestamp);
    }

    // Calculate portfolio value at start for return calculation
    // For intraday/short-term views (1D, 1W), use the first timestamp as-is
    // For longer periods, find first timestamp where portfolio has actual value
    // This handles cases where the time range starts before the portfolio existed
    let startValue = 0;
    let startIndex = 0;

    if (timeRange === '1D' || timeRange === '1W') {
        // For short-term views, always start from the beginning of the period
        startValue = calculatePortfolioValue(
            timestamps[0],
            transactions,
            priceData,
            displayCurrency,
            exchangeRates
        );
    } else {
        // For longer periods, find first non-zero value to avoid flat charts
        for (let i = 0; i < timestamps.length; i++) {
            const value = calculatePortfolioValue(
                timestamps[i],
                transactions,
                priceData,
                displayCurrency,
                exchangeRates
            );
            if (value > 0) {
                startValue = value;
                startIndex = i;
                break;
            }
        }
    }

    // Get SPY start price for benchmark (use same start index)
    let spyStartPrice = 0;
    if (includeBenchmark && spyData.length > 0) {
        const spyStart = spyData.find(p => p.timestamp >= timestamps[startIndex]);
        if (spyStart) spyStartPrice = spyStart.price;
    }

    // Generate chart data points (only from startIndex onwards)
    const chartData: ChartDataPoint[] = timestamps.slice(startIndex).map(ts => {
        const portfolioValue = calculatePortfolioValue(
            ts,
            transactions,
            priceData,
            displayCurrency,
            exchangeRates
        );

        const totalProfit = portfolioValue - startValue;
        const returnPercent = startValue > 0
            ? (totalProfit / startValue) * 100
            : 0;

        let benchmarkReturn: number | undefined;
        if (includeBenchmark && spyStartPrice > 0) {
            const spyPrice = getPriceAtTime('SPY', ts, { SPY: spyData });
            benchmarkReturn = ((spyPrice - spyStartPrice) / spyStartPrice) * 100;
        }

        return {
            timestamp: new Date(ts).toISOString(),
            totalValue: portfolioValue,
            totalProfit,
            returnPercent,
            benchmarkReturn
        };
    });

    return chartData;
}
