import React, { useState } from 'react';
import { View, Text, StyleSheet, Dimensions, PanResponder } from 'react-native';
import Svg, { Path, Polyline, G, Line, Circle, Rect } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { PortfolioSnapshot } from '@/utils/db';

interface PortfolioLineChartProps {
    data: PortfolioSnapshot[];
    height?: number;
    range?: '1D' | '1W' | '1M' | '1Y' | '5Y' | 'ALL';
}

const PortfolioLineChart: React.FC<PortfolioLineChartProps> = ({ data, height = 180, range = 'ALL' }) => {
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const screenWidth = Dimensions.get('window').width - 64; // Horizontal margin in PortfolioScreen
    const padding = 20;
    const chartWidth = screenWidth - padding * 2;
    const chartHeight = height - padding * 2;

    if (data.length < 2) {
        return (
            <View style={[styles.container, { height }]}>
                <Text style={styles.noData}>Collecting historical data...</Text>
            </View>
        );
    }

    const values = data.map(d => d.totalValue);
    const min = Math.min(...values) * 0.95;
    const max = Math.max(...values) * 1.05;
    const vRange = max - min || 1;

    const points = data.map((d, i) => {
        const x = padding + (i / (data.length - 1)) * chartWidth;
        const y = padding + chartHeight - ((d.totalValue - min) / vRange) * chartHeight;
        return `${x},${y}`;
    }).join(' ');

    const isProfit = data[data.length - 1].totalValue >= data[0].totalValue;
    const color = isProfit ? '#34C759' : '#FF3B30';

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
    const firstPointValue = data[0].totalValue;
    const activeX = activeIndex !== null ? padding + (activeIndex / (data.length - 1)) * chartWidth : 0;
    const activeY = activeIndex !== null ? padding + chartHeight - ((data[activeIndex].totalValue - min) / vRange) * chartHeight : 0;

    // Calculate change
    const changeAmount = activePoint ? activePoint.totalValue - firstPointValue : 0;
    const changePercent = activePoint && firstPointValue > 0 ? (changeAmount / firstPointValue) * 100 : 0;
    const isPositive = changeAmount >= 0;

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
                <View style={styles.hud}>
                    <View style={styles.hudHeader}>
                        <Text style={styles.hudValue}>
                            ${activePoint.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </Text>
                        <View style={[styles.hudChangeBadge, isPositive ? styles.positiveBadge : styles.negativeBadge]}>
                            <Text style={styles.hudChangeText}>
                                {isPositive ? '+' : ''}{changeAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({changePercent.toFixed(1)}%)
                            </Text>
                        </View>
                    </View>
                    <Text style={styles.hudDate}>
                        {new Date(activePoint.timestamp).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: range === '1D' ? '2-digit' : undefined,
                            minute: range === '1D' ? '2-digit' : undefined
                        })}
                    </Text>
                </View>
            )}
            <Svg width={screenWidth} height={height}>
                <G>
                    {/* Grid line (simple) */}
                    <Line
                        x1={padding}
                        y1={padding + chartHeight}
                        x2={padding + chartWidth}
                        y2={padding + chartHeight}
                        stroke="#eee"
                        strokeWidth="1"
                    />

                    {/* The line */}
                    <Polyline
                        points={points}
                        fill="none"
                        stroke={activeIndex !== null ? '#ccc' : color}
                        strokeWidth="3"
                        strokeLinejoin="round"
                    />

                    {/* Active Scrubber Line */}
                    {activeIndex !== null && (
                        <Line
                            x1={activeX}
                            y1={padding}
                            x2={activeX}
                            y2={padding + chartHeight}
                            stroke="#007AFF"
                            strokeWidth="1"
                            strokeDasharray="4,4"
                        />
                    )}

                    {/* End point dot or Active point dot */}
                    {(() => {
                        const cx = activeIndex !== null ? activeX : (points.split(' ').pop()?.split(',')[0]);
                        const cy = activeIndex !== null ? activeY : (points.split(' ').pop()?.split(',')[1]);

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
                <Text style={styles.dateLabel}>
                    {(() => {
                        const date = new Date(data[0].timestamp);
                        return range === '1D'
                            ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: range === '5Y' || range === 'ALL' ? '2-digit' : undefined });
                    })()}
                </Text>
                <Text style={styles.dateLabel}>
                    {(() => {
                        const date = new Date(data[data.length - 1].timestamp);
                        return range === '1D'
                            ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: range === '5Y' || range === 'ALL' ? '2-digit' : undefined });
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
        color: '#999',
        fontStyle: 'italic',
    },
    labels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
        paddingHorizontal: 20,
        marginTop: 4,
    },
    dateLabel: {
        fontSize: 10,
        color: '#999',
    },
    hud: {
        position: 'absolute',
        top: 0,
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.9)',
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#eee',
        zIndex: 10,
    },
    hudValue: {
        fontSize: 14,
        fontWeight: '700',
        color: '#1a1a1a',
    },
    hudHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    hudChangeBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    positiveBadge: {
        backgroundColor: '#E8F5E9',
    },
    negativeBadge: {
        backgroundColor: '#FFEBEE',
    },
    hudChangeText: {
        fontSize: 10,
        fontWeight: '600',
        color: '#1a1a1a',
    },
    hudDate: {
        fontSize: 10,
        color: '#666',
    },
});

export default PortfolioLineChart;
