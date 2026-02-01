import * as SQLite from 'expo-sqlite';
import { fetchStockPrice, fetchStockHistory } from './secApi';

/**
 * db.ts
 * Manages local persistence for user portfolio holdings using expo-sqlite.
 */

export interface PortfolioHolding {
    id?: number;
    symbol: string;
    companyName: string;
    shares: number;
    price?: number; // Last known price (in native currency)
    priceChange?: number; // Daily dollar change (in native currency)
    pricePercent?: number; // Daily percentage change
    costBasis?: number; // Average purchase price (in native currency)
    currency?: string; // Native currency of the stock (e.g., 'USD', 'CNY', 'EUR')
    realizedProfit?: number; // Total profit/loss realized from sales (in native currency)
    lastTransactionDate?: string; // Date of the last buy/sell (ISO string)
}

export interface PortfolioSnapshot {
    id?: number;
    timestamp: string;
    totalValue: number;
    totalProfit: number;
}

export interface Transaction {
    id?: number;
    symbol: string;
    type: 'buy' | 'sell' | 'deposit' | 'withdraw';
    shares: number;
    price: number;
    date: string;
    createdAt?: string;
}

let db: SQLite.SQLiteDatabase | null = null;

export const initDb = async () => {
    if (db) return db;

    db = await SQLite.openDatabaseAsync('portfolio.db');

    await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS portfolio (
            id INTEGER PRIMARY KEY NOT NULL,
            symbol TEXT NOT NULL UNIQUE,
            companyName TEXT NOT NULL,
            shares REAL NOT NULL,
            price REAL,
            costBasis REAL,
            currency TEXT DEFAULT 'USD',
            realizedProfit REAL DEFAULT 0,
            lastTransactionDate TEXT
        );

        CREATE TABLE IF NOT EXISTS portfolio_history (
            id INTEGER PRIMARY KEY NOT NULL,
            timestamp TEXT NOT NULL,
            totalValue REAL NOT NULL,
            totalProfit REAL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY NOT NULL,
            symbol TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('buy', 'sell')),
            shares REAL NOT NULL,
            price REAL NOT NULL,
            date TEXT NOT NULL,
            createdAt TEXT DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Initialize default settings if they don't exist
    await db.execAsync(`
        INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'system');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('currency', 'USD');
    `);

    // Migration: Add price column if it doesn't exist (for existing tables)
    try {
        const tableInfo = await db.getAllAsync<{ name: string }>('PRAGMA table_info(portfolio);');
        const hasPrice = tableInfo.some(col => col.name === 'price');
        if (!hasPrice) {
            await db.execAsync('ALTER TABLE portfolio ADD COLUMN price REAL;');
        }
        const hasCostBasis = tableInfo.some(col => col.name === 'costBasis');
        if (!hasCostBasis) {
            await db.execAsync('ALTER TABLE portfolio ADD COLUMN costBasis REAL;');
            // Initialize costBasis with current price for existing holdings
            await db.execAsync('UPDATE portfolio SET costBasis = price WHERE costBasis IS NULL;');
        }
        const hasRealizedProfit = tableInfo.some(col => col.name === 'realizedProfit');
        if (!hasRealizedProfit) {
            await db.execAsync('ALTER TABLE portfolio ADD COLUMN realizedProfit REAL DEFAULT 0;');
        }
        const hasLastTransactionDate = tableInfo.some(col => col.name === 'lastTransactionDate');
        if (!hasLastTransactionDate) {
            await db.execAsync('ALTER TABLE portfolio ADD COLUMN lastTransactionDate TEXT;');
        }
        const hasCurrency = tableInfo.some(col => col.name === 'currency');
        if (!hasCurrency) {
            await db.execAsync("ALTER TABLE portfolio ADD COLUMN currency TEXT DEFAULT 'USD';");
        }

        const historyInfo = await db.getAllAsync<{ name: string }>('PRAGMA table_info(portfolio_history);');
        const hasTotalProfit = historyInfo.some(col => col.name === 'totalProfit');
        if (!hasTotalProfit) {
            await db.execAsync('ALTER TABLE portfolio_history ADD COLUMN totalProfit REAL DEFAULT 0;');
        }

        // Migration for transactions type: allow 'deposit' and 'withdraw'
        // We use a version check in settings
        const versionRow = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'db_schema_version';");
        const currentVersion = versionRow ? parseInt(versionRow.value) : 1;

        if (currentVersion < 2) {
            console.log("Migrating DB to version 2 (Transaction types)");
            await db.execAsync(`
                PRAGMA foreign_keys=off;
                CREATE TABLE IF NOT EXISTS transactions_new (
                    id INTEGER PRIMARY KEY NOT NULL,
                    symbol TEXT NOT NULL,
                    type TEXT NOT NULL CHECK(type IN ('buy', 'sell', 'deposit', 'withdraw')),
                    shares REAL NOT NULL,
                    price REAL NOT NULL,
                    date TEXT NOT NULL,
                    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
                );
                INSERT INTO transactions_new (id, symbol, type, shares, price, date, createdAt)
                SELECT id, symbol, type, shares, price, date, createdAt FROM transactions;
                DROP TABLE transactions;
                ALTER TABLE transactions_new RENAME TO transactions;
                PRAGMA foreign_keys=on;
                INSERT OR REPLACE INTO settings (key, value) VALUES ('db_schema_version', '2');
             `);
        }

    } catch (e) {
        console.error('Migration error:', e);
    }

    return db;
};

