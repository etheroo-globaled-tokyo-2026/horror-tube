import { config as loadDotenv } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  formatEther,
  formatUnits,
  getAddress,
  http,
  isHex,
  keccak256,
  stringToBytes,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import {
  ethRegistrarAbi,
  ethRegistryAbi,
  mockErc20Abi,
  standardRentPriceOracleAbi,
} from "./abis.js";
import {
  CONTRACTS_V2_COMMIT,
  PIN_DEPLOYED_AT,
  PIN_DEPLOYMENT_JSON_BASE,
  type PinAddresses,
  loadPinAddresses,
} from "./pin.js";

loadDotenv();

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const STATUS_NAMES = ["AVAILABLE", "RESERVED", "REGISTERED"] as const;

export type Command = "check" | "commit" | "register" | "full";

export type CommitState = {
  label: string;
  owner: Address;
  secret: Hex;
  subregistry: Address;
  resolver: Address;
  duration: string;
  referrer: Hex;
  paymentToken: Address;
  commitment: Hex;
  commitTxHash: Hex;
  commitTime: number;
};

type WriteConfig = {
  privateKey: Hex;
  paymentTokenChoice: "MockDAI" | "MockUSDC";
  durationSeconds: bigint;
};

type EnvConfig = {
  command: Command;
  rpcUrl: string;
  write: WriteConfig | null;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export function parseLabel(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(
      "ENS_LABEL is required. Set it to the .eth label only, for example ENS_LABEL=horrortube. Refusing to default a name.",
    );
  }
  const trimmed = value.trim();
  if (trimmed.includes(".")) {
    throw new Error(
      `ENS_LABEL must be one label, not a full name. Got: ${trimmed}. The script registers that label under .eth.`,
    );
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(trimmed)) {
    throw new Error(
      `ENS_LABEL must be a single lowercase DNS label (letters, digits, internal hyphens). Got: ${trimmed}`,
    );
  }
  return trimmed;
}

export function parseCommand(argv: string[]): Command {
  const arg = argv[2];
  if (arg === undefined || arg.trim() === "") {
    throw new Error(
      "Command is required. Use: check | commit | register | full. Refusing to default a command.",
    );
  }
  if (arg === "check" || arg === "commit" || arg === "register" || arg === "full") {
    return arg;
  }
  throw new Error(`Unknown command "${arg}". Use: check | commit | register | full`);
}

export function requiredEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `${name} is required. Set it in .env. See .env.example. Refusing to fall back.`,
    );
  }
  return value.trim();
}

function parsePrivateKey(value: string): Hex {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!isHex(normalized) || normalized.length !== 66) {
    throw new Error(
      `PRIVATE_KEY must be a 32-byte hex string (0x + 64 hex chars). Got length ${normalized.length}`,
    );
  }
  return normalized;
}

export function parseDuration(value: string): bigint {
  if (!/^[0-9]+$/u.test(value)) {
    throw new Error(`DURATION_SECONDS must be an integer. Got: ${value}`);
  }
  return BigInt(value);
}

export function parsePaymentChoice(value: string): "MockDAI" | "MockUSDC" {
  if (value === "MockDAI" || value === "MockUSDC") {
    return value;
  }
  throw new Error(`PAYMENT_TOKEN must be MockDAI or MockUSDC. Got: ${value}`);
}

export function readEnv(argv: string[], env: NodeJS.ProcessEnv): EnvConfig {
  const command = parseCommand(argv);
  const rpcUrl = requiredEnv("SEPOLIA_RPC_URL", env);
  if (command === "check") {
    return { command, rpcUrl, write: null };
  }
  return {
    command,
    rpcUrl,
    write: {
      privateKey: parsePrivateKey(requiredEnv("PRIVATE_KEY", env)),
      paymentTokenChoice: parsePaymentChoice(requiredEnv("PAYMENT_TOKEN", env)),
      durationSeconds: parseDuration(requiredEnv("DURATION_SECONDS", env)),
    },
  };
}

export function commitStatePathForLabel(label: string): string {
  return join(dirname(fileURLToPath(import.meta.url)), ".ens-commit-state", `${label}.json`);
}

