import React, { useState, useEffect, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Dropdown } from 'react-native-element-dropdown';
import {investorsData} from '../investors'
import * as SQLite from 'expo-sqlite';
import cheerio from 'react-native-cheerio'; 
import { XMLParser } from 'fast-xml-parser';

const DB_NAME = 'stock_data.db';
const TABLE_NAME = 'investor_info_new1234';
interface Investor {
  name: string;
  institution: string;
  cik: string;
}

const HomeScreen: React.FC = () => {
  const navigation = useNavigation();
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredInvestors, setFilteredInvestors] = useState(investorsData);
  const [filingDates, setFilingDates] = useState({});
  const [loading, setLoading] = useState(true);
  const firstRender = useRef(true);
  const [sortType, setSortType] = useState('alphabetical');
  const [value, setValue] = useState(null);
  const [isFocus, setIsFocus] = useState(false);
  const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);
  const [data, setData] = useState([]);
  const [investorInfo, setInvestorInfo] = useState<Record<string, number|string>[] | null>(null);
  
  const getHoldings = async (accessionNumber, cik1) => {
    try {
        const accessionNumberNoHyphens = accessionNumber.replace(/-/g, '');
  
        
      const response = await fetch(
        `https://www.sec.gov/Archives/edgar/data/${cik1}/${accessionNumberNoHyphens}/index.html`
      );
 

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.text();
      const $ = cheerio.load(data); 

      const foundFiles: string[] = [];

      $('a').each(function () {  
          const href = $(this).attr('href'); 
          if (href && href.endsWith('.xml')) {
              foundFiles.push(href);
          }
      });

      for (let i = 0; i < foundFiles.length; i++) {
        if (!foundFiles[i].startsWith("primary")){
            const response1 = await fetch(
                `https://www.sec.gov${foundFiles[i]}`
            );
            const data1 = await response1.text();
            const parser = new XMLParser();
            const json = removeNamespace(parser.parse(data1));  
            return json['informationTable']?.infoTable || 
            json['ns1:informationTable']?.['ns1:infoTable'] ||
             [];
                    }
      }
      return [];
      
 // Handle cases where infoTable might be missing
    } catch (error) {
      console.error("Error fetching holdings:", error);
      return []; 
    }
  };

  function removeNamespace(data) {
    if (Array.isArray(data)) {
      return data.map(item => removeNamespace(item));
    } else if (typeof data === 'object' && data !== null) {
      const newData = {};
      for (const key in data) {
        const newKey = key.replace('ns1:', '');
        newData[newKey] = removeNamespace(data[key]);
      }
      return newData;
    } else {
      return data;
    }
  }

  const combineSameIssuer = (holdings: any[]) => {
    let combined = [];
    const seen = new Set<string>(); 

    for (const item of holdings) {
        if (!item?.nameOfIssuer || !item?.shrsOrPrnAmt?.sshPrnamt || !item?.value) continue; // Skip if data is missing.

        const issuer = item.nameOfIssuer;
        const shares = parseFloat(item.shrsOrPrnAmt.sshPrnamt);
        const value = parseFloat(item.value);
        if (seen.has(issuer)) {
            const existingItem = combined.find(h => h.nameOfIssuer === issuer);
            if (existingItem) {
                existingItem.shrsOrPrnAmt.sshPrnamt = (parseFloat(existingItem.shrsOrPrnAmt.sshPrnamt) + shares).toString(); // Add shares. Convert to string
                existingItem.value = (parseFloat(existingItem.value) + value).toString(); // Add value. Convert to string
            }
        } else {
            const newItem = JSON.parse(JSON.stringify(item));
            combined.push(newItem);
            seen.add(issuer);
        }
    }
    return combined;
};
  const getInvestorInfo = async(invData:Investor[] ) =>{
    const delayBetweenRequests = 300; 
    let allHoldings = []
    try{
        for(const investor of invData){
            await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));

            console.log(`${investor.name} (${investor.institution})`);
            const apiUrl = `https://data.sec.gov/submissions/CIK${investor.cik}.json`; 
            const response = await fetch(apiUrl);      
            const data = await response.json();
            const recentFilings = data.filings.recent;
            if (recentFilings) {
                let first = true;
                for (let i = 0; i < recentFilings.accessionNumber.length; i++) {
                const accessionNumber = recentFilings.accessionNumber[i];
                const formType = recentFilings.form[i];
                if ( formType == '13F-HR' && first) {
                    first = false;
                    getHoldings(accessionNumber, data.cik).then(holdings => {
                    const combinedHoldings = combineSameIssuer(holdings)
                    let totalValue = 0
                    if(combinedHoldings){
                       
                      totalValue = combinedHoldings.reduce((sum, item) => sum + parseFloat(item.value || 0), 0); 
                      allHoldings.push({"name":investor.name, "holdings": combinedHoldings})

                    }            
                    });
                    
                }


                }
     
                

            } else {
                console.log("No recent filings found.");
            }

        };
        setInvestorInfo(allHoldings)
        return allHoldings
    }
    catch (error) {
        console.error("Error fetching investor info:", error);
      }

  }
  useEffect(() => {
    const fetchStockData = async () => {

        const invData = await getInvestorInfo(investorsData)

        setInvestorInfo(invData)
    };
    if (firstRender.current) {
      firstRender.current = false; 
      fetchStockData();
    }
    }, [db]);
  useEffect(() => {
    const insertData = async () => {
        if (db) {
            let jsonString = ""
            if (investorInfo.length > 0){
                jsonString = JSON.stringify(investorInfo);
                try{
                  const result = await db.runAsync(`INSERT INTO ${TABLE_NAME} (investor_holdings) VALUES (?)`, jsonString);
  
                  const rows = await db.getAllAsync(`SELECT * FROM ${TABLE_NAME}`);
                  setData(rows);
                  console.log(rows, 'new')
              }
              catch (error){
                  console.log(error, 'error')
              }
            }

    
        }
      }
      insertData(); 
}, [investorInfo])

  useEffect(() => {
    const initializeDatabase = async () => {
      try {
        const dbInstance = await SQLite.openDatabaseAsync(DB_NAME);
        setDb(dbInstance);

        await dbInstance.execAsync(`
          PRAGMA journal_mode = WAL;
          CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
            investor_holdings TEXT 
          );
        `);

        console.log("Database and table created/opened successfully!");

      } catch (error) {
        console.error("Error initializing database:", error);
      }
    };

    initializeDatabase();
  }, []); 
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
        labelField="label"
        valueField="value"
        placeholder={!isFocus ? 'Alphabetical' : '...'}
        searchPlaceholder="Search..."
        onFocus={() => setIsFocus(true)}
        onBlur={() => setIsFocus(false)}
        value={value} 
        onChange={handleSortChange} 
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
        marginTop: 65,
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