export const getHolding = async (symbol: string): Promise<PortfolioHolding | null> => {
    const database = await initDb();
    const row = await database.getFirstAsync<PortfolioHolding>(
        'SELECT * FROM portfolio WHERE symbol = ?;',
        [symbol.toUpperCase()]
    );
    return row;
};



export const getTransactions = async (symbol: string): Promise<Transaction[]> => {
    const database = await initDb();
    return await database.getAllAsync<Transaction>(
        'SELECT * FROM transactions WHERE symbol = ? ORDER BY date DESC, createdAt DESC;',
        [symbol.toUpperCase()]
    );
};

export const getAllTransactions = async (): Promise<Transaction[]> => {
    const database = await initDb();
    return await database.getAllAsync<Transaction>(
        'SELECT * FROM transactions ORDER BY date DESC, createdAt DESC;'
    );
};

export const addTransaction = async (transaction: Transaction) => {
    const database = await initDb();
    await database.runAsync(
        'INSERT INTO transactions (symbol, type, shares, price, date) VALUES (?, ?, ?, ?, ?);',
        [transaction.symbol.toUpperCase(), transaction.type, transaction.shares, transaction.price, transaction.date]
    );
    // Only recalculate portfolio holding if it's a trade (buy/sell)
    if (transaction.type === 'buy' || transaction.type === 'sell') {
        return await recalculatePortfolio(transaction.symbol);
    }
};

export const getCashBalance = async (): Promise<number> => {
    const database = await initDb();
    const transactions = await database.getAllAsync<Transaction>('SELECT * FROM transactions;');

    // Starting balance could be 0 or managed via a Setting? 
    // Let's assume 0 start and calculate net.
    let cash = 0;

    for (const tx of transactions) {
        if (tx.type === 'deposit') {
            cash += tx.price; // Price logic: for deposit, price is the amount? Or shares * price?
            // Convention: shares=1, price=amount.
        } else if (tx.type === 'withdraw') {
            cash -= tx.price;
        }
    }
    return cash;
};

export const updateTransaction = async (id: number, transaction: Partial<Transaction>) => {
    const database = await initDb();
    // Verify transaction exists and get symbol
    const existing = await database.getFirstAsync<Transaction>('SELECT * FROM transactions WHERE id = ?;', [id]);
    if (!existing) throw new Error("Transaction not found");

    const updates: string[] = [];
    const values: any[] = [];

    if (transaction.type) { updates.push('type = ?'); values.push(transaction.type); }
    if (transaction.shares) { updates.push('shares = ?'); values.push(transaction.shares); }
    if (transaction.price) { updates.push('price = ?'); values.push(transaction.price); }
    if (transaction.date) { updates.push('date = ?'); values.push(transaction.date); }

    if (updates.length > 0) {
        values.push(id);
        await database.runAsync(
            `UPDATE transactions SET ${updates.join(', ')} WHERE id = ?;`,
            values
        );
        return await recalculatePortfolio(existing.symbol);
    }
};



