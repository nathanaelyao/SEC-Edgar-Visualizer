import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Polyline, G, Line, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { PortfolioSnapshot } from '@/utils/db';

interface PortfolioLineChartProps {
    data: PortfolioSnapshot[];
    benchmarkData?: { timestamp: number; price: number }[];
    showBenchmark?: boolean;
    height?: number;
    range?: '1D' | '1W' | '1M' | '1Y' | '5Y' | 'ALL';
    isDark?: boolean;
    formatValue?: (val: number) => string;
}

const PortfolioLineChart: React.FC<PortfolioLineChartProps> = ({
    data,
    benchmarkData,
    showBenchmark = false,
    height = 200,
    range = 'ALL',
    isDark,
    formatValue
}) => {
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const screenWidth = Dimensions.get('window').width - 64;
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

    // --- Data Normalization ---
    // Rule: If showBenchmark is true, we ONLY show Percentage Change.
    // If showBenchmark is false, we show Absolute Value ($) as before (user preference usually).
    // Actually, to keep it simple and consistent with the request "Compare performance", 
    // switching to S&P compare usually implies switching to % view for valid comparison.

    const processSeries = (series: { timestamp: number | string; value: number }[]) => {
        if (series.length === 0) return [];
        const startValue = series[0].value;
        return series.map(d => ({
            timestamp: new Date(d.timestamp).getTime(),
            value: d.value,
            percent: startValue !== 0 ? ((d.value - startValue) / startValue) * 100 : 0
        }));
    };

    const portfolioSeries = useMemo(() => {
        return data.map(d => ({ timestamp: d.timestamp, value: d.totalValue })); // Use Total Value for performance calc
    }, [data]);

    const normalizedPortfolio = useMemo(() => processSeries(portfolioSeries), [portfolioSeries]);

    // Align Benchmark to Portfolio Start
    const normalizedBenchmark = useMemo(() => {
        if (!showBenchmark || !benchmarkData || benchmarkData.length === 0) return [];

        // Filter benchmark to match portfolio range loosely (start date >= portfolio start)
        // Or find the benchmark price at portfolio start time to normalize
        const startTime = normalizedPortfolio[0].timestamp;

        // Find closest benchmark point to start time
        // Benchmark data is usually daily close.
        return processSeries(benchmarkData.map(d => ({ timestamp: d.timestamp, value: d.price })));
    }, [benchmarkData, showBenchmark, normalizedPortfolio]);

    // Combine for Min/Max calculation
    const allPoints = showBenchmark
        ? [...normalizedPortfolio.map(d => d.percent), ...normalizedBenchmark.map(d => d.percent)]
        : normalizedPortfolio.map(d => d.value); // If not comparing, show Dollar Value? Or Profit? 
    // Wait, original chart showed "Total Profit". 
    // "Performance" usually means % Return or Total Profit.
    // Comparison with S&P only makes sense in %.
    // Let's stick to:
    // Mode A (Standard): Show Total Profit ($) (Existing behavior)
    // Mode B (Compare): Show % Return for both.

    // Let's refine Mode A: User wants "Gains compared to assets".
    // Existing code mapped `totalProfit`.

    // DECISION: 
    // If `showBenchmark`: Use Normalized % Return (Total Value % change).
    // If `!showBenchmark`: Use Total Profit ($) (Legacy behavior).

    const displayPoints = showBenchmark ? normalizedPortfolio.map(d => d.percent) : data.map(d => d.totalProfit);
    const benchmarkPoints = showBenchmark ? normalizedBenchmark.map(d => d.percent) : [];

    const minVal = Math.min(...(showBenchmark ? allPoints : displayPoints));
    const maxVal = Math.max(...(showBenchmark ? allPoints : displayPoints));
    const vRange = Math.max(Math.abs(maxVal - minVal), 0.0001);

    // Coordinate Helpers
    const getX = (index: number, length: number) => padding + (index / (length - 1)) * chartWidth;
    const getY = (val: number) => padding + chartHeight - ((val - minVal) / vRange) * chartHeight;

    // Generate Path Strings
    const makePath = (points: number[]) => {
        return points.map((val, i) => `${getX(i, points.length)},${getY(val)} `).join(' ');
    };

    const mainPath = makePath(displayPoints);
    // Benchmark might have different length/timestamps. 
    // Ideally we interpolate benchmark to match portfolio timestamps for overlapping graph?
    // Or just plot them on the same time x-axis?
    // For simplicity: Plot benchmark using its own X scale if lengths differ, 
    // assuming Start/End times align roughly?
    // BETTER: Timerscale X.
    // Let's assume for now we just map array index to X. 
    // This requires arrays to be aligned by date. 
    // Real implementation should use time-scale.
    // Hack for now: Map benchmark points to existing X axis if lengths are close, or just simple independent line.
    // Simple independent line:
    const benchmarkPath = showBenchmark ? benchmarkData?.map((d, i) => {
        // Find relative X position based on time
        const startTime = normalizedPortfolio[0].timestamp;
        const endTime = normalizedPortfolio[normalizedPortfolio.length - 1].timestamp;
        const totalTime = endTime - startTime;

        if (d.timestamp < startTime || d.timestamp > endTime) return null; // Clip

        const timeProgress = (d.timestamp - startTime) / totalTime;
        const x = padding + timeProgress * chartWidth;

        // Find normalized val
        // The `normalizedBenchmark` array assumes it starts at index 0 of ITSELF.
        // We need to re-normalize benchmark relative to the PORTFOLIO START DATE.
        // Redo global calculation needed? 
        // Let's simplify: normalizedBenchmark is already % change from ITS own start.
        // We need % change from Portfolio Start Date.
        const startBenchPrice = benchmarkData?.find(b => Math.abs(b.timestamp - startTime) < 86400000)?.price || benchmarkData?.[0].price || 1;
        const val = ((d.price - startBenchPrice) / startBenchPrice) * 100;

        const y = getY(val);
        return `${x},${y} `;
    }).filter(p => p !== null).join(' ') : '';


    // Active Data and HUD Calculations
    const activeItem = activeIndex !== null ? data[activeIndex] : null;
    const activeDisplayVal = activeIndex !== null ? displayPoints[activeIndex] : displayPoints[displayPoints.length - 1]; // This is what is PLOTTED (value or %)

    // Detailed Metrics for HUD (Always calculated relative to chart Start)
    const metrics = useMemo(() => {
        if (activeIndex === null || data.length === 0) return null;
        const current = data[activeIndex];
        const start = data[0];

        // Change logic: Profit Difference (excludes deposits/withdrawals impact mostly)
        const profitChange = current.totalProfit - start.totalProfit;
        const percentChange = start.totalValue > 0 ? (profitChange / start.totalValue) * 100 : 0;

        return {
            totalValue: current.totalValue,
            change: profitChange,
            percent: percentChange
        };
    }, [activeIndex, data]);

    // Find corresponding benchmark value at active time
    const activeBenchmarkVal = useMemo(() => {
        if (!showBenchmark || activeIndex === null) return null;
        const activeTime = data[activeIndex].timestamp;
        const startBenchPrice = benchmarkData?.find(b => Math.abs(b.timestamp - normalizedPortfolio[0].timestamp) < 86400000 * 2)?.price || 1;

        // Find closest point in benchmark
        const closestParams = benchmarkData?.reduce((prev, curr) =>
            Math.abs(curr.timestamp - new Date(activeTime).getTime()) < Math.abs(prev.timestamp - new Date(activeTime).getTime()) ? curr : prev
        );

        if (closestParams) {
            return ((closestParams.price - startBenchPrice) / startBenchPrice) * 100;
        }
        return 0;
    }, [activeIndex, showBenchmark, benchmarkData, data, normalizedPortfolio]);

    // Interaction
    const handleTouch = (event: any) => {
        const x = event.nativeEvent.locationX;
        const boundedX = Math.max(padding, Math.min(padding + chartWidth, x));
        const relativeX = boundedX - padding;
        const index = Math.round((relativeX / chartWidth) * (displayPoints.length - 1));

        if (index >= 0 && index < displayPoints.length) {
            setActiveIndex(index);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
    };

    const isPositive = metrics ? metrics.change >= 0 : true;

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
            {activeIndex !== null && metrics && (
                <View style={[styles.hud, {
                    backgroundColor: isDark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)', // Increased opacity for readability
                    borderColor: isDark ? '#444' : '#ddd',
                    shadowColor: "#000",
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.15,
                    shadowRadius: 4,
                    elevation: 5
                }]}>
                    <Text style={styles.hudDate}>
                        {new Date(data[activeIndex].timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </Text>

                    {/* Total Value */}
                    <Text style={[styles.hudTitleLabel, { color: isDark ? '#aaa' : '#666' }]}>Value</Text>
                    <Text style={[styles.hudMainValue, { color: isDark ? '#fff' : '#000' }]}>
                        {formatValue ? formatValue(metrics.totalValue) : metrics.totalValue.toFixed(2)}
                    </Text>

                    {/* Change Row */}
                    <Text style={[styles.hudTitleLabel, { color: isDark ? '#aaa' : '#666', marginTop: 4 }]}>Return</Text>
                    <View style={styles.hudRow}>
                        <Text style={[styles.hudValue, { color: metrics.change >= 0 ? '#34C759' : '#FF3B30', marginLeft: 0 }]}>
                            {metrics.change >= 0 ? '+' : '-'}{formatValue ? formatValue(Math.abs(metrics.change)) : Math.abs(metrics.change).toFixed(2)}
                        </Text>
                        <Text style={[styles.hudValue, { color: metrics.change >= 0 ? '#34C759' : '#FF3B30' }]}>
                            ({metrics.percent >= 0 ? '+' : ''}{metrics.percent.toFixed(2)}%)
                        </Text>
                    </View>

                    {showBenchmark && activeBenchmarkVal !== null && (
                        <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: isDark ? '#444' : '#eee', width: '100%' }}>
                            <View style={styles.hudRow}>
                                <View style={[styles.dot, { backgroundColor: '#8E8E93', marginRight: 4 }]} />
                                <Text style={[styles.hudLabel, { color: isDark ? '#ccc' : '#666', marginLeft: 0 }]}>S&P 500</Text>
                            </View>
                            <Text style={[styles.hudValue, { color: isDark ? '#fff' : '#1a1a1a', marginLeft: 0, marginTop: 1 }]}>
                                {activeBenchmarkVal >= 0 ? '+' : ''}{activeBenchmarkVal.toFixed(2)}%
                            </Text>
                        </View>
                    )}
                </View>
            )}

            <Svg width={screenWidth} height={height}>
                <Defs>
                    <LinearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="100%">
                        <Stop offset="0" stopColor={isPositive ? "#34C759" : "#FF3B30"} stopOpacity="0.2" />
                        <Stop offset="1" stopColor={isPositive ? "#34C759" : "#FF3B30"} stopOpacity="0" />
                    </LinearGradient>
                </Defs>

                {/* Grid Lines (Zero Line) */}
                {minVal < 0 && maxVal > 0 && (
                    <Line
                        x1={padding}
                        y1={getY(0)}
                        x2={padding + chartWidth}
                        y2={getY(0)}
                        stroke={isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
                        strokeWidth="1"
                        strokeDasharray="4,4"
                    />
                )}

                {/* Benchmark Line */}
                {showBenchmark && benchmarkPath && (
                    <Polyline
                        points={benchmarkPath}
                        fill="none"
                        stroke="#8E8E93"
                        strokeWidth="2"
                        strokeDasharray="4,2"
                        opacity={0.7}
                    />
                )}

                {/* Main Line */}
                <Polyline
                    points={mainPath}
                    fill="none"
                    stroke={isPositive ? '#34C759' : '#FF3B30'}
                    strokeWidth="3"
                    strokeLinejoin="round"
                />

                {/* Scrubber */}
                {activeIndex !== null && (
                    <Line
                        x1={getX(activeIndex, displayPoints.length)}
                        y1={padding}
                        x2={getX(activeIndex, displayPoints.length)}
                        y2={padding + chartHeight}
                        stroke={isDark ? '#8e8e93' : '#666'}
                        strokeWidth="1.5"
                        strokeDasharray="4,4"
                    />
                )}

                {/* Main Dot */}
                {activeIndex !== null && (
                    <Circle
                        cx={getX(activeIndex, displayPoints.length)}
                        cy={getY(activeDisplayVal)}
                        r="6"
                        fill={isPositive ? '#34C759' : '#FF3B30'}
                        stroke="#fff"
                        strokeWidth="2"
                    />
                )}
            </Svg>

            <View style={styles.labels}>
                <Text style={styles.dateLabel}>
                    {new Date(data[0].timestamp).toLocaleDateString([], { month: 'short', year: '2-digit' })}
                </Text>
                <Text style={styles.dateLabel}>
                    {new Date(data[data.length - 1].timestamp).toLocaleDateString([], { month: 'short', year: '2-digit' })}
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
        alignItems: 'flex-start',
        padding: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#eee',
        zIndex: 10,
        minWidth: 140
    },
    hudTitleLabel: {
        fontSize: 10,
        fontWeight: '500',
        marginBottom: 1,
        textTransform: 'uppercase',
        opacity: 0.8
    },
    hudMainValue: {
        fontSize: 15,
        fontWeight: '700',
        marginBottom: 2
    },
    hudDate: {
        fontSize: 11,
        color: '#999',
        marginBottom: 6,
        fontWeight: '600'
    },
    hudRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 1,
        flexWrap: 'wrap'
    },
    hudLabel: {
        fontSize: 12,
        fontWeight: '500',
        marginLeft: 4
    },
    hudValue: {
        fontSize: 13,
        fontWeight: '600',
        marginLeft: 4
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    }
});

export default PortfolioLineChart;
