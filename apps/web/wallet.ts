import {
  type Account,
  type Hex,
  type PublicActions,
  type Transport,
  type WalletClient,
  createWalletClient,
  http,
  isHex,
  publicActions,
  size,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

export const BURNER_KEY_STORAGE_KEY = "horror-tube.burner-key";

export type AppWalletClient = WalletClient<Transport, typeof sepolia, Account> &
  PublicActions<Transport, typeof sepolia, Account>;

export type KeyStore = Pick<Storage, "getItem" | "setItem">;

export function loadBurnerKey(store: KeyStore): Hex {
  const stored = store.getItem(BURNER_KEY_STORAGE_KEY);
  if (stored === null) {
    const key = generatePrivateKey();
    store.setItem(BURNER_KEY_STORAGE_KEY, key);
    return key;
  }
  if (!isHex(stored) || size(stored) !== 32) {
    throw new Error(
      `${BURNER_KEY_STORAGE_KEY} is not a 32-byte hex private key. Refusing to overwrite it.`,
    );
  }
  return stored;
}

// WARNING: burner key lives in browser storage. Clearing it or an XSS bug loses the funds. Test ETH only; DESIGN.md has the Privy swap.
export async function getWalletClient(store: KeyStore = localStorage): Promise<AppWalletClient> {
  return createWalletClient({
    account: privateKeyToAccount(loadBurnerKey(store)),
    chain: sepolia,
    transport: http(),
  }).extend(publicActions);
}
