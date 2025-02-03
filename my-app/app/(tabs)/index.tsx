import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, Button } from 'react-native';
import { useNavigation } from '@react-navigation/native'; // Import navigation hook
import { LogBox } from 'react-native';

LogBox.ignoreAllLogs(); // Suppress *all* warnings

// ... your app code

const Home: React.FC = () => {
  const [searchText, setSearchText] = useState('');
  const navigation = useNavigation(); // Initialize navigation

  const handleSearch = () => {
    if (searchText) { // Check if search text is not empty
      console.log("Searching for:", searchText);
      navigation.navigate('SearchResultsScreen', { stockSymbol: searchText }); // Navigate and pass data
      setSearchText(''); // Clear the search bar after search (optional)
    } else {
      // Handle empty search (e.g., show an alert)
      alert("Please enter a stock symbol.");
    }
  };
  const barData = [
    {value: 250, label: 'M'},
    {value: 500, label: 'T', frontColor: '#177AD5'},
    {value: 745, label: 'W', frontColor: '#177AD5'},
    {value: 320, label: 'T'},
    {value: 600, label: 'F', frontColor: '#177AD5'},
    {value: 256, label: 'S'},
    {value: 300, label: 'S'},
];
  return (


    <SafeAreaView style={styles.safeArea}>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
      >

        <View style={styles.content}>
          <Text style={styles.title}>Stock Search</Text>
          <TextInput
            style={styles.searchBar}
            placeholder="Enter stock symbol (e.g., AAPL, MSFT)"
            placeholderTextColor="#aaa"
            onChangeText={setSearchText}
            value={searchText}
            autoCapitalize="characters"
            returnKeyType="search"
            onSubmitEditing={handleSearch} // Call search function on "Enter"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {

    flex: 1,
    justifyContent: 'flex-start', // Align to the top
    alignItems: 'center',
    padding: 20,
  },
  content: {
    width: '100%',
    maxWidth: 400,
    marginTop: '45%', // 45% of the screen height
  },
  title: {
    marginTop: 70,
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
    textAlign: 'center',
  },
  searchBar: {
    height: 50,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 15,
    fontSize: 16,
    backgroundColor: '#f8f8f8',
    color: '#333',
  },
});

export default Home