const recalculatePortfolio = async (symbol: string) => {
    const database = await initDb();
    const transactions = await database.getAllAsync<Transaction>(
        'SELECT * FROM transactions WHERE symbol = ? ORDER BY date ASC, createdAt ASC;',
        [symbol.toUpperCase()]
    );

    let totalShares = 0;
    let costBasis = 0;
    let realizedProfit = 0;
    let lastTransactionDate = new Date(0).toISOString();

    for (const tx of transactions) {
        if (tx.type === 'buy') {
            const oldTotalValue = totalShares * costBasis;
            const newTotalValue = oldTotalValue + (tx.shares * tx.price);
            totalShares += tx.shares;
            costBasis = totalShares > 0 ? newTotalValue / totalShares : 0;
        } else if (tx.type === 'sell') {
            const sharesToSell = Math.min(tx.shares, totalShares); // Prevent negative shares logically?
            // Realized profit calculation
            const profit = (tx.price - costBasis) * sharesToSell;
            realizedProfit += profit;
            totalShares -= sharesToSell;
            // Cost basis remains the same on sell, or 0 if empty
            if (totalShares <= 0) {
                totalShares = 0;
                costBasis = 0; // Reset cost basis if fully sold? 
                // Usually cost basis is undefined if 0 shares, but for resumption we might want 0.
            }
        }
        if (tx.date > lastTransactionDate) {
            lastTransactionDate = tx.date;
        }
    }

    // Upsert portfolio record
    const existing = await getHolding(symbol);
    const currentPrice = existing?.price || 0; // Preserve current price if known

    if (totalShares <= 0 && realizedProfit === 0) {
        // If no shares and no profit, maybe delete? 
        // But we want to keep realized profit records usually.
        // If both 0, it means effectively no history or effective empty. 
        // We'll keep it if there ever was a transaction? 
        // For now, if transactions exist, we keep the record.
        if (transactions.length === 0) {
            await database.runAsync('DELETE FROM portfolio WHERE symbol = ?;', [symbol.toUpperCase()]);
            return;
        }
    }

    if (existing) {
        await database.runAsync(
            'UPDATE portfolio SET shares = ?, costBasis = ?, realizedProfit = ?, lastTransactionDate = ? WHERE symbol = ?;',
            [totalShares, costBasis, realizedProfit, lastTransactionDate, symbol.toUpperCase()]
        );
    } else {
        // Insert new
        // We might not have Company Name here if it's a fresh recalc from just transactions. 
        // But addTransaction likely came from a context where we knew it, or it exists.
        // If it doesn't exist, we might have an issue. 
        // Assumption: addTransaction is usually called after addHolding checks or we need to pass company name to addTransaction?
        // Let's assume for now we don't create NEW portfolio entries from purely `recalculate` unless we have data.
        // But `addHolding` handles the creation.
        // If we are here, and `existing` is null, it means we deleted the portfolio row but have transactions?
        // We should ensure `addHolding` creates the row first.
    }
};

