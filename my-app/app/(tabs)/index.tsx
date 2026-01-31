import React, { useState, useEffect, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Dimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Dropdown } from 'react-native-element-dropdown';
import { investorsData } from '@/constants/investors'
import * as SQLite from 'expo-sqlite';
import cheerio from 'react-native-cheerio';
import { XMLParser } from 'fast-xml-parser';
import { secFetch } from '@/utils/secApi';
import { debug, info, warn, error as logError } from '@/utils/logger';
import { getPortfolio, PortfolioHolding } from '@/utils/db';

interface Investor {
  name: string;
  institution: string;
  cik: string;
}

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filteredInvestors, setFilteredInvestors] = useState<Investor[]>(investorsData);
  const [filingDates, setFilingDates] = useState<Record<string, { date: string; quarter: string }>>({});
  const [loading, setLoading] = useState(true);
  const firstRender = useRef(true);
  const [sortType, setSortType] = useState('recent');
  const [value, setValue] = useState(null);
  const [isFocus, setIsFocus] = useState(false);


  // Initialize daily prefetch for popular endpoints on app startup
  useEffect(() => {
    const { scheduleDailyPrefetch } = require('@/utils/secApi');

    // Prefetch the most popular investor CIK submissions (top 10 by activity)
    const popularEndpoints = investorsData.slice(0, 10).map(
      investor => `https://data.sec.gov/submissions/CIK${investor.cik}.json`
    );

    // Schedule daily prefetch and store cleanup function
    const cleanup = scheduleDailyPrefetch(popularEndpoints);

    return cleanup; // cleanup on unmount
  }, []);

  useEffect(() => {

    if (firstRender.current) {
      firstRender.current = false;
    }
  },);



  useEffect(() => {
    const fetchFilingDates = async () => {
      const dates: Record<string, { date: string; quarter: string }> = {};
      try {
        const promises = investorsData.map(async (investor) => {
          try {
            const response = await secFetch(`https://data.sec.gov/submissions/CIK${investor.cik}.json`, { priority: true });

            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }

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
                  if (month >= 1 && month <= 3) {
                    quarterString = "Q4 " + (filingDateObj.getFullYear() - 1);
                  } else if (month >= 4 && month <= 6) {
                    quarterString = "Q1 " + filingDateObj.getFullYear();
                  } else if (month >= 7 && month <= 9) {
                    quarterString = "Q2 " + filingDateObj.getFullYear();
                  } else if (month >= 10 && month <= 12) {
                    quarterString = "Q3 " + filingDateObj.getFullYear();
                  }
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

    // Immediately prioritize fetching filing dates for the list view
    fetchFilingDates();
    // Defer heavy investor holdings fetch until filing dates are loaded and user interacts
    // (getInvestorInfo will still be used elsewhere on demand)
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

        const dateObjA = new Date(dateA);
        const dateObjB = new Date(dateB);
        return dateObjB.getTime() - dateObjA.getTime();
      });
    }

    const filtered = sortedInvestors.filter(investor => {
      const lowerCaseQuery = searchQuery.toLowerCase();
      const lowerCaseName = investor.name.toLowerCase();
      const lowerCaseInstitution = investor.institution.toLowerCase();

      return (
        lowerCaseName.includes(lowerCaseQuery) ||
        lowerCaseInstitution.includes(lowerCaseQuery)
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

    // Collapse dropdown after a short delay (ensures re-render sync)
    setTimeout(() => setIsFocus(false), 50);
  };


  const renderItem = ({ item }: { item: Investor }) => (
    <TouchableOpacity
      style={styles.investorItem}
      onPress={() => {
        navigation.navigate('HoldingsScreen', {
          investorName: item.name,
          institution: item.institution,
          cik: item.cik,
        });
      }}
    >
      <View style={styles.investorNameContainer}>
        <Text style={styles.investorName}>{item.name}</Text>
        <Text style={styles.filingInfo}>
          {filingDates[item.cik]?.date} ({filingDates[item.cik]?.quarter})
        </Text>
      </View>
      <Text style={styles.institutionName}>{item.institution}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Institutional 13Fs</Text>
      <TextInput
        style={styles.searchBar}
        placeholder="Search by name or institution"
        placeholderTextColor="gray"
        onChangeText={setSearchQuery}
        value={searchQuery}
      />

      <Dropdown
        data={sortOptions}
        style={[styles.dropdown, isFocus && { borderColor: 'blue' }]}
        placeholderStyle={styles.placeholderStyle}
        selectedTextStyle={styles.selectedTextStyle}
        inputSearchStyle={styles.inputSearchStyle}
        iconStyle={styles.iconStyle}
        labelField="label"
        valueField="value"
        placeholder={!isFocus ? 'Most Recent Filings' : '...'}
        searchPlaceholder="Search..."
        onFocus={() => setIsFocus(true)}
        onBlur={() => setIsFocus(false)}
        value={value}
        onChange={(item) => {
          setValue(item.value);
          setSortType(item.value);
          setIsFocus(false); // ensures dropdown closes
        }}
        renderItem={item => (
          <TouchableOpacity onPress={() => handleSortChange(item)} style={styles.item}>
            <Text style={styles.itemText}>{item.label}</Text>
          </TouchableOpacity>
        )}
      />

      {loading ? (
        <ActivityIndicator size="large" color="#0000ff" />
      ) : (
        <FlatList
          data={filteredInvestors}
          renderItem={renderItem}
          keyExtractor={(item) => item.cik}
        />
      )}
    </View>
  );
};


const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CONTAINER_PADDING = SCREEN_WIDTH > 600 ? 32 : 16;
const CARD_WIDTH = SCREEN_WIDTH - (CONTAINER_PADDING * 2);

const styles = StyleSheet.create({
  dropdown: {
    height: 48,
    borderColor: '#e0e0e0',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 20,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  label: {
    position: 'absolute',
    backgroundColor: 'white',
    left: 22,
    top: 8,
    zIndex: 999,
    paddingHorizontal: 8,
    fontSize: 14,
  },
  placeholderStyle: {
    fontSize: 16,
    color: '#9e9e9e',
  },
  selectedTextStyle: {
    fontSize: 16,
    color: '#1a1a1a',
    fontWeight: '500',
  },
  inputSearchStyle: {
    height: 40,
    fontSize: 16,
  },
  iconStyle: {
    width: 20,
    height: 20,
  },
  clickedItemText: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: 'bold',
  },
  item: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  itemText: {
    fontSize: 16,
    color: '#333',
  },
  container: {
    // marginTop: SCREEN_WIDTH > 600 ? 100 : 80,
    flex: 1,
    padding: CONTAINER_PADDING,
    marginBottom: 70,
    backgroundColor: '#f8f9fa',
  },
  title: {
    fontSize: SCREEN_WIDTH > 600 ? 32 : 28,
    fontWeight: '700',
    marginBottom: 24,
    textAlign: 'center',
    color: '#1a1a1a',
    letterSpacing: -0.5,
  },
  searchBar: {
    height: 48,
    borderColor: '#e0e0e0',
    borderWidth: 1.5,
    marginBottom: 20,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    fontSize: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  investorItem: {
    backgroundColor: '#ffffff',
    padding: 18,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  investorNameContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  investorName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    flex: 1,
  },
  filingInfo: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
    marginLeft: 8,
  },
  institutionName: {
    fontSize: 14,
    color: '#757575',
    marginTop: 2,
  },
});

export default HomeScreen;