import * as SQLite from 'expo-sqlite';
import { fetchStockPrice } from './secApi';

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
        }
    }

    return result;
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

export const removeHolding = async (symbol: string) => {
    const database = await initDb();
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
