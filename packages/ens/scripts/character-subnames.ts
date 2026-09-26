import { config as loadDotenv } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  isHex,
  keccak256,
  parseAbi,
  parseEventLogs,
  stringToBytes,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import {
  ethRegistryAbi,
  permissionedResolverAbi,
  userRegistryAbi,
  verifiableFactoryAbi,
} from "./abis.js";
import {
  CONTRACTS_V2_COMMIT,
  PIN_DEPLOYED_AT,
  loadSubnamePinAddresses,
} from "./pin.js";
import {
  parseInjuries,
  parseInjuryPlaces,
  readRegisteredLabels,
  readRosterFromChain,
} from "./roster.js";

loadDotenv({ path: new URL("../../../.env", import.meta.url) });

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const STATUS_REGISTERED = 2;
const ALL_ROLES =
  0x1111111111111111111111111111111111111111111111111111111111111111n;
const ROLE_SET_SUBREGISTRY = 1n << 20n;
const ROLE_SET_RESOLVER = 1n << 24n;
const ROLE_UNREGISTER = 1n << 12n;
const CHARACTER_ROLE_BITMAP =
  ROLE_SET_SUBREGISTRY | ROLE_SET_RESOLVER | ROLE_UNREGISTER;
const TEXT_KEYS = [
  "display_name",
  "look",
  "brief",
  "injury_places",
  "injuries",
  "status",
  "icon",
] as const;

const textResolverAbi = parseAbi([
  "function text(bytes32 node, string key) view returns (string)",
]);

type Command =
  | "ensure"
  | "snapshot"
  | "apply-register"
  | "unregister"
  | "list"
  | "labels"
  | "set-icon";

type IconUpdate = {
  label: string;
  icon: string;
};

type CharacterSheet = {
  label: string;
  display_name: string;
  look: string;
  brief: string;
  injury_places: string;
  injuries: string;
  status: string;
  icon: string;
};

type RegisterPlanEntry = CharacterSheet & {
  name: string;
  action: string;
};

type RegisterPlan = {
  characters: RegisterPlanEntry[];
  skipped?: { label: string; reason: string }[];
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    fail(
      `${name} is required. Set it in .env. See .env.example. Refusing to fall back.`,
    );
  }
  return value.trim();
}

function parseLabel(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    fail(
      "ENS_LABEL is required. Set it in .env. See .env.example. Parent name is <ENS_LABEL>.eth; character subnames are label.<ENS_LABEL>.eth.",
    );
  }
  const trimmed = value.trim();
  if (trimmed.includes(".")) {
    fail(
      `ENS_LABEL must be one label, not a full name. Got: ${trimmed}`,
    );
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(trimmed)) {
    fail(
      `ENS_LABEL must be a single lowercase DNS label (letters, digits, internal hyphens). Got: ${trimmed}`,
    );
  }
  return trimmed;
}

function parsePrivateKey(value: string): Hex {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!isHex(normalized) || normalized.length !== 66) {
    fail(
      `PRIVATE_KEY must be a 32-byte hex string (0x + 64 hex chars). Got length ${normalized.length}`,
    );
  }
  return normalized;
}

function parseCommand(argv: string[]): Command {
  const arg = argv[2];
  if (arg === undefined || arg.trim() === "") {
    fail(
      "Command is required. Use: ensure | snapshot | apply-register | unregister | list | labels | set-icon.",
    );
  }
  if (
    arg === "ensure" ||
    arg === "snapshot" ||
    arg === "apply-register" ||
    arg === "unregister" ||
    arg === "list" ||
    arg === "labels" ||
    arg === "set-icon"
  ) {
    return arg;
  }
  fail(
    `Unknown command "${arg}". Use: ensure | snapshot | apply-register | unregister | list | labels | set-icon.`,
  );
}

function parseIconUpdates(path: string): IconUpdate[] {
  const raw = readJson(path);
  if (!Array.isArray(raw)) {
    fail(`--updates must be a JSON array of {label, icon}. Got: ${path}`);
  }
  const updates: IconUpdate[] = [];
  for (const entry of raw) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof (entry as IconUpdate).label !== "string" ||
      typeof (entry as IconUpdate).icon !== "string"
    ) {
      fail(
        `--updates entries must be objects with string label and icon. Got: ${JSON.stringify(entry)}`,
      );
    }
    const label = (entry as IconUpdate).label.trim();
    const icon = (entry as IconUpdate).icon.trim();
    if (label === "") {
      fail(`--updates entry has a blank label in ${path}`);
    }
    if (!icon.startsWith("https://")) {
      fail(
        `set-icon for ${label}: icon must be an https URL. Got: ${icon}`,
      );
    }
    updates.push({ label, icon });
  }
  if (updates.length === 0) {
    fail(`${path}: set-icon updates list must not be empty.`);
  }
  return updates;
}

