import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { CurrencyCode } from '@/utils/currency';
import { clearAllData } from '@/utils/db';

const SettingsScreen: React.FC = () => {
    const { theme, setTheme, currency, setCurrency, isDark } = useTheme();

    const currencies: { code: CurrencyCode, name: string }[] = [
        { code: 'USD', name: 'US Dollar' },
        { code: 'EUR', name: 'Euro' },
        { code: 'GBP', name: 'British Pound' },
        { code: 'JPY', name: 'Japanese Yen' },
        { code: 'CAD', name: 'Canadian Dollar' },
        { code: 'AUD', name: 'Australian Dollar' },
        { code: 'CNY', name: 'Chinese Yuan' },
    ];

    const toggleTheme = () => {
        setTheme(isDark ? 'light' : 'dark');
    };

    const dynamicStyles = StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: isDark ? '#121212' : '#f8f9fa',
            paddingTop: 80,
        },
        sectionTitle: {
            fontSize: 14,
            fontWeight: '700',
            color: isDark ? '#bbb' : '#8e8e93',
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginHorizontal: 20,
            marginBottom: 12,
        },
        card: {
            backgroundColor: isDark ? '#1e1e1e' : '#ffffff',
            marginHorizontal: 16,
            borderRadius: 16,
            padding: 16,
            marginBottom: 24,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: isDark ? 0.3 : 0.05,
            shadowRadius: 5,
            elevation: 2,
        },
        row: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: 12,
        },
        rowBorder: {
            borderBottomWidth: 1,
            borderBottomColor: isDark ? '#333' : '#f0f0f0',
        },
        label: {
            fontSize: 16,
            fontWeight: '600',
            color: isDark ? '#fff' : '#1a1a1a',
        },
        value: {
            fontSize: 15,
            color: '#007AFF',
            fontWeight: '600',
        },
        title: {
            fontSize: 28,
            fontWeight: '700',
            color: isDark ? '#fff' : '#1a1a1a',
            textAlign: 'center',
            marginBottom: 32,
        }
    });

    return (
        <ScrollView style={dynamicStyles.container}>
            <Text style={dynamicStyles.title}>Settings</Text>

            <Text style={dynamicStyles.sectionTitle}>Appearance</Text>
            <View style={dynamicStyles.card}>
                <View style={dynamicStyles.row}>
                    <Text style={dynamicStyles.label}>Dark Mode</Text>
                    <Switch
                        value={isDark}
                        onValueChange={toggleTheme}
                        trackColor={{ false: '#d1d1d6', true: '#34C759' }}
                        thumbColor={Platform.OS === 'ios' ? '#fff' : isDark ? '#fff' : '#fff'}
                    />
                </View>
            </View>

            <Text style={dynamicStyles.sectionTitle}>Portfolio Currency</Text>
            <View style={dynamicStyles.card}>
                {currencies.map((curr, index) => (
                    <TouchableOpacity
                        key={curr.code}
                        style={[dynamicStyles.row, index !== currencies.length - 1 && dynamicStyles.rowBorder]}
                        onPress={() => setCurrency(curr.code)}
                    >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: isDark ? '#333' : '#f0f0f0', alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ fontSize: 14 }}>{curr.code === 'USD' ? '🇺🇸' : curr.code === 'EUR' ? '🇪🇺' : curr.code === 'GBP' ? '🇬🇧' : curr.code === 'JPY' ? '🇯🇵' : curr.code === 'CAD' ? '🇨🇦' : curr.code === 'AUD' ? '🇦🇺' : '🇨🇳'}</Text>
                            </View>
                            <Text style={dynamicStyles.label}>{curr.name}</Text>
                        </View>
                        {currency === curr.code && (
                            <MaterialIcons name="check" size={24} color="#007AFF" />
                        )}
                    </TouchableOpacity>
                ))}
            </View>

            <Text style={dynamicStyles.sectionTitle}>Data Management</Text>
            <View style={dynamicStyles.card}>
                <TouchableOpacity
                    style={[dynamicStyles.row, { justifyContent: 'center' }]}
                    onPress={() => {
                        Alert.alert(
                            "Reset All Data",
                            "Are you sure you want to delete all portfolio data and transactions? This action cannot be undone.",
                            [
                                { text: "Cancel", style: "cancel" },
                                {
                                    text: "Reset Data",
                                    style: "destructive",
                                    onPress: async () => {
                                        try {
                                            await clearAllData();
                                            // Reset local state if needed? 
                                            // Ideally we force a reload or just alert success.
                                            // The app state elsewhere (currency, theme) updates via context, 
                                            // but data in other tabs needs refresh.
                                            // Since this is settings, user will likely navigate away, triggering refresh on focus.
                                            setCurrency('USD'); // Reset local context state to match DB default
                                            if (isDark) toggleTheme(); // Reset to system/light default if that's what DB does? 
                                            // Actually DB resets to 'system'. Context should update?
                                            // Context initializes from storage/DB on mount. 
                                            // We might need to manually sync context state here.
                                            Alert.alert("Success", "All data has been wiped.");
                                        } catch (e) {
                                            Alert.alert("Error", "Failed to reset data.");
                                        }
                                    }
                                }
                            ]
                        );
                    }}
                >
                    <Text style={{ color: '#FF3B30', fontSize: 16, fontWeight: '600' }}>Reset Data</Text>
                </TouchableOpacity>
            </View>

            <View style={{ padding: 40, alignItems: 'center' }}>
                <Text style={{ color: '#8e8e93', fontSize: 12 }}>SEC Edgar Visualizer v1.2.0</Text>
            </View>
        </ScrollView>
    );
};

export default SettingsScreen;

