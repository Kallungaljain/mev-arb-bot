import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  Pressable,
  Switch,
  Platform,
  ActivityIndicator,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useBotContext } from "@/lib/bot-context";
import { IconSymbol } from "@/components/ui/icon-symbol";
import * as Haptics from "expo-haptics";
import { validateAlchemyKey } from "@/lib/alchemy";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function FieldRow({
  label,
  hint,
  value,
  onChangeText,
  placeholder,
  secure,
  numeric,
  unit,
}: {
  label: string;
  hint?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
  numeric?: boolean;
  unit?: string;
}) {
  const [hidden, setHidden] = useState(secure ?? false);

  return (
    <View style={styles.fieldRow}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {secure && (
          <Pressable onPress={() => setHidden((v) => !v)}>
            <IconSymbol
              name={hidden ? "eye.slash.fill" : "eye.fill"}
              size={14}
              color="#4B5563"
            />
          </Pressable>
        )}
      </View>
      {hint && <Text style={styles.fieldHint}>{hint}</Text>}
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, unit ? { flex: 1 } : {}]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#374151"
          secureTextEntry={hidden}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={numeric ? "decimal-pad" : "default"}
          returnKeyType="done"
        />
        {unit && <Text style={styles.unitText}>{unit}</Text>}
      </View>
    </View>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onToggle,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {hint && <Text style={styles.fieldHint}>{hint}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onToggle(v);
        }}
        trackColor={{ false: "#1E293B", true: "#00E5FF40" }}
        thumbColor={value ? "#00E5FF" : "#4B5563"}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const { settings, updateSettings, botState } = useBotContext();

  const [apiKey, setApiKey] = useState(settings.alchemyApiKey);
  const [privateKey, setPrivateKey] = useState(settings.privateKey);
  const [profitWallet, setProfitWallet] = useState(settings.profitWallet);
  const [minProfit, setMinProfit] = useState(settings.minProfitUsd.toString());
  const [maxSlippage, setMaxSlippage] = useState(settings.maxSlippagePct.toString());
  const [maxVolatility, setMaxVolatility] = useState(settings.maxVolatilityPct.toString());
  const [maxGas, setMaxGas] = useState(settings.maxGasGwei.toString());
  const [tradeAmount, setTradeAmount] = useState(settings.tradeAmountMatic.toString());
  const [autoExecute, setAutoExecute] = useState(settings.autoExecute);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleTestKey = async () => {
    if (!apiKey.trim()) { setTestResult({ ok: false, msg: "Enter an API key first" }); return; }
    setTesting(true);
    setTestResult(null);
    const result = await validateAlchemyKey(apiKey.trim());
    setTesting(false);
    setTestResult(result.valid
      ? { ok: true, msg: "Connected to Polygon Mainnet ✓" }
      : { ok: false, msg: result.error ?? "Invalid key" }
    );
  };

  const handleSave = async () => {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await updateSettings({
      alchemyApiKey: apiKey.trim(),
      privateKey: privateKey.trim(),
      profitWallet: profitWallet.trim(),
      minProfitUsd: parseFloat(minProfit) || 2,
      maxSlippagePct: parseFloat(maxSlippage) || 0.5,
      maxVolatilityPct: parseFloat(maxVolatility) || 5,
      maxGasGwei: parseFloat(maxGas) || 200,
      tradeAmountMatic: parseFloat(tradeAmount) || 1000,
      autoExecute,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <ScreenContainer containerClassName="bg-[#0A0E1A]">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Settings</Text>
          <Text style={styles.headerSub}>Bot configuration & risk parameters</Text>
        </View>

        {/* Bot running warning */}
        {botState.running && (
          <View style={styles.warningBanner}>
            <IconSymbol name="exclamationmark.triangle.fill" size={14} color="#FFB800" />
            <Text style={styles.warningText}>
              Stop the bot before changing settings
            </Text>
          </View>
        )}

        {/* Network */}
        <Section title="🔌 Network">
          <FieldRow
            label="Alchemy API Key"
            hint="Get a free key at alchemy.com → Apps → Create App → Polygon Mainnet"
            value={apiKey}
            onChangeText={(v) => { setApiKey(v); setTestResult(null); }}
            placeholder="your-alchemy-api-key"
            secure
          />
          <Pressable
            onPress={handleTestKey}
            style={({ pressed }) => [styles.testBtn, pressed && { opacity: 0.8 }]}
            disabled={testing}
          >
            {testing
              ? <ActivityIndicator size="small" color="#00E5FF" />
              : <IconSymbol name="antenna.radiowaves.left.and.right" size={14} color="#00E5FF" />
            }
            <Text style={styles.testBtnText}>{testing ? "Testing..." : "Test Connection"}</Text>
          </Pressable>
          {testResult && (
            <View style={[styles.testResult, testResult.ok ? styles.testOk : styles.testFail]}>
              <Text style={[styles.testResultText, { color: testResult.ok ? "#00FF88" : "#FF3B5C" }]}>
                {testResult.msg}
              </Text>
            </View>
          )}
        </Section>

        {/* Wallet */}
        <Section title="🔑 Wallet">
          <FieldRow
            label="Deployer Private Key"
            hint="Used to sign and broadcast transactions. Never share this."
            value={privateKey}
            onChangeText={setPrivateKey}
            placeholder="0x..."
            secure
          />
          <View style={styles.divider} />
          <FieldRow
            label="Profit Wallet Address"
            hint="Where profits are sent after each successful trade"
            value={profitWallet}
            onChangeText={setProfitWallet}
            placeholder="0x... (your MetaMask)"
          />
        </Section>

        {/* Risk Engine */}
        <Section title="🛡️ Risk Engine">
          <FieldRow
            label="Minimum Net Profit"
            hint="Skip trade if net profit (after gas) is below this"
            value={minProfit}
            onChangeText={setMinProfit}
            placeholder="2.00"
            numeric
            unit="USD"
          />
          <View style={styles.divider} />
          <FieldRow
            label="Max Slippage"
            hint="Skip if estimated price impact exceeds this %"
            value={maxSlippage}
            onChangeText={setMaxSlippage}
            placeholder="0.5"
            numeric
            unit="%"
          />
          <View style={styles.divider} />
          <FieldRow
            label="Max Token Volatility"
            hint="Skip if 24h price change exceeds this % (avoids volatile tokens)"
            value={maxVolatility}
            onChangeText={setMaxVolatility}
            placeholder="5.0"
            numeric
            unit="%"
          />
          <View style={styles.divider} />
          <FieldRow
            label="Max Gas Price"
            hint="Skip all trades if network gas exceeds this"
            value={maxGas}
            onChangeText={setMaxGas}
            placeholder="200"
            numeric
            unit="Gwei"
          />
        </Section>

        {/* Trade Size */}
        <Section title="💰 Trade Size">
          <FieldRow
            label="Flash Loan Amount"
            hint="Amount to borrow per trade. Larger = more profit but more slippage"
            value={tradeAmount}
            onChangeText={setTradeAmount}
            placeholder="1000"
            numeric
            unit="MATIC"
          />
        </Section>

        {/* Automation */}
        <Section title="⚡ Automation">
          <ToggleRow
            label="Auto-Execute Trades"
            hint="Automatically execute safe opportunities without manual approval. Requires private key."
            value={autoExecute}
            onToggle={setAutoExecute}
          />
        </Section>

        {/* Risk Summary */}
        <View style={styles.riskCard}>
          <Text style={styles.riskTitle}>Risk Profile Summary</Text>
          <View style={styles.riskGrid}>
            <RiskItem label="Min Profit" value={`$${minProfit || "0"}`} color="#00FF88" />
            <RiskItem label="Max Slippage" value={`${maxSlippage || "0"}%`} color="#FFB800" />
            <RiskItem label="Max Volatility" value={`${maxVolatility || "0"}%`} color="#FFB800" />
            <RiskItem label="Gas Limit" value={`${maxGas || "0"} Gwei`} color="#FF3B5C" />
          </View>
        </View>

        {/* Save Button */}
        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [
            styles.saveBtn,
            saved && styles.saveBtnDone,
            pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
          ]}
        >
          <IconSymbol
            name={saved ? "checkmark" : "lock.fill"}
            size={16}
            color={saved ? "#0A0E1A" : "#0A0E1A"}
          />
          <Text style={styles.saveBtnText}>
            {saved ? "Saved!" : "Save Settings"}
          </Text>
        </Pressable>

        {/* Security note */}
        <View style={styles.securityNote}>
          <IconSymbol name="shield.fill" size={14} color="#4B5563" />
          <Text style={styles.securityText}>
            Private keys are stored encrypted in your device's secure storage. They are never transmitted to any server.
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function RiskItem({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.riskItem}>
      <Text style={styles.riskLabel}>{label}</Text>
      <Text style={[styles.riskValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  headerTitle: { color: "#E2E8F0", fontSize: 22, fontWeight: "800" },
  headerSub: { color: "#6B7280", fontSize: 12, marginTop: 2 },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFB80015",
    borderColor: "#FFB80040",
    borderWidth: 1,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    gap: 8,
  },
  warningText: { color: "#FFB800", fontSize: 12, flex: 1 },
  section: { marginHorizontal: 16, marginBottom: 20 },
  sectionTitle: {
    color: "#6B7280",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 8,
    paddingLeft: 2,
  },
  sectionCard: {
    backgroundColor: "#111827",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  fieldRow: { marginBottom: 4 },
  fieldLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  fieldLabel: { color: "#E2E8F0", fontSize: 13, fontWeight: "600" },
  fieldHint: { color: "#4B5563", fontSize: 11, marginBottom: 8, lineHeight: 16 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    backgroundColor: "#0A0E1A",
    borderWidth: 1,
    borderColor: "#1E293B",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#E2E8F0",
    fontSize: 13,
    flex: 1,
  },
  unitText: { color: "#6B7280", fontSize: 13, fontWeight: "600", minWidth: 40 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  divider: { height: 1, backgroundColor: "#1E293B", marginVertical: 14 },
  riskCard: {
    marginHorizontal: 16,
    backgroundColor: "#111827",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1E293B",
    marginBottom: 20,
  },
  riskTitle: { color: "#6B7280", fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 12 },
  riskGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  riskItem: {
    flex: 1,
    minWidth: "44%",
    backgroundColor: "#0A0E1A",
    borderRadius: 10,
    padding: 10,
    alignItems: "center",
  },
  riskLabel: { color: "#4B5563", fontSize: 10 },
  riskValue: { fontSize: 15, fontWeight: "800", marginTop: 4 },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: "#00E5FF",
    marginBottom: 16,
  },
  saveBtnDone: { backgroundColor: "#00FF88" },
  saveBtnText: { color: "#0A0E1A", fontSize: 15, fontWeight: "800" },
  securityNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  securityText: { color: "#374151", fontSize: 11, flex: 1, lineHeight: 16 },
  testBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 10, paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 8, borderWidth: 1, borderColor: "#00E5FF30",
    backgroundColor: "#00E5FF08", alignSelf: "flex-start",
  },
  testBtnText: { color: "#00E5FF", fontSize: 12, fontWeight: "600" },
  testResult: {
    marginTop: 8, padding: 10, borderRadius: 8, borderWidth: 1,
  },
  testOk: { backgroundColor: "#00FF8810", borderColor: "#00FF8840" },
  testFail: { backgroundColor: "#FF3B5C10", borderColor: "#FF3B5C40" },
  testResultText: { fontSize: 12, fontWeight: "600" },
});
