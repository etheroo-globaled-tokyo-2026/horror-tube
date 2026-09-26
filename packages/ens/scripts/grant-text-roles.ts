import {
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  encodeFunctionData,
  keccak256,
  stringToBytes,
} from "viem";

import { permissionedResolverAbi } from "./abis.js";

export const ROSTER_TEXT_KEYS = ["look", "brief", "icon"] as const;
export const AGENT_TEXT_KEYS = ["status", "injuries"] as const;
export const REGISTER_BOOTSTRAP_TEXT_KEYS = [
  "display_name",
  "injury_places",
] as const;
export const ROLE_SET_TEXT = 1n << 4n;

export function textKeyResource(key: string): bigint {
  return BigInt(keccak256(stringToBytes(key)));
}

type TxClient = Pick<
  PublicClient<Transport, Chain | undefined, Account | undefined>,
  "simulateContract" | "waitForTransactionReceipt" | "readContract"
>;

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

export function assertWritePermissionGranted(
  result: boolean,
  key: string,
  account: string,
): void {
  if (result !== true) {
    throw new Error(
      `grantSetterRoles(${key}, ${account}) did not grant write permission: result=${String(result)}`,
    );
  }
}

export async function grantTextSetterRoles(args: {
  publicClient: TxClient;
  walletClient: GrantWallet;
  resolver: Address;
  account: Address;
  keys: readonly string[];
}): Promise<boolean[]> {
  const { publicClient, walletClient, resolver, account, keys } = args;
  const granted: boolean[] = [];
  for (const key of keys) {
    const setter = buildSetTextSetter(key);
    const { request, result } = await publicClient.simulateContract({
      address: resolver,
      abi: permissionedResolverAbi,
      functionName: "grantSetterRoles",
      args: [setter, account],
      account: walletClient.account,
    });
    if (!result) {
      // grantSetterRoles returns false when the account already holds the role.
      const held = await publicClient.readContract({
        address: resolver,
        abi: permissionedResolverAbi,
        functionName: "hasRoles",
        args: [textKeyResource(key), ROLE_SET_TEXT, account],
      });
      assertWritePermissionGranted(held, key, account);
      console.log(`grantSetterRoles(${key}, ${account}) skipped: role already held`);
      granted.push(false);
      continue;
    }
    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(
        `grantSetterRoles(${key}, ${account}) tx reverted: ${hash}`,
      );
    }
    granted.push(true);
  }
  return granted;
}