// Refactored addHolding to use transactions
export const addHolding = async (holding: PortfolioHolding) => {
    // Ensure portfolio row exists
    const database = await initDb();
    let existing = await getHolding(holding.symbol);
    if (!existing) {
        await database.runAsync(
            'INSERT INTO portfolio (symbol, companyName, shares, price, costBasis, realizedProfit, lastTransactionDate, currency) VALUES (?, ?, 0, ?, 0, 0, ?, ?);',
            [holding.symbol.toUpperCase(), holding.companyName, holding.price || 0, holding.lastTransactionDate || new Date().toISOString(), holding.currency || 'USD']
        );
    } else {
        // Update basic info like price/currency/companyName in case they changed
        await database.runAsync(
            'UPDATE portfolio SET price = ?, currency = ?, lastTransactionDate = ? WHERE symbol = ?;',
            [holding.price || 0, holding.currency || 'USD', holding.lastTransactionDate || new Date().toISOString(), holding.symbol.toUpperCase()]
        );
    }

    const type = holding.shares >= 0 ? 'buy' : 'sell';
    const shares = Math.abs(holding.shares);

    // Add the transaction
    await addTransaction({
        symbol: holding.symbol,
        type,
        shares,
        price: holding.price || 0,
        date: holding.lastTransactionDate || new Date().toISOString()
    });

    // Snapshot logic (preserved from original)
    if (holding.lastTransactionDate) {
        const txDate = new Date(holding.lastTransactionDate);
        if (txDate.getTime() < new Date().getTime() - (1000 * 60 * 60 * 2)) {
            const { fetchExchangeRates, convertCurrency } = require('./currency');
            const rates = await fetchExchangeRates();
            // Get updated portfolio state
            const allHoldings = await getPortfolio();

            let totalValueUsd = 0;
            let totalProfitUsd = 0;

            for (const h of allHoldings) {
                const nativeValue = h.shares * (h.price || 0);
                const nativeCost = h.shares * (h.costBasis || h.price || 0);
                const nativeProfit = (nativeValue - nativeCost) + (h.realizedProfit || 0);

                totalValueUsd += convertCurrency(nativeValue, h.currency || 'USD', 'USD', rates);
                totalProfitUsd += convertCurrency(nativeProfit, h.currency || 'USD', 'USD', rates);
            }

            await addPortfolioSnapshot(totalValueUsd, totalProfitUsd, holding.lastTransactionDate);
            await backfillPortfolioHistory(txDate);
        }
    }
};

// Reconstruct portfolio history from a specific date to now
// This is expensive as it fetches history for ALL holdings, so use sparingly
// Reconstruct portfolio history from a specific date to now
// This is expensive as it fetches history for ALL holdings, so use sparingly
export const backfillPortfolioHistory = async (startDate: Date) => {
    try {
        console.log(`Rewriting portfolio history from ${startDate.toISOString()}`);
        const { fetchExchangeRates } = require('./currency');
        const rates = await fetchExchangeRates();
        const database = await initDb();
        const allHoldings = await getPortfolio();

        // 1. Calculate History Traces for ALL holdings
        const holdingTraces: Record<string, Record<string, { value: number, profit: number }>> = {};
        const allDates = new Set<string>();

        console.log("Fetching traces for holdings...");
        for (const h of allHoldings) {
            const transactions = await getTransactions(h.symbol);
            if (transactions.length > 0) {
                // Fetch price history covering the range
                const history = await fetchStockHistoryForTransactions(h.symbol, transactions);
                const priceHistoryMap: Record<string, number> = {};
                history.forEach(point => {
                    const dateStr = new Date(point.timestamp).toISOString().split('T')[0];
                    priceHistoryMap[dateStr] = point.price;
                });

                // Calculate accurate trace
                const trace = await calculateStockHistoryTrace(h.symbol, transactions, priceHistoryMap, rates);
                holdingTraces[h.symbol] = trace;

                // Collect dates
                Object.keys(trace).forEach(d => allDates.add(d));
            }
        }

        const sortedDates = Array.from(allDates).sort();
        console.log(`Found ${sortedDates.length} relevant historical dates.`);

        // 2. Aggregate and Upsert Snapshots for each date
        // Note: This replaces the simplistic iteration that assumed constant shares.
        for (const dateStr of sortedDates) {
            // Filter to only dates >= startDate (if requested range is strictly enforced)
            // But usually backfill implies "Ensure history is correct from X". 
            // If we have data before X, we might as well update it if we are recalculating?
            // The prompt says "from a specific date to now".
            // Let's stick to the requested range to avoid re-writing ancient history unnecessarily.
            if (dateStr < startDate.toISOString().split('T')[0]) continue;

            let dailyTotalValueUsd = 0;
            let dailyTotalProfitUsd = 0;
            let hasData = false;

            for (const h of allHoldings) {
                const trace = holdingTraces[h.symbol];
                if (trace && trace[dateStr]) {
                    dailyTotalValueUsd += trace[dateStr].value;
                    dailyTotalProfitUsd += trace[dateStr].profit;
                    hasData = true;
                }
            }

            if (hasData) {
                // Format timestamp. Use the dateStr (YYYY-MM-DD) appended with T00:00:00 or T23:59:59?
                // Existing snapshots use ISO strings. 
                // We should preserve the daily granularity.
                // Let's use EOD for consistency with our trace logic, or just the dateStr + T00:00:00Z
                // addPortfolioSnapshot handles 'date%' matching, so T... matters less for uniqueness, 
                // but usually we want consistent sorting.
                const timestamp = `${dateStr}T23:59:59.000Z`;

                // Existing logic checks for snapshot existence by day.
                await addPortfolioSnapshot(dailyTotalValueUsd, dailyTotalProfitUsd, timestamp);
            }
        }

        console.log("Backfill complete with Transaction-Aware logic.");

    } catch (err) {
        console.error("Error backfilling portfolio history:", err);
    }
};

