import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ScrollView, Modal, TextInput, Alert,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
} from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { Animated, Easing } from 'react-native';
import BarChart from '@/components/BarChart';
import { Dropdown } from 'react-native-element-dropdown';
import { investorsData } from '@/constants/investors';
import { FlatList } from 'react-native';
import InvestorItem from '@/components/InvestorItem';
import { useNavigation } from '@react-navigation/native';
import { secFetch, fetchStockPrice, StockQuote, fetchStockHistory, HistoryPoint, fetchPriceForDate, fetchDividendHistory, DividendEvent } from '@/utils/secApi';
import StockLineChart from '@/components/StockLineChart';
import { debug, info, warn, error as logError } from '@/utils/logger';
import * as SQLite from 'expo-sqlite';
import cheerio from 'react-native-cheerio'; // Import cheerio
import { XMLParser } from 'fast-xml-parser';
import { addHolding, getHolding, PortfolioHolding, Transaction, getTransactions, updateTransaction, deleteTransaction } from '@/utils/db';
import DateTimePicker from '@react-native-community/datetimepicker';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '@/context/ThemeContext';
import { formatCurrency, convertCurrency } from '@/utils/currency';
import TransactionList from '@/components/TransactionList';
import TransactionModal from '@/components/TransactionModal';
import { Dimensions } from 'react-native';



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
  dividendsData?: GraphDataItem[] | null;
  calculatedDividendRate?: number | null; // From scratch calculation
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
  const { isDark, currency, exchangeRates } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'SearchResultsScreen'>>();
  const router = useRouter();
  const { stockSymbol } = route.params;
  const [stockInfo, setStockInfo] = useState<StockInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [chartPage, setChartPage] = useState(0);
  const [realTimePrice, setRealTimePrice] = useState<number | null>(null);
  const [stockQuote, setStockQuote] = useState<StockQuote | null>(null);
  const [animatedHeights, setAnimatedHeights] = useState<Animated.Value[]>([]);
  const [investorInfo, setInvestorInfo] = useState<InvestorHolding[] | null>(null);
  const [dropdownOptions, setDropdownOptions] = useState<any[]>([]);
  const [filings, setFilings] = useState<any[]>([]);
  /* Rename interval to dataInterval to avoid shadowing global setInterval */
  const [dataInterval, setDataInterval] = useState<'yearly' | 'quarterly'>('yearly');
  const [filterType, setFilterType] = useState<string | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [priceHistory, setPriceHistory] = useState<HistoryPoint[]>([]);
  const [priceHistoryRange, setPriceHistoryRange] = useState<'1D' | '1W' | '1M' | 'YTD' | '1Y' | '5Y' | 'ALL'>('1M');
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);

  const [isPortfolioModalVisible, setIsPortfolioModalVisible] = useState(false);
  const [existingHolding, setExistingHolding] = useState<PortfolioHolding | null>(null);
  const [portfolioMode, setPortfolioMode] = useState<'buy' | 'sell' | 'history'>('buy');
  const [page, setPage] = useState(0);
  const itemsPerPage = 12;



  // Auto-update price when date changes
  const handleAddToPortfolio = () => {
    setIsPortfolioModalVisible(true);
  };

  useEffect(() => {
    const checkPortfolio = async () => {
      if (stockSymbol) {
        const holding = await getHolding(stockSymbol);
        setExistingHolding(holding);
      }
    };
    checkPortfolio();
  }, [stockSymbol, isPortfolioModalVisible]);

  useEffect(() => {
    const fetchHistory = async () => {
      if (!stockSymbol) return;
      setPriceHistoryLoading(true);

      let range = '1mo';
      let interval = '1d';

      switch (priceHistoryRange) {
        case '1D': range = '1d'; interval = '2m'; break;
        case '1W': range = '5d'; interval = '15m'; break;
        case '1M': range = '1mo'; interval = '60m'; break;
        case 'YTD': range = 'ytd'; interval = '1d'; break;
        case '1Y': range = '1y'; interval = '1d'; break;
        case '5Y': range = '5y'; interval = '1wk'; break;
        case 'ALL': range = 'max'; interval = '1mo'; break;
      }

      const history = await fetchStockHistory(stockSymbol, range, interval, priceHistoryRange === '1D');
      setPriceHistory(history);
      setPriceHistoryLoading(false);
    };

    fetchHistory();
  }, [stockSymbol, priceHistoryRange]);

  /* Restored Helper Functions */
  function formatAbbreviated(num: number): string {
    if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toString();
  }

  function getLatestValue(data: any): number | null {
    if (!data || !Array.isArray(data) || data.length === 0) return null;
    // Data is usually chronological, get the last one
    const lastItem = data[data.length - 1];
    return typeof lastItem.val === 'number' ? lastItem.val : null;
  }

  // Helper to validate data freshness (within last 2 years)
  function isDataRecent(data: any): boolean {
    if (!data || !Array.isArray(data) || data.length === 0) return false;
    const lastItem = data[data.length - 1];
    if (!lastItem.end) return true; // If no date, assume it's recent enough
    const lastDate = new Date(lastItem.end);
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    return lastDate >= twoYearsAgo;
  }

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

    const sortedData = [...data].sort((a, b) => {
      if (interval === 'yearly') return parseInt(a.label) - parseInt(b.label);
      const m1 = a.label.match(/^(\d{4})Q(\d)$/);
      const m2 = b.label.match(/^(\d{4})Q(\d)$/);
      if (m1 && m2) {
        const y1 = parseInt(m1[1]);
        const q1 = parseInt(m1[2]);
        const y2 = parseInt(m2[1]);
        const q2 = parseInt(m2[2]);
        return y1 !== y2 ? y1 - y2 : q1 - q2;
      }
      return 0;
    });

    for (let i = 0; i < sortedData.length; i++) {
      if (!seenLabels.has(sortedData[i].label)) {
        filled.push(sortedData[i]);
        seenLabels.add(sortedData[i].label);
      }

      if (i < sortedData.length - 1) {
        const current = sortedData[i];
        const next = sortedData[i + 1];
        const regex = /^(\d{4})(?:Q(\d))?$/;
        const m1 = current.label.match(regex);
        const m2 = next.label.match(regex);

        if (m1 && m2) {
          let y = parseInt(m1[1]);
          let q = m1[2] ? parseInt(m1[2]) : 0;
          const targetY = parseInt(m2[1]);
          const targetQ = m2[2] ? parseInt(m2[2]) : 0;

          let safety = 0;
          while (safety < 40) {
            if (interval === 'yearly') {
              y++;
            } else {
              q++;
              if (q > 4) { q = 1; y++; }
            }

            if (y > targetY || (y === targetY && q >= targetQ)) break;
            const label = interval === 'yearly' ? y.toString() : `${y}Q${q}`;
            if (!seenLabels.has(label)) {
              filled.push({ label, value: 0 });
              seenLabels.add(label);
            }
            safety++;
          }
        }
      }
    }
    return filled;
  };

  const getInfo = (currentData: any, interval: 'yearly' | 'quarterly', isFlow?: boolean, fillGaps: boolean = true): GraphDataItem[] => {
    if (!currentData || !Array.isArray(currentData)) return [];

    const entriesMap = new Map<string, any[]>();
    currentData.forEach(item => {
      if (!item.fy || !item.fp) return;
      const key = `${item.fy}-${item.fp}`;
      if (!entriesMap.has(key)) entriesMap.set(key, []);
      entriesMap.get(key)!.push(item);
    });

    const is3Mo = (item: any) => {
      if (!item.start || !item.end) return true;
      const d1 = new Date(item.start);
      const d2 = new Date(item.end);
      const m = Math.abs((d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()));
      return m >= 2 && m <= 4;
    };

    const graphData: GraphDataItem[] = [];
    const sortedYears = Array.from(new Set(currentData.map(i => parseInt(i.fy)).filter(y => !isNaN(y)))).sort((a, b) => a - b);

    sortedYears.forEach(year => {
      const getLatest = (fp: string) => {
        const items = entriesMap.get(`${year}-${fp}`) || [];
        return items.sort((a, b) => {
          if (a.end && b.end) return new Date(b.end).getTime() - new Date(a.end).getTime();
          return 0;
        })[0];
      };

      if (interval === 'yearly') {
        const fy = getLatest('FY');
        if (fy) graphData.push({ label: year.toString(), value: fy.val });
      } else {
        const q1 = getLatest('Q1');
        const q2 = getLatest('Q2');
        const q3 = getLatest('Q3');
        const fy = getLatest('FY');

        if (q1) graphData.push({ label: `${year}Q1`, value: q1.val });

        if (q2) {
          let val = q2.val;
          if (isFlow && !is3Mo(q2) && q1) val = q2.val - q1.val;
          graphData.push({ label: `${year}Q2`, value: val });
        }

        if (q3) {
          let val = q3.val;
          if (isFlow && !is3Mo(q3)) {
            if (q2) val = q3.val - q2.val; // Subtract 6mo YTD from 9mo YTD
            else if (q1) val = q3.val - q1.val;
          }
          graphData.push({ label: `${year}Q3`, value: val });
        }

        if (fy) {
          let val = fy.val;
          if (isFlow && !is3Mo(fy)) {
            if (q3) val = fy.val - q3.val; // Subtract 9mo YTD from 12mo FY
            else if (q2) val = fy.val - q2.val;
            else if (q1) val = fy.val - q1.val;
          }
          graphData.push({ label: `${year}Q4`, value: val });
        }
      }
    });

    if (!fillGaps) return graphData;

    const filledData = fillDataGaps(graphData, interval);
    // Limit history to 8 years (32 quarters) or 10 years (10 FY) to keep UI focused
    return interval === 'quarterly' ? filledData.slice(-32) : filledData.slice(-10);
  };

  useEffect(() => {
    const fetchStockData = async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch price and financials in parallel
        const [info, quote] = await Promise.allSettled([
          getStockInfo(stockSymbol, filterType),
          fetchStockPrice(stockSymbol)
        ]);

        if (info.status === 'fulfilled') {
          setStockInfo(info.value);
        } else {
          // Fallback info if SEC fails
          setStockInfo({
            companyName: stockSymbol,
            cik: null,
            graphData: null,
            epsData: null,
            revData: null,
            incomeData: null,
            assetsData: null,
            sharesData: null,
            eps: null
          });
        }

        if (quote.status === 'fulfilled') {
          const q = quote.value;
          setStockQuote(q);
          if (q.price > 0) {
            setRealTimePrice(q.price);
          }
        }

        setChartPage(0);
      } catch (err: any) {
        logError("Unexpected error in fetchStockData:", err);
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
    if (stockInfo.assetsData) options.push({ label: 'Assets', value: 'assets' });
    if (stockInfo.liabilities) options.push({ label: 'Liabilities', value: 'liabilities' });
    // Add Dividends option if we have Yahoo dividend data
    if (stockInfo.dividendsData && stockInfo.dividendsData.length > 0) {
      options.push({ label: 'Dividends', value: 'dividends' });
    } else if (stockInfo.revData) { // Fallback to check if generic data loaded, maybe no divs
      // Don't add if no divs
    }
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
  const processDividends = (events: DividendEvent[], interval: 'yearly' | 'quarterly' = 'yearly'): GraphDataItem[] => {
    const data: Record<string, number> = {};
    events.forEach(e => {
      const date = new Date(e.date);
      const year = date.getFullYear();
      let key = year.toString();

      if (interval === 'quarterly') {
        const month = date.getMonth(); // 0-11
        const q = Math.floor(month / 3) + 1;
        key = `${year}Q${q}`;
      }

      if (!data[key]) data[key] = 0;
      data[key] += e.amount;
    });

    // Sort logic
    return Object.keys(data).sort((a, b) => {
      if (interval === 'yearly') return parseInt(a) - parseInt(b);
      // YYYYQx comparison
      const aY = parseInt(a.substring(0, 4));
      const bY = parseInt(b.substring(0, 4));
      if (aY !== bY) return aY - bY;
      const aQ = parseInt(a.substring(5, 6));
      const bQ = parseInt(b.substring(5, 6));
      return aQ - bQ;
    }).map(k => ({ label: k, value: data[k] }));
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
        // Safe return for non-US stocks/crypto instead of throwing
        return { companyName: compName || ticker, cik: null, eps: null, graphData: null, epsData: null, revData: null, incomeData: null, assetsData: null, sharesData: null };
      }

      // Fetch dividends from Yahoo in parallel to SEC data (or sequential if easier, but lets do logic here)
      let dividendDataYahoo: GraphDataItem[] = [];
      try {
        // We can fetch dividends for the chart here
        const divs = await fetchDividendHistory(ticker);
        dividendDataYahoo = processDividends(divs, dataInterval);
      } catch (e) {
        console.warn("Failed to fetch dividend history", e);
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
      let paymentsOfDividendsCommon = factsData?.facts?.['us-gaap']?.PaymentsOfDividendsCommonStock?.units?.['USD']; // Alternative element
      let currentLiabilities = factsData?.facts?.['us-gaap']?.LiabilitiesCurrent?.units?.['USD'];
      let roicData: any[] | null = null;
      let calculatedRate: number | null = null;
      let skip = false;

      // --- Calculate Fundamentals-Based Dividend Yield (Requested User Method) ---
      // Method: Total Dividends Paid (TTM) / Shares Outstanding
      if (sharesData && (dividendData || paymentsOfDividendsCommon)) {
        const divsToUse = dividendData || paymentsOfDividendsCommon;
        // Get TTM Dividends (Sum of last 4 quarters)
        const divPayments = getInfo(divsToUse, 'quarterly', true); // isFlow=true
        // Sort by date/label to ensure we get latest
        divPayments.sort((a, b) => { // a.label is YYYYQx
          const aY = parseInt(a.label.substring(0, 4));
          const bY = parseInt(b.label.substring(0, 4));
          if (aY !== bY) return aY - bY;
          const aQ = parseInt(a.label.substring(5, 6));
          const bQ = parseInt(b.label.substring(5, 6));
          return aQ - bQ;
        });

        // Get Shares Outstanding (Latest Point-in-Time)
        const sharesPoints = getInfo(sharesData, 'quarterly', false); // isFlow=false (Balance Sheet)
        sharesPoints.sort((a, b) => {
          const aY = parseInt(a.label.substring(0, 4));
          const bY = parseInt(b.label.substring(0, 4));
          if (aY !== bY) return aY - bY;
          // handle Q? or just sort by year? getInfo returns YYYYQX.
          // Actually getInfo handles sorting mostly, explicitly sort to be safe
          const aQ = parseInt(a.label.substring(5, 6));
          const bQ = parseInt(b.label.substring(5, 6));
          return aQ - bQ;
        });

        if (divPayments.length >= 4 && sharesPoints.length > 0) {
          // Sum last 4 quarters
          const last4 = divPayments.slice(-4);

          // --- Strict Freshness & Consecutiveness Check ---
          const now = new Date();
          const latestPoint = last4[3];
          const latestYear = parseInt(latestPoint.label.substring(0, 4));
          const latestQuarter = parseInt(latestPoint.label.substring(5, 6));

          // Latest data should be from within last 12 months approximately
          // If current year is 2026, latest should at least be 2025Q1
          const latestDate = new Date(latestYear, (latestQuarter * 3) - 1);
          const oneYearAgo = new Date();
          oneYearAgo.setFullYear(now.getFullYear() - 1);

          let isConsecutive = true;
          for (let i = 1; i < last4.length; i++) {
            const prev = last4[i - 1].label;
            const curr = last4[i].label;
            const pY = parseInt(prev.substring(0, 4));
            const pQ = parseInt(prev.substring(5, 6));
            const cY = parseInt(curr.substring(0, 4));
            const cQ = parseInt(curr.substring(5, 6));
            if (!((cY === pY && cQ === pQ + 1) || (cY === pY + 1 && pQ === 4 && cQ === 1))) {
              isConsecutive = false;
              break;
            }
          }

          if (isConsecutive && latestDate >= oneYearAgo) {
            const totalDivsTTM = last4.reduce((sum, item) => sum + item.value, 0);
            const latestShares = sharesPoints[sharesPoints.length - 1].value;

            if (latestShares > 0) {
              calculatedRate = totalDivsTTM / latestShares;
            }
          }
        }
      }
      // --------------------------------------------------------------------------

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
          const liabilities = getInfo(currentLiabilities, dataInterval);
          const assets = getInfo(assetsData, dataInterval);
          const income = getInfo(incomeData, dataInterval, true);
          const investedCapital = getIntersectionAndSumByLabel(assets, liabilities, '-');
          roicData = getIntersectionAndSumByLabel(income, investedCapital, '/');
          skip = true;
        }
      } else {
        currentData = revData; // Default to rev if no filter
      }

      let graphData: GraphDataItem[] = [];
      if (!skip && currentData) {
        let isFlow = false;
        if (['eps', 'revenue', 'net income', 'dividends'].includes(filter || "")) {
          isFlow = true;
        }

        // If filter is 'dividends' and we have Yahoo data, prefer that for "Per Share" view?
        // But currentData is from SEC 'PaymentsOfDividends' (TOTAL $).
        // User wants "Per Share" in bar chart per request. 
        // Yahoo data `dividendDataYahoo` is Per Share.
        // So if filter is dividends, use Yahoo data if available.
        if (filter === 'dividends' && dividendDataYahoo.length > 0) {
          return {
            companyName: factsData.entityName,
            cik: cik_str,
            eps: null, // epsTTM is calculated later, so we can't use it here easily without duplicating logic. 
            // SEC function returns 'eps', but we are returning early.
            // We can leave it null or try to calculate it if we really need it.
            // 'eps' field in StockInfo seems unused in UI except for debugging?
            // UI uses 'stockQuote.peRatio' or calculates fallback from 'epsData'.
            // 'epsData' string IS passed below.
            graphData: dividendDataYahoo, // Use Yahoo Per Share Data
            epsData: JSON.stringify(epsData),
            revData: JSON.stringify(revData),
            incomeData: JSON.stringify(incomeData),
            assetsData: JSON.stringify(assetsData),
            sharesData: JSON.stringify(sharesData),
            liabilities: JSON.stringify(currentLiabilities),
            roicData: roicData,
            dividendsData: dividendDataYahoo, // Store for options
            calculatedDividendRate: calculatedRate
          };
        }
        graphData = getInfo(currentData, dataInterval, isFlow);
      }

      return {
        companyName: factsData.entityName,
        cik: cik_str,
        eps: epsData ? JSON.stringify(epsData) : null,
        graphData,
        epsData: JSON.stringify(epsData),
        revData: JSON.stringify(revData),
        incomeData: JSON.stringify(incomeData),
        assetsData: JSON.stringify(assetsData),
        sharesData: JSON.stringify(sharesData),
        liabilities: JSON.stringify(currentLiabilities),
        roicData,
        dividendsData: dividendDataYahoo,
        calculatedDividendRate: calculatedRate
      };
    } catch (error: any) {
      logError("Error fetching stock info:", error);
      return { companyName: null, cik: null, eps: null, graphData: null, epsData: null, revData: null, incomeData: null, assetsData: null, sharesData: null };
    }
  };

  // ...

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#f8f9fa' }]}>
      <FlatList
        data={investorInfo}
        keyExtractor={(item, index) => index.toString()}
        renderItem={({ item }) => {
          const initials = item.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
          return (
            <TouchableOpacity
              style={[styles.investorInfoCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#f0f0f0' }]}
              onPress={() => {
                if (item.cik) {
                  router.push({
                    pathname: '/HoldingsScreen',
                    params: {
                      cik: item.cik,
                      investorName: item.name,
                      institution: item.institution || ''
                    }
                  });
                }
              }}
              activeOpacity={0.7}
            >
              <View style={styles.investorRow}>
                <View style={[styles.investorAvatar, { backgroundColor: isDark ? '#333' : '#f0f0f0' }]}>
                  <Text style={[styles.avatarText, { color: isDark ? '#fff' : '#007AFF' }]}>{initials}</Text>
                </View>
                <View style={styles.investorMainInfo}>
                  <Text style={[styles.investorName, { color: isDark ? '#fff' : '#1a1a1a' }]}>{item.name}</Text>
                  <Text style={[styles.institutionName, { color: isDark ? '#8e8e93' : '#666' }]}>{item.institution}</Text>
                </View>
                <View style={[styles.percentBadge, { backgroundColor: 'rgba(0,122,255,0.1)' }]}>
                  <Text style={styles.percentBadgeText}>{item.percent}</Text>
                </View>
              </View>
              <View style={[styles.holdingDetails, { borderTopColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}>
                <View>
                  <Text style={[styles.detailLabel, { color: isDark ? '#8e8e93' : '#666' }]}>Shares</Text>
                  <Text style={[styles.detailText, { color: isDark ? '#eee' : '#333' }]}>{formatNumberWithCommas(item.numShares)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.detailLabel, { color: isDark ? '#8e8e93' : '#666' }]}>Value</Text>
                  <Text style={[styles.detailText, { color: isDark ? '#eee' : '#333' }]}>{formatCurrency(parseFloat(item.value || '0'), 'USD')}</Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
        ListHeaderComponent={
          <>
            {(loading || error) && (
              <View style={styles.loaderContainer}>
                {loading && <ActivityIndicator size="large" color="#007AFF" />}
                {loading && <Text style={[styles.loaderText, { color: isDark ? '#8e8e93' : '#666' }]}>Fetching Stock Data...</Text>}
                {error && <Text style={[styles.errorText, { color: '#FF3B30' }]}>{error}</Text>}
              </View>
            )}
            {stockInfo && (
              <View>
                <View style={[styles.headerCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#f0f0f0' }]}>
                  <View style={styles.headerTopRow}>
                    <TouchableOpacity
                      style={[styles.backButton, { backgroundColor: isDark ? '#333' : '#fff', borderColor: isDark ? '#444' : '#eee', position: 'absolute', left: 0, zIndex: 10 }]}
                      onPress={() => navigation.goBack()}
                    >
                      <Ionicons name="chevron-back" size={24} color={isDark ? '#fff' : '#007AFF'} />
                    </TouchableOpacity>
                    <Text style={[styles.screenTitle, { color: isDark ? '#fff' : '#1a1a1a' }]} numberOfLines={2} ellipsizeMode={'tail'}>{stockInfo.companyName}</Text>
                  </View>


                  {realTimePrice !== null && (
                    <View style={styles.priceContainer}>
                      <View style={styles.priceValueWrapper}>
                        <Text style={[styles.priceValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                          {formatCurrency(realTimePrice, (stockQuote?.currency || 'USD') as any)}
                        </Text>
                        {stockQuote && (
                          <Text style={[styles.priceChange, stockQuote.change >= 0 ? styles.positive : styles.negative]}>
                            {stockQuote.change >= 0 ? '+' : ''}{formatCurrency(stockQuote.change, stockQuote.currency as any)} ({stockQuote.percent.toFixed(2)}%)
                          </Text>
                        )}
                      </View>

                      {stockQuote && (stockQuote.preMarketPrice || stockQuote.postMarketPrice) && (
                        <View style={styles.extendedHoursContainer}>
                          <Text style={[styles.extendedHoursLabel, { color: isDark ? '#8e8e93' : '#666' }]}>
                            {stockQuote.marketState === 'PRE' ? 'Pre-Market ' : 'After-Hours '}
                          </Text>
                          {(() => {
                            const price = stockQuote.marketState === 'PRE' ? stockQuote.preMarketPrice : stockQuote.postMarketPrice;
                            if (!price) return null;
                            const diff = price - (realTimePrice || 0);
                            const perc = (realTimePrice || 0) > 0 ? (diff / (realTimePrice || 0)) * 100 : 0;
                            return (
                              <Text style={[styles.extendedHoursValue, diff >= 0 ? styles.positiveSmall : styles.negativeSmall]}>
                                {formatCurrency(price, (stockQuote.currency || 'USD') as any)} {diff >= 0 ? '+' : ''}{diff.toFixed(2)} ({perc.toFixed(2)}%)
                              </Text>
                            );
                          })()}
                        </View>
                      )}
                    </View>
                  )}

                  {stockQuote && (
                    <View style={[styles.statsGrid, { borderTopColor: isDark ? '#333' : '#f0f0f0', borderBottomColor: isDark ? '#333' : '#f0f0f0' }]}>
                      {(() => {
                        const mCap = stockQuote.marketCap;
                        let fallbackMCap = null;
                        if (stockInfo?.sharesData && isDataRecent(stockInfo.sharesData)) {
                          const sharesLatest = getLatestValue(stockInfo.sharesData);
                          if (realTimePrice && sharesLatest && sharesLatest > 0) {
                            fallbackMCap = realTimePrice * sharesLatest;
                          }
                        }
                        const displayMCap = (mCap && mCap > 0) ? mCap : fallbackMCap;
                        const pe = stockQuote.peRatio;
                        let fallbackPE = null;
                        if (!pe && stockInfo?.epsData && isDataRecent(stockInfo.epsData)) {
                          const quarterlyEpsData = getInfo(stockInfo.epsData, 'quarterly', true, false);
                          if (quarterlyEpsData.length >= 4) {
                            const last4 = quarterlyEpsData.slice(-4);
                            let isConsecutive = true;
                            for (let i = 1; i < last4.length; i++) {
                              const prevY = parseInt(last4[i - 1].label.substring(0, 4));
                              const prevQ = parseInt(last4[i - 1].label.substring(5, 6));
                              const currY = parseInt(last4[i].label.substring(0, 4));
                              const currQ = parseInt(last4[i].label.substring(5, 6));
                              if (!((currY === prevY && currQ === prevQ + 1) || (currY === prevY + 1 && prevQ === 4 && currQ === 1))) {
                                isConsecutive = false;
                                break;
                              }
                            }
                            if (isConsecutive) {
                              const epsTTM = last4.reduce((sum, item) => sum + item.value, 0);
                              if (realTimePrice && epsTTM > 0) fallbackPE = realTimePrice / epsTTM;
                            }
                          }
                        }
                        const displayPE = (pe && pe > 0) ? pe : fallbackPE;
                        let yieldVal = stockQuote?.dividendYield;
                        let rateVal = stockQuote?.dividendRate;
                        if (!rateVal && stockInfo?.calculatedDividendRate) {
                          rateVal = stockInfo.calculatedDividendRate;
                          if (realTimePrice && realTimePrice > 0) yieldVal = (rateVal / realTimePrice) * 100;
                        }
                        return (
                          <>
                            <View style={styles.statItem}>
                              <Text style={[styles.statLabel, { color: isDark ? '#8e8e93' : '#666' }]}>MCap</Text>
                              <Text style={[styles.statValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                                {displayMCap ? formatAbbreviated(displayMCap) : '-'}
                              </Text>
                            </View>
                            <View style={styles.statItem}>
                              <Text style={[styles.statLabel, { color: isDark ? '#8e8e93' : '#666' }]}>Vol</Text>
                              <Text style={[styles.statValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                                {stockQuote.volume ? formatAbbreviated(stockQuote.volume) : '-'}
                              </Text>
                            </View>
                            <View style={styles.statItem}>
                              <Text style={[styles.statLabel, { color: isDark ? '#8e8e93' : '#666' }]}>PE</Text>
                              <Text style={[styles.statValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                                {displayPE ? displayPE.toFixed(1) : '-'}
                              </Text>
                            </View>
                            <View style={styles.statItem}>
                              <Text style={[styles.statLabel, { color: isDark ? '#8e8e93' : '#666' }]}>Yield</Text>
                              <Text style={[styles.statValue, { color: isDark ? '#fff' : '#1a1a1a' }]} numberOfLines={1} adjustsFontSizeToFit>
                                {rateVal && yieldVal ? `${rateVal.toFixed(2)} (${yieldVal.toFixed(2)}%)` : (yieldVal ? `${yieldVal.toFixed(2)}%` : '-')}
                              </Text>
                            </View>
                          </>
                        );
                      })()}
                    </View>
                  )}
                </View>

                <View style={[styles.historyChartContainer, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#f0f0f0' }]}>
                  <View style={[styles.chartControls, { backgroundColor: isDark ? '#000' : '#f0f0f0' }]}>
                    {(['1D', '1W', '1M', 'YTD', '1Y', '5Y', 'ALL'] as const).map((range) => (
                      <TouchableOpacity
                        key={range}
                        style={[styles.historyRangeChip, priceHistoryRange === range && (isDark ? styles.historyRangeChipActiveDark : styles.historyRangeChipActive)]}
                        onPress={() => setPriceHistoryRange(range)}
                      >
                        <Text style={[styles.historyRangeText, { color: isDark ? '#8e8e93' : '#666' }, priceHistoryRange === range && styles.historyRangeTextActive]}>
                          {range}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {priceHistoryLoading ? (
                    <View style={{ height: 180, justifyContent: 'center', alignItems: 'center' }}>
                      <ActivityIndicator color="#007AFF" />
                    </View>
                  ) : (
                    <StockLineChart
                      data={priceHistory}
                      range={priceHistoryRange}
                      isDark={isDark}
                      height={180}
                      previousClose={stockQuote?.previousClose}
                      formatValue={(val) => formatCurrency(val, (stockQuote?.currency || 'USD') as any)}
                    />
                  )}
                </View>

                {existingHolding && existingHolding.shares > 0 && (
                  <View style={[styles.positionCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#f0f0f0' }]}>
                    <Text style={[styles.positionTitle, { color: isDark ? '#8e8e93' : '#333' }]}>Your Position</Text>
                    <View style={styles.positionGrid}>
                      <View style={styles.positionItem}>
                        <Text style={[styles.positionLabel, { color: isDark ? '#8e8e93' : '#666' }]}>Shares</Text>
                        <Text style={[styles.positionValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>{existingHolding.shares.toLocaleString()}</Text>
                      </View>
                      <View style={styles.positionItem}>
                        <Text style={[styles.positionLabel, { color: isDark ? '#8e8e93' : '#666' }]}>Cost Basis</Text>
                        <Text style={[styles.positionValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                          {formatCurrency(existingHolding.costBasis || 0, (existingHolding.currency || 'USD') as any)}
                        </Text>
                      </View>
                      <View style={styles.positionItem}>
                        <Text style={[styles.positionLabel, { color: isDark ? '#8e8e93' : '#666' }]}>Value</Text>
                        <Text style={[styles.positionValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                          {formatCurrency((realTimePrice || 0) * existingHolding.shares, (stockQuote?.currency || 'USD') as any)}
                        </Text>
                      </View>
                      <View style={styles.positionItem}>
                        <Text style={[styles.positionLabel, { color: isDark ? '#8e8e93' : '#666' }]}>Unrealized P&L</Text>
                        {(() => {
                          const currentVal = (realTimePrice || 0) * existingHolding.shares;
                          const cost = (existingHolding.costBasis || 0) * existingHolding.shares;
                          const profit = currentVal - cost;
                          const profitPercent = cost > 0 ? (profit / cost) * 100 : 0;
                          return (
                            <Text style={[styles.positionValue, profit >= 0 ? styles.positiveText : styles.negativeText]}>
                              {profit >= 0 ? '+' : '-'}{formatCurrency(Math.abs(profit), (existingHolding.currency || 'USD') as any)}
                              {"\n"}
                              <Text style={styles.positionSubValue}>({profit >= 0 ? '+' : ''}{profitPercent.toFixed(2)}%)</Text>
                            </Text>
                          );
                        })()}
                      </View>
                    </View>
                  </View>
                )}

                <TouchableOpacity
                  style={[styles.addToPortfolioButton, existingHolding ? styles.managePortfolioButton : null]}
                  onPress={handleAddToPortfolio}
                >
                  <Text style={styles.addToPortfolioText}>
                    {existingHolding ? `Manage: ${existingHolding.shares} Shares` : '+ Add to Portfolio'}
                  </Text>
                </TouchableOpacity>

                {stockInfo.graphData && stockInfo.graphData.length > 0 && (
                  <>
                    <Text style={[styles.sectionTitle, { color: isDark ? '#fff' : '#1a1a1a' }]}>Financial Trends</Text>
                    <View style={styles.controlsContainer}>
                      <View style={[styles.dropdownContainer, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#f0f0f0' }]}>
                        <Dropdown
                          style={styles.dropdown}
                          placeholderStyle={[styles.dropdownItem, { color: isDark ? '#8e8e93' : '#333' }]}
                          selectedTextStyle={[styles.dropdownItem, { color: isDark ? '#fff' : '#333' }]}
                          itemTextStyle={{ color: isDark ? '#eee' : '#333' }}
                          containerStyle={{ backgroundColor: isDark ? '#1a1a1a' : '#fff', borderWidth: 0, borderRadius: 12, overflow: 'hidden' }}
                          activeColor={isDark ? '#333' : '#f0f0f0'}
                          data={dropdownOptions}
                          maxHeight={300}
                          labelField="label"
                          valueField="value"
                          placeholder="Select metric"
                          value={selectedValue}
                          onChange={item => {
                            setSelectedValue(item.value);
                            setFilterType(item.value);
                          }}
                        />
                      </View>

                      <View style={[styles.toggleContainer, { backgroundColor: isDark ? '#1a1a1a' : '#f0f0f0' }]}>
                        <TouchableOpacity
                          style={[styles.toggleButton, dataInterval === 'yearly' && [styles.toggleButtonActive, isDark && styles.historyRangeChipActiveDark]]}
                          onPress={() => setDataInterval('yearly')}
                        >
                          <Text style={[styles.toggleText, { color: isDark ? '#8e8e93' : '#666' }, dataInterval === 'yearly' && styles.toggleTextActive]}>Yearly</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.toggleButton, dataInterval === 'quarterly' && [styles.toggleButtonActive, isDark && styles.historyRangeChipActiveDark]]}
                          onPress={() => setDataInterval('quarterly')}
                        >
                          <Text style={[styles.toggleText, { color: isDark ? '#8e8e93' : '#666' }, dataInterval === 'quarterly' && styles.toggleTextActive]}>Quarterly</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    <Text style={[styles.graphTitle, { color: isDark ? '#8e8e93' : '#8e8e93' }]}>
                      {selectedValue ? dropdownOptions.find(o => o.value === selectedValue)?.label : 'Revenue'}
                    </Text>
                    {(() => {
                      const allData = stockInfo.graphData!;
                      const totalItems = allData.length;
                      const end = totalItems - (chartPage * itemsPerPage);
                      const start = Math.max(0, end - itemsPerPage);
                      const visibleData = allData.slice(start, end);
                      const globalMin = Math.min(0, ...allData.map(d => d.value));
                      const globalMax = Math.max(0, ...allData.map(d => d.value));

                      return (
                        <>
                          <BarChart
                            data={visibleData}
                            globalMin={globalMin}
                            globalMax={globalMax}
                          />
                          <View style={styles.paginationContainer}>
                            <TouchableOpacity
                              style={[styles.pageButton, start <= 0 && styles.pageButtonDisabled]}
                              onPress={() => setChartPage(p => p + 1)}
                              disabled={start <= 0}
                            >
                              <Ionicons name="chevron-back" size={20} color={start <= 0 ? (isDark ? '#444' : '#ccc') : '#007AFF'} />
                            </TouchableOpacity>

                            <Text style={styles.pageIndicator}>Page {chartPage + 1}</Text>

                            <TouchableOpacity
                              style={[styles.pageButton, chartPage === 0 && styles.pageButtonDisabled]}
                              onPress={() => setChartPage(p => Math.max(0, p - 1))}
                              disabled={chartPage === 0}
                            >
                              <Ionicons name="chevron-forward" size={20} color={chartPage === 0 ? (isDark ? '#444' : '#ccc') : '#007AFF'} />
                            </TouchableOpacity>
                          </View>
                        </>
                      );
                    })()}
                  </>
                )}
              </View>
            )}

            {investorInfo && investorInfo.length > 0 && (
              <Text style={[styles.investorCardTitle, { color: isDark ? '#fff' : '#1a1a1a' }]}>Top Institutional Holders</Text>
            )}
          </>
        }
        contentContainerStyle={styles.scrollViewContent}
      />

      <TransactionModal
        isVisible={isPortfolioModalVisible}
        onClose={() => setIsPortfolioModalVisible(false)}
        symbol={stockSymbol}
        companyName={stockInfo?.companyName || stockSymbol}
        currency={stockQuote?.currency || 'USD'}
        existingShares={existingHolding?.shares || 0}
        initialMode={existingHolding ? portfolioMode : 'buy'}
        onSuccess={async () => {
          const updated = await getHolding(stockSymbol);
          setExistingHolding(updated);
        }}
        currentPrice={realTimePrice || stockQuote?.price}
      />

    </View>
  );
};


const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollViewContent: {
    paddingBottom: 40,
  },
  loaderContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderText: {
    marginTop: 12,
    fontSize: 15,
    fontWeight: '600',
  },
  errorText: {
    textAlign: 'center',
    marginTop: 20,
    fontSize: 15,
    fontWeight: '600',
  },
  // Header Section
  headerCard: {
    paddingTop: 24,
    paddingHorizontal: 20,
    paddingBottom: 28,
    marginHorizontal: 20,
    marginTop: Platform.OS === 'ios' ? 60 : 40,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
    borderWidth: 1,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    minHeight: 44,
    position: 'relative',
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    width: '100%',
    paddingHorizontal: 54, // Clear space for back button (44 width + margin)
  },
  priceContainer: {
    marginBottom: 8,
    alignItems: 'center',
  },
  priceValueWrapper: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  priceValue: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -1,
  },
  priceChange: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  extendedHoursContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  extendedHoursLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  extendedHoursValue: {
    fontSize: 13,
    fontWeight: '800',
    marginLeft: 6,
  },
  positive: { color: '#34C759' },
  negative: { color: '#FF3B30' },
  positiveSmall: { color: '#34C759' },
  negativeSmall: { color: '#FF3B30' },
  positiveText: { color: '#34C759' },
  negativeText: { color: '#FF3B30' },

  // Stats Grid
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '800',
  },

  // Charts Section
  historyChartContainer: {
    marginTop: 24,
    marginHorizontal: 20,
    padding: 20,
    borderRadius: 28,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 15,
    elevation: 5,
  },
  chartControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 6,
    borderRadius: 14,
    marginBottom: 24,
  },
  historyRangeChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyRangeChipActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  historyRangeChipActiveDark: {
    backgroundColor: '#2c2c2e',
  },
  historyRangeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  historyRangeTextActive: {
    color: '#007AFF',
  },

  // Position Card
  positionCard: {
    marginTop: 24,
    marginHorizontal: 20,
    padding: 24,
    borderRadius: 28,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 8,
  },
  positionTitle: {
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 20,
  },
  positionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 20,
  },
  positionItem: {
    width: '45%',
  },
  positionLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  positionValue: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  positionSubValue: {
    fontSize: 12,
    fontWeight: '700',
  },

  // Buttons
  addToPortfolioButton: {
    backgroundColor: '#007AFF',
    marginHorizontal: 20,
    marginTop: 24,
    height: 56,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 15,
    elevation: 5,
  },
  managePortfolioButton: {
    backgroundColor: '#34C759',
    shadowColor: '#34C759',
  },
  addToPortfolioText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
  },

  // Trends Section
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginHorizontal: 20,
    marginTop: 40,
    marginBottom: 20,
  },
  controlsContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 24,
    gap: 12,
  },
  dropdownContainer: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    paddingLeft: 4,
  },
  dropdown: {
    height: 46,
    paddingHorizontal: 12,
  },
  dropdownItem: {
    fontSize: 14,
    fontWeight: '600',
  },
  toggleContainer: {
    flex: 1,
    flexDirection: 'row',
    height: 48,
    borderRadius: 14,
    padding: 4,
  },
  toggleButton: {
    flex: 1,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleButtonActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  toggleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  toggleTextActive: {
    color: '#007AFF',
  },
  graphTitle: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 20,
  },
  paginationContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 24,
    gap: 16,
  },
  pageButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(0,122,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageButtonDisabled: {
    opacity: 0.3,
  },
  buttonText: {
    fontSize: 18,
    color: '#007AFF',
    fontWeight: '700',
  },
  pageIndicator: {
    fontSize: 13,
    fontWeight: '800',
    color: '#8e8e93',
  },

  // Investors List
  investorCardTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 20,
  },
  investorInfoCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  investorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  investorAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '800',
  },
  investorMainInfo: {
    flex: 1,
  },
  percentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  percentBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#007AFF',
  },
  investorItem: {
    gap: 4,
  },
  investorName: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  institutionName: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
  },
  holdingDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  detailLabel: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailText: {
    fontSize: 13,
    fontWeight: '800',
  },
  invLoading: {
    padding: 40,
    alignItems: 'center',
  },
  noDataText: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
    fontStyle: 'italic',
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    padding: 32,
    paddingBottom: 48,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  modeTabs: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 4,
    marginBottom: 32,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  modeTabActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  modeTabActiveDark: {
    backgroundColor: '#2c2c2e',
  },
  modeTabText: {
    fontSize: 14,
    fontWeight: '700',
  },
  modeTabTextActive: {
    color: '#007AFF',
    fontWeight: '900',
  },
  modalForm: {
    gap: 4,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  modalInput: {
    height: 56,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 16,
    fontWeight: '700',
  },
  datePickerTrigger: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 56,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 24,
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 56,
    borderRadius: 16,
    paddingHorizontal: 16,
    marginBottom: 32,
  },
  dateLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  datePickerText: {
    fontSize: 15,
    fontWeight: '800',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  modalButton: {
    flex: 1,
    height: 56,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: 'rgba(142,142,147,0.12)',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '800',
  },
  saveButton: {
    backgroundColor: '#007AFF',
    height: 58,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  datePickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  datePickerContent: {
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 44 : 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  bottomSheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(142,142,147,0.3)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  datePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 12,
  },
  datePickerTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
});



export default SearchResultsScreen;