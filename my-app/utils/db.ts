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
    returnPercent?: number;
}

export interface Transaction {
    id?: number;
    symbol: string;
    type: 'buy' | 'sell' | 'deposit' | 'withdraw';
    shares: number;
    price: number;
    date: string;
    currency?: string;
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

        if (currentVersion < 3) {
            console.log("Migrating DB to version 3 (Transaction currency)");
            const tableInfo = await db.getAllAsync<{ name: string }>('PRAGMA table_info(transactions);');
            const hasCurrency = tableInfo.some(col => col.name === 'currency');
            if (!hasCurrency) {
                await db.execAsync("ALTER TABLE transactions ADD COLUMN currency TEXT DEFAULT 'USD';");
            }
            await db.execAsync("DELETE FROM portfolio WHERE symbol = 'USD';");
            await db.execAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('db_schema_version', '3');");
        }

        if (currentVersion < 4) {
            console.log("Migrating DB to version 4 (Portfolio price change fields)");
            const tableInfo = await db.getAllAsync<{ name: string }>('PRAGMA table_info(portfolio);');
            const hasChange = tableInfo.some(col => col.name === 'priceChange');
            if (!hasChange) {
                await db.execAsync("ALTER TABLE portfolio ADD COLUMN priceChange REAL;");
            }
            const hasPercent = tableInfo.some(col => col.name === 'pricePercent');
            if (!hasPercent) {
                await db.execAsync("ALTER TABLE portfolio ADD COLUMN pricePercent REAL;");
            }
            await db.execAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('db_schema_version', '4');");
        }

        if (currentVersion < 5) {
            console.log("Migrating DB to version 5 (Triggering Ground Truth Rebuild)");
            await db.execAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('needs_history_rebuild', '1');");
            await db.execAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('db_schema_version', '5');");
        }

