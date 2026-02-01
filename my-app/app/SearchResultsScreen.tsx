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
import { secFetch, fetchStockPrice, StockQuote, fetchStockHistory, HistoryPoint, fetchPriceForDate } from '@/utils/secApi';
import StockLineChart from '@/components/StockLineChart';
import { debug, info, warn, error as logError } from '@/utils/logger';
import * as SQLite from 'expo-sqlite';
import cheerio from 'react-native-cheerio'; // Import cheerio
import { XMLParser } from 'fast-xml-parser';
import { addHolding, getHolding, PortfolioHolding, Transaction, getTransactions, updateTransaction, deleteTransaction } from '@/utils/db';
import DateTimePicker from '@react-native-community/datetimepicker';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '@/context/ThemeContext';
import { formatCurrency, convertCurrency } from '@/utils/currency';
import TransactionList from '@/components/TransactionList';



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
  const [priceHistoryRange, setPriceHistoryRange] = useState<'1D' | '1W' | '1M' | '1Y' | '5Y' | 'ALL'>('1M');
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);

  const [isPortfolioModalVisible, setIsPortfolioModalVisible] = useState(false);
  const [sharesToAdd, setSharesToAdd] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingHolding, setExistingHolding] = useState<PortfolioHolding | null>(null);
  const [portfolioMode, setPortfolioMode] = useState<'buy' | 'sell' | 'history'>('buy');
  const [transactionDate, setTransactionDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isPriceLoading, setIsPriceLoading] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

  const fetchTransactions = async (symbol: string) => {
    try {
      const txs = await getTransactions(symbol);
      setTransactions(txs);
    } catch (e) {
      console.error("Error fetching transactions:", e);
    }
  };

  const handleEditTransaction = (tx: Transaction) => {
    setEditingTransaction(tx);
    setPortfolioMode(tx.type as 'buy' | 'sell');
    setSharesToAdd(tx.shares.toString());
    setPurchasePrice(tx.price.toString());
    setTransactionDate(new Date(tx.date));
  };

  const handleDeleteTransaction = (tx: Transaction) => {
    Alert.alert(
      "Delete Transaction",
      "Are you sure you want to delete this transaction?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              if (tx.id) {
                await deleteTransaction(tx.id);
                if (stockSymbol) fetchTransactions(stockSymbol);
                // Refresh holding data
                const holding = await getHolding(stockSymbol);
                setExistingHolding(holding);
              }
            } catch (e) {
              Alert.alert("Error", "Failed to delete transaction.");
            }
          }
        }
      ]
    );
  };

  // Auto-update price when date changes
  useEffect(() => {
    if (!isPortfolioModalVisible || !stockSymbol || portfolioMode === 'history') return;

    const isToday = (d: Date) => {
      const now = new Date();
      return d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear();
    };

    if (isToday(transactionDate)) return;

    const timer = setTimeout(async () => {
      setIsPriceLoading(true);
      try {
        const price = await fetchPriceForDate(stockSymbol, transactionDate);
        if (price !== null) {
          setPurchasePrice(price.toString());
        }
      } catch (err) {
        console.error("Error auto-fetching price:", err);
      } finally {
        setIsPriceLoading(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [transactionDate, stockSymbol, isPortfolioModalVisible]);
  const [page, setPage] = useState(0);
  const itemsPerPage = 12;

  const dynamicStyles = StyleSheet.create({
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
  });

  const handleAddToPortfolio = () => {
    setEditingTransaction(null);
    if (existingHolding) {
      setSharesToAdd('');
      fetchTransactions(stockSymbol);
      // Don't prefill if managing existing, unless we want to be helpful. 
      // But clearing is safer for new transaction.
      // Actually previous logic was: setSharesToAdd(existingHolding.shares.toString()) ... 
      // That seems wrong for adding MORE. It implies editing the total? 
      // The previous logic pre-filled assuming user might want to edit? 
      // Or maybe it was just a default. Let's start fresh for add/sell.
      const startPrice = realTimePrice || 0;
      setPurchasePrice(startPrice > 0 ? startPrice.toFixed(2) : '');
    } else {
      setSharesToAdd('');
      const convertedPrice = realTimePrice || 0;
      setPurchasePrice(convertedPrice > 0 ? convertedPrice.toFixed(2) : '');
    }
    setTransactionDate(new Date());
    setPortfolioMode('buy');
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
        case '1M': range = '1mo'; interval = '1d'; break;
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
            setPurchasePrice(q.price.toString());
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
        // Safe return for non-US stocks/crypto instead of throwing
        return { companyName: compName || ticker, cik: null, eps: null, graphData: null, epsData: null, revData: null, incomeData: null, assetsData: null, sharesData: null };
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
        graphData = getInfo(currentData, dataInterval, isFlow);
      }

      return { roicData, liabilities: currentLiabilities, companyName: compName, cik: cik_str, graphData, epsData, revData, incomeData, assetsData, sharesData, eps: epsData ?? null } as StockInfo;
    } catch (error: any) {
      logError("Error fetching stock info:", error);
      return { companyName: null, cik: null, eps: null, graphData: null, epsData: null, revData: null, incomeData: null, assetsData: null, sharesData: null };
    }
  };

  // ...

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#121212' : '#f8f9fa' }]}>
      <FlatList
        data={investorInfo}
        keyExtractor={(item, index) => index.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.investorInfoCard, { backgroundColor: isDark ? '#1e1e1e' : '#fff', borderColor: isDark ? '#333' : '#eee' }]}
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
            <View style={styles.investorItem}>
              <Text style={[styles.investorName, { color: isDark ? '#fff' : '#1a1a1a' }]}>{item.name}</Text>
              <Text style={[styles.institutionName, { color: isDark ? '#aaa' : '#666' }]}>{item.institution}</Text>
              <View style={styles.holdingDetails}>
                <Text style={{ color: isDark ? '#eee' : '#333' }}>Shares: {formatNumberWithCommas(item.numShares)}</Text>
                <Text style={{ color: isDark ? '#eee' : '#333' }}>Value: {formatCurrency(parseFloat(item.value || '0'), 'USD')}</Text>
                <Text style={{ color: isDark ? '#eee' : '#333' }}>Portfolio %: {item.percent}</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
        ListHeaderComponent={
          <>
            <View style={dynamicStyles.centered}>
              {loading && <ActivityIndicator size="large" color="#007AFF" />}
              {loading && <Text style={{ marginTop: 12, color: isDark ? '#aaa' : '#666' }}>Fetching Stock Data...</Text>}
            </View>
            {error && <Text style={[styles.errorText, { color: '#FF3B30' }]}>{error}</Text>}
            {stockInfo && (
              <View>
                <View style={[styles.card, { backgroundColor: isDark ? '#121212' : '#f8f9fa' }]}>
                  <View style={styles.titleRow}>
                    <TouchableOpacity
                      style={styles.backButton}
                      onPress={() => navigation.goBack()}
                    >
                      <Text style={[styles.backButtonText, { color: isDark ? '#fff' : '#007AFF' }]}>←</Text>
                    </TouchableOpacity>
                    <Text style={[styles.title, { color: isDark ? '#fff' : '#1a1a1a' }]}>{stockInfo.companyName}</Text>
                  </View>

                  {realTimePrice !== null && (
                    <View style={styles.priceContainer}>
                      <View style={styles.priceValueWrapper}>
                        <Text style={[styles.priceValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                          {formatCurrency(realTimePrice, (stockQuote?.currency || 'USD') as any)}
                        </Text>
                        {stockQuote && (
                          <Text style={[styles.priceChange, stockQuote.change >= 0 ? styles.positive : styles.negative]}>
                            {stockQuote.change >= 0 ? '+' : '-'}{formatCurrency(Math.abs(stockQuote.change), stockQuote.currency as any)} ({stockQuote.percent.toFixed(2)}%)
                          </Text>
                        )}
                      </View>
                    </View>
                  )}

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

                  {stockQuote && (
                    <View style={[styles.statsGrid, { borderTopColor: isDark ? '#333' : '#f1f1f1', borderBottomColor: isDark ? '#333' : '#f1f1f1' }]}>
                      {(() => {
                        const mCap = stockQuote.marketCap;

                        // Calculate fallback Market Cap with strict validation
                        let fallbackMCap = null;
                        if (stockInfo?.sharesData && isDataRecent(stockInfo.sharesData)) {
                          const sharesLatest = getLatestValue(stockInfo.sharesData);
                          // Ensure we have a valid positive share count
                          if (realTimePrice && sharesLatest && sharesLatest > 0) {
                            fallbackMCap = realTimePrice * sharesLatest;
                          }
                        }

                        // Strict MCap display: Prefer Quote, fallback to calculated if Quote is missing/invalid
                        const displayMCap = (mCap && mCap > 0) ? mCap : fallbackMCap;

                        const pe = stockQuote.peRatio;

                        // Calculate TTM EPS using discrete quarterly values from getInfo
                        // Strict validation: recent data AND at least 4 consecutive quarters avail (no gaps)
                        let fallbackPE = null;
                        if (!pe && stockInfo?.epsData && isDataRecent(stockInfo.epsData)) {
                          // Get quarterly data WITHOUT filling gaps to ensure we have real data
                          const quarterlyEpsData = getInfo(stockInfo.epsData, 'quarterly', true, false);
                          if (quarterlyEpsData.length >= 4) {
                            // Sum exactly the last 4 quarters for TTM
                            const last4 = quarterlyEpsData.slice(-4);

                            // Verify consecutiveness
                            let isConsecutive = true;
                            for (let i = 1; i < last4.length; i++) {
                              const prev = last4[i - 1].label;
                              const curr = last4[i].label;
                              // Parse YYYYQx
                              const prevY = parseInt(prev.substring(0, 4));
                              const prevQ = parseInt(prev.substring(5, 6));
                              const currY = parseInt(curr.substring(0, 4));
                              const currQ = parseInt(curr.substring(5, 6));

                              const prevOrd = prevY * 4 + (prevQ - 1);
                              const currOrd = currY * 4 + (currQ - 1);

                              if (currOrd !== prevOrd + 1) {
                                isConsecutive = false;
                                break;
                              }
                            }

                            if (isConsecutive) {
                              const epsTTM = last4.reduce((sum, item) => sum + item.value, 0);
                              // Only calculate P/E if EPS TTM is positive
                              if (realTimePrice && epsTTM > 0) {
                                fallbackPE = realTimePrice / epsTTM;
                              }
                            }
                          }
                        }

                        // Strict PE display
                        const displayPE = (pe && pe > 0) ? pe : fallbackPE;

                        return (
                          <>
                            <View style={styles.statItem}>
                              <Text style={[styles.statLabel, { color: isDark ? '#aaa' : '#666' }]}>MCap</Text>
                              <Text style={[styles.statValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                                {displayMCap ? formatAbbreviated(displayMCap) : '-'}
                              </Text>
                            </View>
                            <View style={styles.statItem}>
                              <Text style={[styles.statLabel, { color: isDark ? '#aaa' : '#666' }]}>Vol</Text>
                              <Text style={[styles.statValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                                {stockQuote.volume ? formatAbbreviated(stockQuote.volume) : '-'}
                              </Text>
                            </View>
                            <View style={styles.statItem}>
                              <Text style={[styles.statLabel, { color: isDark ? '#aaa' : '#666' }]}>PE</Text>
                              <Text style={[styles.statValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                                {displayPE ? displayPE.toFixed(1) : '-'}
                              </Text>
                            </View>

                          </>
                        );
                      })()}
                    </View>
                  )}

                  <View style={[styles.historyChartContainer, { backgroundColor: isDark ? '#1e1e1e' : '#fff' }]}>
                    <View style={[styles.priceHistoryRangeContainer, { backgroundColor: isDark ? '#000' : '#f0f0f0' }]}>
                      {(['1D', '1W', '1M', '1Y', '5Y', 'ALL'] as const).map((range) => (
                        <TouchableOpacity
                          key={range}
                          style={[styles.historyRangeChip, priceHistoryRange === range && (isDark ? styles.historyRangeChipActiveDark : styles.historyRangeChipActive)]}
                          onPress={() => setPriceHistoryRange(range)}
                        >
                          <Text style={[styles.historyRangeText, { color: isDark ? '#aaa' : '#666' }, priceHistoryRange === range && styles.historyRangeTextActive]}>
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
                    <View style={[styles.positionCard, { backgroundColor: isDark ? '#1e1e1e' : '#fff', borderColor: isDark ? '#333' : '#eee' }]}>
                      <Text style={[styles.positionTitle, { color: isDark ? '#fff' : '#333' }]}>Your Position</Text>
                      <View style={styles.positionGrid}>
                        <View style={styles.positionItem}>
                          <Text style={[styles.positionLabel, { color: isDark ? '#aaa' : '#666' }]}>Shares</Text>
                          <Text style={[styles.positionValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>{existingHolding.shares.toLocaleString()}</Text>
                        </View>
                        <View style={styles.positionItem}>
                          <Text style={[styles.positionLabel, { color: isDark ? '#aaa' : '#666' }]}>Cost Basis</Text>
                          <Text style={[styles.positionValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                            {formatCurrency(existingHolding.costBasis || 0, (existingHolding.currency || 'USD') as any)}
                          </Text>
                        </View>
                        <View style={styles.positionItem}>
                          <Text style={[styles.positionLabel, { color: isDark ? '#aaa' : '#666' }]}>Value</Text>
                          <Text style={[styles.positionValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                            {formatCurrency((realTimePrice || 0) * existingHolding.shares, (stockQuote?.currency || 'USD') as any)}
                          </Text>
                        </View>
                        <View style={styles.positionItem}>
                          <Text style={[styles.positionLabel, { color: isDark ? '#aaa' : '#666' }]}>Unrealized P&L</Text>
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
                </View>

                {stockInfo.graphData && stockInfo.graphData.length > 0 && (
                  <>
                    <Text style={[styles.sectionTitle, { color: isDark ? '#fff' : '#1a1a1a', marginTop: 30 }]}> Trends</Text>
                    <View style={styles.controlsContainer}>
                      <View style={[styles.dropdownContainer, { backgroundColor: isDark ? '#1e1e1e' : '#fff', borderColor: isDark ? '#333' : '#e0e0e0' }]}>
                        <Dropdown
                          style={styles.dropdown}
                          placeholderStyle={[styles.dropdownItem, { color: isDark ? '#aaa' : '#333' }]}
                          selectedTextStyle={[styles.dropdownItem, { color: isDark ? '#fff' : '#333' }]}
                          itemTextStyle={{ color: isDark ? '#eee' : '#333' }}
                          containerStyle={{ backgroundColor: isDark ? '#1e1e1e' : '#fff', borderWidth: 0, borderRadius: 12, overflow: 'hidden' }}
                          activeColor={isDark ? '#333' : '#f0f0f0'}
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

                      <View style={[styles.toggleContainer, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
                        <TouchableOpacity
                          style={[styles.toggleButton, dataInterval === 'yearly' && [styles.toggleButtonActive, { backgroundColor: isDark ? '#3A3A3C' : '#fff' }]]}
                          onPress={() => setDataInterval('yearly')}
                        >
                          <Text style={[styles.toggleText, { color: isDark ? '#8E8E93' : '#8E8E93' }, dataInterval === 'yearly' && [styles.toggleTextActive, { color: isDark ? '#fff' : '#000' }]]}>Yearly</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.toggleButton, dataInterval === 'quarterly' && [styles.toggleButtonActive, { backgroundColor: isDark ? '#3A3A3C' : '#fff' }]]}
                          onPress={() => setDataInterval('quarterly')}
                        >
                          <Text style={[styles.toggleText, { color: isDark ? '#8E8E93' : '#666' }, dataInterval === 'quarterly' && [styles.toggleTextActive, { color: isDark ? '#fff' : '#000' }]]}>Quarterly</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    <Text style={styles.graphTitle}>
                      {selectedValue ? dropdownOptions.find(o => o.value === selectedValue)?.label : 'Revenue'}
                    </Text>
                    {(() => {
                      const allData = stockInfo.graphData!;
                      // Using consistent itemsPerPage from component scope
                      const totalItems = allData.length;
                      const totalPages = Math.ceil(totalItems / itemsPerPage);

                      // Slicing from the end (Newest data first)
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
                  <Text style={[styles.cardTitle, { color: isDark ? '#fff' : '#000' }]}>Top Institutional Holders</Text>
                )}
              </View>
            )}
            {!loading && !investorInfo && !error && (
              <View style={styles.invLoading}>
                <ActivityIndicator size="small" color={isDark ? '#eee' : '#999'} />
                <Text style={[styles.noDataText, { color: isDark ? '#aaa' : '#666' }]}>Loading investor data...</Text>
              </View>
            )}
            <Modal
              animationType="slide"
              transparent={true}
              visible={isPortfolioModalVisible}
              onRequestClose={() => setIsPortfolioModalVisible(false)}
            >
              <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); setIsPortfolioModalVisible(false); }}>
                <View style={styles.modalOverlay}>
                  <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                    <View style={[styles.modalContent, { backgroundColor: isDark ? '#1e1e1e' : '#fff', shadowOpacity: isDark ? 0.4 : 0.2 }]}>
                      <Text style={[styles.modalTitle, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                        {existingHolding ? `Manage ${stockSymbol}` : `Add ${stockSymbol} to Portfolio`}
                      </Text>

                      {existingHolding && (
                        <View style={[styles.modeTabs, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f0' }]}>
                          <TouchableOpacity
                            style={[styles.modeTab, portfolioMode === 'buy' && (isDark ? { backgroundColor: '#3a3a3c' } : styles.modeTabActive)]}
                            onPress={() => setPortfolioMode('buy')}
                          >
                            <Text style={[styles.modeTabText, portfolioMode === 'buy' && styles.modeTabTextActive]}>Buy</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.modeTab, portfolioMode === 'sell' && (isDark ? { backgroundColor: '#3a3a3c' } : styles.modeTabActive)]}
                            onPress={() => setPortfolioMode('sell')}
                          >
                            <Text style={[styles.modeTabText, portfolioMode === 'sell' && styles.modeTabTextActive]}>Sell</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.modeTab, portfolioMode === 'history' && (isDark ? { backgroundColor: '#3a3a3c' } : styles.modeTabActive)]}
                            onPress={() => {
                              setPortfolioMode('history');
                              fetchTransactions(stockSymbol);
                            }}
                          >
                            <Text style={[styles.modeTabText, portfolioMode === 'history' && styles.modeTabTextActive]}>History</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {portfolioMode === 'history' ? (
                        <View style={{ height: 350 }}>
                          <TransactionList
                            transactions={transactions}

                            onDelete={handleDeleteTransaction}
                            currency={stockQuote?.currency}
                          />
                          <TouchableOpacity
                            style={[styles.modalButton, styles.cancelButton, { marginTop: 10, alignSelf: 'center', width: '100%', backgroundColor: isDark ? '#3a3a3c' : '#f0f0f0' }]}
                            onPress={() => setIsPortfolioModalVisible(false)}
                          >
                            <Text style={[styles.cancelButtonText, { color: isDark ? '#fff' : '#444' }]}>Close</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <>

                          <TextInput
                            style={[styles.modalInput, { backgroundColor: isDark ? '#2c2c2e' : '#f9f9f9', color: isDark ? '#fff' : '#000', borderColor: isDark ? '#3a3a3c' : '#e0e0e0' }]}
                            placeholder={portfolioMode === 'buy' ? "Number of shares to add" : "Number of shares to sell"}
                            keyboardType="numeric"
                            value={sharesToAdd}
                            onChangeText={setSharesToAdd}
                            placeholderTextColor={isDark ? '#666' : '#999'}
                            autoFocus
                          />

                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
                            <Text style={[styles.inputLabel, { color: isDark ? '#aaa' : '#666', marginBottom: 0 }]}>{portfolioMode === 'buy' ? 'Purchase Price' : 'Sale Price'} ({stockQuote?.currency || 'USD'})</Text>
                            {isPriceLoading && <ActivityIndicator size="small" color="#007AFF" style={{ marginLeft: 8 }} />}
                          </View>
                          <TextInput
                            style={[styles.modalInput, { backgroundColor: isDark ? '#2c2c2e' : '#f9f9f9', color: isDark ? '#fff' : '#000', borderColor: isDark ? '#3a3a3c' : '#e0e0e0' }]}
                            placeholder={`Price per share in ${stockQuote?.currency || 'USD'}`}
                            keyboardType="numeric"
                            value={purchasePrice}
                            onChangeText={setPurchasePrice}
                            placeholderTextColor={isDark ? '#666' : '#999'}
                          />

                          <TouchableOpacity
                            style={[styles.dateRow, { backgroundColor: isDark ? '#2c2c2e' : '#f5f5f5' }]}
                            onPress={() => setShowDatePicker(true)}
                          >
                            <View style={styles.dateLabelGroup}>
                              <MaterialIcons name="calendar-today" size={14} color={isDark ? '#aaa' : '#666'} style={styles.calendarIcon} />
                              <Text style={[styles.inputLabel, { color: isDark ? '#aaa' : '#666', marginBottom: 0 }]}>Transaction Date</Text>
                            </View>
                            <Text style={[styles.datePickerText, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                              {transactionDate.toLocaleDateString()}
                            </Text>
                          </TouchableOpacity>

                          {showDatePicker && (
                            <Modal
                              transparent={true}
                              animationType="fade"
                              visible={showDatePicker}
                              onRequestClose={() => setShowDatePicker(false)}
                            >
                              <TouchableOpacity
                                style={styles.datePickerOverlay}
                                activeOpacity={1}
                                onPress={() => setShowDatePicker(false)}
                              >
                                <View style={[styles.datePickerContent, { backgroundColor: isDark ? '#1e1e1e' : '#fff' }]}>
                                  <DateTimePicker
                                    value={transactionDate}
                                    mode="date"
                                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                                    onChange={(event, selectedDate) => {
                                      setShowDatePicker(false);
                                      if (selectedDate) setTransactionDate(selectedDate);
                                    }}
                                    maximumDate={new Date()}
                                    themeVariant={isDark ? "dark" : "light"}
                                  />
                                </View>
                              </TouchableOpacity>
                            </Modal>
                          )}

                          <View style={styles.modalButtons}>
                            <TouchableOpacity
                              style={[styles.modalButton, styles.cancelButton, { backgroundColor: isDark ? '#3a3a3c' : '#f0f0f0' }]}
                              onPress={() => {
                                setIsPortfolioModalVisible(false);
                                setSharesToAdd('');
                                setEditingTransaction(null);
                              }}
                            >
                              <Text style={[styles.cancelButtonText, { color: isDark ? '#fff' : '#444' }]}>Cancel</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.modalButton, styles.saveButton]}
                              disabled={isSubmitting}
                              onPress={async () => {
                                const shares = parseFloat(sharesToAdd);
                                const priceInLocal = parseFloat(purchasePrice);

                                if (isNaN(shares) || shares <= 0) {
                                  Alert.alert("Invalid input", "Please enter a valid number of shares.");
                                  return;
                                }

                                if (isNaN(priceInLocal) || priceInLocal <= 0) {
                                  Alert.alert("Invalid input", "Please enter a valid price.");
                                  return;
                                }

                                setIsSubmitting(true);
                                try {
                                  if (editingTransaction) {
                                    await updateTransaction(editingTransaction.id!, {
                                      type: portfolioMode as 'buy' | 'sell',
                                      shares: shares,
                                      price: priceInLocal,
                                      date: transactionDate.toISOString()
                                    });
                                    Alert.alert("Success", "Transaction updated.");

                                    // Refresh holding
                                    const holding = await getHolding(stockSymbol);
                                    setExistingHolding(holding);

                                    // Go back to history
                                    setPortfolioMode('history');
                                    fetchTransactions(stockSymbol);
                                    setEditingTransaction(null);
                                  } else {
                                    const sharesChange = portfolioMode === 'buy' ? shares : -shares;

                                    // Validate sell amount
                                    if (portfolioMode === 'sell') {
                                      if (!existingHolding || existingHolding.shares < shares) {
                                        Alert.alert("Invalid Transaction", `You cannot sell ${shares} shares because you only own ${existingHolding?.shares || 0}.`);
                                        setIsSubmitting(false);
                                        return;
                                      }
                                    }
                                    // Convert back to USD for storage
                                    const priceInUsd = priceInLocal;

                                    await addHolding({
                                      symbol: stockSymbol,
                                      companyName: stockInfo?.companyName || stockSymbol,
                                      shares: sharesChange,
                                      price: priceInUsd,
                                      currency: stockQuote?.currency || 'USD',
                                      lastTransactionDate: transactionDate.toISOString()
                                    });

                                    Alert.alert("Success", existingHolding ? "Portfolio updated." : `${stockSymbol} added to your portfolio.`);
                                    setIsPortfolioModalVisible(false);
                                    setSharesToAdd('');
                                    setPurchasePrice('');

                                    // Refresh holding in background
                                    const holding = await getHolding(stockSymbol);
                                    setExistingHolding(holding);
                                  }
                                } catch (err) {
                                  console.error("Error updating portfolio:", err);
                                  Alert.alert("Error", "Could not save. Please try again.");
                                } finally {
                                  setIsSubmitting(false);
                                }
                              }}
                            >
                              {isSubmitting ? (
                                <ActivityIndicator size="small" color="#fff" />
                              ) : (
                                <Text style={styles.saveButtonText}>{editingTransaction ? 'Update' : 'Confirm'}</Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        </>
                      )}
                    </View>
                  </TouchableWithoutFeedback>
                </View>
              </TouchableWithoutFeedback>
            </Modal>
          </>
        }
        // ListEmptyComponent={
        //   !loading && investorInfo && investorInfo.length === 0 ? (
        //     <Text style={styles.noDataText}>No investor holdings found.</Text>
        //   ) : null
        // }
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
  historyChartContainer: {
    width: SCREEN_WIDTH - 32,
    marginTop: 20,
    marginBottom: 10,
    padding: 16,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  priceHistoryRangeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 4,
    borderRadius: 12,
    marginBottom: 20,
  },
  historyRangeChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    minWidth: 44,
    alignItems: 'center',
  },
  historyRangeChipActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  historyRangeChipActiveDark: {
    backgroundColor: '#1c1c1e',
  },
  historyRangeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  historyRangeTextActive: {
    color: '#007AFF',
    fontWeight: '700',
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
    color: '#34C759',
  },
  datePickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  datePickerContent: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 10,
    width: '100%',
    maxWidth: 340,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5
  },
  priceValueWrapper: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  priceChange: {
    fontSize: 16,
    fontWeight: '600',
  },
  positive: {
    color: '#34C759',
  },
  negative: {
    color: '#FF3B30',
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
    marginTop: 30,
    marginLeft: 16,
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
    marginTop: 10, // Significantly reduced
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#8E8E93',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'left',
    width: SCREEN_WIDTH - 32,
    alignSelf: 'center',
    marginBottom: 5,
  },

  container: {
    flex: 1,
    paddingTop: 60,
    justifyContent: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: SCREEN_WIDTH - 40,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    marginTop: 10,
    marginBottom: 5,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '800',
  },
  extendedHoursContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -8,
    marginBottom: 8,
  },
  extendedHoursLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  extendedHoursValue: {
    fontSize: 11,
    fontWeight: '700',
  },
  positiveSmall: {
    color: '#34C759',
  },
  negativeSmall: {
    color: '#FF3B30',
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
    width: SCREEN_WIDTH - 32,
    marginTop: 15,
    marginBottom: 10, // Reduced from 20 to be closer to graph
    gap: 12,
  },
  toggleContainer: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 2,
    height: 44,
    width: '48%',
    backgroundColor: '#F2F2F7',
  },
  toggleButton: {
    flex: 1,
    borderRadius: 10,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleButtonActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  dropdownContainer: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    height: 44,
    width: '46%',
    backgroundColor: '#fff',
    justifyContent: 'center',
    marginLeft: 16,
  },
  dropdown: {
    height: 44,
    paddingHorizontal: 12,
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
  positionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    width: SCREEN_WIDTH - 32,
    marginVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  positionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  positionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  positionItem: {
    width: '48%',
    marginBottom: 12,
  },
  positionLabel: {
    fontSize: 11,
    color: '#666',
    fontWeight: '600',
    marginBottom: 2,
  },
  positionValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  positionSubValue: {
    fontSize: 11,
    fontWeight: '600',
  },
  positiveText: {
    color: '#34C759',
  },
  negativeText: {
    color: '#FF3B30',
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
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
    marginTop: 2,
    alignSelf: 'flex-start',
    // width: '100%',
    // paddingLeft: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 20,
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
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 24,
  },
  calendarIcon: {
    marginRight: 8,
  },
  datePickerText: {
    fontSize: 16,
    color: '#1a1a1a',
    fontWeight: '500',
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    marginTop: 10,
  },
  dateLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});


export default SearchResultsScreen;