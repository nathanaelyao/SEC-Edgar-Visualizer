import React from 'react';
import { TouchableOpacity, View, StyleSheet } from 'react-native';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { useTheme } from '@/context/ThemeContext';

export default function HapticTab(props: BottomTabBarButtonProps) {
  const { isDark } = useTheme();
  const { children, accessibilityState, onPress, style } = props;
  const focused = accessibilityState?.selected ?? false;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[
        style,
        {
          backgroundColor: focused
            ? isDark
              ? 'rgba(141,203,226,0.18)'
              : '#E8F5FA'
            : 'transparent',
          borderRadius: 36,
          margin: 4,
        },
      ]}
    >
      <View style={styles.inner}>{children}</View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  inner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
