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

export const deleteTransaction = async (id: number) => {
    const database = await initDb();
    const existing = await database.getFirstAsync<Transaction>('SELECT * FROM transactions WHERE id = ?;', [id]);
    if (!existing) throw new Error("Transaction not found");

    await database.runAsync('DELETE FROM transactions WHERE id = ?;', [id]);
    return await recalculatePortfolio(existing.symbol);
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
export const backfillPortfolioHistory = async (startDate: Date) => {
    try {
        const { fetchExchangeRates, convertCurrency } = require('./currency');
        const rates = await fetchExchangeRates();
        const allHoldings = await getPortfolio();

        // Determine date range for fetch
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - startDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        let range = '1mo';
        if (diffDays > 1825) range = 'max';
        else if (diffDays > 365) range = '5y';
        else if (diffDays > 30) range = '1y';
        else if (diffDays > 5) range = '1mo'; // Minimum useful range

        console.log(`Backfilling portfolio history from ${startDate.toISOString()} (Range: ${range})`);

        // Fetch history for all holdings map[symbol] -> validMap[dateString] -> price
        const priceHistoryMap: Record<string, Record<string, number>> = {};

        for (const h of allHoldings) {
            const history = await fetchStockHistory(h.symbol, range);
            priceHistoryMap[h.symbol] = {};
            history.forEach(point => {
                const dateStr = new Date(point.timestamp).toISOString().split('T')[0];
                priceHistoryMap[h.symbol][dateStr] = point.price;
            });
        }

        // Iterate through each day from start date to now
        const dayIterator = new Date(startDate);
        while (dayIterator <= now) {
            const dateStr = dayIterator.toISOString().split('T')[0];

            let dailyTotalValueUsd = 0;
            let dailyTotalProfitUsd = 0;
            let hasDataForAny = false;

            for (const h of allHoldings) {
                // Find price for this day, or closest previous? 
                // Creating a simplified lookup: exact match only for now.
                // Improve: Finding closest previous price if market closed?
                // For now, if no price exists (weekend), we might skip creating a snapshot 
                // OR use the last known price. Let's use exact match for simplicity first.
                // If it's a weekend, Yahoo usually doesn't return data, so we just skip weekends.

                const price = priceHistoryMap[h.symbol]?.[dateStr];

                if (price !== undefined) {
                    hasDataForAny = true;
                    // Note: We use CURRENT shares/costBasis. This is a limitation (no transaction ledger).
                    const nativeValue = h.shares * price;
                    const nativeCost = h.shares * (h.costBasis || 0);
                    const nativeProfit = (nativeValue - nativeCost) + (h.realizedProfit || 0);

                    dailyTotalValueUsd += convertCurrency(nativeValue, h.currency || 'USD', 'USD', rates);
                    dailyTotalProfitUsd += convertCurrency(nativeProfit, h.currency || 'USD', 'USD', rates);
                }
            }

            if (hasDataForAny) {
                // Format timestamp to end of day to match typical closing time or just keep T00:00:00
                // addPortfolioSnapshot handles the ID check by date prefix
                await addPortfolioSnapshot(dailyTotalValueUsd, dailyTotalProfitUsd, dayIterator.toISOString());
            }

            dayIterator.setDate(dayIterator.getDate() + 1);
        }

        console.log("Backfill complete");

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

// Remove a holding's impact from historical snapshots ("Undo" history)
export const removePortfolioHistoryImpact = async (holding: PortfolioHolding) => {
    try {
        console.log(`Removing historical impact for ${holding.symbol}`);
        const { fetchExchangeRates, convertCurrency } = require('./currency');
        const rates = await fetchExchangeRates();
        const database = await initDb();

        // We need to know the price history to subtract the correct value for each day
        // Similar strategy to backfill, but subtracting
        const now = new Date();
        const startDate = new Date(holding.lastTransactionDate || new Date().toISOString());

        const diffTime = Math.abs(now.getTime() - startDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        let range = '1mo';
        if (diffDays > 1825) range = 'max';
        else if (diffDays > 365) range = '5y';
        else if (diffDays > 30) range = '1y';
        else if (diffDays > 5) range = '1mo';

        const history = await fetchStockHistory(holding.symbol, range);
        const priceHistoryMap: Record<string, number> = {};
        history.forEach(point => {
            const dateStr = new Date(point.timestamp).toISOString().split('T')[0];
            priceHistoryMap[dateStr] = point.price;
        });

        // Iterate through all snapshots in DB to update them
        // This is safer than iterating dates because we only want to touch existing snapshots
        const snapshots = await getPortfolioHistory();

        for (const snap of snapshots) {
            const snapDate = new Date(snap.timestamp);
            const dateStr = snapDate.toISOString().split('T')[0];

            // Only affect snapshots after the holding started
            if (snapDate >= startDate) {
                const price = priceHistoryMap[dateStr];

                if (price !== undefined) {
                    // Calculate what this holding contributed at that time
                    // NOTE: Assumes constant shares. If shares changed over time, this is an approximation.
                    // But for "undoing" a simple "add -> delete" workflow, it's accurate.
                    const nativeValue = holding.shares * price;
                    const nativeCost = holding.shares * (holding.costBasis || 0);
                    // Realized profit is static, so we always remove it if it existed? 
                    // Or only if it was realized before this snapshot? 
                    // Simplified: We assume realized profit is part of the "total profit" metric we execute
                    const nativeProfit = (nativeValue - nativeCost) + (holding.realizedProfit || 0);

                    const valueToRemove = convertCurrency(nativeValue, holding.currency || 'USD', 'USD', rates);
                    const profitToRemove = convertCurrency(nativeProfit, holding.currency || 'USD', 'USD', rates);

                    const newValue = Math.max(0, snap.totalValue - valueToRemove);
                    // Profit can be negative, so standard subtraction
                    const newProfit = snap.totalProfit - profitToRemove;

                    if (snap.id !== undefined) {
                        await database.runAsync(
                            'UPDATE portfolio_history SET totalValue = ?, totalProfit = ? WHERE id = ?;',
                            [newValue, newProfit, snap.id]
                        );
                    }
                }
            }
        }
        console.log("Historical impact removed.");

    } catch (err) {
        console.error("Error removing portfolio history impact:", err);
    }
};

export const removeHolding = async (symbol: string) => {
    const database = await initDb();

    // Get the holding first to clean up its history
    const holding = await getHolding(symbol);
    if (holding) {
        await removePortfolioHistoryImpact(holding);
    }

    const result = await database.runAsync(
        'DELETE FROM portfolio WHERE symbol = ?;',
        [symbol.toUpperCase()]
    );
    return result;
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
