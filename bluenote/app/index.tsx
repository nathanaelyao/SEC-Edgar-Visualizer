// index.tsx (Home Screen)
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';

const investorsData = [ // Store original data
  { name: 'Warren Buffett', institution: "Berkshire Hathaway", cik: '0001067983' },
  { name: 'Bryan Lawrence', institution: "Oakcliff Capital", cik: '0001657335' },
  { name: 'Robert Vinall', institution: "RV Capital", cik: '0001766596' },
  { name: 'Li Lu', institution: "Himalaya Capital", cik: '0001709323' },
  { name: 'Monish Pabrai', institution: "Dalal Street", cik: '0001549575' },
  { name: 'Howard Marks', institution: "Oaktree Capital Management", cik: '0000949509' },
  { name: 'David Tepper', institution: "Appaloosa Management", cik: '0001656456' },

  // ... more investors
]; 

const HomeScreen: React.FC = () => {
  const navigation = useNavigation();
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredInvestors, setFilteredInvestors] = useState(investorsData);

  useEffect(() => {
    // 1. Sort by first name:
    const sortedInvestors = [...investorsData].sort((a, b) => {
      const firstNameA = a.name.split(' ')[0].toLowerCase(); // Extract first name
      const firstNameB = b.name.split(' ')[0].toLowerCase();
      return firstNameA.localeCompare(firstNameB); // Compare first names
    });

    // 2. Then filter (using the sorted data):
    const filtered = sortedInvestors.filter(investor => {
      const lowerCaseQuery = searchQuery.toLowerCase();
      const lowerCaseName = investor.name.toLowerCase();
      const lowerCaseInstitution = investor.institution.toLowerCase();

      return (
        lowerCaseName.includes(lowerCaseQuery) ||
        lowerCaseInstitution.includes(lowerCaseQuery)
      );
    });

    setFilteredInvestors(filtered);
  }, [searchQuery]);

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.investorItem}
      onPress={() => {
        navigation.navigate('HoldingsScreen', {
          investorName: item.name,
          institution: item.institution,
          cik: item.cik,
        });
      }}
    >
      <Text style={styles.investorName}>{item.name}</Text>
      <Text style={styles.institutionName}>{item.institution}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Institutional 13Fs</Text>
      <TextInput
        style={styles.searchBar}
        placeholder="Search by name or institution" // Placeholder text
        placeholderTextColor="gray" // Grayed out placeholder
        onChangeText={setSearchQuery}
        value={searchQuery}
      />
      <FlatList
        data={filteredInvestors} // Use filtered data
        renderItem={renderItem}
        keyExtractor={(item) => item.cik}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  searchBar: {  // Style for the search bar
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    marginBottom: 16,
    paddingHorizontal: 8,
    borderRadius: 5, // Add rounded corners
  },
  investorItem: {
    backgroundColor: '#f0f0f0',
    padding: 16,
    marginBottom: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  investorName: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  institutionName: {
    fontSize: 14,
    color: 'gray',
  },
});

export default HomeScreen;