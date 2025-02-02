// Your App.tsx (or where you define your navigation)
import * as React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from './index'; // Import your HomeScreen
import HoldingsScreen from './HoldingsScreen'; // Import your holdings screen (the previous code)

const Stack = createNativeStackNavigator();

const App = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} />  {/* Home screen */}
        <Stack.Screen name="HoldingsScreen" component={HoldingsScreen} /> {/* Holdings screen */}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default App;


