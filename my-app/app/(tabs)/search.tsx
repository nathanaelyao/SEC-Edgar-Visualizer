import React, { useState,useEffect,useRef } from 'react';
import { View, Text, TextInput, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, Button } from 'react-native';
import { useNavigation } from '@react-navigation/native'; 
import { LogBox } from 'react-native';


LogBox.ignoreAllLogs(); 


const Home: React.FC = () => {
  const [searchText, setSearchText] = useState('');
  const navigation = useNavigation(); 


  const handleSearch = () => {
    if (searchText) { 
      console.log("Searching for:", searchText);
      navigation.navigate('SearchResultsScreen', { stockSymbol: searchText }); 
      setSearchText(''); 
    } else {
      alert("Please enter a stock symbol.");
    }
  };

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
            onSubmitEditing={handleSearch} 
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
    justifyContent: 'flex-start', 
    alignItems: 'center',
    padding: 20,
  },
  content: {
    width: '100%',
    maxWidth: 400,
    marginTop: '45%', 
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
