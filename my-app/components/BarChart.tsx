import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Dimensions } from 'react-native';
import Svg, { G, Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from '@/context/ThemeContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_MARGIN = 20;
const CARD_PADDING = 20;
// Calculate available width for the chart: Screen width - margins - card padding
const CHART_WIDTH = SCREEN_WIDTH - (CARD_MARGIN * 2) - (CARD_PADDING * 2);

interface BarChartItem {
  label: string;
  value: number;
}

interface BarChartProps {
  data: BarChartItem[];
  globalMin?: number;
  globalMax?: number;
}

const AnimatedRect = Animated.createAnimatedComponent(Rect);

const BarChart: React.FC<BarChartProps> = ({ data, globalMin, globalMax }) => {
  const { isDark } = useTheme();
  const animatedHeights = useRef<Animated.Value[]>([]);
  const [selectedValue, setSelectedValue] = useState<number | null>(null);

  const hasData = data && data.length > 0;

  // Use global bounds if provided to maintain scale across pages
  const minValue = globalMin !== undefined ? globalMin : (hasData ? Math.min(0, ...data.map(item => item.value)) : 0);
  const maxValue = globalMax !== undefined ? globalMax : (hasData ? Math.max(0, ...data.map(item => item.value)) : 0);

  const range = maxValue - minValue;
  const availableHeight = 200;
  const scale = range === 0 ? 1 : availableHeight / range;
  const zeroY = maxValue * scale;

  useEffect(() => {
    setSelectedValue(null);
  }, [data]);

  useEffect(() => {
    if (!hasData) return;

    // Expand animated values array if needed
    if (animatedHeights.current.length < data.length) {
      const needed = data.length - animatedHeights.current.length;
      for (let i = 0; i < needed; i++) {
        animatedHeights.current.push(new Animated.Value(0));
      }
    }

    data.forEach((item, index) => {
      Animated.timing(animatedHeights.current[index], {
        toValue: item.value,
        duration: 400,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
    });

    return () => {
      animatedHeights.current.forEach(anim => anim.stopAnimation());
    };
  }, [data, scale, hasData]);

  // Adaptive Layout: Fill the full CHART_WIDTH.
  // Fewer bars = larger barWidth and gap.
  const gapRatio = 0.2; // Gap will be 20% of bar width
  const count = data.length || 1;
  const barWidth = CHART_WIDTH / (count + (count - 1) * gapRatio);
  const gap = barWidth * gapRatio;
  const safeBarWidth = barWidth;

  const handleBarPress = (value: number) => {
    setSelectedValue(value);
  };

  return (
    <View style={[styles.card, { backgroundColor: isDark ? '#1e1e1e' : '#FFFFFF' }]}>
      <View style={styles.container}>
        {hasData ? (
          <Svg height="220" width={CHART_WIDTH}>
            <Defs>
              <LinearGradient id="grad" x1="0" y1="0" x2="0" y2="100%">
                <Stop offset="0" stopColor="#6a11cb" />
                <Stop offset="1" stopColor="#2575fc" />
              </LinearGradient>
              <LinearGradient id="gradNeg" x1="0" y1="0" x2="0" y2="100%">
                <Stop offset="0" stopColor="#ff4b1f" />
                <Stop offset="1" stopColor="#ff9068" />
              </LinearGradient>
            </Defs>
            <G>
              {data.map((item, index) => {
                let inputRange = [minValue, 0, maxValue];
                let outputRangeY = [zeroY, zeroY, zeroY - maxValue * scale];
                let outputRangeH = [Math.abs(minValue * scale), 0, maxValue * scale];

                if (minValue === 0 && maxValue === 0) {
                  inputRange = [0, 1];
                  outputRangeY = [zeroY, zeroY];
                  outputRangeH = [0, 0];
                } else if (minValue === 0) {
                  inputRange = [0, maxValue];
                  outputRangeY = [zeroY, zeroY - maxValue * scale];
                  outputRangeH = [0, maxValue * scale];
                } else if (maxValue === 0) {
                  inputRange = [minValue, 0];
                  outputRangeY = [zeroY, zeroY];
                  outputRangeH = [Math.abs(minValue * scale), 0];
                }

                return (
                  <AnimatedRect
                    key={`bar-${item.label}`}
                    x={index * (barWidth + gap)}
                    y={animatedHeights.current[index]?.interpolate({
                      inputRange,
                      outputRange: outputRangeY,
                      extrapolate: 'clamp',
                    })}
                    width={safeBarWidth}
                    height={animatedHeights.current[index]?.interpolate({
                      inputRange,
                      outputRange: outputRangeH,
                      extrapolate: 'clamp',
                    })}
                    fill={item.value >= 0 ? "url(#grad)" : "url(#gradNeg)"}
                    rx="4"
                    opacity={selectedValue === item.value ? 1 : 0.7}
                    onPress={() => handleBarPress(item.value)}
                  />
                );
              })}
            </G>
          </Svg>
        ) : (
          <View style={{ height: 220, width: CHART_WIDTH, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: isDark ? '#aaa' : '#666' }}>No data available for this range</Text>
          </View>
        )}
        {selectedValue !== null && (
          <View style={styles.valueDisplay}>
            <Text style={styles.valueText}>{selectedValue.toLocaleString()}</Text>
          </View>
        )}
        <View style={styles.labels}>
          {data.map((item, index) => (
            <Text
              key={`label-${item.label}`}
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[
                styles.label,
                {
                  width: safeBarWidth,
                  left: index * (barWidth + gap),
                  color: isDark ? '#aaa' : '#000',
                },
              ]}
            >
              {item.label}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    width: SCREEN_WIDTH - (CARD_MARGIN * 2),
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    padding: CARD_PADDING,
    alignSelf: 'center',
  },
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 0,
    marginTop: 5,
    position: 'absolute',
    width: CHART_WIDTH,
    top: 210,
  },
  label: {
    textAlign: 'center',
    fontSize: 12,
    fontFamily: 'Arial',
    position: 'absolute',
  },
  valueDisplay: {
    position: 'absolute',
    top: -10,
    left: 0,
    width: '100%',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: 5,
  },
  valueText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#007AFF',
  },
});

export default BarChart;