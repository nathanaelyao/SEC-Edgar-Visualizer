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

    const width = 130;
    const height = 50;

    const chartPath = useMemo(() => {
        if (!data || data.length < 2) return '';
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;

        const sampleRate = Math.ceil(data.length / 50);
        const points = data.filter((_, i) => i % sampleRate === 0);

        return points.map((val, i) => {
            const x = (i / (points.length - 1)) * width;
            const y = height - ((val - min) / range) * height;
            return `${x},${y}`;
        }).join(' ');
    }, [data, width, height]);

    const displayPrice = useMemo(() => {
        if (symbol.includes('=X')) {
            // Check if it's a very small number (e.g. JPY/USD is ~0.0067)
            if (price < 0.1) return price.toFixed(4);
            return price.toFixed(4); // 4 decimals for currencies is standard
        }
        if (price > 1000) {
            return price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        }
        return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }, [price, symbol]);

    const displaySymbol = useMemo(() => {
        if (symbol === 'ES=F') return 'S&P 500';
        if (symbol === 'NQ=F') return 'NASDAQ';
        if (symbol === 'YM=F') return 'DOW';
        if (symbol === 'XIU.TO') return 'TSX 60';
        return symbol.replace('=F', '').replace('=X', '').replace('-USD', '');
    }, [symbol]);

    return (
        <TouchableOpacity
            style={[styles.card, {
                backgroundColor: isDark ? '#1e1e1e' : '#fff',
                borderColor: isDark ? '#333' : '#f0f0f0'
            }]}
            onPress={onPress}
            activeOpacity={0.8}
        >
            <View style={styles.topInfo}>
                <View style={styles.symbolContainer}>
                    <Text style={[styles.symbol, { color: isDark ? '#fff' : '#000' }]} numberOfLines={1}>{displaySymbol}</Text>
                    <Text style={[styles.name, { color: '#8e8e93' }]} numberOfLines={1}>{name}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: isPositive ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 59, 48, 0.1)' }]}>
                    <Text style={[styles.change, { color: color }]}>
                        {isPositive ? '+' : ''}{changePercent.toFixed(2)}%
                    </Text>
                </View>
            </View>

            <View style={styles.chartContainer}>
                <Svg width={width} height={height}>
                    <Defs>
                        <LinearGradient id={`grad${symbol}`} x1="0" y1="0" x2="0" y2="1">
                            <Stop offset="0" stopColor={color} stopOpacity="0.3" />
                            <Stop offset="1" stopColor={color} stopOpacity="0" />
                        </LinearGradient>
                    </Defs>
                    <Polyline
                        points={chartPath}
                        fill="none"
                        stroke={color}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </Svg>
            </View>

            <View style={styles.footer}>
                <Text style={[styles.price, { color: isDark ? '#fff' : '#000' }]}>
                    {displayPrice}
                </Text>
            </View>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    card: {
        width: 160,
        height: 160,
        borderRadius: 24,
        padding: 16,
        marginRight: 12,
        borderWidth: 1,
        justifyContent: 'space-between',
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
    },
    topInfo: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    symbolContainer: {
        flex: 1,
        marginRight: 4,
    },
    symbol: {
        fontSize: 16,
        fontWeight: '900',
        letterSpacing: -0.5,
    },
    name: {
        fontSize: 11,
        fontWeight: '600',
        marginTop: 2,
    },
    badge: {
        borderRadius: 8,
        paddingHorizontal: 6,
        paddingVertical: 4,
    },
    change: {
        fontSize: 10,
        fontWeight: '800',
    },
    chartContainer: {
        height: 50,
        width: 130,
        overflow: 'hidden',
        alignSelf: 'center',
        marginVertical: 8,
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    price: {
        fontSize: 18,
        fontWeight: '900',
        letterSpacing: -0.5,
    },
});

export default MarketSummaryCard;
