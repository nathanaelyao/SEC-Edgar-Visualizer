import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, ScrollView, TouchableWithoutFeedback, Keyboard, Platform, Switch, KeyboardAvoidingView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getPortfolio, removeHolding, updatePrice, addHolding, PortfolioHolding, addPortfolioSnapshot, getPortfolioHistory, PortfolioSnapshot, refreshPortfolioPrices, Transaction, getTransactions, getAllTransactions, updateTransaction, deleteTransaction, addTransaction, getCashBalances, triggerPortfolioSnapshot, checkAndRunMaintenance, getChartCashBalances } from '@/utils/db';
import { CURRENCY_SYMBOLS } from '@/utils/currency';
import PieChart from '@/components/PieChart';
import PortfolioLineChart from '@/components/PortfolioLineChart';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import TransactionList from '@/components/TransactionList';
import TransactionModal from '@/components/TransactionModal';
import { fetchStockPrice, fetchPriceForDate, fetchStockHistory } from '@/utils/secApi';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '@/context/ThemeContext';
import { formatCurrency, convertCurrency } from '@/utils/currency';
import { calculatePortfolioChart, ChartDataPoint } from '@/utils/chartCalculations';

const PortfolioScreen: React.FC = () => {
    const { isDark, currency, exchangeRates } = useTheme();
    const navigation = useNavigation<any>();
    const [portfolio, setPortfolio] = useState<PortfolioHolding[]>([]);
    const [openPositions, setOpenPositions] = useState<PortfolioHolding[]>([]);
    const [closedPositions, setClosedPositions] = useState<PortfolioHolding[]>([]);
    const [cashBalance, setCashBalance] = useState(0); // Display Cash (Deposits - Withdraws)
    const [chartCashBalance, setChartCashBalance] = useState(0); // Chart Cash (Smart Logic including trades)

    const [loading, setLoading] = useState(true);
    const [selectedRange, setSelectedRange] = useState<'1D' | '1W' | '1M' | 'YTD' | '1Y' | '5Y' | 'ALL'>('ALL');
    const [performanceData, setPerformanceData] = useState<ChartDataPoint[]>([]);
    const [isChartLoading, setIsChartLoading] = useState(false);

    // Management Modal State
    const [isManageModalVisible, setIsManageModalVisible] = useState(false);
    const [isHistoryModalVisible, setIsHistoryModalVisible] = useState(false);
    const [globalTransactions, setGlobalTransactions] = useState<Transaction[]>([]);
    const [selectedHolding, setSelectedHolding] = useState<PortfolioHolding | null>(null);
    const [manageMode, setManageMode] = useState<'buy' | 'sell' | 'deposit' | 'withdraw' | 'history'>('buy');
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isPriceLoading, setIsPriceLoading] = useState(false);

    // Cash Management
    const [isCashModalVisible, setIsCashModalVisible] = useState(false);
    const [cashAmount, setCashAmount] = useState('');
    const [cashType, setCashType] = useState<'deposit' | 'withdraw'>('deposit');

    // Auto-update price when date changes


    // Benchmark State
    const [showBenchmark, setShowBenchmark] = useState(false);
    const [benchmarkData, setBenchmarkData] = useState<{ timestamp: number; price: number }[]>([]);
    const [isBenchmarkLoading, setIsBenchmarkLoading] = useState(false);

    const loadPortfolio = async () => {
        setLoading(true);
        try {
            // Check for maintenance tasks (e.g. History Rebuild)
            await checkAndRunMaintenance();

            await refreshPortfolioPrices(); // Refresh prices first
            const port = await getPortfolio();
            const txs = await getAllTransactions();
            const open = port.filter(h => h.shares > 0 && h.symbol !== 'USD');
            const closed = port.filter(h => h.shares === 0 && h.symbol !== 'USD');




            setPortfolio(port);
            setOpenPositions(open);
            setClosedPositions(closed);

            setGlobalTransactions(txs);

            const balances = await getCashBalances();
            let totalCash = 0;
            for (const [cur, amt] of Object.entries(balances)) {
                totalCash += convertCurrency(amt, cur, currency, exchangeRates);
            }
            setCashBalance(totalCash);

            // Fetch Chart Cash (Smart Logic)
            const chartBalances = await getChartCashBalances();
            let totalChartCash = 0;
            for (const [cur, amt] of Object.entries(chartBalances)) {
                totalChartCash += convertCurrency(amt, cur, currency, exchangeRates);
            }
            setChartCashBalance(totalChartCash);
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

    // Fetch chart data using new time-weighted return calculation
    useEffect(() => {
        const fetchChartData = async () => {
            if (globalTransactions.length === 0) {
                setPerformanceData([]);
                return;
            }

            setIsChartLoading(true);
            try {
                const data = await calculatePortfolioChart(
                    globalTransactions,
                    selectedRange,
                    currency,
                    exchangeRates,
                    showBenchmark
                );
                setPerformanceData(data);
            } catch (error) {
                console.error("Error fetching chart data:", error);
                setPerformanceData([]);
            } finally {
                setIsChartLoading(false);
            }
        };

        fetchChartData();
    }, [selectedRange, globalTransactions, exchangeRates, showBenchmark, currency]);





    const loadGlobalHistory = async () => {
        try {
            const txs = await getAllTransactions();
            setGlobalTransactions(txs);
        } catch (e) {
            console.error("Error loading global history:", e);
        }
    };



    const renderItem = ({ item, index }: { item: PortfolioHolding, index: number }) => {
        const currentPrice = item.price || 0;
        const value = item.shares * currentPrice;
        const costBasis = item.costBasis || currentPrice;
        const profit = (currentPrice - costBasis) * item.shares;
        const profitPercent = costBasis > 0 ? ((currentPrice - costBasis) / costBasis) * 100 : 0;
        const isPositive = profit >= 0;

        const displayValue = formatCurrency(convertCurrency(value, item.currency || 'USD', currency, exchangeRates), currency);
        const displayProfit = formatCurrency(convertCurrency(Math.abs(profit), item.currency || 'USD', currency, exchangeRates), currency);
        const displayRealizedProfitItem = formatCurrency(convertCurrency(Math.abs(item.realizedProfit || 0), item.currency || 'USD', currency, exchangeRates), currency);


        const isClosed = item.shares === 0;
        const realizedProfit = item.realizedProfit || 0;
        const isRealizedPositive = realizedProfit >= 0;

        // Calculate daily dollar gain
        const dailyGain = (item.priceChange || 0) * item.shares;
        const displayDailyGain = formatCurrency(convertCurrency(Math.abs(dailyGain), item.currency || 'USD', currency, exchangeRates), currency);

        return (
            <TouchableOpacity
                style={[styles.premiumCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#f0f0f0' }]}
                onPress={() => navigation.navigate('SearchResultsScreen', { stockSymbol: item.symbol })}
                activeOpacity={0.8}
            >
                <View style={styles.cardHeader}>
                    <View style={styles.symbolInfo}>
                        <View style={[styles.logoBadge, { backgroundColor: colors[index % colors.length] }]}>
                            <Text style={styles.logoText}>{item.symbol.substring(0, 1)}</Text>
                        </View>
                        <View style={{ marginLeft: 12 }}>
                            <Text style={[styles.cardSymbol, { color: isDark ? '#fff' : '#1a1a1a' }]}>{item.symbol}</Text>
                            <Text style={styles.cardCompanyName} numberOfLines={1}>{item.companyName}</Text>
                        </View>
                    </View>
                    <View style={styles.actionButtons}>
                        <TouchableOpacity
                            style={[styles.miniButton, { backgroundColor: isDark ? '#333' : '#f0f2f5' }]}
                            onPress={() => {
                                setSelectedHolding(item);
                                setManageMode('buy');
                                setEditingTransaction(null);
                                setIsManageModalVisible(true);
                            }}
                        >
                            <MaterialIcons name="add" size={18} color="#007AFF" />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.miniButton, { backgroundColor: isDark ? 'rgba(255, 59, 48, 0.1)' : 'rgba(255, 59, 48, 0.05)' }]}
                            onPress={() => handleDelete(item.symbol)}
                        >
                            <MaterialIcons name="delete-outline" size={18} color="#FF3B30" />
                        </TouchableOpacity>
                    </View>
                </View>

                <View style={styles.cardContent}>
                    <View style={styles.dataColumn}>
                        <Text style={styles.dataLabel}>HOLDINGS</Text>
                        <Text style={[styles.dataValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>{item.shares} <Text style={styles.dataUnit}>shares</Text></Text>
                    </View>
                    <View style={[styles.dataColumn, { alignItems: 'flex-end' }]}>
                        <Text style={styles.dataLabel}>MARKET VALUE</Text>
                        <Text style={[styles.dataValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>{displayValue}</Text>
                    </View>
                </View>

                <View style={[styles.cardFooter, { borderTopColor: isDark ? '#333' : '#f0f0f0' }]}>
                    <View style={styles.profitInfo}>
                        {isClosed ? (
                            <>
                                <Text style={[styles.footerProfit, isRealizedPositive ? styles.positive : styles.negative]}>
                                    {isRealizedPositive ? '+' : '-'}{displayRealizedProfitItem}
                                </Text>
                                <Text style={styles.footerLabel}>Realized {isRealizedPositive ? 'Gain' : 'Loss'}</Text>
                            </>
                        ) : (
                            <>
                                <Text style={[styles.footerProfit, isPositive ? styles.positive : styles.negative]}>
                                    {isPositive ? '+' : '-'}{displayProfit} ({profitPercent.toFixed(2)}%)
                                </Text>
                                <Text style={styles.footerLabel}>Total Return</Text>
                            </>
                        )}
                    </View>
                    {!isClosed && item.priceChange !== undefined && (
                        <View style={{ alignItems: 'flex-end' }}>
                            <Text style={[styles.footerDayChange, item.priceChange >= 0 ? styles.positive : styles.negative]}>
                                {item.priceChange >= 0 ? '+' : '-'}{displayDailyGain} ({item.pricePercent?.toFixed(2)}%)
                            </Text>
                            <Text style={styles.footerLabel}>Today</Text>
                        </View>
                    )}
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#f8f9fa' }]}>
            {loading && portfolio.length === 0 ? (
                <View style={styles.loaderContainer}>
                    <ActivityIndicator size="large" color="#007AFF" />
                </View>
            ) : openPositions.length > 0 || closedPositions.length > 0 ? (
                <FlatList
                    data={openPositions}
                    keyExtractor={(item) => item.symbol}
                    renderItem={renderItem}
                    ListHeaderComponent={
                        <View>
                            <View style={styles.headerContainer}>
                                <View style={styles.headerRow}>
                                    <TouchableOpacity
                                        style={[styles.iconButton, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}
                                        onPress={() => {
                                            loadGlobalHistory();
                                            setIsHistoryModalVisible(true);
                                        }}
                                    >
                                        <MaterialIcons name="history" size={24} color={isDark ? '#fff' : '#1a1a1a'} />
                                    </TouchableOpacity>
                                    <Text style={[styles.title, { color: isDark ? '#fff' : '#1a1a1a' }]}>Portfolio</Text>
                                    <View style={{ width: 44 }} />
                                </View>

                                <View style={[styles.mainDashboard, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#f0f0f0' }]}>
                                    <View style={styles.totalValueSection}>
                                        <Text style={styles.dashboardLabel}>Total Balance</Text>
                                        <Text style={[styles.totalValueDisplay, { color: isDark ? '#fff' : '#000' }]}>{displayTotalValue}</Text>
                                        <View style={styles.todayChangeRow}>
                                            <View style={[styles.tinyBadge, { backgroundColor: totalDayChange >= 0 ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 59, 48, 0.1)' }]}>
                                                <Text style={[styles.todayChangeText, totalDayChange >= 0 ? styles.positive : styles.negative]}>
                                                    {totalDayChange >= 0 ? '+' : ''}{displayDayChange} ({totalDayChangePercent.toFixed(2)}%)
                                                </Text>
                                            </View>
                                            <Text style={styles.todayLabel}>Today</Text>
                                        </View>
                                    </View>

                                    <View style={[styles.dashDivider, { backgroundColor: isDark ? '#333' : '#f0f0f0' }]} />

                                    <View style={styles.statsGrid}>
                                        <View style={styles.statBox}>
                                            <Text style={styles.statBoxLabel}>UNREALIZED</Text>
                                            <Text style={[styles.statBoxValue, totalProfit >= 0 ? styles.positive : styles.negative]}>
                                                {totalProfit >= 0 ? '+' : ''}{displayUnrealized}
                                            </Text>
                                        </View>
                                        <View style={styles.statBox}>
                                            <Text style={styles.statBoxLabel}>REALIZED</Text>
                                            <Text style={[styles.statBoxValue, totalRealizedProfit >= 0 ? styles.positive : styles.negative]}>
                                                {totalRealizedProfit >= 0 ? '+' : ''}{displayRealized}
                                            </Text>
                                        </View>
                                    </View>
                                </View>
                            </View>
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
                                    data={performanceData}
                                    showBenchmark={showBenchmark}
                                    range={selectedRange}
                                    isDark={isDark}
                                    formatValue={(val) => formatCurrency(convertCurrency(val, 'USD', currency, exchangeRates), currency)}
                                />
                                {performanceData.length > 1 && (() => {
                                    const effectiveStart = performanceData.find((h: ChartDataPoint) => h.totalValue > 0) || performanceData[0];
                                    const startProfit = effectiveStart.totalProfit;
                                    const endProfit = performanceData[performanceData.length - 1].totalProfit;
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
                                        <View style={[styles.rangeSummary, { borderTopColor: isDark ? '#333' : '#f0f0f0' }]}>
                                            <Text style={styles.rangeLabelText}>{rangeLabel}</Text>
                                            <Text style={[styles.rangeChange, isPositive ? styles.positiveText : styles.negativeText]}>
                                                {isPositive ? '+' : '-'}{displayChangeAmount} ({isPositive ? '+' : ''}{changePercent.toFixed(1)}%)
                                            </Text>
                                        </View>
                                    );
                                })()}
                            </View>
                            <View style={[styles.chartContainer, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#f0f0f0' }]}>
                                <Text style={[styles.chartSectionTitle, { color: isDark ? '#fff' : '#000' }]}>Portfolio Allocation</Text>
                                <PieChart data={chartData} isDark={isDark} />
                            </View>

                            {/* Cash Balance Section */}
                            <View style={[styles.premiumCard, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#f0f0f0', marginTop: 8 }]}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <View>
                                        <Text style={styles.dataLabel}>CASH BALANCE</Text>
                                        <Text style={[styles.dataValue, { fontSize: 24, color: isDark ? '#fff' : '#000' }]}>
                                            {formatCurrency(cashBalance, currency)}
                                        </Text>
                                    </View>
                                    <View style={{ flexDirection: 'row', gap: 7, marginLeft: 12 }}>
                                        <TouchableOpacity
                                            style={[styles.miniButton, { width: 'auto', paddingHorizontal: 10, height: 44, backgroundColor: isDark ? '#333' : '#f0f2f5' }]}
                                            onPress={() => {
                                                setCashType('deposit');
                                                setIsCashModalVisible(true);
                                            }}
                                        >
                                            <Text style={{ color: '#007AFF', fontSize: 12, fontWeight: '800' }}>Deposit</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.miniButton, { width: 'auto', paddingHorizontal: 10, height: 44, backgroundColor: isDark ? '#333' : '#f0f2f5' }]}
                                            onPress={() => {
                                                setCashType('withdraw');
                                                setIsCashModalVisible(true);
                                            }}
                                        >
                                            <Text style={{ color: isDark ? '#aaa' : '#666', fontSize: 12, fontWeight: '800' }}>Withdraw</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            </View>
                        </View>
                    }
                    ListFooterComponent={
                        closedPositions.length > 0 ? (
                            <View style={[styles.closedSection]}>
                                <Text style={[styles.chartSectionTitle, { color: isDark ? '#fff' : '#1a1a1a', marginLeft: 16, marginTop: 24, marginBottom: 8 }]}>Closed Positions</Text>
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
            <TransactionModal
                isVisible={isManageModalVisible}
                onClose={() => setIsManageModalVisible(false)}
                symbol={selectedHolding?.symbol || ''}
                companyName={selectedHolding?.companyName || ''}
                currency={selectedHolding?.currency || 'USD'}
                existingShares={selectedHolding?.shares || 0}
                initialMode={manageMode as 'buy' | 'sell' | 'history'}
                initialTransaction={editingTransaction}
                onSuccess={loadPortfolio}
                currentPrice={selectedHolding?.price}
            />



            {/* Global History Modal */}
            <Modal
                animationType="slide"
                presentationStyle="pageSheet"
                visible={isHistoryModalVisible}
                onRequestClose={() => setIsHistoryModalVisible(false)}
            >
                <View style={[styles.historyModalContainer, { backgroundColor: isDark ? '#000' : '#f8f9fa' }]}>
                    <View style={styles.historyHeader}>
                        <Text style={[styles.modalTitle, { color: isDark ? '#fff' : '#1a1a1a', marginBottom: 0 }]}>History</Text>
                        <TouchableOpacity
                            onPress={() => setIsHistoryModalVisible(false)}
                            style={[styles.iconButton, { backgroundColor: isDark ? '#333' : '#f0f2f5' }]}
                        >
                            <MaterialIcons name="close" size={24} color={isDark ? '#fff' : '#1a1a1a'} />
                        </TouchableOpacity>
                    </View>
                    <TransactionList
                        transactions={globalTransactions}

                        onEdit={(tx) => {
                            if (tx.type === 'deposit' || tx.type === 'withdraw') return;
                            const holding = portfolio.find(h => h.symbol === tx.symbol);
                            setSelectedHolding(holding || {
                                symbol: tx.symbol,
                                companyName: tx.symbol,
                                shares: 0,
                                currency: tx.currency || 'USD'
                            } as any);
                            setEditingTransaction(tx);
                            setManageMode(tx.type as 'buy' | 'sell');
                            setIsHistoryModalVisible(false);
                            setIsManageModalVisible(true);
                        }}
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
            </Modal>

            {/* Cash Modal */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={isCashModalVisible}
                onRequestClose={() => setIsCashModalVisible(false)}
            >
                <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); setIsCashModalVisible(false); }}>
                    <View style={styles.modalOverlay}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                            style={{ width: '100%' }}
                        >
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
                        </KeyboardAvoidingView>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    headerContainer: {
        paddingTop: Platform.OS === 'ios' ? 60 : 40,
        paddingBottom: 24,
        paddingHorizontal: 20,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
    },

    title: {
        fontSize: 34,
        fontWeight: '900',
        letterSpacing: -1,
    },
    iconButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    mainDashboard: {
        padding: 24,
        borderRadius: 32,
        borderWidth: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.1,
        shadowRadius: 20,
        elevation: 8,
    },
    totalValueSection: {
        alignItems: 'center',
        marginBottom: 20,
    },
    dashboardLabel: {
        fontSize: 12,
        fontWeight: '800',
        color: '#8e8e93',
        textTransform: 'uppercase',
        letterSpacing: 1.5,
        marginBottom: 8,
    },
    totalValueDisplay: {
        fontSize: 40,
        fontWeight: '900',
        letterSpacing: -1,
        marginBottom: 8,
    },
    todayChangeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    tinyBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
    },
    todayChangeText: {
        fontSize: 14,
        fontWeight: '800',
    },
    todayLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: '#8e8e93',
    },
    dashDivider: {
        height: 1,
        width: '100%',
        marginBottom: 20,
    },
    statsGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    statBox: {
        flex: 1,
        alignItems: 'center',
    },
    statBoxLabel: {
        fontSize: 10,
        fontWeight: '800',
        color: '#8e8e93',
        marginBottom: 4,
    },
    statBoxValue: {
        fontSize: 16,
        fontWeight: '800',
    },
    listContent: {
        paddingBottom: 100,
    },
    premiumCard: {
        marginHorizontal: 20,
        marginBottom: 16,
        borderRadius: 24,
        padding: 20,
        borderWidth: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 8,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    loaderContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    historyModalContainer: {
        flex: 1,
        padding: 24,
    },
    historyHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
    },
    symbolInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    logoBadge: {
        width: 40,
        height: 40,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    logoText: {
        color: '#fff',
        fontWeight: '900',
        fontSize: 18,
    },
    cardSymbol: {
        fontSize: 17,
        fontWeight: '800',
        letterSpacing: -0.5,
    },
    cardCompanyName: {
        fontSize: 12,
        color: '#8e8e93',
        fontWeight: '600',
        maxWidth: 150,
    },
    actionButtons: {
        flexDirection: 'row',
        gap: 8,
    },
    miniButton: {
        width: 36,
        height: 36,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardContent: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    dataColumn: {
        flex: 1,
    },
    dataLabel: {
        fontSize: 10,
        fontWeight: '800',
        color: '#8e8e93',
        marginBottom: 4,
        letterSpacing: 0.5,
    },
    dataValue: {
        fontSize: 18,
        fontWeight: '800',
    },
    dataUnit: {
        fontSize: 12,
        fontWeight: '600',
        color: '#8e8e93',
    },
    cardFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 16,
        borderTopWidth: 1,
    },
    profitInfo: {
        flex: 1,
    },
    footerProfit: {
        fontSize: 15,
        fontWeight: '800',
    },
    footerDayChange: {
        fontSize: 15,
        fontWeight: '800',
    },
    footerLabel: {
        fontSize: 10,
        fontWeight: '700',
        color: '#8e8e93',
        marginTop: 2,
        textTransform: 'uppercase',
    },
    chartContainer: {
        marginHorizontal: 20,
        marginBottom: 24,
        padding: 24,
        borderRadius: 28,
        elevation: 8,
    },
    chartSectionTitle: {
        fontSize: 18,
        fontWeight: '900',
        letterSpacing: -0.5,
        marginBottom: 20,
    },
    chartHeader: {
        marginBottom: 20,
    },
    rangeContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        padding: 4,
        borderRadius: 14,
    },
    rangeChip: {
        flex: 1,
        paddingVertical: 8,
        borderRadius: 10,
        alignItems: 'center',
    },
    rangeChipActive: {
        backgroundColor: '#fff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 8,
    },
    rangeChipActiveDark: {
        backgroundColor: '#333',
    },
    rangeText: {
        fontSize: 12,
        fontWeight: '800',
        color: '#8e8e93',
    },
    rangeTextActive: {
        color: '#007AFF',
    },
    benchmarkToggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        marginBottom: 16,
        gap: 8,
    },
    benchmarkLabel: {
        fontSize: 12,
        fontWeight: '700',
    },
    rangeSummary: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 20,
        paddingTop: 16,
        borderTopWidth: 1,
    },
    rangeLabelText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#8e8e93',
    },
    rangeChange: {
        fontSize: 15,
        fontWeight: '800',
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
    },
    emptyText: {
        fontSize: 24,
        fontWeight: '900',
        marginTop: 24,
        textAlign: 'center',
    },
    emptySubtext: {
        fontSize: 16,
        color: '#8e8e93',
        textAlign: 'center',
        marginTop: 12,
        lineHeight: 24,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 40,
        borderTopRightRadius: 40,
        padding: 32,
        paddingBottom: Platform.OS === 'ios' ? 50 : 32,
    },
    modalTitle: {
        fontSize: 24,
        fontWeight: '900',
        marginBottom: 24,
        letterSpacing: -0.5,
    },
    modeTabs: {
        flexDirection: 'row',
        padding: 6,
        borderRadius: 16,
        marginBottom: 24,
    },
    modeTab: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: 'center',
    },
    modeTabActive: {
        backgroundColor: '#fff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 8,
    },
    modeTabText: {
        fontSize: 14,
        fontWeight: '800',
        color: '#8e8e93',
    },
    modeTabTextActive: {
        color: '#007AFF',
    },
    inputGroup: {
        marginBottom: 16,
    },
    inputLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#8e8e93',
        marginLeft: 4,
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    modalInput: {
        height: 64,
        borderRadius: 20,
        paddingHorizontal: 20,
        fontSize: 20,
        fontWeight: '800',
        borderWidth: 1.5,
        marginBottom: 16,
        textAlign: 'center',
    },
    dateRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderRadius: 20,
        padding: 16,
        marginBottom: 24,
        borderWidth: 1.5,
    },
    dateLabelGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    calendarIcon: {
        opacity: 0.8,
    },
    datePickerText: {
        fontSize: 16,
        fontWeight: '700',
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
        width: '100%',
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
        justifyContent: 'space-between',
        marginBottom: 20,
    },
    datePickerTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#1a1a1a',
    },
    modalButtons: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 8,
    },
    modalButton: {
        flex: 1,
        height: 56,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    saveButton: {
        backgroundColor: '#007AFF',
    },
    cancelButton: {
        backgroundColor: 'transparent',
    },
    saveButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '800',
    },
    cancelButtonText: {
        fontSize: 16,
        fontWeight: '800',
    },
    currentPositionText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#8e8e93',
        marginBottom: 24,
        textAlign: 'center',
    },
    positive: {
        color: '#34C759',
    },
    negative: {
        color: '#FF3B30',
    },
    positiveText: {
        color: '#34C759',
    },
    negativeText: {
        color: '#FF3B30',
    },
    closedSection: {
        paddingVertical: 20,
    },
});

export default PortfolioScreen;
