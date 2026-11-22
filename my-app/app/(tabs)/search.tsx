import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Dimensions,
  ScrollView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  Image,
} from 'react-native';
import { useNavigation, useFocusEffect } from 'expo-router';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { secFetch, yahooSearch, fetchStockHistory, fetchStockPrice } from '@/utils/secApi';
import { error as logError } from '@/utils/logger';
import {
  getPortfolio,
  PortfolioHolding,
  getPortfolioHistory,
  PortfolioSnapshot,
  refreshPortfolioPrices,
  getCashBalances,
} from '@/utils/db';
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

const pandaAvatar = require('@/assets/images/app-icon.jpg');

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
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);
  const marketScrollViewRef = useRef<any>(null);

  // Fetch Market Data
  useEffect(() => {
    const fetchMarket = async () => {
      const baseSymbols = [
        { sym: 'ES=F', name: 'S&P 500' },
        { sym: 'NQ=F', name: 'NASDAQ' },
        { sym: 'YM=F', name: 'Dow Jones' },
        { sym: 'XIU.TO', name: 'TSX 60' },
        { sym: 'GC=F', name: 'Gold' },
        { sym: 'CL=F', name: 'Oil' },
      ];

      // Relevant currency pairs based on user selected currency
      const currencyPairs: any[] = [];
      const majorCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'JPY'];

      if (currency !== 'USD') {
        currencyPairs.push({ sym: `${currency}USD=X`, name: `${currency}/USD` });
        currencyPairs.push({ sym: `USD${currency}=X`, name: `USD/${currency}` });

        const otherMajor = majorCurrencies.find((c) => c !== currency && c !== 'USD');
        if (otherMajor) {
          currencyPairs.push({ sym: `${currency}${otherMajor}=X`, name: `${currency}/${otherMajor}` });
        }
      } else {
        currencyPairs.push({ sym: 'EURUSD=X', name: 'EUR/USD' });
        currencyPairs.push({ sym: 'GBPUSD=X', name: 'GBP/USD' });
        currencyPairs.push({ sym: 'JPYUSD=X', name: 'JPY/USD' });
      }

      // Always add Bitcoin
      currencyPairs.push({ sym: 'BTC-USD', name: 'Bitcoin' });

      const allSymbols = [...baseSymbols, ...currencyPairs];

      try {
        const results = await Promise.all(
          allSymbols.map(async (item) => {
            try {
              const historyData = await fetchStockHistory(item.sym, '5d', '15m');
              const quote = await fetchStockPrice(item.sym);
              const prices = historyData.map((h) => h.price);

              let finalPrice = quote.price;
              if ((!finalPrice || finalPrice === 0) && prices.length > 0) {
                finalPrice = prices[prices.length - 1];
              }

              return {
                symbol: item.sym,
                name: item.name,
                data: prices,
                price: finalPrice || 0,
                changePercent: quote.percent || 0,
              };
            } catch (e) {
              console.error(`Error fetching ${item.sym}`, e);
              return null;
            }
          })
        );
        setMarketSummary(results.filter((r) => r !== null && r.price > 0) as MarketItem[]);
      } catch (e) {
        console.error('Market summary fetch failed', e);
      } finally {
        setMarketLoading(false);
      }
    };
    fetchMarket();
  }, [currency]);

  const loadData = async () => {
    try {
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

      if (holdings.length > 0) {
        const movers = [...holdings]
          .filter((h) => h.shares > 0)
          .map((h) => {
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
      logError('Error loading home data:', err);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadData();

      const intervalId = setInterval(() => {
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
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const totalPortfolioValue =
    portfolio
      .filter((h) => h.symbol !== 'USD')
      .reduce((acc: number, curr: PortfolioHolding) => {
        const nativeValue = curr.shares * (curr.price || 0);
        return acc + convertCurrency(nativeValue, curr.currency || 'USD', currency, exchangeRates);
      }, 0) + cashBalance;

  const totalCostBasis =
    portfolio
      .filter((h) => h.symbol !== 'USD')
      .reduce((acc: number, curr: PortfolioHolding) => {
        const nativeCost = curr.shares * (curr.costBasis || curr.price || 0);
        return acc + convertCurrency(nativeCost, curr.currency || 'USD', currency, exchangeRates);
      }, 0) + cashBalance;

  const totalRealizedProfit = portfolio.reduce((acc: number, curr: PortfolioHolding) => {
    const nativeRealized = curr.realizedProfit || 0;
    return acc + convertCurrency(nativeRealized, curr.currency || 'USD', currency, exchangeRates);
  }, 0);

  const currentTotalProfit = totalPortfolioValue - totalCostBasis + totalRealizedProfit;

  const dayChange = portfolio
    .filter((h) => h.symbol !== 'USD')
    .reduce((acc: number, curr: PortfolioHolding) => {
      const nativeChange = curr.shares * (curr.priceChange || 0);
      return acc + convertCurrency(nativeChange, curr.currency || 'USD', currency, exchangeRates);
    }, 0);

  const prevTotalValue = totalPortfolioValue - dayChange;
  const dayChangePercent = prevTotalValue > 0 ? (dayChange / prevTotalValue) * 100 : 0;

  const displayTotalValue = formatCurrency(totalPortfolioValue, currency);
  const displayDayChange = formatCurrency(Math.abs(dayChange), currency);
  const displayCostBasis = formatCurrency(totalCostBasis, currency);
  const displayCashBalance = formatCurrency(cashBalance, currency);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: isDark ? '#0B141E' : '#F4F9FC' }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <TouchableWithoutFeedback
        onPress={() => {
          setSuggestions([]);
          Keyboard.dismiss();
        }}
      >
        <View style={styles.header}>
          {/* Top Row with Mascot Avatar & Greeting */}
          <View style={styles.topRow}>
            <View style={styles.userProfileSection}>
              <View
                style={[
                  styles.avatarWrapper,
                  {
                    borderColor: isDark ? '#1E2E4A' : '#D6E5FA',
                    backgroundColor: isDark ? '#131E32' : '#FFFFFF',
                  },
                ]}
              >
                <Image source={pandaAvatar} style={styles.avatarImage} resizeMode="cover" />
              </View>
              <View style={styles.greetingContainer}>
                <View
                  style={[
                    styles.tagBadge,
                    {
                      backgroundColor: isDark ? 'rgba(141, 203, 226, 0.2)' : '#E8F5FA',
                    },
                  ]}
                >
                  <View style={styles.activeDot} />
                  <Text
                    style={[
                      styles.tagBadgeText,
                      { color: isDark ? '#9ED7ED' : '#2B87AB' },
                    ]}
                  >
                    ValueCentral
                  </Text>
                </View>
                <Text style={[styles.homeTitle, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>
                  Stock Trends
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.profileButton,
                {
                  backgroundColor: isDark ? 'rgba(141, 203, 226, 0.2)' : '#FFFFFF',
                  borderColor: isDark ? '#1E3245' : '#E2F0F7',
                },
              ]}
              onPress={() => navigation.navigate('portfolio')}
              activeOpacity={0.7}
            >
              <Ionicons name="pie-chart" size={22} color={isDark ? '#9ED7ED' : '#2B87AB'} />
            </TouchableOpacity>
          </View>

          {/* Search Section */}
          <View style={styles.searchSection}>
            <View
              style={[
                styles.searchContainer,
                {
                  backgroundColor: isDark ? '#13202E' : '#FFFFFF',
                  borderColor: isDark ? '#1E3245' : '#E2F0F7',
                  shadowColor: '#8DCBE2',
                },
              ]}
            >
              <Ionicons
                name="search"
                size={20}
                color={isDark ? '#9ED7ED' : '#2B87AB'}
                style={styles.searchIcon}
              />
              <TextInput
                style={[styles.searchInput, { color: isDark ? '#F8FAFC' : '#0F172A' }]}
                placeholder="Search ticker, company or asset"
                placeholderTextColor={isDark ? '#64748B' : '#94A3B8'}
                onChangeText={setSearchQuery}
                value={searchQuery}
                autoCorrect={false}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} style={{ padding: 4 }}>
                  <Ionicons name="close-circle" size={18} color={isDark ? '#64748B' : '#94A3B8'} />
                </TouchableOpacity>
              )}
            </View>

            {suggestions.length > 0 && (
              <View
                style={[
                  styles.suggestionsContainer,
                  {
                    backgroundColor: isDark ? '#131E32' : '#FFFFFF',
                    borderColor: isDark ? '#1E2E4A' : '#E2E8F0',
                  },
                ]}
              >
                {suggestions.map((s, index) => (
                  <TouchableOpacity
                    key={`${s.ticker}-${index}`}
                    style={[
                      styles.suggestionItem,
                      {
                        borderBottomColor: isDark ? '#1B263B' : '#F1F5F9',
                        borderBottomWidth: index === suggestions.length - 1 ? 0 : 1,
                      },
                    ]}
                    onPress={() => {
                      navigation.navigate('SearchResultsScreen', { stockSymbol: s.ticker });
                      setSearchQuery('');
                      setSuggestions([]);
                    }}
                  >
                    <View style={styles.suggestionLeft}>
                      <View
                        style={[
                          styles.symbolBadge,
                          {
                            backgroundColor: isDark ? 'rgba(141, 203, 226, 0.2)' : '#E8F5FA',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.symbolBadgeText,
                            { color: isDark ? '#9ED7ED' : '#2B87AB' },
                          ]}
                        >
                          {s.ticker}
                        </Text>
                      </View>
                      <View style={{ marginLeft: 12, flex: 1 }}>
                        <Text
                          style={[
                            styles.suggestionText,
                            { color: isDark ? '#F8FAFC' : '#0F172A' },
                          ]}
                          numberOfLines={1}
                        >
                          {s.name}
                        </Text>
                        <Text style={styles.suggestionSubtext}>
                          {s.exchange} • {s.type}
                        </Text>
                      </View>
                    </View>
                    <MaterialIcons
                      name="arrow-forward-ios"
                      size={14}
                      color={isDark ? '#64748B' : '#94A3B8'}
                    />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Portfolio Overview Card */}
          {portfolio.length > 0 && (
            <TouchableOpacity
              style={[
                styles.portfolioCard,
                {
                  backgroundColor: isDark ? '#13202E' : '#FFFFFF',
                  borderColor: isDark ? '#1E3245' : '#E2F0F7',
                },
              ]}
              onPress={() => navigation.navigate('portfolio')}
              activeOpacity={0.9}
            >
              <View style={styles.cardTop}>
                <View
                  style={[
                    styles.cardPill,
                    {
                      backgroundColor: isDark ? 'rgba(141, 203, 226, 0.2)' : '#E8F5FA',
                    },
                  ]}
                >
                  <Ionicons
                    name="trending-up"
                    size={14}
                    color={isDark ? '#9ED7ED' : '#2B87AB'}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.cardPillText,
                      { color: isDark ? '#9ED7ED' : '#2B87AB' },
                    ]}
                  >
                    PORTFOLIO OVERVIEW
                  </Text>
                </View>
                <MaterialIcons
                  name="chevron-right"
                  size={20}
                  color={isDark ? '#64748B' : '#94A3B8'}
                />
              </View>

              <Text style={[styles.portfolioValue, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>
                {displayTotalValue}
              </Text>

              <View style={styles.cardBottom}>
                <View
                  style={[
                    styles.changeChip,
                    {
                      backgroundColor:
                        dayChange >= 0
                          ? isDark
                            ? 'rgba(52, 211, 153, 0.15)'
                            : '#DCFCE7'
                          : isDark
                          ? 'rgba(248, 113, 113, 0.15)'
                          : '#FEE2E2',
                    },
                  ]}
                >
                  <Ionicons
                    name={dayChange >= 0 ? 'arrow-up' : 'arrow-down'}
                    size={12}
                    color={dayChange >= 0 ? '#10B981' : '#EF4444'}
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={[
                      styles.changeChipText,
                      { color: dayChange >= 0 ? '#10B981' : '#EF4444' },
                    ]}
                  >
                    {dayChange >= 0 ? '+' : '-'}
                    {displayDayChange} ({dayChangePercent.toFixed(1)}%)
                  </Text>
                </View>
                <Text style={styles.todayLabel}>Today</Text>
              </View>

              {/* Sub-metrics */}
              <View
                style={[
                  styles.cardSubMetrics,
                  {
                    borderTopColor: isDark ? '#1E2C44' : '#F1F5F9',
                  },
                ]}
              >
                <View style={styles.subMetricItem}>
                  <Text style={styles.subMetricLabel}>Cost Basis</Text>
                  <Text
                    style={[
                      styles.subMetricValue,
                      { color: isDark ? '#F8FAFC' : '#0F172A' },
                    ]}
                  >
                    {displayCostBasis}
                  </Text>
                </View>
                <View
                  style={[
                    styles.subMetricDivider,
                    { backgroundColor: isDark ? '#1E2C44' : '#F1F5F9' },
                  ]}
                />
                <View style={styles.subMetricItem}>
                  <Text style={styles.subMetricLabel}>Available Cash</Text>
                  <Text
                    style={[
                      styles.subMetricValue,
                      { color: isDark ? '#F8FAFC' : '#0F172A' },
                    ]}
                  >
                    {displayCashBalance}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          )}

          {/* Top Movers Section */}
          {topMovers.length > 0 && (
            <View style={styles.moversSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>
                  Portfolio Movers
                </Text>
                <Text style={styles.sectionSubtitle}>24H Change</Text>
              </View>
              <View style={styles.moversGrid}>
                {topMovers.map((mover: any) => (
                  <TouchableOpacity
                    key={mover.symbol}
                    style={[
                      styles.moverItem,
                      {
                        backgroundColor: isDark ? '#131E32' : '#FFFFFF',
                        borderColor: isDark ? '#1E2E4A' : '#E8EEF5',
                      },
                    ]}
                    onPress={() =>
                      navigation.navigate('SearchResultsScreen', { stockSymbol: mover.symbol })
                    }
                    activeOpacity={0.8}
                  >
                    <View
                      style={[
                        styles.moverBadge,
                        {
                          backgroundColor: isDark ? 'rgba(141, 203, 226, 0.2)' : '#E8F5FA',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.moverSymbol,
                          { color: isDark ? '#9ED7ED' : '#2B87AB' },
                        ]}
                      >
                        {mover.symbol}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.moverValue,
                        mover.dailyChangePercent >= 0 ? styles.positiveText : styles.negativeText,
                      ]}
                    >
                      {mover.dailyChangePercent >= 0 ? '+' : ''}
                      {mover.dailyChangePercent.toFixed(1)}%
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Market Snapshot */}
          {!marketLoading && marketSummary.length > 0 && (
            <View style={{ marginBottom: 28 }}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>
                  Market Snapshot
                </Text>
                <Text style={styles.sectionSubtitle}>Global Indices</Text>
              </View>
              <View style={{ position: 'relative' }}>
                <ScrollView
                  ref={(ref) => {
                    marketScrollViewRef.current = ref;
                  }}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingRight: 20 }}
                  onScroll={(event) => {
                    const scrollX = event.nativeEvent.contentOffset.x;
                    const contentWidth = event.nativeEvent.contentSize.width;
                    const viewWidth = event.nativeEvent.layoutMeasurement.width;

                    setShowLeftArrow(scrollX > 10);
                    setShowRightArrow(scrollX < contentWidth - viewWidth - 10);
                  }}
                  scrollEventThrottle={16}
                >
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

                {showLeftArrow && (
                  <TouchableOpacity
                    style={[
                      styles.scrollArrow,
                      styles.leftArrow,
                      {
                        backgroundColor: isDark ? '#131E32' : '#FFFFFF',
                        borderColor: isDark ? '#1E2E4A' : '#E2E8F0',
                      },
                    ]}
                    onPress={() => {
                      marketScrollViewRef.current?.scrollTo({ x: 0, animated: true });
                    }}
                  >
                    <Ionicons
                      name="chevron-back"
                      size={18}
                      color={isDark ? '#F8FAFC' : '#0F172A'}
                    />
                  </TouchableOpacity>
                )}

                {showRightArrow && (
                  <TouchableOpacity
                    style={[
                      styles.scrollArrow,
                      styles.rightArrow,
                      {
                        backgroundColor: isDark ? '#131E32' : '#FFFFFF',
                        borderColor: isDark ? '#1E2E4A' : '#E2E8F0',
                      },
                    ]}
                    onPress={() => {
                      marketScrollViewRef.current?.scrollToEnd({ animated: true });
                    }}
                  >
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={isDark ? '#F8FAFC' : '#0F172A'}
                    />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* Empty Portfolio Card with Panda Branding */}
          {portfolio.length === 0 && (
            <View
              style={[
                styles.emptyPortfolioCard,
                {
                  backgroundColor: isDark ? '#131E32' : '#FFFFFF',
                  borderColor: isDark ? '#1E2E4A' : '#E8EEF5',
                },
              ]}
            >
              <View style={styles.emptyAvatarContainer}>
                <Image source={pandaAvatar} style={styles.emptyPandaImage} resizeMode="cover" />
              </View>
              <Text style={[styles.emptyTitle, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>
                Welcome to ValueCentral
              </Text>
              <Text style={[styles.emptySubtext, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                Start tracking your portfolio or explore 13F filings from the world's top
                institutional investors.
              </Text>
              <TouchableOpacity
                style={styles.settingsButton}
                onPress={() => navigation.navigate('index')}
                activeOpacity={0.85}
              >
                <Text style={styles.settingsButtonText}>Explore 13F Filings</Text>
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" style={{ marginLeft: 8 }} />
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
  },
  header: {
    padding: CONTAINER_PADDING,
    paddingTop: Platform.OS === 'ios' ? 60 : 44,
    paddingBottom: 110,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  userProfileSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrapper: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    overflow: 'hidden',
    marginRight: 12,
    shadowColor: '#8DCBE2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  greetingContainer: {
    justifyContent: 'center',
  },
  tagBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 2,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#8DCBE2',
    marginRight: 6,
  },
  tagBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  homeTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  profileButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#8DCBE2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  searchSection: {
    zIndex: 100,
    marginBottom: 20,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  suggestionsContainer: {
    position: 'absolute',
    top: 64,
    left: 0,
    right: 0,
    borderRadius: 22,
    borderWidth: 1,
    shadowColor: '#8DCBE2',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
    overflow: 'hidden',
    zIndex: 1000,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  suggestionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  symbolBadge: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    minWidth: 54,
    alignItems: 'center',
  },
  symbolBadgeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  suggestionText: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  suggestionSubtext: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  portfolioCard: {
    padding: 22,
    borderRadius: 26,
    marginBottom: 24,
    borderWidth: 1,
    shadowColor: '#8DCBE2',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  cardPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  portfolioValue: {
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -1,
    marginBottom: 10,
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  changeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  changeChipText: {
    fontSize: 13,
    fontWeight: '800',
  },
  todayLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  cardSubMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingTop: 14,
  },
  subMetricItem: {
    flex: 1,
  },
  subMetricDivider: {
    width: 1,
    height: 28,
    marginHorizontal: 16,
  },
  subMetricLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 2,
  },
  subMetricValue: {
    fontSize: 15,
    fontWeight: '700',
  },
  moversSection: {
    marginBottom: 24,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  sectionSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  moversGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  moverItem: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    shadowColor: '#8DCBE2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  moverBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    marginBottom: 6,
  },
  moverSymbol: {
    fontSize: 13,
    fontWeight: '800',
  },
  moverValue: {
    fontSize: 14,
    fontWeight: '800',
  },
  emptyPortfolioCard: {
    padding: 28,
    borderRadius: 26,
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#8DCBE2',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
  },
  emptyAvatarContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#8DCBE2',
    marginBottom: 16,
    shadowColor: '#8DCBE2',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  emptyPandaImage: {
    width: '100%',
    height: '100%',
  },
  emptyTitle: {
    fontSize: 19,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
    paddingHorizontal: 12,
  },
  settingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2B87AB',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 16,
    shadowColor: '#8DCBE2',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  settingsButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  positiveText: {
    color: '#10B981',
  },
  negativeText: {
    color: '#EF4444',
  },
  scrollArrow: {
    position: 'absolute',
    top: '50%',
    transform: [{ translateY: -18 }],
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#8DCBE2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 10,
  },
  leftArrow: {
    left: 6,
  },
  rightArrow: {
    right: 6,
  },
});

export default HomeScreen;
