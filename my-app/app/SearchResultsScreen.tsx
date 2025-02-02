import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import Svg, { G, Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Animated, Easing } from 'react-native';

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
      if (epsData) {
        let length = epsData.length;
        let count = 1;
        while (length > 0 && count <= 10) {
          const item = epsData[epsData.length - count];
          if (!item.frame.includes('Q') && !item.frame.includes('q')){
            graphData.push({ label: item.frame, value: item.val });
            count += 1;
          }
          length -= 1;

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
      return <Text>No graph data available.</Text>; 
    }

    const data = stockInfo.graphData.slice(0, 10);
    const barWidth = screenWidth / data.length;
    const maxValue = Math.max(...data.map(item => item.value));
    const scale = maxValue === 0 ? 10 : 170 / maxValue;
    const graphHeight = 200;

    console.log(data, barWidth, graphHeight,'data')

    return (
      <Svg height={graphHeight + 20} width={screenWidth}>
        <Defs>
          <LinearGradient id="grad" x1="0" y1="0" x2="0" y2="100%">
            <Stop offset="0" stopColor="#6a11cb" />
            <Stop offset="1" stopColor="#2575fc" />
          </LinearGradient>
        </Defs>
        <G>
          {data.map((item, index) => (
            <TouchableOpacity key={item.label} onPress={() => handleBarPress(item.value)}>
              <AnimatedRect
                x={index * (barWidth + 12)}
                y={animatedHeights[index]?.interpolate({
                  inputRange: [0, item.value * scale],
                  outputRange: [graphHeight, graphHeight - item.value * scale],
                })}
                width={barWidth}
                height={animatedHeights[index]}
                fill="url(#grad)"
                rx="4"
                opacity={selectedValue === item.value ? 1 : 0.7}
              />
            </TouchableOpacity>
          ))}
        </G>
      </Svg>
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
          <Text>CIK: {stockInfo.cik || "CIK Not Found"}</Text>
          {renderGraph()}

          <Text>EPS: {stockInfo.eps || "EPS Not Found"}</Text>
          {selectedValue && <Text>Selected Value: {selectedValue}</Text>}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
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