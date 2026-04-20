import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

// ─── Polygon Network Addresses ────────────────────────────────────────────────

const AAVE_V3_POOLS = {
  mumbai: "0x60D55F02A771d515e077c9C2403a1ef271224Ca7",
  polygon: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
};

async function main() {
  const network = process.env.NETWORK || "mumbai";
  const aavePool = AAVE_V3_POOLS[network as keyof typeof AAVE_V3_POOLS];

  if (!aavePool) {
    throw new Error(`Unknown network: ${network}`);
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deploying EliteAntArb with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MATIC");

  const profitWallet = process.env.PROFIT_WALLET ?? deployer.address;
  // Minimum profit: 0.50 USDC (6 decimals) = 500_000
  const minProfitWei = process.env.MIN_PROFIT_WEI ?? "500000";

  console.log("\nDeployment parameters:");
  console.log("  Network:        ", network);
  console.log("  AAVE V3 Pool:   ", aavePool);
  console.log("  Profit Wallet:  ", profitWallet);
  console.log("  Min Profit Wei: ", minProfitWei);

  const EliteAntArb = await ethers.getContractFactory("EliteAntArb");
  const contract = await EliteAntArb.deploy(
    aavePool,
    profitWallet,
    BigInt(minProfitWei)
  );

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("\n✅ EliteAntArb deployed to:", address);
  console.log("\nVerify on PolygonScan:");
  console.log(`  npx hardhat verify --network ${network} ${address} "${aavePool}" "${profitWallet}" "${minProfitWei}"`);
  console.log("\nAdd to your .env:");
  console.log(`  ELITE_ANT_ADDRESS=${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
