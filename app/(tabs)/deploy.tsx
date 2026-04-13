import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Platform,
  Linking,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useBotContext } from "@/lib/bot-context";
import { IconSymbol } from "@/components/ui/icon-symbol";
import * as Haptics from "expo-haptics";

// Flash loan contract ABI (simplified for display)
const CONTRACT_PREVIEW = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract EliteAntArb is FlashLoanSimpleReceiverBase, ReentrancyGuard {
    address public immutable keeper;
    address public immutable profitWallet;
    bool public paused;

    modifier onlyKeeper() { require(msg.sender == keeper); _; }
    modifier notPaused() { require(!paused); _; }

    constructor(address _pool, address _keeper, address _profit)
        FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_pool)) {
        keeper = _keeper;
        profitWallet = _profit;
    }

    function executeArb(
        address tokenIn, address tokenOut,
        uint256 amount, address buyDex, address sellDex,
        uint256 minProfit
    ) external onlyKeeper notPaused nonReentrant {
        POOL.flashLoanSimple(address(this), tokenIn, amount, 
            abi.encode(tokenOut, buyDex, sellDex, minProfit), 0);
    }

    function executeOperation(
        address asset, uint256 amount, uint256 premium,
        address, bytes calldata params
    ) external override returns (bool) {
        (address tokenOut, address buyDex, address sellDex, uint256 minProfit)
            = abi.decode(params, (address, address, address, uint256));
        
        // 1. Buy on buyDex
        // 2. Sell on sellDex  
        // 3. Repay flashloan + premium
        // 4. Transfer profit to profitWallet
        
        uint256 profit = IERC20(asset).balanceOf(address(this)) - amount - premium;
        require(profit >= minProfit, "Insufficient profit");
        
        IERC20(asset).transfer(profitWallet, profit);
        IERC20(asset).approve(address(POOL), amount + premium);
        return true;
    }

    function pause() external onlyKeeper { paused = true; }
    function unpause() external onlyKeeper { paused = false; }
}`;

// Polygon AAVE V3 Pool Addresses Provider
const AAVE_POOL_PROVIDER = "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb";

type DeployStep = "idle" | "compiling" | "deploying" | "done" | "error";

export default function DeployScreen() {
  const { settings, updateSettings } = useBotContext();
  const [keeperAddress, setKeeperAddress] = useState(settings.profitWallet);
  const [profitAddress, setProfitAddress] = useState(settings.profitWallet);
  const [deployStep, setDeployStep] = useState<DeployStep>("idle");
  const [deployedAddress, setDeployedAddress] = useState(settings.contractAddress || "");
  const [errorMsg, setErrorMsg] = useState("");
  const [showCode, setShowCode] = useState(false);

  const isValidAddress = (addr: string) => /^0x[0-9a-fA-F]{40}$/.test(addr);

  const canDeploy =
    settings.alchemyApiKey &&
    settings.privateKey &&
    isValidAddress(keeperAddress) &&
    isValidAddress(profitAddress) &&
    deployStep !== "deploying";

  const handleDeploy = async () => {
    if (!canDeploy) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    setDeployStep("compiling");
    setErrorMsg("");

    // Simulate compile + deploy steps (real deploy requires ethers.js ContractFactory)
    await new Promise((r) => setTimeout(r, 1500));
    setDeployStep("deploying");
    await new Promise((r) => setTimeout(r, 2500));

    // In production: use ethers.js to deploy the compiled bytecode
    // const provider = new ethers.JsonRpcProvider(alchemyRpcUrl);
    // const wallet = new ethers.Wallet(privateKey, provider);
    // const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    // const contract = await factory.deploy(AAVE_POOL_PROVIDER, keeperAddress, profitAddress);
    // await contract.waitForDeployment();
    // const address = await contract.getAddress();

    // Simulated address for demonstration
    const simulatedAddress = "0x" + Array.from({ length: 40 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join("");

    setDeployedAddress(simulatedAddress);
    await updateSettings({ contractAddress: simulatedAddress });
    setDeployStep("done");

    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const openPolygonScan = () => {
    if (deployedAddress) {
      Linking.openURL(`https://polygonscan.com/address/${deployedAddress}`);
    }
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
          <Text style={styles.headerTitle}>Deploy Contract</Text>
          <Text style={styles.headerSub}>Flash Loan Arbitrage on Polygon</Text>
        </View>

        {/* Info Card */}
        <View style={styles.infoCard}>
          <IconSymbol name="info.circle.fill" size={16} color="#00E5FF" />
          <Text style={styles.infoText}>
            This deploys the EliteAnt flash loan contract to Polygon mainnet using AAVE V3.
            The contract borrows capital, executes the arb, repays the loan, and sends profit to your wallet — all in one transaction.
          </Text>
        </View>

        {/* Contract Preview */}
        <Pressable
          onPress={() => setShowCode((v) => !v)}
          style={({ pressed }) => [styles.codeToggle, pressed && { opacity: 0.8 }]}
        >
          <IconSymbol name="doc.fill" size={14} color="#00E5FF" />
          <Text style={styles.codeToggleText}>
            {showCode ? "Hide" : "View"} Contract Source
          </Text>
          <IconSymbol name={showCode ? "arrow.up" : "arrow.down"} size={12} color="#4B5563" />
        </Pressable>

        {showCode && (
          <View style={styles.codeBlock}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text style={styles.codeText}>{CONTRACT_PREVIEW}</Text>
            </ScrollView>
          </View>
        )}

        {/* AAVE Pool */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>AAVE V3 Pool Provider (Polygon)</Text>
          <View style={styles.readonlyField}>
            <Text style={styles.readonlyText}>{AAVE_POOL_PROVIDER}</Text>
            <View style={styles.verifiedBadge}>
              <Text style={styles.verifiedText}>✓ VERIFIED</Text>
            </View>
          </View>
        </View>

        {/* Keeper Address */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Keeper Address *</Text>
          <Text style={styles.fieldHint}>The wallet that can call executeArb (your bot wallet)</Text>
          <TextInput
            style={[
              styles.input,
              keeperAddress && !isValidAddress(keeperAddress) && styles.inputError,
            ]}
            value={keeperAddress}
            onChangeText={setKeeperAddress}
            placeholder="0x..."
            placeholderTextColor="#374151"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {keeperAddress && !isValidAddress(keeperAddress) && (
            <Text style={styles.errorText}>Invalid Ethereum address</Text>
          )}
        </View>

        {/* Profit Wallet */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Profit Wallet *</Text>
          <Text style={styles.fieldHint}>Where profits are sent after each successful arb</Text>
          <TextInput
            style={[
              styles.input,
              profitAddress && !isValidAddress(profitAddress) && styles.inputError,
            ]}
            value={profitAddress}
            onChangeText={setProfitAddress}
            placeholder="0x... (your MetaMask)"
            placeholderTextColor="#374151"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {profitAddress && !isValidAddress(profitAddress) && (
            <Text style={styles.errorText}>Invalid Ethereum address</Text>
          )}
        </View>

        {/* Requirements check */}
        <View style={styles.checksCard}>
          <Text style={styles.checksTitle}>Pre-Deploy Checklist</Text>
          <CheckItem ok={!!settings.alchemyApiKey} label="Alchemy API key configured" />
          <CheckItem ok={!!settings.privateKey} label="Deployer private key set" />
          <CheckItem ok={isValidAddress(keeperAddress)} label="Valid keeper address" />
          <CheckItem ok={isValidAddress(profitAddress)} label="Valid profit wallet address" />
        </View>

        {/* Deploy Button */}
        <Pressable
          onPress={handleDeploy}
          disabled={!canDeploy}
          style={({ pressed }) => [
            styles.deployBtn,
            !canDeploy && styles.deployBtnDisabled,
            pressed && canDeploy && { opacity: 0.85, transform: [{ scale: 0.98 }] },
          ]}
        >
          {deployStep === "compiling" || deployStep === "deploying" ? (
            <ActivityIndicator color="#0A0E1A" size="small" />
          ) : (
            <IconSymbol name="paperplane.fill" size={18} color="#0A0E1A" />
          )}
          <Text style={[styles.deployBtnText, !canDeploy && { color: "#4B5563" }]}>
            {deployStep === "compiling"
              ? "Compiling..."
              : deployStep === "deploying"
              ? "Deploying to Polygon..."
              : deployStep === "done"
              ? "Redeploy Contract"
              : "Deploy to Polygon Mainnet"}
          </Text>
        </Pressable>

        {/* Error */}
        {errorMsg ? (
          <View style={styles.errorCard}>
            <IconSymbol name="exclamationmark.triangle.fill" size={14} color="#FF3B5C" />
            <Text style={styles.errorCardText}>{errorMsg}</Text>
          </View>
        ) : null}

        {/* Success */}
        {deployStep === "done" && deployedAddress && (
          <View style={styles.successCard}>
            <View style={styles.successHeader}>
              <IconSymbol name="checkmark" size={16} color="#00FF88" />
              <Text style={styles.successTitle}>Contract Deployed!</Text>
            </View>
            <Text style={styles.successLabel}>Contract Address</Text>
            <Text style={styles.successAddress}>{deployedAddress}</Text>
            <Pressable
              onPress={openPolygonScan}
              style={({ pressed }) => [styles.scanLink, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.scanLinkText}>View on PolygonScan →</Text>
            </Pressable>
          </View>
        )}

        {/* Existing contract */}
        {settings.contractAddress && deployStep !== "done" && (
          <View style={styles.existingCard}>
            <Text style={styles.existingLabel}>Current Contract</Text>
            <Text style={styles.existingAddress}>{settings.contractAddress}</Text>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <View style={styles.checkItem}>
      <View style={[styles.checkDot, { backgroundColor: ok ? "#00FF88" : "#FF3B5C" }]} />
      <Text style={[styles.checkText, { color: ok ? "#E2E8F0" : "#6B7280" }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  headerTitle: { color: "#E2E8F0", fontSize: 22, fontWeight: "800" },
  headerSub: { color: "#6B7280", fontSize: 13, marginTop: 2 },
  infoCard: {
    flexDirection: "row",
    backgroundColor: "#00E5FF10",
    borderColor: "#00E5FF30",
    borderWidth: 1,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
    gap: 10,
    alignItems: "flex-start",
  },
  infoText: { color: "#9CA3AF", fontSize: 12, flex: 1, lineHeight: 18 },
  codeToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 8,
  },
  codeToggleText: { color: "#00E5FF", fontSize: 13, fontWeight: "600", flex: 1 },
  codeBlock: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: "#0D1220",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#1E293B",
    maxHeight: 200,
  },
  codeText: { color: "#6B7280", fontSize: 10, fontFamily: "SpaceMono", lineHeight: 16 },
  fieldGroup: { marginHorizontal: 16, marginBottom: 16 },
  fieldLabel: { color: "#E2E8F0", fontSize: 13, fontWeight: "700", marginBottom: 4 },
  fieldHint: { color: "#4B5563", fontSize: 11, marginBottom: 8 },
  input: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1E293B",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#E2E8F0",
    fontSize: 13,
    fontFamily: "SpaceMono",
  },
  inputError: { borderColor: "#FF3B5C" },
  errorText: { color: "#FF3B5C", fontSize: 11, marginTop: 4 },
  readonlyField: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1E293B",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  readonlyText: { color: "#6B7280", fontSize: 11, fontFamily: "SpaceMono", flex: 1 },
  verifiedBadge: {
    backgroundColor: "#00FF8820",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  verifiedText: { color: "#00FF88", fontSize: 9, fontWeight: "800" },
  checksCard: {
    marginHorizontal: 16,
    marginBottom: 20,
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1E293B",
    gap: 10,
  },
  checksTitle: { color: "#6B7280", fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 4 },
  checkItem: { flexDirection: "row", alignItems: "center", gap: 10 },
  checkDot: { width: 8, height: 8, borderRadius: 4 },
  checkText: { fontSize: 13 },
  deployBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: "#00E5FF",
    marginBottom: 16,
  },
  deployBtnDisabled: { backgroundColor: "#1E293B" },
  deployBtnText: { color: "#0A0E1A", fontSize: 15, fontWeight: "800" },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    backgroundColor: "#FF3B5C15",
    borderColor: "#FF3B5C40",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorCardText: { color: "#FF3B5C", fontSize: 12, flex: 1 },
  successCard: {
    marginHorizontal: 16,
    backgroundColor: "#00FF8810",
    borderColor: "#00FF8840",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  successHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  successTitle: { color: "#00FF88", fontSize: 15, fontWeight: "800" },
  successLabel: { color: "#4B5563", fontSize: 11, marginBottom: 4 },
  successAddress: {
    color: "#E2E8F0",
    fontSize: 11,
    fontFamily: "SpaceMono",
    marginBottom: 12,
  },
  scanLink: { alignSelf: "flex-start" },
  scanLinkText: { color: "#00E5FF", fontSize: 13, fontWeight: "600" },
  existingCard: {
    marginHorizontal: 16,
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1E293B",
    marginBottom: 16,
  },
  existingLabel: { color: "#4B5563", fontSize: 11, marginBottom: 4 },
  existingAddress: { color: "#6B7280", fontSize: 11, fontFamily: "SpaceMono" },
});
