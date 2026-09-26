import {
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
  decodeAbiParameters,
  encodeFunctionData,
  parseAbi,
} from "viem";

import { permissionedResolverAbi } from "./abis.js";

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

const textResolverAbi = parseAbi(["function text(bytes32 node, string key) view returns (string)"]);

export type TextWriterRole = "bootstrap" | "roster" | "agent";

export type TextWriteDecision = "skip" | "write";

type ReadClient = Pick<
  PublicClient<Transport, Chain | undefined, Account | undefined>,
  "readContract" | "waitForTransactionReceipt"
>;

type TextWallet = WalletClient<Transport, Chain, Account>;

export function decideTextWrite(current: string, desired: string): TextWriteDecision {
  return current === desired ? "skip" : "write";
}

export async function readTextRecord(
  publicClient: ReadClient,
  resolver: Address,
  dnsName: Hex,
  key: string,
): Promise<string> {
  let encoded: Hex;
  try {
    encoded = await publicClient.readContract({
      address: resolver,
      abi: permissionedResolverAbi,
      functionName: "resolve",
      args: [
        dnsName,
        encodeFunctionData({
          abi: textResolverAbi,
          functionName: "text",
          args: [ZERO_BYTES32, key],
        }),
      ],
    });
  } catch (error) {
    throw new Error(
      `PermissionedResolver.resolve(text ${key}) failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    const [value] = decodeAbiParameters([{ type: "string" }], encoded);
    return value;
  } catch (error) {
    throw new Error(
      `Failed to decode text(${key}) resolve result: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export type SetTextResult = { action: "skip" } | { action: "write"; hash: Hex };

/** Sends setText only when the stored value differs; waits for the receipt before returning. */
export async function setTextIfChanged(args: {
  publicClient: ReadClient;
  walletClient: TextWallet;
  role: TextWriterRole;
  resolver: Address;
  dnsName: Hex;
  label: string;
  key: string;
  value: string;
}): Promise<SetTextResult> {
  const { publicClient, walletClient, role, resolver, dnsName, label, key, value } = args;
  const writer = walletClient.account.address;
  let current: string;
  try {
    current = await readTextRecord(publicClient, resolver, dnsName, key);
  } catch (error) {
    throw new Error(
      `Reading current text before setText failed label=${label} key=${key} role=${role}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (decideTextWrite(current, value) === "skip") {
    console.log(
      `setTextSkip label=${label} key=${key} role=${role} writer=${writer} reason=unchanged`,
    );
    return { action: "skip" };
  }
  let hash: Hex;
  try {
    hash = await walletClient.writeContract({
      address: resolver,
      abi: permissionedResolverAbi,
      functionName: "setText",
      args: [dnsName, key, value],
    });
  } catch (error) {
    throw new Error(
      `PermissionedResolver.setText(${label}, ${key}) role=${role} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  console.log(`setTextTxHash=${hash} label=${label} key=${key} role=${role} writer=${writer}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`setText ${label} ${key} role=${role} tx reverted: ${hash}`);
  }
  return { action: "write", hash };
}