function requireFlag(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  if (index === -1 || argv[index + 1] === undefined || argv[index + 1] === "") {
    fail(`${name} is required. Refusing to default a path.`);
  }
  return argv[index + 1];
}

function labelId(label: string): bigint {
  return BigInt(keccak256(stringToBytes(label)));
}

function dnsEncodeName(name: string): Hex {
  if (name === "") {
    return "0x00";
  }
  const labels = name.split(".");
  const bytes: number[] = [];
  for (const label of labels) {
    if (label === "") {
      fail(`dnsEncodeName: empty label in name ${JSON.stringify(name)}`);
    }
    const encoded = new TextEncoder().encode(label);
    if (encoded.length === 0 || encoded.length > 255) {
      fail(`dnsEncodeName: invalid label length ${encoded.length} in ${name}`);
    }
    bytes.push(encoded.length);
    bytes.push(...encoded);
  }
  bytes.push(0);
  return toHex(Uint8Array.from(bytes));
}

function subname(label: string, ensLabel: string): string {
  return `${label}.${ensLabel}.eth`;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Failed to read JSON ${path}: ${String(error)}`);
  }
}

async function waitSuccess(
  publicClient: ReturnType<typeof createPublicClient>,
  hash: Hex,
  what: string,
): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    fail(`${what} tx reverted: ${hash}`);
  }
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv);
  const ensLabel = parseLabel(process.env.ENS_LABEL);
  const rpcUrl = requiredEnv("SEPOLIA_RPC_URL");
  const privateKey = parsePrivateKey(requiredEnv("PRIVATE_KEY"));
  const pin = loadSubnamePinAddresses();

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

  console.log(
    JSON.stringify(
      {
        pin: {
          contractsV2Commit: CONTRACTS_V2_COMMIT,
          deployedAt: PIN_DEPLOYED_AT,
          UserRegistryImpl: pin.UserRegistryImpl,
          VerifiableFactory: pin.VerifiableFactory,
          PermissionedResolverImpl: pin.PermissionedResolverImpl,
          ETHRegistry: pin.ETHRegistry,
        },
        parent: `${ensLabel}.eth`,
        command,
        wallet: account.address,
        rpcUrl,
      },
      null,
      2,
    ),
  );

  let ethBalance: bigint;
  try {
    ethBalance = await publicClient.getBalance({ address: account.address });
  } catch (error) {
    fail(
      `Sepolia RPC failed at ${rpcUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  console.log(
    `ethBalanceWei=${ethBalance.toString()} ethBalanceEther=${formatEther(ethBalance)}`,
  );

  if (ethBalance === 0n) {
    fail(
      [
        "Missing Sepolia ETH for gas.",
        `wallet=${account.address}`,
        "balanceWei=0",
        "Refusing to register or unregister without gas.",
      ].join("\n"),
    );
  }

  const parentId = labelId(ensLabel);
  let parentState: {
    status: number;
    expiry: bigint;
    latestOwner: Address;
    tokenId: bigint;
    resource: bigint;
  };
  let subregistry: Address;
  let resolver: Address;
  try {
    const [state, sub, res] = await Promise.all([
      publicClient.readContract({
        address: pin.ETHRegistry,
        abi: ethRegistryAbi,
        functionName: "getState",
        args: [parentId],
      }),
      publicClient.readContract({
        address: pin.ETHRegistry,
        abi: ethRegistryAbi,
        functionName: "getSubregistry",
        args: [ensLabel],
      }),
      publicClient.readContract({
        address: pin.ETHRegistry,
        abi: ethRegistryAbi,
        functionName: "getResolver",
        args: [ensLabel],
      }),
    ]);
    parentState = {
      status: Number(state.status),
      expiry: BigInt(state.expiry),
      latestOwner: getAddress(state.latestOwner),
      tokenId: BigInt(state.tokenId),
      resource: BigInt(state.resource),
    };
    subregistry = getAddress(sub);
    resolver = getAddress(res);
  } catch (error) {
    fail(
      `Parent ETHRegistry read failed for ${ensLabel}.eth: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (parentState.status !== STATUS_REGISTERED) {
    fail(
      `Parent ${ensLabel}.eth is not REGISTERED on ETHRegistry (status=${parentState.status}). Register the parent first.`,
    );
  }
  if (getAddress(parentState.latestOwner) !== getAddress(account.address)) {
    fail(
      `Parent ${ensLabel}.eth owner ${parentState.latestOwner} != wallet ${account.address}. Refusing to manage subnames.`,
    );
  }

  async function deployUserRegistry(): Promise<Address> {
    const initData = encodeFunctionData({
      abi: userRegistryAbi,
      functionName: "initialize",
      args: [[{ account: account.address, roleBitmap: ALL_ROLES }]],
    });
    const salt = BigInt(
      keccak256(stringToBytes(`horror-tube:UserRegistry:${ensLabel}`)),
    );
    let hash: Hex;
    try {
      hash = await walletClient.writeContract({
        address: pin.VerifiableFactory,
        abi: verifiableFactoryAbi,
        functionName: "deployProxy",
        args: [pin.UserRegistryImpl, salt, initData],
      });
    } catch (error) {
      fail(
        `VerifiableFactory.deployProxy(UserRegistryImpl) failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    console.log(`deployUserRegistryTx=${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      fail(`deployUserRegistry tx reverted: ${hash}`);
    }
    const logs = parseEventLogs({
      abi: verifiableFactoryAbi,
      eventName: "ProxyDeployed",
      logs: receipt.logs,
    });
    if (logs.length === 0 || logs[0].args.proxyAddress === undefined) {
      fail(`deployUserRegistry: ProxyDeployed event missing on ${hash}`);
    }
    return getAddress(logs[0].args.proxyAddress);
  }

  async function deployPermissionedResolver(): Promise<Address> {
    const initData = encodeFunctionData({
      abi: permissionedResolverAbi,
      functionName: "initialize",
      args: [[{ account: account.address, roleBitmap: ALL_ROLES }], []],
    });
    const salt = BigInt(
      keccak256(stringToBytes(`horror-tube:PermissionedResolver:${ensLabel}`)),
    );
    let hash: Hex;
    try {
      hash = await walletClient.writeContract({
        address: pin.VerifiableFactory,
        abi: verifiableFactoryAbi,
        functionName: "deployProxy",
        args: [pin.PermissionedResolverImpl, salt, initData],
      });
    } catch (error) {
      fail(
        `VerifiableFactory.deployProxy(PermissionedResolverImpl) failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    console.log(`deployPermissionedResolverTx=${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      fail(`deployPermissionedResolver tx reverted: ${hash}`);
    }
    const logs = parseEventLogs({
      abi: verifiableFactoryAbi,
      eventName: "ProxyDeployed",
      logs: receipt.logs,
    });
    if (logs.length === 0 || logs[0].args.proxyAddress === undefined) {
      fail(`deployPermissionedResolver: ProxyDeployed event missing on ${hash}`);
    }
    return getAddress(logs[0].args.proxyAddress);
  }

  async function ensureParentInfrastructure(): Promise<{
    subregistry: Address;
    resolver: Address;
  }> {
    let nextSub = subregistry;
    let nextResolver = resolver;

    if (nextSub === ZERO_ADDRESS) {
      console.log("Parent has no subregistry; deploying UserRegistry proxy via VerifiableFactory.");
      nextSub = await deployUserRegistry();
      let setHash: Hex;
      try {
        setHash = await walletClient.writeContract({
          address: pin.ETHRegistry,
          abi: ethRegistryAbi,
          functionName: "setSubregistry",
          args: [parentState.tokenId, nextSub],
        });
      } catch (error) {
        fail(
          `ETHRegistry.setSubregistry failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      console.log(`setSubregistryTx=${setHash}`);
      await waitSuccess(publicClient, setHash, "setSubregistry");
    } else {
      console.log(`Reusing existing parent subregistry ${nextSub}`);
    }

    if (nextResolver === ZERO_ADDRESS) {
      console.log(
        "Parent has no resolver; deploying PermissionedResolver proxy via VerifiableFactory.",
      );
      nextResolver = await deployPermissionedResolver();
      let setHash: Hex;
      try {
        setHash = await walletClient.writeContract({
          address: pin.ETHRegistry,
          abi: ethRegistryAbi,
          functionName: "setResolver",
          args: [parentState.tokenId, nextResolver],
        });
      } catch (error) {
        fail(
          `ETHRegistry.setResolver failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      console.log(`setResolverTx=${setHash}`);
      await waitSuccess(publicClient, setHash, "setResolver");
    } else {
      console.log(`Reusing existing parent resolver ${nextResolver}`);
    }

    return { subregistry: nextSub, resolver: nextResolver };
  }

  async function readText(
    resolverAddress: Address,
    dnsName: Hex,
    key: string,
  ): Promise<string> {
    const data = encodeFunctionData({
      abi: textResolverAbi,
      functionName: "text",
      args: [ZERO_BYTES32, key],
    });
    let encoded: Hex;
    try {
      encoded = (await publicClient.readContract({
        address: resolverAddress,
        abi: permissionedResolverAbi,
        functionName: "resolve",
        args: [dnsName, data],
      })) as Hex;
    } catch (error) {
      fail(
        `PermissionedResolver.resolve(text ${key}) failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      const [value] = decodeAbiParameters(
        [{ type: "string" }],
        encoded,
      );
      return value;
    } catch (error) {
      fail(
        `Failed to decode text(${key}) resolve result: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function snapshotLabels(
    labels: string[],
    registry: Address,
    resolverAddress: Address,
  ): Promise<Record<string, CharacterSheet>> {
    const out: Record<string, CharacterSheet> = {};
    for (const label of labels) {
      const id = labelId(label);
      let status: number;
      try {
        status = Number(
          await publicClient.readContract({
            address: registry,
            abi: userRegistryAbi,
            functionName: "getStatus",
            args: [id],
          }),
        );
      } catch (error) {
        fail(
          `UserRegistry.getStatus(${label}) failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (status !== STATUS_REGISTERED) {
        continue;
      }
      const name = subname(label, ensLabel);
      const dnsName = dnsEncodeName(name);
      const texts: Record<string, string> = {};
      for (const key of TEXT_KEYS) {
        texts[key] = await readText(resolverAddress, dnsName, key);
      }
      const displayName = texts.display_name;
      if (displayName === undefined || displayName.trim() === "") {
        fail(`${label}: display_name is missing or blank.`);
      }
      const rawPlaces = texts.injury_places;
      if (rawPlaces === undefined) {
        fail(`${label}: injury_places text record was not read.`);
      }
      parseInjuryPlaces(label, rawPlaces);
      const rawInjuries = texts.injuries;
      if (rawInjuries === undefined) {
        fail(`${label}: injuries text record was not read.`);
      }
      parseInjuries(label, rawInjuries);
      out[label] = {
        label,
        display_name: displayName,
        look: texts.look ?? "",
        brief: texts.brief ?? "",
        injury_places: rawPlaces,
        injuries: rawInjuries,
        status: texts.status ?? "",
        icon: texts.icon ?? "",
      };
    }
    return out;
  }

  if (command === "ensure") {
    const ensured = await ensureParentInfrastructure();
    console.log(
      JSON.stringify(
        {
          ensured: true,
          subregistry: ensured.subregistry,
          resolver: ensured.resolver,
          parentExpiry: parentState.expiry.toString(),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "snapshot") {
    const labelsPath = requireFlag(process.argv, "--labels");
    const outPath = requireFlag(process.argv, "--out");
    const raw = readJson(labelsPath);
    if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) {
      fail(`--labels must be a JSON array of label strings. Got: ${labelsPath}`);
    }
    const labels = raw as string[];
    const ensured = await ensureParentInfrastructure();
    const existing = await snapshotLabels(
      labels,
      ensured.subregistry,
      ensured.resolver,
    );
    writeFileSync(outPath, `${JSON.stringify(existing, null, 2)}\n`);
    console.log(`Wrote chain snapshot: ${outPath}`);
    console.log(`registered=${Object.keys(existing).length}`);
    return;
  }

  if (command === "apply-register") {
    const planPath = requireFlag(process.argv, "--plan");
    const raw = readJson(planPath);
    if (
      raw === null ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      !("characters" in raw) ||
      !Array.isArray((raw as RegisterPlan).characters)
    ) {
      fail(`--plan must be a register plan object with characters[]. Got: ${planPath}`);
    }
    const plan = raw as RegisterPlan;
    const ensured = await ensureParentInfrastructure();

    for (const entry of plan.characters) {
      if (
        typeof entry.label !== "string" ||
        typeof entry.display_name !== "string" ||
        typeof entry.look !== "string" ||
        typeof entry.brief !== "string" ||
        typeof entry.injury_places !== "string" ||
        typeof entry.injuries !== "string" ||
        typeof entry.status !== "string" ||
        typeof entry.icon !== "string"
      ) {
        fail(`Plan entry missing required string fields: ${JSON.stringify(entry)}`);
      }
      if (entry.display_name.trim() === "") {
        fail(`Plan entry ${entry.label} has blank display_name.`);
      }
      parseInjuryPlaces(entry.label, entry.injury_places);
      parseInjuries(entry.label, entry.injuries);
      const id = labelId(entry.label);
      let status: number;
      try {
        status = Number(
          await publicClient.readContract({
            address: ensured.subregistry,
            abi: userRegistryAbi,
            functionName: "getStatus",
            args: [id],
          }),
        );
      } catch (error) {
        fail(
          `UserRegistry.getStatus(${entry.label}) failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (status !== STATUS_REGISTERED) {
        let registerHash: Hex;
        try {
          registerHash = await walletClient.writeContract({
            address: ensured.subregistry,
            abi: userRegistryAbi,
            functionName: "register",
            args: [
              entry.label,
              account.address,
              ZERO_ADDRESS,
              ensured.resolver,
              CHARACTER_ROLE_BITMAP,
              parentState.expiry,
            ],
          });
        } catch (error) {
          fail(
            `UserRegistry.register(${entry.label}) failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        console.log(`registerTxHash=${registerHash} label=${entry.label}`);
        await waitSuccess(publicClient, registerHash, `register ${entry.label}`);
      } else {
        console.log(
          `label=${entry.label} already REGISTERED; updating text records only (action=${entry.action})`,
        );
      }

      const dnsName = dnsEncodeName(subname(entry.label, ensLabel));
      for (const key of TEXT_KEYS) {
        const value = entry[key];
        let textHash: Hex;
        try {
          textHash = await walletClient.writeContract({
            address: ensured.resolver,
            abi: permissionedResolverAbi,
            functionName: "setText",
            args: [dnsName, key, value],
          });
        } catch (error) {
          fail(
            `PermissionedResolver.setText(${entry.label}, ${key}) failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        console.log(`setTextTxHash=${textHash} label=${entry.label} key=${key}`);
        await waitSuccess(
          publicClient,
          textHash,
          `setText ${entry.label} ${key}`,
        );
      }

      const post = await publicClient.readContract({
        address: ensured.subregistry,
        abi: userRegistryAbi,
        functionName: "getState",
        args: [id],
      });
      console.log(
        JSON.stringify(
          {
            name: subname(entry.label, ensLabel),
            getState: {
              status: Number(post.status),
              expiry: post.expiry.toString(),
              latestOwner: post.latestOwner,
              tokenId: post.tokenId.toString(),
            },
          },
          null,
          2,
        ),
      );
    }

    if (plan.skipped !== undefined) {
      for (const skipped of plan.skipped) {
        console.log(`skipped ${skipped.label}: ${skipped.reason}`);
      }
    }
    return;
  }

  if (command === "unregister") {
    const labelsPath = requireFlag(process.argv, "--labels");
    const raw = readJson(labelsPath);
    if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) {
      fail(`--labels must be a JSON array of label strings. Got: ${labelsPath}`);
    }
    const labels = raw as string[];
    if (labels.length === 0) {
      fail(`${labelsPath}: removal label list must not be empty.`);
    }
    const ensured = await ensureParentInfrastructure();

    for (const label of labels) {
      const id = labelId(label);
      let status: number;
      try {
        status = Number(
          await publicClient.readContract({
            address: ensured.subregistry,
            abi: userRegistryAbi,
            functionName: "getStatus",
            args: [id],
          }),
        );
      } catch (error) {
        fail(
          `UserRegistry.getStatus(${label}) failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (status !== STATUS_REGISTERED) {
        fail(
          `Cannot unregister ${subname(label, ensLabel)}: getStatus=${status}, expected REGISTERED(${STATUS_REGISTERED}).`,
        );
      }
      let hash: Hex;
      try {
        hash = await walletClient.writeContract({
          address: ensured.subregistry,
          abi: userRegistryAbi,
          functionName: "unregister",
          args: [id],
        });
      } catch (error) {
        fail(
          `UserRegistry.unregister(${label}) failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      console.log(`unregisterTxHash=${hash} name=${subname(label, ensLabel)}`);
      await waitSuccess(publicClient, hash, `unregister ${label}`);
      const post = await publicClient.readContract({
        address: ensured.subregistry,
        abi: userRegistryAbi,
        functionName: "getState",
        args: [id],
      });
      console.log(
        JSON.stringify(
          {
            name: subname(label, ensLabel),
            getState: {
              status: Number(post.status),
              expiry: post.expiry.toString(),
              latestOwner: post.latestOwner,
              tokenId: post.tokenId.toString(),
            },
          },
          null,
          2,
        ),
      );
    }
    return;
  }

  if (command === "labels") {
    const outPath = requireFlag(process.argv, "--out");
    let labels: string[];
    try {
      labels = await readRegisteredLabels(ensLabel, rpcUrl, pin.ETHRegistry);
    } catch (error) {
      fail(
        `list registered labels failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    writeFileSync(outPath, `${JSON.stringify(labels, null, 2)}\n`);
    console.log(`Wrote registered labels: ${outPath}`);
    console.log(`registered=${String(labels.length)}`);
    for (const label of labels) {
      console.log(`label=${label}`);
    }
    return;
  }

  if (command === "list") {
    const outPath = requireFlag(process.argv, "--out");
    let roster: Awaited<ReturnType<typeof readRosterFromChain>>;
    try {
      roster = await readRosterFromChain(ensLabel, rpcUrl, pin.ETHRegistry);
    } catch (error) {
      fail(
        `list registered characters failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const byLabel: Record<string, CharacterSheet> = {};
    for (const sheet of roster.sheets) {
      byLabel[sheet.label] = {
        label: sheet.label,
        display_name: sheet.display_name,
        look: sheet.look,
        brief: sheet.brief,
        injury_places: JSON.stringify(sheet.injury_places),
        injuries: JSON.stringify(sheet.injuries),
        status: sheet.status,
        icon: sheet.icon,
      };
    }
    writeFileSync(outPath, `${JSON.stringify(byLabel, null, 2)}\n`);
    console.log(`Wrote registered roster snapshot: ${outPath}`);
    console.log(`registered=${String(roster.sheets.length)}`);
    for (const sheet of roster.sheets) {
      console.log(`label=${sheet.label} icon=${sheet.icon === "" ? "(empty)" : sheet.icon}`);
    }
    return;
  }

  if (command === "set-icon") {
    const updatesPath = requireFlag(process.argv, "--updates");
    const outPath = requireFlag(process.argv, "--out");
    const updates = parseIconUpdates(updatesPath);
    const ensured = await ensureParentInfrastructure();
    const results: { label: string; icon: string; txHash: Hex }[] = [];

    for (const update of updates) {
      const id = labelId(update.label);
      let status: number;
      try {
        status = Number(
          await publicClient.readContract({
            address: ensured.subregistry,
            abi: userRegistryAbi,
            functionName: "getStatus",
            args: [id],
          }),
        );
      } catch (error) {
        fail(
          `UserRegistry.getStatus(${update.label}) failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (status !== STATUS_REGISTERED) {
        fail(
          `Cannot set-icon for ${subname(update.label, ensLabel)}: getStatus=${status}, expected REGISTERED(${STATUS_REGISTERED}).`,
        );
      }

      const dnsName = dnsEncodeName(subname(update.label, ensLabel));
      let textHash: Hex;
      try {
        textHash = await walletClient.writeContract({
          address: ensured.resolver,
          abi: permissionedResolverAbi,
          functionName: "setText",
          args: [dnsName, "icon", update.icon],
        });
      } catch (error) {
        fail(
          `PermissionedResolver.setText(${update.label}, icon) failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      console.log(
        `setTextTxHash=${textHash} label=${update.label} key=icon icon=${update.icon}`,
      );
      await waitSuccess(
        publicClient,
        textHash,
        `setText ${update.label} icon`,
      );
      results.push({
        label: update.label,
        icon: update.icon,
        txHash: textHash,
      });
    }

    writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
    console.log(`Wrote set-icon results: ${outPath}`);
    return;
  }

  fail(`Unhandled command: ${command}`);
}

main().catch((error: unknown) => {
  fail(
    `Unhandled error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
});
