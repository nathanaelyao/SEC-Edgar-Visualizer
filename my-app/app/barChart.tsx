import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import Svg, { G, Rect, Defs, LinearGradient, Stop } from 'react-native-svg';

const screenWidth = 325;

const BarGraph = ({ data }) => {
  const animatedHeights = useRef([]);
  const [selectedValue, setSelectedValue] = useState(null);

  if (!data || data.length === 0) {
    return <Text>Loading...</Text>;
  }

  const barWidth = screenWidth / data.length - 11;
  const labelOffset = barWidth / 2;
  const maxValue = Math.max(...data.map(item => item.value));
  const scale = 170 / maxValue;

  useEffect(() => {
    if (animatedHeights.current.length !== data.length) {
      animatedHeights.current = data.map(() => new Animated.Value(0));
    }

    data.forEach((item, index) => {
      Animated.timing(animatedHeights.current[index], {
        toValue: item.value * scale,
        duration: 1000,
        easing: Easing.elastic(1),
        useNativeDriver: false, 
      }).start();
    });

    return () => {
      animatedHeights.current.forEach(anim => anim.stopAnimation());
    };
  }, [data, scale]);

  const AnimatedRect = Animated.createAnimatedComponent(Rect);

  const handleBarPress = (value) => {
    setSelectedValue(value);
  };

  return (
    <View style={styles.card}>
      <View style={styles.container}>
        <Svg height="220" width={screenWidth}>
          <Defs>
            <LinearGradient id="grad" x1="0" y1="0" x2="0" y2="100%">
              <Stop offset="0" stopColor="#6a11cb" />
              <Stop offset="1" stopColor="#2575fc" />
            </LinearGradient>
          </Defs>
          <G>
            {data.map((item, index) => (
              <AnimatedRect
                key={item.label}
                x={index * (barWidth + 12)}
                y={animatedHeights.current[index]?.interpolate({
                  inputRange: [0, item.value * scale],
                  outputRange: [200, 200 - item.value * scale],
                })}
                width={barWidth}
                height={animatedHeights.current[index]}
                fill="url(#grad)"
                rx="4"
                opacity={selectedValue === item.value ? 1 : 0.7}
                onPress={() => handleBarPress(item.value)}
              />
            ))}
          </G>
        </Svg>
        {selectedValue && (
          <View style={styles.valueDisplay}>
            <Text style={styles.valueText}>{selectedValue.toLocaleString()}</Text>
          </View>
        )}
        <View style={styles.labels}>
          {data.map((item, index) => (
            <Text
              key={item.label}
              style={[
                styles.label,
                {
                  width: barWidth,
                  left: index * (barWidth + 12) + labelOffset - barWidth / 2,
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
    width: 350,
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
    padding: 50,
  },
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 5,
    marginTop: 5,
    position: 'absolute',
    width: screenWidth,
    top: 210,
  },
  label: {
    textAlign: 'center',
    fontSize: 14,
    fontFamily: 'Arial, sans-serif',
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

export default BarGraph;