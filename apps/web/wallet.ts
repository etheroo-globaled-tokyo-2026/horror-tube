import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

export const BURNER_KEY_STORAGE_KEY = "horror-tube.sui-burner-key";

export const USDC_TYPE =
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";

export const USDC_DECIMALS = 6;

export type KeyStore = Pick<Storage, "getItem" | "setItem">;

export type GameWallet = {
  address: string;
  signer: Ed25519Keypair;
  client: SuiGrpcClient;
};

export function loadBurnerKeypair(store: KeyStore): Ed25519Keypair {
  const stored = store.getItem(BURNER_KEY_STORAGE_KEY);
  if (stored === null) {
    const keypair = Ed25519Keypair.generate();
    store.setItem(BURNER_KEY_STORAGE_KEY, keypair.getSecretKey());
    return keypair;
  }
  try {
    return Ed25519Keypair.fromSecretKey(stored);
  } catch {
    throw new Error(
      `${BURNER_KEY_STORAGE_KEY} is not a Sui Ed25519 private key. Refusing to overwrite it.`,
    );
  }
}

// WARNING: burner key lives in browser storage. Clearing it or an XSS bug loses the funds. Testnet only; DESIGN.md has the upgrade path.
export async function getGameWallet(store: KeyStore = localStorage): Promise<GameWallet> {
  const signer = loadBurnerKeypair(store);
  return {
    address: signer.toSuiAddress(),
    signer,
    client: new SuiGrpcClient({
      network: "testnet",
      baseUrl: "https://fullnode.testnet.sui.io:443",
    }),
  };
}

export async function getUsdcBalance(wallet: GameWallet): Promise<bigint> {
  const { balance } = await wallet.client.core.getBalance({
    owner: wallet.address,
    coinType: USDC_TYPE,
  });
  return BigInt(balance.balance);
}
