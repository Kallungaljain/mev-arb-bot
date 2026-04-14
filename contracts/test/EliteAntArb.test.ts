import { expect } from "chai";
import { ethers } from "hardhat";
import { EliteAntArb } from "../typechain-types";

// ─── Polygon Mainnet Addresses (used in fork tests) ───────────────────────────
const AAVE_V3_POOL      = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
const USDC              = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; // USDC.e on Polygon
const WMATIC            = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
const QUICKSWAP_PAIR    = "0x6e7a5FAFcec6BB1e78bAE2A1F0B612012BF14827"; // USDC/WMATIC QuickSwap
const SUSHISWAP_PAIR    = "0xc4e595acDD7d12feC385E5dA5D43160e8A0bAC0E"; // USDC/WMATIC SushiSwap

describe("EliteAntArb", function () {
  let contract: EliteAntArb;
  let owner: any;
  let attacker: any;

  beforeEach(async () => {
    [owner, attacker] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("EliteAntArb");
    contract = await Factory.deploy(
      AAVE_V3_POOL,
      owner.address,
      BigInt("500000") // 0.50 USDC min profit
    ) as EliteAntArb;
    await contract.waitForDeployment();
  });

  // ── Deployment ──────────────────────────────────────────────────────────────

  describe("Deployment", () => {
    it("sets owner correctly", async () => {
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("sets aavePool correctly", async () => {
      expect(await contract.aavePool()).to.equal(AAVE_V3_POOL);
    });

    it("sets profitWallet correctly", async () => {
      expect(await contract.profitWallet()).to.equal(owner.address);
    });

    it("sets minProfitWei correctly", async () => {
      expect(await contract.minProfitWei()).to.equal(BigInt("500000"));
    });

    it("starts unpaused", async () => {
      expect(await contract.paused()).to.equal(false);
    });

    it("reverts on zero address for aavePool", async () => {
      const Factory = await ethers.getContractFactory("EliteAntArb");
      await expect(
        Factory.deploy(ethers.ZeroAddress, owner.address, 0)
      ).to.be.revertedWithCustomError(contract, "ZeroAddress");
    });

    it("reverts on zero address for profitWallet", async () => {
      const Factory = await ethers.getContractFactory("EliteAntArb");
      await expect(
        Factory.deploy(AAVE_V3_POOL, ethers.ZeroAddress, 0)
      ).to.be.revertedWithCustomError(contract, "ZeroAddress");
    });
  });

  // ── Owner Controls ──────────────────────────────────────────────────────────

  describe("Owner Controls", () => {
    it("allows owner to pause", async () => {
      await contract.setPaused(true);
      expect(await contract.paused()).to.equal(true);
    });

    it("allows owner to unpause", async () => {
      await contract.setPaused(true);
      await contract.setPaused(false);
      expect(await contract.paused()).to.equal(false);
    });

    it("reverts non-owner pause attempt", async () => {
      await expect(
        contract.connect(attacker).setPaused(true)
      ).to.be.revertedWithCustomError(contract, "NotOwner");
    });

    it("allows owner to update minProfit", async () => {
      await contract.setMinProfit(BigInt("1000000"));
      expect(await contract.minProfitWei()).to.equal(BigInt("1000000"));
    });

    it("reverts non-owner minProfit update", async () => {
      await expect(
        contract.connect(attacker).setMinProfit(0)
      ).to.be.revertedWithCustomError(contract, "NotOwner");
    });

    it("allows owner to update profitWallet", async () => {
      await contract.setProfitWallet(attacker.address);
      expect(await contract.profitWallet()).to.equal(attacker.address);
    });

    it("reverts zero address for profitWallet", async () => {
      await expect(
        contract.setProfitWallet(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(contract, "ZeroAddress");
    });
  });

  // ── Access Control ──────────────────────────────────────────────────────────

  describe("Access Control", () => {
    it("reverts executeArb from non-owner", async () => {
      await expect(
        contract.connect(attacker).executeArb(
          USDC, BigInt("1000000000"), QUICKSWAP_PAIR, SUSHISWAP_PAIR, WMATIC, BigInt("500000")
        )
      ).to.be.revertedWithCustomError(contract, "NotOwner");
    });

    it("reverts executeArb when paused", async () => {
      await contract.setPaused(true);
      await expect(
        contract.executeArb(
          USDC, BigInt("1000000000"), QUICKSWAP_PAIR, SUSHISWAP_PAIR, WMATIC, BigInt("500000")
        )
      ).to.be.revertedWithCustomError(contract, "ContractPaused");
    });

    it("reverts executeOperation from non-AAVE caller", async () => {
      await expect(
        contract.executeOperation(
          USDC, BigInt("1000000"), BigInt("500"), owner.address,
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["address","address","address","uint256"],
            [QUICKSWAP_PAIR, SUSHISWAP_PAIR, WMATIC, BigInt("500000")]
          )
        )
      ).to.be.revertedWithCustomError(contract, "NotAavePool");
    });
  });

  // ── ETH Rejection ───────────────────────────────────────────────────────────

  describe("ETH Rejection", () => {
    it("rejects plain ETH transfers", async () => {
      await expect(
        owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.1") })
      ).to.be.reverted;
    });
  });
});
