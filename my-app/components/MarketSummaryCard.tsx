import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
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
    const color = isPositive ? '#10B981' : '#EF4444';

    const width = 130;
    const height = 48;

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
            if (price < 0.1) return price.toFixed(4);
            return price.toFixed(4);
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
                backgroundColor: isDark ? '#131E32' : '#FFFFFF',
                borderColor: isDark ? '#1E2E4A' : '#E8EEF5'
            }]}
            onPress={onPress}
            activeOpacity={0.8}
        >
            <View style={styles.topInfo}>
                <View style={styles.symbolContainer}>
                    <Text style={[styles.symbol, { color: isDark ? '#F8FAFC' : '#0F172A' }]} numberOfLines={1}>{displaySymbol}</Text>
                    <Text style={[styles.name, { color: isDark ? '#94A3B8' : '#64748B' }]} numberOfLines={1}>{name}</Text>
                </View>
                <View style={[styles.badge, {
                    backgroundColor: isPositive
                        ? (isDark ? 'rgba(52, 211, 153, 0.15)' : '#DCFCE7')
                        : (isDark ? 'rgba(248, 113, 113, 0.15)' : '#FEE2E2')
                }]}>
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
                <Text style={[styles.price, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>
                    {displayPrice}
                </Text>
            </View>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    card: {
        width: 156,
        height: 156,
        borderRadius: 22,
        padding: 16,
        marginRight: 12,
        borderWidth: 1,
        justifyContent: 'space-between',
        elevation: 3,
        shadowColor: '#2E7BE8',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
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
        fontSize: 15,
        fontWeight: '800',
        letterSpacing: -0.3,
    },
    name: {
        fontSize: 11,
        fontWeight: '500',
        marginTop: 2,
    },
    badge: {
        borderRadius: 8,
        paddingHorizontal: 6,
        paddingVertical: 3,
    },
    change: {
        fontSize: 10,
        fontWeight: '800',
    },
    chartContainer: {
        height: 48,
        width: 130,
        overflow: 'hidden',
        alignSelf: 'center',
        marginVertical: 4,
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    price: {
        fontSize: 17,
        fontWeight: '900',
        letterSpacing: -0.4,
    },
});

export default MarketSummaryCard;
