import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, ScrollView, TouchableWithoutFeedback, Keyboard } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getPortfolio, removeHolding, updatePrice, addHolding, PortfolioHolding, addPortfolioSnapshot, getPortfolioHistory, PortfolioSnapshot } from '@/utils/db';
import PieChart from '@/components/PieChart';
import PortfolioLineChart from '@/components/PortfolioLineChart';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { fetchStockPrice } from '@/utils/secApi';

const PortfolioScreen: React.FC = () => {
    const [portfolio, setPortfolio] = useState<PortfolioHolding[]>([]);
    const [history, setHistory] = useState<PortfolioSnapshot[]>([]);
    const [loading, setLoading] = useState(true);

    // Management Modal State
    const [isManageModalVisible, setIsManageModalVisible] = useState(false);
    const [selectedHolding, setSelectedHolding] = useState<PortfolioHolding | null>(null);
    const [sharesAmount, setSharesAmount] = useState('');
    const [priceAmount, setPriceAmount] = useState('');
    const [manageMode, setManageMode] = useState<'buy' | 'sell'>('buy');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const loadPortfolio = async () => {
        try {
            setLoading(true);
            const [holdings, historyData] = await Promise.all([
                getPortfolio(),
                getPortfolioHistory()
            ]);

            setPortfolio(holdings);
            setHistory(historyData);

            // Calculate total value for snapshot
            const totalValue = holdings.reduce((acc, curr) => acc + (curr.shares * (curr.price || 0)), 0);
            if (totalValue > 0) {
                await addPortfolioSnapshot(totalValue);
                // Refresh history after snapshot
                const updatedHistory = await getPortfolioHistory();
                setHistory(updatedHistory);
            }

            // Background refresh prices
            refreshPrices(holdings);
        } catch (err) {
            console.error("Error loading portfolio:", err);
        } finally {
            setLoading(false);
        }
    };

    const refreshPrices = async (holdings: PortfolioHolding[]) => {
        for (const holding of holdings) {
            try {
                const quote = await fetchStockPrice(holding.symbol);
                if (quote.price > 0) {
                    await updatePrice(holding.symbol, quote.price);
                }
            } catch (err) {
                console.error(`Failed to refresh price for ${holding.symbol}:`, err);
            }
        }
        const data = await getPortfolio();
        setPortfolio(data);
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

    // Chart Data based on Dollar Value
    const chartData = portfolio.map((item, index) => ({
        label: item.symbol,
        value: item.shares * (item.price || 0),
        color: colors[index % colors.length],
    }));

    const totalPortfolioValue = portfolio.reduce((acc, curr) => acc + (curr.shares * (curr.price || 0)), 0);
    const totalCostBasis = portfolio.reduce((acc, curr) => acc + (curr.shares * (curr.costBasis || curr.price || 0)), 0);
    const totalProfit = totalPortfolioValue - totalCostBasis;
    const totalProfitPercent = totalCostBasis > 0 ? (totalProfit / totalCostBasis) * 100 : 0;

    const totalRealizedProfit = portfolio.reduce((acc, curr) => acc + (curr.realizedProfit || 0), 0);

    const handleManageSave = async () => {
        const shares = parseFloat(sharesAmount);
        const price = parseFloat(priceAmount);

        if (isNaN(shares) || shares <= 0) {
            Alert.alert("Invalid input", "Please enter a valid number of shares.");
            return;
        }

        if (isNaN(price) || price <= 0) {
            Alert.alert("Invalid input", "Please enter a valid price.");
            return;
        }

        if (!selectedHolding) return;

        setIsSubmitting(true);
        try {
            const sharesChange = manageMode === 'buy' ? shares : -shares;

            await addHolding({
                symbol: selectedHolding.symbol,
                companyName: selectedHolding.companyName,
                shares: sharesChange,
                price: price // Use the user-entered price
            });

            setIsManageModalVisible(false);
            setSharesAmount('');
            setPriceAmount('');
            loadPortfolio();
            Alert.alert("Success", "Portfolio updated successfully.");
        } catch (err) {
            console.error("Error updating portfolio:", err);
            Alert.alert("Error", "Could not update portfolio. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const renderItem = ({ item, index }: { item: PortfolioHolding, index: number }) => {
        const currentPrice = item.price || 0;
        const value = item.shares * currentPrice;
        const costBasis = item.costBasis || currentPrice;
        const profit = (currentPrice - costBasis) * item.shares;
        const profitPercent = costBasis > 0 ? ((currentPrice - costBasis) / costBasis) * 100 : 0;

        return (
            <View style={styles.holdingItem}>
                <View style={[styles.colorIndicator, { backgroundColor: colors[index % colors.length] }]} />
                <View style={styles.holdingInfo}>
                    <View style={styles.symbolHeader}>
                        <Text style={styles.symbol}>{item.symbol}</Text>
                        {(item.realizedProfit || 0) !== 0 && (
                            <Text style={[styles.realizedBadge, (item.realizedProfit || 0) > 0 ? styles.positiveBadge : styles.negativeBadge]}>
                                Realized: {(item.realizedProfit || 0) >= 0 ? '+' : '-'}${Math.abs(item.realizedProfit || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </Text>
                        )}
                    </View>
                    <Text style={styles.companyName} numberOfLines={1}>{item.companyName}</Text>
                </View>
                <View style={styles.sharesContainer}>
                    <Text style={styles.shares}>{item.shares.toLocaleString()} shares</Text>
                    <View style={styles.profitContainer}>
                        <Text style={[styles.profitText, profit >= 0 ? styles.positive : styles.negative]}>
                            {profit >= 0 ? '+' : ''}${Math.abs(profit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Text>
                        <Text style={[styles.profitPercent, profit >= 0 ? styles.positiveIcon : styles.negativeIcon]}>
                            ({profit >= 0 ? '+' : ''}{profitPercent.toFixed(2)}%)
                        </Text>
                    </View>
                    <Text style={styles.value}>${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                </View>
                <TouchableOpacity
                    style={styles.manageButton}
                    onPress={() => {
                        setSelectedHolding(item);
                        setManageMode('buy');
                        setPriceAmount((item.price || 0).toString());
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
            </View>
        );
    };

    return (
        <View style={styles.container}>
            <Text style={styles.title}>My Portfolio</Text>

            <View style={styles.headerStats}>
                <View style={styles.totalValueContainer}>
                    <Text style={styles.totalValueLabel}>Total Value</Text>
                    <Text style={styles.totalValue}>${totalPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                </View>

                <View style={styles.statDivider} />

                <View style={styles.statsColumn}>
                    <View style={styles.statRow}>
                        <Text style={styles.statLabel}>Unrealized</Text>
                        <Text style={[styles.statValue, totalProfit >= 0 ? styles.positive : styles.negative]}>
                            {totalProfit >= 0 ? '+' : '-'}${Math.abs(totalProfit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Text>
                    </View>
                    <View style={styles.statRow}>
                        <Text style={styles.statLabel}>Realized</Text>
                        <Text style={[styles.statValue, totalRealizedProfit >= 0 ? styles.positive : styles.negative]}>
                            {totalRealizedProfit >= 0 ? '+' : '-'}${Math.abs(totalRealizedProfit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Text>
                    </View>
                </View>
            </View>

            {loading && portfolio.length === 0 ? (
                <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
            ) : portfolio.length > 0 ? (
                <FlatList
                    data={portfolio}
                    keyExtractor={(item) => item.symbol}
                    renderItem={renderItem}
                    ListHeaderComponent={
                        <View>
                            <View style={styles.chartContainer}>
                                <Text style={styles.chartSectionTitle}>Historical Performance</Text>
                                <PortfolioLineChart data={history} />
                            </View>
                            <View style={styles.chartContainer}>
                                <Text style={styles.chartSectionTitle}>Allocation (%)</Text>
                                <PieChart data={chartData} />
                            </View>
                        </View>
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
                <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                    <View style={styles.modalOverlay}>
                        <TouchableWithoutFeedback>
                            <View style={styles.modalContent}>
                                <Text style={styles.modalTitle}>Manage {selectedHolding?.symbol}</Text>

                                <View style={styles.modeTabs}>
                                    <TouchableOpacity
                                        style={[styles.modeTab, manageMode === 'buy' && styles.modeTabActive]}
                                        onPress={() => setManageMode('buy')}
                                    >
                                        <Text style={[styles.modeTabText, manageMode === 'buy' && styles.modeTabTextActive]}>Buy</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.modeTab, manageMode === 'sell' && styles.modeTabActive]}
                                        onPress={() => setManageMode('sell')}
                                    >
                                        <Text style={[styles.modeTabText, manageMode === 'sell' && styles.modeTabTextActive]}>Sell</Text>
                                    </TouchableOpacity>
                                </View>

                                <Text style={styles.currentPositionText}>
                                    Current Position: {selectedHolding?.shares.toLocaleString()} shares
                                </Text>

                                <View style={styles.inputGroup}>
                                    <Text style={styles.inputLabel}>Shares</Text>
                                    <TextInput
                                        style={styles.modalInput}
                                        placeholder="0"
                                        keyboardType="numeric"
                                        value={sharesAmount}
                                        onChangeText={setSharesAmount}
                                        placeholderTextColor="#999"
                                    />
                                </View>

                                <View style={styles.inputGroup}>
                                    <Text style={styles.inputLabel}>Price per share ($)</Text>
                                    <TextInput
                                        style={styles.modalInput}
                                        placeholder="0.00"
                                        keyboardType="numeric"
                                        value={priceAmount}
                                        onChangeText={setPriceAmount}
                                        placeholderTextColor="#999"
                                    />
                                </View>

                                <View style={styles.modalButtons}>
                                    <TouchableOpacity
                                        style={[styles.modalButton, styles.cancelButton]}
                                        onPress={() => {
                                            setIsManageModalVisible(false);
                                            setSharesAmount('');
                                            setPriceAmount('');
                                        }}
                                    >
                                        <Text style={styles.cancelButtonText}>Cancel</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.modalButton, styles.saveButton]}
                                        onPress={handleManageSave}
                                        disabled={isSubmitting}
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
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8f9fa',
        paddingTop: 60,
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
        marginBottom: 12,
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
    symbolHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    symbol: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1a1a1a',
    },
    realizedBadge: {
        fontSize: 10,
        fontWeight: '700',
        marginLeft: 8,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        overflow: 'hidden',
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
    currentPositionText: {
        fontSize: 14,
        color: '#666',
        marginBottom: 20,
        textAlign: 'center',
    },
    inputGroup: {
        marginBottom: 16,
    },
    inputLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#666',
        marginBottom: 8,
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
});

export default PortfolioScreen;
