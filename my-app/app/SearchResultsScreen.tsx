// SearchResultsScreen.js
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Dimensions } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import  BarChart  from 'react-native-chart-kit';
interface EPSData {
    accn: string;
    end: string;
    filed: string;
    form: string;
    fp: string;
    frame?: string;
    fy: number;
    start: string;
    val: number;
  }
type RootStackParamList = {
  SearchResultsScreen: { stockSymbol: string };
};

const SearchResultsScreen: React.FC = () => {
  const route = useRoute<RouteProp<RootStackParamList, 'SearchResultsScreen'>>();
  const { stockSymbol } = route.params;
  const [stockInfo, setStockInfo] = useState<{ companyName123: string | null; cik: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyName123, setCompanyName] = useState<string | null>(null);
  const [cik, setCik] = useState<string | null>(null);
  const [eps, setEPS] = useState<string | null>(null);
  const [latestEPS, setLatestEPS] = useState<string | null>(null);

  useEffect(() => {
    const fetchStockData = async () => {
      try {
        const info = await getStockInfo(stockSymbol);
        setStockInfo(info);
        console.log(companyName123, 'info')
        console.log(eps, 'info')

      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchStockData();
  }, [stockSymbol]);

  const getStockInfo = async (ticker: string) => {
    console.log(ticker, 'ticker')
    try {
    //   const response = await fetch(
    //     `https://www.sec.gov/cgi-bin/browse-edgar?CIK=&owner=exclude&match=1&filenum=&company=&dateb=&datea=&formtype=10-K&count=100&ticker=${ticker}`
    //   );
      const response = await fetch(
        `https://www.sec.gov/files/company_tickers.json`
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      let cik_str = ""
      let compName = ""
      console.log(data)
      for (const key in data) {
        if (data[key].ticker == ticker){
            console.log(data[key].title)
            compName = data[key].title
            setCompanyName(compName || "")

            const numberStr = data[key].cik_str.toString();
            const numZeros = 10 - numberStr.length;
            cik_str =  "0".repeat(numZeros) + numberStr;
        }

      }
      console.log(companyName123, cik_str)
      const response2 = await fetch(
        `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik_str}.json`
      );
      const data2 = await response2.json();
    //   console.log( Object.keys(data2['facts']['us-gaap'].EarningsPerShareBasic.units))
    //   console.log(data2['facts']['us-gaap'].EarningsPerShareBasic.units)
      
    
      setEPS(data2['facts']['us-gaap'].EarningsPerShareBasic.units)

    //   console.log(eps,'eps')




    //   console.log(eps['USD/shares'][eps['USD/shares'].length - 1],'eps')
    //   const epsData = eps['USD/shares']
    //   const latestEPSData = epsData[epsData.length - 1]

    //   setLatestEPS(latestEPSData.val)


      return { compName, cik_str };
    } catch (error) {
      console.error("Error fetching stock info:", error);
      return { companyName: null, cik: null };
    }
  };

  const data123 = {

    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [
      {
        data: [20, 45, 28, 80, 99, 43],
        color: (opacity = 1) => `rgba(134, 65, 244, ${opacity})`, // Purple color
      },
      { // Example of a second dataset
        data: [15, 30, 50, 60, 80, 30],
        color: (opacity = 1) => `rgba(255, 99, 132, ${opacity})`, // Red color
      },
    ],
  };

  const screenWidth = Dimensions.get('window').width; // Get screen width for responsiveness

  const chartConfig = {
    backgroundGradientFrom: '#fff', // Background color
    backgroundGradientFromOpacity: 0,
    backgroundGradientTo: '#fff',
    backgroundGradientToOpacity: 0,
    color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`, // Bar and label color
    strokeWidth: 2, // optional, default 3
    barPercentage: 0.5, // Adjust bar width (0-1)
    borderRadius: 5,  // Round bar corners
    useShadowColorFromDataset: false, // Optional, use dataset color for shadow
    // ... other chart config options (see react-native-chart-kit docs)
    propsForDots: {
        r: "0" //remove dots
    }

  };

  return (
    <View style={styles.container}>
      {loading && <ActivityIndicator size="large" color="#0000ff" />}
      {error && <Text style={styles.errorText}>{error}</Text>}
      {stockInfo && (
        <View>
          <Text style={styles.title}>{companyName123 || "Company Name Not Found"}</Text>
          <Text>Ticker: {stockSymbol}</Text>
           {/* Add more information here as needed */}
        </View>
      )}
            {/* <BarChart
        data={data123}
        width={screenWidth - 20} // Chart width (margin of 10 on each side)
        height={220}
        yAxisLabel="$" // Optional y-axis label
        yAxisSuffix="k" // Optional y-axis suffix
        chartConfig={chartConfig}
        verticalLabelRotation={30} // Rotate x-axis labels if needed
        fromZero // Start y-axis from 0
        showBarTops = {true} //show number in the bar
        style={{
          marginVertical: 8,
          borderRadius: 16,
        }}
      /> */}
    </View>
  );
};
const EPSDisplay: React.FC<{ data: EPSData[] }> = ({ data }) => {

    const getLatestEPS = (yearData: EPSData[]): number | null => {
      if (!yearData || yearData.length === 0) return null;
      yearData.sort((a, b) => new Date(b.end) - new Date(a.end));
      return yearData[0].val;
    };
  
    const epsByYear: { [year: number]: EPSData[] } = {};
    data.forEach(item => {
      const fy = item.fy;
      if (!epsByYear[fy]) {
        epsByYear[fy] = [];
      }
      epsByYear[fy].push(item);
    });
  
    const years = Object.keys(epsByYear).map(Number).sort((a, b) => b - a);
    const lastTenYears = years.slice(0, 10);
  
    const tableData = lastTenYears.map(year => ({
      year,
      eps: getLatestEPS(epsByYear[year])?.toFixed(2) || "N/A",
    }));
  
    return (
      <ScrollView horizontal={true}> {/* Enables horizontal scrolling if needed */}
        <View style={styles.table}>
          <View style={styles.row}>
            <Text style={[styles.header, styles.cell]}>Year</Text>
            <Text style={[styles.header, styles.cell]}>EPS</Text>
          </View>
          {tableData.map((item, index) => (
            <View key={index} style={styles.row}>
              <Text style={styles.cell}>{item.year}</Text>
              <Text style={styles.cell}>{item.eps}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  };
const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20, // Add some padding
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10, // Add margin bottom
  },
  errorText: {
    color: 'red',
    marginTop: 10,
  },
});

export default SearchResultsScreen;