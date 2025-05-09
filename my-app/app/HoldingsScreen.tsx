import React, { useState, useEffect } from 'react';
import { View, Text,TouchableOpacity, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { XMLParser } from 'fast-xml-parser';
import { RouteProp, useRoute } from '@react-navigation/native';
import cheerio from 'react-native-cheerio'; // Import cheerio
import { useNavigation } from '@react-navigation/native';

type RootStackParamList = {
  HoldingsScreen: { investorName: string; cik: string, institution: string };
};
const HoldingsScreen: React.FC = () => {
  const navigation = useNavigation();

  const [totalPortfolioValue, setTotalPortfolioValue] = useState(0);
  const route = useRoute<RouteProp<RootStackParamList, 'HoldingsScreen'>>();
  const { investorName, cik, institution } = route.params;
  const [filings, setFilings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previousFilings, setPreviousFilings] = useState<any[]>([]); 
  const [quarter, setQuarter] = useState<string | null>(null); 
  const headers = {
    'User-Agent': 'SEC_APP (nathanael.yao123@gmail.com)',
    // 'Content-Type': 'application/json'
  };
  useEffect(() => {
    fetchFilings();
  }, [cik]);

  const fetchFilings = async () => {
    setLoading(true);
    setError(null);


    try {
      const apiUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
      const response = await fetch(apiUrl, { headers });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      

      const data = await response.json();
      console.log("Company Name:", data.name);
      console.log("CIK:", data.cik);
      console.log("Fiscal Year End:", data.fiscalYearEnd);

      const recentFilings = data.filings.recent;
      if (recentFilings) {


        let first = true;
        let second = true;
        for (let i = 0; i < recentFilings.accessionNumber.length; i++) {
          const accessionNumber = recentFilings.accessionNumber[i];
          const filingDate = recentFilings.filingDate[i];
          const formType = recentFilings.form[i];
          const primaryDocument =  recentFilings.primaryDocument[i];
          const filename = primaryDocument.substring(primaryDocument.lastIndexOf('/') + 1);
          if ( formType == '13F-HR' && first) {
            first = false;
            console.log(`  Accession Number: ${accessionNumber}`);
            console.log(filename)
            console.log(`  Filing Date: ${filingDate}`);
            console.log(`  Form Type: ${formType}`);

            const filingDateObj = new Date(filingDate);
            const month = filingDateObj.getMonth() + 1; // Month is 0-indexed
            let quarterString = "";
    
            if (month >= 1 && month <= 3) {
              quarterString = "Q4 " + (filingDateObj.getFullYear() - 1);
            } else if (month >= 4 && month <= 6) {
              quarterString = "Q1 " + filingDateObj.getFullYear();
            } else if (month >= 7 && month <= 9) {
              quarterString = "Q2 " + filingDateObj.getFullYear();
            } else if (month >= 10 && month <= 12) {
              quarterString = "Q3 " + filingDateObj.getFullYear();
            }
            setQuarter(quarterString); 

            getHoldings(accessionNumber, data.cik).then(holdings => {
              console.log(holdings)
              const combinedHoldings = combineSameIssuer(holdings)
              const sortedHoldings = sortHoldingsByValue(combinedHoldings);
              setFilings(sortedHoldings || []);
              if (sortedHoldings) {
                const totalValue = combinedHoldings.reduce((sum, item) => sum + parseFloat(item.value), 0);
                setTotalPortfolioValue(totalValue);
              }
            });
            
          }
          else if (formType == '13F-HR' && second) {  
            second = false;
            console.log(`Second 13F-HR: ${accessionNumber}`);
            await getHoldings(accessionNumber, data.cik).then(previousHoldings => {
                console.log(previousHoldings,'prevvvv')
              setPreviousFilings(combineSameIssuer(previousHoldings)); 
            });
            break; 
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
  const calculatePercentageChange = (currentShares: number, issuer: string): { change: string; color: string } => {
    if (previousFilings.length === 0) {
      return { change: "N/A", color: 'black' }; 
    }

    const previousHolding = previousFilings.find(item => item.nameOfIssuer === issuer);

    if (!previousHolding || !previousHolding.shrsOrPrnAmt?.sshPrnamt) {
      return { change: "New Position", color: 'green' }; 
    }

    const previousShares = parseFloat(previousHolding.shrsOrPrnAmt.sshPrnamt);

    if (isNaN(currentShares) || isNaN(previousShares) || previousShares === 0) {
      return { change: "N/A", color: 'black' }; 
    }

    const percentageChange = ((currentShares - previousShares) / previousShares) * 100;
    const absPercentageChange = Math.abs(percentageChange); 

    let changeString = "";
    let prefix = "";

    if (percentageChange > 0) {
      prefix = "Add ";
      changeString = absPercentageChange.toFixed(2) + "%";
    } else if (percentageChange < 0) {
      prefix = "Reduce ";
      changeString = absPercentageChange.toFixed(2) + "%";
    } else {
      changeString = percentageChange.toFixed(2) + "%"; 
    }

    const color = percentageChange > 0 ? 'green' : percentageChange < 0 ? 'red' : 'black';
    return { change: prefix + changeString, color }; 
  };
  const sortHoldingsByValue = (holdings: any[]) => {
    return [...holdings].sort((a, b) => parseFloat(b.value) - parseFloat(a.value));
  };
  const combineSameIssuer = (holdings: any[]) => {
    const combined = [];
    const seen = new Set<string>(); 

    for (const item of holdings) {
        if (!item?.nameOfIssuer || !item?.shrsOrPrnAmt?.sshPrnamt || !item?.value) continue; 

        const issuer = item.nameOfIssuer;
        const shares = parseFloat(item.shrsOrPrnAmt.sshPrnamt);
        const value = parseFloat(item.value);

        if (seen.has(issuer)) {
            const existingItem = combined.find(h => h.nameOfIssuer === issuer);
            if (existingItem) {
                existingItem.shrsOrPrnAmt.sshPrnamt = (parseFloat(existingItem.shrsOrPrnAmt.sshPrnamt) + shares).toString(); // Add shares. Convert to string
                existingItem.value = (parseFloat(existingItem.value) + value).toString(); // Add value. Convert to string
            }
        } else {
            const newItem = JSON.parse(JSON.stringify(item));
            combined.push(newItem);
            seen.add(issuer);
        }
    }
    return combined;
};
  const getHoldings = async (accessionNumber, cik1) => {
    try {
        const accessionNumberNoHyphens = accessionNumber.replace(/-/g, '');
  
        
      const response = await fetch(
        `https://www.sec.gov/Archives/edgar/data/${cik1}/${accessionNumberNoHyphens}/index.html`,
        { headers }
      );
 
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.text();

      const $ = cheerio.load(data); 

      const foundFiles: string[] = [];

      $('a').each(function () {  
          const href = $(this).attr('href'); 
          if (href && href.endsWith('.xml')) {
              foundFiles.push(href);
          }
      });

      for (let i = 0; i < foundFiles.length; i++) {
        if (!foundFiles[i].startsWith("primary")){
            console.log(foundFiles[i])
            const response1 = await fetch(
                `https://www.sec.gov${foundFiles[i]}`, { headers }
            );
            const data1 = await response1.text();
            console.log(data1)
            const parser = new XMLParser();
            const json = removeNamespace(parser.parse(data1));
            console.log(json.infoTable)
            console.log( json['ns1:informationTable']?.['ns1:infoTable'], 'lassst')
            
            return json['informationTable']?.infoTable || 
            json['ns1:informationTable']?.['ns1:infoTable'] ||
             [];
                    }
      }
      return [];
      
    } catch (error) {
      console.error("Error fetching holdings:", error);
      return []; 
    }
  };
  function removeNamespace(data) {
    if (Array.isArray(data)) {
      return data.map(item => removeNamespace(item));
    } else if (typeof data === 'object' && data !== null) {
      const newData = {};
      for (const key in data) {
        const newKey = key.replace('ns1:', '');
        newData[newKey] = removeNamespace(data[key]);
      }
      return newData;
    } else {
      return data;
    }
  }
  const formatNumberWithCommas = (number: any): string => {
    if (number === undefined || number === null) {
      return "N/A";
    }
    const n = typeof number === 'string' ? parseFloat(number) : number;
    return n.toLocaleString(); 
  };
  const calculatePercentage = (value: number): string => {
    if (totalPortfolioValue === 0 || isNaN(value)) {
        return "0.00%"; 
    }
    const percentage = (value / totalPortfolioValue) * 100;
    return percentage.toFixed(2) + "%";
};
const renderItem = ({ item }) => {
    const changeData = calculatePercentageChange(parseFloat(item.shrsOrPrnAmt?.sshPrnamt), item.nameOfIssuer);
    const change = changeData.change;
    const color = changeData.color;
  
    return ( 


        <TouchableOpacity style={styles.item}
        onPress={() => {
        navigation.navigate('SearchResultsScreen', {
          stockSymbol: item.nameOfIssuer,
        });
      }}>
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
      <View style={styles.row}>
        <Text style={styles.label}>% of Portfolio:</Text>
        <Text>{calculatePercentage(parseFloat(item.value))}</Text> 
      </View>
          <View style={styles.row}>
            <Text style={styles.label}>Change in Shares:</Text>
            <Text style={{ color }}>{change}</Text>
          </View>
      </TouchableOpacity>
    );
  };


  return (
    <View style={styles.container}>

    <View style={styles.header}> 
        <Text style={styles.investorName}>{investorName}</Text>
        <Text style={styles.institutionName}>{institution}</Text> 
        {quarter && <Text style={styles.quarterText}>{quarter}</Text>}
        <Text style={styles.portfolioValue}>
          Total Portfolio Value: ${formatNumberWithCommas(totalPortfolioValue)}
        </Text> 
      </View>
      {loading && <ActivityIndicator size="large" color="#0000ff" />}
      {error && <Text style={styles.errorText}>{error}</Text>}

      <FlatList
        data={filings}
        renderItem={renderItem}
        keyExtractor={(item, index) => index.toString()}
        ListEmptyComponent={() => !loading && !error && <Text></Text>}
      />
    </View>
    
  );
};

const styles = StyleSheet.create({
container: {
    flex: 1,
    padding: 20,
    justifyContent: 'flex-start', 

    },
    header: { 
    alignItems: 'center', 
    marginBottom: 10, 
    },
    investorName: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 5,
      },
      institutionName: {
        fontSize: 16,
        color: 'gray',
        marginBottom: 5, 
      },
      portfolioValue: { 
        fontSize: 16,
        fontWeight: 'bold',
      },

    companyName: {
    fontSize: 16,
    color: 'gray', 
    },
  button: {
    marginVertical: 10,
  },
  item: {
    backgroundColor: '#fafafa',
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

export default HoldingsScreen;