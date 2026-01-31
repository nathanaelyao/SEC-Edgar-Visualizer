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
    price?: number; // Last known or purchase price
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
            price REAL
        );
    `);

    // Migration: Add price column if it doesn't exist (for existing tables)
    try {
        const tableInfo = await db.getAllAsync<{ name: string }>('PRAGMA table_info(portfolio);');
        const hasPrice = tableInfo.some(col => col.name === 'price');
        if (!hasPrice) {
            await db.execAsync('ALTER TABLE portfolio ADD COLUMN price REAL;');
            console.log('Database migrated: added price column to portfolio table');
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
        const newShares = existing.shares + holding.shares;
        if (newShares <= 0) {
            return await removeHolding(holding.symbol);
        }
        return await database.runAsync(
            'UPDATE portfolio SET shares = ?, price = ? WHERE symbol = ?;',
            [newShares, holding.price || existing.price || 0, holding.symbol.toUpperCase()]
        );
    }

    const result = await database.runAsync(
        'INSERT INTO portfolio (symbol, companyName, shares, price) VALUES (?, ?, ?, ?);',
        [holding.symbol.toUpperCase(), holding.companyName, holding.shares, holding.price || 0]
    );
    return result;
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
