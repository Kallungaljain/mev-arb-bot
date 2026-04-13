import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  Platform,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useBotContext } from "@/lib/bot-context";
import { ArbOpportunity } from "@/lib/bot-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import * as Haptics from "expo-haptics";

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 70 ? "#00FF88" : value >= 40 ? "#FFB800" : "#FF3B5C";
  return (
    <View style={styles.confBarBg}>
      <View style={[styles.confBarFill, { width: `${value}%` as any, backgroundColor: color }]} />
    </View>
  );
}

function OppCard({ opp }: { opp: ArbOpportunity }) {
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded((v) => !v);
  };

  const profitColor = opp.safe ? "#00FF88" : "#FF3B5C";
  const age = Math.round((Date.now() - opp.timestamp) / 1000);

  return (
    <Pressable
      onPress={toggle}
      style={({ pressed }) => [
        styles.card,
        !opp.safe && styles.cardUnsafe,
        pressed && { opacity: 0.85 },
      ]}
    >
      {/* Top row */}
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <View style={styles.pairRow}>
            <Text style={styles.pairText}>
              {opp.tokenInSymbol} / {opp.tokenOutSymbol}
            </Text>
            <View style={[styles.badge, { backgroundColor: opp.safe ? "#00FF8820" : "#FF3B5C20" }]}>
              <Text style={[styles.badgeText, { color: profitColor }]}>
                {opp.safe ? "✓ SAFE" : "✗ SKIP"}
              </Text>
            </View>
          </View>
          <Text style={styles.dexText}>
            Buy: {opp.buyDex}  →  Sell: {opp.sellDex}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[styles.profitText, { color: profitColor }]}>
            {opp.netProfitUsd >= 0 ? "+" : ""}${opp.netProfitUsd.toFixed(4)}
          </Text>
          <Text style={styles.ageText}>{age}s ago</Text>
        </View>
      </View>

      {/* Confidence bar */}
      <View style={styles.confRow}>
        <Text style={styles.confLabel}>Confidence</Text>
        <ConfidenceBar value={opp.confidence} />
        <Text style={styles.confValue}>{opp.confidence}%</Text>
      </View>

      {/* Skip reason */}
      {opp.skipReason ? (
        <View style={styles.skipRow}>
          <IconSymbol name="exclamationmark.triangle.fill" size={12} color="#FFB800" />
          <Text style={styles.skipText}>{opp.skipReason}</Text>
        </View>
      ) : null}

      {/* Expanded details */}
      {expanded && (
        <View style={styles.details}>
          <View style={styles.detailGrid}>
            <DetailItem label="Price Spread" value={`${opp.priceDiffPct.toFixed(3)}%`} />
            <DetailItem label="Slippage" value={`${opp.slippagePct.toFixed(3)}%`} color={opp.slippagePct > 0.5 ? "#FF3B5C" : "#00FF88"} />
            <DetailItem label="Volatility" value={`${opp.volatilityPct.toFixed(1)}%`} color={opp.volatilityPct > 5 ? "#FF3B5C" : "#00FF88"} />
            <DetailItem label="Gas Cost" value={`$${opp.gasCostUsd.toFixed(4)}`} color="#FFB800" />
            <DetailItem label="Gross Profit" value={`$${opp.estimatedProfitUsd.toFixed(4)}`} />
            <DetailItem label="Pool Liquidity" value={`$${(opp.poolLiquidityUsd / 1000).toFixed(1)}K`} />
            <DetailItem label="Buy Price" value={opp.buyPrice.toFixed(6)} />
            <DetailItem label="Sell Price" value={opp.sellPrice.toFixed(6)} />
          </View>
        </View>
      )}

      <View style={styles.expandHint}>
        <IconSymbol
          name={expanded ? "arrow.up" : "arrow.down"}
          size={12}
          color="#4B5563"
        />
      </View>
    </Pressable>
  );
}

function DetailItem({ label, value, color = "#E2E8F0" }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.detailItem}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, { color }]}>{value}</Text>
    </View>
  );
}

