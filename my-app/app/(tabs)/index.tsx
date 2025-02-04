import React, { useState,useEffect,useRef } from 'react';
import { View, Text, TextInput, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, Button } from 'react-native';
import { useNavigation } from '@react-navigation/native'; // Import navigation hook
import { LogBox } from 'react-native';
import * as SQLite from 'expo-sqlite';
import cheerio from 'react-native-cheerio'; // Import cheerio
import {investorsData} from '../investors'
import { XMLParser } from 'fast-xml-parser';

const DB_NAME = 'stock_data.db';
const TABLE_NAME = 'investor_info123';
LogBox.ignoreAllLogs(); // Suppress *all* warnings

interface Investor {
  name: string;
  institution: string;
  cik: string;
}
const Home: React.FC = () => {
  const [searchText, setSearchText] = useState('');
  const navigation = useNavigation(); // Initialize navigation
  const firstRender = useRef(true);
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

      $('a').each(function () {  // Use Cheerio's each function
          const href = $(this).attr('href'); // Use Cheerio's attr function
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
      return []; // Return empty array in case of error
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
    const seen = new Set<string>(); // Keep track of seen issuer names

    for (const item of holdings) {
        if (!item?.nameOfIssuer || !item?.shrsOrPrnAmt?.sshPrnamt || !item?.value) continue; // Skip if data is missing.

        const issuer = item.nameOfIssuer;
        const shares = parseFloat(item.shrsOrPrnAmt.sshPrnamt);
        const value = parseFloat(item.value);
        if (seen.has(issuer)) {
            // Find existing item and add shares and value.
            const existingItem = combined.find(h => h.nameOfIssuer === issuer);
            if (existingItem) {
                existingItem.shrsOrPrnAmt.sshPrnamt = (parseFloat(existingItem.shrsOrPrnAmt.sshPrnamt) + shares).toString(); // Add shares. Convert to string
                existingItem.value = (parseFloat(existingItem.value) + value).toString(); // Add value. Convert to string
            }
        } else {
            // Deep copy the item to avoid modifying the original holdings
            const newItem = JSON.parse(JSON.stringify(item));
            combined.push(newItem);
            seen.add(issuer);
        }
    }
    return combined;
};
  const getInvestorInfo = async(invData:Investor[] ) =>{
    const delayBetweenRequests = 300; // milliseconds - adjust as needed
    let allHoldings = []
    try{
        for(const investor of invData){
            await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));

            console.log(`${investor.name} (${investor.institution})`);
            const apiUrl = `https://data.sec.gov/submissions/CIK${investor.cik}.json`; // Example CIK, replace as needed
            const response = await fetch(apiUrl);      
            const data = await response.json();
            const recentFilings = data.filings.recent;
            if (recentFilings) {
                let first = true;
                for (let i = 0; i < recentFilings.accessionNumber.length; i++) {
                const accessionNumber = recentFilings.accessionNumber[i];
                const filingDate = recentFilings.filingDate[i];
                const formType = recentFilings.form[i];
                if ( formType == '13F-HR' && first) {
                    first = false;
                    const filingDateObj = new Date(filingDate);

                    getHoldings(accessionNumber, data.cik).then(holdings => {
                    const combinedHoldings = combineSameIssuer(holdings)
                    let totalValue = 0
                    if(combinedHoldings){
                        totalValue = combinedHoldings.reduce((sum, item) => sum + parseFloat(item.value || 0), 0); // Handle potential missing values
                    
                    }
                    allHoldings.push({"name":investor.name, "holdings": combinedHoldings})

   
                    //   const sortedHoldings = sortHoldingsByValue(combinedHoldings);
            
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
      firstRender.current = false; // Set to false after the first render
      fetchStockData();
    }
    }, [db]);
  useEffect(() => {
    const insertData = async () => {
        if (db) {
            let jsonString = ""
            console.log(investorInfo, 'invinfo')
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
//   useEffect(() => {
//     const fetchData = async () => {
//         if (db) {
//             const rows = await db.getAllAsync(`SELECT * FROM ${TABLE_NAME}`);
//             setData(rows);
//         }
//     }
//     fetchData();
// }, [db])
  useEffect(() => {
    const initializeDatabase = async () => {
      try {
        const dbInstance = await SQLite.openDatabaseAsync(DB_NAME);
        setDb(dbInstance);
//            id INTEGER PRIMARY KEY AUTOINCREMENT,

        await dbInstance.execAsync(`
          PRAGMA journal_mode = WAL;
          CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
            investor_holdings TEXT 
          );
        `);

        console.log("Database and table created/opened successfully!");

        // Example: Insert some initial data (optional)
        // await dbInstance.execAsync(`
        //   INSERT OR REPLACE INTO ${TABLE_NAME} (tic ker, company_name) VALUES ('AAPL', 'Apple Inc.');
        // `);

      } catch (error) {
        console.error("Error initializing database:", error);
      }
    };

    initializeDatabase();
  }, []); // Empty dependency array ensures this runs only once


  const handleSearch = () => {
    if (searchText) { // Check if search text is not empty
      console.log("Searching for:", searchText);
      navigation.navigate('SearchResultsScreen', { stockSymbol: searchText }); // Navigate and pass data
      setSearchText(''); // Clear the search bar after search (optional)
    } else {
      // Handle empty search (e.g., show an alert)
      alert("Please enter a stock symbol.");
    }
  };

  return (


    <SafeAreaView style={styles.safeArea}>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
      >

        <View style={styles.content}>
          <Text style={styles.title}>Stock Search</Text>
          <TextInput
            style={styles.searchBar}
            placeholder="Enter stock symbol (e.g., AAPL, MSFT)"
            placeholderTextColor="#aaa"
            onChangeText={setSearchText}
            value={searchText}
            autoCapitalize="characters"
            returnKeyType="search"
            onSubmitEditing={handleSearch} // Call search function on "Enter"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {

    flex: 1,
    justifyContent: 'flex-start', // Align to the top
    alignItems: 'center',
    padding: 20,
  },
  content: {
    width: '100%',
    maxWidth: 400,
    marginTop: '45%', // 45% of the screen height
  },
  title: {
    marginTop: 70,
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
    textAlign: 'center',
  },
  searchBar: {
    height: 50,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 15,
    fontSize: 16,
    backgroundColor: '#f8f8f8',
    color: '#333',
  },
});

export default Home
