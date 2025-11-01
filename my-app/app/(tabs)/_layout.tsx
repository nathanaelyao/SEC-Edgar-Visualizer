import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { HapticTab } from '@/components/HapticTab';
import { IconSymbol } from '@/components/ui/IconSymbol';
import TabBarBackground from '@/components/ui/TabBarBackground';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      initialRouteName="search"
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarBackground: TabBarBackground,
        tabBarStyle: Platform.select({
          ios: {
            // Use a transparent background on iOS to show the blur effect
            position: 'absolute',
          },
          default: {},
        }),
      }}>
        <Tabs.Screen
        name="search"
        options={{
          title: 'Stock Search',
          headerShown: false,
          tabBarIcon: ({ color }) => <MaterialIcons name="search" size={28} color={color} />,
        }}
      />
        <Tabs.Screen
        name="index"
        options={{
          title: '13F Filings',
          headerShown: false,
          tabBarIcon: ({ color }) => <MaterialIcons name="article" size={28} color={color} />,
        }}
      />


            {/* <Tabs.Screen
        name="calc"
        options={{
          title: 'DCF Calculator',
          headerShown: false,
          tabBarIcon: ({ color }) => <MaterialIcons name="calculate" size={28} color={color} />,
        }}
      /> */}

    </Tabs>
  );
}