type FilterType = "all" | "safe" | "skip";

export default function OpportunitiesScreen() {
  const { opportunities, botState, startBot, stopBot } = useBotContext();
  const [filter, setFilter] = useState<FilterType>("all");

  const filtered = opportunities.filter((o) => {
    if (filter === "safe") return o.safe;
    if (filter === "skip") return !o.safe;
    return true;
  });

  const safeCount = opportunities.filter((o) => o.safe).length;

  return (
    <ScreenContainer containerClassName="bg-[#0A0E1A]">
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Opportunities</Text>
          <Text style={styles.headerSub}>
            {safeCount} safe · {opportunities.length - safeCount} skipped
          </Text>
        </View>
        <Pressable
          onPress={() => {
            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            if (botState.running) stopBot(); else startBot();
          }}
          style={({ pressed }) => [
            styles.scanBtn,
            botState.running && styles.scanBtnActive,
            pressed && { opacity: 0.8 },
          ]}
        >
          <IconSymbol
            name={botState.running ? "stop.fill" : "play.fill"}
            size={14}
            color={botState.running ? "#FF3B5C" : "#00E5FF"}
          />
          <Text style={[styles.scanBtnText, { color: botState.running ? "#FF3B5C" : "#00E5FF" }]}>
            {botState.running ? "Stop" : "Scan"}
          </Text>
        </Pressable>
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {(["all", "safe", "skip"] as FilterType[]).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
          >
            <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
              {f.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <OppCard opp={item} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, paddingTop: 8 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <IconSymbol name="bolt.fill" size={40} color="#1E293B" />
            <Text style={styles.emptyTitle}>
              {botState.running ? "Scanning..." : "No opportunities"}
            </Text>
            <Text style={styles.emptyText}>
              {botState.running
                ? "Analyzing DEX pools on Polygon"
                : "Tap Scan to start monitoring"}
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
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#00E5FF40",
    backgroundColor: "#00E5FF10",
  },
  scanBtnActive: { borderColor: "#FF3B5C40", backgroundColor: "#FF3B5C10" },
  scanBtnText: { fontSize: 13, fontWeight: "700" },
  filterRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 8,
  },
  filterTab: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  filterTabActive: { backgroundColor: "#00E5FF20", borderColor: "#00E5FF" },
  filterTabText: { color: "#4B5563", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  filterTabTextActive: { color: "#00E5FF" },
  card: {
    backgroundColor: "#111827",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  cardUnsafe: { borderColor: "#FF3B5C30" },
  cardTop: { flexDirection: "row", alignItems: "flex-start" },
  pairRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  pairText: { color: "#E2E8F0", fontSize: 15, fontWeight: "800" },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  dexText: { color: "#6B7280", fontSize: 11 },
  profitText: { fontSize: 18, fontWeight: "800" },
  ageText: { color: "#4B5563", fontSize: 10, marginTop: 2 },
  confRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  confLabel: { color: "#4B5563", fontSize: 10, width: 70 },
  confBarBg: { flex: 1, height: 4, backgroundColor: "#1E293B", borderRadius: 2, overflow: "hidden" },
  confBarFill: { height: 4, borderRadius: 2 },
  confValue: { color: "#6B7280", fontSize: 10, width: 30, textAlign: "right" },
  skipRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  skipText: { color: "#FFB800", fontSize: 11, flex: 1 },
  details: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#1E293B",
  },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  detailItem: { width: "47%", backgroundColor: "#0A0E1A", borderRadius: 8, padding: 8 },
  detailLabel: { color: "#4B5563", fontSize: 10, marginBottom: 2 },
  detailValue: { color: "#E2E8F0", fontSize: 13, fontWeight: "700" },
  expandHint: { alignItems: "center", marginTop: 8 },
  empty: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { color: "#4B5563", fontSize: 18, fontWeight: "700" },
  emptyText: { color: "#374151", fontSize: 13, textAlign: "center" },
});
