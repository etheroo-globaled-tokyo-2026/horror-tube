import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { createClient, readNetwork, requiredEnv } from "../env.js";
import { PoolStatus, getPool, listTickets } from "../objects.js";
import { payout } from "../payout.js";
import { betTx, claimTx } from "../transactions.js";
import { getBetting, waitForBetPhase } from "./game-api.js";
import { USAGE, formatUsdc, parsePlayerArgs, sideLetter, type PlayerArgs } from "./player-args.js";
import { gaslessWallet } from "./shinami.js";

const ShinamiFailure = z.object({ message: z.string(), data: z.object({ details: z.string() }) });

async function attempt<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const shinami = ShinamiFailure.safeParse(error);
    const reason = shinami.success
      ? `${shinami.data.message}: ${shinami.data.data.details}`
      : error instanceof Error
        ? error.message
        : String(error);
    throw new Error(`${what} failed: ${reason}`, { cause: error });
  }
}

let args: PlayerArgs;
try {
  args = parsePlayerArgs(process.argv.slice(2));
} catch (error) {
  console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
  process.exit(1);
}

const network = readNetwork();
const client = createClient({ network, grpcUrl: requiredEnv("SUI_GRPC_URL") });
console.log(`Reading the betting IDs from ${args.gameUrl}/betting…`);
const betting = await getBetting(args.gameUrl, fetch);
if (betting.network !== network)
  throw new Error(
    `The game server at ${args.gameUrl} bets on ${betting.network}, but SUI_NETWORK is ${network}.`,
  );
const ids = { packageId: betting.packageId, houseId: betting.houseId, coinType: betting.coinType };
console.log(`Opening Shinami wallet ${args.walletId}…`);
const player = await gaslessWallet(client, args.walletId);
console.log(`Player ${args.walletId} is ${player.address}.`);

async function printBalance(): Promise<void> {
  const { balance } = await client.core.getBalance({
    owner: player.address,
    coinType: ids.coinType,
  });
  console.log(
    `Balance: ${formatUsdc(BigInt(balance.balance))} USDC of ${ids.coinType} (${balance.addressBalance} base units in the address balance, ${balance.coinBalance} in coins).`,
  );
}

const { command } = args;
if (command.name === "address") {
  await printBalance();
  console.log(`Fund it with: pnpm test-usdc:mint ${player.address} <units>`);
} else if (command.name === "bet") {
  const letter = sideLetter(BigInt(command.side));
  console.log(
    `Waiting up to ${args.timeoutMs / 60_000} min for a bout's bet phase with a pool at ${args.gameUrl}/round…`,
  );
  const bout = await waitForBetPhase(args.gameUrl, args.timeoutMs, {
    fetch,
    now: Date.now,
    sleep,
    log: console.log,
  });
  console.log(
    `Round ${bout.round}, battle ${bout.battleId}, pool ${bout.poolId}: betting ${formatUsdc(command.units)} USDC on side ${letter} (fighter ${bout.fighters[command.side]})…`,
  );
  const digest = await attempt(
    `Bet of ${command.units} base units on side ${letter} of pool ${bout.poolId}`,
    () => player.run(betTx(ids, bout.poolId, command.side, command.units)),
  );
  const pool = await getPool(client, bout.poolId);
  if (pool === null) throw new Error(`Pool ${bout.poolId} is missing after bet ${digest}.`);
  console.log(
    `Bet placed in ${digest}. Pool totals: A ${formatUsdc(pool.totals[0])} USDC, B ${formatUsdc(pool.totals[1])} USDC.`,
  );
  await printBalance();
} else {
  console.log(`Listing ${player.address}'s tickets…`);
  const tickets = await listTickets(client, ids, player.address);
  const read = await Promise.all(
    tickets.map(async (ticket) => ({ ticket, pool: await getPool(client, ticket.poolId) })),
  );
  const finished = read.flatMap(({ ticket, pool }) => {
    if (pool === null) {
      console.log(`Skipping ticket ${ticket.id}: its pool ${ticket.poolId} is missing.`);
      return [];
    }
    if (pool.status === PoolStatus.open) {
      console.log(`Skipping ticket ${ticket.id}: battle ${pool.battleId} is not finished.`);
      return [];
    }
    return [{ ticket, pool, owed: payout(pool, ticket) }];
  });
  if (finished.length === 0) console.log(`Nothing to collect from ${tickets.length} tickets.`);
  else {
    console.log(`Claiming ${finished.length} finished tickets…`);
    const claim = claimTx(
      ids,
      finished.map(({ ticket }) => ticket),
    );
    const digest = await attempt(`Claim of ${finished.length} tickets`, () => player.run(claim));
    for (const { ticket, pool, owed } of finished)
      console.log(
        `  ${ticket.id}: battle ${pool.battleId}, side ${sideLetter(ticket.side)}, staked ${formatUsdc(ticket.stake)}, paid ${formatUsdc(owed)} USDC (${pool.status === PoolStatus.cancelled ? "cancelled" : `side ${sideLetter(pool.winningSide)} won`}).`,
      );
    const paid = finished.reduce((sum, { owed }) => sum + owed, 0n);
    console.log(`Collected ${formatUsdc(paid)} USDC in ${digest}.`);
    await printBalance();
  }
}
