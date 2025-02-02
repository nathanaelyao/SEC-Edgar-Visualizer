import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Dropdown } from 'react-native-element-dropdown';

const investorsData = [
  { name: 'Warren Buffett', institution: "Berkshire Hathaway", cik: '0001067983' },
  { name: 'Bryan Lawrence', institution: "Oakcliff Capital", cik: '0001657335' },
  { name: 'Robert Vinall', institution: "RV Capital", cik: '0001766596' },
  { name: 'Li Lu', institution: "Himalaya Capital", cik: '0001709323' },
  { name: 'Monish Pabrai', institution: "Dalal Street", cik: '0001549575' },
  { name: 'Howard Marks', institution: "Oaktree Capital Management", cik: '0000949509' },
  { name: 'David Tepper', institution: "Appaloosa Management", cik: '0001656456' },
  { name: 'Daily Journal Corp.', institution: "Daily Journal Corp.", cik: '0000783412' },
  { name: 'Tweedy Browne Co.', institution: "Tweedy Browne Value Fund", cik: '0000732905' },
  { name: 'Norbert Lou', institution: "Punch Card Management", cik: '0001631664' },
  { name: 'Chuck Akre', institution: "Akre Capital Management", cik: '0001112520' },
];

const HomeScreen: React.FC = () => {
  const navigation = useNavigation();
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredInvestors, setFilteredInvestors] = useState(investorsData);
  const [filingDates, setFilingDates] = useState({});
  const [loading, setLoading] = useState(true);
  const [sortType, setSortType] = useState('alphabetical');
  const [value, setValue] = useState(null);
  const [isFocus, setIsFocus] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false); // State to control dropdown open/close

  useEffect(() => {
    const fetchFilingDates = async () => {
      const dates = {};
      try {
        const promises = investorsData.map(async (investor) => {
          try {
            const response = await fetch(`https://data.sec.gov/submissions/CIK${investor.cik}.json`);
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
                    quarterString = "Q4 " + filingDateObj.getFullYear();
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
          } catch (error) {
            console.error(`Error fetching filing date for ${investor.name}:`, error);
            return { cik: investor.cik, date: 'N/A', quarter: 'N/A' };
          }
        });

        const results = await Promise.all(promises);
        results.forEach(result => dates[result.cik] = { date: result.date, quarter: result.quarter });
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
    { label: 'Alphabetical', value: 'alphabetical' },
    { label: 'Most Recent Filings', value: 'recent' },
  ];

  const handleSortChange = (item) => {
    setValue(item.value);
    setIsFocus(false);
    setSortType(item.value);
    // setIsDropdownOpen(false); // Close the dropdown list, but keep the component visible

  };

  const renderItem = ({ item }) => (
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
        // maxHeight={isDropdownOpen ? 300 : 0} // Control list height to open/close
        labelField="label"
        valueField="value"
        placeholder={!isFocus ? 'Sort List' : '...'}
        searchPlaceholder="Search..."
        onFocus={() => setIsFocus(true)}
        onBlur={() => setIsFocus(false)}
        value={value} // Bind the value to the component's state
        onChange={handleSortChange} // Use the new handler
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
  clickedItemText: { // Style for the clicked item display
    marginTop: 16,
    fontSize: 16,
    fontWeight: 'bold',
  },
  item: { // Style for each dropdown item
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  itemText: { // Style for the item text
    fontSize: 16,
  },
    container: {
        flex: 1,
        padding: 16,
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
    },
    investorItem: {
        backgroundColor: '#f0f0f0',
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