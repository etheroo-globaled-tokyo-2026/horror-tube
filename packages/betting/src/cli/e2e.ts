import assert from "node:assert/strict";
import { Transaction } from "@mysten/sui/transactions";
import { createClient, readBettingConfig, readKeypair, readUnits, requiredEnv } from "../env.js";
import { execute } from "../execute.js";
import { PoolStatus, listTickets } from "../objects.js";
import { createChain, createOperator } from "../operator.js";
import { payout } from "../payout.js";
import { betTx, claimTx } from "../transactions.js";
import { gaslessWallet } from "./shinami.js";

const config = readBettingConfig();
const client = createClient(config);
const admin = readKeypair("SUI_ADMIN_PRIVATE_KEY");
const minBet = readUnits("SUI_MIN_BET");
const operator = createOperator(
  createChain(client, admin),
  config,
  requiredEnv("SUI_E2E_OPERATOR_CAP_ID"),
);
const player = await gaslessWallet(client, "horror-tube-e2e");
const battleId = `e2e-${new Date().toISOString()}`;
const usdc = async (): Promise<bigint> =>
  BigInt(
    (await client.core.getBalance({ owner: player.address, coinType: config.coinType })).balance
      .balance,
  );

console.log(
  `Funding ${player.address} with ${3n * minBet} USDC base units in its address balance…`,
);
const fund = new Transaction();
fund.moveCall({
  target: "0x2::coin::send_funds",
  typeArguments: [config.coinType],
  arguments: [
    fund.coin({ type: config.coinType, balance: 3n * minBet, useGasCoin: false }),
    fund.pure.address(player.address),
  ],
});
await execute(client, admin, fund);

const before = await usdc();
const pool = operator.poolId(battleId);
console.log(`Battle ${battleId}, pool ${pool}`);
await operator.openPool(battleId, BigInt(Date.now() + 10 * 60_000));
console.log(`bet side 0: ${await player.run(betTx(config, pool, 0, 2n * minBet))}`);
console.log(`bet side 1: ${await player.run(betTx(config, pool, 1, minBet))}`);

await operator.closeBetting(battleId);
await operator.settle(battleId, 0);
const settled = await operator.read(battleId);
assert.equal(settled.status, PoolStatus.settled);
const tickets = (await listTickets(client, config, player.address)).filter(
  (t) => t.poolId === pool,
);
assert.equal(tickets.length, 2);
const owed = tickets.reduce((sum, ticket) => sum + payout(settled, ticket), 0n);
console.log(`claim: ${await player.run(claimTx(config, tickets))}`);

assert.equal((await usdc()) - before, owed - 3n * minBet);
assert.equal(owed - 3n * minBet, -settled.fee);
console.log(`e2e passed: fee ${settled.fee}, paid out ${owed}.`);
