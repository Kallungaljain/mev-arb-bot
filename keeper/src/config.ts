export class KeeperConfig {
  constructor(
    public readonly alchemyApiKey: string,
    public readonly privateKey: string,
    public readonly contractAddress: string,
    public readonly profitWallet: string,
    public readonly minProfitWei: number,    // in USDC units (6 decimals)
    public readonly maxSlippageBps: number,
    public readonly maxGasGwei: number,
    public readonly autoExecute: boolean,
    public readonly port: number,
    public readonly internalSecret: string,  // shared with Rust scanner
    public readonly wsSecret: string,        // shared with Android app
  ) {}

  get rpcUrl(): string {
    return `https://polygon-mainnet.g.alchemy.com/v2/${this.alchemyApiKey}`;
  }

  static fromEnv(): KeeperConfig {
    const required = (key: string): string => {
      const val = process.env[key];
      if (!val) throw new Error(`Missing required env var: ${key}`);
      return val;
    };

    return new KeeperConfig(
      required("ALCHEMY_API_KEY"),
      required("PRIVATE_KEY"),
      required("CONTRACT_ADDRESS"),
      required("PROFIT_WALLET"),
      parseInt(process.env.MIN_PROFIT_WEI ?? "500000"),
      parseInt(process.env.MAX_SLIPPAGE_BPS ?? "50"),
      parseInt(process.env.MAX_GAS_GWEI ?? "200"),
      process.env.AUTO_EXECUTE === "true",
      parseInt(process.env.PORT ?? "3001"),
      process.env.KEEPER_SECRET ?? "change-me-in-production",
      process.env.WS_SECRET ?? "change-me-in-production",
    );
  }
}