export const addPortfolioSnapshot = async (totalValue: number, totalProfit: number = 0, customTimestamp?: string) => {
    const database = await initDb();
    const timestamp = customTimestamp || new Date().toISOString();

    // Check if we already have a snapshot for this specific day to avoid flooding
    const day = timestamp.split('T')[0];
    const existing = await database.getFirstAsync<{ id: number }>(
        'SELECT id FROM portfolio_history WHERE timestamp LIKE ? LIMIT 1;',
        [`${day}%`]
    );

    if (existing) {
        // Update the snapshot for that day instead of adding new one
        return await database.runAsync(
            'UPDATE portfolio_history SET totalValue = ?, totalProfit = ?, timestamp = ? WHERE id = ?;',
            [totalValue, totalProfit, timestamp, existing.id]
        );
    }

    return await database.runAsync(
        'INSERT INTO portfolio_history (timestamp, totalValue, totalProfit) VALUES (?, ?, ?);',
        [timestamp, totalValue, totalProfit]
    );
};

export const getPortfolioHistory = async (): Promise<PortfolioSnapshot[]> => {
    const database = await initDb();
    return await database.getAllAsync<PortfolioSnapshot>(
        'SELECT * FROM portfolio_history ORDER BY timestamp ASC;'
    );
};

// Helper to calculate the historical trace (Value and Profit) for a set of transactions
// Returns a map of dateStr -> { value: number, profit: number } (in base currency USD)
const calculateStockHistoryTrace = async (
    symbol: string,
    transactions: Transaction[],
    priceHistoryMap: Record<string, number>,
    rates: any
): Promise<Record<string, { value: number, profit: number }>> => {
    const { convertCurrency } = require('./currency');
    const trace: Record<string, { value: number, profit: number }> = {};

    // Sort transactions
    transactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Get range of dates from first transaction to now
    if (transactions.length === 0) return trace;

    // We need to iterate over RELEVANT dates.
    // Ideally we iterate over the keys of priceHistoryMap (which represents daily points)
    // plus any transaction dates.
    // For simplicity, let's iterate through the sorted price history dates.
    const sortedDates = Object.keys(priceHistoryMap).sort();

    let currentShares = 0;
    let cumulativeRealizedProfit = 0;
    let averageCost = 0;
    let txIndex = 0;

    // We also need to handle the holding's currency metadata usually,
    // assuming it comes from the first transaction or we look it up.
    // For trace calculation, we return USD values directly to simplify upstream diffing.
    // We might need to know the currency of the STOCK.
    // We can assume inputs have this or we fetch it.
    // Let's assume we fetch the holding to get currency, or pass it in.
    // Optimization: Just pass currency as arg.
    const holding = await getHolding(symbol);
    const currency = holding?.currency || 'USD';

    let lastKnownPrice = 0;

    for (const dateStr of sortedDates) {
        const date = new Date(dateStr);
        // Set to End of Day (23:59:59.999) to ensure we include transactions from this day
        date.setHours(23, 59, 59, 999);

        // Apply transactions up to this date
        while (txIndex < transactions.length) {
            const tx = transactions[txIndex];
            const txDate = new Date(tx.date);

            if (txDate <= date) { // Include all transactions occurring on or before this day
                if (tx.type === 'buy') {
                    const totalCost = (currentShares * averageCost) + (tx.shares * tx.price);
                    currentShares += tx.shares;
                    averageCost = currentShares > 0 ? totalCost / currentShares : 0;
                } else if (tx.type === 'sell') {
                    const profit = (tx.price - averageCost) * tx.shares;
                    cumulativeRealizedProfit += profit;
                    currentShares -= tx.shares;
                }
                txIndex++;
            } else {
                break;
            }
        }

        // Forward-fill price logic
        let price = priceHistoryMap[dateStr] || 0;
        if (price > 0) {
            lastKnownPrice = price;
        } else if (lastKnownPrice > 0) {
            price = lastKnownPrice;
        }

        // Calculate contribution at this point
        let profitContribution = 0;
        let valueContribution = 0;

        // If we have no price yet (before first history point), we can try to use averageCost if available?
        // Or just wait for price history. Usually history starts before or at buy.
        // If history is missing, value is 0.

        if (currentShares > 0 || cumulativeRealizedProfit !== 0) {
            let nativeUnrealized = 0;
            let nativeValue = 0;

            if (currentShares > 0 && price > 0) {
                nativeValue = currentShares * price;
                const nativeCost = currentShares * averageCost;
                nativeUnrealized = nativeValue - nativeCost;
            } else if (currentShares > 0 && price === 0) {
                // Fallback: if we still have 0 price (e.g. valid history hasn't started), 
                // treat value as COST (so 0 profit impact), or just 0 value?
                // If we treat as 0 value, we get huge negative profit.
                // Better to assume 0 profit impact if no price.
                nativeValue = currentShares * averageCost; // Assume break-even if no price data
                nativeUnrealized = 0;
            }

            profitContribution = convertCurrency(nativeUnrealized + cumulativeRealizedProfit, currency, 'USD', rates);
            valueContribution = convertCurrency(nativeValue, currency, 'USD', rates);
        }

        trace[dateStr] = { value: valueContribution, profit: profitContribution };
    }

    return trace;
};

