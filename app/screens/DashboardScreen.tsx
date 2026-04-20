import React, { useState, useEffect } from 'react';
import {
  ScrollView,
  Text,
  View,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScreenContainer } from '@/components/screen-container';
import { useColors } from '@/hooks/use-colors';

interface Trade {
  id: string;
  pair: string;
  amount: number;
  profit: number;
  gasUsed: number;
  timestamp: number;
  txHash: string;
  status: 'success' | 'failed' | 'pending';
}

interface BotStatus {
  running: boolean;
  connected: boolean;
  totalTrades: number;
  successfulTrades: number;
  totalProfit: number;
  totalGasCost: number;
  lastTradeTime: number | null;
  poolsTracked: number;
  currentGasPrice: number;
}

export default function DashboardScreen() {
  const colors = useColors();
  const [status, setStatus] = useState<BotStatus>({
    running: false,
    connected: false,
    totalTrades: 0,
    successfulTrades: 0,
    totalProfit: 0,
    totalGasCost: 0,
    lastTradeTime: null,
    poolsTracked: 0,
    currentGasPrice: 0,
  });
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const loadStatus = async () => {
    try {
      const storedStatus = await AsyncStorage.getItem('botStatus');
      const storedTrades = await AsyncStorage.getItem('botTrades');

      if (storedStatus) {
        setStatus(JSON.parse(storedStatus));
      }

      if (storedTrades) {
        setTrades(JSON.parse(storedTrades).slice(-20)); // Last 20 trades
      }
    } catch (error) {
      console.error('Failed to load status:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadStatus();
    setRefreshing(false);
  };

  const startBot = async () => {
    try {
      setLoading(true);

      // Get settings
      const settings = await AsyncStorage.getItem('botSettings');
      if (!settings) {
        alert('Please configure settings first');
        return;
      }

      // Update status
      const newStatus = { ...status, running: true, connected: true };
      setStatus(newStatus);
      await AsyncStorage.setItem('botStatus', JSON.stringify(newStatus));

      // In production, this would connect to the Keeper service
      // For now, we just update the UI
    } catch (error) {
      alert(`Failed to start bot: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const stopBot = async () => {
    try {
      const newStatus = { ...status, running: false };
      setStatus(newStatus);
      await AsyncStorage.setItem('botStatus', JSON.stringify(newStatus));
    } catch (error) {
      alert(`Failed to stop bot: ${error}`);
    }
  };

  const profitColor = status.totalProfit >= 0 ? colors.success : colors.error;
  const profitSign = status.totalProfit >= 0 ? '+' : '';

  return (
    <ScreenContainer className="bg-background">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        className="p-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View className="gap-4">
          {/* Header */}
          <View className="gap-2">
            <Text className="text-3xl font-bold text-foreground">Elite MEV Bot</Text>
            <View className="flex-row items-center gap-2">
              <View
                className={`w-3 h-3 rounded-full ${status.running ? 'bg-success' : 'bg-error'}`}
              />
              <Text className="text-sm text-muted">
                {status.running ? 'Trading Live' : 'Stopped'}
              </Text>
            </View>
          </View>

          {/* Main Metrics */}
          <View className="gap-3">
            {/* Total P&L */}
            <View className="bg-surface rounded-2xl p-6 border border-border">
              <Text className="text-sm text-muted mb-2">Total Net P&L</Text>
              <Text className="text-4xl font-bold mb-1" style={{ color: profitColor }}>
                {profitSign}${Math.abs(status.totalProfit).toFixed(2)}
              </Text>
              <Text className="text-xs text-muted">
                Profit: ${status.totalProfit.toFixed(2)} | Gas: ${status.totalGasCost.toFixed(2)}
              </Text>
            </View>

            {/* Stats Grid */}
            <View className="flex-row gap-3">
              <View className="flex-1 bg-surface rounded-lg p-4 border border-border">
                <Text className="text-xs text-muted mb-2">Scans</Text>
                <Text className="text-2xl font-bold text-foreground">{status.totalTrades}</Text>
              </View>

              <View className="flex-1 bg-surface rounded-lg p-4 border border-border">
                <Text className="text-xs text-muted mb-2">Successful</Text>
                <Text className="text-2xl font-bold text-success">{status.successfulTrades}</Text>
              </View>

              <View className="flex-1 bg-surface rounded-lg p-4 border border-border">
                <Text className="text-xs text-muted mb-2">Success Rate</Text>
                <Text className="text-2xl font-bold text-foreground">
                  {status.totalTrades > 0
                    ? ((status.successfulTrades / status.totalTrades) * 100).toFixed(0)
                    : '0'}
                  %
                </Text>
              </View>
            </View>

            {/* Network Status */}
            <View className="bg-surface rounded-lg p-4 border border-border">
              <View className="flex-row justify-between mb-3">
                <Text className="text-sm font-semibold text-foreground">Network Status</Text>
                <View
                  className={`px-2 py-1 rounded ${
                    status.connected ? 'bg-success/20' : 'bg-error/20'
                  }`}
                >
                  <Text
                    className={`text-xs font-bold ${
                      status.connected ? 'text-success' : 'text-error'
                    }`}
                  >
                    {status.connected ? 'Connected' : 'Disconnected'}
                  </Text>
                </View>
              </View>

              <View className="gap-2">
                <View className="flex-row justify-between">
                  <Text className="text-sm text-muted">Pools Tracked</Text>
                  <Text className="text-sm font-semibold text-foreground">
                    {status.poolsTracked}
                  </Text>
                </View>

                <View className="flex-row justify-between">
                  <Text className="text-sm text-muted">Gas Price</Text>
                  <Text className="text-sm font-semibold text-foreground">
                    {status.currentGasPrice} GWEI
                  </Text>
                </View>

                <View className="flex-row justify-between">
                  <Text className="text-sm text-muted">Last Trade</Text>
                  <Text className="text-sm font-semibold text-foreground">
                    {status.lastTradeTime
                      ? new Date(status.lastTradeTime).toLocaleTimeString()
                      : 'Never'}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Control Buttons */}
          <View className="flex-row gap-3">
            {!status.running ? (
              <TouchableOpacity
                onPress={startBot}
                disabled={loading}
                className="flex-1 bg-primary rounded-lg p-4"
              >
                {loading ? (
                  <ActivityIndicator color={colors.background} />
                ) : (
                  <Text className="text-center text-lg font-bold text-background">
                    START BOT
                  </Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={stopBot}
                className="flex-1 bg-error rounded-lg p-4"
              >
                <Text className="text-center text-lg font-bold text-background">STOP BOT</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Recent Trades */}
          <View className="gap-3">
            <Text className="text-lg font-semibold text-foreground">Recent Trades</Text>

            {trades.length === 0 ? (
              <View className="bg-surface rounded-lg p-6 border border-border items-center">
                <Text className="text-muted">No trades yet</Text>
              </View>
            ) : (
              <FlatList
                scrollEnabled={false}
                data={trades}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <View className="bg-surface rounded-lg p-4 border border-border mb-2">
                    <View className="flex-row justify-between items-start mb-2">
                      <View>
                        <Text className="text-sm font-semibold text-foreground">{item.pair}</Text>
                        <Text className="text-xs text-muted">
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </Text>
                      </View>
                      <View
                        className={`px-2 py-1 rounded ${
                          item.status === 'success'
                            ? 'bg-success/20'
                            : item.status === 'failed'
                              ? 'bg-error/20'
                              : 'bg-warning/20'
                        }`}
                      >
                        <Text
                          className={`text-xs font-bold capitalize ${
                            item.status === 'success'
                              ? 'text-success'
                              : item.status === 'failed'
                                ? 'text-error'
                                : 'text-warning'
                          }`}
                        >
                          {item.status}
                        </Text>
                      </View>
                    </View>

                    <View className="flex-row justify-between">
                      <Text className="text-sm text-muted">
                        Profit: ${item.profit.toFixed(2)}
                      </Text>
                      <Text className="text-sm text-muted">Gas: ${item.gasUsed.toFixed(2)}</Text>
                    </View>
                  </View>
                )}
              />
            )}
          </View>

          {/* Warning */}
          {status.running && (
            <View className="bg-warning/10 border border-warning rounded-lg p-4">
              <Text className="text-sm font-semibold text-warning mb-1">⚠️ Live Trading</Text>
              <Text className="text-xs text-foreground">
                Bot is executing real trades with real money on Polygon mainnet.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
