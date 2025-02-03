import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { Animated, Easing } from 'react-native';
import BarGraph from './barChart'; // Import the BarGraph component
import { Dropdown } from 'react-native-element-dropdown';

type RootStackParamList = {
  SearchResultsScreen: { stockSymbol: string };
};

const SearchResultsScreen: React.FC = () => {
  const route = useRoute<RouteProp<RootStackParamList, 'SearchResultsScreen'>>();
  const { stockSymbol } = route.params;
  const [stockInfo, setStockInfo] = useState<{ companyName: string | null; cik: string | null; eps: string | null; graphData: Record<string, number>[] | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedValue, setSelectedValue] = useState(null);
  const [animatedHeights, setAnimatedHeights] = useState<Animated.Value[]>([]);
  const [filterType, setFilterType] = useState('revenue');
  const [graphData, setGraphData] = useState<Record<string, number>[] | null>(null);

  useEffect(() => {
    if (stockInfo && stockInfo.graphData) {
      setGraphData(stockInfo.graphData[filterType]);
    }
  }, [stockInfo, filterType]);
  useEffect(() => {
    const fetchStockData = async () => {
      try {
        const info = await getStockInfo(stockSymbol, filterType);
        setStockInfo(info);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchStockData();
  }, [stockSymbol, filterType]);

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
            console.log('here',similairTitles)
            // if (similairTitles.length == 1){
            compName = similairTitles[0].title;
            console.log(compName)
            const numberStr = similairTitles[0].cik_str.toString();
            const numZeros = 10 - numberStr.length;
            cik_str = "0".repeat(numZeros) + numberStr;
            console.log(similairTitles, 'kfdm')
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

      console.log(filter)
      let graphData: Record<string, number>[] = [];
      let epsData = ""
      if (filter == 'eps'){
         epsData = factsData?.facts?.['us-gaap']?.EarningsPerShareBasic?.units?.['USD/shares'];
      }
      else if (filter == "revenue"){
        epsData = factsData?.facts?.['us-gaap']?.RevenueFromContractWithCustomerExcludingAssessedTax?.units?.['USD'];
      }
      else if (filter == "income"){
        epsData = factsData?.facts?.['us-gaap']?.NetIncomeLoss?.units?.['USD'];
        console.log(epsData, 'epsdata')
      }
      else if (filter == 'assets'){
        epsData = factsData?.facts?.['us-gaap']?.Assets?.units?.['USD'];
      } else if (filter === 'Free Cash Flow') { // New filter type
        epsData = factsData?.facts?.['us-gaap']?.FreeCashFlow?.units?.['USD']; 
        // console.log(Object.keys(factsData?.facts?.['us-gaap']), 'data')
      }
      else if (filter == "shares Outstanding"){
        epsData=factsData?.facts?.['dei']?.EntityCommonStockSharesOutstanding.units.shares
      }

//RevenueFromContractWithCustomerExcludingAssessedTax
      if (epsData){

      
        let seen = []
        if (epsData) {
            let count = 1;
            while (count <= epsData.length - 1 && graphData.length < 10) {
            const item = epsData[epsData.length - count];

            //   console.log(item)
            if (item.fp && item.fy && item.fp == "FY" ){
                console.log(item, 'items')
      
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
                  
                    if (diffInMonths){
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
    }



      return { companyName: compName, cik: cik_str, graphData };
    } catch (error) {
      console.error("Error fetching stock info:", error);
      return { companyName: null, cik: null, eps: null, graphData: [] };
    }
  };



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
        return <Text>No graph data available.</Text>; 
    }

    const data = stockInfo.graphData.slice(0, 10);

    console.log(data, 'data')
    // console.log(data,'data')

    return (
    <View style={styles.card}>
      <BarGraph data={data.reverse()} /> {/* Pass the data as a prop */}
    </View>
    );
  };
  const data = [ // Data for the dropdown
    { label: 'Revenue', value: 'revenue' },
    { label: 'Net Income', value: 'income' },
    { label: 'Earnings Per Share (EPS)', value: 'eps' },
    { label: 'Free Cash Flow', value: 'Free Cash Flow' }, // Add free cash flow to dropdown
    { label: 'Shares Outstanding', value: 'shares Outstanding' }, // Add free cash flow to dropdown
    { label: 'Assets', value: 'assets' },

  ];
  return (
    <View style={styles.container}>
      {loading && <ActivityIndicator size="large" color="#0000ff" />}
      {error && <Text style={styles.errorText}>{error}</Text>}
      {stockInfo && (
        <View>
        <Text style={styles.title}>
        {stockInfo.companyName && stockInfo.companyName.length > 25
            ? stockInfo.companyName.slice(0, 25) + "\n" + stockInfo.companyName.slice(15)
            : stockInfo.companyName || "Company Name Not Found"}
        </Text>
          <Text>Ticker: {stockSymbol}</Text>
          <View style={styles.dropdownContainer}>
            <Dropdown
              style={styles.dropdown}
              placeholder="Select item"
              data={data}
              labelField="label"
              valueField="value"
              value={filterType}
              onChange={item => {
                setFilterType(item.value);
              }}
              renderItem={(item) => (
                <Text style={styles.dropdownItem}>{item.label}</Text>
              )}
            />
          </View>
          <Text style={styles.graphTitle}>{filterType.toUpperCase()} Over Time</Text>
          {renderGraph()}

          {selectedValue && <Text>Selected Value: {selectedValue}</Text>}
        </View>
      )}
    </View>
  );
};
const styles = StyleSheet.create({
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