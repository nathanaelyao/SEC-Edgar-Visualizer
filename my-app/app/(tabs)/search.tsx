import React, { useEffect, useState } from 'react';
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

  const fetchCompanies = async () => {
    try {
      const response = await fetch('https://www.sec.gov/files/company_tickers.json', {
        headers: { 'User-Agent': 'SEC_APP (nathanael.yao123@gmail.com)' },
      });

      if (!response.ok) throw new Error('Failed to fetch tickers from SEC');

      const data = await response.json();
      const companies: Company[] = Object.values(data).map((item: any) => ({
        name: item.title ?? '',
        ticker: item.ticker ?? '',
        cik: item.cik_str?.toString().padStart(10, '0') ?? '',
      }));

      if (searchText.trim() !== '') {
        const filtered = companies
          .filter(
            (c) =>
              c.ticker.toUpperCase().includes(searchText.toUpperCase()) ||
              c.name.toUpperCase().includes(searchText.toUpperCase())
          )
          .slice(0, 3);
        setSuggestions(filtered);
      } else {
        setSuggestions([]);
      }
    } catch (error) {
      console.error('Error fetching companies:', error);
      setSuggestions([]);
    }
  };

  useEffect(() => {
    fetchCompanies();
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
          placeholder="Enter stock symbol (e.g., AAPL, MSFT)"
          placeholderTextColor="#aaa"
          onChangeText={setSearchText}
          value={searchText}
          autoCapitalize="characters"
          returnKeyType="search"
          onSubmitEditing={() => {
            if (suggestions.length > 0) {
              handleSelect(suggestions[0]); // Navigate to first suggestion
            }
          }}
        />


          {suggestions.length > 0 && (
            <FlatList
              data={suggestions}
              keyExtractor={(item) => String(item.cik)}
              style={styles.suggestionsList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.suggestionItem}
                  onPress={() => handleSelect(item)}
                >
                  <Text style={styles.suggestionText}>
                    {item.name || 'N/A'} ({item.ticker || 'N/A'})
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
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    padding: 40,
    marginTop: 130
  },
  content: {
    width: '100%',
    maxWidth: 400,
    marginTop: '20%',
  },
  title: {
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
  suggestionsList: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  suggestionItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  suggestionText: {
    fontSize: 16,
  },
});

export default Home;
