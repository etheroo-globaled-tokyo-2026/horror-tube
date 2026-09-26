import {
  type Address,
  type Hash,
  type Hex,
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  isHex,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const battleBettingAbi = parseAbi([
  "function minBet() view returns (uint256)",
  "function openBattle(string fighterA, string fighterB, uint64 closesAt) returns (uint256)",
  "function placeBet(uint256 battleId, uint8 fighter) payable",
]);

export type BattleBettingPorts = {
  /** Current contract minimum bet in wei. */
  minBet: () => Promise<bigint>;
  /** Operator: open a battle; returns the on-chain battle id. */
  openBattle: (
    fighterA: string,
    fighterB: string,
    closesAtUnix: bigint,
  ) => Promise<bigint>;
  /** Anyone: stake `valueWei` on fighter 0 or 1. Returns the tx hash. */
  placeBet: (
    battleId: bigint,
    fighter: 0 | 1,
    valueWei: bigint,
  ) => Promise<Hash>;
};

function requiredBattleBettingEnv(
  name: "BATTLE_BETTING_ADDRESS" | "SEPOLIA_RPC_URL" | "AGENT_PRIVATE_KEY",
  env: NodeJS.ProcessEnv,
): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `${name} is required. Set it in .env. See .env.example.`,
    );
  }
  return value.trim();
}

function parsePrivateKey(value: string, envName: string): Hex {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!isHex(normalized) || normalized.length !== 66) {
    throw new Error(
      `${envName} must be a 32-byte hex string (0x + 64 hex chars). Got length ${String(normalized.length)}`,
    );
  }
  return normalized;
}

function parseBattleBettingAddress(raw: string): Address {
  if (!isAddress(raw)) {
    throw new Error(
      `BATTLE_BETTING_ADDRESS must be a 0x-prefixed 20-byte address. Got: ${JSON.stringify(raw)}. See .env.example.`,
    );
  }
  return getAddress(raw);
}

/**
 * Sepolia BattleBetting client for openBattle / placeBet.
 * Uses AGENT_PRIVATE_KEY (already on the game node). That address must hold
 * OPERATOR_ROLE to open battles; placeBet is permissionless for any funded key.
 * No fallback contract address — missing env fails by name.
 */
export function createBattleBettingPorts(
  env: NodeJS.ProcessEnv = process.env,
): BattleBettingPorts {
  const address = parseBattleBettingAddress(
    requiredBattleBettingEnv("BATTLE_BETTING_ADDRESS", env),
  );
  const rpcUrl = requiredBattleBettingEnv("SEPOLIA_RPC_URL", env);
  const privateKey = parsePrivateKey(
    requiredBattleBettingEnv("AGENT_PRIVATE_KEY", env),
    "AGENT_PRIVATE_KEY",
  );
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  return {
    async minBet() {
      return publicClient.readContract({
        address,
        abi: battleBettingAbi,
        functionName: "minBet",
      });
    },
    async openBattle(fighterA, fighterB, closesAtUnix) {
      const { result: battleId, request } = await publicClient.simulateContract({
        account,
        address,
        abi: battleBettingAbi,
        functionName: "openBattle",
        args: [fighterA, fighterB, closesAtUnix],
      });
      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(
          `BattleBetting.openBattle(${fighterA}, ${fighterB}) tx reverted: ${hash}`,
        );
      }
      return battleId;
    },
    async placeBet(battleId, fighter, valueWei) {
      const { request } = await publicClient.simulateContract({
        account,
        address,
        abi: battleBettingAbi,
        functionName: "placeBet",
        args: [battleId, fighter],
        value: valueWei,
      });
      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(
          `BattleBetting.placeBet(battleId=${String(battleId)}, fighter=${String(fighter)}) tx reverted: ${hash}`,
        );
      }
      return hash;
    },
  };
}

/**
 * Stake units from the room UI (1, 3, 5) map to `units * minBet` wei on chain.
 */
export async function stakeWeiForUnits(
  ports: Pick<BattleBettingPorts, "minBet">,
  units: number,
): Promise<bigint> {
  if (!Number.isInteger(units) || units < 1) {
    throw new Error(
      `bet amount must be a positive integer stake unit. Got: ${String(units)}.`,
    );
  }
  const minBet = await ports.minBet();
  return minBet * BigInt(units);
}
