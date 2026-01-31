import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Dimensions, ScrollView, Platform } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { secFetch, yahooSearch } from '@/utils/secApi';
import { error as logError } from '@/utils/logger';
import { getPortfolio, PortfolioHolding, getPortfolioHistory, PortfolioSnapshot, refreshPortfolioPrices } from '@/utils/db';

interface Company {
  name: string;
  ticker: string;
  cik?: string;
  exchange?: string;
  type?: string;
}

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [portfolio, setPortfolio] = useState<PortfolioHolding[]>([]);
  const [history, setHistory] = useState<PortfolioSnapshot[]>([]);
  const [topMovers, setTopMovers] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<Company[]>([]);

  const loadData = async () => {
    try {
      // Refresh prices to get latest data for the dashboard
      const holdings = await refreshPortfolioPrices();
      const historyData = await getPortfolioHistory();

      setPortfolio(holdings);
      setHistory(historyData);

      // Calculate movers based on the refreshed prices
      if (holdings.length > 0) {
        const movers = [...holdings]
          .filter(h => h.shares > 0) // Only show movers for active positions
          .map(h => {
            const currentPrice = h.price || 0;
            const costBasis = h.costBasis || currentPrice;
            const profitPercent = costBasis > 0 ? ((currentPrice - costBasis) / costBasis) * 100 : 0;
            return { ...h, profitPercent };
          })
          .sort((a, b) => Math.abs(b.profitPercent) - Math.abs(a.profitPercent))
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

  const totalPortfolioValue = portfolio.reduce((acc: number, curr: PortfolioHolding) => acc + (curr.shares * (curr.price || 0)), 0);
  const totalCostBasis = portfolio.reduce((acc: number, curr: PortfolioHolding) => acc + (curr.shares * (curr.costBasis || curr.price || 0)), 0);
  const totalRealizedProfit = portfolio.reduce((acc: number, curr: PortfolioHolding) => acc + (curr.realizedProfit || 0), 0);
  const currentTotalProfit = (totalPortfolioValue - totalCostBasis) + totalRealizedProfit;

  const lastSnapshot = history[history.length - 1];
  const secondLastSnapshot = history.length > 1 ? history[history.length - 2] : null;

  // Day change should compare current total profit against previous DAY'S snapshot total profit
  // This ensures real-time updates are reflected as gains/losses throughout the day.
  const dayChange = secondLastSnapshot
    ? currentTotalProfit - secondLastSnapshot.totalProfit
    : 0;

  const dayChangePercent = secondLastSnapshot && secondLastSnapshot.totalValue > 0
    ? (dayChange / secondLastSnapshot.totalValue) * 100
    : 0;

  if (loading && portfolio.length === 0) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.greeting}>Welcome back</Text>
            <Text style={styles.homeTitle}>Stock Trends</Text>
          </View>
          <TouchableOpacity style={styles.profileButton} onPress={() => navigation.navigate('portfolio')}>
            <Ionicons name="pie-chart-outline" size={32} color="#007AFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.searchSection}>
          <TextInput
            style={styles.searchBar}
            placeholder="Search stocks or companies"
            placeholderTextColor="gray"
            onChangeText={setSearchQuery}
            value={searchQuery}
          />
          {suggestions.length > 0 && (
            <View style={styles.suggestionsContainer}>
              {suggestions.map((s, index) => (
                <TouchableOpacity
                  key={`${s.ticker}-${index}`}
                  style={styles.suggestionItem}
                  onPress={() => {
                    navigation.navigate('SearchResultsScreen', { stockSymbol: s.ticker });
                    setSearchQuery('');
                    setSuggestions([]);
                  }}
                >
                  <View>
                    <Text style={styles.suggestionText}>{s.name}</Text>
                    <Text style={styles.suggestionSubtext}>
                      {s.ticker} • {s.exchange} • {s.type}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {portfolio.length > 0 && (
          <TouchableOpacity
            style={styles.portfolioCard}
            onPress={() => navigation.navigate('portfolio')}
          >
            <View style={styles.cardTop}>
              <Text style={styles.cardLabel}>Personal Portfolio</Text>
              <MaterialIcons name="chevron-right" size={20} color="#8e8e93" />
            </View>
            <Text style={styles.portfolioValue}>
              ${totalPortfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </Text>
            <View style={styles.cardBottom}>
              <Text style={[styles.cardChange, dayChange >= 0 ? styles.positiveText : styles.negativeText]}>
                {dayChange >= 0 ? '+' : ''}${Math.abs(dayChange).toLocaleString(undefined, { maximumFractionDigits: 0 })} ({dayChangePercent.toFixed(1)}%)
              </Text>
              <Text style={styles.cardTime}>Today</Text>
            </View>
          </TouchableOpacity>
        )}

        {topMovers.length > 0 && (
          <View style={styles.moversSection}>
            <Text style={styles.sectionTitle}>Portfolio Movers</Text>
            <View style={styles.moversGrid}>
              {topMovers.map((mover: any) => (
                <TouchableOpacity
                  key={mover.symbol}
                  style={styles.moverItem}
                  onPress={() => navigation.navigate('SearchResultsScreen', { stockSymbol: mover.symbol })}
                >
                  <Text style={styles.moverSymbol}>{mover.symbol}</Text>
                  <Text style={[styles.moverValue, mover.profitPercent >= 0 ? styles.positiveText : styles.negativeText]}>
                    {mover.profitPercent >= 0 ? '+' : ''}{mover.profitPercent.toFixed(1)}%
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {portfolio.length === 0 && (
          <View style={styles.emptyPortfolioCard}>
            <Text style={styles.emptyTitle}>Start your portfolio</Text>
            <Text style={styles.emptySubtext}>Search for a stock and add it to your portfolio to see its performance here.</Text>
          </View>
        )}
      </View>
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
    paddingTop: 80,
    paddingBottom: 40,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  greeting: {
    fontSize: 14,
    color: '#8e8e93',
    fontWeight: '500',
  },
  homeTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1a1a1a',
    letterSpacing: -0.5,
  },
  profileButton: {
    padding: 2,
  },
  searchSection: {
    zIndex: 100,
    marginBottom: 28,
  },
  searchBar: {
    height: 56,
    borderColor: '#e0e0e0',
    borderWidth: 1.5,
    paddingHorizontal: 20,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    fontSize: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  suggestionsContainer: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#eee',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: 6,
    zIndex: 1000,
  },
  suggestionItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  suggestionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  suggestionSubtext: {
    fontSize: 12,
    color: '#8e8e93',
  },
  portfolioCard: {
    backgroundColor: '#ffffff',
    padding: 24,
    borderRadius: 24,
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#eee',
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  portfolioValue: {
    fontSize: 38,
    fontWeight: '800',
    color: '#1a1a1a',
    marginBottom: 10,
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardChange: {
    fontSize: 18,
    fontWeight: '700',
  },
  cardTime: {
    fontSize: 15,
    color: '#8e8e93',
  },
  moversSection: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 20,
  },
  moversGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  moverItem: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#eee',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  moverSymbol: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 6,
  },
  moverValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  emptyPortfolioCard: {
    backgroundColor: '#f1f1f6',
    padding: 24,
    borderRadius: 24,
    alignItems: 'center',
    borderStyle: 'dashed',
    borderWidth: 1.5,
    borderColor: '#c7c7cc',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#8e8e93',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  searchButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  searchButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  positiveText: {
    color: '#34C759',
  },
  negativeText: {
    color: '#FF3B30',
  },
});

export default HomeScreen;
