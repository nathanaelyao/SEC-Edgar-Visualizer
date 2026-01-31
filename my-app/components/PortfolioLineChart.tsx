import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path, Polyline, G, Line, Circle } from 'react-native-svg';
import { PortfolioSnapshot } from '@/utils/db';

interface PortfolioLineChartProps {
    data: PortfolioSnapshot[];
    height?: number;
    range?: '1D' | '1W' | '1M' | '1Y' | '5Y' | 'ALL';
}

const PortfolioLineChart: React.FC<PortfolioLineChartProps> = ({ data, height = 180, range = 'ALL' }) => {
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

    return (
        <View style={[styles.container, { height }]}>
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
                        stroke={color}
                        strokeWidth="3"
                        strokeLinejoin="round"
                    />

                    {/* End point dot */}
                    {(() => {
                        const lastPoint = points.split(' ').pop()?.split(',');
                        if (lastPoint) {
                            return (
                                <Circle
                                    cx={lastPoint[0]}
                                    cy={lastPoint[1]}
                                    r="4"
                                    fill={color}
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
    }
});

export default PortfolioLineChart;
