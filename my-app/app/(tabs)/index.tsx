import React, { useState, useEffect, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Dropdown } from 'react-native-element-dropdown';
import {investorsData} from '../investors'
import * as SQLite from 'expo-sqlite';
import cheerio from 'react-native-cheerio'; 
import { XMLParser } from 'fast-xml-parser';
import { secFetch } from '../utils/secApi';
import { debug, info, warn, error as logError } from '../utils/logger';

interface Investor {
  name: string;
  institution: string;
  cik: string;
}

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filteredInvestors, setFilteredInvestors] = useState<Investor[]>(investorsData);
  const [filingDates, setFilingDates] = useState<Record<string, {date: string; quarter: string}>>({});
  const [loading, setLoading] = useState(true);
  const firstRender = useRef(true);
  const [sortType, setSortType] = useState('recent');
  const [value, setValue] = useState(null);
  const [isFocus, setIsFocus] = useState(false);



  useEffect(() => {

    if (firstRender.current) {
      firstRender.current = false; 
    }
    }, );
    


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
                    quarterString = "Q4 " + (filingDateObj.getFullYear()-1);
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

const styles = StyleSheet.create({
  dropdown: {
    height: 30,
    borderColor: 'gray',
    borderWidth: 0.5,
    borderRadius: 8,
    paddingHorizontal: 8,
    marginBottom: 16,
    backgroundColor: '#fafafa'

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
    color: 'gray',
  },
  selectedTextStyle: {
    fontSize: 16,
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
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  itemText: {
    fontSize: 16,
  },
  container: {
        marginTop: 80,
        flex: 1,
        padding: 16,
        marginBottom:70
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 16,
        textAlign: 'center',
    },
    searchBar: {
        height: 40,
        borderColor: 'gray',
        borderWidth: 1,
        marginBottom: 16,
        paddingHorizontal: 8,
        borderRadius: 5,
        backgroundColor:'#fafafa'
    },
    investorItem: {
        backgroundColor: '#fafafa',
        padding: 16,
        marginBottom: 8,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: '#ddd',
    },
    investorNameContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    investorName: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    filingInfo: {
        fontSize: 12,
        color: 'gray',
    },
    institutionName: {
        fontSize: 14,
        color: 'gray',
    },
});

export default HomeScreen;