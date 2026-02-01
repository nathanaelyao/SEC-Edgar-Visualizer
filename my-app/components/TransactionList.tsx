import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { Transaction } from '@/utils/db';
import { formatCurrency } from '@/utils/currency';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '@/context/ThemeContext';

interface TransactionListProps {
    transactions: Transaction[];
    onEdit?: (transaction: Transaction) => void;
    onDelete: (transaction: Transaction) => void;
    currency?: string;
}

const TransactionList: React.FC<TransactionListProps> = ({ transactions, onEdit, onDelete, currency = 'USD' }) => {
    const { isDark } = useTheme();

    const renderItem = ({ item }: { item: Transaction }) => (
        <View style={[styles.itemConfig, { backgroundColor: isDark ? '#1e1e1e' : '#fff', borderColor: isDark ? '#333' : '#eee' }]}>
            <View style={styles.infoContainer}>
                <View style={styles.topRow}>
                    <Text style={[styles.typeText, { color: (item.type === 'buy' || item.type === 'deposit') ? '#34C759' : '#FF3B30' }]}>
                        {item.type.toUpperCase()}
                    </Text>
                    <Text style={[styles.dateText, { color: isDark ? '#aaa' : '#888' }]}>{new Date(item.date).toLocaleDateString()}</Text>
                </View>
                <Text style={[styles.detailsText, { color: isDark ? '#fff' : '#333' }]}>
                    {(item.type === 'deposit' || item.type === 'withdraw')
                        ? formatCurrency(item.price, (item.currency as any) || 'USD')
                        : `${item.shares} shares @ ${formatCurrency(item.price, (item.currency as any) || (currency as any) || 'USD')}`}
                </Text>
            </View>
            <View style={styles.actionsContainer}>
                {onEdit && (
                    <TouchableOpacity onPress={() => onEdit(item)} style={styles.actionButton}>
                        <MaterialIcons name="edit" size={20} color={isDark ? '#0A84FF' : '#007AFF'} />
                    </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => onDelete(item)} style={styles.actionButton}>
                    <MaterialIcons name="delete" size={20} color="#FF3B30" />
                </TouchableOpacity>
            </View>
        </View>
    );

    return (
        <FlatList
            data={transactions}
            renderItem={renderItem}
            keyExtractor={(item) => item.id?.toString() || Math.random().toString()}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
                <Text style={[styles.emptyText, { color: isDark ? '#666' : '#999' }]}>No transaction history.</Text>
            }
        />
    );
};

const styles = StyleSheet.create({
    listContent: {
        paddingVertical: 10,
    },
    itemConfig: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 12,
        marginBottom: 8,
        borderRadius: 8,
        borderWidth: 1,
    },
    infoContainer: {
        flex: 1,
    },
    topRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
        marginRight: 10,
    },
    typeText: {
        fontWeight: 'bold',
        fontSize: 14,
    },
    dateText: {
        fontSize: 12,
    },
    detailsText: {
        fontSize: 14,
        fontWeight: '500',
    },
    actionsContainer: {
        flexDirection: 'row',
        gap: 12,
    },
    actionButton: {
        padding: 4,
    },
    emptyText: {
        textAlign: 'center',
        fontStyle: 'italic',
        marginTop: 20,
    },
});

export default TransactionList;