function writeCommitState(label: string, state: CommitState): void {
  const path = commitStatePathForLabel(label);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

export function parseCommitState(raw: unknown, expectedLabel: string, path: string): CommitState {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Commit state at ${path} is not an object`);
  }
  const record = raw as Record<string, unknown>;
  const required = [
    "label",
    "owner",
    "secret",
    "subregistry",
    "resolver",
    "duration",
    "referrer",
    "paymentToken",
    "commitment",
    "commitTxHash",
    "commitTime",
  ] as const;
  for (const key of required) {
    if (!(key in record)) {
      throw new Error(`Commit state missing field ${key}`);
    }
  }
  if (record.label !== expectedLabel) {
    throw new Error(`Commit state label is ${String(record.label)}, expected ${expectedLabel}`);
  }
  if (
    typeof record.owner !== "string" ||
    typeof record.secret !== "string" ||
    typeof record.subregistry !== "string" ||
    typeof record.resolver !== "string" ||
    typeof record.duration !== "string" ||
    typeof record.referrer !== "string" ||
    typeof record.paymentToken !== "string" ||
    typeof record.commitment !== "string" ||
    typeof record.commitTxHash !== "string" ||
    typeof record.commitTime !== "number"
  ) {
    throw new Error(`Commit state field types are wrong in ${path}`);
  }
  if (
    !isHex(record.secret) ||
    !isHex(record.referrer) ||
    !isHex(record.commitment) ||
    !isHex(record.commitTxHash)
  ) {
    throw new Error(`Commit state hex fields are invalid in ${path}`);
  }
  return {
    label: record.label,
    owner: getAddress(record.owner),
    secret: record.secret,
    subregistry: getAddress(record.subregistry),
    resolver: getAddress(record.resolver),
    duration: record.duration,
    referrer: record.referrer,
    paymentToken: getAddress(record.paymentToken),
    commitment: record.commitment,
    commitTxHash: record.commitTxHash,
    commitTime: record.commitTime,
  };
}

function readCommitState(label: string): CommitState {
  const path = commitStatePathForLabel(label);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Missing commit state at ${path}. Run commit first. Underlying error: ${String(error)}`);
  }
  try {
    return parseCommitState(raw, label, path);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main(): Promise<void> {
  let label: string;
  let env: EnvConfig;
  let pin: PinAddresses;
  try {
    label = parseLabel(process.env.ENS_LABEL);
    env = readEnv(process.argv, process.env);
    pin = loadPinAddresses();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  console.log(
    JSON.stringify(
      {
        pin: {
          contractsV2Commit: CONTRACTS_V2_COMMIT,
          deployedAt: PIN_DEPLOYED_AT,
          abiSource: `${PIN_DEPLOYMENT_JSON_BASE}/ETHRegistrar.json`,
          ETHRegistrar: pin.ETHRegistrar,
          ETHRegistry: pin.ETHRegistry,
          MockDAI: pin.MockDAI,
          MockUSDC: pin.MockUSDC,
          StandardRentPriceOracle: pin.StandardRentPriceOracle,
        },
        label: label,
        name: `${label}.eth`,
        command: env.command,
        rpcUrl: env.rpcUrl,
      },
      null,
      2,
    ),
  );

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(env.rpcUrl),
  });

  let blockNumber: bigint;
  try {
    blockNumber = await publicClient.getBlockNumber();
  } catch (error) {
    fail(
      `Sepolia RPC failed at ${env.rpcUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  console.log(`blockNumber=${blockNumber}`);

  const labelhash = keccak256(stringToBytes(label));
  let available: boolean;
  let status: number;
  let owner: Address;
  let minCommitmentAge: bigint;
  let maxCommitmentAge: bigint;
  let minRegisterDuration: bigint;
  try {
    const results = await Promise.all([
      publicClient.readContract({
        address: pin.ETHRegistrar,
        abi: ethRegistrarAbi,
        functionName: "isAvailable",
        args: [label],
      }),
      publicClient.readContract({
        address: pin.ETHRegistry,
        abi: ethRegistryAbi,
        functionName: "getStatus",
        args: [BigInt(labelhash)],
      }),
      publicClient.readContract({
        address: pin.ETHRegistry,
        abi: ethRegistryAbi,
        functionName: "findOwner",
        args: [label],
      }),
      publicClient.readContract({
        address: pin.ETHRegistrar,
        abi: ethRegistrarAbi,
        functionName: "MIN_COMMITMENT_AGE",
      }),
      publicClient.readContract({
        address: pin.ETHRegistrar,
        abi: ethRegistrarAbi,
        functionName: "MAX_COMMITMENT_AGE",
      }),
      publicClient.readContract({
        address: pin.ETHRegistrar,
        abi: ethRegistrarAbi,
        functionName: "MIN_REGISTER_DURATION",
      }),
    ]);
    available = Boolean(results[0]);
    status = Number(results[1]);
    owner = getAddress(String(results[2]));
    minCommitmentAge = BigInt(String(results[3]));
    maxCommitmentAge = BigInt(String(results[4]));
    minRegisterDuration = BigInt(String(results[5]));
  } catch (error) {
    fail(
      `ETHRegistry/ETHRegistrar read failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const statusName =
    status >= 0 && status < STATUS_NAMES.length ? STATUS_NAMES[status] : `UNKNOWN(${status})`;

  console.log(
    JSON.stringify(
      {
        labelhash,
        isAvailable: available,
        getStatus: statusName,
        findOwner: owner,
        MIN_COMMITMENT_AGE: minCommitmentAge.toString(),
        MAX_COMMITMENT_AGE: maxCommitmentAge.toString(),
        MIN_REGISTER_DURATION: minRegisterDuration.toString(),
      },
      null,
      2,
    ),
  );

  if (!available || statusName === "REGISTERED") {
    console.log(
      `TAKEN: ${label}.eth is not available on ETHRegistry ${pin.ETHRegistry} (status=${statusName}, owner=${owner})`,
    );
    if (env.command === "check") {
      return;
    }
    fail(`Cannot ${env.command}: name is taken`);
  }

  if (env.write === null) {
    console.log(
      `AVAILABLE: ${label}.eth can be registered. Required before pnpm ens:register full: ENS_LABEL, SEPOLIA_RPC_URL, PAYMENT_TOKEN, DURATION_SECONDS, PRIVATE_KEY.`,
    );
    return;
  }
  const write = env.write;

  if (write.durationSeconds < minRegisterDuration) {
    fail(
      `DURATION_SECONDS=${write.durationSeconds} is below MIN_REGISTER_DURATION=${minRegisterDuration}`,
    );
  }

  const paymentToken = write.paymentTokenChoice === "MockDAI" ? pin.MockDAI : pin.MockUSDC;

  const account = privateKeyToAccount(write.privateKey);
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(env.rpcUrl),
  });

  console.log(`wallet=${account.address}`);

  let ethBalance: bigint;
  let tokenBalance: bigint;
  let tokenDecimals: number;
  let tokenSymbol: string;
  let isPaymentToken: boolean;
  let base: bigint;
  let premium: bigint;
  try {
    const tokenMeta = await Promise.all([
      publicClient.getBalance({ address: account.address }),
      publicClient.readContract({
        address: paymentToken,
        abi: mockErc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      }),
      publicClient.readContract({
        address: paymentToken,
        abi: mockErc20Abi,
        functionName: "decimals",
      }),
      publicClient.readContract({
        address: paymentToken,
        abi: mockErc20Abi,
        functionName: "symbol",
      }),
      publicClient.readContract({
        address: pin.StandardRentPriceOracle,
        abi: standardRentPriceOracleAbi,
        functionName: "isPaymentToken",
        args: [paymentToken],
      }),
      publicClient.readContract({
        address: pin.ETHRegistrar,
        abi: ethRegistrarAbi,
        functionName: "getRegisterPrice",
        args: [label, write.durationSeconds, paymentToken],
      }),
    ]);
    ethBalance = tokenMeta[0];
    tokenBalance = BigInt(String(tokenMeta[1]));
    tokenDecimals = Number(tokenMeta[2]);
    tokenSymbol = String(tokenMeta[3]);
    isPaymentToken = Boolean(tokenMeta[4]);
    const price = tokenMeta[5];
    if (!Array.isArray(price) || price.length < 2) {
      fail(`getRegisterPrice returned unexpected value: ${String(price)}`);
    }
    base = BigInt(String(price[0]));
    premium = BigInt(String(price[1]));
  } catch (error) {
    fail(`Balance/price read failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const totalCost = base + premium;
  console.log(
    JSON.stringify(
      {
        paymentToken,
        paymentTokenChoice: write.paymentTokenChoice,
        isPaymentToken,
        tokenSymbol,
        tokenDecimals,
        ethBalanceWei: ethBalance.toString(),
        ethBalanceEther: formatEther(ethBalance),
        tokenBalance: tokenBalance.toString(),
        tokenBalanceFormatted: formatUnits(tokenBalance, tokenDecimals),
        registerPriceBase: base.toString(),
        registerPricePremium: premium.toString(),
        registerPriceTotal: totalCost.toString(),
        registerPriceTotalFormatted: formatUnits(totalCost, tokenDecimals),
        durationSeconds: write.durationSeconds.toString(),
      },
      null,
      2,
    ),
  );

  if (!isPaymentToken) {
    fail(
      `DISAGREEMENT: StandardRentPriceOracle.isPaymentToken(${paymentToken}) is false at pin ${CONTRACTS_V2_COMMIT}`,
    );
  }

  if (ethBalance === 0n) {
    fail(
      [
        "Missing Sepolia ETH for gas.",
        `wallet=${account.address}`,
        `balanceWei=0`,
        "Fund Sepolia ETH first (ETHGlobal faucet https://ethglobal.com/faucet, Google Cloud https://cloud.google.com/application/web3/faucet/ethereum/sepolia, or PoW https://sepolia-faucet.pk910.de).",
      ].join("\n"),
    );
  }

  if (tokenBalance < totalCost) {
    fail(
      [
        `Missing ${tokenSymbol} payment token balance for register.`,
        `wallet=${account.address}`,
        `token=${paymentToken} (${write.paymentTokenChoice})`,
        `balance=${tokenBalance.toString()} (${formatUnits(tokenBalance, tokenDecimals)} ${tokenSymbol})`,
        `required=${totalCost.toString()} (${formatUnits(totalCost, tokenDecimals)} ${tokenSymbol})`,
        `shortfall=${(totalCost - tokenBalance).toString()}`,
        "Quote: ETHRegistrar.register pulls IERC20 via safeTransferFrom (contracts/src/registrar/ETHRegistrar.sol at pin 71a3b733).",
        `Mint publicly with MockERC20.mint(address,uint256) on ${paymentToken}:`,
        `  cast send ${paymentToken} "mint(address,uint256)" ${account.address} ${totalCost.toString()} --rpc-url ${env.rpcUrl} --private-key $PRIVATE_KEY`,
        "Or from this wallet after funding ETH, any account can call mint (pin MockERC20.sol).",
      ].join("\n"),
    );
  }

  if (env.command === "commit" || env.command === "full") {
    const secret = keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))));
    const subregistry = ZERO_ADDRESS;
    const resolver = ZERO_ADDRESS;
    const referrer = ZERO_BYTES32;
    const duration = write.durationSeconds;

    let commitment: Hex;
    try {
      commitment = (await publicClient.readContract({
        address: pin.ETHRegistrar,
        abi: ethRegistrarAbi,
        functionName: "makeCommitment",
        args: [label, account.address, secret, subregistry, resolver, duration, referrer],
      })) as Hex;
    } catch (error) {
      fail(`makeCommitment failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log(`commitment=${commitment}`);

    let commitTxHash: Hex;
    try {
      commitTxHash = await walletClient.writeContract({
        address: pin.ETHRegistrar,
        abi: ethRegistrarAbi,
        functionName: "commit",
        args: [commitment],
      });
    } catch (error) {
      fail(`commit() failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log(`commitTxHash=${commitTxHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: commitTxHash,
    });
    if (receipt.status !== "success") {
      fail(`commit tx reverted: ${commitTxHash}`);
    }

    const commitTime = Math.floor(Date.now() / 1000);
    writeCommitState(label, {
      label: label,
      owner: account.address,
      secret,
      subregistry,
      resolver,
      duration: duration.toString(),
      referrer,
      paymentToken,
      commitment,
      commitTxHash,
      commitTime,
    });
    console.log(`wrote ${commitStatePathForLabel(label)}`);

    if (env.command === "commit") {
      console.log(
        `Committed. Wait at least MIN_COMMITMENT_AGE=${minCommitmentAge}s then: pnpm ens:register register`,
      );
      return;
    }

    const waitMs = Number(minCommitmentAge) * 1000 + 2000;
    console.log(`waiting ${waitMs}ms for MIN_COMMITMENT_AGE`);
    await sleep(waitMs);
  }

  if (env.command === "register" || env.command === "full") {
    const state = readCommitState(label);
    if (getAddress(state.owner) !== getAddress(account.address)) {
      fail(`Commit state owner ${state.owner} != wallet ${account.address}`);
    }
    if (getAddress(state.paymentToken) !== paymentToken) {
      fail(
        `Commit state paymentToken ${state.paymentToken} != selected ${paymentToken}. Re-run with matching PAYMENT_TOKEN or re-commit.`,
      );
    }

    const age = Math.floor(Date.now() / 1000) - state.commitTime;
    if (BigInt(age) < minCommitmentAge) {
      fail(
        `Commitment too new: age=${age}s MIN_COMMITMENT_AGE=${minCommitmentAge}s. Wait and retry register.`,
      );
    }
    if (BigInt(age) > maxCommitmentAge) {
      fail(
        `Commitment too old: age=${age}s MAX_COMMITMENT_AGE=${maxCommitmentAge}s. Re-run commit.`,
      );
    }

    let allowance: bigint;
    try {
      allowance = BigInt(
        String(
          await publicClient.readContract({
            address: paymentToken,
            abi: mockErc20Abi,
            functionName: "allowance",
            args: [account.address, pin.ETHRegistrar],
          }),
        ),
      );
    } catch (error) {
      fail(`allowance read failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (allowance < totalCost) {
      console.log(`approving ETHRegistrar for ${totalCost.toString()} ${tokenSymbol}`);
      let approveHash: Hex;
      try {
        approveHash = await walletClient.writeContract({
          address: paymentToken,
          abi: mockErc20Abi,
          functionName: "approve",
          args: [pin.ETHRegistrar, totalCost],
        });
      } catch (error) {
        fail(`approve failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      console.log(`approveTxHash=${approveHash}`);
      const approveReceipt = await publicClient.waitForTransactionReceipt({
        hash: approveHash,
      });
      if (approveReceipt.status !== "success") {
        fail(`approve tx reverted: ${approveHash}`);
      }
    }

    let registerHash: Hex;
    try {
      registerHash = await walletClient.writeContract({
        address: pin.ETHRegistrar,
        abi: ethRegistrarAbi,
        functionName: "register",
        args: [
          state.label,
          state.owner,
          state.secret,
          state.subregistry,
          state.resolver,
          BigInt(state.duration),
          state.paymentToken,
          state.referrer,
        ],
      });
    } catch (error) {
      fail(`register() failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log(`registerTxHash=${registerHash}`);
    const registerReceipt = await publicClient.waitForTransactionReceipt({
      hash: registerHash,
    });
    if (registerReceipt.status !== "success") {
      fail(`register tx reverted: ${registerHash}`);
    }

    const postStatus = Number(
      await publicClient.readContract({
        address: pin.ETHRegistry,
        abi: ethRegistryAbi,
        functionName: "getStatus",
        args: [BigInt(labelhash)],
      }),
    );
    const postOwner = getAddress(
      String(
        await publicClient.readContract({
          address: pin.ETHRegistry,
          abi: ethRegistryAbi,
          functionName: "findOwner",
          args: [label],
        }),
      ),
    );
    const postStatusName =
      postStatus >= 0 && postStatus < STATUS_NAMES.length
        ? STATUS_NAMES[postStatus]
        : `UNKNOWN(${postStatus})`;

    console.log(
      JSON.stringify(
        {
          registered: true,
          getStatus: postStatusName,
          findOwner: postOwner,
          registerTxHash: registerHash,
        },
        null,
        2,
      ),
    );

    if (postStatusName !== "REGISTERED") {
      fail(`register tx succeeded but getStatus is ${postStatusName}, expected REGISTERED`);
    }
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    fail(
      `Unhandled error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  });
}