// Helper to fetch history range based on txs
const fetchStockHistoryForTransactions = async (symbol: string, transactions: Transaction[]) => {
    if (transactions.length === 0) return [];

    const dates = transactions.map(t => new Date(t.date).getTime());
    const minDate = Math.min(...dates);
    const now = new Date().getTime();

    const diffDays = Math.ceil(Math.abs(now - minDate) / (1000 * 60 * 60 * 24));

    let range = '1mo';
    if (diffDays > 1825) range = 'max';
    else if (diffDays > 365) range = '5y';
    else if (diffDays > 30) range = '1y';
    else if (diffDays > 5) range = '1mo';

    return await fetchStockHistory(symbol, range);
};

// Remove a holding's impact from historical snapshots ("Undo" history)
export const removePortfolioHistoryImpact = async (holding: PortfolioHolding) => {
    try {
        console.log(`Removing historical impact for ${holding.symbol}`);
        const { fetchExchangeRates } = require('./currency');
        const rates = await fetchExchangeRates();
        const database = await initDb();

        const transactions = await getTransactions(holding.symbol);
        if (transactions.length === 0) return;

        // Fetch price history
        const history = await fetchStockHistoryForTransactions(holding.symbol, transactions);
        const priceHistoryMap: Record<string, number> = {};
        history.forEach(point => {
            const dateStr = new Date(point.timestamp).toISOString().split('T')[0];
            priceHistoryMap[dateStr] = point.price;
        });

        // Calculate Trace
        const trace = await calculateStockHistoryTrace(holding.symbol, transactions, priceHistoryMap, rates);

        // Update DB
        const snapshots = await getPortfolioHistory();
        for (const snap of snapshots) {
            const dateStr = new Date(snap.timestamp).toISOString().split('T')[0];
            const traceData = trace[dateStr];

            // Complete Deletion logic: Remove the ENTIRE value contribution of this holding.
            // This treats the deletion as if the holding never existed in the chart.
            const valueContribution = traceData ? traceData.value : 0;
            const profitContribution = traceData ? traceData.profit : 0;

            if (valueContribution !== 0 || profitContribution !== 0) {
                // Remove the value and profit contribution completely
                const newValue = Math.max(0, snap.totalValue - valueContribution);
                const newProfit = snap.totalProfit - profitContribution;

                if (snap.id !== undefined) {
                    await database.runAsync(
                        'UPDATE portfolio_history SET totalValue = ?, totalProfit = ? WHERE id = ?;',
                        [newValue, newProfit, snap.id]
                    );
                }
            }
        }
        console.log("Historical impact removed.");
    } catch (err) {
        console.error("Error removing portfolio history impact:", err);
    }
};

