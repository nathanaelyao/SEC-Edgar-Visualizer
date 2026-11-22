import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Dimensions, TouchableWithoutFeedback, Keyboard, ScrollView, Platform } from 'react-native';
import { useNavigation } from 'expo-router';
import { useRouter } from 'expo-router';
import { Dropdown } from 'react-native-element-dropdown';
import { investorsData } from '@/constants/investors'
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { secFetch } from '@/utils/secApi';
import { error as logError } from '@/utils/logger';
import { useTheme } from '@/context/ThemeContext';

interface Investor {
  name: string;
  institution: string;
  cik: string;
}

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { isDark } = useTheme();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filteredInvestors, setFilteredInvestors] = useState<Investor[]>(investorsData);
  const [filingDates, setFilingDates] = useState<Record<string, { date: string; quarter: string }>>({});
  const [loading, setLoading] = useState(true);
  const [sortType, setSortType] = useState('recent');
  const [value, setValue] = useState('recent');
  const [isFocus, setIsFocus] = useState(false);

  // Initialize daily prefetch for popular endpoints on app startup
  useEffect(() => {
    const { scheduleDailyPrefetch } = require('@/utils/secApi');
    const popularEndpoints = investorsData.slice(0, 10).map(
      investor => `https://data.sec.gov/submissions/CIK${investor.cik}.json`
    );
    const cleanup = scheduleDailyPrefetch(popularEndpoints);
    return cleanup;
  }, []);

  useEffect(() => {
    const fetchFilingDates = async () => {
      const dates: Record<string, { date: string; quarter: string }> = {};
      try {
        const promises = investorsData.map(async (investor) => {
          try {
            const response = await secFetch(`https://data.sec.gov/submissions/CIK${investor.cik}.json`, { priority: true });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            const recentFilings = data.filings.recent;
            if (recentFilings) {
              let first = true;
              for (let i = 0; i < recentFilings.accessionNumber.length; i++) {
                const filingDate = recentFilings.filingDate[i];
                const formType = recentFilings.form[i];
                if (formType === '13F-HR' && first) {
                  first = false;
                  const filingDateObj = new Date(filingDate);
                  const month = filingDateObj.getMonth() + 1;
                  let quarterString = "";
                  if (month >= 1 && month <= 3) quarterString = "Q4 " + (filingDateObj.getFullYear() - 1);
                  else if (month >= 4 && month <= 6) quarterString = "Q1 " + filingDateObj.getFullYear();
                  else if (month >= 7 && month <= 9) quarterString = "Q2 " + filingDateObj.getFullYear();
                  else if (month >= 10 && month <= 12) quarterString = "Q3 " + filingDateObj.getFullYear();

                  return { cik: investor.cik, date: filingDate, quarter: quarterString };
                }
              }
            }
            return { cik: investor.cik, date: data.filingDate || 'N/A', quarter: data.filingQuarter || 'N/A' };
          } catch (err) {
            logError(`Error fetching filing date for ${investor.name}:`, err);
            return { cik: investor.cik, date: 'N/A', quarter: 'N/A' };
          }
        });

        const results = await Promise.all(promises);
        results.forEach((result) => {
          dates[result.cik] = { date: result.date, quarter: result.quarter };
        });
        setFilingDates(dates);
      } finally {
        setLoading(false);
      }
    };
    fetchFilingDates();
  }, []);

  useEffect(() => {
    let sortedInvestors = [...investorsData];

    if (sortType === 'alphabetical') {
      sortedInvestors.sort((a, b) => {
        const firstNameA = a.name.split(' ')[0].toLowerCase();
        const firstNameB = b.name.split(' ')[0].toLowerCase();
        return firstNameA.localeCompare(firstNameB);
      });
    } else if (sortType === 'recent') {
      sortedInvestors.sort((a, b) => {
        const dateA = filingDates[a.cik]?.date || 'N/A';
        const dateB = filingDates[b.cik]?.date || 'N/A';
        if (dateA === 'N/A') return 1;
        if (dateB === 'N/A') return -1;
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      });
    }

    const filtered = sortedInvestors.filter(investor => {
      const lowerCaseQuery = searchQuery.toLowerCase();
      return (
        investor.name.toLowerCase().includes(lowerCaseQuery) ||
        investor.institution.toLowerCase().includes(lowerCaseQuery)
      );
    });

    setFilteredInvestors(filtered);
  }, [searchQuery, sortType, filingDates]);

  const sortOptions = [
    { label: 'Most Recent Filings', value: 'recent' },
    { label: 'Alphabetical', value: 'alphabetical' },
  ];

  const handleSortChange = (item: any) => {
    setValue(item.value);
    setSortType(item.value);
    setTimeout(() => setIsFocus(false), 50);
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  };

  const renderItem = ({ item }: { item: Investor }) => {
    const filing = filingDates[item.cik];
    const hasFiling = filing && filing.date !== 'N/A';

    return (
      <TouchableOpacity
        style={[styles.investorCard, { backgroundColor: isDark ? '#131E32' : '#FFFFFF', borderColor: isDark ? '#1E2E4A' : '#E8EEF5' }]}
        onPress={() => {
          navigation.navigate('HoldingsScreen', {
            investorName: item.name,
            institution: item.institution,
            cik: item.cik,
          });
        }}
        activeOpacity={0.8}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.avatar, { backgroundColor: isDark ? 'rgba(92, 157, 255, 0.15)' : '#EEF5FD' }]}>
            <Text style={[styles.avatarText, { color: isDark ? '#9ED7ED' : '#8DCBE2' }]}>{getInitials(item.name)}</Text>
          </View>
          <View style={styles.nameSection}>
            <Text style={[styles.investorName, { color: isDark ? '#F8FAFC' : '#0F172A' }]} numberOfLines={1}>{item.name}</Text>
            <Text style={[styles.institutionName, { color: isDark ? '#94A3B8' : '#64748B' }]} numberOfLines={1}>{item.institution}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={24} color={isDark ? '#64748B' : '#94A3B8'} />
        </View>

        {hasFiling && (
          <View style={styles.cardFooter}>
            <View style={[styles.filingBadge, { backgroundColor: isDark ? 'rgba(92, 157, 255, 0.15)' : '#EEF5FD' }]}>
              <MaterialIcons name="history" size={14} color={isDark ? '#9ED7ED' : '#8DCBE2'} style={{ marginRight: 4 }} />
              <Text style={[styles.filingDateText, { color: isDark ? '#9ED7ED' : '#8DCBE2' }]}>{filing.date}</Text>
            </View>
            <View style={[styles.quarterBadge, { backgroundColor: isDark ? 'rgba(52, 211, 153, 0.15)' : '#DCFCE7' }]}>
              <Text style={[styles.quarterText, { color: isDark ? '#34D399' : '#10B981' }]}>{filing.quarter}</Text>
            </View>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#0B1220' : '#F4F7FB' }]}>
      <View style={styles.header}>

        <View style={styles.titleRow}>
          <View>
            <View style={[styles.headerPill, { backgroundColor: isDark ? 'rgba(92, 157, 255, 0.15)' : '#EEF5FD' }]}>
              <Ionicons name="documents-outline" size={13} color={isDark ? '#9ED7ED' : '#8DCBE2'} style={{ marginRight: 5 }} />
              <Text style={[styles.headerPillText, { color: isDark ? '#9ED7ED' : '#8DCBE2' }]}>INSTITUTIONAL FILINGS</Text>
            </View>
            <Text style={[styles.title, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>13F Filings</Text>
            <Text style={[styles.subtitle, { color: isDark ? '#94A3B8' : '#64748B' }]}>Track top institutional investors</Text>
          </View>
          <TouchableOpacity
            style={[styles.iconButton, { backgroundColor: isDark ? '#131E32' : '#FFFFFF', borderColor: isDark ? '#1E2E4A' : '#E2E8F0' }]}
            onPress={() => navigation.navigate('portfolio')}
          >
            <Ionicons name="pie-chart" size={22} color={isDark ? '#9ED7ED' : '#8DCBE2'} />
          </TouchableOpacity>
        </View>

        <View style={styles.controlsRow}>
          <View style={[styles.searchContainer, { backgroundColor: isDark ? '#131E32' : '#FFFFFF', borderColor: isDark ? '#1E2E4A' : '#E2E8F0' }]}>
            <Ionicons name="search" size={18} color={isDark ? '#9ED7ED' : '#8DCBE2'} style={{ marginRight: 10 }} />
            <TextInput
              style={[styles.searchInput, { color: isDark ? '#F8FAFC' : '#0F172A' }]}
              placeholder="Search investors or institutions..."
              placeholderTextColor={isDark ? '#64748B' : '#94A3B8'}
              onChangeText={setSearchQuery}
              value={searchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color={isDark ? '#64748B' : '#94A3B8'} />
              </TouchableOpacity>
            )}
          </View>

          <Dropdown
            data={sortOptions}
            style={[styles.dropdown, { backgroundColor: isDark ? '#131E32' : '#FFFFFF', borderColor: isDark ? '#1E2E4A' : '#E2E8F0' }]}
            placeholderStyle={[styles.dropdownPlaceholder, { color: isDark ? '#64748B' : '#94A3B8' }]}
            selectedTextStyle={[styles.dropdownSelectedText, { color: isDark ? '#F8FAFC' : '#0F172A' }]}
            containerStyle={[styles.dropdownContainer, { backgroundColor: isDark ? '#131E32' : '#FFFFFF', borderColor: isDark ? '#1E2E4A' : '#E2E8F0' }]}
            labelField="label"
            valueField="value"
            value={value}
            onFocus={() => setIsFocus(true)}
            onBlur={() => setIsFocus(false)}
            onChange={handleSortChange}
            renderItem={item => (
              <View style={[styles.dropdownItem, { backgroundColor: isDark ? '#131E32' : '#FFFFFF', borderBottomColor: isDark ? '#1E2C44' : '#F1F5F9' }]}>
                <Text style={[styles.dropdownItemText, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>{item.label}</Text>
                {item.value === value && <MaterialIcons name="check" size={18} color={isDark ? '#9ED7ED' : '#8DCBE2'} />}
              </View>
            )}
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      ) : (
        <FlatList
          data={filteredInvestors}
          renderItem={renderItem}
          keyExtractor={(item) => item.cik}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={() => Keyboard.dismiss()}
        />
      )}
    </View>
  );
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  headerPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  subtitle: {
    fontSize: 14,
    color: '#8e8e93',
    fontWeight: '600',
    marginTop: 2,
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  controlsRow: {
    gap: 12,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: 20,
    paddingHorizontal: 16,
    borderWidth: 1,
    shadowColor: '#8DCBE2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  dropdown: {
    height: 52,
    borderRadius: 20,
    paddingHorizontal: 16,
    borderWidth: 1,
    shadowColor: '#8DCBE2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  dropdownPlaceholder: {
    fontSize: 14,
    fontWeight: '600',
  },
  dropdownSelectedText: {
    fontSize: 14,
    fontWeight: '700',
  },
  dropdownContainer: {
    borderRadius: 20,
    marginTop: 8,
    overflow: 'hidden',
    borderWidth: 1,
  },
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  dropdownItemText: {
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 110,
  },
  investorCard: {
    padding: 18,
    borderRadius: 22,
    marginBottom: 14,
    borderWidth: 1,
    shadowColor: '#8DCBE2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '900',
  },
  nameSection: {
    flex: 1,
    marginLeft: 14,
  },
  investorName: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  institutionName: {
    fontSize: 13,
    color: '#8e8e93',
    fontWeight: '600',
    marginTop: 2,
  },
  cardFooter: {
    flexDirection: 'row',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
    gap: 8,
  },
  filingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  filingDateText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#007AFF',
  },
  quarterBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  quarterText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#34C759',
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default HomeScreen;