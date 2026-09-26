import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, normalizeStructTag, normalizeSuiAddress } from "@mysten/sui/utils";

import { HttpError } from "./http-error.js";

const SUI_FRAMEWORK = normalizeSuiAddress("0x2");

type TxData = ReturnType<Transaction["getData"]>;
type Command = TxData["commands"][number];
type TxInput = TxData["inputs"][number];
type Call = NonNullable<Command["MoveCall"]>;
type CallArg = Call["arguments"][number];

function forbidden(detail: string): HttpError {
  return new HttpError(
    403,
    `Only a USDC transfer to the coin box or a call to the betting package is allowed. ${detail}`,
  );
}

function badKind(detail: string): HttpError {
  return new HttpError(400, `Transaction kind could not be read. ${detail}`);
}

function inputAt(inputs: readonly TxInput[], index: number): TxInput {
  const input = inputs[index];
  if (input === undefined) throw badKind(`Missing input ${String(index)}.`);
  return input;
}

function coinKey(arg: CallArg): string | undefined {
  if (arg.$kind === "Result") return String(arg.Result);
  if (arg.$kind === "NestedResult") return `${String(arg.NestedResult[0])}:${String(arg.NestedResult[1])}`;
  return undefined;
}

function isUsdcCoin(arg: CallArg, usdcCoins: ReadonlySet<string>): boolean {
  const key = coinKey(arg);
  return key !== undefined && usdcCoins.has(key);
}

function pureAddress(arg: CallArg, inputs: readonly TxInput[]): string {
  if (arg.$kind !== "Input") throw forbidden("USDC recipient was not an address input.");
  const input = inputAt(inputs, arg.Input);
  if (input.$kind !== "Pure") throw forbidden("USDC recipient was not an address.");
  try {
    return normalizeSuiAddress(bcs.Address.parse(fromBase64(input.Pure.bytes)));
  } catch (err) {
    throw badKind(
      `Address bytes could not be decoded. Underlying: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function requireSenderUsdcWithdrawal(arg: CallArg, inputs: readonly TxInput[], usdcType: string): void {
  if (arg.$kind !== "Input") throw forbidden("USDC redeem_funds did not withdraw from the sender.");
  const input = inputAt(inputs, arg.Input);
  if (input.$kind !== "FundsWithdrawal") throw forbidden("USDC redeem_funds did not withdraw from the sender.");
  const withdrawal = input.FundsWithdrawal;
  if (withdrawal.withdrawFrom.$kind !== "Sender") {
    throw forbidden("USDC redeem_funds must withdraw from the sender.");
  }
  if (withdrawal.typeArg.$kind !== "Balance" || normalizeStructTag(withdrawal.typeArg.Balance) !== usdcType) {
    throw forbidden("redeem_funds withdrew a coin other than USDC.");
  }
}

function checkFrameworkCoin(
  call: Call,
  inputs: readonly TxInput[],
  usdcCoins: ReadonlySet<string>,
  usdcType: string,
  coinBox: string,
): void {
  if (call.module !== "coin") throw forbidden(`MoveCall ${call.package}::${call.module}::${call.function}`);
  if (call.typeArguments.length !== 1 || normalizeStructTag(call.typeArguments[0] ?? "") !== usdcType) {
    throw forbidden(`MoveCall ${call.package}::${call.module}::${call.function} was not USDC.`);
  }
  if (call.function === "redeem_funds") {
    const arg = call.arguments[0];
    if (arg === undefined || call.arguments.length !== 1) {
      throw forbidden("USDC redeem_funds arguments were not a single withdrawal.");
    }
    requireSenderUsdcWithdrawal(arg, inputs, usdcType);
    return;
  }
  if (call.function === "send_funds") {
    const coin = call.arguments[0];
    const recipient = call.arguments[1];
    if (coin === undefined || recipient === undefined || call.arguments.length !== 2) {
      throw forbidden("USDC send_funds arguments were not a coin and an address.");
    }
    if (!isUsdcCoin(coin, usdcCoins)) throw forbidden("send_funds coin was not USDC from this transaction.");
    if (pureAddress(recipient, inputs) !== coinBox) {
      throw forbidden("USDC send_funds recipient was not the coin box.");
    }
    return;
  }
  throw forbidden(`MoveCall ${call.package}::${call.module}::${call.function}`);
}

export function assertSponsorableKind(
  txKind: string,
  coinBox: string,
  usdcType: string,
  bettingPackageId: string | undefined,
): void {
  const box = normalizeSuiAddress(coinBox);
  const usdc = normalizeStructTag(usdcType);
  const betting =
    bettingPackageId === undefined ? undefined : normalizeSuiAddress(bettingPackageId);
  let tx: Transaction;
  try {
    tx = Transaction.fromKind(txKind);
  } catch (err) {
    throw badKind(err instanceof Error ? err.message : String(err));
  }
  const data = tx.getData();
  if (data.commands.length === 0) throw forbidden("Transaction kind was empty.");
  const usdcCoins = new Set<string>();
  for (let index = 0; index < data.commands.length; index += 1) {
    const command = data.commands[index];
    if (command === undefined) throw badKind(`Missing command ${String(index)}.`);
    switch (command.$kind) {
      case "MoveCall": {
        const call = command.MoveCall;
        if (call === undefined) throw badKind("MoveCall had no payload.");
        if (normalizeSuiAddress(call.package) === SUI_FRAMEWORK) {
          checkFrameworkCoin(call, data.inputs, usdcCoins, usdc, box);
          if (call.function === "redeem_funds") usdcCoins.add(String(index));
          break;
        }
        if (betting === undefined) {
          throw new HttpError(
            500,
            "BETTING_PACKAGE_ID is required. Set it in .env. See .env.example.",
          );
        }
        if (normalizeSuiAddress(call.package) !== betting) {
          throw forbidden(`MoveCall ${call.package}::${call.module}::${call.function}`);
        }
        break;
      }
      case "SplitCoins": {
        const split = command.SplitCoins;
        if (split === undefined) throw badKind("SplitCoins had no payload.");
        if (!isUsdcCoin(split.coin, usdcCoins)) {
          throw forbidden("SplitCoins coin was not USDC from this transaction.");
        }
        for (let i = 0; i < split.amounts.length; i += 1) {
          usdcCoins.add(`${String(index)}:${String(i)}`);
        }
        break;
      }
      case "MergeCoins": {
        const merge = command.MergeCoins;
        if (merge === undefined) throw badKind("MergeCoins had no payload.");
        if (!isUsdcCoin(merge.destination, usdcCoins)) {
          throw forbidden("MergeCoins destination was not USDC from this transaction.");
        }
        for (const source of merge.sources) {
          if (!isUsdcCoin(source, usdcCoins)) {
            throw forbidden("MergeCoins source was not USDC from this transaction.");
          }
        }
        break;
      }
      case "TransferObjects": {
        const transfer = command.TransferObjects;
        if (transfer === undefined) throw badKind("TransferObjects had no payload.");
        if (transfer.objects.length === 0) throw forbidden("TransferObjects had no objects.");
        for (const object of transfer.objects) {
          if (!isUsdcCoin(object, usdcCoins)) {
            throw forbidden("TransferObjects moved an object other than USDC from this transaction.");
          }
        }
        if (pureAddress(transfer.address, data.inputs) !== box) {
          throw forbidden("USDC recipient was not the coin box.");
        }
        break;
      }
      default:
        throw forbidden(`Command ${command.$kind} is not allowed.`);
    }
  }
}
