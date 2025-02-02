import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, TextInput, ActivityIndicator, Button } from 'react-native';
// import { parseString } from 'react-native-xml2js';
import { XMLParser } from 'fast-xml-parser';
const App: React.FC = () => {
  const investorName = 'Warren Buffett'
  const [filings, setFilings] = useState<any[]>([]); // Use 'any' or a more specific type if you know the API response structure
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFilings = async () => {
    setLoading(true);
    setError(null);
    if (!investorName) {
      setLoading(false);
      return;
    }

    try {
      // const apiUrl = `YOUR_EDGAR_API_ENDPOINT?investorName=${encodeURIComponent(investorName)}`; // Replace with your actual endpoint
      const apiUrl = 'https://data.sec.gov/submissions/CIK0001657335.json'
      const response = await fetch(apiUrl);
      if (!response.ok) {
        const errorData = await response.json(); // Attempt to extract more detailed error info
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      var oHoldings = []
      console.log("Company Name:", data.name);
      console.log("CIK:", data.cik);
      console.log("Fiscal Year End:", data.fiscalYearEnd);
      const recentFilings = data.filings.recent;
      console.log('filings',recentFilings)
      if (recentFilings) {  // Check if recentFilings exists
        console.log("Recent Filings Count:", recentFilings.accessionNumber.length);
        console.log("First Accession Number:", recentFilings.accessionNumber[0]);
        console.log("First Filing Date:", recentFilings.filingDate[0]);
      
        // Example: Loop through recent filings
        // for (let i = 0; i < recentFilings.accessionNumber.length; i++) {

    

      

        var first = true
        for (let i = 0; i < recentFilings.accessionNumber.length; i++) {
          const accessionNumber = recentFilings.accessionNumber[i];
          const filingDate = recentFilings.filingDate[i];
          const formType = recentFilings.form[i];
          if (formType == '13F-HR' && first){
            first = false
            console.log(`  Accession Number: ${accessionNumber}`);
            console.log(`  Filing Date: ${filingDate}`);
            console.log(`  Form Type: ${formType}`);
          // Now that you have the accession number, you can call the holdings data endpoint (as discussed in the previous response)
            getHoldings(accessionNumber, data.cik).then(holdings => {
              // Process holdings data here

              setFilings(holdings || []); 
              console.log('filings',filings)// Adjust based on your actual API response structure


          })
          }

        }
        
    
        
      } else {
        console.log("No recent filings found.");
      }
    } catch (err) {
      setError(err.message);
      console.error("Error fetching filings:", err);
    } finally {
      setLoading(false);
    }
  };
  const getHoldings = async (accessionNumber, cik) => {
    try {
      const accessionNumberNoHyphens = accessionNumber.replace(/-/g, '');
      console.log(accessionNumberNoHyphens, 'no')
      //https://www.sec.gov/Archives/edgar/data/1657335/000117266120001705/infotable.xml
      const response = await fetch(
        `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNumberNoHyphens}/infotable.xml` // Replace with your API URL structure
      );
  
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
  
      const data = await response.text();
      const parser = new XMLParser();
      const json = parser.parse(data);
      console.log(json['informationTable']['infoTable'], 'jsssssson')
      return json['informationTable']['infoTable']
  
    } catch (error) {
      console.error("Error fetching holdings:", error);
      return null;
    }
  };
  useEffect(() => {
    // You can fetch initial data here if needed
  }, []);

  const renderItem = ({ item }) => (
    <View style={styles.item}>
      <Text style={styles.boldText}>{item.nameOfIssuer}</Text>
      <Text>CUSIP: {item.cusip}</Text>
      <Text>Shares: {item.shrsOrPrnAmt.sshPrnamt} {item.shrsOrPrnAmt.sshPrnamtType}</Text>
      <Text>Value: ${item.value}</Text>
      <Text>Voting Authority: Sole: {item.votingAuthority.Sole}, Shared: {item.votingAuthority.Shared}, None: {item.votingAuthority.None}</Text>
      {/* Add other fields as needed */}
    </View>
  );

  return (
    <View style={styles.container}>

      <View style={styles.button}>
        <Button title="Search" onPress={fetchFilings} />
      </View>

      {loading && <ActivityIndicator size="large" color="#0000ff" />}
      {error && <Text style={styles.errorText}>{error}</Text>}

      <FlatList
        data={filings}
        renderItem={renderItem}
        keyExtractor={(item, index) => index.toString()} // Use a more stable key if available
        ListEmptyComponent={() => !loading && !error && <Text>No filings found.</Text>}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  // ... (styles remain the same)
});

export default App; // Make sure to export the component