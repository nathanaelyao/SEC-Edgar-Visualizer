import * as SQLite from 'expo-sqlite';

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
    costBasis?: number; // Average purchase price
    realizedProfit?: number; // Total profit/loss realized from sales
}

export interface PortfolioSnapshot {
    id?: number;
    timestamp: string;
    totalValue: number;
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
            realizedProfit REAL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS portfolio_history (
            id INTEGER PRIMARY KEY NOT NULL,
            timestamp TEXT NOT NULL,
            totalValue REAL NOT NULL
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
                'UPDATE portfolio SET shares = 0, price = ?, realizedProfit = ? WHERE symbol = ?;',
                [purchasePrice, newRealized, holding.symbol.toUpperCase()]
            );
        }

        return await database.runAsync(
            'UPDATE portfolio SET shares = ?, price = ?, costBasis = ?, realizedProfit = ? WHERE symbol = ?;',
            [newShares, purchasePrice, newCostBasis, newRealized, holding.symbol.toUpperCase()]
        );
    }

    const result = await database.runAsync(
        'INSERT INTO portfolio (symbol, companyName, shares, price, costBasis, realizedProfit) VALUES (?, ?, ?, ?, ?, ?);',
        [holding.symbol.toUpperCase(), holding.companyName, holding.shares, holding.price || 0, holding.price || 0, 0]
    );
    return result;
};

export const addPortfolioSnapshot = async (totalValue: number) => {
    const database = await initDb();
    const timestamp = new Date().toISOString();

    // Check if we already have a snapshot for today to avoid flooding
    const today = timestamp.split('T')[0];
    const existing = await database.getFirstAsync<{ id: number }>(
        'SELECT id FROM portfolio_history WHERE timestamp LIKE ? LIMIT 1;',
        [`${today}%`]
    );

    if (existing) {
        // Update today's snapshot instead of adding new one
        return await database.runAsync(
            'UPDATE portfolio_history SET totalValue = ?, timestamp = ? WHERE id = ?;',
            [totalValue, timestamp, existing.id]
        );
    }

    return await database.runAsync(
        'INSERT INTO portfolio_history (timestamp, totalValue) VALUES (?, ?);',
        [timestamp, totalValue]
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
