import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';

const investorsData = [
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
    const [filingDates, setFilingDates] = useState({});
    const [loading, setLoading] = useState(true); // Loading state

    useEffect(() => {
        const fetchFilingDates = async () => {
            const dates = {};
            try {
                const promises = investorsData.map(async (investor) => { // Use Promise.all for concurrent requests
                    try {
                        const response = await fetch(`https://data.sec.gov/submissions/CIK${investor.cik}.json`); // Replace with your API endpoint
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        const data = await response.json();
                        const recentFilings = data.filings.recent;
                        if (recentFilings) {
                  
                  
                          let first = true;
                          for (let i = 0; i < recentFilings.accessionNumber.length; i++) {
                            const filingDate = recentFilings.filingDate[i];
                            const formType = recentFilings.form[i];
                            if ( formType == '13F-HR' && first) {
                              first = false;
                              console.log(`  Filing Date: ${filingDate}`);
                              const filingDateObj = new Date(filingDate);
                              const month = filingDateObj.getMonth() + 1; // Month is 0-indexed
                              let quarterString = "";
                      
                              if (month >= 1 && month <= 3) {
                                quarterString = "Q4 " + filingDateObj.getFullYear();
                              } else if (month >= 4 && month <= 6) {
                                quarterString = "Q1 " + filingDateObj.getFullYear();
                              } else if (month >= 7 && month <= 9) {
                                quarterString = "Q2 " + filingDateObj.getFullYear();
                              } else if (month >= 10 && month <= 12) {
                                quarterString = "Q3 " + filingDateObj.getFullYear();
                              }
                              return {cik: investor.cik, date: filingDate, quarter: quarterString}
                            }
                          }
                        }
                        return { cik: investor.cik, date: data.filingDate || 'N/A', quarter: data.filingQuarter || 'N/A' };
                    } catch (error) {
                        console.error(`Error fetching filing date for ${investor.name}:`, error);
                        return { cik: investor.cik, date: 'N/A', quarter: 'N/A' };
                    }
                });

                const results = await Promise.all(promises); // Wait for all requests to complete
                console.log(results)
                results.forEach(result => dates[result.cik] = { date: result.date, quarter: result.quarter }); // Add results to the dates object
                setFilingDates(dates);

            } finally {
                setLoading(false); // Set loading to false regardless of success or failure
            }
        };

        fetchFilingDates();
    }, []);

    useEffect(() => {
        const sortedInvestors = [...investorsData].sort((a, b) => {
            const firstNameA = a.name.split(' ')[0].toLowerCase();
            const firstNameB = b.name.split(' ')[0].toLowerCase();
            return firstNameA.localeCompare(firstNameB);
        });

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
            <View style={styles.investorNameContainer}>
                <Text style={styles.investorName}>{item.name}</Text>
                <Text style={styles.filingInfo}>
                    {filingDates[item.cik]?.date} ({filingDates[item.cik]?.quarter})
                </Text>
            </View>
            <Text style={styles.institutionName}>{item.institution}</Text>
        </TouchableOpacity>
    );

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Institutional 13Fs</Text>
            <TextInput
                style={styles.searchBar}
                placeholder="Search by name or institution"
                placeholderTextColor="gray"
                onChangeText={setSearchQuery}
                value={searchQuery}
            />
            {loading ? (
                <ActivityIndicator size="large" color="#0000ff" /> // Display loading indicator
            ) : (
                <FlatList
                    data={filteredInvestors}
                    renderItem={renderItem}
                    keyExtractor={(item) => item.cik}
                />
            )}
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
    searchBar: {
        height: 40,
        borderColor: 'gray',
        borderWidth: 1,
        marginBottom: 16,
        paddingHorizontal: 8,
        borderRadius: 5,
    },
    investorItem: {
        backgroundColor: '#f0f0f0',
        padding: 16,
        marginBottom: 8,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: '#ddd',
    },
    investorNameContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    investorName: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    filingInfo: {
        fontSize: 12,
        color: 'gray',
    },
    institutionName: {
        fontSize: 14,
        color: 'gray',
    },
});

export default HomeScreen;