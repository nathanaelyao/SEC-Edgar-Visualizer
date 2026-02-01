import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert, Platform } from 'react-native';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { CurrencyCode } from '@/utils/currency';
import { clearAllData } from '@/utils/db';

const SettingsScreen: React.FC = () => {
    const { theme, setTheme, currency, setCurrency, isDark } = useTheme();

    const currencies: { code: CurrencyCode, name: string, flag: string }[] = [
        { code: 'USD', name: 'US Dollar', flag: '🇺🇸' },
        { code: 'EUR', name: 'Euro', flag: '🇪🇺' },
        { code: 'GBP', name: 'British Pound', flag: '🇬🇧' },
        { code: 'JPY', name: 'Japanese Yen', flag: '🇯🇵' },
        { code: 'CAD', name: 'Canadian Dollar', flag: '🇨🇦' },
        { code: 'AUD', name: 'Australian Dollar', flag: '🇦🇺' },
        { code: 'CNY', name: 'Chinese Yuan', flag: '🇨🇳' },
    ];

    const toggleTheme = () => {
        setTheme(isDark ? 'light' : 'dark');
    };

    return (
        <ScrollView style={[styles.container, { backgroundColor: isDark ? '#000' : '#f8f9fa' }]} contentContainerStyle={styles.content}>
            <View style={styles.header}>
                <Text style={[styles.title, { color: isDark ? '#fff' : '#1a1a1a' }]}>Settings</Text>
                <Text style={styles.subtitle}>Manage your preferences and data</Text>
            </View>

            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="color-palette-outline" size={20} color={isDark ? '#8e8e93' : '#8e8e93'} />
                    <Text style={styles.sectionTitle}>Appearance</Text>
                </View>
                <View style={[styles.card, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#f0f0f0' }]}>
                    <View style={styles.row}>
                        <View style={styles.rowLeft}>
                            <View style={[styles.iconBox, { backgroundColor: isDark ? '#333' : '#f0f2f5' }]}>
                                <Ionicons name={isDark ? "moon" : "sunny"} size={18} color="#007AFF" />
                            </View>
                            <Text style={[styles.label, { color: isDark ? '#fff' : '#1a1a1a' }]}>Dark Mode</Text>
                        </View>
                        <Switch
                            value={isDark}
                            onValueChange={toggleTheme}
                            trackColor={{ false: '#d1d1d6', true: '#34C759' }}
                            thumbColor={Platform.OS === 'ios' ? '#fff' : isDark ? '#fff' : '#fff'}
                        />
                    </View>
                </View>
            </View>

            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="cash-outline" size={20} color={isDark ? '#8e8e93' : '#8e8e93'} />
                    <Text style={styles.sectionTitle}>Portfolio Currency</Text>
                </View>
                <View style={[styles.card, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#f0f0f0' }]}>
                    {currencies.map((curr, index) => (
                        <TouchableOpacity
                            key={curr.code}
                            style={[styles.row, index !== currencies.length - 1 && [styles.rowBorder, { borderBottomColor: isDark ? '#333' : '#f0f0f0' }]]}
                            onPress={() => setCurrency(curr.code)}
                        >
                            <View style={styles.rowLeft}>
                                <View style={[styles.avatar, { backgroundColor: isDark ? '#333' : '#f0f2f5' }]}>
                                    <Text style={{ fontSize: 16 }}>{curr.flag}</Text>
                                </View>
                                <View>
                                    <Text style={[styles.label, { color: isDark ? '#fff' : '#1a1a1a' }]}>{curr.name}</Text>
                                    <Text style={styles.subLabel}>{curr.code}</Text>
                                </View>
                            </View>
                            {currency === curr.code && (
                                <View style={styles.checkmarkBox}>
                                    <MaterialIcons name="check" size={18} color="#007AFF" />
                                </View>
                            )}
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="shield-checkmark-outline" size={20} color={isDark ? '#8e8e93' : '#8e8e93'} />
                    <Text style={styles.sectionTitle}>Data Management</Text>
                </View>
                <View style={[styles.card, { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderColor: isDark ? '#333' : '#f0f0f0' }]}>
                    <TouchableOpacity
                        style={styles.row}
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
                                                setCurrency('USD');
                                                if (isDark) toggleTheme();
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
                        <View style={styles.rowLeft}>
                            <View style={[styles.iconBox, { backgroundColor: 'rgba(255, 59, 48, 0.1)' }]}>
                                <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                            </View>
                            <Text style={[styles.label, { color: '#FF3B30' }]}>Reset All Data</Text>
                        </View>
                        <MaterialIcons name="chevron-right" size={24} color={isDark ? '#333' : '#ccc'} />
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.footer}>
                <Text style={styles.footerText}>SEC Edgar Visualizer</Text>
                <Text style={styles.versionText}>Version 1.2.0 • Build 2026.02.01</Text>
            </View>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        paddingTop: Platform.OS === 'ios' ? 60 : 40,
        paddingBottom: 40,
    },
    header: {
        paddingHorizontal: 20,
        marginBottom: 32,
        alignItems: 'center',
    },
    title: {
        fontSize: 34,
        fontWeight: '900',
        letterSpacing: -1,
    },
    subtitle: {
        fontSize: 14,
        color: '#8e8e93',
        fontWeight: '600',
        marginTop: 4,
    },
    section: {
        marginBottom: 24,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 24,
        marginBottom: 12,
        gap: 8,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: '#8e8e93',
        textTransform: 'uppercase',
        letterSpacing: 1.5,
    },
    card: {
        marginHorizontal: 20,
        borderRadius: 24,
        padding: 4,
        borderWidth: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 12,
        elevation: 2,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
    },
    rowBorder: {
        borderBottomWidth: 1,
    },
    rowLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
    },
    iconBox: {
        width: 36,
        height: 36,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    label: {
        fontSize: 16,
        fontWeight: '700',
    },
    subLabel: {
        fontSize: 12,
        color: '#8e8e93',
        fontWeight: '600',
        marginTop: 1,
    },
    checkmarkBox: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: 'rgba(0, 122, 255, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    footer: {
        marginTop: 20,
        alignItems: 'center',
        paddingHorizontal: 40,
    },
    footerText: {
        fontSize: 13,
        fontWeight: '800',
        color: '#8e8e93',
        letterSpacing: 0.5,
    },
    versionText: {
        fontSize: 11,
        color: '#ccc',
        marginTop: 4,
        fontWeight: '600',
    }
});

export default SettingsScreen;


