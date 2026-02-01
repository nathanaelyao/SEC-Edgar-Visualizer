import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, ScrollView, TouchableWithoutFeedback, Keyboard, Platform, Switch } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getPortfolio, removeHolding, updatePrice, addHolding, PortfolioHolding, addPortfolioSnapshot, getPortfolioHistory, PortfolioSnapshot, refreshPortfolioPrices, Transaction, getTransactions, getAllTransactions, updateTransaction, deleteTransaction, addTransaction, getCashBalances, triggerPortfolioSnapshot } from '@/utils/db';
import PieChart from '@/components/PieChart';
import PortfolioLineChart from '@/components/PortfolioLineChart';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import TransactionList from '@/components/TransactionList';
import { fetchStockPrice, fetchPriceForDate, fetchStockHistory } from '@/utils/secApi';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '@/context/ThemeContext';
import { formatCurrency, convertCurrency } from '@/utils/currency';

const PortfolioScreen: React.FC = () => {
    const { isDark, currency, exchangeRates } = useTheme();
    const navigation = useNavigation<any>();
    const [portfolio, setPortfolio] = useState<PortfolioHolding[]>([]);
    const [openPositions, setOpenPositions] = useState<PortfolioHolding[]>([]);
    const [closedPositions, setClosedPositions] = useState<PortfolioHolding[]>([]);
    const [history, setHistory] = useState<PortfolioSnapshot[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRange, setSelectedRange] = useState<'1D' | '1W' | '1M' | 'YTD' | '1Y' | '5Y' | 'ALL'>('ALL');
    const [intradayHistory, setIntradayHistory] = useState<PortfolioSnapshot[]>([]);
    const [isChartLoading, setIsChartLoading] = useState(false);

    // Management Modal State
    const [isManageModalVisible, setIsManageModalVisible] = useState(false);
    const [isHistoryModalVisible, setIsHistoryModalVisible] = useState(false);
    const [globalTransactions, setGlobalTransactions] = useState<Transaction[]>([]);
    const [selectedHolding, setSelectedHolding] = useState<PortfolioHolding | null>(null);
    const [sharesAmount, setSharesAmount] = useState('');
    const [priceAmount, setPriceAmount] = useState('');
    const [manageMode, setManageMode] = useState<'buy' | 'sell' | 'deposit' | 'withdraw' | 'history'>('buy');
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
    const [transactionDate, setTransactionDate] = useState(new Date());
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isPriceLoading, setIsPriceLoading] = useState(false);

    // Cash Management
    const [cashBalance, setCashBalance] = useState(0);
    const [isCashModalVisible, setIsCashModalVisible] = useState(false);
    const [cashAmount, setCashAmount] = useState('');
    const [cashType, setCashType] = useState<'deposit' | 'withdraw'>('deposit');

    // Auto-update price when date changes
    const fetchTransactions = async (symbol: string) => {
        try {
            const txs = await getTransactions(symbol);
            setTransactions(txs);
        } catch (e) {
            console.error("Error fetching transactions:", e);
        }
    };

    // Auto-update price when date changes (only if adding new transaction or editing date)
    React.useEffect(() => {
        if (!isManageModalVisible || !selectedHolding || manageMode === 'history') return;

        const isToday = (d: Date) => {
            const now = new Date();
            return d.getDate() === now.getDate() &&
                d.getMonth() === now.getMonth() &&
                d.getFullYear() === now.getFullYear();
        };

        if (isToday(transactionDate) && !editingTransaction) return; // Don't fetch if today and adding new (already current)

        // If editing, we preserve the price unless date changes? 
        // Actually for simplicity, let's keep the user entered price if editing.
        if (editingTransaction) return;

        const timer = setTimeout(async () => {
            setIsPriceLoading(true);
            try {
                const price = await fetchPriceForDate(selectedHolding.symbol, transactionDate);
                if (price !== null) {
                    setPriceAmount(price.toString());
                }
            } catch (err) {
                console.error("Error auto-fetching price:", err);
            } finally {
                setIsPriceLoading(false);
            }
        }, 600);

        return () => clearTimeout(timer);
    }, [transactionDate, selectedHolding, isManageModalVisible, manageMode, editingTransaction]);

    // Benchmark State
    const [showBenchmark, setShowBenchmark] = useState(false);
    const [benchmarkData, setBenchmarkData] = useState<{ timestamp: number; price: number }[]>([]);
    const [isBenchmarkLoading, setIsBenchmarkLoading] = useState(false);

    const loadPortfolio = async () => {
        setLoading(true);
        try {
            await refreshPortfolioPrices(); // Refresh prices first
            const port = await getPortfolio();
            const txs = await getAllTransactions();
            const open = port.filter(h => h.shares > 0 && h.symbol !== 'USD');
            const closed = port.filter(h => h.shares === 0 && h.symbol !== 'USD');


            // Get history
            const hist = await getPortfolioHistory();

            setPortfolio(port);
            setOpenPositions(open);
            setClosedPositions(closed);
            setHistory(hist);
            setGlobalTransactions(txs);

            const balances = await getCashBalances();
            let totalCash = 0;
            for (const [cur, amt] of Object.entries(balances)) {
                totalCash += convertCurrency(amt, cur, currency, exchangeRates);
            }
            setCashBalance(totalCash);
        } catch (err) {
            console.error("Error loading portfolio:", err);
        } finally {
            setLoading(false);
        }
    };

    const fetchBenchmarkData = async () => {
        if (benchmarkData.length > 0) return; // Already loaded

        setIsBenchmarkLoading(true);
        try {
            // Fetch SPY history for max range to cover all possibilities
            console.log("Fetching SPY benchmark data...");
            const history = await fetchStockHistory('SPY', '5y', '1d'); // 5y should cover most
            // If user has >5y history, might need 'max'
            if (history && history.length > 0) {
                setBenchmarkData(history);
            }
        } catch (e) {
            console.error("Failed to load benchmark:", e);
        } finally {
            setIsBenchmarkLoading(false);
        }
    };

    // Trigger fetch when toggle is turned on
    React.useEffect(() => {
        if (showBenchmark) {
            fetchBenchmarkData();
        }
    }, [showBenchmark]);

    const handleSaveCash = async () => {
        const amount = parseFloat(cashAmount);
        if (isNaN(amount) || amount <= 0) {
            Alert.alert("Invalid Input", "Please enter a valid amount.");
            return;
        }

        if (cashType === 'withdraw' && amount > cashBalance) {
            Alert.alert("Insufficient Funds", "You cannot withdraw more than your available cash.");
            return;
        }

        setIsSubmitting(true);
        try {
            await addTransaction({
                symbol: 'USD', // System symbol for Cash
                type: cashType,
                shares: 1, // Convention
                price: amount,
                currency: currency, // Store in the selected currency for stability
                date: new Date().toISOString()
            });
            await triggerPortfolioSnapshot();
            Alert.alert("Success", `${cashType === 'deposit' ? 'Deposited' : 'Withdrawn'} ${formatCurrency(amount, currency)} successfully.`);
            setIsCashModalVisible(false);
            setCashAmount('');
            loadPortfolio();
        } catch (e) {
            console.error(e);
            Alert.alert("Error", "Failed to process transaction.");
        } finally {
            setIsSubmitting(false);
        }
    };


    useFocusEffect(
        useCallback(() => {
            loadPortfolio();
        }, [])
    );

    const handleDelete = (symbol: string) => {
        Alert.alert(
            "Remove Holding",
            `Are you sure you want to remove ${symbol} from your portfolio?`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Remove",
                    style: "destructive",
                    onPress: async () => {
                        try {
                            await removeHolding(symbol);
                            loadPortfolio();
                        } catch (err) {
                            console.error("Error removing holding:", err);
                        }
                    }
                }
            ]
        );
    };

    const colors = [
        '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
        '#FF9F40', '#E7E9ED', '#8AC249', '#019688', '#607D8B'
    ];

    // Chart Data based on Dollar Value (converted to user currency)
    // Only use Open Positions for allocation chart
    const chartData = openPositions.map((item, index) => {
        const nativeValue = item.shares * (item.price || 0);
        return {
            label: item.symbol,
            value: convertCurrency(nativeValue, item.currency || 'USD', currency, exchangeRates),
            color: colors[index % colors.length],
        };
    });

    const totalPortfolioValue = openPositions
        .filter(h => h.symbol !== 'USD')
        .reduce((acc, curr) => {
            const nativeValue = curr.shares * (curr.price || 0);
            return acc + convertCurrency(nativeValue, curr.currency || 'USD', currency, exchangeRates);
        }, 0) + cashBalance; // Include cash in total portfolio value

    const totalCostBasis = openPositions
        .filter(h => h.symbol !== 'USD')
        .reduce((acc, curr) => {
            const nativeCost = curr.shares * (curr.costBasis || curr.price || 0);
            return acc + convertCurrency(nativeCost, curr.currency || 'USD', currency, exchangeRates);
        }, 0) + cashBalance; // Include cash in cost basis so deposits aren't treated as gains

    const totalProfit = totalPortfolioValue - totalCostBasis;
    const totalProfitPercent = totalCostBasis > 0 ? (totalProfit / totalCostBasis) * 100 : 0;

    const totalDayChange = openPositions.reduce((acc, curr) => {
        const nativeChange = curr.shares * (curr.priceChange || 0);
        return acc + convertCurrency(nativeChange, curr.currency || 'USD', currency, exchangeRates);
    }, 0);
    // Denominator for day % change is Previous Close Value => (Current Value - Day Change)
    const prevDayValue = totalPortfolioValue - totalDayChange;
    const totalDayChangePercent = prevDayValue > 0 ? (totalDayChange / prevDayValue) * 100 : 0;

    const totalRealizedProfit = portfolio.reduce((acc, curr) => {
        const nativeRealized = curr.realizedProfit || 0;
        return acc + convertCurrency(nativeRealized, curr.currency || 'USD', currency, exchangeRates);
    }, 0);

    const totalTotalProfit = totalProfit + totalRealizedProfit;

    // Currency conversion for display
    const displayTotalValue = formatCurrency(totalPortfolioValue, currency);
    const displayUnrealized = formatCurrency(Math.abs(totalProfit), currency);
    const displayRealized = formatCurrency(Math.abs(totalRealizedProfit), currency);
    const displayDayChange = formatCurrency(Math.abs(totalDayChange), currency);

    // Fetch intraday/daily data when range is 1D, 1W, or 1M
    useEffect(() => {
        const fetchIntradayData = async () => {
            if (selectedRange !== '1D' && selectedRange !== '1W' && selectedRange !== '1M' && selectedRange !== 'YTD') {
                setIntradayHistory([]);
                return;
            }

            if (openPositions.length === 0) {
                setIntradayHistory([]);
                return;
            }

            setIsChartLoading(true);
            try {
                // Determine range and interval
                let range = '1d';
                let interval = '2m';

                if (selectedRange === '1W') {
                    range = '5d';
                    interval = '15m';
                } else if (selectedRange === '1M') {
                    range = '1mo';
                    interval = '1d';
                } else if (selectedRange === 'YTD') {
                    range = 'ytd';
                    interval = '1d';
                }

                // Fetch data for all holdings in parallel
                const validHoldings = openPositions.filter(h => h.symbol !== 'USD');
                const historyPromises = validHoldings.map(h =>
                    fetchStockHistory(h.symbol, range, interval).then(data => ({ symbol: h.symbol, data }))
                );

                const results = await Promise.all(historyPromises);
                const dataMap: Record<string, { timestamp: number, price: number }[]> = {};

                results.forEach(res => {
                    if (res.data && res.data.length > 0) {
                        dataMap[res.symbol] = res.data;
                    }
                });

                // Get all unique timestamps and sort them
                const allTimestamps = new Set<number>();
                Object.values(dataMap).forEach(points => {
                    points.forEach(p => allTimestamps.add(p.timestamp));
                });

                const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

                if (sortedTimestamps.length < 2) {
                    setIntradayHistory([]); // Fallback to standard if not enough data
                    return;
                }

                // Calculate portfolio value at each timestamp
                const snapshots: PortfolioSnapshot[] = sortedTimestamps.map(ts => {
                    let totalVal = 0;

                    // Add cash balance (assumed constant)
                    totalVal += convertCurrency(cashBalance, 'USD', 'USD', exchangeRates); // Cash is USD

                    validHoldings.forEach(h => {
                        const points = dataMap[h.symbol];
                        if (!points) {
                            // No data for this stock, use current price as fallback? or omit?
                            // Using current price might be misleading if efficient. 
                            // Better: find nearest price or just use current price (simplest for now)
                            const nativeVal = h.shares * (h.price || 0);
                            totalVal += convertCurrency(nativeVal, h.currency || 'USD', 'USD', exchangeRates);
                            return;
                        }

                        // Find price at or before timestamp
                        // Since timestamps are sorted, we can optimize, but simple find/reduce is okay for small N
                        // Actually, for intraday, data points should be aligned. 
                        // If a stock is missing data at time T, use the last known price before T.

                        let price = points[0].price; // Default to first price
                        // Binary search or reverse find would be better
                        const point = points.find(p => p.timestamp === ts);
                        if (point) {
                            price = point.price;
                        } else {
                            // Find closest previous point
                            const prev = points.filter(p => p.timestamp < ts).pop();
                            if (prev) price = prev.price;
                        }

                        const nativeVal = h.shares * price;
                        totalVal += convertCurrency(nativeVal, h.currency || 'USD', 'USD', exchangeRates);
                    });

                    // Calculate profit based on current constant cost basis
                    // (Simplification: assuming no trades during the intraday period)
                    const profit = totalVal - totalCostBasis; // totalCostBasis is already in USD

                    return {
                        timestamp: new Date(ts).toISOString(),
                        totalValue: totalVal,
                        totalProfit: profit
                    };
                });

                setIntradayHistory(snapshots);

            } catch (error) {
                console.error("Error fetching intraday data:", error);
            } finally {
                setIsChartLoading(false);
            }
        };

        fetchIntradayData();
    }, [selectedRange, openPositions, cashBalance, totalCostBasis, exchangeRates]);

    const getFilteredHistory = (): PortfolioSnapshot[] => {
        if (selectedRange === '1D' || selectedRange === '1W' || selectedRange === '1M' || selectedRange === 'YTD') {
            if (intradayHistory.length > 0) {
                return intradayHistory;
            }
            // Fallback for 1D if loading or no data matches existing logic
            // But we can just use the existing logic as fallback
        }

        if (!history || history.length === 0) return [];

        if (selectedRange === '1D') {
            // Since snapshots in DB are stored in USD, we need our local aggregates in USD too.
            const totalPortfolioValueUsd = openPositions.reduce((acc, curr) => {
                const nativeValue = curr.shares * (curr.price || 0);
                return acc + convertCurrency(nativeValue, curr.currency || 'USD', 'USD', exchangeRates);
            }, 0);

            const totalTotalProfitUsd = portfolio.reduce((acc, curr) => {
                const nativeValue = curr.shares * (curr.price || 0);
                const nativeCost = curr.shares * (curr.costBasis || curr.price || 0);
                const nativeProfit = (nativeValue - nativeCost) + (curr.realizedProfit || 0);
                return acc + convertCurrency(nativeProfit, curr.currency || 'USD', 'USD', exchangeRates);
            }, 0);

            const totalDayChangeUsd = openPositions.reduce((acc, curr) => {
                const nativeChange = curr.shares * (curr.priceChange || 0);
                return acc + convertCurrency(nativeChange, curr.currency || 'USD', 'USD', exchangeRates);
            }, 0);

            const totalCostBasisUsd = openPositions.reduce((acc, curr) => {
                const nativeCost = curr.shares * (curr.costBasis || curr.price || 0);
                return acc + convertCurrency(nativeCost, curr.currency || 'USD', 'USD', exchangeRates);
            }, 0);

            const now = new Date();
            const prevCloseTimestamp = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(); // Approximate for chart start

            return [
                {
                    timestamp: prevCloseTimestamp,
                    totalValue: totalPortfolioValueUsd - totalDayChangeUsd,
                    totalProfit: totalTotalProfitUsd - totalDayChangeUsd
                },
                {
                    timestamp: now.toISOString(),
                    totalValue: totalPortfolioValueUsd,
                    totalProfit: totalTotalProfitUsd
                }
            ];
        }

        // For 'ALL', return all history data
        if (selectedRange === 'ALL') {
            return history;
        }

        const now = new Date();
        let cutoff = new Date();

        switch (selectedRange) {
            case '1W': cutoff.setDate(now.getDate() - 7); break;
            case '1M': cutoff.setMonth(now.getMonth() - 1); break;
            case 'YTD': cutoff = new Date(now.getFullYear(), 0, 1); break;
            case '1Y': cutoff.setFullYear(now.getFullYear() - 1); break;
            case '5Y': cutoff.setFullYear(now.getFullYear() - 5); break;
        }

        return history.filter(h => new Date(h.timestamp) >= cutoff);
    };

    const filteredHistory = getFilteredHistory();



    const loadGlobalHistory = async () => {
        try {
            const txs = await getAllTransactions();
            setGlobalTransactions(txs);
        } catch (e) {
            console.error("Error loading global history:", e);
        }
    };

    const handleManageSave = async () => {
        const shares = parseFloat(sharesAmount);
        const price = parseFloat(priceAmount);

        if (manageMode !== 'history') {
            if (isNaN(shares) || shares <= 0) {
                Alert.alert("Invalid input", "Please enter a valid number of shares.");
                return;
            }

            if (isNaN(price) || price <= 0) {
                Alert.alert("Invalid input", "Please enter a valid price.");
                return;
            }
        }

        if (!selectedHolding) return;

        setIsSubmitting(true);
        try {
            if (editingTransaction) {
                await updateTransaction(editingTransaction.id!, {
                    type: manageMode as 'buy' | 'sell' | 'deposit' | 'withdraw',
                    shares: shares,
                    price: price,
                    date: transactionDate.toISOString()
                });
                Alert.alert("Success", "Transaction updated.");
            } else {
                const sharesChange = manageMode === 'buy' ? shares : -shares;

                // Validate sell amount
                if (manageMode === 'sell' && selectedHolding.shares < shares) {
                    Alert.alert("Invalid Transaction", `You cannot sell ${shares} shares because you only own ${selectedHolding.shares}.`);
                    setIsSubmitting(false);
                    return;
                }

                // Using addHolding wrapper for now which handles snapshotting too
                await addHolding({
                    symbol: selectedHolding.symbol,
                    companyName: selectedHolding.companyName,
                    shares: sharesChange,
                    price: price, // Use the user-entered price
                    currency: selectedHolding.currency || 'USD',
                    lastTransactionDate: transactionDate.toISOString()
                });
                Alert.alert("Success", "Portfolio updated successfully.");
            }

            setIsManageModalVisible(false);
            setSharesAmount('');
            setPriceAmount('');
            setEditingTransaction(null);
            loadPortfolio();
        } catch (err) {
            console.error("Error updating portfolio:", err);
            Alert.alert("Error", "Could not update portfolio. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleEditTransaction = (tx: Transaction) => {
        setEditingTransaction(tx);
        setManageMode(tx.type);
        setSharesAmount(tx.shares.toString());
        setPriceAmount(tx.price.toString());
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
                                if (selectedHolding) fetchTransactions(selectedHolding.symbol);
                                loadPortfolio();
                            }
                        } catch (e) {
                            Alert.alert("Error", "Failed to delete transaction.");
                        }
                    }
                }
            ]
        );
    };

    const renderItem = ({ item, index }: { item: PortfolioHolding, index: number }) => {
        const currentPrice = item.price || 0;
        const value = item.shares * currentPrice;
        const costBasis = item.costBasis || currentPrice;
        const profit = (currentPrice - costBasis) * item.shares;
        const profitPercent = costBasis > 0 ? ((currentPrice - costBasis) / costBasis) * 100 : 0;

        const displayValue = formatCurrency(convertCurrency(value, item.currency || 'USD', currency, exchangeRates), currency);
        const displayProfit = formatCurrency(convertCurrency(Math.abs(profit), item.currency || 'USD', currency, exchangeRates), currency);
        const displayRealizedProfitItem = formatCurrency(convertCurrency(Math.abs(item.realizedProfit || 0), item.currency || 'USD', currency, exchangeRates), currency);

        return (
            <TouchableOpacity
                style={[styles.holdingItem, { backgroundColor: isDark ? '#1e1e1e' : '#fff' }]}
                onPress={() => navigation.navigate('SearchResultsScreen', { stockSymbol: item.symbol })}
            >
                <View style={[styles.colorIndicator, { backgroundColor: colors[index % colors.length] }]} />
                <View style={styles.holdingInfo}>
                    <View style={styles.symbolHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                            <Text style={[styles.symbol, { color: isDark ? '#fff' : '#1a1a1a' }]}>{item.symbol}</Text>
                            <Text style={[styles.shares, { marginLeft: 8, color: isDark ? '#aaa' : '#666', fontSize: 12 }]}>
                                • {item.shares} {item.shares === 1 ? 'share' : 'shares'}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.holdingFooter}>
                        <Text style={[styles.companyName, { color: isDark ? '#aaa' : '#666' }]} numberOfLines={1}>{item.companyName}</Text>
                        {(item.realizedProfit || 0) !== 0 && (
                            <Text style={[styles.realizedBadge, (item.realizedProfit || 0) > 0 ? (isDark ? styles.positiveBadgeDark : styles.positiveBadge) : (isDark ? styles.negativeBadgeDark : styles.negativeBadge)]}>
                                Realized: {(item.realizedProfit || 0) >= 0 ? '+' : '-'}{displayRealizedProfitItem}
                            </Text>
                        )}
                    </View>
                </View>
                <View style={styles.sharesContainer}>

                    <Text style={[styles.value, { color: isDark ? '#fff' : '#1a1a1a' }]}>{displayValue}</Text>
                    <View style={styles.profitContainer}>
                        {/* Day Change Only */}
                        {item.priceChange !== undefined ? (
                            <Text style={[styles.itemPriceChange, item.priceChange >= 0 ? styles.positive : styles.negative]}>
                                {item.priceChange >= 0 ? '+' : ''}{formatCurrency(convertCurrency(Math.abs((item.priceChange || 0) * item.shares), item.currency || 'USD', currency, exchangeRates), currency)} ({item.pricePercent?.toFixed(2)}%)
                            </Text>
                        ) : (
                            <Text style={[styles.itemPriceChange, { color: '#999' }]}>--</Text>
                        )}
                    </View>
                </View>
                <TouchableOpacity
                    style={styles.manageButton}
                    onPress={() => {
                        setSelectedHolding(item);
                        setManageMode('buy');
                        setEditingTransaction(null);
                        setSharesAmount('');
                        setPriceAmount((item.price || 0).toString());
                        setTransactionDate(new Date());
                        fetchTransactions(item.symbol);
                        setIsManageModalVisible(true);
                    }}
                >
                    <MaterialIcons name="edit" size={22} color="#007AFF" />
                </TouchableOpacity>
                <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => handleDelete(item.symbol)}
                >
                    <MaterialIcons name="delete-outline" size={22} color="#FF3B30" />
                </TouchableOpacity>
            </TouchableOpacity>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: isDark ? '#121212' : '#f8f9fa' }]}>
            <View style={styles.headerRow}>
                <TouchableOpacity
                    style={styles.historyButton}
                    onPress={() => {
                        loadGlobalHistory();
                        setIsHistoryModalVisible(true);
                    }}
                >
                    <MaterialIcons name="history" size={24} color={isDark ? '#fff' : '#1a1a1a'} />
                </TouchableOpacity>
                <Text style={[styles.title, { color: isDark ? '#fff' : '#1a1a1a' }]}>My Portfolio</Text>
                <View style={{ width: 24 }} />
            </View>

            <View style={[styles.headerStats, { backgroundColor: isDark ? '#1e1e1e' : '#fff', marginBottom: 12 }]}>
                <View style={styles.totalValueContainer}>
                    <Text style={styles.totalValueLabel}>Total Value</Text>
                    <Text style={[styles.totalValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>{displayTotalValue}</Text>
                </View>

                <View style={[styles.statDivider, { backgroundColor: isDark ? '#333' : '#eee' }]} />

                <View style={styles.statsColumn}>

                    <View style={styles.statRow}>
                        <Text style={styles.statLabel}>Unrealized</Text>
                        <Text style={[styles.statValue, totalProfit >= 0 ? styles.positive : styles.negative]}>
                            {totalProfit >= 0 ? '+' : '-'}{displayUnrealized}
                        </Text>
                    </View>
                    <View style={styles.statRow}>
                        <Text style={styles.statLabel}>Realized</Text>
                        <Text style={[styles.statValue, totalRealizedProfit >= 0 ? styles.positive : styles.negative]}>
                            {totalRealizedProfit >= 0 ? '+' : '-'}{displayRealized}
                        </Text>
                    </View>
                </View>
            </View>




            {loading && portfolio.length === 0 ? (
                <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
            ) : openPositions.length > 0 || closedPositions.length > 0 ? (
                <FlatList
                    data={openPositions}
                    keyExtractor={(item) => item.symbol}
                    renderItem={renderItem}
                    ListHeaderComponent={
                        <View>
                            <View style={[styles.chartContainer, { backgroundColor: isDark ? '#1e1e1e' : '#fff' }]}>
                                <View style={styles.chartHeader}>
                                    <Text style={[styles.chartSectionTitle, { color: isDark ? '#fff' : '#333' }]}>Historical Performance</Text>
                                    <View style={[styles.rangeContainer, { backgroundColor: isDark ? '#000' : '#f0f0f0' }]}>
                                        {(['1D', '1W', '1M', 'YTD', '1Y', '5Y', 'ALL'] as const).map((range) => (
                                            <TouchableOpacity
                                                key={range}
                                                style={[styles.rangeChip, selectedRange === range && (isDark ? styles.rangeChipActiveDark : styles.rangeChipActive)]}
                                                onPress={() => setSelectedRange(range)}
                                            >
                                                <Text style={[styles.rangeText, selectedRange === range && styles.rangeTextActive]}>
                                                    {range}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                </View>

                                <View style={styles.benchmarkToggleRow}>
                                    <Text style={[styles.benchmarkLabel, { color: isDark ? '#aaa' : '#666' }]}>Compare to S&P 500</Text>
                                    <Switch
                                        value={showBenchmark}
                                        onValueChange={setShowBenchmark}
                                        trackColor={{ false: isDark ? '#333' : '#e0e0e0', true: '#34C759' }}
                                        thumbColor={Platform.OS === 'ios' ? '#fff' : (showBenchmark ? '#fff' : '#f4f3f4')}
                                        ios_backgroundColor={isDark ? '#333' : '#e0e0e0'}
                                        style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                                    />
                                    {isBenchmarkLoading && <ActivityIndicator size="small" style={{ marginLeft: 8 }} />}
                                </View>

                                <PortfolioLineChart
                                    data={filteredHistory}
                                    benchmarkData={benchmarkData}
                                    showBenchmark={showBenchmark}
                                    range={selectedRange}
                                    isDark={isDark}
                                    formatValue={(val) => formatCurrency(convertCurrency(val, 'USD', currency, exchangeRates), currency)}
                                />
                                {filteredHistory.length > 1 && (() => {
                                    const effectiveStart = filteredHistory.find(h => h.totalValue > 0) || filteredHistory[0];
                                    const startProfit = effectiveStart.totalProfit;
                                    const endProfit = filteredHistory[filteredHistory.length - 1].totalProfit;
                                    const startValue = effectiveStart.totalValue;

                                    const changeAmount = endProfit - startProfit;
                                    const displayChangeAmount = formatCurrency(convertCurrency(Math.abs(changeAmount), 'USD', currency, exchangeRates), currency);

                                    const changePercent = startValue > 0 ? (changeAmount / startValue) * 100 : 0;
                                    const isPositive = changeAmount >= 0;
                                    const rangeLabel = {
                                        '1D': '1D',
                                        '1W': 'This Week',
                                        '1M': 'This Month',
                                        'YTD': 'Year to Date',
                                        '1Y': 'This Year',
                                        '5Y': 'Last 5 Years',
                                        'ALL': 'All Time'
                                    }[selectedRange];

                                    return (
                                        <View style={[styles.rangeSummary, { borderTopColor: isDark ? '#333' : '#f1f1f1' }]}>
                                            <Text style={styles.rangeLabel}>{rangeLabel}</Text>
                                            <Text style={[styles.rangeChange, isPositive ? styles.positiveText : styles.negativeText]}>
                                                {isPositive ? '+' : '-'}{displayChangeAmount} ({isPositive ? '+' : ''}{changePercent.toFixed(1)}%)
                                            </Text>
                                        </View>
                                    );
                                })()}
                            </View>
                            <View style={[styles.chartContainer, { backgroundColor: isDark ? '#1e1e1e' : '#fff' }]}>
                                <Text style={[styles.chartSectionTitle, { color: isDark ? '#fff' : '#333' }]}>Allocation (%)</Text>
                                <PieChart data={chartData} isDark={isDark} />
                            </View>

                            {/* Cash Balance Section */}
                            <View style={[styles.headerStats, { backgroundColor: isDark ? '#1e1e1e' : '#fff', paddingVertical: 14, minHeight: 60, marginTop: 16, marginHorizontal: 16 }]}>
                                <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <View>
                                        <Text style={styles.statLabel}>Cash Balance</Text>
                                        <Text style={[styles.totalValue, { fontSize: 20, color: isDark ? '#fff' : '#1a1a1a' }]}>
                                            {formatCurrency(cashBalance, currency)}
                                        </Text>
                                    </View>
                                    <View style={{ flexDirection: 'row', gap: 8 }}>
                                        <TouchableOpacity
                                            style={{ backgroundColor: isDark ? '#333' : '#e0e0e0', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 }}
                                            onPress={() => {
                                                setCashType('deposit');
                                                setIsCashModalVisible(true);
                                            }}
                                        >
                                            <Text style={{ color: isDark ? '#fff' : '#333', fontSize: 13, fontWeight: '600' }}>Deposit</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={{ backgroundColor: isDark ? '#333' : '#e0e0e0', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 }}
                                            onPress={() => {
                                                setCashType('withdraw');
                                                setIsCashModalVisible(true);
                                            }}
                                        >
                                            <Text style={{ color: isDark ? '#fff' : '#333', fontSize: 13, fontWeight: '600' }}>Withdraw</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            </View>
                        </View>
                    }
                    ListFooterComponent={
                        closedPositions.length > 0 ? (
                            <View style={[styles.closedSection, { backgroundColor: isDark ? '#121212' : '#f8f9fa' }]}>
                                <Text style={[styles.chartSectionTitle, { color: isDark ? '#fff' : '#333', marginLeft: 16, marginTop: 24, marginBottom: 8 }]}>Closed Positions</Text>
                                {closedPositions.map((item, index) => (
                                    <View key={item.symbol}>
                                        {renderItem({ item, index })}
                                    </View>
                                ))}
                            </View>
                        ) : null
                    }
                    contentContainerStyle={styles.listContent}
                />
            ) : (
                <View style={styles.emptyContainer}>
                    <MaterialIcons name="pie-chart-outlined" size={80} color="#ccc" />
                    <Text style={styles.emptyText}>Your portfolio is empty.</Text>
                    <Text style={styles.emptySubtext}>Add stocks from the search results screen to track them here.</Text>
                </View>
            )}

            {/* Manage Holding Modal */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={isManageModalVisible}
                onRequestClose={() => setIsManageModalVisible(false)}
            >
                <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); setIsManageModalVisible(false); }}>
                    <View style={styles.modalOverlay}>
                        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                            <View style={[styles.modalContent, { backgroundColor: isDark ? '#1e1e1e' : '#fff' }]}>
                                <Text style={[styles.modalTitle, { color: isDark ? '#fff' : '#1a1a1a' }]}>Manage {selectedHolding?.symbol}</Text>

                                <View style={[styles.modeTabs, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f0' }]}>
                                    <TouchableOpacity
                                        style={[styles.modeTab, manageMode === 'buy' && (isDark ? { backgroundColor: '#3a3a3c' } : styles.modeTabActive)]}
                                        onPress={() => setManageMode('buy')}
                                    >
                                        <Text style={[styles.modeTabText, manageMode === 'buy' && styles.modeTabTextActive]}>Buy</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.modeTab, manageMode === 'sell' && (isDark ? { backgroundColor: '#3a3a3c' } : styles.modeTabActive)]}
                                        onPress={() => setManageMode('sell')}
                                    >
                                        <Text style={[styles.modeTabText, manageMode === 'sell' && styles.modeTabTextActive]}>Sell</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.modeTab, manageMode === 'history' && (isDark ? { backgroundColor: '#3a3a3c' } : styles.modeTabActive)]}
                                        onPress={() => setManageMode('history')}
                                    >
                                        <Text style={[styles.modeTabText, manageMode === 'history' && styles.modeTabTextActive]}>History</Text>
                                    </TouchableOpacity>
                                </View>

                                {manageMode === 'history' ? (
                                    <View style={{ height: 350 }}>
                                        <TransactionList
                                            transactions={transactions}
                                            onEdit={handleEditTransaction}
                                            onDelete={handleDeleteTransaction}
                                            currency={selectedHolding?.currency}
                                        />
                                    </View>
                                ) : (
                                    <>
                                        <Text style={[styles.currentPositionText, { color: isDark ? '#aaa' : '#666' }]}>
                                            {editingTransaction ? 'Editing Transaction' : `Current Position: ${selectedHolding?.shares.toLocaleString()} shares`}
                                        </Text>

                                        <View style={styles.inputGroup}>
                                            <Text style={[styles.inputLabel, { color: isDark ? '#aaa' : '#666' }]}>Shares</Text>
                                            <TextInput
                                                style={[styles.modalInput, { backgroundColor: isDark ? '#2c2c2e' : '#f9f9f9', color: isDark ? '#fff' : '#000', borderColor: isDark ? '#3a3a3c' : '#e0e0e0' }]}
                                                placeholder="0"
                                                keyboardType="numeric"
                                                value={sharesAmount}
                                                onChangeText={setSharesAmount}
                                                placeholderTextColor={isDark ? '#666' : '#999'}
                                            />
                                        </View>

                                        <View style={styles.inputGroup}>
                                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
                                                <Text style={[styles.inputLabel, { color: isDark ? '#aaa' : '#666', marginBottom: 0 }]}>Price per share ({selectedHolding?.currency || 'USD'})</Text>
                                                {isPriceLoading && <ActivityIndicator size="small" color="#007AFF" style={{ marginLeft: 8 }} />}
                                            </View>
                                            <TextInput
                                                style={[styles.modalInput, { backgroundColor: isDark ? '#2c2c2e' : '#f9f9f9', color: isDark ? '#fff' : '#000', borderColor: isDark ? '#3a3a3c' : '#e0e0e0' }]}
                                                placeholder="0.00"
                                                keyboardType="numeric"
                                                value={priceAmount}
                                                onChangeText={setPriceAmount}
                                                placeholderTextColor={isDark ? '#666' : '#999'}
                                            />
                                        </View>

                                        <TouchableOpacity
                                            style={[styles.dateRow, { backgroundColor: isDark ? '#2c2c2e' : '#f5f5f5' }]}
                                            onPress={() => setShowDatePicker(true)}
                                        >
                                            <View style={styles.dateLabelGroup}>
                                                <MaterialIcons name="calendar-today" size={18} color={isDark ? '#aaa' : '#666'} style={styles.calendarIcon} />
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
                                                    setIsManageModalVisible(false);
                                                    setSharesAmount('');
                                                    setPriceAmount('');
                                                }}
                                            >
                                                <Text style={[styles.cancelButtonText, { color: isDark ? '#fff' : '#444' }]}>Cancel</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={[styles.modalButton, styles.saveButton]}
                                                onPress={handleManageSave}
                                                disabled={isSubmitting}
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


            {/* Global History Modal */}
            < Modal
                animationType="slide"
                presentationStyle="pageSheet"
                visible={isHistoryModalVisible}
                onRequestClose={() => setIsHistoryModalVisible(false)}
            >
                <View style={[styles.historyModalContainer, { backgroundColor: isDark ? '#121212' : '#f8f9fa' }]}>
                    <View style={styles.historyHeader}>
                        <Text style={[styles.modalTitle, { color: isDark ? '#fff' : '#1a1a1a' }]}>Transaction History</Text>
                        <TouchableOpacity onPress={() => setIsHistoryModalVisible(false)} style={styles.closeButton}>
                            <MaterialIcons name="close" size={24} color={isDark ? '#fff' : '#1a1a1a'} />
                        </TouchableOpacity>
                    </View>
                    <TransactionList
                        transactions={globalTransactions}

                        onDelete={async (tx) => {
                            Alert.alert("Delete Transaction", "Are you sure?", [
                                { text: "Cancel", style: "cancel" },
                                {
                                    text: "Delete", style: "destructive", onPress: async () => {
                                        if (tx.id) await deleteTransaction(tx.id);
                                        loadGlobalHistory();
                                        loadPortfolio();
                                    }
                                }
                            ]);
                        }}
                        currency={currency}
                    />
                </View>
            </Modal >

            {/* Cash Modal */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={isCashModalVisible}
                onRequestClose={() => setIsCashModalVisible(false)}
            >
                <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); setIsCashModalVisible(false); }}>
                    <View style={styles.modalOverlay}>
                        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                            <View style={[styles.modalContent, { backgroundColor: isDark ? '#1e1e1e' : '#fff' }]}>
                                <Text style={[styles.modalTitle, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                                    {cashType === 'deposit' ? 'Deposit Cash' : 'Withdraw Cash'}
                                </Text>

                                <TextInput
                                    style={[styles.modalInput, { backgroundColor: isDark ? '#2c2c2e' : '#f9f9f9', color: isDark ? '#fff' : '#000', borderColor: isDark ? '#3a3a3c' : '#e0e0e0' }]}
                                    placeholder={`Amount (${currency})`}
                                    keyboardType="numeric"
                                    value={cashAmount}
                                    onChangeText={setCashAmount}
                                    placeholderTextColor={isDark ? '#666' : '#999'}
                                    autoFocus
                                />

                                <View style={styles.modalButtons}>
                                    <TouchableOpacity
                                        style={[styles.modalButton, styles.cancelButton, { backgroundColor: isDark ? '#3a3a3c' : '#f0f0f0' }]}
                                        onPress={() => {
                                            setIsCashModalVisible(false);
                                            setCashAmount('');
                                        }}
                                    >
                                        <Text style={[styles.cancelButtonText, { color: isDark ? '#fff' : '#444' }]}>Cancel</Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[styles.modalButton, styles.saveButton]}
                                        disabled={isSubmitting}
                                        onPress={handleSaveCash}
                                    >
                                        {isSubmitting ? (
                                            <ActivityIndicator size="small" color="#fff" />
                                        ) : (
                                            <Text style={styles.saveButtonText}>Confirm</Text>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        </View >
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8f9fa',
        paddingTop: 60,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        marginBottom: 8,
    },
    historyButton: {
        padding: 5,
    },
    historyModalContainer: {
        flex: 1,
        padding: 20,
        paddingTop: Platform.OS === 'ios' ? 20 : 50,
    },
    historyHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    closeButton: {
        padding: 5,
    },
    title: {
        fontSize: 28,
        fontWeight: '700',
        color: '#1a1a1a',
        textAlign: 'center',
        marginBottom: 8,
    },
    headerStats: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
        paddingHorizontal: 16,
        backgroundColor: '#fff',
        marginHorizontal: 16,
        paddingVertical: 16,
        borderRadius: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 5,
        elevation: 2,
    },
    totalValueContainer: {
        alignItems: 'center',
        flex: 1,
    },
    totalValueLabel: {
        fontSize: 11,
        color: '#888',
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 4,
    },
    totalValue: {
        fontSize: 22,
        fontWeight: '800',
        color: '#1a1a1a',
    },
    statDivider: {
        width: 1,
        height: 40,
        backgroundColor: '#eee',
        marginHorizontal: 15,
    },
    statsColumn: {
        flex: 1,
        justifyContent: 'center',
    },
    symbolHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 2,
    },
    itemPriceRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 6,
    },
    itemCurrentPrice: {
        fontSize: 14,
        fontWeight: '700',
        color: '#1a1a1a',
    },
    itemPriceChange: {
        fontSize: 13,
        fontWeight: '600',
    },
    symbol: {
        fontSize: 18,
        fontWeight: '800',
        color: '#007AFF',
    },
    statRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginVertical: 1,
    },
    statLabel: {
        fontSize: 12,
        color: '#666',
        fontWeight: '500',
    },
    statValue: {
        fontSize: 13,
        fontWeight: '700',
    },
    loader: {
        flex: 1,
    },
    chartContainer: {
        backgroundColor: '#fff',
        marginHorizontal: 16,
        borderRadius: 16,
        padding: 16,
        marginBottom: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    chartSectionTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#333',
        marginBottom: 8,
    },
    chartHeader: {
        marginBottom: 12,
    },
    rangeContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: '#f0f0f0',
        borderRadius: 10,
        padding: 2,
    },
    rangeChip: {
        paddingVertical: 6,
        paddingHorizontal: 8,
        borderRadius: 8,
        minWidth: 40,
        alignItems: 'center',
    },
    rangeChipActive: {
        backgroundColor: '#fff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 1,
        elevation: 1,
    },
    rangeTextActive: {
        color: '#007AFF',
    },
    rangeText: {
        fontSize: 11,
        fontWeight: '600',
        color: '#888',
    },
    rangeSummary: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#f1f1f1',
    },
    rangeLabel: {
        fontSize: 13,
        color: '#666',
        fontWeight: '600',
    },
    rangeChange: {
        fontSize: 13,
        fontWeight: '700',
    },
    positiveText: {
        color: '#34C759',
    },
    negativeText: {
        color: '#FF3B30',
    },
    positiveBadgeDark: {
        backgroundColor: '#064e1c',
        color: '#81c784',
    },
    negativeBadgeDark: {
        backgroundColor: '#4a0e0e',
        color: '#e57373',
    },
    rangeChipActiveDark: {
        backgroundColor: '#333',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.3,
        shadowRadius: 1,
        elevation: 1,
    },
    listContent: {
        paddingBottom: 100,
    },
    holdingItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        marginHorizontal: 16,
        marginBottom: 8,
        padding: 16,
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
    },
    colorIndicator: {
        width: 4,
        height: 60,
        borderRadius: 2,
        marginRight: 12,
    },
    holdingInfo: {
        flex: 1,
    },
    realizedBadge: {
        fontSize: 10,
        fontWeight: '700',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        overflow: 'hidden',
    },
    holdingFooter: {
        marginTop: 4,
    },
    dateLabel: {
        fontSize: 10,
        color: '#999',
        marginLeft: 8,
    },
    positiveBadge: {
        backgroundColor: '#E8F5E9',
        color: '#2E7D32',
    },
    negativeBadge: {
        backgroundColor: '#FFEBEE',
        color: '#C62828',
    },
    companyName: {
        fontSize: 12,
        color: '#666',
        marginTop: 2,
    },
    sharesContainer: {
        alignItems: 'flex-end',
        marginRight: 12,
    },
    shares: {
        fontSize: 13,
        fontWeight: '600',
        color: '#666',
    },
    profitContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 2,
    },
    profitText: {
        fontSize: 14,
        fontWeight: '700',
    },
    profitPercent: {
        fontSize: 11,
        fontWeight: '600',
        marginLeft: 4,
    },
    positive: {
        color: '#34C759',
    },
    negative: {
        color: '#FF3B30',
    },
    positiveIcon: {
        color: '#34C759',
    },
    negativeIcon: {
        color: '#FF3B30',
    },
    value: {
        fontSize: 16,
        fontWeight: '800',
        color: '#1a1a1a',
    },
    manageButton: {
        padding: 8,
        marginRight: 4,
    },
    deleteButton: {
        padding: 8,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 40,
        marginTop: -40,
    },
    emptyText: {
        fontSize: 20,
        fontWeight: '600',
        color: '#333',
        marginTop: 20,
    },
    emptySubtext: {
        fontSize: 14,
        color: '#666',
        textAlign: 'center',
        marginTop: 10,
        lineHeight: 20,
    },
    closedSection: {
        marginTop: 20,
        borderTopWidth: 1,
        borderTopColor: '#eee',
        marginBottom: 20,
    },
    // Modal Styles
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalContent: {
        width: '100%',
        backgroundColor: '#fff',
        borderRadius: 20,
        padding: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.25,
        shadowRadius: 10,
        elevation: 10,
    },
    modalTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: '#1a1a1a',
        marginBottom: 20,
        textAlign: 'center',
    },
    modeTabs: {
        flexDirection: 'row',
        backgroundColor: '#f0f0f0',
        borderRadius: 12,
        padding: 4,
        marginBottom: 20,
    },
    modeTab: {
        flex: 1,
        paddingVertical: 10,
        alignItems: 'center',
        borderRadius: 8,
    },
    modeTabActive: {
        backgroundColor: '#fff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    modeTabText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#666',
    },
    modeTabTextActive: {
        color: '#007AFF',
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
    benchmarkToggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        marginBottom: 10,
        justifyContent: 'flex-end'
    },
    benchmarkLabel: {
        fontSize: 12,
        marginRight: 8,
        fontWeight: '600'
    },
    currentPositionText: {
        fontSize: 14,
        color: '#666',
        marginBottom: 20,
        textAlign: 'center',
    },
    dateRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#f5f5f5',
        borderRadius: 12,
        padding: 12,
        marginBottom: 20,
    },
    dateLabelGroup: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    inputGroup: {
        marginBottom: 16,
    },
    inputLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#666',
        marginLeft: 4,
    },
    modalInput: {
        backgroundColor: '#f5f5f5',
        borderRadius: 12,
        padding: 16,
        fontSize: 18,
        color: '#1a1a1a',
        textAlign: 'center',
    },
    modalButtons: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 10,
    },
    modalButton: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
    },
    cancelButton: {
        backgroundColor: '#f0f0f0',
        marginRight: 10,
    },
    saveButton: {
        backgroundColor: '#007AFF',
        marginLeft: 10,
    },
    cancelButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#666',
    },
    saveButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#fff',
    },
    datePickerButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f5f5f5',
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: '#eee',
    },
    calendarIcon: {
        marginRight: 8,
    },
    datePickerText: {
        fontSize: 16,
        color: '#1a1a1a',
        fontWeight: '500',
    },
});

export default PortfolioScreen;
