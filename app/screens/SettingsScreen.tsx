import React, { useState, useEffect } from 'react';
import {
  ScrollView,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScreenContainer } from '@/components/screen-container';
import { useColors } from '@/hooks/use-colors';

interface Settings {
  privateKey: string;
  alchemyKey: string;
  profitWallet: string;
  initialCapital: string;
  minProfitUSD: string;
  maxSlippagePercent: string;
  maxGasGwei: string;
  network: 'polygon' | 'mumbai';
  autoStart: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  privateKey: '',
  alchemyKey: '',
  profitWallet: '',
  initialCapital: '1000',
  minProfitUSD: '5',
  maxSlippagePercent: '0.5',
  maxGasGwei: '100',
  network: 'polygon',
  autoStart: false,
};

export default function SettingsScreen() {
  const colors = useColors();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const stored = await AsyncStorage.getItem('botSettings');
      if (stored) {
        setSettings(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const saveSettings = async () => {
    try {
      // Validate settings
      if (!settings.privateKey.startsWith('0x') || settings.privateKey.length !== 66) {
        Alert.alert('Invalid Private Key', 'Private key must start with 0x and be 66 characters');
        return;
      }

      if (!settings.alchemyKey) {
        Alert.alert('Missing Alchemy Key', 'Please enter your Alchemy API key');
        return;
      }

      if (!settings.profitWallet.startsWith('0x') || settings.profitWallet.length !== 42) {
        Alert.alert('Invalid Profit Wallet', 'Wallet address must start with 0x and be 42 characters');
        return;
      }

      const capital = parseFloat(settings.initialCapital);
      if (isNaN(capital) || capital < 100) {
        Alert.alert('Invalid Capital', 'Minimum capital is $100');
        return;
      }

      setLoading(true);

      // Save to AsyncStorage
      await AsyncStorage.setItem('botSettings', JSON.stringify(settings));

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);

      Alert.alert('Success', 'Settings saved. You can now start the bot.');
    } catch (error) {
      Alert.alert('Error', `Failed to save settings: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const resetSettings = () => {
    Alert.alert('Reset Settings?', 'This will clear all saved credentials.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem('botSettings');
          setSettings(DEFAULT_SETTINGS);
          setSaved(false);
        },
      },
    ]);
  };

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} className="p-4">
        <View className="gap-6">
          {/* Header */}
          <View className="gap-2">
            <Text className="text-3xl font-bold text-foreground">Settings</Text>
            <Text className="text-sm text-muted">Configure your trading bot</Text>
          </View>

          {/* Network Selection */}
          <View className="gap-2">
            <Text className="text-lg font-semibold text-foreground">Network</Text>
            <View className="flex-row gap-2">
              {(['polygon', 'mumbai'] as const).map((net) => (
                <TouchableOpacity
                  key={net}
                  onPress={() => setSettings({ ...settings, network: net })}
                  className={`flex-1 p-3 rounded-lg border ${
                    settings.network === net
                      ? 'bg-primary border-primary'
                      : 'bg-surface border-border'
                  }`}
                >
                  <Text
                    className={`text-center font-semibold capitalize ${
                      settings.network === net ? 'text-background' : 'text-foreground'
                    }`}
                  >
                    {net}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text className="text-xs text-muted">
              {settings.network === 'polygon'
                ? '⚠️ MAINNET - Real money will be traded'
                : 'Testnet - Use for testing only'}
            </Text>
          </View>

          {/* Private Key */}
          <View className="gap-2">
            <Text className="text-lg font-semibold text-foreground">Private Key</Text>
            <View className="flex-row items-center bg-surface border border-border rounded-lg px-3">
              <TextInput
                value={settings.privateKey}
                onChangeText={(text) => setSettings({ ...settings, privateKey: text })}
                placeholder="0x..."
                placeholderTextColor={colors.muted}
                secureTextEntry={!showPrivateKey}
                className="flex-1 py-3 text-foreground"
              />
              <TouchableOpacity onPress={() => setShowPrivateKey(!showPrivateKey)}>
                <Text className="text-primary font-semibold">{showPrivateKey ? 'Hide' : 'Show'}</Text>
              </TouchableOpacity>
            </View>
            <Text className="text-xs text-muted">Your wallet's private key (starts with 0x)</Text>
          </View>

          {/* Alchemy Key */}
          <View className="gap-2">
            <Text className="text-lg font-semibold text-foreground">Alchemy API Key</Text>
            <TextInput
              value={settings.alchemyKey}
              onChangeText={(text) => setSettings({ ...settings, alchemyKey: text })}
              placeholder="alchemy_..."
              placeholderTextColor={colors.muted}
              className="bg-surface border border-border rounded-lg px-3 py-3 text-foreground"
            />
            <Text className="text-xs text-muted">Get from alchemy.com (free tier available)</Text>
          </View>

          {/* Profit Wallet */}
          <View className="gap-2">
            <Text className="text-lg font-semibold text-foreground">Profit Wallet</Text>
            <TextInput
              value={settings.profitWallet}
              onChangeText={(text) => setSettings({ ...settings, profitWallet: text })}
              placeholder="0x..."
              placeholderTextColor={colors.muted}
              className="bg-surface border border-border rounded-lg px-3 py-3 text-foreground"
            />
            <Text className="text-xs text-muted">Wallet to receive profits (can be same as above)</Text>
          </View>

          {/* Trading Parameters */}
          <View className="gap-3 bg-surface rounded-lg p-4 border border-border">
            <Text className="text-lg font-semibold text-foreground">Trading Parameters</Text>

            {/* Initial Capital */}
            <View className="gap-1">
              <Text className="text-sm text-foreground">Initial Capital (USD)</Text>
              <TextInput
                value={settings.initialCapital}
                onChangeText={(text) => setSettings({ ...settings, initialCapital: text })}
                placeholder="1000"
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                className="bg-background border border-border rounded-lg px-3 py-2 text-foreground"
              />
              <Text className="text-xs text-muted">Minimum: $100</Text>
            </View>

            {/* Min Profit */}
            <View className="gap-1">
              <Text className="text-sm text-foreground">Min Profit (USD)</Text>
              <TextInput
                value={settings.minProfitUSD}
                onChangeText={(text) => setSettings({ ...settings, minProfitUSD: text })}
                placeholder="5"
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                className="bg-background border border-border rounded-lg px-3 py-2 text-foreground"
              />
              <Text className="text-xs text-muted">Only execute if profit exceeds this</Text>
            </View>

            {/* Max Slippage */}
            <View className="gap-1">
              <Text className="text-sm text-foreground">Max Slippage (%)</Text>
              <TextInput
                value={settings.maxSlippagePercent}
                onChangeText={(text) => setSettings({ ...settings, maxSlippagePercent: text })}
                placeholder="0.5"
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                className="bg-background border border-border rounded-lg px-3 py-2 text-foreground"
              />
              <Text className="text-xs text-muted">Skip trades with higher slippage</Text>
            </View>

            {/* Max Gas */}
            <View className="gap-1">
              <Text className="text-sm text-foreground">Max Gas Price (GWEI)</Text>
              <TextInput
                value={settings.maxGasGwei}
                onChangeText={(text) => setSettings({ ...settings, maxGasGwei: text })}
                placeholder="100"
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                className="bg-background border border-border rounded-lg px-3 py-2 text-foreground"
              />
              <Text className="text-xs text-muted">Skip trades when gas is too expensive</Text>
            </View>
          </View>

          {/* Auto Start */}
          <View className="flex-row items-center justify-between bg-surface rounded-lg p-4 border border-border">
            <View>
              <Text className="text-lg font-semibold text-foreground">Auto Start</Text>
              <Text className="text-xs text-muted">Start bot when app launches</Text>
            </View>
            <Switch
              value={settings.autoStart}
              onValueChange={(value) => setSettings({ ...settings, autoStart: value })}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>

          {/* Action Buttons */}
          <View className="gap-2">
            <TouchableOpacity
              onPress={saveSettings}
              disabled={loading}
              className={`p-4 rounded-lg ${loading ? 'bg-border' : 'bg-primary'}`}
            >
              {loading ? (
                <ActivityIndicator color={colors.background} />
              ) : (
                <Text className="text-center text-lg font-bold text-background">
                  {saved ? '✓ Saved' : 'Save Settings'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={resetSettings}
              className="p-4 rounded-lg bg-error border border-error"
            >
              <Text className="text-center text-lg font-bold text-background">Reset All</Text>
            </TouchableOpacity>
          </View>

          {/* Warning */}
          <View className="bg-error/10 border border-error rounded-lg p-4">
            <Text className="text-sm font-semibold text-error mb-2">⚠️ WARNING</Text>
            <Text className="text-xs text-foreground leading-relaxed">
              {settings.network === 'polygon'
                ? 'You are about to trade with REAL MONEY on Polygon mainnet. Ensure your private key is correct and you understand the risks.'
                : 'You are using testnet. No real money will be traded.'}
            </Text>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
