import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Address,
  type Hex,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  parseAbi,
  parseEventLogs,
} from "viem";

import { permissionedResolverAbi, verifiableFactoryAbi } from "./abis.js";
import { CONTRACTS_V2_COMMIT } from "./pin.js";

const ALL_ROLES =
  0x1111111111111111111111111111111111111111111111111111111111111111n;

const pinDir = join(dirname(fileURLToPath(import.meta.url)), "pin");

type PinArtifact = {
  bytecode: Hex;
  contractsV2Commit: string;
};

type TxClient = {
  waitForTransactionReceipt: (args: { hash: Hex }) => Promise<{
    status: "success" | "reverted";
    contractAddress?: Address | null | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logs: any;
  }>;
};

// Wallet clients from viem are heavily generic; keep this helper usable from tests and scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DeployWallet = any;

function loadPinArtifact(name: string): PinArtifact {
  const raw = JSON.parse(readFileSync(join(pinDir, name), "utf8")) as PinArtifact;
  if (raw.contractsV2Commit !== CONTRACTS_V2_COMMIT) {
    throw new Error(
      `Pin artifact ${name} commit ${raw.contractsV2Commit} != ${CONTRACTS_V2_COMMIT}`,
    );
  }
  if (raw.bytecode === undefined || raw.bytecode.trim() === "") {
    throw new Error(`Pin artifact ${name} is missing bytecode`);
  }
  return raw;
}

export async function deployLocalPermissionedResolver(args: {
  publicClient: TxClient;
  walletClient: DeployWallet;
  bootstrapAddress: Address;
}): Promise<Address> {
  const { publicClient, walletClient, bootstrapAddress } = args;
  const account = walletClient.account;
  if (account === undefined) {
    throw new Error("walletClient.account is required to deploy the local resolver");
  }

  const factoryArt = loadPinArtifact("VerifiableFactory.json");
  const implArt = loadPinArtifact("PermissionedResolverImpl.json");

  const factoryHash = await walletClient.deployContract({
    abi: verifiableFactoryAbi,
    bytecode: factoryArt.bytecode,
    account,
    chain: walletClient.chain,
  });
  const factoryReceipt = await publicClient.waitForTransactionReceipt({
    hash: factoryHash,
  });
  const factoryAddress = factoryReceipt.contractAddress;
  if (
    factoryReceipt.status !== "success" ||
    factoryAddress === undefined ||
    factoryAddress === null
  ) {
    throw new Error(`VerifiableFactory deploy failed: ${factoryHash}`);
  }
  const factory = getAddress(factoryAddress);

  const implBytecode = encodeDeployData({
    abi: parseAbi(["constructor(address namer)"]),
    bytecode: implArt.bytecode,
    args: [bootstrapAddress],
  });
  const implHash = await walletClient.sendTransaction({
    data: implBytecode,
    account,
    chain: walletClient.chain,
  });
  const implReceipt = await publicClient.waitForTransactionReceipt({ hash: implHash });
  const implAddress = implReceipt.contractAddress;
  if (
    implReceipt.status !== "success" ||
    implAddress === undefined ||
    implAddress === null
  ) {
    throw new Error(`PermissionedResolverImpl deploy failed: ${implHash}`);
  }
  const implementation = getAddress(implAddress);

  const initData = encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "initialize",
    args: [[{ account: bootstrapAddress, roleBitmap: ALL_ROLES }], []],
  });

  const deployHash = await walletClient.writeContract({
    address: factory,
    abi: verifiableFactoryAbi,
    functionName: "deployProxy",
    args: [implementation, 1n, initData],
    account,
    chain: walletClient.chain,
  });
  const deployReceipt = await publicClient.waitForTransactionReceipt({
    hash: deployHash,
  });
  if (deployReceipt.status !== "success") {
    throw new Error(`deployProxy failed: ${deployHash}`);
  }
  const logs = parseEventLogs({
    abi: verifiableFactoryAbi,
    eventName: "ProxyDeployed",
    logs: deployReceipt.logs,
  });
  if (logs.length === 0 || logs[0].args.proxyAddress === undefined) {
    throw new Error(`deployProxy: ProxyDeployed missing on ${deployHash}`);
  }
  return getAddress(logs[0].args.proxyAddress);
}
