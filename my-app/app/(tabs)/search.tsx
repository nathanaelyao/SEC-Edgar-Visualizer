import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Dimensions, ScrollView, Platform, TouchableWithoutFeedback, Keyboard } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { secFetch, yahooSearch, fetchStockHistory, fetchStockPrice } from '@/utils/secApi';
import { error as logError } from '@/utils/logger';
import { getPortfolio, PortfolioHolding, getPortfolioHistory, PortfolioSnapshot, refreshPortfolioPrices, getCashBalances } from '@/utils/db';
import { useTheme } from '@/context/ThemeContext';
import { formatCurrency, convertCurrency } from '@/utils/currency';
import MarketSummaryCard from '@/components/MarketSummaryCard';

interface MarketItem {
  symbol: string;
  name: string;
  data: number[];
  price: number;
  changePercent: number;
}
interface Company {
  name: string;
  ticker: string;
  cik?: string;
  exchange?: string;
  type?: string;
}

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { isDark, currency, exchangeRates } = useTheme();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [portfolio, setPortfolio] = useState<PortfolioHolding[]>([]);
  const [history, setHistory] = useState<PortfolioSnapshot[]>([]);
  const [cashBalance, setCashBalance] = useState<number>(0);
  const [topMovers, setTopMovers] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<Company[]>([]);

  // Market Summary State
  const [marketSummary, setMarketSummary] = useState<MarketItem[]>([]);
  const [marketLoading, setMarketLoading] = useState(true);

  // Fetch Market Data
  useEffect(() => {
    const fetchMarket = async () => {
      const baseSymbols = [
        { sym: 'ES=F', name: 'S&P 500' },
        { sym: 'NQ=F', name: 'NASDAQ' },
        { sym: 'YM=F', name: 'Dow Jones' },
        { sym: 'XIU.TO', name: 'TSX 60' },
        { sym: 'GC=F', name: 'Gold' },
        { sym: 'CL=F', name: 'Oil' }
      ];

      // Relevant currency pairs based on user selected currency
      const currencyPairs: any[] = [];
      if (currency === 'CAD') {
        currencyPairs.push({ sym: 'USDCAD=X', name: 'USD/CAD' });
        currencyPairs.push({ sym: 'CADUSD=X', name: 'CAD/USD' });
      } else if (currency !== 'USD') {
        currencyPairs.push({ sym: `${currency}USD=X`, name: `${currency}/USD` });
        currencyPairs.push({ sym: `USD${currency}=X`, name: `USD/${currency}` });
      } else {
        // If USD is selected, show major pairs and crypto
        currencyPairs.push({ sym: 'EURUSD=X', name: 'EUR/USD' });
        currencyPairs.push({ sym: 'GBPUSD=X', name: 'GBP/USD' });
        currencyPairs.push({ sym: 'JPYUSD=X', name: 'JPY/USD' });
        currencyPairs.push({ sym: 'BTC-USD', name: 'Bitcoin' });
      }

      const allSymbols = [...baseSymbols, ...currencyPairs];

      try {
        const results = await Promise.all(allSymbols.map(async (item) => {
          try {
            // Using 5d range / 15m interval for better robustness across weekends/off-hours
            const historyData = await fetchStockHistory(item.sym, '5d', '15m');
            const quote = await fetchStockPrice(item.sym);
            const prices = historyData.map(h => h.price);

            // If we have no price but have history, use the last history point
            let finalPrice = quote.price;
            if ((!finalPrice || finalPrice === 0) && prices.length > 0) {
              finalPrice = prices[prices.length - 1];
            }

            return {
              symbol: item.sym,
              name: item.name,
              data: prices,
              price: finalPrice || 0,
              changePercent: quote.percent || 0
            };
          } catch (e) {
            console.error(`Error fetching ${item.sym}`, e);
            return null;
          }
        }));
        setMarketSummary(results.filter(r => r !== null && r.price > 0) as MarketItem[]);
      } catch (e) {
        console.error("Market summary fetch failed", e);
      } finally {
        setMarketLoading(false);
      }
    };
    fetchMarket();
  }, [currency]);

  const loadData = async () => {
    try {
      // Refresh prices to get latest data for the dashboard
      const holdings = await refreshPortfolioPrices();
      const historyData = await getPortfolioHistory();
      const balances = await getCashBalances();

      let totalCash = 0;
      for (const [cur, amt] of Object.entries(balances)) {
        totalCash += convertCurrency(amt, cur, currency, exchangeRates);
      }

      setPortfolio(holdings);
      setHistory(historyData);
      setCashBalance(totalCash);

      // Calculate movers based on the refreshed prices (Daily % Change)
      if (holdings.length > 0) {
        const movers = [...holdings]
          .filter(h => h.shares > 0) // Only show movers for active positions
          .map(h => {
            const dailyChangePercent = h.pricePercent || 0;
            return { ...h, dailyChangePercent };
          })
          .sort((a, b) => Math.abs(b.dailyChangePercent) - Math.abs(a.dailyChangePercent))
          .slice(0, 3);
        setTopMovers(movers);
      } else {
        setTopMovers([]);
      }
    } catch (err) {
      logError("Error loading home data:", err);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadData();

      // Real-time updates: refresh prices every 30 seconds while in focus
      const intervalId = setInterval(() => {
        // Only refresh if we're not already loading
        if (!loading) {
          loadData();
        }
      }, 30000);

      return () => clearInterval(intervalId);
    }, [loading])
  );

  // Stock search logic
  useEffect(() => {
    const fetchCompanies = async () => {
      if (searchQuery.length < 1) {
        setSuggestions([]);
        return;
      }
      try {
        const results = await yahooSearch(searchQuery);
        const companies: Company[] = results.map((item: any) => ({
          name: item.longname || item.shortname || item.symbol,
          ticker: item.symbol,
          exchange: item.exchDisp,
          type: item.typeDisp,
        }));
        setSuggestions(companies);
      } catch (err) {
        logError('Error fetching companies:', err);
      }
    };
    const timer = setTimeout(() => {
      fetchCompanies();
    }, 300); // Add a small debounce
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const totalPortfolioValue = portfolio
    .filter(h => h.symbol !== 'USD')
    .reduce((acc: number, curr: PortfolioHolding) => {
      const nativeValue = curr.shares * (curr.price || 0);
      return acc + convertCurrency(nativeValue, curr.currency || 'USD', currency, exchangeRates);
    }, 0) + cashBalance; // Include cash in home tab total value

  const totalCostBasis = portfolio
    .filter(h => h.symbol !== 'USD')
    .reduce((acc: number, curr: PortfolioHolding) => {
      const nativeCost = curr.shares * (curr.costBasis || curr.price || 0);
      return acc + convertCurrency(nativeCost, curr.currency || 'USD', currency, exchangeRates);
    }, 0) + cashBalance; // Include cash in cost basis so deposits aren't treated as gains

  const totalRealizedProfit = portfolio.reduce((acc: number, curr: PortfolioHolding) => {
    const nativeRealized = curr.realizedProfit || 0;
    return acc + convertCurrency(nativeRealized, curr.currency || 'USD', currency, exchangeRates);
  }, 0);

  const currentTotalProfit = (totalPortfolioValue - totalCostBasis) + totalRealizedProfit;

  const lastSnapshot = history[history.length - 1];
  const secondLastSnapshot = history.length > 1 ? history[history.length - 2] : null;

  // Day change should be based on the last trading day's performance of individual stocks
  // This ensures accuracy on weekends when snapshots might be flat.
  const dayChange = portfolio
    .filter(h => h.symbol !== 'USD')
    .reduce((acc: number, curr: PortfolioHolding) => {
      const nativeChange = curr.shares * (curr.priceChange || 0);
      return acc + convertCurrency(nativeChange, curr.currency || 'USD', currency, exchangeRates);
    }, 0);

  const prevTotalValue = totalPortfolioValue - dayChange;
  const dayChangePercent = prevTotalValue > 0 ? (dayChange / prevTotalValue) * 100 : 0;

  // Convert values for display
  const displayTotalValue = formatCurrency(totalPortfolioValue, currency);
  const displayDayChange = formatCurrency(Math.abs(dayChange), currency);



  return (
    <ScrollView style={[styles.container, { backgroundColor: isDark ? '#121212' : '#f8f9fa' }]} stickyHeaderIndices={[1]}>
      <TouchableWithoutFeedback onPress={() => {
        setSuggestions([]);
        Keyboard.dismiss();
      }}>
        <View style={styles.header}>
          <View style={styles.topRow}>
            <View>
              <Text style={[styles.greeting, { color: isDark ? '#8e8e93' : '#8e8e93' }]}>Welcome back</Text>
              <Text style={[styles.homeTitle, { color: isDark ? '#fff' : '#1a1a1a' }]}>Stock Trends</Text>
            </View>
            <TouchableOpacity style={styles.profileButton} onPress={() => navigation.navigate('portfolio')}>
              <Ionicons name="pie-chart-outline" size={32} color="#007AFF" />
            </TouchableOpacity>
          </View>

          <View style={[styles.searchSection, { shadowColor: isDark ? '#000' : '#007AFF' }]}>
            <View style={[styles.searchContainer, {
              backgroundColor: isDark ? 'rgba(30, 30, 30, 0.8)' : 'rgba(255, 255, 255, 0.9)',
              borderColor: isDark ? '#333' : '#e0e0e0'
            }]}>
              <Ionicons name="search" size={20} color={isDark ? '#8e8e93' : '#8e8e93'} style={styles.searchIcon} />
              <TextInput
                style={[styles.searchInput, { color: isDark ? '#fff' : '#000' }]}
                placeholder="Search ticker, company or asset"
                placeholderTextColor={isDark ? '#666' : '#999'}
                onChangeText={setSearchQuery}
                value={searchQuery}
                autoCorrect={false}
              />
            </View>
            {suggestions.length > 0 && (
              <View style={[styles.suggestionsContainer, {
                backgroundColor: isDark ? 'rgba(30, 30, 30, 0.95)' : 'rgba(255, 255, 255, 0.98)',
                borderColor: isDark ? '#444' : '#eee'
              }]}>
                {suggestions.map((s, index) => (
                  <TouchableOpacity
                    key={`${s.ticker}-${index}`}
                    style={[styles.suggestionItem, { borderBottomColor: isDark ? '#333' : '#f0f0f0' }]}
                    onPress={() => {
                      navigation.navigate('SearchResultsScreen', { stockSymbol: s.ticker });
                      setSearchQuery('');
                      setSuggestions([]);
                    }}
                  >
                    <View style={styles.suggestionLeft}>
                      <View style={[styles.symbolBadge, { backgroundColor: isDark ? '#333' : '#f0f2f5' }]}>
                        <Text style={[styles.symbolBadgeText, { color: isDark ? '#fff' : '#000' }]}>{s.ticker}</Text>
                      </View>
                      <View style={{ marginLeft: 12 }}>
                        <Text style={[styles.suggestionText, { color: isDark ? '#fff' : '#1a1a1a' }]} numberOfLines={1}>{s.name}</Text>
                        <Text style={styles.suggestionSubtext}>
                          {s.exchange} • {s.type}
                        </Text>
                      </View>
                    </View>
                    <MaterialIcons name="arrow-forward-ios" size={14} color="#8e8e93" />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>



          {portfolio.length > 0 && (
            <TouchableOpacity
              style={[styles.portfolioCard, {
                backgroundColor: isDark ? '#1e1e1e' : '#fff',
                borderColor: isDark ? '#333' : '#eee'
              }]}
              onPress={() => navigation.navigate('portfolio')}
            >
              <View style={styles.cardTop}>
                <Text style={styles.cardLabel}>Personal Portfolio</Text>
                <MaterialIcons name="chevron-right" size={20} color="#8e8e93" />
              </View>
              <Text style={[styles.portfolioValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                {displayTotalValue}
              </Text>
              <View style={styles.cardBottom}>
                <Text style={[styles.cardChange, dayChange >= 0 ? styles.positiveText : styles.negativeText]}>
                  {dayChange >= 0 ? '+' : '-'}{displayDayChange} ({dayChangePercent.toFixed(1)}%)
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {topMovers.length > 0 && (
            <View style={styles.moversSection}>
              <Text style={[styles.sectionTitle, { color: isDark ? '#fff' : '#1a1a1a' }]}>Portfolio Movers</Text>
              <View style={styles.moversGrid}>
                {topMovers.map((mover: any) => (
                  <TouchableOpacity
                    key={mover.symbol}
                    style={[styles.moverItem, {
                      backgroundColor: isDark ? '#1e1e1e' : '#fff',
                      borderColor: isDark ? '#333' : '#eee'
                    }]}
                    onPress={() => navigation.navigate('SearchResultsScreen', { stockSymbol: mover.symbol })}
                  >
                    <Text style={[styles.moverSymbol, { color: isDark ? '#fff' : '#1a1a1a' }]}>{mover.symbol}</Text>
                    <Text style={[styles.moverValue, mover.dailyChangePercent >= 0 ? styles.positiveText : styles.negativeText]}>
                      {mover.dailyChangePercent >= 0 ? '+' : ''}{mover.dailyChangePercent.toFixed(1)}%
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {!marketLoading && marketSummary.length > 0 && (
            <View style={{ marginBottom: 24 }}>
              <Text style={[styles.sectionTitle, { color: isDark ? '#fff' : '#1a1a1a', marginBottom: 16 }]}>Market Snapshot</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 20 }}>
                {marketSummary.map((item, index) => (
                  <MarketSummaryCard
                    key={index}
                    {...item}
                    onPress={() => {
                      navigation.navigate('SearchResultsScreen', { stockSymbol: item.symbol });
                    }}
                  />
                ))}
              </ScrollView>
            </View>
          )}

          {portfolio.length === 0 && (
            <View style={[styles.emptyPortfolioCard, {
              backgroundColor: isDark ? '#1e1e1e' : '#f1f1f6',
              borderColor: isDark ? '#444' : '#c7c7cc'
            }]}>
              <Text style={[styles.emptyTitle, { color: isDark ? '#fff' : '#333' }]}>Start your portfolio</Text>
              <Text style={[styles.emptySubtext, { color: isDark ? '#8e8e93' : '#8e8e93' }]}>Search for a stock and add it to your portfolio to see its performance here.</Text>
              <TouchableOpacity
                style={styles.settingsButton}
                onPress={() => navigation.navigate('settings')}
              >
                <Text style={styles.settingsButtonText}>Set Preferred Currency</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </TouchableWithoutFeedback>
    </ScrollView>
  );
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CONTAINER_PADDING = 20;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: CONTAINER_PADDING,
    paddingTop: 60,
    paddingBottom: 40,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 28,
  },
  greeting: {
    fontSize: 13,
    color: '#8e8e93',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  homeTitle: {
    fontSize: 34,
    fontWeight: '900',
    color: '#1a1a1a',
    letterSpacing: -1,
  },
  profileButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchSection: {
    zIndex: 100,
    marginBottom: 32,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 60,
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 16,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  suggestionsContainer: {
    position: 'absolute',
    top: 68,
    left: 0,
    right: 0,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 15 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
    overflow: 'hidden',
    zIndex: 1000,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  suggestionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  symbolBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    minWidth: 60,
    alignItems: 'center',
  },
  symbolBadgeText: {
    fontSize: 13,
    fontWeight: '800',
  },
  suggestionText: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
    maxWidth: SCREEN_WIDTH * 0.5,
  },
  suggestionSubtext: {
    fontSize: 12,
    color: '#8e8e93',
    fontWeight: '500',
  },
  portfolioCard: {
    padding: 24,
    borderRadius: 30,
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.15,
    shadowRadius: 32,
    elevation: 10,
    borderWidth: 1,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  portfolioValue: {
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: -1,
    marginBottom: 12,
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardChange: {
    fontSize: 17,
    fontWeight: '800',
  },
  moversSection: {
    marginBottom: 36,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1a1a1a',
    marginBottom: 20,
    letterSpacing: -0.5,
  },
  moversGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  moverItem: {
    flex: 1,
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  moverSymbol: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  moverValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  emptyPortfolioCard: {
    padding: 32,
    borderRadius: 30,
    alignItems: 'center',
    borderStyle: 'dashed',
    borderWidth: 2,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 10,
  },
  emptySubtext: {
    fontSize: 15,
    color: '#8e8e93',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
    paddingHorizontal: 10,
  },
  settingsButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 18,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  settingsButtonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.5,
  },
  positiveBadge: {
    backgroundColor: 'rgba(52, 199, 89, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  negativeBadge: {
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  positiveText: {
    color: '#34C759',
  },
  negativeText: {
    color: '#FF3B30',
  },
});

export default HomeScreen;
