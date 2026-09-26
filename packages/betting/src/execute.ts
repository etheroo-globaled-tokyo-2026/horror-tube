import type { SuiClientTypes } from "@mysten/sui/client";
import type { Signer } from "@mysten/sui/cryptography";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Transaction } from "@mysten/sui/transactions";

export type Executed = SuiClientTypes.Transaction<{ effects: true; objectTypes: true }>;

export function succeeded<Include extends SuiClientTypes.TransactionInclude>(
  result: SuiClientTypes.TransactionResult<Include>,
): SuiClientTypes.Transaction<Include> {
  if (result.$kind === "FailedTransaction")
    throw new Error(
      `Transaction ${result.FailedTransaction.digest} aborted: ${result.FailedTransaction.status.error?.message ?? "no error message"}`,
    );
  return result.Transaction;
}

export async function execute(
  client: SuiGrpcClient,
  signer: Signer,
  transaction: Transaction,
): Promise<Executed> {
  const executed = succeeded(
    await client.signAndExecuteTransaction({
      transaction,
      signer,
      include: { effects: true, objectTypes: true },
    }),
  );
  await client.waitForTransaction({ digest: executed.digest });
  return executed;
}

export function createdId(result: Executed, typeFragment: string): string {
  const ids = result.effects.changedObjects
    .filter(
      (change) =>
        change.idOperation === "Created" &&
        result.objectTypes[change.objectId]?.includes(typeFragment),
    )
    .map((change) => change.objectId);
  const [id] = ids;
  if (ids.length !== 1 || id === undefined)
    throw new Error(
      `Expected one created ${typeFragment} in ${result.digest}, found ${ids.length}.`,
    );
  return id;
}

export function publishedPackageId(result: Executed): string {
  const change = result.effects.changedObjects.find((c) => c.outputState === "PackageWrite");
  if (change === undefined) throw new Error(`No package in ${result.digest}.`);
  return change.objectId;
}
