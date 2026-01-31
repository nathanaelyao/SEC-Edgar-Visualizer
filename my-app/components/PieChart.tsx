import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { G, Path, Circle } from 'react-native-svg';

/**
 * PieChart.tsx
 * A responsive SVG pie chart component for visualizing portfolio holdings.
 */

interface PieChartDataItem {
    label: string;
    value: number;
    color: string;
}

interface PieChartProps {
    data: PieChartDataItem[];
    size?: number;
    isDark?: boolean;
}

const PieChart: React.FC<PieChartProps> = ({ data, size: propSize, isDark }) => {
    const { width: SCREEN_WIDTH } = Dimensions.get('window');
    const size = propSize || Math.min(SCREEN_WIDTH - 64, 300);
    const radius = size / 2;
    const strokeWidth = 0;
    const center = radius;

    const total = data.reduce((acc, item) => acc + item.value, 0);

    if (total === 0) {
        return (
            <View style={[styles.container, { width: size, height: size }]}>
                <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                    <Circle cx={center} cy={center} r={radius - 2} fill="#f0f0f0" />
                </Svg>
                <Text style={styles.noDataText}>No Data</Text>
            </View>
        );
    }

    let cumulativeAngle = -90; // Start at top

    return (
        <View style={styles.outerContainer}>
            <View style={[styles.container, { width: size, height: size }]}>
                <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                    <G>
                        {data.map((item, index) => {
                            const sliceAngle = (item.value / total) * 360;
                            const startAngle = cumulativeAngle;
                            const endAngle = cumulativeAngle + sliceAngle;
                            cumulativeAngle += sliceAngle;

                            // Full circle fallback for single slice
                            if (sliceAngle >= 359.9) {
                                return (
                                    <Circle
                                        key={`slice-${index}`}
                                        cx={center}
                                        cy={center}
                                        r={radius - 1}
                                        fill={item.color}
                                        stroke="#fff"
                                        strokeWidth={1}
                                    />
                                );
                            }

                            // Convert degrees to radians
                            const startRad = (startAngle * Math.PI) / 180;
                            const endRad = (endAngle * Math.PI) / 180;

                            // Arc coordinates
                            const x1 = center + radius * Math.cos(startRad);
                            const y1 = center + radius * Math.sin(startRad);
                            const x2 = center + radius * Math.cos(endRad);
                            const y2 = center + radius * Math.sin(endRad);

                            const largeArcFlag = sliceAngle > 180 ? 1 : 0;

                            // Path definition: Move to center, Line to arc start, Arc to end, Close path
                            const pathData = `
                                M ${center} ${center}
                                L ${x1} ${y1}
                                A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}
                                Z
                            `;

                            return (
                                <Path
                                    key={`slice-${index}`}
                                    d={pathData}
                                    fill={item.color}
                                    stroke="#fff"
                                    strokeWidth={1}
                                />
                            );
                        })}
                    </G>
                </Svg>
            </View>

            <View style={styles.legend}>
                {data.map((item, index) => (
                    <View key={`legend-${index}`} style={styles.legendItem}>
                        <View style={[styles.colorBox, { backgroundColor: item.color }]} />
                        <Text style={[styles.legendText, { color: isDark ? '#eee' : '#333' }]}>
                            {item.label}: {((item.value / total) * 100).toFixed(1)}%
                        </Text>
                    </View>
                ))}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    outerContainer: {
        alignItems: 'center',
        marginVertical: 20,
    },
    container: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    noDataText: {
        position: 'absolute',
        color: '#999',
        fontSize: 16,
        fontWeight: '600',
    },
    legend: {
        marginTop: 20,
        width: '100%',
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
    },
    legendItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 10,
        marginVertical: 5,
    },
    colorBox: {
        width: 12,
        height: 12,
        borderRadius: 2,
        marginRight: 6,
    },
    legendText: {
        fontSize: 14,
        color: '#333',
        fontWeight: '500',
    },
});

export default PieChart;
