import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Animated,
  Platform,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useBotContext } from "@/lib/bot-context";
import { IconSymbol } from "@/components/ui/icon-symbol";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

function StatCard({
  label,
  value,
  sub,
  color = "#E2E8F0",
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

function PulsingDot({ active }: { active: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, { toValue: 1.6, duration: 700, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 700, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 0, useNativeDriver: true }),
        ]),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [active]);

  const color = active ? "#00FF88" : "#4B5563";
  return (
    <View style={{ width: 14, height: 14, alignItems: "center", justifyContent: "center" }}>
      {active && (
        <Animated.View
          style={{
            position: "absolute",
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: "#00FF88",
            transform: [{ scale }],
            opacity,
          }}
        />
      )}
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
    </View>
  );
}

export default function DashboardScreen() {
  const { botState, opportunities, settings, startBot, stopBot, vpsConnected, vpsMode, scanError } = useBotContext();

  const safeOpps = opportunities.filter((o) => o.safe);
  const topProfit = safeOpps[0]?.netProfitUsd ?? 0;

  const handleToggle = async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    if (botState.running) stopBot();
    else await startBot();
  };

  const netPnl = botState.totalProfitUsd - botState.totalGasUsd;
  const pnlColor = netPnl >= 0 ? "#00FF88" : "#FF3B5C";

  const lastScanText = botState.lastScanAt
    ? `${Math.round((Date.now() - botState.lastScanAt) / 1000)}s ago`
    : "Never";

  const networkColor =
    botState.networkStatus === "connected"
      ? "#00FF88"
      : botState.networkStatus === "error"
      ? "#FF3B5C"
      : "#4B5563";

  const noApiKey = !settings.alchemyApiKey;

  return (
    <ScreenContainer containerClassName="bg-[#0A0E1A]">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>⚡ Elite MEV Bot</Text>
            <View style={styles.networkRow}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: networkColor, marginRight: 6 }} />
              <Text style={[styles.networkText, { color: networkColor }]}>
                {botState.networkStatus === "connected"
                  ? "Polygon Mainnet"
                  : botState.networkStatus === "error"
                  ? "Connection Error"
                  : "Disconnected"}
              </Text>
            </View>
          </View>
          <View style={styles.gasBadge}>
            <IconSymbol name="flame.fill" size={14} color="#FFB800" />
            <Text style={styles.gasText}>
              {botState.gasGwei > 0 ? `${botState.gasGwei.toFixed(0)} Gwei` : "-- Gwei"}
            </Text>
          </View>
        </View>

        {/* Scan Error Banner */}
        {scanError && (
          <View style={[styles.warningBanner, { backgroundColor: "#FF3B5C10", borderColor: "#FF3B5C40" }]}>
            <IconSymbol name="exclamationmark.triangle.fill" size={14} color="#FF3B5C" />
            <Text style={[styles.warningText, { color: "#FF3B5C" }]}>{scanError}</Text>
          </View>
        )}

        {/* VPS Mode Banner */}
        {vpsMode ? (
          <View style={[styles.warningBanner, { backgroundColor: "#00E5FF10", borderColor: "#00E5FF30" }]}>
            <IconSymbol name="server.rack" size={14} color="#00E5FF" />
            <Text style={[styles.warningText, { color: "#00E5FF" }]}>
              VPS Mode — Real-time WebSocket events (50–200ms)
            </Text>
          </View>
        ) : noApiKey ? (
          <View style={styles.warningBanner}>
            <IconSymbol name="exclamationmark.triangle.fill" size={16} color="#FFB800" />
            <Text style={styles.warningText}>
              Set your Alchemy API key in Settings to start scanning
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={() => router.push("/vps-connect" as any)}
            style={({ pressed }) => [styles.warningBanner, { backgroundColor: "#00E5FF08", borderColor: "#00E5FF25", opacity: pressed ? 0.7 : 1 }]}
          >
            <IconSymbol name="server.rack" size={14} color="#4B5563" />
            <Text style={[styles.warningText, { color: "#4B5563" }]}>
              Connect VPS for real-time scanning (50–200ms latency)
            </Text>
            <IconSymbol name="chevron.right" size={12} color="#4B5563" />
          </Pressable>
        )}

        {/* Start / Stop Button */}
        <Pressable
          onPress={handleToggle}
          style={({ pressed }) => [
            styles.startButton,
            botState.running ? styles.stopButton : styles.goButton,
            pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
          ]}
        >
          <PulsingDot active={botState.running} />
          <Text style={styles.startButtonText}>
            {botState.running ? "  STOP BOT" : "  START BOT"}
          </Text>
        </Pressable>

        {/* P&L Summary */}
        <View style={styles.pnlCard}>
          <Text style={styles.pnlLabel}>Total Net P&L</Text>
          <Text style={[styles.pnlValue, { color: pnlColor }]}>
            {netPnl >= 0 ? "+" : ""}${netPnl.toFixed(4)}
          </Text>
          <View style={styles.pnlRow}>
            <Text style={styles.pnlSub}>Profit: ${botState.totalProfitUsd.toFixed(4)}</Text>
            <Text style={[styles.pnlSub, { color: "#FF3B5C" }]}>
              Gas: -${botState.totalGasUsd.toFixed(4)}
            </Text>
          </View>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <StatCard
            label="Scans"
            value={botState.scanCount.toString()}
            sub={`Last: ${lastScanText}`}
            color="#00E5FF"
          />
          <StatCard
            label="Safe Opps"
            value={safeOpps.length.toString()}
            sub={`Best: $${topProfit.toFixed(2)}`}
            color="#00FF88"
          />
          <StatCard
            label="Executed"
            value={botState.successTrades.toString()}
            sub={`Failed: ${botState.failedTrades}`}
            color="#00FF88"
          />
          <StatCard
            label="MATIC Price"
            value={botState.maticPriceUsd > 0 ? `$${botState.maticPriceUsd.toFixed(3)}` : "--"}
            sub="Polygon"
            color="#E2E8F0"
          />
        </View>

        {/* Live Opportunities Preview */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Live Opportunities</Text>
          <Text style={styles.sectionSub}>{opportunities.length} found</Text>
        </View>

        {opportunities.length === 0 ? (
          <View style={styles.emptyCard}>
            <IconSymbol name="waveform" size={32} color="#4B5563" />
            <Text style={styles.emptyText}>
              {botState.running ? "Scanning for opportunities..." : "Start the bot to scan"}
            </Text>
          </View>
        ) : (
          opportunities.slice(0, 3).map((opp) => (
            <View
              key={opp.id}
              style={[styles.oppRow, !opp.safe && styles.oppRowUnsafe]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.oppPair}>
                  {opp.tokenInSymbol} → {opp.tokenOutSymbol}
                </Text>
                <Text style={styles.oppDex}>
                  {opp.buyDex} → {opp.sellDex}
                </Text>
                {opp.skipReason ? (
                  <Text style={styles.oppSkip}>{opp.skipReason}</Text>
                ) : null}
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text
                  style={[
                    styles.oppProfit,
                    { color: opp.safe ? "#00FF88" : "#FF3B5C" },
                  ]}
                >
                  {opp.netProfitUsd >= 0 ? "+" : ""}${opp.netProfitUsd.toFixed(3)}
                </Text>
                <Text style={styles.oppConf}>
                  {opp.priceDiffPct.toFixed(2)}% spread
                </Text>
                <View
                  style={[
                    styles.safeBadge,
                    { backgroundColor: opp.safe ? "#00FF8820" : "#FF3B5C20" },
                  ]}
                >
                  <Text
                    style={[
                      styles.safeBadgeText,
                      { color: opp.safe ? "#00FF88" : "#FF3B5C" },
                    ]}
                  >
                    {opp.safe ? "SAFE" : "SKIP"}
                  </Text>
                </View>
              </View>
            </View>
          ))
        )}

        {/* Auto-execute status */}
        <View style={styles.autoRow}>
          <IconSymbol
            name={settings.autoExecute ? "play.fill" : "pause.fill"}
            size={14}
            color={settings.autoExecute ? "#00FF88" : "#4B5563"}
          />
          <Text style={[styles.autoText, { color: settings.autoExecute ? "#00FF88" : "#4B5563" }]}>
            Auto-Execute: {settings.autoExecute ? "ON" : "OFF"}
          </Text>
          <Text style={styles.autoSub}>
            (configure in Settings)
          </Text>
        </View>
      </ScrollView>
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
  headerTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#E2E8F0",
    letterSpacing: 0.5,
  },
  networkRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  networkText: { fontSize: 12, fontWeight: "600" },
  gasBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E293B",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  gasText: { color: "#FFB800", fontSize: 12, fontWeight: "700" },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFB80015",
    borderColor: "#FFB80040",
    borderWidth: 1,
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    gap: 8,
  },
  warningText: { color: "#FFB800", fontSize: 12, flex: 1 },
  startButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 20,
    marginBottom: 20,
    paddingVertical: 16,
    borderRadius: 14,
  },
  goButton: { backgroundColor: "#00E5FF20", borderColor: "#00E5FF", borderWidth: 1.5 },
  stopButton: { backgroundColor: "#FF3B5C20", borderColor: "#FF3B5C", borderWidth: 1.5 },
  startButtonText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#E2E8F0",
    letterSpacing: 2,
  },
  pnlCard: {
    marginHorizontal: 20,
    backgroundColor: "#111827",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#1E293B",
    alignItems: "center",
  },
  pnlLabel: { color: "#6B7280", fontSize: 12, fontWeight: "600", letterSpacing: 1 },
  pnlValue: { fontSize: 36, fontWeight: "800", marginTop: 4 },
  pnlRow: { flexDirection: "row", gap: 16, marginTop: 8 },
  pnlSub: { color: "#6B7280", fontSize: 12 },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    minWidth: "44%",
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  statLabel: { color: "#6B7280", fontSize: 11, fontWeight: "600", letterSpacing: 0.5 },
  statValue: { fontSize: 22, fontWeight: "800", marginTop: 4 },
  statSub: { color: "#4B5563", fontSize: 11, marginTop: 2 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  sectionTitle: { color: "#E2E8F0", fontSize: 15, fontWeight: "700" },
  sectionSub: { color: "#4B5563", fontSize: 12 },
  emptyCard: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111827",
    marginHorizontal: 20,
    borderRadius: 14,
    padding: 32,
    borderWidth: 1,
    borderColor: "#1E293B",
    gap: 12,
  },
  emptyText: { color: "#4B5563", fontSize: 14, textAlign: "center" },
  oppRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111827",
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  oppRowUnsafe: { borderColor: "#FF3B5C30", backgroundColor: "#FF3B5C08" },
  oppPair: { color: "#E2E8F0", fontSize: 14, fontWeight: "700" },
  oppDex: { color: "#6B7280", fontSize: 11, marginTop: 2 },
  oppSkip: { color: "#FF3B5C", fontSize: 10, marginTop: 2 },
  oppProfit: { fontSize: 16, fontWeight: "800" },
  oppConf: { color: "#6B7280", fontSize: 11, marginTop: 2 },
  safeBadge: {
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  safeBadgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  autoRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    marginTop: 8,
    gap: 6,
  },
  autoText: { fontSize: 12, fontWeight: "700" },
  autoSub: { color: "#4B5563", fontSize: 11 },
});
