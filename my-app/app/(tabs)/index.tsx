import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Dimensions, TouchableWithoutFeedback, Keyboard, ScrollView, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
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
        style={[styles.investorCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#f0f0f0' }]}
        onPress={() => {
          navigation.navigate('HoldingsScreen', {
            investorName: item.name,
            institution: item.institution,
            cik: item.cik,
          });
        }}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.avatar, { backgroundColor: isDark ? '#333' : '#f0f2f5' }]}>
            <Text style={[styles.avatarText, { color: isDark ? '#fff' : '#007AFF' }]}>{getInitials(item.name)}</Text>
          </View>
          <View style={styles.nameSection}>
            <Text style={[styles.investorName, { color: isDark ? '#fff' : '#1a1a1a' }]} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.institutionName} numberOfLines={1}>{item.institution}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={24} color={isDark ? '#444' : '#ccc'} />
        </View>

        {hasFiling && (
          <View style={styles.cardFooter}>
            <View style={[styles.filingBadge, { backgroundColor: isDark ? 'rgba(0,122,255,0.1)' : 'rgba(0,122,255,0.05)' }]}>
              <MaterialIcons name="history" size={14} color="#007AFF" style={{ marginRight: 4 }} />
              <Text style={styles.filingDateText}>{filing.date}</Text>
            </View>
            <View style={[styles.quarterBadge, { backgroundColor: isDark ? 'rgba(52,199,89,0.1)' : 'rgba(52,199,89,0.05)' }]}>
              <Text style={styles.quarterText}>{filing.quarter}</Text>
            </View>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#f8f9fa' }]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View>
            <Text style={[styles.title, { color: isDark ? '#fff' : '#1a1a1a' }]}>13F Filings</Text>
            <Text style={styles.subtitle}>Track top institutional investors</Text>
          </View>
          <TouchableOpacity
            style={[styles.iconButton, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#eee' }]}
            onPress={() => navigation.navigate('portfolio')}
          >
            <Ionicons name="pie-chart-outline" size={24} color="#007AFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.controlsRow}>
          <View style={[styles.searchContainer, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#eee' }]}>
            <Ionicons name="search" size={18} color={isDark ? '#666' : '#999'} style={{ marginRight: 10 }} />
            <TextInput
              style={[styles.searchInput, { color: isDark ? '#fff' : '#000' }]}
              placeholder="Search investors..."
              placeholderTextColor={isDark ? '#666' : '#999'}
              onChangeText={setSearchQuery}
              value={searchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color={isDark ? '#444' : '#ccc'} />
              </TouchableOpacity>
            )}
          </View>

          <Dropdown
            data={sortOptions}
            style={[styles.dropdown, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#eee' }]}
            placeholderStyle={[styles.dropdownPlaceholder, { color: isDark ? '#666' : '#999' }]}
            selectedTextStyle={[styles.dropdownSelectedText, { color: isDark ? '#fff' : '#1a1a1a' }]}
            containerStyle={[styles.dropdownContainer, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#eee' }]}
            labelField="label"
            valueField="value"
            value={value}
            onFocus={() => setIsFocus(true)}
            onBlur={() => setIsFocus(false)}
            onChange={handleSortChange}
            renderItem={item => (
              <View style={[styles.dropdownItem, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderBottomColor: isDark ? '#333' : '#f0f0f0' }]}>
                <Text style={[styles.dropdownItemText, { color: isDark ? '#fff' : '#1a1a1a' }]}>{item.label}</Text>
                {item.value === value && <MaterialIcons name="check" size={18} color="#007AFF" />}
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
  title: {
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -1,
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
    borderRadius: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  dropdown: {
    height: 52,
    borderRadius: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
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
    borderRadius: 16,
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
    paddingBottom: 40,
  },
  investorCard: {
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