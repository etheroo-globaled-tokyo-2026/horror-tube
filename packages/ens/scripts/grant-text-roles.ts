import { type Address, type Hex, encodeFunctionData } from "viem";

import { permissionedResolverAbi } from "./abis.js";

export const ROSTER_TEXT_KEYS = ["look", "brief", "icon"] as const;
export const AGENT_TEXT_KEYS = ["status", "injuries"] as const;
export const REGISTER_BOOTSTRAP_TEXT_KEYS = [
  "display_name",
  "injury_places",
] as const;

type TxClient = {
  waitForTransactionReceipt: (args: {
    hash: Hex;
  }) => Promise<{ status: "success" | "reverted" }>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GrantWallet = any;

/** ABI-encode setText calldata for grantSetterRoles. Name/value are unused by decodeSetter. */
export function buildSetTextSetter(key: string): Hex {
  return encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "setText",
    args: ["0x00", key, ""],
  });
}

export async function grantTextSetterRoles(args: {
  publicClient: TxClient;
  walletClient: GrantWallet;
  resolver: Address;
  account: Address;
  keys: readonly string[];
}): Promise<void> {
  const { publicClient, walletClient, resolver, account, keys } = args;
  for (const key of keys) {
    const setter = buildSetTextSetter(key);
    const hash = await walletClient.writeContract({
      address: resolver,
      abi: permissionedResolverAbi,
      functionName: "grantSetterRoles",
      args: [setter, account],
      account: walletClient.account,
      chain: walletClient.chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(
        `grantSetterRoles(${key}, ${account}) tx reverted: ${hash}`,
      );
    }
  }
}