export const deleteTransaction = async (id: number) => {
    const database = await initDb();
    const existing = await database.getFirstAsync<Transaction>('SELECT * FROM transactions WHERE id = ?;', [id]);
    if (!existing) throw new Error("Transaction not found");

    try {
        console.log(`Deleting transaction ${id}, updating history...`);
        const { fetchExchangeRates } = require('./currency');
        const rates = await fetchExchangeRates();

        const allTransactions = await getTransactions(existing.symbol);

        // 1. Fetch Price History
        const history = await fetchStockHistoryForTransactions(existing.symbol, allTransactions);
        const priceHistoryMap: Record<string, number> = {};
        history.forEach(point => {
            const dateStr = new Date(point.timestamp).toISOString().split('T')[0];
            priceHistoryMap[dateStr] = point.price;
        });

        // 2. Calculate Trace BEFORE deletion
        const traceBefore = await calculateStockHistoryTrace(existing.symbol, allTransactions, priceHistoryMap, rates);

        // 3. Calculate Trace AFTER deletion
        const transactionsAfter = allTransactions.filter(t => t.id !== id);
        const traceAfter = await calculateStockHistoryTrace(existing.symbol, transactionsAfter, priceHistoryMap, rates);

        // 4. Update Portfolio History with Diff
        const snapshots = await getPortfolioHistory();
        for (const snap of snapshots) {
            const dateStr = new Date(snap.timestamp).toISOString().split('T')[0];

            const before = traceBefore[dateStr] || { value: 0, profit: 0 };
            const after = traceAfter[dateStr] || { value: 0, profit: 0 };

            // Diff in Profit logic? 
            // If I delete a transaction:
            // "Value" should change by [AfterValue - BeforeValue].
            // "Profit" should change by [AfterProfit - BeforeProfit].
            // Wait.
            // For Delete Transaction:
            // If I delete a BUY ($100).
            // Before: Value $100. Profit $0.
            // After: Value $0. Profit $0.
            // Diff Value: -$100. Diff Profit: 0.
            // Global Value: $1000 -> $900. 
            // NOTE: Global Value includes CASH usually?
            // If we delete a BUY, we get CASH back.
            // So Total Value should ideally stay same ($100 Stock -> $100 Cash).
            // UNLESS stock moved.
            // If Stock moved to $110. Profit +$10.
            // Before: Value $110. Profit $10.
            // After: Value $0. Profit $0.
            // Diff Value: -$110. Diff Profit: -$10.
            // If we apply this to Global History:
            // Global Value -= 110.
            // But we should have $100 Cash.
            // So Global Value should only drop by $10 (Profit).
            // SO: We should ONLY update Global Value by the PROFIT diff.
            // Same as "delete stock" logic.
            // Because our model assumes "Portfolio Value = Cash + Stocks".
            // If we "undo" a stock transaction, we assume consistent Cash baseline principal.
            // So deleting a Buy means "I had Cash instead".
            // So we only remove the Profit/Loss component.

            const diffProfit = after.profit - before.profit;

            if (diffProfit !== 0) {
                const newValue = Math.max(0, snap.totalValue + diffProfit);
                const newProfit = snap.totalProfit + diffProfit;

                if (snap.id !== undefined) {
                    await database.runAsync(
                        'UPDATE portfolio_history SET totalValue = ?, totalProfit = ? WHERE id = ?;',
                        [newValue, newProfit, snap.id]
                    );
                }
            }
        }
        console.log("History corrected for transaction deletion.");

    } catch (e) {
        console.error("Error updating history for deleteTransaction:", e);
    }

    await database.runAsync('DELETE FROM transactions WHERE id = ?;', [id]);
    return await recalculatePortfolio(existing.symbol);
};

