import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TextInput,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
    Platform,
    TouchableWithoutFeedback,
    Keyboard
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '@/context/ThemeContext';
import { addHolding, getTransactions, deleteTransaction, updateTransaction, Transaction } from '@/utils/db';
import { fetchPriceForDate } from '@/utils/secApi';
import TransactionList from './TransactionList';

interface TransactionModalProps {
    isVisible: boolean;
    onClose: () => void;
    symbol: string;
    companyName: string;
    currency: string;
    existingShares?: number;
    initialMode?: 'buy' | 'sell' | 'history';
    initialTransaction?: Transaction | null;
    onSuccess: () => void;
    currentPrice?: number;
}

const TransactionModal: React.FC<TransactionModalProps> = ({
    isVisible,
    onClose,
    symbol,
    companyName,
    currency,
    existingShares = 0,
    initialMode = 'buy',
    initialTransaction = null,
    onSuccess,
    currentPrice
}) => {
    const { isDark } = useTheme();
    const [mode, setMode] = useState<'buy' | 'sell' | 'history'>(initialMode);
    const [shares, setShares] = useState('');
    const [price, setPrice] = useState('');
    const [date, setDate] = useState(new Date());
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isPriceLoading, setIsPriceLoading] = useState(false);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(initialTransaction);

    useEffect(() => {
        if (isVisible) {
            setMode(initialMode);
            setEditingTransaction(initialTransaction);
            if (initialTransaction) {
                setShares(initialTransaction.shares.toString());
                setPrice(initialTransaction.price.toString());
                setDate(new Date(initialTransaction.date));
            } else {
                setShares('');
                setPrice(currentPrice ? currentPrice.toString() : '');
                setDate(new Date());
            }
            if (initialMode === 'history' || mode === 'history') {
                loadTransactions();
            }
        }
    }, [isVisible, initialMode, initialTransaction]);

    useEffect(() => {
        if (mode === 'history') {
            loadTransactions();
        }
    }, [mode, symbol]);

    const loadTransactions = async () => {
        try {
            const txs = await getTransactions(symbol);
            setTransactions(txs);
        } catch (e) {
            console.error("Error loading transactions:", e);
        }
    };

    // Auto-fetch price when date changes
    useEffect(() => {
        if (!isVisible || mode === 'history') return;

        // If editing, check if date has changed
        if (editingTransaction) {
            const originalDate = new Date(editingTransaction.date);
            const isSameDate = date.getDate() === originalDate.getDate() &&
                date.getMonth() === originalDate.getMonth() &&
                date.getFullYear() === originalDate.getFullYear();

            // If date is same as original, revert to original price and stop (don't fetch)
            if (isSameDate) {
                // Only reset if price is different (avoid loop)
                if (price !== editingTransaction.price.toString()) {
                    setPrice(editingTransaction.price.toString());
                }
                return;
            }
        }

        const isToday = (d: Date) => {
            const now = new Date();
            return d.getDate() === now.getDate() &&
                d.getMonth() === now.getMonth() &&
                d.getFullYear() === now.getFullYear();
        };

        if (isToday(date) && !shares && !editingTransaction) return;

        const timer = setTimeout(async () => {
            setIsPriceLoading(true);
            try {
                const fetchedPrice = await fetchPriceForDate(symbol, date);
                if (fetchedPrice !== null) {
                    setPrice(fetchedPrice.toString());
                }
            } catch (err) {
                console.error("Error auto-fetching price:", err);
            } finally {
                setIsPriceLoading(false);
            }
        }, 600);

        return () => clearTimeout(timer);
    }, [date, symbol, isVisible, mode, editingTransaction]);

    const handleSave = async () => {
        const sharesNum = parseFloat(shares);
        const priceNum = parseFloat(price);

        if (isNaN(sharesNum) || sharesNum <= 0 || isNaN(priceNum) || priceNum <= 0) {
            Alert.alert("Invalid input", "Please enter valid shares and price.");
            return;
        }

        setIsSubmitting(true);
        try {
            if (editingTransaction) {
                await updateTransaction(editingTransaction.id!, {
                    type: mode as 'buy' | 'sell',
                    shares: sharesNum,
                    price: priceNum,
                    date: date.toISOString()
                });
                Alert.alert("Success", "Transaction updated.");
            } else {
                const sharesChange = mode === 'buy' ? sharesNum : -sharesNum;

                if (mode === 'sell' && existingShares < sharesNum) {
                    Alert.alert("Insufficient shares", `You only own ${existingShares.toLocaleString()} shares.`);
                    setIsSubmitting(false);
                    return;
                }

                await addHolding({
                    symbol,
                    companyName,
                    shares: sharesChange,
                    price: priceNum,
                    currency: currency || 'USD',
                    lastTransactionDate: date.toISOString()
                });
                Alert.alert("Success", "Portfolio updated successfully.");
            }

            onSuccess();
            onClose();
        } catch (err) {
            console.error("Error saving transaction:", err);
            Alert.alert("Error", "Could not save transaction.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleEditTransaction = (tx: Transaction) => {
        setEditingTransaction(tx);
        setMode(tx.type as 'buy' | 'sell');
        setShares(tx.shares.toString());
        setPrice(tx.price.toString());
        setDate(new Date(tx.date));
    };

    const handleDeleteTransaction = async (tx: Transaction) => {
        Alert.alert("Delete Transaction", "Are you sure?", [
            { text: "Cancel", style: "cancel" },
            {
                text: "Delete", style: "destructive", onPress: async () => {
                    if (tx.id) {
                        try {
                            await deleteTransaction(tx.id);
                            loadTransactions();
                            onSuccess();
                        } catch (e) {
                            Alert.alert("Error", "Failed to delete transaction.");
                        }
                    }
                }
            }
        ]);
    };

    return (
        <Modal
            animationType="slide"
            transparent={true}
            visible={isVisible}
            onRequestClose={onClose}
        >
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={styles.modalOverlay}>
                    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                        <View style={[styles.modalContent, { backgroundColor: isDark ? '#1a1a1a' : '#fff' }]}>
                            <View style={styles.modalHeader}>
                                <Text style={[styles.modalTitle, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                                    {editingTransaction ? 'Edit Transaction' : (existingShares > 0 ? `Manage ${symbol}` : `Add ${symbol}`)}
                                </Text>
                                <TouchableOpacity onPress={onClose}>
                                    <Ionicons name="close-circle" size={28} color={isDark ? '#444' : '#ccc'} />
                                </TouchableOpacity>
                            </View>

                            {(existingShares > 0 || initialMode === 'history') && !editingTransaction && (
                                <View style={[styles.modeTabs, { backgroundColor: isDark ? '#000' : '#f0f0f0' }]}>
                                    {(['buy', 'sell', 'history'] as const).map((m) => (
                                        <TouchableOpacity
                                            key={m}
                                            style={[styles.modeTab, mode === m && (isDark ? styles.modeTabActiveDark : styles.modeTabActive)]}
                                            onPress={() => setMode(m)}
                                        >
                                            <Text style={[styles.modeTabText, { color: isDark ? '#8e8e93' : '#666' }, mode === m && styles.modeTabTextActive]}>
                                                {m.charAt(0).toUpperCase() + m.slice(1)}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            )}

                            {mode === 'history' ? (
                                <View style={{ height: 400 }}>
                                    <TransactionList
                                        transactions={transactions}
                                        onEdit={handleEditTransaction}
                                        onDelete={handleDeleteTransaction}
                                        currency={currency}
                                    />
                                </View>
                            ) : (
                                <View style={styles.modalForm}>
                                    {existingShares > 0 && !editingTransaction && (
                                        <Text style={[styles.currentPositionText, { color: isDark ? '#aaa' : '#666' }]}>
                                            Current Position: {existingShares.toLocaleString()} shares
                                        </Text>
                                    )}

                                    <View style={styles.inputGroup}>
                                        <Text style={[styles.inputLabel, { color: isDark ? '#8e8e93' : '#666' }]}>Shares</Text>
                                        <TextInput
                                            style={[styles.modalInput, { backgroundColor: isDark ? '#2c2c2e' : '#f9f9f9', color: isDark ? '#fff' : '#000', borderColor: isDark ? '#3a3a3c' : '#eee' }]}
                                            placeholder="0"
                                            keyboardType="numeric"
                                            value={shares}
                                            onChangeText={setShares}
                                            placeholderTextColor={isDark ? '#666' : '#999'}
                                        />
                                    </View>

                                    <View style={styles.inputGroup}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
                                            <Text style={[styles.inputLabel, { color: isDark ? '#8e8e93' : '#666', marginBottom: 0 }]}>
                                                Price ({currency || 'USD'})
                                            </Text>
                                            {isPriceLoading && <ActivityIndicator size="small" color="#007AFF" style={{ marginLeft: 8 }} />}
                                        </View>
                                        <TextInput
                                            style={[styles.modalInput, { backgroundColor: isDark ? '#2c2c2e' : '#f9f9f9', color: isDark ? '#fff' : '#000', borderColor: isDark ? '#3a3a3c' : '#eee' }]}
                                            placeholder="0.00"
                                            keyboardType="numeric"
                                            value={price}
                                            onChangeText={setPrice}
                                            placeholderTextColor={isDark ? '#666' : '#999'}
                                        />
                                    </View>

                                    <TouchableOpacity
                                        style={[styles.datePickerTrigger, { backgroundColor: isDark ? '#2c2c2e' : '#f9f9f9', borderColor: isDark ? '#3a3a3c' : '#eee' }]}
                                        onPress={() => setShowDatePicker(true)}
                                    >
                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            <Ionicons name="calendar-outline" size={20} color="#007AFF" style={{ marginRight: 8 }} />
                                            <Text style={[styles.datePickerValueText, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                                                {date.toLocaleDateString()}
                                            </Text>
                                        </View>
                                        <Ionicons name="chevron-forward" size={16} color={isDark ? '#666' : '#999'} />
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[styles.saveButton, { backgroundColor: mode === 'sell' ? '#FF3B30' : '#007AFF' }]}
                                        disabled={isSubmitting}
                                        onPress={handleSave}
                                    >
                                        {isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>{editingTransaction ? 'Update Transaction' : 'Confirm Transaction'}</Text>}
                                    </TouchableOpacity>
                                </View>
                            )}
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>

            {/* Date Picker Modal */}
            {showDatePicker && (
                <Modal
                    transparent={true}
                    animationType="fade"
                    visible={showDatePicker}
                    onRequestClose={() => setShowDatePicker(false)}
                >
                    <TouchableOpacity
                        style={[styles.datePickerOverlay, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
                        activeOpacity={1}
                        onPress={() => setShowDatePicker(false)}
                    >
                        <TouchableWithoutFeedback>
                            <View style={[styles.datePickerContent, { backgroundColor: isDark ? '#1c1c1e' : '#fff' }]}>
                                <View style={styles.bottomSheetHandle} />
                                <View style={styles.datePickerHeader}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                                        <MaterialIcons name="calendar-today" size={24} color="#007AFF" />
                                        <Text style={[styles.datePickerTitleText, { color: isDark ? '#fff' : '#1a1a1a' }]}>Select Date</Text>
                                    </View>
                                    <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                                        <Ionicons name="close-circle-outline" size={28} color={isDark ? '#555' : '#ccc'} />
                                    </TouchableOpacity>
                                </View>
                                <DateTimePicker
                                    value={date}
                                    mode="date"
                                    display="inline"
                                    onChange={(event, selectedDate) => {
                                        if (selectedDate) setDate(selectedDate);
                                    }}
                                    maximumDate={new Date()}
                                    themeVariant={isDark ? "dark" : "light"}
                                />
                                <TouchableOpacity
                                    style={[styles.saveButton, { marginTop: 20 }]}
                                    onPress={() => setShowDatePicker(false)}
                                >
                                    <Text style={styles.saveButtonText}>Done</Text>
                                </TouchableOpacity>
                            </View>
                        </TouchableWithoutFeedback>
                    </TouchableOpacity>
                </Modal>
            )}
        </Modal>
    );
};

const styles = StyleSheet.create({
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
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
    },
    modalTitle: {
        fontSize: 24,
        fontWeight: '900',
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
    modeTabActiveDark: {
        backgroundColor: '#333',
    },
    modeTabText: {
        fontSize: 14,
        fontWeight: '800',
    },
    modeTabTextActive: {
        color: '#007AFF',
    },
    modalForm: {
        gap: 16,
    },
    inputGroup: {
        gap: 8,
    },
    inputLabel: {
        fontSize: 14,
        fontWeight: '700',
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
        textAlign: 'center',
    },
    datePickerTrigger: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: 64,
        borderRadius: 20,
        paddingHorizontal: 20,
        borderWidth: 1.5,
        marginTop: 8,
    },
    datePickerValueText: {
        fontSize: 18,
        fontWeight: '700',
    },
    saveButton: {
        height: 64,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 16,
        shadowColor: '#007AFF',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 8,
    },
    saveButtonText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '900',
    },
    currentPositionText: {
        fontSize: 14,
        fontWeight: '700',
        textAlign: 'center',
        marginBottom: 8,
    },
    datePickerOverlay: {
        flex: 1,
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
    datePickerTitleText: {
        fontSize: 18,
        fontWeight: '800',
    }
});

export default TransactionModal;
