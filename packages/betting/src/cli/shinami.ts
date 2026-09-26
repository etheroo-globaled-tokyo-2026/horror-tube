import { createHmac } from "node:crypto";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { KeyClient, ShinamiWalletSigner, WalletClient } from "@shinami/clients/sui";
import { requiredEnv } from "../env.js";
import { succeeded } from "../execute.js";

export async function gaslessWallet(client: SuiGrpcClient, walletId: string) {
  const key = requiredEnv("SHINAMI_ACCESS_KEY");
  const secret = createHmac("sha256", requiredEnv("WALLET_SECRET_PEPPER"))
    .update(`cli:${walletId}`)
    .digest("hex");
  const signer = new ShinamiWalletSigner(
    walletId,
    new WalletClient(key),
    secret,
    new KeyClient(key),
  );
  const address = await signer.getAddress(true);
  return {
    address,
    run: async (tx: Transaction): Promise<string> => {
      tx.setSender(address);
      const kind = await tx.build({
        client,
        onlyTransactionKind: true,
        assumeSufficientAddressBalances: true,
      });
      const response = await signer.executeGaslessTransaction({ txKind: toBase64(kind) }, [
        "transaction.digest",
      ]);
      const digest = response.transaction?.digest;
      if (digest === undefined || digest === "")
        throw new Error("Shinami executeGaslessTransaction returned no digest.");
      succeeded(await client.waitForTransaction({ digest }));
      return digest;
    },
  };
}
