import React from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useBotContext } from "@/lib/bot-context";
import { TradeRecord } from "@/lib/bot-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import * as Haptics from "expo-haptics";

function TradeCard({ trade }: { trade: TradeRecord }) {
  const isSuccess = trade.status === "success";
  const isFailed = trade.status === "failed";
  const isPending = trade.status === "pending";

  const statusColor = isSuccess ? "#00FF88" : isFailed ? "#FF3B5C" : "#FFB800";
  const statusLabel = isSuccess ? "SUCCESS" : isFailed ? "FAILED" : isPending ? "PENDING" : "SKIPPED";

  const date = new Date(trade.executedAt);
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });

  const shortHash = trade.txHash
    ? `${trade.txHash.slice(0, 8)}...${trade.txHash.slice(-6)}`
    : null;

  return (
    <View style={[styles.card, isFailed && styles.cardFailed]}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.pairText}>
            {trade.opportunity.tokenInSymbol} → {trade.opportunity.tokenOutSymbol}
          </Text>
          <Text style={styles.dexText}>
            {trade.opportunity.buyDex} → {trade.opportunity.sellDex}
          </Text>
          {shortHash && (
            <Text style={styles.hashText}>tx: {shortHash}</Text>
          )}
          {trade.errorMsg && (
            <Text style={styles.errorText}>{trade.errorMsg}</Text>
          )}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + "20" }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
          {isSuccess && trade.actualProfitUsd !== undefined && (
            <Text style={styles.profitText}>
              +${trade.actualProfitUsd.toFixed(4)}
            </Text>
          )}
          {trade.gasUsedUsd !== undefined && (
            <Text style={styles.gasText}>gas: ${trade.gasUsedUsd.toFixed(4)}</Text>
          )}
        </View>
      </View>
      <Text style={styles.timeText}>{dateStr} · {timeStr}</Text>
    </View>
  );
}

export default function HistoryScreen() {
  const { tradeHistory, botState, clearHistory } = useBotContext();

  const totalProfit = tradeHistory
    .filter((t) => t.status === "success")
    .reduce((sum, t) => sum + (t.actualProfitUsd ?? 0), 0);

  const totalGas = tradeHistory
    .filter((t) => t.gasUsedUsd !== undefined)
    .reduce((sum, t) => sum + (t.gasUsedUsd ?? 0), 0);

  const handleClear = () => {
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    Alert.alert(
      "Clear History",
      "This will permanently delete all trade records.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear", style: "destructive", onPress: clearHistory },
      ]
    );
  };

  return (
    <ScreenContainer containerClassName="bg-[#0A0E1A]">
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Trade History</Text>
          <Text style={styles.headerSub}>{tradeHistory.length} trades recorded</Text>
        </View>
        {tradeHistory.length > 0 && (
          <Pressable
            onPress={handleClear}
            style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.7 }]}
          >
            <IconSymbol name="trash.fill" size={14} color="#FF3B5C" />
          </Pressable>
        )}
      </View>

      {/* Summary */}
      {tradeHistory.length > 0 && (
        <View style={styles.summary}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Total Profit</Text>
            <Text style={[styles.summaryValue, { color: "#00FF88" }]}>
              +${totalProfit.toFixed(4)}
            </Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Gas Spent</Text>
            <Text style={[styles.summaryValue, { color: "#FF3B5C" }]}>
              -${totalGas.toFixed(4)}
            </Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Net P&L</Text>
            <Text
              style={[
                styles.summaryValue,
                { color: totalProfit - totalGas >= 0 ? "#00FF88" : "#FF3B5C" },
              ]}
            >
              {totalProfit - totalGas >= 0 ? "+" : ""}${(totalProfit - totalGas).toFixed(4)}
            </Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Win Rate</Text>
            <Text style={[styles.summaryValue, { color: "#00E5FF" }]}>
              {tradeHistory.length > 0
                ? `${Math.round((botState.successTrades / Math.max(1, botState.successTrades + botState.failedTrades)) * 100)}%`
                : "--"}
            </Text>
          </View>
        </View>
      )}

      <FlatList
        data={tradeHistory}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TradeCard trade={item} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, paddingTop: 8 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <IconSymbol name="clock.fill" size={40} color="#1E293B" />
            <Text style={styles.emptyTitle}>No trades yet</Text>
            <Text style={styles.emptyText}>
              Executed trades will appear here
            </Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTitle: { color: "#E2E8F0", fontSize: 22, fontWeight: "800" },
  headerSub: { color: "#6B7280", fontSize: 12, marginTop: 2 },
  clearBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FF3B5C15",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#FF3B5C30",
  },
  summary: {
    flexDirection: "row",
    backgroundColor: "#111827",
    marginHorizontal: 16,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryLabel: { color: "#4B5563", fontSize: 10, fontWeight: "600" },
  summaryValue: { fontSize: 13, fontWeight: "800", marginTop: 4 },
  summaryDivider: { width: 1, backgroundColor: "#1E293B", marginVertical: 4 },
  card: {
    backgroundColor: "#111827",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  cardFailed: { borderColor: "#FF3B5C30" },
  cardTop: { flexDirection: "row", alignItems: "flex-start" },
  pairText: { color: "#E2E8F0", fontSize: 14, fontWeight: "700" },
  dexText: { color: "#6B7280", fontSize: 11, marginTop: 2 },
  hashText: { color: "#4B5563", fontSize: 10, marginTop: 4, fontFamily: "SpaceMono" },
  errorText: { color: "#FF3B5C", fontSize: 10, marginTop: 4 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  profitText: { color: "#00FF88", fontSize: 15, fontWeight: "800", marginTop: 4 },
  gasText: { color: "#4B5563", fontSize: 10, marginTop: 2 },
  timeText: { color: "#374151", fontSize: 10, marginTop: 8 },
  empty: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { color: "#4B5563", fontSize: 18, fontWeight: "700" },
  emptyText: { color: "#374151", fontSize: 13 },
});
