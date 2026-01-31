import { error as logError } from './logger';

const BASE_URL = 'https://api.frankfurter.app/latest?from=USD';

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD' | 'CNY';

export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    CAD: 'C$',
    AUD: 'A$',
    CNY: '¥',
};

let exchangeRates: Record<string, number> = {
    USD: 1,
};

let lastFetchTime = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

export const fetchExchangeRates = async (): Promise<Record<string, number>> => {
    const now = Date.now();
    if (now - lastFetchTime < CACHE_DURATION) {
        return exchangeRates;
    }

    try {
        const response = await fetch(BASE_URL);
        if (!response.ok) throw new Error(`Failed to fetch exchange rates: ${response.status}`);
        const data = await response.json();
        exchangeRates = {
            USD: 1,
            ...data.rates,
        };
        lastFetchTime = now;
        return exchangeRates;
    } catch (err) {
        logError('Error fetching exchange rates:', err);
        return exchangeRates; // Return cached/default rates if fetch fails
    }
};

export const convertCurrency = (value: number, to: CurrencyCode, rates: Record<string, number>): number => {
    const rate = rates[to] || 1;
    return value * rate;
};

export const formatCurrency = (value: number, currency: CurrencyCode): string => {
    const symbol = CURRENCY_SYMBOLS[currency] || '$';
    return `${symbol}${value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
};

export const formatCurrencyCompact = (value: number, currency: CurrencyCode): string => {
    const symbol = CURRENCY_SYMBOLS[currency] || '$';
    let absValue = Math.abs(value);
    let suffix = '';
    let formattedValue = absValue;

    if (absValue >= 1000000000) {
        formattedValue = absValue / 1000000000;
        suffix = 'B';
    } else if (absValue >= 1000000) {
        formattedValue = absValue / 1000000;
        suffix = 'M';
    } else if (absValue >= 1000) {
        formattedValue = absValue / 1000;
        suffix = 'k';
    }

    return `${value < 0 ? '-' : ''}${symbol}${formattedValue.toLocaleString(undefined, {
        maximumFractionDigits: 1,
    })}${suffix}`;
};
