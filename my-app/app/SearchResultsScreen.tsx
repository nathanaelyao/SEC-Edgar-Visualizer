import React, { useState, useEffect,useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ScrollView, Button} from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { Animated, Easing } from 'react-native';
import BarGraph from './barChart'; // Import the BarGraph component
import { Dropdown } from 'react-native-element-dropdown';
import {investorsData} from './investors'
import { useNavigation } from '@react-navigation/native';
import * as SQLite from 'expo-sqlite';
const DB_NAME = 'stock_data.db';
const TABLE_NAME = 'investor_info123';
type RootStackParamList = {
  SearchResultsScreen: { stockSymbol: string };
};
interface Investor {
    name: string;
    institution: string;
    cik: string;
  }
const SearchResultsScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'SearchResultsScreen'>>();
  const { stockSymbol } = route.params;
  const [stockInfo, setStockInfo] = useState<{ companyName: string | null; cik: string | null; eps: string | null; graphData: Record<string, number>[] | null; epsData: string | null;revData: string | null;incomeData: string | null;assetsData: string | null;sharesData: string | null;} | null>(null);
  const [quarter, setQuarter] = useState<string | null>(null); // New state for the quarter
  const [previousFilings, setPreviousFilings] = useState<any[]>([]); // State for previous filings
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedValue, setSelectedValue] = useState(null);
  const [animatedHeights, setAnimatedHeights] = useState<Animated.Value[]>([]);
//   const [filterType, setFilterType] = useState('net income');
  const [investorInfo, setInvestorInfo] = useState<Record<string, number|string>[] | null>(null);
  const [dropdownOptions, setDropdownOptions] = useState<any[]>([]); // State for dropdown options
  const [filings, setFilings] = useState<any[]>([]);
  const [filterType, setFilterType] = useState<string | null>(null); // Initially null
  const [dataLoaded, setDataLoaded] = useState(false); // New state variable
  const firstRender = useRef(true);
  const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);
  const [data, setData] = useState([]);
  const [hasRun, setHasRun] = useState(false);
  const intervalId = useRef(null);
  const someConditionToCheck = () => {
    const fetchData = async () => {
        const dbInstance = await SQLite.openDatabaseAsync(DB_NAME);
        setDb(dbInstance);
        const rows = await dbInstance.getAllAsync(`SELECT * FROM ${TABLE_NAME}`);
        setFilings(JSON.parse(rows[0].investor_holdings) || []); 
        // console.log(JSON.parse(rows[0].investor_holdings), rows.length>0, 'rws')
        if (rows.length>0){
            console.log('here')
            return true
        }
        return false
     }
    const success = fetchData();
    return success
  };
  useEffect(() => {
    if (!hasRun) {
      intervalId.current = setInterval(() => {
        // Your code to run here
        console.log("Code running...");

        // Check if the condition to stop the interval is met (e.g., successful execution)
        const success = someConditionToCheck(); // Replace with your actual condition

        if (success) {
          clearInterval(intervalId.current);
          setHasRun(true);
          console.log("Code finished successfully. Interval stopped.");
        } else {
          console.log("Code did not complete successfully yet.  Will retry.");
        }

      },50); 
    }

    return () => {
      clearInterval(intervalId.current); // Clear interval on unmount or if hasRun becomes true
      if (hasRun) {
        console.log("Component unmounted or hasRun is now true. Interval cleared.");
      } else {
        console.log("Component unmounted before successful run, interval cleared.");
      }
    };
  }, [hasRun]);


  useEffect(() => {
    const fetchStockData = async () => {

        const invData = await getInvestorInfo(investorsData)

        setInvestorInfo(invData)
    };

    fetchStockData();
    }, [stockInfo?.companyName, filings]);

useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false; // Set to false after the first render
      const timer = setTimeout(() => {
        setDataLoaded(true); 
      }, 50);

      return () => clearTimeout(timer); // Clear the timer if the component unmounts
    }
  }, []);

  useEffect(() => {
    const fetchStockData = async () => {
      try {
        const info = await getStockInfo(stockSymbol, filterType);
        setStockInfo(info);
        // console.log(info.sharesData, 'info')

        const availableOptions = [];
        if (info?.revData) availableOptions.push({ label: 'Revenue', value: 'revenue' });
        if (info?.incomeData) availableOptions.push({ label: 'Net Income', value: 'net income' });
        if (info?.epsData) availableOptions.push({ label: 'Earnings Per Share (EPS)', value: 'eps' });
        if (info?.assetsData) availableOptions.push({ label: 'Assets', value: 'assets' });
        if (info?.liabilities) availableOptions.push({ label: 'Liabilities', value: 'liabilities' });
        if (info?.incomeData) availableOptions.push({ label: 'ROIC', value: 'roic' });
        if (info?.sharesData) availableOptions.push({ label: 'Shares Outstanding', value: 'shares Outstanding' });
        setDropdownOptions(availableOptions);

        // Set default filter type *after* data is fetched and options are available
        if (!filterType && availableOptions.length > 0) {
          setFilterType(availableOptions[0].value); // Set to the first option
        }
 
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchStockData();
  }, [stockSymbol, filterType, dataLoaded]);
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

const formatNumberWithCommas = (number: any): string => {
    if (number === undefined || number === null) {
      return "N/A";
    }
    const n = typeof number === 'string' ? parseFloat(number) : number; // Convert string to number
    return n.toLocaleString(); // Use toLocaleString for commas
  };
  function getRetryDelay(response: Response): number {
    // Check for Retry-After header (recommended by SEC)
    const retryAfterHeader = response.headers.get('Retry-After');
    if (retryAfterHeader) {
      const retryAfter = parseInt(retryAfterHeader, 10);
      if (!isNaN(retryAfter)) {
        return retryAfter * 1000; // Convert to milliseconds
      }
    }
  
    const backoffFactor = 2; 
    const maxBackoff = 60000; 
  
    let currentDelay = 1000; 
    return Math.min(currentDelay * backoffFactor, maxBackoff);
  }
  const getInvestorInfo = async(invData:Investor[] ) =>{
    // const delayBetweenRequests = 300; // milliseconds - adjust as needed
    // console.log(filings,'ehehehhe')
    let combinedHoldings = null
    try{
        let invesDict: Record<string, number|string>[] = [];
        for(const investor of invData){
            // await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
            for (const dict of filings) {
               if (investor.name == dict.name){
                combinedHoldings = dict.holdings
                let totalValue = 0
                if(combinedHoldings){
                    totalValue = combinedHoldings.reduce((sum, item) => sum + parseFloat(item.value || 0), 0); // Handle potential missing values
                }
                for (const holding in combinedHoldings){
                    const specialCharsRegex = /[^\w\s]/g; // Matches anything that's NOT a word character or whitespace
                    let name = combinedHoldings[holding].nameOfIssuer
                    name = name.replace(specialCharsRegex, "");
                    let currName = stockInfo.companyName
                    currName = currName.replace(specialCharsRegex, "");
                    if (name.split(' ').length > 1 && currName.split(' ')[0].toUpperCase().length > 1){
                        if ((name.split(' ')[0].toUpperCase() == currName.split(' ')[0].toUpperCase()) && (name.split(' ')[1].toUpperCase() == currName.split(' ')[1].toUpperCase())){
                            let percent123 = ""
                            if (totalValue === 0 || isNaN(combinedHoldings[holding].value)) {
                                percent123= "0.00%"; // Or handle the case as you see fit
                            }
                            const percentage = (combinedHoldings[holding].value / totalValue) * 100;
                            percent123 =  percentage.toFixed(2) + "%";
                            invesDict.push({ cik: investor.cik, institution: investor.institution,name: investor.name, numShares: combinedHoldings[holding].shrsOrPrnAmt?.sshPrnamt, value:combinedHoldings[holding].value, percent: percent123});
                        }
                    }
                    else{
                        if (name.split(' ')[0].toUpperCase() == currName.split(' ')[0].toUpperCase()){
                            let percent123 = ""
                            if (totalValue === 0 || isNaN(combinedHoldings[holding].value)) {
                                percent123= "0.00%"; // Or handle the case as you see fit
                            }
                            const percentage = (combinedHoldings[holding].value / totalValue) * 100;
                            percent123 =  percentage.toFixed(2) + "%";
                            invesDict.push({ name: investor.name, numShares: combinedHoldings[holding].shrsOrPrnAmt?.sshPrnamt, value:combinedHoldings[holding].value, percent: percent123});
                        }
                    }
                }
               }

            }

            
     

 
         
        };
        console.log(invesDict, 'dict')
        setInvestorInfo(invesDict)
        return invesDict
    }
    catch (error) {
        console.error("Error fetching investor info:", error);
      }

  }

  const getStockInfo = async (ticker: string, filter: string) => {
    try {
      const tickersResponse = await fetch(
        `https://www.sec.gov/files/company_tickers.json`
      );
      if (!tickersResponse.ok) {
        throw new Error(`HTTP error! status: ${tickersResponse.status}`);
      }

      const tickersData = await tickersResponse.json();
      let cik_str = "";
      let compName = "";
      let similairTitles = []
      for (const key in tickersData) {
        let finalTicker = ""
        let splitTicker = ticker.split(" ")
        if (splitTicker.length >= 2){
            finalTicker += splitTicker[0] + ' ' + splitTicker[1]
        }
        else{
            finalTicker = splitTicker[0]
        }
        if (tickersData[key].ticker.toUpperCase() === ticker.toUpperCase()) {

          compName = tickersData[key].title;
          const numberStr = tickersData[key].cik_str.toString();
          const numZeros = 10 - numberStr.length;
          cik_str = "0".repeat(numZeros) + numberStr;
          break;
        }
        else if (tickersData[key].title.toUpperCase().startsWith(finalTicker.toUpperCase()) ){
            similairTitles.push(tickersData[key])
        }
      }
      if (!cik_str){
        if (similairTitles[0]){
            compName = similairTitles[0].title;
            const numberStr = similairTitles[0].cik_str.toString();
            const numZeros = 10 - numberStr.length;
            cik_str = "0".repeat(numZeros) + numberStr;

        }
      }

      if (!cik_str) {
        throw new Error(`Ticker ${ticker} not found.`);
      }
      const factsResponse = await fetch(
        `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik_str}.json`
      );

      if (!factsResponse.ok) {
        throw new Error(`HTTP error! status: ${factsResponse.status} for CIK: ${cik_str}`);
      }
      const factsData = await factsResponse.json();

      let currentData = ""
      let epsData = ""
      let revData = ""
      let incomeData = ""
      let assetsData = ""
      let sharesData = ""
      let dividendData = ""
      let currentLiabilities = ""
      let roicData = ""
      let skip = false
      sharesData=factsData?.facts?.['dei']?.EntityCommonStockSharesOutstanding.units.shares
      epsData = factsData?.facts?.['us-gaap']?.EarningsPerShareBasic?.units?.['USD/shares'];
      revData = factsData?.facts?.['us-gaap']?.RevenueFromContractWithCustomerExcludingAssessedTax?.units?.['USD'];
      assetsData = factsData?.facts?.['us-gaap']?.Assets?.units?.['USD'];
      incomeData = factsData?.facts?.['us-gaap']?.NetIncomeLoss?.units?.['USD'];
      dividendData = factsData?.facts?.['us-gaap']?.PaymentsOfDividends?.units?.['USD'];
      currentLiabilities = factsData.facts['us-gaap'].LiabilitiesCurrent.units.USD
      if (currentLiabilities && assetsData && incomeData){
        roicData = "placeholder"

    }

      if (filter == 'eps'){
         currentData = epsData
      }
      else if (filter == 'liabilities'){
        currentData = currentLiabilities
      }
      else if (filter == "revenue"){
        currentData = revData
      }
      else if (filter == "net income"){
        currentData = incomeData
     }
      else if (filter == 'dividends'){
        currentData = dividendData
    }
      else if (filter == 'assets'){
      currentData = assetsData
    } else if (filter === 'Free Cash Flow') { // New filter type
        epsData = factsData?.facts?.['us-gaap']?.FreeCashFlow?.units?.['USD']; 
      }
      else if (filter == "shares Outstanding"){
        currentData = sharesData
     } 
     else if (filter == "roic"){
        if (currentLiabilities && assetsData && incomeData){
            const liabilities = getInfo(currentLiabilities)
            const assets = getInfo(assetsData)
            const income = getInfo(incomeData)
            let investedCapital = getIntersectionAndSumByLabel(assets, liabilities, '-')
            
            roicData = getIntersectionAndSumByLabel(income, investedCapital, '/')
            graphData = roicData
            skip = true
        }
    }

      if (!skip){
        graphData = getInfo(currentData)
      }

      return { roicData: roicData, liabilities: currentLiabilities, companyName: compName, cik: cik_str, graphData, epsData, revData, incomeData, assetsData, sharesData };
    } catch (error) {
      console.error("Error fetching stock info:", error);
      return { companyName: null, cik: null, eps: null, graphData: [] };
    }
  };
  function getIntersectionAndSumByLabel(arr1: any[], arr2: any[], operator: string): any[] {
    const intersection: any[] = [];
    const labelMap = new Map<any, number>(); // Store labels and their sums
  
    arr1.forEach(item => {
      labelMap.set(item.label, item.value);
    });
  
    arr2.forEach(item => {
      if (labelMap.has(item.label) && labelMap.get(item.label) > 0) {
        if (operator == '-'){
            labelMap.set(item.label, labelMap.get(item.label) - item.value); // Add values
        }
        else if (operator == '/'){
            labelMap.set(item.label, ((labelMap.get(item.label) / item.value) * 100) ); // Divide values
        }
      } 
  
    });
  
    labelMap.forEach((value, label) => {
      intersection.push({ label, value });
    });
  
    return intersection;
  }
  const getInfo = (currentData: Record<string, number>[]): Record<string, number>[] => {
    let graphData: Record<string, number>[] = [];

    if (currentData){
        let seen = []
        let count = 1;
        while (count <= currentData.length - 1 && graphData.length < 10) {
        const item = currentData[currentData.length - count];

        if (item.fp && item.fy && item.fp == "FY" ){

    
            let val = 1
            if (item.val > 1){
                val = item.val
            }

            if (item.start && item.end){
                const date1 = new Date(item.start);
                const date2 = new Date(item.end);
                
                // Calculate the difference in months
                const diffInMonths =
                Math.abs((date2.getFullYear() - date1.getFullYear()) * 12 +
                    (date2.getMonth() - date1.getMonth())) > 10;
                
                if (diffInMonths && (!seen.includes(item.fy))){
                    seen.push(item.fy)

                    graphData.push({ label: item.fy, value: val });

                }
            }
            else{
                if (!seen.includes(item.fy)){
                    seen.push(item.fy)
                    graphData.push({ label: item.fy, value: val });
                }

            }

            // }

        }
        count += 1;

        }
    }
    return graphData
  };
  useEffect(() => {
    if (stockInfo && stockInfo.graphData && stockInfo.graphData[filterType]) { // Check for current filter data
      setGraphData(stockInfo.graphData[filterType]);
    }
  }, [stockInfo, filterType]);
  useEffect(() => {
    if (stockInfo && stockInfo.graphData && stockInfo.graphData.length > 0) {
      const data = stockInfo.graphData.slice(0, 10);
      const maxValue = Math.max(...data.map(item => item.value));
      const scale = maxValue === 0 ? 10 : 170 / maxValue;

      if (animatedHeights.length === 0 || animatedHeights.length !== data.length) {
        setAnimatedHeights(data.map(() => new Animated.Value(0)));
      }

      const animations = animatedHeights.map((animatedHeight, index) => (
        Animated.timing(animatedHeight, {
          toValue: data[index]?.value * scale,
          duration: 1000,
          easing: Easing.elastic(1),
          useNativeDriver: false,
        })
      ));

      Animated.stagger(100, animations).start();
    }
  }, [stockInfo, animatedHeights]);



  const renderGraph = () => {
    if (!stockInfo || !stockInfo.graphData || stockInfo.graphData.length === 0) {
        // console.log(stockInfo)
        return <Text style={styles.noDataText}>No data available. {"\n"}
            Please choose another option using the dropdown.</Text>; 
    }

    const data = stockInfo.graphData.slice(0, 10);

    // console.log(data,'data')

    return (
    <View style={styles.card}>
      <BarGraph data={data.reverse()} /> {/* Pass the data as a prop */}
    </View>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.scrollViewContent}> {/* Wrap with ScrollView */}

    <View style={styles.container}>
      {loading && <ActivityIndicator size="large" color="#0000ff" />}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {stockInfo && (
        <View>
        <Text style={styles.title}>
        {stockInfo.companyName && stockInfo.companyName.length > 25
            ? stockInfo.companyName.slice(0, 25) + "\n" + stockInfo.companyName.slice(25)
            : stockInfo.companyName || "Company Name Not Found"}
        </Text>
          <Text>Ticker: {stockSymbol}</Text>
          <View style={styles.dropdownContainer}>
          <Dropdown
              style={styles.dropdown}
              placeholder="Select item"
              data={dropdownOptions} // Use the dynamically generated options
              labelField="label"
              valueField="value"
              value={filterType}  // Now controlled by state
              onChange={item => {
                setFilterType(item.value);
              }}
              renderItem={(item) => (
                <Text style={styles.dropdownItem}>{item.label}</Text>
              )}
              disabled={dropdownOptions.length === 0} // Disable if no options
            />
            {dropdownOptions.length === 0 && <Text style={styles.noDataText}>No data available for selected ticker.</Text>}
          </View>
          {filterType && <Text style={styles.graphTitle}>{filterType.toUpperCase()} Over Time</Text>}
          {renderGraph()}

          {selectedValue && <Text>Selected Value: {selectedValue}</Text>}
                    {/* Investor Info Card */}
        
        
        {!investorInfo && (
          <View style={styles.loadingContainer}> {/* Container for alignment */}
            <ActivityIndicator size="small" color="#0000ff" />
            <Text style={styles.loadingText}>Loading 13F Info</Text>
          </View>
        )}
        {investorInfo && investorInfo.length > 0 && (

        <View style={styles.investorInfoCard}>
            <Text style={styles.cardTitle}>Investor Holdings</Text> {/* Card Title */}
              <View>
                {investorInfo.sort((a, b) => {
        const percentA = parseFloat(a.percent); // Parse percentage string to number
        const percentB = parseFloat(b.percent); // Parse percentage string to number
        return percentB - percentA; // Descending order: largest percentage first
      }).
                
                map((investor, index) => (
                  <TouchableOpacity key={index} style={styles.investorItem}
                  onPress={() => {
                    navigation.navigate('HoldingsScreen', {
                        investorName: investor.name,
                        institution: investor.institution,
                        cik: investor.cik,                    });
                  }}
                  
                  > {/* Individual investor item */}
                    <Text style={styles.investorName}>{investor.name}</Text>
                    <View style={styles.holdingDetails}>
                      <Text>Shares: {formatNumberWithCommas(investor.numShares)}</Text>
                      <Text>Value: ${formatNumberWithCommas(investor.value)}</Text>
                      <Text>Percentage of Portfolio: {investor.percent}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>

          </View>
        )}
        </View>
      )}
    </View>
    </ScrollView>

  );
};
const styles = StyleSheet.create({
    investorInfoCard: {
        marginTop: 20,
        width: 350,
        backgroundColor: 'white',
        borderRadius: 8,
        padding: 16,
        elevation: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        marginBottom:20
      },
      cardTitle: { // Style for the card title
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 8,
      },
      loadingContainer: {
        flexDirection: 'row', // Align items horizontally
        alignItems: 'center',  // Vertically center items
        marginTop: 20,         // Add some top margin
      },
      loadingText: {
        marginLeft: 10,      // Space between indicator and text
        fontSize: 16,        // Adjust text size
      },
      invLoading: { // Style for the card title
        marginTop: 20,
      },
      investorItem: { // Style for each investor item
        marginBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
        paddingBottom: 8,
      },
      investorName: { // Style for the investor name
        fontWeight: 'bold',
      },
      holdingDetails: {
        marginLeft: 16, // Indent the details
      },

      noDataText: {
    color: 'gray',
    fontSize: 13,      // Adjust font size
    fontStyle: 'italic', // Make it italic (optional)
    textAlign: 'center', // Center text (important)
    paddingHorizontal: 10, // Add some horizontal padding
  },
    graphTitle: {
        marginTop:30,

        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 10, // Space between title and graph
        textAlign: 'center', // Center the title
    },
    card: {
        // marginTop:50,
    },
    container: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    labels: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 5,
      marginTop: 5,
      position: 'absolute',
      width: 100,
      top: 210,
    },
    label: {
      textAlign: 'center',
      fontSize: 14,
      fontFamily: 'Arial, sans-serif',
      position: 'absolute',
    },
    valueDisplay: {
      position: 'absolute',
      top: -10,
      left: 0,
      width: '100%',
      alignItems: 'flex-start',
      justifyContent: 'center',
      padding: 5,
    },
    valueText: {
      fontSize: 20,
      fontWeight: 'bold',
      color: '#007AFF',
    },


    dropdownContainer: {
        marginBottom: 20,
        marginTop: 20,
        width: 250, // or however wide you want it
        borderWidth: 1,
        borderColor: 'gray',
        borderRadius: 8,
      },
      dropdown: {
        height: 50,
        backgroundColor: 'white',
        paddingHorizontal: 8,
      },
      dropdownItem: { // Style for the dropdown items
        padding: 10,
        fontSize: 16,
      },
    //   graphTitle: {
    //     marginTop: 20, // Adjust as needed
    //     fontSize: 18,
    //     fontWeight: 'bold',
    //     marginBottom: 10,
    //     textAlign: 'center',
    //   },

    // container: {
    //     flex: 1,
    //     justifyContent: 'center',
    //     alignItems: 'center',
    //     padding: 20,
    //   },
      title: {
        marginTop:50,
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 10,
      },
      errorText: {
        color: 'red',
        marginTop: 10,
      },
  
  });


export default SearchResultsScreen;