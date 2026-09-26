import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import * as v from "valibot";

export const WALLET_SESSION_KEY = "horror-tube.wallet-session";

export const USDC_DECIMALS = 6;

export const SUI_TESTNET_GRPC = "https://fullnode.testnet.sui.io:443";

export type SessionStore = Pick<Storage, "getItem" | "setItem">;

export type GameWallet = {
  address: string;
  client: SuiGrpcClient;
  session: string;
};

const SessionResponse = v.object({ session: v.pipe(v.string(), v.minLength(1)) });
const AddressResponse = v.object({ address: v.pipe(v.string(), v.minLength(1)) });
const DigestResponse = v.object({ digest: v.pipe(v.string(), v.minLength(1)) });
const ErrorResponse = v.object({ error: v.string() });

function suiClient(): SuiGrpcClient {
  return new SuiGrpcClient({
    network: "testnet",
    baseUrl: SUI_TESTNET_GRPC,
  });
}

function storedSession(store: SessionStore): string {
  const session = store.getItem(WALLET_SESSION_KEY);
  if (session === null || session.trim() === "") {
    throw new Error("World ID session is required. Finish the waiver scan first.");
  }
  return session;
}

export function hasWalletSession(store: SessionStore = localStorage): boolean {
  const session = store.getItem(WALLET_SESSION_KEY);
  return session !== null && session.trim() !== "";
}

async function postSchema<TSchema extends v.GenericSchema>(
  fetchImpl: typeof fetch,
  path: string,
  body: string | null,
  session: string | null,
  schema: TSchema,
): Promise<v.InferOutput<TSchema>> {
  const headers = { "content-type": "application/json" };
  if (session !== null) {
    Object.assign(headers, { authorization: `Bearer ${session}` });
  }
  const res = await fetchImpl(path, {
    method: "POST",
    headers,
    body: body ?? "{}",
  });
  const text = await res.text();
  let json: v.InferOutput<TSchema> | undefined;
  try {
    const parsed = v.safeParse(schema, JSON.parse(text));
    if (parsed.success) json = parsed.output;
  } catch (err) {
    throw new Error(
      `POST ${path} returned non-JSON. HTTP ${String(res.status)}. Underlying: ${err instanceof Error ? err.message : String(err)} body=${text}`,
    );
  }
  if (!res.ok) {
    let message = text;
    try {
      const errorBody = v.safeParse(ErrorResponse, JSON.parse(text));
      if (errorBody.success) message = errorBody.output.error;
    } catch {
      message = text;
    }
    throw new Error(`POST ${path} failed: HTTP ${String(res.status)} ${message}`);
  }
  if (json === undefined) {
    throw new Error(`POST ${path} response did not match the expected fields. body=${text}`);
  }
  return json;
}

async function walletFromSession(session: string, fetchImpl: typeof fetch): Promise<GameWallet> {
  const body = await postSchema(fetchImpl, "/wallet", null, session, AddressResponse);
  return {
    address: body.address,
    session,
    client: suiClient(),
  };
}

export async function openGameWallet(
  idkitResultJson: string,
  store: SessionStore = localStorage,
  fetchImpl: typeof fetch = fetch,
): Promise<GameWallet> {
  const login = await postSchema(
    fetchImpl,
    "/auth/world-id",
    idkitResultJson,
    null,
    SessionResponse,
  );
  store.setItem(WALLET_SESSION_KEY, login.session);
  return walletFromSession(login.session, fetchImpl);
}

export async function getGameWallet(
  store: SessionStore = localStorage,
  fetchImpl: typeof fetch = fetch,
): Promise<GameWallet> {
  return walletFromSession(storedSession(store), fetchImpl);
}

export async function getUsdcBalance(wallet: GameWallet, coinType: string): Promise<bigint> {
  const { balance } = await wallet.client.core.getBalance({
    owner: wallet.address,
    coinType,
  });
  return BigInt(balance.balance);
}

export function toUsdcUnits(dollars: number): bigint {
  return BigInt(Math.round(dollars * 10 ** USDC_DECIMALS));
}

export function fromUsdcUnits(units: bigint): number {
  return Number(units) / 10 ** USDC_DECIMALS;
}

export function usdcTransfer(coinType: string, to: string, units: bigint): Transaction {
  const tx = new Transaction();
  tx.transferObjects([coinWithBalance({ type: coinType, balance: units, useGasCoin: false })], to);
  return tx;
}

export function usdcDeposit(coinType: string, to: string, units: bigint): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: "0x2::coin::send_funds",
    typeArguments: [coinType],
    arguments: [
      coinWithBalance({ type: coinType, balance: units, useGasCoin: false }),
      tx.pure.address(to),
    ],
  });
  return tx;
}

/** Build a gasless kind, POST /tx, wait for the digest. Returns the digest. */
export async function runKind(
  wallet: GameWallet,
  tx: Transaction,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  tx.setSender(wallet.address);
  const bytes = await tx.build({
    client: wallet.client,
    onlyTransactionKind: true,
    assumeSufficientAddressBalances: true,
  });
  const paid = await postSchema(
    fetchImpl,
    "/tx",
    JSON.stringify({ txKind: toBase64(bytes) }),
    wallet.session,
    DigestResponse,
  );
  await wallet.client.waitForTransaction({ digest: paid.digest });
  return paid.digest;
}

export async function sendUsdc(
  wallet: GameWallet,
  coinType: string,
  to: string,
  units: bigint,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await runKind(wallet, usdcTransfer(coinType, to, units), fetchImpl);
}
