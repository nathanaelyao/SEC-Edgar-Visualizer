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

export const addHolding = async (holding: PortfolioHolding) => {
    const database = await initDb();
    const existing = await getHolding(holding.symbol);

    if (existing) {
        let newCostBasis = existing.costBasis || existing.price || 0;
        const purchasePrice = holding.price || 0;

        if (holding.shares > 0) {
            // Weighted average for buys
            const totalOldValue = existing.shares * newCostBasis;
            const totalNewValue = holding.shares * purchasePrice;
            newCostBasis = (totalOldValue + totalNewValue) / (existing.shares + holding.shares);
        }

        const newShares = existing.shares + holding.shares;
        const currentRealized = existing.realizedProfit || 0;
        let newRealized = currentRealized;

        if (holding.shares < 0) {
            // Realized profit on sale: (Sale Price - Cost Basis) * Number of Shares Sold
            const soldCount = Math.abs(holding.shares);
            const profitOnThisSale = (purchasePrice - newCostBasis) * soldCount;
            newRealized += profitOnThisSale;
        }

        if (newShares <= 0) {
            // Keep the row if there's realized profit, just set shares to 0
            // OR delete it? If we delete it, we lose the realized profit tracking for that ticker.
            // Let's UPDATE it to 0 shares so we keep tracking realized profit.
            return await database.runAsync(
                'UPDATE portfolio SET shares = 0, price = ?, realizedProfit = ?, lastTransactionDate = ? WHERE symbol = ?;',
                [purchasePrice, newRealized, holding.lastTransactionDate || new Date().toISOString(), holding.symbol.toUpperCase()]
            );
        }

        const updateResult = await database.runAsync(
            'UPDATE portfolio SET shares = ?, price = ?, costBasis = ?, realizedProfit = ?, lastTransactionDate = ?, currency = ? WHERE symbol = ?;',
            [newShares, purchasePrice, newCostBasis, newRealized, holding.lastTransactionDate || new Date().toISOString(), holding.currency || 'USD', holding.symbol.toUpperCase()]
        );

        // Snapshot if past date
        if (holding.lastTransactionDate) {
            const txDate = new Date(holding.lastTransactionDate);
            if (txDate.getTime() < new Date().getTime() - (1000 * 60 * 60 * 2)) {
                const { fetchExchangeRates, convertCurrency } = require('./currency');
                const rates = await fetchExchangeRates();
                const allHoldings = await getPortfolio();

                let totalValueUsd = 0;
                let totalProfitUsd = 0;

                for (const h of allHoldings) {
                    const h_is_curr = h.symbol.toUpperCase() === holding.symbol.toUpperCase();
                    const h_shares = h_is_curr ? newShares : h.shares;
                    // Note: price might be stale in allHoldings, so we use purchasePrice for current
                    const h_price = h_is_curr ? purchasePrice : (h.price || 0);
                    const h_cost = h_is_curr ? newCostBasis : (h.costBasis || h.price || 0);
                    const h_realized = h_is_curr ? newRealized : (h.realizedProfit || 0);

                    const nativeValue = h_shares * h_price;
                    const nativeProfit = (nativeValue - (h_shares * h_cost)) + h_realized;

                    totalValueUsd += convertCurrency(nativeValue, h.currency || 'USD', 'USD', rates);
                    totalProfitUsd += convertCurrency(nativeProfit, h.currency || 'USD', 'USD', rates);
                }

                await addPortfolioSnapshot(totalValueUsd, totalProfitUsd, holding.lastTransactionDate);

                // Backfill history from transaction date to now
                await backfillPortfolioHistory(new Date(holding.lastTransactionDate));
            }
        }

        return updateResult;
    }

    const result = await database.runAsync(
        'INSERT INTO portfolio (symbol, companyName, shares, price, costBasis, realizedProfit, lastTransactionDate, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
        [holding.symbol.toUpperCase(), holding.companyName, holding.shares, holding.price || 0, holding.price || 0, 0, holding.lastTransactionDate || new Date().toISOString(), holding.currency || 'USD']
    );

    // Snapshot if past date
    if (holding.lastTransactionDate) {
        const txDate = new Date(holding.lastTransactionDate);
        if (txDate.getTime() < new Date().getTime() - (1000 * 60 * 60 * 2)) {
            const { fetchExchangeRates, convertCurrency } = require('./currency');
            const rates = await fetchExchangeRates();
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

            // Backfill history from transaction date to now
            await backfillPortfolioHistory(txDate);
        }
    }

    return result;
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
