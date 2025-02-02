// Your App.tsx (or where you define your navigation)
import * as React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from './index'; // Import your HomeScreen
import HoldingsScreen from './HoldingsScreen'; // Import your holdings screen (the previous code)

const Stack = createNativeStackNavigator();

const App = () => {
  return (
      <Stack.Navigator>
        <Stack.Screen 
        name="Home" 
        component={HomeScreen} 
        options={{ headerShown: false }}
        />  {/* Home screen */}
        <Stack.Screen name="Holdings Screen" component={HoldingsScreen} options={{ headerShown: false }} /> {/* Holdings screen */}
      </Stack.Navigator>
  );
};

export default App;


