import React, { useState } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path, Polyline, G, Line, Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { HistoryPoint } from '@/utils/secApi';

interface StockLineChartProps {
    data: HistoryPoint[];
    height?: number;
    range?: '1D' | '1W' | '1M' | '1Y' | '5Y' | 'ALL';
    isDark?: boolean;
    formatValue?: (val: number) => string;
}

const StockLineChart: React.FC<StockLineChartProps> = ({ data, height = 180, range = 'ALL', isDark, formatValue }) => {
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const screenWidth = Dimensions.get('window').width - 64;
    const padding = 20;
    const chartWidth = screenWidth - padding * 2;
    const chartHeight = height - padding * 2;

    if (data.length < 2) {
        return (
            <View style={[styles.container, { height }]}>
                <Text style={[styles.noData, { color: isDark ? '#666' : '#999' }]}>No historical data available</Text>
            </View>
        );
    }

    const prices = data.map(d => d.price);
    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const priceRange = Math.max(max - min, 0.0001);

    const points = data.map((d, i) => {
        const x = padding + (i / (data.length - 1)) * chartWidth;
        const y = padding + chartHeight - ((d.price - min) / priceRange) * chartHeight;
        return `${x},${y} `;
    }).join(' ');

    const isPositiveChange = lastPrice >= firstPrice;
    const color = isPositiveChange ? '#34C759' : '#FF3B30';

    const handleTouch = (event: any) => {
        const x = event.nativeEvent.locationX;
        const boundedX = Math.max(padding, Math.min(padding + chartWidth, x));
        const relativeX = boundedX - padding;
        const index = Math.round((relativeX / chartWidth) * (data.length - 1));

        if (index !== activeIndex && index >= 0 && index < data.length) {
            setActiveIndex(index);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
    };

    const activePoint = activeIndex !== null ? data[activeIndex] : null;
    const activeX = activeIndex !== null ? padding + (activeIndex / (data.length - 1)) * chartWidth : 0;
    const activeY = activeIndex !== null ? padding + chartHeight - ((data[activeIndex].price - min) / priceRange) * chartHeight : 0;

    // Calculate change relative to start of period
    const changeAmount = activePoint ? activePoint.price - firstPrice : 0;
    const changePercent = activePoint && firstPrice > 0 ? (changeAmount / firstPrice) * 100 : 0;
    const hudIsPositive = changeAmount >= 0;

    return (
        <View
            style={[styles.container, { height }]}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleTouch}
            onResponderMove={handleTouch}
            onResponderRelease={() => setActiveIndex(null)}
            onResponderTerminate={() => setActiveIndex(null)}
        >
            {activeIndex !== null && activePoint && (
                <View style={[styles.hud, {
                    backgroundColor: isDark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.9)',
                    borderColor: isDark ? '#444' : '#eee'
                }]}>
                    <View style={styles.hudHeader}>
                        <Text style={[styles.hudValue, { color: isDark ? '#fff' : '#1a1a1a' }]}>
                            {formatValue ? formatValue(activePoint.price) : `$${activePoint.price.toFixed(2)}`}
                        </Text>
                        <View style={[styles.hudChangeBadge, hudIsPositive ? (isDark ? styles.positiveBadgeDark : styles.positiveBadge) : (isDark ? styles.negativeBadgeDark : styles.negativeBadge)]}>
                            <Text style={[styles.hudChangeText, { color: hudIsPositive ? (isDark ? '#81C784' : '#2E7D32') : (isDark ? '#E57373' : '#C62828') }]}>
                                {hudIsPositive ? '+' : ''}{formatValue ? formatValue(changeAmount) : changeAmount.toFixed(2)} ({hudIsPositive ? '+' : ''}{changePercent.toFixed(2)}%)
                            </Text>
                        </View>
                    </View>
                    <Text style={[styles.hudDate, { color: isDark ? '#8e8e93' : '#999' }]}>
                        {new Date(activePoint.timestamp).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: (range === '5Y' || range === 'ALL') ? 'numeric' : undefined,
                            hour: (range === '1D' || range === '1W') ? '2-digit' : undefined,
                            minute: (range === '1D' || range === '1W') ? '2-digit' : undefined
                        })}
                    </Text>
                </View>
            )}
            <Svg width={screenWidth} height={height}>
                <G>
                    {/* The line */}
                    <Polyline
                        points={points}
                        fill="none"
                        stroke={activeIndex !== null ? (isDark ? '#444' : '#ccc') : color}
                        strokeWidth="2.5"
                        strokeLinejoin="round"
                    />

                    {/* Active Scrubber Line */}
                    {activeIndex !== null && (
                        <Line
                            x1={activeX}
                            y1={padding}
                            x2={activeX}
                            y2={padding + chartHeight}
                            stroke={isDark ? '#0A84FF' : '#007AFF'}
                            strokeWidth="1.5"
                            strokeDasharray="4,4"
                        />
                    )}

                    {/* End point dot or Active point dot */}
                    {(() => {
                        const cx = activeIndex !== null ? activeX : (points.trim().split(' ').pop()?.split(',')[0]);
                        const cy = activeIndex !== null ? activeY : (points.trim().split(' ').pop()?.split(',')[1]);

                        if (cx && cy) {
                            return (
                                <Circle
                                    cx={cx}
                                    cy={cy}
                                    r={activeIndex !== null ? "6" : "4"}
                                    fill={activeIndex !== null ? "#007AFF" : color}
                                />
                            );
                        }
                        return null;
                    })()}
                </G>
            </Svg>
            <View style={styles.labels}>
                <Text style={[styles.dateLabel, { color: isDark ? '#636366' : '#999' }]}>
                    {(() => {
                        const date = new Date(data[0].timestamp);
                        return (range === '1D' || range === '1W')
                            ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
                    })()}
                </Text>
                <Text style={[styles.dateLabel, { color: isDark ? '#636366' : '#999' }]}>
                    {(() => {
                        const date = new Date(data[data.length - 1].timestamp);
                        return (range === '1D' || range === '1W')
                            ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: range === 'ALL' ? '2-digit' : undefined });
                    })()}
                </Text>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        width: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    noData: {
        fontSize: 14,
        fontStyle: 'italic',
    },
    labels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
        paddingHorizontal: 20,
        marginTop: 6,
    },
    dateLabel: {
        fontSize: 10,
    },
    hud: {
        position: 'absolute',
        top: -10,
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
        borderWidth: 1,
        zIndex: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 5,
    },
    hudHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    hudValue: {
        fontSize: 18,
        fontWeight: '800',
    },
    hudChangeBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
    },
    positiveBadge: {
        backgroundColor: '#E8F5E9',
    },
    negativeBadge: {
        backgroundColor: '#FFEBEE',
    },
    positiveBadgeDark: {
        backgroundColor: 'rgba(52, 199, 89, 0.15)',
    },
    negativeBadgeDark: {
        backgroundColor: 'rgba(255, 59, 48, 0.15)',
    },
    hudChangeText: {
        fontSize: 12,
        fontWeight: '700',
    },
    hudDate: {
        fontSize: 11,
        fontWeight: '500',
        marginTop: 2,
    },
});

export default StockLineChart;
