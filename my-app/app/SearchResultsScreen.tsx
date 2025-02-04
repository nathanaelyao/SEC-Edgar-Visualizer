import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ScrollView} from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { Animated, Easing } from 'react-native';
import BarGraph from './barChart'; // Import the BarGraph component
import { Dropdown } from 'react-native-element-dropdown';
import cheerio from 'react-native-cheerio'; // Import cheerio
import { XMLParser } from 'fast-xml-parser';

type RootStackParamList = {
  SearchResultsScreen: { stockSymbol: string };
};
interface Investor {
    name: string;
    institution: string;
    cik: string;
  }
const SearchResultsScreen: React.FC = () => {
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
    const [totalPortfolioValue, setTotalPortfolioValue] = useState(0);

  const route = useRoute<RouteProp<RootStackParamList, 'SearchResultsScreen'>>();
  const { stockSymbol } = route.params;
  const [stockInfo, setStockInfo] = useState<{ companyName: string | null; cik: string | null; eps: string | null; graphData: Record<string, number>[] | null; epsData: string | null;revData: string | null;incomeData: string | null;assetsData: string | null;sharesData: string | null;} | null>(null);
  const [quarter, setQuarter] = useState<string | null>(null); // New state for the quarter
  const [previousFilings, setPreviousFilings] = useState<any[]>([]); // State for previous filings
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedValue, setSelectedValue] = useState(null);
  const [animatedHeights, setAnimatedHeights] = useState<Animated.Value[]>([]);
  const [filterType, setFilterType] = useState('net income');
  const [investorInfo, setInvestorInfo] = useState<Record<string, number|string>[] | null>(null);
  const [dropdownOptions, setDropdownOptions] = useState<any[]>([]); // State for dropdown options
  const [filings, setFilings] = useState<any[]>([]);
  useEffect(() => {
    const fetchStockData = async () => {

    const invData = await getInvestorInfo(investorsData)
    setInvestorInfo(invData)
};

fetchStockData();
}, [stockInfo?.companyName]);


  useEffect(() => {
    const fetchStockData = async () => {
      try {
        const info = await getStockInfo(stockSymbol, filterType);
        setStockInfo(info);

        const availableOptions = [];
        if (info?.incomeData) availableOptions.push({ label: 'Net Income', value: 'net income' });
        if (info?.epsData) availableOptions.push({ label: 'Earnings Per Share (EPS)', value: 'eps' });
        if (info?.revData) availableOptions.push({ label: 'Revenue', value: 'revenue' });
        if (info?.assetsData) availableOptions.push({ label: 'Assets', value: 'assets' });
        if (info?.sharesData) availableOptions.push({ label: 'Shares Outstanding', value: 'shares Outstanding' });
        setDropdownOptions(availableOptions);
 
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchStockData();
  }, [stockSymbol, filterType]);
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
const calculatePercentage = (value: number): string => {
    if (totalPortfolioValue === 0 || isNaN(value)) {
        return "0.00%"; // Or handle the case as you see fit
    }
    const percentage = (value / totalPortfolioValue) * 100;
    return percentage.toFixed(2) + "%";
};
const formatNumberWithCommas = (number: any): string => {
    if (number === undefined || number === null) {
      return "N/A";
    }
    const n = typeof number === 'string' ? parseFloat(number) : number; // Convert string to number
    return n.toLocaleString(); // Use toLocaleString for commas
  };
  const getInvestorInfo = async(invData:Investor[] ) =>{
    try{
        let invesDict: Record<string, number|string>[] = [];
        for(const investor of invData){
            console.log(`${investor.name} (${investor.institution})`);
            const apiUrl = `https://data.sec.gov/submissions/CIK${investor.cik}.json`; // Example CIK, replace as needed
            const response = await fetch(apiUrl);
            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
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
          const primaryDocument =  recentFilings.primaryDocument[i];
          const filename = primaryDocument.substring(primaryDocument.lastIndexOf('/') + 1);
          if ( formType == '13F-HR' && first) {
            first = false;
    

            const filingDateObj = new Date(filingDate);
            const month = filingDateObj.getMonth() + 1; // Month is 0-indexed
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
            setQuarter(quarterString); 
            getHoldings(accessionNumber, data.cik).then(holdings => {
              const combinedHoldings = combineSameIssuer(holdings)
              for (const holding in combinedHoldings){

                if (combinedHoldings[holding].nameOfIssuer.split(' ')[0].toUpperCase() == stockInfo.companyName.split(' ')[0].toUpperCase()){
                    const totalValue = combinedHoldings.reduce((sum, item) => sum + parseFloat(item.value), 0);
                    setTotalPortfolioValue(totalValue);
                    invesDict.push({ name: investor.name, numShares: combinedHoldings[holding].shrsOrPrnAmt?.sshPrnamt, value:combinedHoldings[holding].value, percent: calculatePercentage(parseFloat(combinedHoldings[holding].value))});
                }
              }
            //   const sortedHoldings = sortHoldingsByValue(combinedHoldings);
              setFilings(combinedHoldings || []);
       
            });
            
          }
          else if (formType == '13F-HR' && second) {  // Fetch the *previous* 13F-HR
            second = false;
            console.log(`Second 13F-HR: ${accessionNumber}`);
            await getHoldings(accessionNumber, data.cik).then(previousHoldings => {
                // console.log(previousHoldings,'prevvvv')
              setPreviousFilings(combineSameIssuer(previousHoldings)); // Store previous holdings
            });
            break; // Stop after finding the second 13F-HR
          }
        }
      } else {
        console.log("No recent filings found.");
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
    //   console.log(tickersData)
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
            // if (similairTitles.length == 1){
            compName = similairTitles[0].title;
            const numberStr = similairTitles[0].cik_str.toString();
            const numZeros = 10 - numberStr.length;
            cik_str = "0".repeat(numZeros) + numberStr;
            // }
            // else{
            //     console.log("oh no")
            // }
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

      let graphData: Record<string, number>[] = [];
      let currentData = ""
      let epsData = ""
      let revData = ""
      let incomeData = ""
      let assetsData = ""
      let sharesData = ""

      sharesData=factsData?.facts?.['dei']?.EntityCommonStockSharesOutstanding.units.shares

      epsData = factsData?.facts?.['us-gaap']?.EarningsPerShareBasic?.units?.['USD/shares'];
      revData = factsData?.facts?.['us-gaap']?.RevenueFromContractWithCustomerExcludingAssessedTax?.units?.['USD'];
      assetsData = factsData?.facts?.['us-gaap']?.Assets?.units?.['USD'];

      incomeData = factsData?.facts?.['us-gaap']?.NetIncomeLoss?.units?.['USD'];

      if (filter == 'eps'){
         currentData = epsData
      }
      else if (filter == "revenue"){
        currentData = revData

    }

      else if (filter == "net income"){
        currentData = incomeData

    }
      else if (filter == 'dividends'){
        epsData = factsData?.facts?.['us-gaap']?.PaymentsOfDividends?.units?.['USD'];
      }
      else if (filter == 'assets'){
      currentData = assetsData
    } else if (filter === 'Free Cash Flow') { // New filter type
        epsData = factsData?.facts?.['us-gaap']?.FreeCashFlow?.units?.['USD']; 
        // console.log(Object.keys(factsData?.facts?.['us-gaap']), 'data')
      }
      else if (filter == "shares Outstanding"){
        currentData = sharesData
    }

//RevenueFromContractWithCustomerExcludingAssessedTax
      if (currentData){

        
        let seen = []
            let count = 1;
            while (count <= currentData.length - 1 && graphData.length < 10) {
            const item = currentData[currentData.length - count];

            if (item.fp && item.fy && item.fp == "FY" ){

        
                let val = 0
                if (item.val > 0){
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



      return { companyName: compName, cik: cik_str, graphData, epsData, revData, incomeData, assetsData, sharesData };
    } catch (error) {
      console.error("Error fetching stock info:", error);
      return { companyName: null, cik: null, eps: null, graphData: [] };
    }
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
        return <Text style={styles.noDataText}>No EPS data available. {"\n"}
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
              value={filterType}
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
          <Text style={styles.graphTitle}>{filterType.toUpperCase()} Over Time</Text>
          {renderGraph()}

          {selectedValue && <Text>Selected Value: {selectedValue}</Text>}
                    {/* Investor Info Card */}
        {investorInfo && investorInfo.length > 0 && (

        <View style={styles.investorInfoCard}>
            <Text style={styles.cardTitle}>Investor Holdings</Text> {/* Card Title */}
              <View>
                {investorInfo.map((investor, index) => (
                  <View key={index} style={styles.investorItem}> {/* Individual investor item */}
                    <Text style={styles.investorName}>{investor.name}</Text>
                    <View style={styles.holdingDetails}>
                      <Text>Shares: {formatNumberWithCommas(investor.numShares)}</Text>
                      <Text>Value: ${formatNumberWithCommas(investor.value)}</Text>
                      <Text>Percentage of Portfolio: {investor.percent}</Text>
                    </View>
                  </View>
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