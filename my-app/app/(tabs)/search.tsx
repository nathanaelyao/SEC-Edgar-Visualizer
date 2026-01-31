import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Dimensions, ScrollView, Platform } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { secFetch } from '@/utils/secApi';
import { error as logError } from '@/utils/logger';
import { getPortfolio, PortfolioHolding, getPortfolioHistory, PortfolioSnapshot, refreshPortfolioPrices } from '@/utils/db';

interface Company {
  name: string;
  ticker: string;
  cik: string;
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
    }, [])
  );

  // Stock search logic
  useEffect(() => {
    const fetchCompanies = async () => {
      if (searchQuery.length < 1) {
        setSuggestions([]);
        return;
      }
      try {
        const response = await secFetch('https://www.sec.gov/files/company_tickers.json');
        if (!response.ok) throw new Error('Failed to fetch tickers');
        const data = await response.json();
        const companies: Company[] = Object.values(data).map((item: any) => ({
          name: item.title ?? '',
          ticker: item.ticker ?? '',
          cik: item.cik_str?.toString().padStart(10, '0') ?? '',
        }));

        const filtered = companies
          .filter(
            (c) =>
              c.ticker.toUpperCase().includes(searchQuery.toUpperCase()) ||
              c.name.toUpperCase().includes(searchQuery.toUpperCase())
          )
          .slice(0, 5);
        setSuggestions(filtered);
      } catch (err) {
        logError('Error fetching companies:', err);
      }
    };
    fetchCompanies();
  }, [searchQuery]);

  const totalPortfolioValue = portfolio.reduce((acc: number, curr: PortfolioHolding) => acc + (curr.shares * (curr.price || 0)), 0);
  const lastSnapshot = history[history.length - 1];
  const dayChange = lastSnapshot && history.length > 1
    ? lastSnapshot.totalValue - history[history.length - 2].totalValue
    : 0;
  const dayChangePercent = lastSnapshot && history.length > 1 && history[history.length - 2].totalValue > 0
    ? (dayChange / history[history.length - 2].totalValue) * 100
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
            <Text style={styles.homeTitle}>Investment Hub</Text>
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
              {suggestions.map((s) => (
                <TouchableOpacity
                  key={s.cik}
                  style={styles.suggestionItem}
                  onPress={() => {
                    navigation.navigate('SearchResultsScreen', { stockSymbol: s.ticker });
                    setSearchQuery('');
                    setSuggestions([]);
                  }}
                >
                  <Text style={styles.suggestionText}>{s.name} ({s.ticker})</Text>
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
              <Text style={styles.cardTime}>Past 24h</Text>
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
            <TouchableOpacity
              style={styles.searchButton}
              onPress={() => { }}
            >
              <Text style={styles.searchButtonText}>Explore Stocks</Text>
            </TouchableOpacity>
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
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
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
    color: '#333',
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
