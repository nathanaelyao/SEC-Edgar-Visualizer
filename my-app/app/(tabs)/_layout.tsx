import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import HapticTab from '@/components/HapticTab';
import { Colors } from '@/constants/Colors';
import { useTheme } from '@/context/ThemeContext';

export default function TabLayout() {
  const { isDark } = useTheme();
  const theme = Colors[isDark ? 'dark' : 'light'];

  const renderTabIcon = (
    nameOutline: keyof typeof Ionicons.glyphMap,
    nameFilled: keyof typeof Ionicons.glyphMap,
    focused: boolean,
  ) => {
    return (
      <View style={styles.iconContainer}>
        <Ionicons
          name={focused ? nameFilled : nameOutline}
          size={20}
          color={focused ? theme.tabIconSelected : theme.tabIconDefault}
        />
      </View>
    );
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.tabIconSelected,
        tabBarInactiveTintColor: theme.tabIconDefault,
        headerShown: false,
        tabBarButton: HapticTab as any,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 0.2,
          marginTop: -2,
        },
        tabBarStyle: Platform.select({
          ios: {
            position: 'absolute',
            left: 18,
            right: 18,
            bottom: 24,
            height: 70,
            borderRadius: 32,
            backgroundColor: isDark ? 'rgba(19, 32, 46, 0.98)' : 'rgba(255, 255, 255, 0.97)',
            borderWidth: 1.5,
            borderColor: isDark ? '#1E3245' : 'rgba(141, 203, 226, 0.45)',
            shadowColor: isDark ? '#000000' : '#142C3D',
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: isDark ? 0.35 : 0.1,
            shadowRadius: 16,
            elevation: 8,
            paddingBottom: 8,
            paddingTop: 8,
          },
          default: {
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: 14,
            height: 64,
            borderRadius: 32,
            backgroundColor: isDark ? '#13202E' : '#FFFFFF',
            borderWidth: 1.5,
            borderColor: isDark ? '#1E3245' : 'rgba(141, 203, 226, 0.45)',
            elevation: 8,
            paddingBottom: 8,
            paddingTop: 8,
          },
        }),
      }}>
      <Tabs.Screen
        name="search"
        options={{
          title: 'Home',
          headerShown: false,
          tabBarIcon: ({ focused }) =>
            renderTabIcon('home-outline', 'home', focused),
        }}
      />

      <Tabs.Screen
        name="portfolio"
        options={{
          title: 'Portfolio',
          headerShown: false,
          tabBarIcon: ({ focused }) =>
            renderTabIcon('pie-chart-outline', 'pie-chart', focused),
        }}
      />

      <Tabs.Screen
        name="index"
        options={{
          title: '13F Filings',
          headerShown: false,
          tabBarIcon: ({ focused }) =>
            renderTabIcon('documents-outline', 'documents', focused),
        }}
      />

      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          headerShown: false,
          tabBarIcon: ({ focused }) =>
            renderTabIcon('settings-outline', 'settings', focused),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