export const removeHolding = async (symbol: string) => {
    const database = await initDb();

    // Get the holding first to clean up its history
    const holding = await getHolding(symbol);
    if (holding) {
        await removePortfolioHistoryImpact(holding);
    }

    // Delete the holding
    await database.runAsync(
        'DELETE FROM portfolio WHERE symbol = ?;',
        [symbol.toUpperCase()]
    );

    // Delete all associated transactions
    await database.runAsync(
        'DELETE FROM transactions WHERE symbol = ?;',
        [symbol.toUpperCase()]
    );
};

export const getPortfolio = async (): Promise<PortfolioHolding[]> => {
    const database = await initDb();
    const allRows = await database.getAllAsync<PortfolioHolding>('SELECT * FROM portfolio;');
    return allRows;
};

export const updateShares = async (symbol: string, shares: number) => {
    const database = await initDb();
    const result = await database.runAsync(
        'UPDATE portfolio SET shares = ? WHERE symbol = ?;',
        [shares, symbol.toUpperCase()]
    );
    return result;
};


export const updatePrice = async (symbol: string, price: number) => {
    const database = await initDb();
    const result = await database.runAsync(
        'UPDATE portfolio SET price = ? WHERE symbol = ?;',
        [price, symbol.toUpperCase()]
    );
    return result;
};

/**
 * Centrally refreshes all portfolio prices and records a daily snapshot.
 */
export const refreshPortfolioPrices = async (): Promise<PortfolioHolding[]> => {
    const holdings = await getPortfolio();
    const updatedHoldings: PortfolioHolding[] = [];

    for (const holding of holdings) {
        try {
            const quote = await fetchStockPrice(holding.symbol);
            if (quote.price > 0) {
                await updatePrice(holding.symbol, quote.price);
                updatedHoldings.push({
                    ...holding,
                    price: quote.price,
                    priceChange: quote.change,
                    pricePercent: quote.percent
                });
            } else {
                updatedHoldings.push(holding);
            }
        } catch (err) {
            console.error(`Failed to refresh price for ${holding.symbol}:`, err);
            updatedHoldings.push(holding);
        }
    }

    // We must convert each holding to USD for consistent snapshot tracking
    const { fetchExchangeRates, convertCurrency } = require('./currency');
    const rates = await fetchExchangeRates();

    let totalValueUsd = 0;
    let totalProfitUsd = 0;

    for (const h of updatedHoldings) {
        const nativeValue = h.shares * (h.price || 0);
        const nativeCost = h.shares * (h.costBasis || h.price || 0);
        const nativeRealized = h.realizedProfit || 0;
        const nativeProfit = (nativeValue - nativeCost) + nativeRealized;

        totalValueUsd += convertCurrency(nativeValue, h.currency || 'USD', 'USD', rates);
        totalProfitUsd += convertCurrency(nativeProfit, h.currency || 'USD', 'USD', rates);
    }

    await addPortfolioSnapshot(totalValueUsd, totalProfitUsd);

    return updatedHoldings;
};

export const getSettings = async (): Promise<Record<string, string>> => {
    const database = await initDb();
    const rows = await database.getAllAsync<{ key: string, value: string }>('SELECT * FROM settings;');
    const settings: Record<string, string> = {};
    rows.forEach(row => {
        settings[row.key] = row.value;
    });
    return settings;
};

export const updateSetting = async (key: string, value: string) => {
    const database = await initDb();
    return await database.runAsync(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);',
        [key, value]
    );
};

export const clearAllData = async () => {
    const database = await initDb();
    await database.runAsync('DELETE FROM portfolio;');
    await database.runAsync('DELETE FROM portfolio_history;');
    await database.runAsync('DELETE FROM transactions;');
    // Reset settings to defaults
    await database.runAsync('DELETE FROM settings;');
    await database.execAsync(`
        INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'system');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('currency', 'USD');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('db_schema_version', '2');
    `);
};
