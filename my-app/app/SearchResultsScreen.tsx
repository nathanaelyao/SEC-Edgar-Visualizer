import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ScrollView } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { Animated, Easing } from 'react-native';
import BarGraph from './barChart';
import { Dropdown } from 'react-native-element-dropdown';
import { investorsData } from './investors';
import { useNavigation } from '@react-navigation/native';
import { secFetch } from './utils/secApi';
import { debug, info, warn, error as logError } from './utils/logger';
import * as SQLite from 'expo-sqlite';

const DB_NAME = 'stock_data.db';
const TABLE_NAME = 'investor_info_new1234';

type RootStackParamList = {
  SearchResultsScreen: { stockSymbol: string };
  HoldingsScreen: { investorName: string; institution: string; cik: string };
};

interface Investor {
  name: string;
  institution: string;
  cik: string;
}

interface GraphDataItem {
  label: string;
  value: number;
}

interface StockInfo {
  companyName: string | null;
  cik: string | null;
  eps: string | null;
  graphData: GraphDataItem[] | null;
  epsData: string | null;
  revData: string | null;
  incomeData: string | null;
  assetsData: string | null;
  sharesData: string | null;
  liabilities?: string | null;
  roicData?: any[] | null;
}

interface InvestorHolding {
  cik?: string;
  institution?: string;
  name: string;
  numShares?: string;
  value?: string;
  percent?: string;
}

const SearchResultsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'SearchResultsScreen'>>();
  const { stockSymbol } = route.params;
  const [stockInfo, setStockInfo] = useState<StockInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedValue, setSelectedValue] = useState(null);
  const [animatedHeights, setAnimatedHeights] = useState<Animated.Value[]>([]);
  const [investorInfo, setInvestorInfo] = useState<InvestorHolding[] | null>(null);
  const [dropdownOptions, setDropdownOptions] = useState<any[]>([]);
  const [filings, setFilings] = useState<any[]>([]);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const firstRender = useRef(true);
  const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);
  const [graphData, setGraphData] = useState<GraphDataItem[]>([]);
  const headers = {
    'User-Agent': 'SEC_APP (nathanael.yao123@gmail.com)',
    // 'Content-Type': 'application/json'
  };
  const getInvestorHoldings = (): Promise<any[]> => {
    return new Promise(async (resolve, reject) => {
      try {
        const dbInstance = await SQLite.openDatabaseAsync(DB_NAME);
        setDb(dbInstance);
        const rows = await (dbInstance as any).getAllAsync(`SELECT * FROM ${TABLE_NAME}`) as any[];
        if (rows.length > 0 && (rows[0] as any).investor_holdings) {
          try {
            resolve(JSON.parse((rows[0] as any).investor_holdings) || []);
          } catch (e) {
            logError("Error parsing investor holdings:", e);
            reject(e);
          }
        } else {
          resolve([]); // Resolve with an empty array if no data
        }
      } catch (error) {
        logError("Error opening database:", error);
        reject(error);
      }
    });
  };

  useEffect(() => {
    getInvestorHoldings()
      .then((holdingsData) => {
        setFilings(holdingsData);
      })
      .catch((err) => {
        logError("Failed to load investor holdings:", err);
        // Optionally set an error state here if fetching filings fails
      });
  }, []);

  useEffect(() => {
    const fetchInvestorData = async () => {
      if (filings.length > 0 && stockInfo?.companyName) {
        const invData = await getInvestorInfo(investorsData);
        setInvestorInfo(invData);
      }
    };

    fetchInvestorData();
  }, [stockInfo?.companyName, filings]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      const timer = setTimeout(() => {
        setDataLoaded(true);
      }, 50);

      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    const fetchStockData = async () => {
      try {
        const info = await getStockInfo(stockSymbol, filterType);
        setStockInfo(info);
        const availableOptions: { label: string; value: string }[] = [];
        if (info?.revData) availableOptions.push({ label: 'Revenue', value: 'revenue' });
        if (info?.incomeData) availableOptions.push({ label: 'Net Income', value: 'net income' });
        if (info?.epsData) availableOptions.push({ label: 'Earnings Per Share (EPS)', value: 'eps' });
        if (info?.assetsData) availableOptions.push({ label: 'Assets', value: 'assets' });
        if (info?.liabilities) availableOptions.push({ label: 'Liabilities', value: 'liabilities' });
        if (info?.roicData) availableOptions.push({ label: 'ROIC', value: 'roic' });
        if (info?.sharesData) availableOptions.push({ label: 'Shares Outstanding', value: 'shares Outstanding' });
        setDropdownOptions(availableOptions);

        if (!filterType && availableOptions.length > 0) {
          setFilterType(availableOptions[0].value);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchStockData();
  }, [stockSymbol, filterType, dataLoaded]);

  const formatNumberWithCommas = (number: any): string => {
    if (number === undefined || number === null) {
      return "N/A";
    }
    const n = typeof number === 'string' ? parseFloat(number) : number;
    return n.toLocaleString();
  };

  const getInvestorInfo = async (invData: Investor[]): Promise<InvestorHolding[]> => {
    const invesDict: InvestorHolding[] = [];
    for (const investor of invData) {
      for (const dict of filings) {
        if (investor.name === dict.name) {
          const combinedHoldings = dict.holdings;
          let totalValue = 0;
          if (combinedHoldings) {
            totalValue = combinedHoldings.reduce((sum: number, item: any) => sum + parseFloat(item.value || 0), 0);
          }
          for (const holding in combinedHoldings) {
            if (combinedHoldings.hasOwnProperty(holding)) {
              const specialCharsRegex = /[^\w\s]/g;
              let name = combinedHoldings[holding].nameOfIssuer;
              if (name) {
                name = name.replace(specialCharsRegex, "");
                let currName = stockInfo?.companyName;
                if (currName) {
                  currName = currName.replace(specialCharsRegex, "");
                  const nameParts = name.split(' ');
                  const currNameParts = currName.split(' ');
                  let match = false;
                  if (nameParts.length > 0 && currNameParts.length > 0 && nameParts[0].toUpperCase() === currNameParts[0].toUpperCase()) {
                    if (currNameParts.length > 1 && nameParts.length > 1 && nameParts[1].toUpperCase() === currNameParts[1].toUpperCase()) {
                      match = true;
                    } else if (currNameParts.length === 1) {
                      match = true;
                    }
                  }

                  if (match) {
                    let percent123 = "0.00%";
                    if (totalValue > 0 && !isNaN(parseFloat(combinedHoldings[holding].value))) {
                      const percentage = (parseFloat(combinedHoldings[holding].value) / totalValue) * 100;
                      percent123 = percentage.toFixed(2) + "%";
                    }
                    invesDict.push({
                      cik: investor.cik,
                      institution: investor.institution,
                      name: investor.name,
                      numShares: combinedHoldings[holding].shrsOrPrnAmt?.sshPrnamt,
                      value: combinedHoldings[holding].value,
                      percent: percent123,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
    debug(invesDict, 'dict');
    return invesDict;
  };

  const getStockInfo = async (ticker: string, filter: string | null): Promise<StockInfo> => {
    try {
      const tickersResponse = await secFetch(`https://www.sec.gov/files/company_tickers.json`);
      if (!tickersResponse.ok) {
        throw new Error(`HTTP error! status: ${tickersResponse.status}`);
      }

      const tickersData = await tickersResponse.json();
      let cik_str = "";
      let compName = "";
      let similairTitles: any[] = [];
      for (const key in tickersData) {
        if (tickersData.hasOwnProperty(key)) {
          let finalTicker = "";
          const splitTicker = ticker.split(" ");
          if (splitTicker.length >= 2) {
            finalTicker += splitTicker[0] + ' ' + splitTicker[1];
          } else {
            finalTicker = splitTicker[0];
          }
          if (tickersData[key].ticker?.toUpperCase() === ticker.toUpperCase()) {
            compName = tickersData[key].title;
            const numberStr = tickersData[key].cik_str?.toString();
            const numZeros = 10 - (numberStr?.length || 0);
            cik_str = "0".repeat(numZeros) + numberStr;
            break;
          } else if (tickersData[key].title?.toUpperCase().startsWith(finalTicker.toUpperCase())) {
            similairTitles.push(tickersData[key]);
          }
        }
      }
      if (!cik_str && similairTitles.length > 0) {
        compName = similairTitles[0].title;
        const numberStr = similairTitles[0].cik_str?.toString();
        const numZeros = 10 - (numberStr?.length || 0);
        cik_str = "0".repeat(numZeros) + numberStr;
      }

      if (!cik_str) {
        throw new Error(`Ticker ${ticker} not found.`);
      }
      const factsResponse = await secFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik_str}.json`);

      if (!factsResponse.ok) {
        throw new Error(`HTTP error! status: ${factsResponse.status} for CIK: ${cik_str}`);
      }
      const factsData = await factsResponse.json();

      let currentData: any = "";
      let epsData = factsData?.facts?.['us-gaap']?.EarningsPerShareBasic?.units?.['USD/shares'];
      let revData = factsData?.facts?.['us-gaap']?.RevenueFromContractWithCustomerExcludingAssessedTax?.units?.['USD'];
      let incomeData = factsData?.facts?.['us-gaap']?.NetIncomeLoss?.units?.['USD'];
      let assetsData = factsData?.facts?.['us-gaap']?.Assets?.units?.['USD'];
      let sharesData = factsData?.facts?.['dei']?.EntityCommonStockSharesOutstanding?.units?.shares;
      let dividendData = factsData?.facts?.['us-gaap']?.PaymentsOfDividends?.units?.['USD'];
      let currentLiabilities = factsData?.facts?.['us-gaap']?.LiabilitiesCurrent?.units?.['USD'];
      let roicData: any[] | null = null;
      let skip = false;

      if (filter === 'eps') {
        currentData = epsData;
      } else if (filter === 'liabilities') {
        currentData = currentLiabilities;
      } else if (filter === "revenue") {
        currentData = revData;
      } else if (filter === "net income") {
        currentData = incomeData;
      } else if (filter === 'dividends') {
        currentData = dividendData;
      } else if (filter === 'assets') {
        currentData = assetsData;
      } else if (filter === 'shares Outstanding') {
        currentData = sharesData;
      } else if (filter === "roic") {
        if (currentLiabilities && assetsData && incomeData) {
          const liabilities = getInfo(currentLiabilities);
          const assets = getInfo(assetsData);
          const income = getInfo(incomeData);
          const investedCapital = getIntersectionAndSumByLabel(assets, liabilities, '-');
          roicData = getIntersectionAndSumByLabel(income, investedCapital, '/');
          skip = true;
        }
      } else {
        currentData = revData; // Default to rev if no filter
      }

      let graphData: GraphDataItem[] = [];
      if (!skip && currentData) {
        graphData = getInfo(currentData);
      }

      return { roicData, liabilities: currentLiabilities, companyName: compName, cik: cik_str, graphData, epsData, revData, incomeData, assetsData, sharesData, eps: epsData ?? null } as StockInfo;
    } catch (error: any) {
      logError("Error fetching stock info:", error);
      return { companyName: null, cik: null, eps: null, graphData: null, epsData: null, revData: null, incomeData: null, assetsData: null, sharesData: null };
    }
  };

  function getIntersectionAndSumByLabel(arr1: any[], arr2: any[], operator: string): any[] {
    const intersection: any[] = [];
    const labelMap = new Map<any, number>();

    arr1.forEach(item => {
      labelMap.set(item.label, item.value);
    });

    arr2.forEach(item => {
      if (labelMap.has(item.label) && typeof labelMap.get(item.label) === 'number' && typeof item.value === 'number') {
        let newValue: number | undefined;
        if (operator === '-') {
          newValue = labelMap.get(item.label)! - item.value;
        } else if (operator === '/') {
          newValue = item.value !== 0 ? (labelMap.get(item.label)! / item.value) * 100 : 0;
        }
        if (typeof newValue === 'number') {
          labelMap.set(item.label, newValue);
        }
      }
    });

    labelMap.forEach((value, label) => {
      intersection.push({ label, value });
    });

    return intersection;
  }

  const getInfo = (currentData: any): GraphDataItem[] => {
    const graphData: GraphDataItem[] = [];
    const seen: string[] = [];

    if (currentData && Array.isArray(currentData)) {
      for (let i = currentData.length - 1; i >= 0 && graphData.length < 10; i--) {
        const item = currentData[i];
        if (item?.fp === "FY" && item?.fy && !seen.includes(item.fy)) {
          let value = typeof item.val === 'number' ? item.val : 1;
          if (value < 1) value = 1;

          if (item.start && item.end) {
            const date1 = new Date(item.start);
            const date2 = new Date(item.end);
            const diffInMonths = Math.abs((date2.getFullYear() - date1.getFullYear()) * 12 + (date2.getMonth() - date1.getMonth())) > 10;
            if (diffInMonths) {
              graphData.push({ label: item.fy, value });
              seen.push(item.fy);
            }
          } else {
            graphData.push({ label: item.fy, value });
            seen.push(item.fy);
          }
        }
      }
    }
    return graphData;
  };

  useEffect(() => {
    if (stockInfo && stockInfo.graphData) {
      setGraphData(stockInfo.graphData);
    }
  }, [stockInfo]);

  useEffect(() => {
    if (graphData && graphData.length > 0) {
      const data = graphData.slice(0, 10);
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
      return (
        <Text style={styles.noDataText}>
          No data available. {"\n"}Please choose another option using the dropdown.
        </Text>
      ); 
    }

    const data = stockInfo.graphData
      .slice(0, 10)
      .map(item => ({
        label: item.label ?? "N/A",
        value: item.value ?? 0,
      }));

    return (
      <View style={styles.card}><BarGraph data={data.reverse()} /></View>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.scrollViewContent}>
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
              data={dropdownOptions}
              labelField="label"
              valueField="value"
              value={filterType}  
              onChange={item => {
                setFilterType(item.value);
              }}
              renderItem={(item) => (
                <Text style={styles.dropdownItem}>{item.label}</Text>
              )}
              disable={dropdownOptions.length === 0} 
            />
            {dropdownOptions.length === 0 && <Text style={styles.noDataText}>No data available for selected ticker.</Text>}
          </View>
          {filterType && <Text style={styles.graphTitle}>{filterType.toUpperCase()} Over Time</Text>}
          {renderGraph()}

          {selectedValue && <Text>Selected Value: {selectedValue}</Text>}
        
        
        {!investorInfo && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#0000ff" />
            <Text style={styles.loadingText}>Looking for 13F filings</Text>
          </View>
        )}
        {investorInfo && investorInfo.length > 0 && (

<View style={styles.investorInfoCard}>
  <Text style={styles.cardTitle}>Investor Holdings</Text>
  <View>
    {investorInfo
      .sort((a, b) => {
        const percentA = parseFloat(a.percent ?? "0");
        const percentB = parseFloat(b.percent ?? "0");
        return percentB - percentA;
      })
      .map((investor, index) => (
         <TouchableOpacity
           key={index}
           style={styles.investorItem}
           onPress={() =>
            (navigation as any).navigate('HoldingsScreen', {
              investorName: investor.name ?? "N/A",
              institution: investor.institution ?? "N/A",
              cik: investor.cik ?? "N/A",
            })
           }
         >
          <Text style={styles.investorName}>{investor.name ?? "N/A"}</Text>
          <Text style={styles.institutionName}>{investor.institution ?? "N/A"}</Text>
          <View style={styles.holdingDetails}>
            <Text>Shares: {formatNumberWithCommas(investor.numShares ?? 0)}</Text>
            <Text>Value: ${formatNumberWithCommas(investor.value ?? 0)}</Text>
            <Text>Percentage of Portfolio: {investor.percent ?? "N/A"}</Text>
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
      cardTitle: { 
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 8,
      },
      loadingContainer: {
        flexDirection: 'row', 
        alignItems: 'center',  
        marginTop: 20,        
      },
      loadingText: {
        marginLeft: 10,     
        fontSize: 16,     
      },
      invLoading: { 
        marginTop: 20,
      },
      investorItem: { 
        marginBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
        paddingBottom: 8,
      },
      investorName: {
        fontSize: 16,
        fontWeight: 'bold',
      },
      institutionName: {
        fontSize: 13,
        color: 'gray',
        marginBottom: 2, 
      },
      holdingDetails: {
        marginLeft: 16, 
      },

  noDataText: {
    color: 'gray',
    fontSize: 13,    
    fontStyle: 'italic', 
    textAlign: 'center',
    paddingHorizontal: 10,
  },
    graphTitle: {
        marginTop:30,

        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 10,
        textAlign: 'center', 
    },

    container: {
      marginTop: 60,

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
        width: 250, 
        borderWidth: 1,
        borderColor: 'gray',
        borderRadius: 8,
      },
      dropdown: {
        height: 50,
        backgroundColor: 'white',
        paddingHorizontal: 8,
      },
      dropdownItem: { 
        padding: 10,
        fontSize: 16,
      },
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