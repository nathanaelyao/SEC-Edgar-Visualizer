import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ScrollView, Modal, TextInput, Alert } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { Animated, Easing } from 'react-native';
import BarChart from '../components/BarChart';
import { Dropdown } from 'react-native-element-dropdown';
import { investorsData } from '../constants/investors';
import { FlatList } from 'react-native';
import InvestorItem from '../components/InvestorItem';
import { useNavigation } from '@react-navigation/native';
import { secFetch } from './utils/secApi';
import { debug, info, warn, error as logError } from './utils/logger';
import * as SQLite from 'expo-sqlite';
import cheerio from 'react-native-cheerio'; // Import cheerio
import { XMLParser } from 'fast-xml-parser';
import { addHolding, getHolding, PortfolioHolding } from './utils/db';
import { fetchStockPrice } from './utils/secApi';



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
  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [chartPage, setChartPage] = useState(0);
  const [realTimePrice, setRealTimePrice] = useState<number | null>(null);
  const [animatedHeights, setAnimatedHeights] = useState<Animated.Value[]>([]);
  const [investorInfo, setInvestorInfo] = useState<InvestorHolding[] | null>(null);
  const [dropdownOptions, setDropdownOptions] = useState<any[]>([]);
  const [filings, setFilings] = useState<any[]>([]);
  /* Rename interval to dataInterval to avoid shadowing global setInterval */
  const [dataInterval, setDataInterval] = useState<'yearly' | 'quarterly'>('yearly');
  const [filterType, setFilterType] = useState<string | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);

  const [isPortfolioModalVisible, setIsPortfolioModalVisible] = useState(false);
  const [sharesToAdd, setSharesToAdd] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingHolding, setExistingHolding] = useState<PortfolioHolding | null>(null);
  const [portfolioMode, setPortfolioMode] = useState<'buy' | 'sell'>('buy');
  const [page, setPage] = useState(0);
  const itemsPerPage = 8;

  useEffect(() => {
    const checkPortfolio = async () => {
      if (stockSymbol) {
        const holding = await getHolding(stockSymbol);
        setExistingHolding(holding);
      }
    };
    checkPortfolio();
  }, [stockSymbol, isPortfolioModalVisible]);

  /* Restored Helper Functions */
  function removeNamespace(data: any): any {
    if (Array.isArray(data)) {
      return data.map((item: any) => removeNamespace(item));
    } else if (typeof data === 'object' && data !== null) {
      const newData: Record<string, any> = {};
      for (const key in data) {
        const newKey = key.replace('ns1:', '');
        newData[newKey] = removeNamespace((data as any)[key]);
      }
      return newData;
    } else {
      return data;
    }
  }

  const getHoldings = async (accessionNumber: string, cik1: string): Promise<any[]> => {
    try {
      const accessionNumberNoHyphens = accessionNumber.replace(/-/g, '');
      const response = await secFetch(`https://www.sec.gov/Archives/edgar/data/${cik1}/${accessionNumberNoHyphens}/index.html`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.text();
      const $ = cheerio.load(data);
      const foundFiles: string[] = [];
      $('a').each((i: number, el: any) => {
        const href = $(el).attr && $(el).attr('href');
        if (href && href.endsWith('.xml')) foundFiles.push(href);
      });
      for (let i = 0; i < foundFiles.length; i++) {
        if (!foundFiles[i].startsWith("primary")) {
          const response1 = await secFetch(`https://www.sec.gov${foundFiles[i]}`);
          const data1 = await response1.text();
          const parser = new XMLParser();
          const json = removeNamespace(parser.parse(data1));
          return json['informationTable']?.infoTable || json['ns1:informationTable']?.['ns1:infoTable'] || [];
        }
      }
      return [];
    } catch (error: unknown) {
      logError("Error fetching holdings:", error);
      return [];
    }
  };

  const getInvestorHoldings = async (): Promise<any[]> => {
    try {
      const results: any[] = [];
      for (const investor of investorsData) {
        const cik = investor.cik.padStart(10, '0');
        const response = await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`);
        const data = await response.json();
        const recentFilings = data.filings?.recent;
        if (!recentFilings) continue;
        let first = true;
        for (let i = 0; i < recentFilings.accessionNumber.length; i++) {
          const accessionNumber = recentFilings.accessionNumber[i];
          const formType = recentFilings.form[i];
          if (formType === '13F-HR' && first) {
            first = false;
            const holdings = await getHoldings(accessionNumber, data.cik);
            results.push({ name: investor.name, cik, holdings, institution: investor.institution });
          }
        }
      }
      return results;
    } catch (err) {
      logError("Error fetching investor holdings:", err);
      return [];
    }
  };

  const formatNumberWithCommas = (number: any): string => {
    if (number === undefined || number === null) return "N/A";
    const n = typeof number === 'string' ? parseFloat(number) : number;
    return n.toLocaleString();
  };

  const normalize = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

  function getIntersectionAndSumByLabel(arr1: any[], arr2: any[], operator: string): any[] {
    const intersection: any[] = [];
    const labelMap = new Map<any, number>();
    arr1.forEach(item => labelMap.set(item.label, item.value));
    arr2.forEach(item => {
      if (labelMap.has(item.label) && typeof labelMap.get(item.label) === 'number' && typeof item.value === 'number') {
        let newValue: number | undefined;
        if (operator === '-') newValue = labelMap.get(item.label)! - item.value;
        else if (operator === '/') newValue = item.value !== 0 ? (labelMap.get(item.label)! / item.value) * 100 : 0;
        if (typeof newValue === 'number') labelMap.set(item.label, newValue);
      }
    });
    labelMap.forEach((value, label) => intersection.push({ label, value }));
    return intersection;
  }


  const fillDataGaps = (data: GraphDataItem[], interval: 'yearly' | 'quarterly'): GraphDataItem[] => {
    if (data.length < 2) return data;
    const filled: GraphDataItem[] = [];
    const seenLabels = new Set<string>();

    for (let i = 0; i < data.length; i++) {
      // Only add if we haven't seen this label before
      if (!seenLabels.has(data[i].label)) {
        filled.push(data[i]);
        seenLabels.add(data[i].label);
      }

      if (i < data.length - 1) {
        const current = data[i];
        const next = data[i + 1];
        if (interval === 'yearly') {
          const currentYear = parseInt(current.label);
          const nextYear = parseInt(next.label);
          if (!isNaN(currentYear) && !isNaN(nextYear)) {
            for (let y = currentYear + 1; y < nextYear; y++) {
              const label = y.toString();
              if (!seenLabels.has(label)) {
                filled.push({ label, value: 0 });
                seenLabels.add(label);
              }
            }
          }
        } else {
          const regex = /^(\d{4})Q(\d)$/;
          const currMatch = current.label.match(regex);
          const nextMatch = next.label.match(regex);
          if (currMatch && nextMatch) {
            let cYear = parseInt(currMatch[1]);
            let cQuarter = parseInt(currMatch[2]);
            const nYear = parseInt(nextMatch[1]);
            const nQuarter = parseInt(nextMatch[2]);
            let safety = 0;
            while (safety < 20) {
              cQuarter++;
              if (cQuarter > 4) { cQuarter = 1; cYear++; }
              if (cYear > nYear || (cYear === nYear && cQuarter >= nQuarter)) break;
              const label = `${cYear}Q${cQuarter}`;
              if (!seenLabels.has(label)) {
                filled.push({ label, value: 0 });
                seenLabels.add(label);
              }
              safety++;
            }
          }
        }
      }
    }
    return filled;
  };

  const getInfo = (currentData: any, interval: 'yearly' | 'quarterly'): GraphDataItem[] => {
    const graphData: GraphDataItem[] = [];
    const seen: string[] = [];

    if (currentData && Array.isArray(currentData)) {
      // Sort data by date just in case, though usually it comes sorted
      // Actually, relying on index might be safer if source is reliable, but let's stick to existing reverse loop
      const limit = 60;
      for (let i = currentData.length - 1; i >= 0 && graphData.length < limit; i--) {
        const item = currentData[i];

        let isMatch = false;
        let label = "";
        let uniqueKey = "";

        if (interval === 'yearly') {
          if (item?.fp === "FY" && item?.fy) {
            isMatch = true;
            label = item.fy.toString();
            uniqueKey = item.fy;
          }
        } else {
          // Quarterly logic - include Q1, Q2, Q3, and Q4 (which may be labeled as FY)
          if (item?.fp?.startsWith("Q") || item?.fp === "FY") {
            let period = "";

            // Prefer frame but strip CY and handle FY conversion
            if (item.frame) {
              period = item.frame.startsWith('CY') ? item.frame.substring(2) : item.frame;
              // If this is an FY entry and frame doesn't contain Q4, convert it
              if (item.fp === "FY" && !period.includes('Q4') && item.fy) {
                period = `${item.fy}Q4`;
              }
            } else if (item.fy && item.fp) {
              // Construct from fy+fp
              if (item.fp === "FY") {
                period = `${item.fy}Q4`;
              } else {
                period = `${item.fy}${item.fp}`;
              }
            }

            if (period) {
              isMatch = true;
              label = period;
              uniqueKey = period;
            }
          }
        }

        if (isMatch && !seen.includes(uniqueKey)) {
          let value = typeof item.val === 'number' ? item.val : 0; // Allow 0/negative
          // Logic for value correction if needed (e.g. < 1 check removed as we support negatives now)

          if (item.start && item.end && interval === 'yearly') {
            // Existing months check for yearly?
            const date1 = new Date(item.start);
            const date2 = new Date(item.end);
            const diffInMonths = Math.abs((date2.getFullYear() - date1.getFullYear()) * 12 + (date2.getMonth() - date1.getMonth())) > 10;
            if (diffInMonths) {
              graphData.push({ label, value });
              seen.push(uniqueKey);
            }
          } else {
            graphData.push({ label, value });
            seen.push(uniqueKey);
          }
        }
      }
    }
    // graphData was collected Newest->Oldest. Reverse to get Oldest->Newest, then fill gaps.
    const ascendingData = graphData.reverse();

    // Post-process to calculate actual Q4 values (Q4 = FY - Q1 - Q2 - Q3)
    if (interval === 'quarterly') {
      // First pass: collect all data by year and quarter
      const yearData = new Map<string, { q1?: number, q2?: number, q3?: number, q4?: number, fy?: number }>();

      // Scan the original data to find FY and quarterly values
      if (currentData && Array.isArray(currentData)) {
        currentData.forEach((item: any) => {
          if (item?.fy) {
            const year = item.fy.toString();
            if (!yearData.has(year)) {
              yearData.set(year, {});
            }
            const data = yearData.get(year)!;

            if (item.fp === 'FY') {
              data.fy = typeof item.val === 'number' ? item.val : 0;
            } else if (item.fp === 'Q1') {
              data.q1 = typeof item.val === 'number' ? item.val : 0;
            } else if (item.fp === 'Q2') {
              data.q2 = typeof item.val === 'number' ? item.val : 0;
            } else if (item.fp === 'Q3') {
              data.q3 = typeof item.val === 'number' ? item.val : 0;
            } else if (item.fp === 'Q4') {
              data.q4 = typeof item.val === 'number' ? item.val : 0;
            }
          }
        });
      }

      // Second pass: update Q4 values in ascendingData
      ascendingData.forEach(item => {
        const match = item.label.match(/^(\d{4})Q4$/);
        if (match) {
          const year = match[1];
          const data = yearData.get(year);
          if (data && data.fy !== undefined) {
            // Only calculate Q4 from FY if we have at least one of Q1, Q2, or Q3
            // Otherwise, we'd just be showing the full FY value which is incorrect
            const hasQuarterlyData = data.q1 !== undefined || data.q2 !== undefined || data.q3 !== undefined;
            if (hasQuarterlyData) {
              const q1 = data.q1 || 0;
              const q2 = data.q2 || 0;
              const q3 = data.q3 || 0;
              item.value = data.fy - q1 - q2 - q3;
            }
            // If no quarterly data, keep the original value (which came from FY)
          } else if (data && data.q4 !== undefined) {
            // Use actual Q4 value if available
            item.value = data.q4;
          }
          // If no data at all, keep the original value from graphData
        }
      });
    }

    return fillDataGaps(ascendingData, interval);
  };

  useEffect(() => {
    const fetchStockData = async () => {
      try {
        const info = await getStockInfo(stockSymbol, filterType);
        setStockInfo(info);

        // Fetch real-time price
        try {
          const quote = await fetchStockPrice(stockSymbol);
          if (quote.price > 0) {
            setRealTimePrice(quote.price);
          }
        } catch (e) {
          console.error("Error fetching real-time price:", e);
        }

        setChartPage(0); // Reset page on new data
        // Using info.graphData might need re-processing if our simple getStockInfo call above doesn't pass interval.
        // Actually getStockInfo calls filters which calls getInfo. We should update getStockInfo signature too 
        // OR re-process the raw data here if we had it. 
        // Better: Update getStockInfo to accept interval.

        // Wait, getStockInfo returns graphData. We need to pass interval down.
        // Let's assume we update getStockInfo signature below.

      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchStockData();
  }, [stockSymbol, filterType, dataLoaded, dataInterval]);

  useEffect(() => {
    if (!stockInfo) return;

    const options = [];
    if (stockInfo.revData) options.push({ label: 'Revenue', value: 'revenue' });
    if (stockInfo.incomeData) options.push({ label: 'Net Income', value: 'net income' });
    if (stockInfo.epsData) options.push({ label: 'EPS', value: 'eps' });
    if (stockInfo.assetsData) options.push({ label: 'Assets', value: 'assets' });
    if (stockInfo.liabilities) options.push({ label: 'Liabilities', value: 'liabilities' });
    // Dividends check - assuming it might be available if not explicitly null, or we can check a specific field if we had one. 
    // The current type def implies these are strings or null. 
    // Let's assume some are always "available" to try fetching, or check if we have data. 
    // Actually, getStockInfo fetches them all. 
    // Let's add them if they are not null.
    // dividendData isn't on StockInfo interface explicitly in the view above (it has custom unknown props maybe?), 
    // let's check interface. 
    // Interface StockInfo has: eps, graphData, epsData, revData, incomeData, assetsData, sharesData, liabilities, roicData.
    // dividendData is missing from StockInfo interface in the file view I saw earlier? 
    // Let's check the file content from the last view_file.
    // Line 45: liabilities?: string | null;
    // Line 46: roicData?: any[] | null;
    // It seems dividendData is NOT in the interface but was in the fetch logic. 
    // I will stick to the ones in StockInfo for now or add them if needed. 
    // The fetch logic has `let dividendData`. 
    // But getStockInfo returns it? 
    // Return statement: { roicData, liabilities, ... sharesData, eps ... }
    // It does NOT return dividendData. So I should not add Dividends to options unless I add it to interface and return. 
    // For now I will filter based on what is returned.

    if (stockInfo.sharesData) options.push({ label: 'Shares Outstanding', value: 'shares Outstanding' });
    if (stockInfo.roicData) options.push({ label: 'ROIC', value: 'roic' });

    // If options is empty (unlikely if fetch worked), fallback?
    if (options.length === 0) options.push({ label: 'Revenue', value: 'revenue' });

    setDropdownOptions(options);

    // Ensure selectedValue is valid
    if (selectedValue && !options.find(o => o.value === selectedValue)) {
      setSelectedValue(options[0].value);
      setFilterType(options[0].value);
    } else if (!selectedValue && options.length > 0) {
      setSelectedValue(options[0].value);
      setFilterType(options[0].value);
    }

  }, [stockInfo]);

  useEffect(() => {
    if (stockInfo && !investorInfo) {
      const fetchInvestors = async () => {
        const rawData = await getInvestorHoldings();
        const processed = processInvestorData(rawData, stockInfo.companyName || "");
        setInvestorInfo(processed);
      };

      // Add a small delay or ensure this doesn't block interactions? Async is fine.
      fetchInvestors();
    }
  }, [stockInfo]);

  const processInvestorData = (rawData: any[], companyName: string): InvestorHolding[] => {
    if (!companyName) return [];

    const processedResults: InvestorHolding[] = [];
    const normalizedCompany = normalize(companyName);

    for (const item of rawData) {
      const combinedHoldings = item.holdings || [];
      if (combinedHoldings.length === 0) continue;

      const totalPortfolioValue = combinedHoldings.reduce((sum: number, h: any) => sum + parseFloat(h.value || "0"), 0);

      const stockHoldings = combinedHoldings.filter((h: any) =>
        h.nameOfIssuer && normalize(h.nameOfIssuer).includes(normalizedCompany)
      );

      if (stockHoldings.length === 0) continue;

      const totalShares = stockHoldings.reduce((sum: number, h: any) => sum + parseFloat(h.shrsOrPrnAmt?.sshPrnamt || "0"), 0);
      const totalValue = stockHoldings.reduce((sum: number, h: any) => sum + parseFloat(h.value || "0"), 0);

      const percent = totalPortfolioValue > 0
        ? ((totalValue / totalPortfolioValue) * 100).toFixed(2) + '%'
        : '0.00%';

      processedResults.push({
        cik: item.cik,
        institution: item.institution,
        name: item.name,
        numShares: totalShares.toString(),
        value: totalValue.toString(),
        percent: percent,
      });
    }

    return processedResults;
  };

  /* Restored getStockInfo */
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
          const liabilities = getInfo(currentLiabilities, dataInterval); // Pass dataInterval
          const assets = getInfo(assetsData, dataInterval); // Pass dataInterval
          const income = getInfo(incomeData, dataInterval); // Pass dataInterval
          const investedCapital = getIntersectionAndSumByLabel(assets, liabilities, '-');
          roicData = getIntersectionAndSumByLabel(income, investedCapital, '/');
          skip = true;
        }
      } else {
        currentData = revData; // Default to rev if no filter
      }

      let graphData: GraphDataItem[] = [];
      if (!skip && currentData) {
        graphData = getInfo(currentData, dataInterval); // Pass dataInterval
      }

      return { roicData, liabilities: currentLiabilities, companyName: compName, cik: cik_str, graphData, epsData, revData, incomeData, assetsData, sharesData, eps: epsData ?? null } as StockInfo;
    } catch (error: any) {
      logError("Error fetching stock info:", error);
      return { companyName: null, cik: null, eps: null, graphData: null, epsData: null, revData: null, incomeData: null, assetsData: null, sharesData: null };
    }
  };

  // ...

  return (
    <View style={styles.container}>
      <FlatList
        data={investorInfo}
        keyExtractor={(item, index) => index.toString()}
        renderItem={({ item }) => (
          <View style={styles.investorInfoCard}>
            <View style={styles.investorItem}>
              <Text style={styles.investorName}>{item.name}</Text>
              <Text style={styles.institutionName}>{item.institution}</Text>
              <View style={styles.holdingDetails}>
                <Text>Shares: {formatNumberWithCommas(item.numShares)}</Text>
                <Text>Value: ${formatNumberWithCommas(item.value)}</Text>
                <Text>Portfolio %: {item.percent}</Text>
              </View>
            </View>
          </View>
        )}
        ListHeaderComponent={
          <>
            <View style={styles.loadingContainer}>
              {loading && <ActivityIndicator size="large" color="#0000ff" />}
              {loading && <Text style={styles.loadingText}>Fetching Stock Data...</Text>}
            </View>
            {error && <Text style={styles.errorText}>{error}</Text>}
            {stockInfo && (
              <View>
                <View style={styles.card}>
                  <View style={styles.titleRow}>
                    <TouchableOpacity
                      style={styles.backButton}
                      onPress={() => navigation.goBack()}
                    >
                      <Text style={styles.backButtonText}>←</Text>
                    </TouchableOpacity>
                    <Text style={styles.title}>{stockInfo.companyName}</Text>
                  </View>

                  {realTimePrice !== null && (
                    <View style={styles.priceContainer}>
                      <Text style={styles.priceLabel}>Delayed Price:</Text>
                      <Text style={styles.priceValue}>${realTimePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={[styles.addToPortfolioButton, existingHolding ? styles.managePortfolioButton : null]}
                    onPress={() => {
                      setPortfolioMode('buy');
                      setIsPortfolioModalVisible(true);
                    }}
                  >
                    <Text style={styles.addToPortfolioText}>
                      {existingHolding ? `Manage: ${existingHolding.shares} Shares` : '+ Add to Portfolio'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.controlsContainer}>
                  <View style={styles.dropdownContainer}>
                    <Dropdown
                      style={styles.dropdown}
                      placeholderStyle={styles.dropdownItem}
                      selectedTextStyle={styles.dropdownItem}
                      data={dropdownOptions}
                      maxHeight={300}
                      labelField="label"
                      valueField="value"
                      placeholder="Select item"
                      value={selectedValue}
                      onChange={item => {
                        setSelectedValue(item.value);
                        setFilterType(item.value);
                      }}
                    />
                  </View>

                  <View style={styles.toggleContainer}>
                    <TouchableOpacity
                      style={[styles.toggleButton, dataInterval === 'yearly' && styles.toggleButtonActive]}
                      onPress={() => setDataInterval('yearly')}
                    >
                      <Text style={[styles.toggleText, dataInterval === 'yearly' && styles.toggleTextActive]}>Yearly</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.toggleButton, dataInterval === 'quarterly' && styles.toggleButtonActive]}
                      onPress={() => setDataInterval('quarterly')}
                    >
                      <Text style={[styles.toggleText, dataInterval === 'quarterly' && styles.toggleTextActive]}>Quarterly</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {stockInfo.graphData && (
                  <>
                    <Text style={styles.graphTitle}>
                      {selectedValue ? dropdownOptions.find(o => o.value === selectedValue)?.label : 'Revenue'}
                    </Text>
                    {(() => {
                      const allData = stockInfo.graphData!;
                      const itemsPerPage = 8;
                      const totalItems = allData.length;
                      const totalPages = Math.ceil(totalItems / itemsPerPage);

                      // Slicing from the end (Newest data first)
                      // page 0: last 8 items
                      // page 1: previous 8 items
                      const end = totalItems - (chartPage * itemsPerPage);
                      const start = Math.max(0, end - itemsPerPage);
                      const visibleData = allData.slice(start, end);

                      return (
                        <>
                          <BarChart data={visibleData} />
                          <View style={styles.paginationContainer}>
                            <TouchableOpacity
                              style={[styles.pageButton, start <= 0 && styles.pageButtonDisabled]}
                              onPress={() => setChartPage(p => p + 1)}
                              disabled={start <= 0}
                            >
                              <Text style={start <= 0 ? styles.pageTextDisabled : styles.buttonText}>{'< Older'}</Text>
                            </TouchableOpacity>

                            <Text style={styles.pageIndicator}>Page {chartPage + 1}</Text>

                            <TouchableOpacity
                              style={[styles.pageButton, chartPage === 0 && styles.pageButtonDisabled]}
                              onPress={() => setChartPage(p => Math.max(0, p - 1))}
                              disabled={chartPage === 0}
                            >
                              <Text style={chartPage === 0 ? styles.pageTextDisabled : styles.buttonText}>{'Newer >'}</Text>
                            </TouchableOpacity>
                          </View>
                        </>
                      );
                    })()}
                  </>
                )}

                {investorInfo && investorInfo.length > 0 && (
                  <Text style={styles.cardTitle}>Top Institutional Holders</Text>
                )}
              </View>
            )}
            {!loading && !investorInfo && !error && (
              <View style={styles.invLoading}>
                <ActivityIndicator size="small" color="#999" />
                <Text style={styles.noDataText}>Loading investor data...</Text>
              </View>
            )}
            <Modal
              visible={isPortfolioModalVisible}
              transparent={true}
              animationType="slide"
            >
              <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                  <Text style={styles.modalTitle}>{existingHolding ? 'Update Portfolio' : 'Add to Portfolio'}</Text>
                  <Text style={styles.modalSubtitle}>{stockInfo?.companyName} ({stockSymbol})</Text>

                  {existingHolding && (
                    <View style={styles.modeTabs}>
                      <TouchableOpacity
                        style={[styles.modeTab, portfolioMode === 'buy' && styles.modeTabActive]}
                        onPress={() => setPortfolioMode('buy')}
                      >
                        <Text style={[styles.modeTabText, portfolioMode === 'buy' && styles.modeTabTextActive]}>Buy</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.modeTab, portfolioMode === 'sell' && styles.modeTabActive]}
                        onPress={() => setPortfolioMode('sell')}
                      >
                        <Text style={[styles.modeTabText, portfolioMode === 'sell' && styles.modeTabTextActive]}>Sell</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <TextInput
                    style={styles.modalInput}
                    placeholder={portfolioMode === 'buy' ? "Number of shares to add" : "Number of shares to sell"}
                    keyboardType="numeric"
                    value={sharesToAdd}
                    onChangeText={setSharesToAdd}
                    placeholderTextColor="#999"
                  />

                  <View style={styles.modalButtons}>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.cancelButton]}
                      onPress={() => {
                        setIsPortfolioModalVisible(false);
                        setSharesToAdd('');
                      }}
                    >
                      <Text style={styles.cancelButtonText}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.modalButton, styles.saveButton]}
                      disabled={isSubmitting}
                      onPress={async () => {
                        const shares = parseFloat(sharesToAdd);
                        if (isNaN(shares) || shares <= 0) {
                          Alert.alert("Invalid input", "Please enter a valid number of shares.");
                          return;
                        }

                        setIsSubmitting(true);
                        try {
                          const sharesChange = portfolioMode === 'buy' ? shares : -shares;

                          // Fetch real price from our new GitHub-based service
                          const quote = await fetchStockPrice(stockSymbol);
                          const currentPrice = quote.price > 0 ? quote.price : 150.00; // Fallback to 150 only if fetch fails completely

                          await addHolding({
                            symbol: stockSymbol,
                            companyName: stockInfo?.companyName || stockSymbol,
                            shares: sharesChange,
                            price: currentPrice
                          });

                          Alert.alert("Success", existingHolding ? "Portfolio updated." : `${stockSymbol} added to your portfolio.`);
                          setIsPortfolioModalVisible(false);
                          setSharesToAdd('');
                        } catch (err) {
                          console.error("Error updating portfolio:", err);
                          Alert.alert("Error", "Could not save. Please try again.");
                        } finally {
                          setIsSubmitting(false);
                        }
                      }}
                    >
                      {isSubmitting ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.saveButtonText}>Confirm</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>
          </>
        }
        ListEmptyComponent={
          !loading && investorInfo && investorInfo.length === 0 ? (
            <Text style={styles.noDataText}>No investor holdings found.</Text>
          ) : null
        }
        contentContainerStyle={styles.scrollViewContent}
      />
    </View>
  );
};
import { Dimensions } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const styles = StyleSheet.create({
  scrollViewContent: {
    paddingBottom: 20,
  },
  card: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 8,
    marginBottom: 4,
  },
  priceLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
    marginRight: 6,
  },
  priceValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#000',
  },


  investorInfoCard: {
    marginTop: 0,
    width: SCREEN_WIDTH - 40, // Responsive width: screen width - horizontal padding
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    marginBottom: 10,
    alignSelf: 'center', // Ensure it centers
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
    marginTop: 30, // Added spacing between chart and holdings list
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
    marginTop: 30,

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


  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: SCREEN_WIDTH - 30, // Wider container
    marginTop: 20,
    marginBottom: 20,
  },
  toggleContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    backgroundColor: '#e0e0e0',
    borderRadius: 8,
    padding: 2,
    height: 50,
    alignItems: 'center',
    width: '48%',
  },
  toggleButton: {
    flex: 1, // Distribute space evenly
    borderRadius: 6,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownContainer: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    height: 50,
    width: '48%',
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  dropdown: {
    height: 50,
    paddingHorizontal: 10,
  },
  dropdownItem: {
    fontSize: 16,
    color: '#333',
  },
  title: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'center',
    paddingHorizontal: 20,
    marginTop: 10,
  },
  errorText: {
    color: 'red',
    textAlign: 'center',
    marginTop: 10,
  },
  toggleText: {
    color: '#666',
    fontWeight: '600',
    fontSize: 14,
  },
  toggleTextActive: {
    color: '#000',
    fontWeight: '700',
  },
  toggleButtonActive: {
    backgroundColor: '#fff',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  paginationContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 15,
    marginBottom: 10,
  },
  pageButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
    marginHorizontal: 10,
  },
  pageButtonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    alignItems: 'center',

    color: '#007AFF',
    fontWeight: '600',
  },
  pageTextDisabled: {
    color: '#999',
  },
  pageIndicator: {
    fontSize: 14,
    color: '#666',
    marginHorizontal: 15,
  },

  backButton: {
    paddingLeft: 8
  },
  backButtonText: {
    fontSize: 24,
    color: '#007AFF',
    fontWeight: '600',
  },
  titleRow: {
    marginRight: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addToPortfolioButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 10,
    alignSelf: 'center',
  },
  managePortfolioButton: {
    backgroundColor: '#34C759',
  },
  addToPortfolioText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  modeTabs: {
    flexDirection: 'row',
    marginBottom: 20,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    padding: 4,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  modeTabActive: {
    backgroundColor: '#fff',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  modeTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  modeTabTextActive: {
    color: '#007AFF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    width: '85%',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#1a1a1a',
    backgroundColor: '#f9f9f9',
    marginBottom: 24,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalButton: {
    flex: 0.48,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#f0f0f0',
  },
  cancelButtonText: {
    color: '#444',
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#007AFF',
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});


export default SearchResultsScreen;