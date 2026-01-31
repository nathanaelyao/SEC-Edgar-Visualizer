import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface InvestorItemProps {
    name: string;
    institution: string;
    numShares: string;
    value: string;
    percent: string;
    onPress: () => void;
}

const InvestorItem = memo(({ name, institution, numShares, value, percent, onPress }: InvestorItemProps) => {
    const formatNumberWithCommas = (number: any): string => {
        if (number === undefined || number === null) {
            return "N/A";
        }
        const n = typeof number === 'string' ? parseFloat(number) : number;
        return n.toLocaleString();
    };

    return (
        <TouchableOpacity style={styles.investorItem} onPress={onPress}>
            <Text style={styles.investorName}>{name ?? "N/A"}</Text>
            <Text style={styles.institutionName}>{institution ?? "N/A"}</Text>
            <View style={styles.holdingDetails}>
                <Text>Shares: {formatNumberWithCommas(numShares)}</Text>
                <Text>Value: ${formatNumberWithCommas(value)}</Text>
                <Text>Percentage of Portfolio: {percent ?? "N/A"}</Text>
            </View>
        </TouchableOpacity>
    );
});

const styles = StyleSheet.create({
    investorItem: {
        // Removed borders and margins to fit better inside cards
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
});

export default InvestorItem;
