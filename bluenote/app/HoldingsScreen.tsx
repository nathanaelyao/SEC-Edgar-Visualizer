import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, TextInput, ActivityIndicator, Button } from 'react-native';
import { XMLParser } from 'fast-xml-parser';
import { RouteProp, useRoute } from '@react-navigation/native';
import HTML from 'react-native-html-parser'; // Import the HTML parser
import cheerio from 'react-native-cheerio'; // Import cheerio

type RootStackParamList = {
  HoldingsScreen: { investorName: string; cik: string };
};
const App: React.FC = () => {

  const [xmlUrl, setXmlUrl] = useState<string | null>(null);  // Type the state as either string or null
  const route = useRoute<RouteProp<RootStackParamList, 'HoldingsScreen'>>();
  const { investorName, cik } = route.params;
  const [filings, setFilings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchFilings();
  }, [cik]);

  const fetchFilings = async () => {
    console.log(cik)
    setLoading(true);
    setError(null);


    try {
      const apiUrl = `https://data.sec.gov/submissions/CIK${cik}.json`; // Example CIK, replace as needed
      const response = await fetch(apiUrl);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      

      const data = await response.json();
      console.log("Company Name:", data.name);
      console.log("CIK:", data.cik);
      console.log("Fiscal Year End:", data.fiscalYearEnd);

      const recentFilings = data.filings.recent;
      console.log(recentFilings)
      if (recentFilings) {

        console.log("Recent Filings Count:", recentFilings.accessionNumber.length);

        let first = true;
        for (let i = 0; i < recentFilings.accessionNumber.length; i++) {
          const accessionNumber = recentFilings.accessionNumber[i];
          const filingDate = recentFilings.filingDate[i];
          const formType = recentFilings.form[i];
          console.log(formType)
          const primaryDocument =  recentFilings.primaryDocument[i];
          const filename = primaryDocument.substring(primaryDocument.lastIndexOf('/') + 1);
          if ( formType == '13F-HR' && first) {
            first = false;
            console.log(`  Accession Number: ${accessionNumber}`);
            console.log(filename)
            console.log(`  Filing Date: ${filingDate}`);
            console.log(`  Form Type: ${formType}`);

            getHoldings(accessionNumber, data.cik).then(holdings => {
              setFilings(holdings || []);
            });
            break; // Stop after finding the first 13F-HR
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

  const getHoldings = async (accessionNumber, cik1) => {
    try {
        const accessionNumberNoHyphens = accessionNumber.replace(/-/g, '');
  
        
      const response = await fetch(
        `https://www.sec.gov/Archives/edgar/data/${cik1}/${accessionNumberNoHyphens}/index.html`
      );
 

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.text();

      const $ = cheerio.load(data); // This is the key change!

      const foundFiles: string[] = [];

      $('a').each(function () {  // Use Cheerio's each function
          const href = $(this).attr('href'); // Use Cheerio's attr function
          if (href && href.endsWith('.xml')) {
              foundFiles.push(href);
          }
      });

      console.log(foundFiles)
      for (let i = 0; i < foundFiles.length; i++) {
        if (!foundFiles[i].startsWith("primary")){
            const response1 = await fetch(
                `https://www.sec.gov${foundFiles[i]}`
            );
            const data1 = await response1.text();

            const parser = new XMLParser();
            const json = parser.parse(data1);
            return json['informationTable']['infoTable'] || [];
        }
      }
      return [];
      
 // Handle cases where infoTable might be missing
    } catch (error) {
      console.error("Error fetching holdings:", error);
      return []; // Return empty array in case of error
    }
  };

  const formatNumberWithCommas = (number: any): string => {
    if (number === undefined || number === null) {
      return "N/A";
    }
    const n = typeof number === 'string' ? parseFloat(number) : number; // Convert string to number
    return n.toLocaleString(); // Use toLocaleString for commas
  };
  
  const renderItem = ({ item }) => (
    <View style={styles.item}>
      <View style={styles.row}>
        <Text style={styles.boldText}>{item.nameOfIssuer}</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Shares:</Text>
        <Text>{formatNumberWithCommas(item.shrsOrPrnAmt?.sshPrnamt)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Value:</Text>
        <Text>${formatNumberWithCommas(item.value)}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>

    <View style={styles.header}> {/* New header View */}
        <Text style={styles.investorName}>{investorName}</Text>
        {/* <Text style={styles.companyName}>{companyName}</Text> Display company name */}
      </View>
      {loading && <ActivityIndicator size="large" color="#0000ff" />}
      {error && <Text style={styles.errorText}>{error}</Text>}

      <FlatList
        data={filings}
        renderItem={renderItem}
        keyExtractor={(item, index) => index.toString()}
        ListEmptyComponent={() => !loading && !error && <Text>No filings found.</Text>}
      />
    </View>
    
  );
};

const styles = StyleSheet.create({
container: {
    flex: 1,
    padding: 16,
    },
    header: {  // Style for the header
    alignItems: 'center', // Center the text horizontally
    marginBottom: 10,     // Add some space below the header
    },
    investorName: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 5,   // Space between investor and company name
    },
    companyName: {
    fontSize: 16,
    color: 'gray',  // Make company name slightly less prominent
    },
  button: {
    marginVertical: 10,
  },
  item: {
    backgroundColor: '#f0f0f0',
    padding: 12,
    marginBottom: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  row: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  label: {
    fontWeight: 'bold',
    marginRight: 8,
  },
  boldText: {
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 4,
  },
  errorText: {
    color: 'red',
    marginTop: 10,
  },
});

export default App;