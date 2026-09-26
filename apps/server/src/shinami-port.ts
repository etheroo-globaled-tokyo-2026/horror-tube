import type { GrpcTypes } from "@mysten/sui/grpc";
import { GasStationClient, KeyClient, WalletClient } from "@shinami/clients/sui";
import * as v from "valibot";

import { HttpError } from "./http-error.js";

const RpcData = v.union([v.string(), v.object({ details: v.optional(v.string()) })]);

const RpcErr = v.object({
  message: v.string(),
  data: v.optional(RpcData),
});

export function shinamiErrorText(err: Error): string {
  const parsed = v.safeParse(RpcErr, err);
  if (!parsed.success) return err.message;
  const data = parsed.output.data;
  if (data === undefined) return parsed.output.message;
  if (v.is(v.string(), data)) return `${parsed.output.message} ${data}`;
  if (data.details === undefined) return parsed.output.message;
  return `${parsed.output.message} ${data.details}`;
}

export function isWalletAlreadyExists(err: Error): boolean {
  return /wallet id already exists/iu.test(shinamiErrorText(err));
}

export function gaslessError(err: Error): Error {
  const text = shinamiErrorText(err);
  if (
    /unauthor|invalid access key|invalid api key|authentication|not authorized|permission denied/iu.test(
      text,
    )
  ) {
    return new Error(
      `Shinami gasless transaction failed with an auth error. Create a Node Service key in the Shinami dashboard. It is not on the Gas Station form. Underlying: ${text}`,
    );
  }
  return new Error(`Shinami gasless transaction failed. Underlying: ${text}`);
}

export function gaslessDigest(response: GrpcTypes.ExecuteTransactionResponse): string {
  const digest = response.transaction?.transaction?.digest;
  if (digest === undefined || digest === "") {
    throw new Error("Shinami executeGaslessTransaction returned no transaction digest.");
  }
  return digest;
}

export function sponsorError(err: Error): HttpError {
  const text = shinamiErrorText(err);
  return new HttpError(
    /^invalid params/iu.test(text) ? 400 : 502,
    `Shinami could not sponsor the deposit. Underlying: ${text}`,
  );
}

export type SponsoredDeposit = { txBytes: string; signature: string; digest: string };

export type ShinamiPort = {
  createSession(secret: string): Promise<string>;
  createWallet(walletId: string, sessionToken: string): Promise<string>;
  getWallet(walletId: string): Promise<string>;
  executeGaslessTransaction(
    walletId: string,
    sessionToken: string,
    txKind: string,
  ): Promise<string>;
  sponsorTransaction(txKind: string, sender: string): Promise<SponsoredDeposit>;
};

export function shinamiPort(accessKey: string): ShinamiPort {
  const keyClient = new KeyClient(accessKey);
  const walletClient = new WalletClient(accessKey);
  const gasClient = new GasStationClient(accessKey);
  return {
    createSession(secret: string): Promise<string> {
      return keyClient.createSession(secret);
    },
    createWallet(walletId: string, sessionToken: string): Promise<string> {
      return walletClient.createWallet(walletId, sessionToken);
    },
    getWallet(walletId: string): Promise<string> {
      return walletClient.getWallet(walletId);
    },
    async executeGaslessTransaction(
      walletId: string,
      sessionToken: string,
      txKind: string,
    ): Promise<string> {
      const response = await walletClient.executeGaslessTransaction(
        walletId,
        sessionToken,
        { txKind },
        ["transaction.digest"],
      );
      return gaslessDigest(response);
    },
    async sponsorTransaction(txKind: string, sender: string): Promise<SponsoredDeposit> {
      const sponsored = await gasClient.sponsorTransaction({ txKind, sender });
      return {
        txBytes: sponsored.txBytes,
        signature: sponsored.signature,
        digest: sponsored.txDigest,
      };
    },
  };
}
