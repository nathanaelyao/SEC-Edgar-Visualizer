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
    price?: number; // Last known price
    priceChange?: number; // Daily dollar change
    pricePercent?: number; // Daily percentage change
    costBasis?: number; // Average purchase price
    realizedProfit?: number; // Total profit/loss realized from sales
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
            realizedProfit REAL DEFAULT 0,
            lastTransactionDate TEXT
        );

        CREATE TABLE IF NOT EXISTS portfolio_history (
            id INTEGER PRIMARY KEY NOT NULL,
            timestamp TEXT NOT NULL,
            totalValue REAL NOT NULL,
            totalProfit REAL DEFAULT 0
        );
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
            'UPDATE portfolio SET shares = ?, price = ?, costBasis = ?, realizedProfit = ?, lastTransactionDate = ? WHERE symbol = ?;',
            [newShares, purchasePrice, newCostBasis, newRealized, holding.lastTransactionDate || new Date().toISOString(), holding.symbol.toUpperCase()]
        );

        // Snapshot if past date
        if (holding.lastTransactionDate) {
            const txDate = new Date(holding.lastTransactionDate);
            if (txDate.getTime() < new Date().getTime() - (1000 * 60 * 60 * 2)) {
                await addPortfolioSnapshot(Math.max(0, newShares) * purchasePrice, 0, holding.lastTransactionDate);
            }
        }

        return updateResult;
    }

    const result = await database.runAsync(
        'INSERT INTO portfolio (symbol, companyName, shares, price, costBasis, realizedProfit, lastTransactionDate) VALUES (?, ?, ?, ?, ?, ?, ?);',
        [holding.symbol.toUpperCase(), holding.companyName, holding.shares, holding.price || 0, holding.price || 0, 0, holding.lastTransactionDate || new Date().toISOString()]
    );

    // Snapshot if past date
    if (holding.lastTransactionDate) {
        const txDate = new Date(holding.lastTransactionDate);
        if (txDate.getTime() < new Date().getTime() - (1000 * 60 * 60 * 2)) {
            // Fetch all holdings to get current total profit for snapshot
            const allHoldings = await getPortfolio();
            const totalValue = allHoldings.reduce((acc, curr) => acc + (curr.shares * (curr.price || 0)), 0);
            const totalCostBasis = allHoldings.reduce((acc, curr) => acc + (curr.shares * (curr.costBasis || curr.price || 0)), 0);
            const unrealizedProfit = totalValue - totalCostBasis;
            const realizedProfit = allHoldings.reduce((acc, curr) => acc + (curr.realizedProfit || 0), 0);
            const totalProfit = unrealizedProfit + realizedProfit;

            await addPortfolioSnapshot(totalValue, totalProfit, holding.lastTransactionDate);
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

    const totalValue = updatedHoldings.reduce((acc, curr) => acc + (curr.shares * (curr.price || 0)), 0);
    const totalCostBasis = updatedHoldings.reduce((acc, curr) => acc + (curr.shares * (curr.costBasis || curr.price || 0)), 0);
    const totalProfit = (totalValue - totalCostBasis) + updatedHoldings.reduce((acc, curr) => acc + (curr.realizedProfit || 0), 0);

    await addPortfolioSnapshot(totalValue, totalProfit);

    return updatedHoldings;
};
