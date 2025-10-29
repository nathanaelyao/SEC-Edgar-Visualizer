import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

interface Company {
  name: string;
  ticker: string;
  cik: string;
}

const Home: React.FC = () => {
  const [searchText, setSearchText] = useState('');
  const [suggestions, setSuggestions] = useState<Company[]>([]);
  const navigation = useNavigation();

  const fetchCompanies = async (query: string) => {
    try {
      const response = await fetch('https://www.sec.gov/files/company_tickers.json', {
        headers: {
          'User-Agent': 'SEC_APP (nathanael.yao123@gmail.com)',
        },
      });
      const data = await response.json();

      const companies: Company[] = Object.values(data)
        .filter((item: any) => item.ticker && item.title) // remove empty tickers
        .map((item: any) => ({
          name: item.title,
          ticker: item.ticker,
          cik: item.cik_str?.toString().padStart(10, '0') || '',
        }));

      const filtered = companies
        .filter(
          (c) =>
            c.ticker.toUpperCase().includes(query.toUpperCase()) ||
            c.name.toUpperCase().includes(query.toUpperCase())
        )
        .slice(0, 5);

      setSuggestions(filtered);
    } catch (error) {
      console.error('Error fetching companies:', error);
      setSuggestions([]);
    }
  };

  useEffect(() => {
    if (searchText.trim() !== '') {
      fetchCompanies(searchText);
    } else {
      setSuggestions([]);
    }
  }, [searchText]);

  const handleSelect = (company: Company) => {
    navigation.navigate('SearchResultsScreen', { stockSymbol: company.ticker });
    setSearchText('');
    setSuggestions([]);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <View style={styles.content}>
          <Text style={styles.title}>Stock Search</Text>
          <TextInput
            style={styles.searchBar}
            placeholder="Enter stock symbol or company name"
            placeholderTextColor="#aaa"
            value={searchText}
            onChangeText={setSearchText}
            autoCapitalize="characters"
          />
          {suggestions.length > 0 && (
            <FlatList
              style={styles.suggestionsList}
              data={suggestions}
              keyExtractor={(item) => item.cik}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.suggestionItem}
                  onPress={() => handleSelect(item)}
                >
                  <Text style={styles.suggestionText}>
                    {item.name} ({item.ticker})
                  </Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, justifyContent: 'flex-start', alignItems: 'center', padding: 20 },
  content: { width: '100%', maxWidth: 400, marginTop: '20%' },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
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
  suggestionsList: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  suggestionItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  suggestionText: { fontSize: 16 },
});

export default Home;