        if (currentVersion < 6) {
            console.log("Migrating DB to version 6 (Triggering Ground Truth Rebuild for Smart Cash)");
            await db.execAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('needs_history_rebuild', '1');");
            await db.execAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('db_schema_version', '6');");
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

export const checkAndRunMaintenance = async () => {
    const database = await initDb();
    const row = await database.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'needs_history_rebuild';");

    if (row && row.value === '1') {
        console.log("Maintenance: Needs history rebuild detected. Running backfill...");
        await backfillPortfolioHistory();
        await database.execAsync("UPDATE settings SET value = '0' WHERE key = 'needs_history_rebuild';");
        console.log("Maintenance: Rebuild complete, flag cleared.");
    }
};

const calculateCurrentPortfolioUSD = async (rates: any) => {
    const { convertCurrency } = require('./currency');
    const holdings = await getPortfolio();
    const balances = await getCashBalances();

    let totalValueUsd = 0;
    let totalProfitUsd = 0;

    for (const h of holdings) {
        if (h.symbol === 'USD') continue; // Exclude system cash symbol
        const v = h.shares * (h.price || 0);
        const c = h.shares * (h.costBasis || h.price || 0);
        totalValueUsd += convertCurrency(v, h.currency || 'USD', 'USD', rates);
        totalProfitUsd += convertCurrency((v - c) + (h.realizedProfit || 0), h.currency || 'USD', 'USD', rates);
    }
    for (const [cur, amt] of Object.entries(balances)) {
        totalValueUsd += convertCurrency(amt, cur, 'USD', rates);
    }
    return { totalValueUsd, totalProfitUsd };
};

export const triggerPortfolioSnapshot = async (customTimestamp?: string) => {
    try {
        const { fetchExchangeRates } = require('./currency');
        const rates = await fetchExchangeRates();
        const { totalValueUsd, totalProfitUsd } = await calculateCurrentPortfolioUSD(rates);
        await addPortfolioSnapshot(totalValueUsd, totalProfitUsd, customTimestamp);
    } catch (e) {
        console.error("Failed to trigger snapshot:", e);
    }
};

export const addTransaction = async (transaction: Transaction) => {
    const database = await initDb();
    await database.runAsync(
        'INSERT INTO transactions (symbol, type, shares, price, date, currency) VALUES (?, ?, ?, ?, ?, ?);',
        [transaction.symbol.toUpperCase(), transaction.type, transaction.shares, transaction.price, transaction.date, transaction.currency || 'USD']
    );
    // Only recalculate portfolio holding if it's a trade (buy/sell)
    if (transaction.type === 'buy' || transaction.type === 'sell') {
        return await recalculatePortfolio(transaction.symbol);
    }
};

// Helper for currency conversion within DB context if needed, but we usually import from utils/currency
// Since getCashBalance is exported, we should probably let the caller handle conversion 
// OR pass in the tools. To keep db.ts clean of business logic like exchange rates, 
// let's return a list of balances by currency.
// 1. UI Display Cash: Only affected by Deposit/Withdraw
export const getCashBalances = async (): Promise<Record<string, number>> => {
    const database = await initDb();
    const transactions = await database.getAllAsync<Transaction>('SELECT * FROM transactions WHERE type IN (\'deposit\', \'withdraw\');');

    const balances: Record<string, number> = {};

    for (const tx of transactions) {
        const cur = tx.currency || 'USD';
        // Amount is just price for deposit/withdraw
        const amount = tx.price;

        if (!balances[cur]) balances[cur] = 0;

        if (tx.type === 'deposit') {
            balances[cur] += amount;
        } else if (tx.type === 'withdraw') {
            balances[cur] -= amount;
        }
    }
    return balances;
};

// 2. Chart Calculation Cash: Affected by ALL trades to track "Net Liquidity" or "Performance Value"
// This ensures that selling a stock moves value from "Stock" to "Cash" in the chart, preserving the gain.
export const getChartCashBalances = async (): Promise<Record<string, number>> => {
    const database = await initDb();
    // Fetch ALL transactions inclusive of buy/sell to track cash flow (Simulated Cash Wallet)
    const transactions = await database.getAllAsync<Transaction>('SELECT * FROM transactions ORDER BY date ASC, createdAt ASC;');

    const balances: Record<string, number> = {};

    for (const tx of transactions) {
        const cur = tx.currency || 'USD';
        // Calculate amount for the transaction (Total Value)
        const amount = (tx.type === 'buy' || tx.type === 'sell') ? (tx.shares * tx.price) : tx.price;

        if (!balances[cur]) balances[cur] = 0;

        if (tx.type === 'deposit') {
            balances[cur] += amount;
        } else if (tx.type === 'withdraw') {
            balances[cur] -= amount;
        } else if (tx.type === 'sell') {
            balances[cur] += amount; // Proceeds from sell increase cash
        } else if (tx.type === 'buy') {
            // Implicit Deposit Logic: If user buys more than they have cash for, we assume they added cash just-in-time.
            // We floor at 0 so cash doesn't go negative for "Holding-only" trackers.
            balances[cur] = Math.max(0, balances[cur] - amount);
        }
    }
    return balances;
};

// Legacy support for single number (USD-equivalent or whatever it was assuming)
export const getCashBalance = async (): Promise<number> => {
    const balances = await getCashBalances();
    // For now, return USD balance if exists, else return 0 or sum?
    // Actually, callers of this expect a single number.
    // Let's assume they want the USD equivalent but without the tools here we can't be perfect.
    // If we only have USD transactions, it's correct.
    return balances['USD'] || 0;
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
    if (transaction.currency) { updates.push('currency = ?'); values.push(transaction.currency); }

    if (updates.length > 0) {
        values.push(id);
        await database.runAsync(
            `UPDATE transactions SET ${updates.join(', ')} WHERE id = ?;`,
            values
        );
        if (existing.symbol !== 'USD') {
            await recalculatePortfolio(existing.symbol);
        }
        // Trigger a snapshot for the date of the original transaction and the updated transaction
        const dateToSnapshot = new Date(Math.min(new Date(existing.date).getTime(), new Date(transaction.date || existing.date).getTime()));
        await triggerPortfolioSnapshot(dateToSnapshot.toISOString());
        return;
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
        date: holding.lastTransactionDate || new Date().toISOString(),
        currency: holding.currency || 'USD'
    });

    // Snapshot logic (preserved from original)
    if (holding.lastTransactionDate) {
        const txDate = new Date(holding.lastTransactionDate);
        if (txDate.getTime() < new Date().getTime() - (1000 * 60 * 60 * 2)) {
            await backfillPortfolioHistory(txDate);
        } else {
            await triggerPortfolioSnapshot(holding.lastTransactionDate);
        }
    }
};

// Reconstruct portfolio history from a specific date to now
// This is expensive as it fetches history for ALL holdings, so use sparingly
export const backfillPortfolioHistory = async (startDate?: Date) => {
    try {
        console.log(`Rewriting portfolio history from ${startDate ? startDate.toISOString() : 'earliest transaction'}`);
        const { fetchExchangeRates } = require('./currency');
        const rates = await fetchExchangeRates();
        const database = await initDb();
        const allHoldings = await getPortfolio();
        const allTransactions = await getAllTransactions();

        if (allTransactions.length === 0) {
            console.log("No transactions found. Clearing entire portfolio history.");
            await database.runAsync('DELETE FROM portfolio_history;');
            return;
        }

        // Determine effective start date if not provided
        let effectiveStartDate = startDate;

        if (!effectiveStartDate) {
            const earliestTimestamp = Math.min(...allTransactions.map(t => new Date(t.date).getTime()));
            effectiveStartDate = new Date(earliestTimestamp);
            console.log(`Full history rebuild triggered. using earliest transaction date: ${effectiveStartDate.toISOString()}`);

            // For a full rebuild, clear the existing history to ensure no artifacts remain
            await database.runAsync('DELETE FROM portfolio_history;');
        } else {
            console.log(`Rewriting portfolio history from ${effectiveStartDate.toISOString()}`);
        }

        // 1. Calculate History Traces for ALL holdings
        const holdingTraces: Record<string, Record<string, { value: number, profit: number }>> = {};
        const allDates = new Set<string>();

        // Collect dates from ALL transactions including cash
        allTransactions.forEach(tx => {
            allDates.add(new Date(tx.date).toISOString().split('T')[0]);
        });

        const holdingPriceHistories: Record<string, Record<string, number>> = {};

        console.log("Fetching price histories for holdings...");
        for (const h of allHoldings) {
            if (h.symbol === 'USD') continue;
            const transactions = await getTransactions(h.symbol);
            if (transactions.length > 0) {
                const history = await fetchStockHistoryForTransactions(h.symbol, transactions);
                const priceMap: Record<string, number> = {};
                history.forEach(point => {
                    const dateStr = new Date(point.timestamp).toISOString().split('T')[0];
                    priceMap[dateStr] = point.price;
                    allDates.add(dateStr);
                });
                holdingPriceHistories[h.symbol] = priceMap;
            }
        }

        const sortedDates = Array.from(allDates).sort();

        console.log("Calculating aligned traces for holdings...");
        for (const h of allHoldings) {
            if (h.symbol === 'USD') continue;
            const transactions = await getTransactions(h.symbol);
            const priceMap = holdingPriceHistories[h.symbol];
            if (transactions.length > 0 && priceMap) {
                const trace = await calculateStockHistoryTrace(h.symbol, transactions, priceMap, rates, sortedDates);
                holdingTraces[h.symbol] = trace;
            }
        }

        // Add Cash Trace
        const cashTrace = await calculateCashHistoryTrace(allTransactions, allDates, rates);

        console.log(`Found ${sortedDates.length} relevant historical dates.`);

        // 2. Aggregate and Upsert Snapshots for each date
        // Note: This replaces the simplistic iteration that assumed constant shares.
        for (const dateStr of sortedDates) {
            // Filter to only dates >= startDate
            if (dateStr < effectiveStartDate.toISOString().split('T')[0]) continue;

            let dailyTotalValueUsd = 0;
            let dailyTotalProfitUsd = 0;
            let hasData = false;

            for (const h of allHoldings) {
                if (h.symbol === 'USD') continue;
                const trace = holdingTraces[h.symbol];
                if (trace && trace[dateStr]) {
                    dailyTotalValueUsd += trace[dateStr].value;
                    dailyTotalProfitUsd += trace[dateStr].profit;
                    hasData = true;
                }
            }

            // Add Cash to daily total
            if (cashTrace[dateStr]) {
                dailyTotalValueUsd += cashTrace[dateStr].value;
                hasData = true;
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
    rates: any,
    sortedDates: string[]
): Promise<Record<string, { value: number, profit: number }>> => {
    const { convertCurrency } = require('./currency');
    const trace: Record<string, { value: number, profit: number }> = {};

    // Sort transactions
    transactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Get range of dates from first transaction to now
    if (transactions.length === 0) return trace;

    // We use the shared master sortedDates to ensure alignment across all stocks
    // let sortedDates = Object.keys(priceHistoryMap).sort(); // Replaced with passed master dates

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
    const currency = holding?.currency || transactions[0]?.currency || 'USD';

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

        // Forward-fill price logic with Persistence
        let price = priceHistoryMap[dateStr] || 0;
        if (price > 0) {
            lastKnownPrice = price;
        } else if (lastKnownPrice > 0) {
            price = lastKnownPrice; // Use persistent last known price
        } else if (currentShares > 0) {
            // If we have shares but no price yet in the stream, 
            // we should look FORWARD to find the first price point if possible,
            // or use averageCost as a last resort to avoid 0 values.
            price = averageCost;
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

const calculateCashHistoryTrace = async (
    transactions: Transaction[],
    allDates: Set<string>,
    rates: any
): Promise<Record<string, { value: number, profit: number }>> => {
    const { convertCurrency } = require('./currency');
    const trace: Record<string, { value: number, profit: number }> = {};
    const sortedDates = Array.from(allDates).sort();

    // Use ALL transactions to simulate cash flow including Buy/Sell
    // We clone the array to sort it, although upstream usually passes sorted or we sort manually here
    const sortedTxs = [...transactions].sort((a, b) => {
        const db = new Date(b.date).getTime();
        const da = new Date(a.date).getTime();
        if (da !== db) return da - db; // Ascending
        return 0;
    });

    let currentBalances: Record<string, number> = {}; // cumulative sum per currency
    let txIndex = 0;

    for (const dateStr of sortedDates) {
        const date = new Date(dateStr);
        date.setHours(23, 59, 59, 999);

        while (txIndex < sortedTxs.length) {
            const tx = sortedTxs[txIndex];
            const txDate = new Date(tx.date);
            if (txDate <= date) {
                const cur = tx.currency || 'USD';
                const amount = (tx.type === 'buy' || tx.type === 'sell') ? (tx.shares * tx.price) : tx.price;

                if (!currentBalances[cur]) currentBalances[cur] = 0;

                if (tx.type === 'deposit') {
                    currentBalances[cur] += amount;
                } else if (tx.type === 'withdraw') {
                    currentBalances[cur] -= amount;
                } else if (tx.type === 'sell') {
                    currentBalances[cur] += amount;
                } else if (tx.type === 'buy') {
                    // Same implicit deposit logic as getCashBalances
                    currentBalances[cur] = Math.max(0, currentBalances[cur] - amount);
                }
                txIndex++;
            } else {
                break;
            }
        }

        let totalValUsd = 0;
        for (const [cur, amt] of Object.entries(currentBalances)) {
            totalValUsd += convertCurrency(amt, cur, 'USD', rates);
        }

        // Cash trace tracks the Available Liquid Cash. 
        // Profit is 0 for cash itself (ignoring FX for now).
        trace[dateStr] = { value: totalValUsd, profit: 0 };
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
        console.log(`Removing historical impact for ${holding.symbol} via Ground Truth Rebuild`);
        // Trigger a full reconstruct from the start to ensure 0-alignment
        await backfillPortfolioHistory();
    } catch (err) {
        console.error("Error removing portfolio history impact:", err);
    }
};

export const deleteTransaction = async (id: number) => {
    const database = await initDb();
    const existing = await database.getFirstAsync<Transaction>('SELECT * FROM transactions WHERE id = ?;', [id]);
    if (!existing) throw new Error("Transaction not found");

    try {
        console.log(`Deleting transaction ${id}, triggering Ground Truth Rebuild...`);
        // 1. Delete the transaction from DB
        await database.runAsync('DELETE FROM transactions WHERE id = ?;', [id]);

        // 2. Recalculate portfolio state for the symbol
        await recalculatePortfolio(existing.symbol);

        // 3. Perform full history rebuild to ensure alignment
        await backfillPortfolioHistory();

        console.log("Transaction deleted and history rebuilt.");
    } catch (err) {
        console.error("Error deleting transaction:", err);
    }
};

export const removeHolding = async (symbol: string) => {
    const database = await initDb();

    console.log(`Removing holding ${symbol} and all tracers...`);

    // 1. Delete all associated transactions FIRST
    // This ensures backfillPortfolioHistory sees a clean state
    await database.runAsync(
        'DELETE FROM transactions WHERE symbol = ?;',
        [symbol.toUpperCase()]
    );

    // 2. Delete the holding
    await database.runAsync(
        'DELETE FROM portfolio WHERE symbol = ?;',
        [symbol.toUpperCase()]
    );

    // 3. Full Rebuild of History (will clear artifacts)
    await backfillPortfolioHistory();
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


export const updatePrice = async (symbol: string, price: number, change?: number, percent?: number) => {
    const database = await initDb();
    const result = await database.runAsync(
        'UPDATE portfolio SET price = ?, priceChange = ?, pricePercent = ? WHERE symbol = ?;',
        [price, change ?? null, percent ?? null, symbol.toUpperCase()]
    );
    return result;
};

/**
 * Centrally refreshes all portfolio prices and records a daily snapshot.
 */
export const refreshPortfolioPrices = async (): Promise<PortfolioHolding[]> => {
    const holdings = await getPortfolio();
    const updatedHoldings: PortfolioHolding[] = [];

    // Check if a full history rebuild is needed (Version 5 Migration)
    const database = await initDb();
    const rebuildFlag = await database.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'needs_history_rebuild';");
    if (rebuildFlag?.value === '1') {
        console.log("Maintenance: Triggering one-time full history rebuild...");
        await database.runAsync("UPDATE settings SET value = '0' WHERE key = 'needs_history_rebuild';");
        // We call this WITHOUT await if we want to not block UI, 
        // but for robustness let's await it during this refresh cycle.
        await backfillPortfolioHistory();
    }

    for (const holding of holdings) {
        try {
            const quote = await fetchStockPrice(holding.symbol);
            if (quote.price > 0) {
                await updatePrice(holding.symbol, quote.price, quote.change, quote.percent);
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
