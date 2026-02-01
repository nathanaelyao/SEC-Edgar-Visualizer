import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, Dimensions, Platform } from 'react-native';
import { XMLParser } from 'fast-xml-parser';
import { RouteProp, useRoute } from '@react-navigation/native';
import cheerio from 'react-native-cheerio';
import { useNavigation } from '@react-navigation/native';
import { secFetch } from '@/utils/secApi';
import { debug, error as logError } from '@/utils/logger';
import { useTheme } from '@/context/ThemeContext';
import { formatCurrency } from '@/utils/currency';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';

type RootStackParamList = {
  HoldingsScreen: { investorName: string; cik: string, institution: string };
};

const HoldingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { isDark } = useTheme();

  const [totalPortfolioValue, setTotalPortfolioValue] = useState(0);
  const route = useRoute<RouteProp<RootStackParamList, 'HoldingsScreen'>>();
  const { investorName, cik, institution } = route.params;
  const [filings, setFilings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previousFilings, setPreviousFilings] = useState<any[]>([]);
  const [quarter, setQuarter] = useState<string | null>(null);

  useEffect(() => {
    fetchFilings();
  }, [cik]);

  const fetchFilings = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const apiUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
      const response = await secFetch(apiUrl);

      if (!response.ok) {
        let errorMsg = `HTTP error! status: ${response.status}`;
        try {
          const errJson = await response.json();
          errorMsg = errJson.message || errorMsg;
        } catch (e) { }
        throw new Error(errorMsg);
      }

      const data = await response.json();
      const recentFilings = data.filings.recent;
      if (recentFilings) {
        let first = true;
        let second = true;
        for (let i = 0; i < recentFilings.accessionNumber.length; i++) {
          const accessionNumber = recentFilings.accessionNumber[i];
          const filingDate = recentFilings.filingDate[i];
          const formType = recentFilings.form[i];
          if (formType == '13F-HR' && first) {
            first = false;
            const filingDateObj = new Date(filingDate);
            const month = filingDateObj.getMonth() + 1;
            let quarterString = "";

            if (month >= 1 && month <= 3) quarterString = "Q4 " + (filingDateObj.getFullYear() - 1);
            else if (month >= 4 && month <= 6) quarterString = "Q1 " + filingDateObj.getFullYear();
            else if (month >= 7 && month <= 9) quarterString = "Q2 " + filingDateObj.getFullYear();
            else if (month >= 10 && month <= 12) quarterString = "Q3 " + filingDateObj.getFullYear();

            setQuarter(quarterString);

            getHoldings(accessionNumber, data.cik).then(holdings => {
              const combinedHoldings = combineSameIssuer(holdings)
              const sortedHoldings = sortHoldingsByValue(combinedHoldings);
              setFilings(sortedHoldings || []);
              if (sortedHoldings) {
                const totalValue = combinedHoldings.reduce((sum, item) => sum + parseFloat(item.value), 0);
                setTotalPortfolioValue(totalValue);
              }
            });
          }
          else if (formType == '13F-HR' && second) {
            second = false;
            await getHoldings(accessionNumber, data.cik).then(previousHoldings => {
              setPreviousFilings(combineSameIssuer(previousHoldings));
            });
            break;
          }
        }
      }
    } catch (err: unknown) {
      setError((err as any)?.message ?? String(err));
      logError("Error fetching filings:", err);
    } finally {
      setLoading(false);
    }
  };

  const calculatePercentageChange = (currentShares: number, issuer: string): { change: string; color: string; type: 'add' | 'reduce' | 'new' | 'none' } => {
    if (previousFilings.length === 0) {
      return { change: "N/A", color: isDark ? '#8e8e93' : '#8e8e93', type: 'none' };
    }

    const previousHolding = previousFilings.find(item => item.nameOfIssuer === issuer);

    if (!previousHolding || !previousHolding.shrsOrPrnAmt?.sshPrnamt) {
      return { change: "New position", color: '#34C759', type: 'new' };
    }

    const previousShares = parseFloat(previousHolding.shrsOrPrnAmt.sshPrnamt);

    if (isNaN(currentShares) || isNaN(previousShares) || previousShares === 0) {
      return { change: "N/A", color: isDark ? '#8e8e93' : '#8e8e93', type: 'none' };
    }

    const percentageChange = ((currentShares - previousShares) / previousShares) * 100;
    const absPercentageChange = Math.abs(percentageChange);

    if (percentageChange > 0) {
      return { change: `Add ${absPercentageChange.toFixed(2)}%`, color: '#34C759', type: 'add' };
    } else if (percentageChange < 0) {
      return { change: `Reduce ${absPercentageChange.toFixed(2)}%`, color: '#FF3B30', type: 'reduce' };
    } else {
      return { change: "0.00%", color: isDark ? '#8e8e93' : '#8e8e93', type: 'none' };
    }
  };

  const sortHoldingsByValue = (holdings: any[]) => {
    return [...holdings].sort((a, b) => parseFloat(b.value) - parseFloat(a.value));
  };

  const combineSameIssuer = (holdings: any[]): any[] => {
    const combined: any[] = [];
    const seen = new Set<string>();

    for (const item of holdings) {
      if (!item?.nameOfIssuer || !item?.shrsOrPrnAmt?.sshPrnamt || !item?.value) continue;

      const issuer = item.nameOfIssuer;
      const shares = parseFloat(item.shrsOrPrnAmt.sshPrnamt);
      const value = parseFloat(item.value);

      if (seen.has(issuer)) {
        const existingItem = combined.find(h => h.nameOfIssuer === issuer);
        if (existingItem) {
          existingItem.shrsOrPrnAmt.sshPrnamt = (parseFloat(existingItem.shrsOrPrnAmt.sshPrnamt) + shares).toString();
          existingItem.value = (parseFloat(existingItem.value) + value).toString();
        }
      } else {
        const newItem = JSON.parse(JSON.stringify(item));
        combined.push(newItem);
        seen.add(issuer);
      }
    }
    return combined;
  };

  const getHoldings = async (accessionNumber: string, cik1: string): Promise<any[]> => {
    try {
      const accessionNumberNoHyphens = accessionNumber.replace(/-/g, '');
      const response = await secFetch(`https://www.sec.gov/Archives/edgar/data/${cik1}/${accessionNumberNoHyphens}/index.html`);

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.text();
      const $ = cheerio.load(data);
      const foundFiles: string[] = [];

      $('a').each((i: number, el: any) => {
        const href = $(el).attr && $(el).attr('href');
        if (href && href.endsWith('.xml')) foundFiles.push(href);
      });

      for (let i = 0; i < foundFiles.length; i++) {
        if (!foundFiles[i].startsWith("primary")) {
          const response1 = await secFetch(`https://www.sec.gov${foundFiles[i]}`);
          const data1 = await response1.text();
          const parser = new XMLParser();
          const json = removeNamespace(parser.parse(data1));

          return json['informationTable']?.infoTable ||
            json['ns1:informationTable']?.['ns1:infoTable'] ||
            [];
        }
      }
      return [];
    } catch (error: unknown) {
      logError("Error fetching holdings:", error);
      return [];
    }
  };

  function removeNamespace(data: any): any {
    if (Array.isArray(data)) {
      return data.map((item: any) => removeNamespace(item));
    } else if (typeof data === 'object' && data !== null) {
      const newData: Record<string, any> = {};
      for (const key in data) {
        const newKey = key.replace('ns1:', '');
        newData[newKey] = removeNamespace((data as any)[key]);
      }
      return newData;
    } else {
      return data;
    }
  }

  const formatNumberWithCommas = (number: any): string => {
    if (number === undefined || number === null) return "N/A";
    const n = typeof number === 'string' ? parseFloat(number) : number;
    return n.toLocaleString();
  };

  const calculatePercentage = (value: number): string => {
    if (totalPortfolioValue === 0 || isNaN(value)) return "0.00%";
    const percentage = (value / totalPortfolioValue) * 100;
    return percentage.toFixed(2) + "%";
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  };

  const renderItem = ({ item }: { item: any }) => {
    const changeData = calculatePercentageChange(parseFloat(item.shrsOrPrnAmt?.sshPrnamt), item.nameOfIssuer);
    const displayValue = formatCurrency(parseFloat(item.value), 'USD');
    const allocation = calculatePercentage(parseFloat(item.value));

    return (
      <TouchableOpacity
        style={[styles.holdingCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#f0f0f0' }]}
        onPress={() => {
          navigation.navigate('SearchResultsScreen', {
            stockSymbol: item.nameOfIssuer,
          });
        }}>
        <View style={styles.cardHeader}>
          <View style={[styles.avatar, { backgroundColor: isDark ? '#333' : '#f0f2f5' }]}>
            <Text style={[styles.avatarText, { color: isDark ? '#fff' : '#007AFF' }]}>{getInitials(item.nameOfIssuer)}</Text>
          </View>
          <View style={styles.nameSection}>
            <Text style={[styles.issuerName, { color: isDark ? '#fff' : '#1a1a1a' }]} numberOfLines={1}>{item.nameOfIssuer}</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.allocationBadge, { backgroundColor: isDark ? 'rgba(0,122,255,0.1)' : 'rgba(0,122,255,0.05)' }]}>
                <Text style={styles.allocationText}>{allocation} Portfolio</Text>
              </View>
              {changeData.type !== 'none' && (
                <View style={[styles.changeBadge, { backgroundColor: isDark ? `${changeData.color}20` : `${changeData.color}10` }]}>
                  <Text style={[styles.changeText, { color: changeData.color }]}>{changeData.change}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        <View style={styles.cardDetails}>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>VALUE</Text>
            <Text style={[styles.detailValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>{displayValue}</Text>
          </View>
          <View style={[styles.detailItem, { alignItems: 'flex-end' }]}>
            <Text style={styles.detailLabel}>SHARES</Text>
            <Text style={[styles.detailValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>{formatNumberWithCommas(item.shrsOrPrnAmt?.sshPrnamt)}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#f8f9fa' }]}>
      <View style={styles.fixedHeader}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.backButton, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#eee' }]}>
            <Ionicons name="chevron-back" size={24} color={isDark ? '#fff' : '#007AFF'} />
          </TouchableOpacity>
          <View style={styles.titleSection}>
            <Text style={[styles.headerTitle, { color: isDark ? '#fff' : '#1a1a1a' }]} numberOfLines={1}>{investorName}</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>{institution}</Text>
          </View>
          <View style={{ width: 44 }} />
        </View>

        <View style={[styles.summaryCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#f0f0f0' }]}>
          <View style={styles.summaryRow}>
            <View>
              <Text style={styles.summaryLabel}>TOTAL VALUE</Text>
              <Text style={[styles.summaryValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>{formatCurrency(totalPortfolioValue, 'USD')}</Text>
            </View>
            {quarter && (
              <View style={[styles.quarterBadge, { backgroundColor: isDark ? '#333' : '#f0f2f5' }]}>
                <Text style={[styles.quarterText, { color: isDark ? '#8e8e93' : '#666' }]}>{quarter}</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {loading ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color="#FF3B30" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchFilings}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filings}
          renderItem={renderItem}
          keyExtractor={(item, index) => index.toString()}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={<View style={{ height: 40 }} />}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  fixedHeader: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  titleSection: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#8e8e93',
    fontWeight: '600',
    marginTop: 2,
  },
  summaryCard: {
    padding: 24,
    borderRadius: 28,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#8e8e93',
    letterSpacing: 1,
    marginBottom: 8,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -1,
  },
  quarterBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  quarterText: {
    fontSize: 11,
    fontWeight: '800',
  },
  listContent: {
    paddingHorizontal: 20,
  },
  holdingCard: {
    padding: 20,
    borderRadius: 24,
    marginBottom: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '900',
  },
  nameSection: {
    flex: 1,
    marginLeft: 16,
  },
  issuerName: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  allocationBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  allocationText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#007AFF',
  },
  changeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  changeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  detailItem: {
    gap: 4,
  },
  detailLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#8e8e93',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  errorText: {
    fontSize: 16,
    color: '#8e8e93',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 24,
    fontWeight: '600',
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 14,
  },
  retryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default HoldingsScreen;