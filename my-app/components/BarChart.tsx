import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Dimensions } from 'react-native';
import Svg, { G, Rect, Defs, LinearGradient, Stop } from 'react-native-svg';

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
}

const AnimatedRect = Animated.createAnimatedComponent(Rect);

const BarChart: React.FC<BarChartProps> = ({ data }) => {
  const animatedHeights = useRef<Animated.Value[]>([]);
  const [selectedValue, setSelectedValue] = useState<number | null>(null);

  // Move calculations that hooks depend on to the top, ensuring safety for empty data
  const hasData = data && data.length > 0;
  const minValue = hasData ? Math.min(0, ...data.map(item => item.value)) : 0;
  const maxValue = hasData ? Math.max(0, ...data.map(item => item.value)) : 0;
  const range = maxValue - minValue;
  const availableHeight = 200;
  const scale = range === 0 ? 1 : availableHeight / range;
  const zeroY = maxValue * scale;

  // Always call hooks
  useEffect(() => {
    setSelectedValue(null);
  }, [data]);

  useEffect(() => {
    if (!hasData) return;

    if (animatedHeights.current.length !== data.length) {
      animatedHeights.current = data.map(() => new Animated.Value(0));
    }

    data.forEach((item, index) => {
      Animated.timing(animatedHeights.current[index], {
        toValue: item.value,
        duration: 1000,
        easing: Easing.elastic(1),
        useNativeDriver: false,
      }).start();
    });

    return () => {
      animatedHeights.current.forEach(anim => anim.stopAnimation());
    };
  }, [data, scale, hasData]);

  if (!hasData) {
    return <Text>Loading...</Text>;
  }

  const gap = 10;
  const barWidth = (CHART_WIDTH - (data.length - 1) * gap) / data.length;

  const handleBarPress = (value: number) => {
    setSelectedValue(value);
  };

  return (
    <View style={styles.card}>
      <View style={styles.container}>
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
                  key={`bar-${index}-${item.label}`}
                  x={index * (barWidth + gap)}
                  y={animatedHeights.current[index]?.interpolate({
                    inputRange,
                    outputRange: outputRangeY,
                    extrapolate: 'clamp',
                  })}
                  width={barWidth}
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
        {selectedValue !== null && (
          <View style={styles.valueDisplay}>
            <Text style={styles.valueText}>{selectedValue.toLocaleString()}</Text>
          </View>
        )}
        <View style={styles.labels}>
          {data.map((item, index) => (
            <Text
              key={`label-${index}-${item.label}`}
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[
                styles.label,
                {
                  width: barWidth,
                  left: index * (barWidth + gap),
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
    paddingHorizontal: 0, // Removed padding as calculations handle it
    marginTop: 5,
    position: 'absolute',
    width: CHART_WIDTH,
    top: 210,
  },
  label: {
    textAlign: 'center',
    fontSize: 12, // Slightly smaller font for better fit
    fontFamily: 'Arial', // Generic font family
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