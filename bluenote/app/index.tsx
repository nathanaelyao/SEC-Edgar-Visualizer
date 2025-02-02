// index.tsx (Home Screen)
import React from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';

const investors = [
  { name: 'Warren Buffett', institution: "Berkshire Hathaway", cik: '0001067983' },
  { name: 'Bryan Lawrence', institution: "Oakcliff Capital", cik: '0001657335' },
  { name: 'Robert Vinall', institution: "RV Capital", cik: '0001766596' },

  // Add more investors here...
];

const HomeScreen: React.FC = () => {
  const navigation = useNavigation();

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
      <FlatList
        data={investors}
        renderItem={renderItem}
        keyExtractor={(item) => item.cik}
        // Remove getItemLayout to disable optimizations if needed
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1, // Make the container take up the full screen
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
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