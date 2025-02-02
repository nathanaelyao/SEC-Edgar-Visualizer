import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import Svg, { G, Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Animated, Easing } from 'react-native';
import BarGraph from './barChart'; // Import the BarGraph component

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

  useEffect(() => {
    const fetchStockData = async () => {
      try {
        const info = await getStockInfo(stockSymbol);
        setStockInfo(info);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchStockData();
  }, [stockSymbol]);

  const getStockInfo = async (ticker: string) => {
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

      for (const key in tickersData) {
        if (tickersData[key].ticker === ticker) {
          compName = tickersData[key].title;
          const numberStr = tickersData[key].cik_str.toString();
          const numZeros = 10 - numberStr.length;
          cik_str = "0".repeat(numZeros) + numberStr;
          break;
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
      const epsData = factsData?.facts?.['us-gaap']?.EarningsPerShareBasic?.units?.['USD/shares'];
      const eps = epsData ? epsData[epsData.length - 1]?.val : null;

      const graphData: Record<string, number>[] = [];
      let seen = []
      if (epsData) {
        let count = 1;
        while (count <= epsData.length - 1 && graphData.length < 10) {
          const item = epsData[epsData.length - count];
        //   console.log(item)
          if (item.fy && !seen.includes(item.fy)){
            console.log('heeere')
            seen.push(item.fy)
            graphData.push({ label: item.fy, value: item.val });
            console.log(graphData, 'dmkdlsfl')
          }
          count += 1;

        }
      }

      return { companyName: compName, cik: cik_str, eps, graphData };
    } catch (error) {
      console.error("Error fetching stock info:", error);
      return { companyName: null, cik: null, eps: null, graphData: [] };
    }
  };

  const screenWidth = 325;
  const AnimatedRect = Animated.createAnimatedComponent(Rect);

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
          toValue: data[index].value * scale,
          duration: 1000,
          easing: Easing.elastic(1),
          useNativeDriver: false,
        })
      ));

      Animated.stagger(100, animations).start();
    }
  }, [stockInfo, animatedHeights]);

  const handleBarPress = (value) => {
    setSelectedValue(value);
  };

  const renderGraph = () => {
    if (!stockInfo || !stockInfo.graphData || stockInfo.graphData.length === 0) {
        console.log(stockInfo)
        return <Text>No graph data available.</Text>; 
    }

    const data = stockInfo.graphData.slice(0, 10);
    const barWidth = screenWidth / data.length;
    const maxValue = Math.max(...data.map(item => item.value));
    const scale = maxValue === 0 ? 10 : 170 / maxValue;
    const graphHeight = 200;
    const labelOffset = barWidth / 2;

    console.log(data, barWidth, graphHeight,'data')

    return (
    <View>
      <BarGraph data={data} /> {/* Pass the data as a prop */}
    </View>
    );
  };

  return (
    <View style={styles.container}>
      {loading && <ActivityIndicator size="large" color="#0000ff" />}
      {error && <Text style={styles.errorText}>{error}</Text>}
      {stockInfo && (
        <View>
          <Text style={styles.title}>{stockInfo.companyName || "Company Name Not Found"}</Text>
          <Text>Ticker: {stockSymbol}</Text>
          <Text>EPS: {stockInfo.eps || "EPS Not Found"}</Text>
          {renderGraph()}

          {selectedValue && <Text>Selected Value: {selectedValue}</Text>}
        </View>
      )}
    </View>
  );
};
const styles = StyleSheet.create({
    card: {
      width: 350,
      backgroundColor: '#FFFFFF',
      borderRadius: 8,
      elevation: 6,
      shadowColor: '#000',
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
      padding: 20,
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





    // container: {
    //     flex: 1,
    //     justifyContent: 'center',
    //     alignItems: 'center',
    //     padding: 20,
    //   },
      title: {
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