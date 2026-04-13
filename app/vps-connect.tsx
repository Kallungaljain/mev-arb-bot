/**
 * VPS Connection Screen
 * Allows the user to configure and connect to their VPS scanner backend.
 */
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { vpsClient, VpsConfig } from "@/lib/vps-client";
import { useBotContext } from "@/lib/bot-context";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

export default function VpsConnectScreen() {
  const { vpsConnected, setVpsConnected } = useBotContext();
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedConfig, setSavedConfig] = useState<VpsConfig | null>(null);

  useEffect(() => {
    vpsClient.loadConfig().then((cfg) => {
      if (cfg) {
        setSavedConfig(cfg);
        setUrl(cfg.url);
        setSecret(cfg.apiSecret);
      }
    });
  }, []);

  const handleConnect = async () => {
    if (!url.trim()) { setError("Enter the VPS WebSocket URL"); return; }
    setError(null);
    setConnecting(true);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const config: VpsConfig = { url: url.trim(), apiSecret: secret.trim() };
    await vpsClient.saveConfig(config);

    // Attempt connection with a 6s timeout
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        setConnecting(false);
        setError("Connection timed out. Check your VPS URL and ensure the server is running.");
        vpsClient.disconnect();
      }
    }, 6000);

    const unsubConnected = vpsClient.on("connected", () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      setConnecting(false);
      setVpsConnected(true);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    });

    const unsubError = vpsClient.on("error", () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      setConnecting(false);
      setError("Connection failed. Check the URL and ensure the VPS server is running.");
    });

    vpsClient.connect(config);

    // Cleanup listeners after resolution
    setTimeout(() => { unsubConnected(); unsubError(); }, 8000);
  };

  const handleDisconnect = () => {
    vpsClient.disconnect();
    setVpsConnected(false);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <IconSymbol name="chevron.left" size={20} color="#00E5FF" />
          </Pressable>
          <View>
            <Text style={styles.headerTitle}>VPS Connection</Text>
            <Text style={styles.headerSub}>Connect to your server scanner</Text>
          </View>
        </View>

        {/* Status Banner */}
        <View style={[styles.statusBanner, vpsConnected ? styles.statusConnected : styles.statusDisconnected]}>
          <View style={[styles.statusDot, { backgroundColor: vpsConnected ? "#00FF88" : "#FF3B5C" }]} />
          <Text style={[styles.statusText, { color: vpsConnected ? "#00FF88" : "#FF3B5C" }]}>
            {vpsConnected ? "VPS Connected — Real-time mode active" : "VPS Disconnected — Using local scanner"}
          </Text>
        </View>

        {/* Why VPS card */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>⚡ Why connect a VPS?</Text>
          <View style={styles.infoRows}>
            <InfoRow icon="bolt.fill" label="Latency" before="15,000ms (polling)" after="50–200ms (WebSocket events)" />
            <InfoRow icon="server.rack" label="Uptime" before="App must be open" after="24/7 server process" />
            <InfoRow icon="waveform.path" label="Events" before="eth_call every 15s" after="Sync events on every swap" />
            <InfoRow icon="shield.fill" label="Execution" before="Phone signs tx" after="VPS signs & submits instantly" />
          </View>
        </View>

        {/* Connection Form */}
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>VPS WebSocket URL</Text>
          <Text style={styles.formHint}>
            Format: ws://YOUR_VPS_IP:3000/api/ws{"\n"}
            Example: ws://123.45.67.89:3000/api/ws
          </Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder="ws://123.45.67.89:3000/api/ws"
            placeholderTextColor="#374151"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="next"
          />

          <Text style={[styles.formTitle, { marginTop: 16 }]}>API Secret (optional)</Text>
          <Text style={styles.formHint}>
            Set BOT_API_SECRET on your VPS to protect the endpoint
          </Text>
          <View style={styles.secretRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={secret}
              onChangeText={setSecret}
              placeholder="leave blank if not set"
              placeholderTextColor="#374151"
              secureTextEntry={!showSecret}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
            />
            <Pressable onPress={() => setShowSecret((v) => !v)} style={styles.eyeBtn}>
              <IconSymbol name={showSecret ? "eye.slash.fill" : "eye.fill"} size={18} color="#6B7280" />
            </Pressable>
          </View>
        </View>

        {/* Error */}
        {error && (
          <View style={styles.errorBanner}>
            <IconSymbol name="exclamationmark.triangle.fill" size={14} color="#FF3B5C" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Connect / Disconnect Button */}
        {vpsConnected ? (
          <Pressable
            onPress={handleDisconnect}
            style={({ pressed }) => [styles.btn, styles.btnDisconnect, pressed && { opacity: 0.8 }]}
          >
            <IconSymbol name="wifi.slash" size={16} color="#FF3B5C" />
            <Text style={[styles.btnText, { color: "#FF3B5C" }]}>Disconnect VPS</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleConnect}
            style={({ pressed }) => [styles.btn, styles.btnConnect, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
            disabled={connecting}
          >
            {connecting ? (
              <ActivityIndicator color="#0A0E1A" size="small" />
            ) : (
              <IconSymbol name="wifi" size={16} color="#0A0E1A" />
            )}
            <Text style={styles.btnText}>
              {connecting ? "Connecting..." : "Connect to VPS"}
            </Text>
          </Pressable>
        )}

        {/* VPS Setup Guide */}
        <View style={styles.guideCard}>
          <Text style={styles.guideTitle}>📋 VPS Setup (one-time)</Text>
          <CodeBlock lines={[
            "# 1. SSH into your VPS",
            "ssh user@YOUR_VPS_IP",
            "",
            "# 2. Install Node.js 20+",
            "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -",
            "sudo apt-get install -y nodejs",
            "",
            "# 3. Clone and install",
            "git clone <your-repo> mev-bot && cd mev-bot",
            "npm install",
            "",
            "# 4. Set environment variables",
            "export ALCHEMY_API_KEY=your_key_here",
            "export BOT_API_SECRET=your_secret_here",
            "",
            "# 5. Start the server (keeps running)",
            "npx tsx server/_core/index.ts",
            "",
            "# Or use PM2 for auto-restart:",
            "npm install -g pm2",
            "pm2 start 'npx tsx server/_core/index.ts' --name mev-bot",
            "pm2 save && pm2 startup",
          ]} />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function InfoRow({ icon, label, before, after }: { icon: string; label: string; before: string; after: string }) {
  return (
    <View style={styles.infoRow}>
      <IconSymbol name={icon as any} size={14} color="#00E5FF" />
      <View style={{ flex: 1 }}>
        <Text style={styles.infoRowLabel}>{label}</Text>
        <Text style={styles.infoRowBefore}>{before}</Text>
        <Text style={styles.infoRowAfter}>→ {after}</Text>
      </View>
    </View>
  );
}

function CodeBlock({ lines }: { lines: string[] }) {
  return (
    <View style={styles.codeBlock}>
      {lines.map((line, i) => (
        <Text key={i} style={[styles.codeLine, line.startsWith("#") && styles.codeComment]}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  backBtn: { padding: 8 },
  headerTitle: { color: "#E2E8F0", fontSize: 20, fontWeight: "800" },
  headerSub: { color: "#6B7280", fontSize: 12, marginTop: 2 },
  statusBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 16, padding: 12,
    borderRadius: 10, borderWidth: 1,
  },
  statusConnected: { backgroundColor: "#00FF8810", borderColor: "#00FF8840" },
  statusDisconnected: { backgroundColor: "#FF3B5C10", borderColor: "#FF3B5C40" },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: "600", flex: 1 },
  infoCard: {
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: "#111827", borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: "#1E293B",
  },
  infoTitle: { color: "#E2E8F0", fontSize: 13, fontWeight: "700", marginBottom: 12 },
  infoRows: { gap: 12 },
  infoRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  infoRowLabel: { color: "#00E5FF", fontSize: 11, fontWeight: "700" },
  infoRowBefore: { color: "#6B7280", fontSize: 11, marginTop: 1 },
  infoRowAfter: { color: "#00FF88", fontSize: 11, marginTop: 1 },
  formCard: {
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: "#111827", borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: "#1E293B",
  },
  formTitle: { color: "#E2E8F0", fontSize: 13, fontWeight: "700", marginBottom: 4 },
  formHint: { color: "#4B5563", fontSize: 11, marginBottom: 10, lineHeight: 16 },
  input: {
    backgroundColor: "#0A0E1A", borderWidth: 1, borderColor: "#1E293B",
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: "#E2E8F0", fontSize: 13,
  },
  secretRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  eyeBtn: { padding: 10 },
  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 12, padding: 12,
    backgroundColor: "#FF3B5C10", borderColor: "#FF3B5C40",
    borderWidth: 1, borderRadius: 10,
  },
  errorText: { color: "#FF3B5C", fontSize: 12, flex: 1 },
  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, marginHorizontal: 16, paddingVertical: 16,
    borderRadius: 14, marginBottom: 16,
  },
  btnConnect: { backgroundColor: "#00E5FF" },
  btnDisconnect: { backgroundColor: "#FF3B5C15", borderWidth: 1, borderColor: "#FF3B5C40" },
  btnText: { color: "#0A0E1A", fontSize: 15, fontWeight: "800" },
  guideCard: {
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: "#111827", borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: "#1E293B",
  },
  guideTitle: { color: "#E2E8F0", fontSize: 13, fontWeight: "700", marginBottom: 12 },
  codeBlock: { backgroundColor: "#0A0E1A", borderRadius: 10, padding: 12, gap: 2 },
  codeLine: { color: "#E2E8F0", fontSize: 11, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", lineHeight: 18 },
  codeComment: { color: "#4B5563" },
});
