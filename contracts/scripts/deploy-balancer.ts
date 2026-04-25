import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

// Balancer Vault address on Polygon mainnet
const BALANCER_VAULT_POLYGON = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

async function main() {
  console.log("🚀 Deploying Balancer Flash Loan Receiver...\n");

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log(`📝 Deploying from: ${deployer.address}`);

  // Get profit recipient from environment
  const profitRecipient = process.env.PROFIT_ADDRESS;
  if (!profitRecipient) {
    throw new Error("PROFIT_ADDRESS not set in environment");
  }

  console.log(`💰 Profit recipient: ${profitRecipient}\n`);

  // Get contract factory
  const BalancerFlashLoanReceiver = await ethers.getContractFactory(
    "BalancerFlashLoanReceiver"
  );

  // Deploy contract
  console.log("⏳ Deploying contract...");
  const receiver = await BalancerFlashLoanReceiver.deploy(
    BALANCER_VAULT_POLYGON,
    profitRecipient
  );

  await receiver.waitForDeployment();
  const receiverAddress = await receiver.getAddress();

  console.log(`✅ Contract deployed at: ${receiverAddress}\n`);

  // Verify deployment
  console.log("🔍 Verifying deployment...");
  const vaultAddress = await receiver.vault();
  const profitRecipientStored = await receiver.profitRecipient();

  console.log(`   Vault: ${vaultAddress}`);
  console.log(`   Profit Recipient: ${profitRecipientStored}`);
  console.log(`   Owner: ${await receiver.owner()}\n`);

  // Save deployment info
  const deploymentInfo = {
    network: process.env.HARDHAT_NETWORK || "polygon",
    contractName: "BalancerFlashLoanReceiver",
    address: receiverAddress,
    vault: vaultAddress,
    profitRecipient: profitRecipientStored,
    owner: deployer.address,
    deploymentTime: new Date().toISOString(),
    blockNumber: await ethers.provider.getBlockNumber(),
  };

  const deploymentPath = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentPath)) {
    fs.mkdirSync(deploymentPath, { recursive: true });
  }

  const filename = path.join(
    deploymentPath,
    `BalancerFlashLoanReceiver-${Date.now()}.json`
  );
  fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));

  console.log(`📄 Deployment info saved to: ${filename}\n`);

  // Update environment file
  const envPath = path.join(__dirname, "../../.env");
  let envContent = "";

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, "utf-8");
  }

  // Update or add RECEIVER_CONTRACT_ADDRESS
  if (envContent.includes("RECEIVER_CONTRACT_ADDRESS")) {
    envContent = envContent.replace(
      /RECEIVER_CONTRACT_ADDRESS=.*/,
      `RECEIVER_CONTRACT_ADDRESS=${receiverAddress}`
    );
  } else {
    envContent += `\nRECEIVER_CONTRACT_ADDRESS=${receiverAddress}\n`;
  }

  fs.writeFileSync(envPath, envContent);
  console.log(`✅ Updated .env with RECEIVER_CONTRACT_ADDRESS=${receiverAddress}\n`);

  // Print summary
  console.log("═".repeat(60));
  console.log("🎉 DEPLOYMENT COMPLETE");
  console.log("═".repeat(60));
  console.log(`Contract Address: ${receiverAddress}`);
  console.log(`Network: ${process.env.HARDHAT_NETWORK || "polygon"}`);
  console.log(`Vault: ${vaultAddress}`);
  console.log(`Profit Recipient: ${profitRecipientStored}`);
  console.log("═".repeat(60));
  console.log("\n📋 Next steps:");
  console.log(`1. Verify contract on PolygonScan:`);
  console.log(
    `   npx hardhat verify --network polygon ${receiverAddress} ${BALANCER_VAULT_POLYGON} ${profitRecipient}`
  );
  console.log(`2. Update your bot configuration with:`);
  console.log(`   RECEIVER_CONTRACT_ADDRESS=${receiverAddress}`);
  console.log(`3. Restart your bot`);
  console.log("═".repeat(60) + "\n");

  return receiverAddress;
}

main()
  .then((address) => {
    console.log("✅ Deployment successful!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Deployment failed!");
    console.error(error);
    process.exit(1);
  });
