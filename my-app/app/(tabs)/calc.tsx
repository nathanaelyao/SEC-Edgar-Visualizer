import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import Slider from '@react-native-community/slider'; // You'll need to install this: yarn add @react-native-community/slider

const FairValueCalculator = () => {
    const [stockPrice, setStockPrice] = useState(100);
    const [eps, setEps] = useState(5);
    const [discountRate, setDiscountRate] = useState(12);
    const [growthStageYears, setGrowthStageYears] = useState(10);
    const [growthRate, setGrowthRate] = useState(15);
    const [terminalGrowthRate, setTerminalGrowthRate] = useState(2);
  
    const calculateFairValue = () => {
      // Error handling: Discount rate must be greater than terminal growth rate
      if (discountRate <= terminalGrowthRate) {
        return "Discount Rate must be greater than Terminal Growth Rate";
      }
  
      let growthStageCashFlows = [];
      let currentCashFlow = parseFloat(eps); // Important: Parse EPS as a float
  
      for (let i = 0; i < growthStageYears; i++) {
        currentCashFlow *= (1 + growthRate / 100);
        growthStageCashFlows.push(currentCashFlow);
      }
  
      // Terminal Value (Gordon Growth Model)
      const terminalValue = (growthStageCashFlows[growthStageCashFlows.length - 1] * (1 + terminalGrowthRate / 100)) / (discountRate / 100 - terminalGrowthRate / 100);
  
      // Present Value of Growth Stage Cash Flows
      let presentValueGrowth = 0;
      for (let i = 0; i < growthStageCashFlows.length; i++) {
        presentValueGrowth += growthStageCashFlows[i] / Math.pow(1 + discountRate / 100, i + 1);
      }
      if (discountRate <= terminalGrowthRate) {
        return { error: "Discount Rate must be greater than Terminal Growth Rate" }; // Return an object with an error property
      }
      // Present Value of Terminal Value
      const presentValueTerminal = terminalValue / Math.pow(1 + discountRate / 100, growthStageYears);
  
      const fairValue = presentValueGrowth + presentValueTerminal;
  
      return { value: fairValue }; // Return an object with a value property
    };
  
    const calculationResult = calculateFairValue();
    const fairValue = calculationResult.value;
    const errorMessage = calculationResult.error;
  
    const marginOfSafety = typeof fairValue === 'number' ? ((fairValue - stockPrice) / fairValue) * 100 : NaN;
  
    const gaugeColor = !isNaN(marginOfSafety) && marginOfSafety > 0 ? 'green' : 'red';
  
    return (
      <View style={styles.container}> {/* Main container */}
        <ScrollView contentContainerStyle={styles.scrollViewContent}> {/* Scroll View with content style */}
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerText}>Fair Value Calculator</Text>
          </View>
  
          {/* Sections */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Stock Information</Text>
            <Input label="Stock Price" value={stockPrice} onChangeText={setStockPrice} />
            <Input label="EPS" value={eps} onChangeText={setEps} />
          </View>
  
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>DCF Assumptions</Text>
            <SliderInput label="Discount Rate (%)" value={discountRate} onValueChange={setDiscountRate} min={0} max={20} />
            <View style={styles.row}>
              <View style={styles.column}>
                <Input label="Growth Stage Years" value={growthStageYears} onChangeText={setGrowthStageYears} />
              </View>
              <View style={styles.column}>
                <Input label="Growth Rate (%)" value={growthRate} onChangeText={setGrowthRate} />
              </View>
            </View>
            <Input label="Terminal Growth Rate (%)" value={terminalGrowthRate} onChangeText={setTerminalGrowthRate} />
          </View>
  
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Results</Text>
            <View style={styles.resultItem}>
              <Text style={styles.resultLabel}>Fair Value:</Text>
              <Text style={styles.resultValue}>
                {errorMessage ? errorMessage : (typeof fairValue === 'number' ? `$${fairValue.toFixed(2)}` : "Calculating...")}
              </Text>
            </View>
            <View style={styles.resultItem}>
              <Text style={styles.resultLabel}>Margin of Safety:</Text>
              <Text style={styles.resultValue}>
                {errorMessage ? "N/A" : (typeof marginOfSafety === 'number' ? `${marginOfSafety.toFixed(2)}%` : "Calculating...")}
              </Text>
            </View>
          </View>
  
          {/* Circular Gauge */}
          {/* <View style={styles.gaugeContainer}>
            <View style={[styles.gaugeCircle, { backgroundColor: gaugeColor }]} />
            <Text style={styles.gaugeText}>
              {isNaN(marginOfSafety) ? "N/A" : `${marginOfSafety.toFixed(2)}%`}
            </Text>
          </View> */}
        </ScrollView>
      </View>
    );
  };

// Input Component
const Input = ({ label, value, onChangeText, keyboardType = 'numeric' }) => (
  <View style={styles.inputContainer}>
    <Text style={styles.inputLabel}>{label}</Text>
    <TextInput
      style={styles.input}
      value={value.toString()} // Ensure value is a string
      onChangeText={onChangeText}
      keyboardType={keyboardType}
    />
  </View>
);

// Slider Input Component
const SliderInput = ({ label, value, onValueChange, min, max }) => (
  <View style={styles.inputContainer}>
    <Text style={styles.inputLabel}>{label}</Text>
    <Slider
      style={{ width: '100%', height: 40 }}
      minimumValue={min}
      maximumValue={max}
      value={value}
      onValueChange={onValueChange}
      step={0.1} // Adjust step as needed
    />
    <Text>{value.toFixed(1)}</Text> {/* Display current value */}
  </View>
);

const styles = StyleSheet.create({
  container: {
    marginTop: 60,
    flex: 1,
    padding: 20,
    backgroundColor: '#f0f0f0', // Light background color
    marginBottom: 60

  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  headerText: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  gaugeContainer: {
    alignItems: 'center',
    marginTop: 20,
  },
  gaugeCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 5,
    borderColor: 'white',
  },
  gaugeText: {
    position: 'absolute',  // Keep absolute positioning
    top: '50%',
    left: '50%',
    transform: [{ translateX: -25 }, { translateY: -10 }],
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  section: {
    marginBottom: 20,
    borderWidth: 1, // Add border to sections
    borderColor: '#ccc', // Light border color
    borderRadius: 5, // Rounded corners for sections
    padding: 15, // Add padding to sections
    backgroundColor: 'white', // White background for sections
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  inputContainer: {
    marginBottom: 10,
  },
  inputLabel: {
    fontSize: 16,
    marginBottom: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    padding: 10,
    fontSize: 16,
    backgroundColor: 'white', // White background for inputs
  },
  row: {
    flexDirection: 'row',
  },
  column: {
    flex: 1,
    marginRight: 10, // Add spacing between columns
  },
  resultItem: {
    flexDirection: 'row',
    marginBottom: 5,
  },
  resultLabel: {
    fontWeight: 'bold',
    marginRight: 10,
  },
  resultValue: {
    fontSize: 16,
  },
  gaugeContainer: {
    alignItems: 'center',
    marginTop: 20,
  },
  gaugeCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 5,
    borderColor: 'white',
  },
  gaugeText: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -25 }, { translateY: -10 }],
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
});

export default FairValueCalculator;