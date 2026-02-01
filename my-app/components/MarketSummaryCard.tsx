import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import Svg, { Polyline, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from '@/context/ThemeContext';

interface MarketSummaryCardProps {
    symbol: string;
    name: string;
    data: number[];
    price: number;
    changePercent: number;
    onPress: () => void;
}

const MarketSummaryCard: React.FC<MarketSummaryCardProps> = ({
    symbol,
    name,
    data,
    price,
    changePercent,
    onPress
}) => {
    const { isDark } = useTheme();
    const isPositive = changePercent >= 0;
    const color = isPositive ? '#34C759' : '#FF3B30';

    const width = 120;
    const height = 60;
    const padding = 5;

    const chartPath = useMemo(() => {
        if (!data || data.length < 2) return '';
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;

        // Simple down-sampling if too many points (e.g., > 50)
        const sampleRate = Math.ceil(data.length / 50);
        const points = data.filter((_, i) => i % sampleRate === 0);

        return points.map((val, i) => {
            const x = (i / (points.length - 1)) * width;
            const y = height - ((val - min) / range) * height; // Invert Y
            return `${x},${y}`;
        }).join(' ');
    }, [data]);

    return (
        <TouchableOpacity
            style={[styles.card, { backgroundColor: isDark ? '#1e1e1e' : '#fff', borderColor: isDark ? '#333' : '#eee' }]}
            onPress={onPress}
            activeOpacity={0.7}
        >
            <View style={styles.header}>
                <Text style={[styles.symbol, { color: isDark ? '#fff' : '#000' }]}>{symbol}</Text>
                <View style={[styles.badge, { backgroundColor: isPositive ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 59, 48, 0.1)' }]}>
                    <Text style={[styles.change, { color: color }]}>
                        {isPositive ? '+' : ''}{changePercent.toFixed(2)}%
                    </Text>
                </View>
            </View>
            <Text style={[styles.name, { color: isDark ? '#aaa' : '#666' }]} numberOfLines={1}>{name}</Text>

            <View style={styles.chartContainer}>
                <Svg width={width} height={height}>
                    <Defs>
                        <LinearGradient id={`grad${symbol}`} x1="0" y1="0" x2="0" y2="1">
                            <Stop offset="0" stopColor={color} stopOpacity="0.4" />
                            <Stop offset="1" stopColor={color} stopOpacity="0" />
                        </LinearGradient>
                    </Defs>
                    <Polyline
                        points={chartPath}
                        fill="none"
                        stroke={color}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </Svg>
            </View>

            <Text style={[styles.price, { color: isDark ? '#fff' : '#000' }]}>
                ${price.toFixed(2)}
            </Text>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    card: {
        width: 140,
        height: 150,
        borderRadius: 12,
        padding: 12,
        marginRight: 10,
        borderWidth: 1,
        justifyContent: 'space-between',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 2
    },
    symbol: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    name: {
        fontSize: 10,
        marginBottom: 8
    },
    badge: {
        borderRadius: 4,
        paddingHorizontal: 4,
        paddingVertical: 2
    },
    change: {
        fontSize: 10,
        fontWeight: '600',
    },
    chartContainer: {
        height: 60,
        width: 120,
        overflow: 'hidden',
        justifyContent: 'center'
    },
    price: {
        fontSize: 15,
        fontWeight: '700',
        marginTop: 4
    },
});

export default MarketSummaryCard;
