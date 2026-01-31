import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme as useDeviceColorScheme } from 'react-native';
import { getSettings, updateSetting } from '@/utils/db';
import { CurrencyCode, fetchExchangeRates } from '@/utils/currency';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextType {
    theme: ThemeMode;
    setTheme: (theme: ThemeMode) => void;
    currency: CurrencyCode;
    setCurrency: (currency: CurrencyCode) => void;
    exchangeRates: Record<string, number>;
    isDark: boolean;
    loading: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const deviceColorScheme = useDeviceColorScheme();
    const [theme, setThemeState] = useState<ThemeMode>('system');
    const [currency, setCurrencyState] = useState<CurrencyCode>('USD');
    const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({ USD: 1 });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const settings = await getSettings();
                if (settings.theme) setThemeState(settings.theme as ThemeMode);
                if (settings.currency) setCurrencyState(settings.currency as CurrencyCode);

                const rates = await fetchExchangeRates();
                setExchangeRates(rates);
            } catch (err) {
                console.error('Error loading theme settings:', err);
            } finally {
                setLoading(false);
            }
        };
        loadSettings();
    }, []);

    const setTheme = async (newTheme: ThemeMode) => {
        setThemeState(newTheme);
        await updateSetting('theme', newTheme);
    };

    const setCurrency = async (newCurrency: CurrencyCode) => {
        setCurrencyState(newCurrency);
        await updateSetting('currency', newCurrency);
        // Optionally re-fetch rates if needed, though currency utility handles caching
    };

    const isDark = theme === 'system' ? deviceColorScheme === 'dark' : theme === 'dark';

    return (
        <ThemeContext.Provider value={{ theme, setTheme, currency, setCurrency, exchangeRates, isDark, loading }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (!context) throw new Error('useTheme must be used within a ThemeProvider');
    return context;
};
