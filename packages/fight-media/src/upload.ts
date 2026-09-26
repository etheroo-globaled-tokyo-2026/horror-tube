import { randomUUID } from "node:crypto";

import { PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";

import { type FightMediaConfig, readFightMediaConfig } from "./env.js";
import { fightMediaCdnUrl, videoObjectKey } from "./keys.js";

export type PutFightVideoInput = {
  Bucket: string;
  Key: string;
  Body: Uint8Array;
  ACL: "public-read";
  ContentType: "video/mp4";
};

export type PutFightVideo = (input: PutFightVideoInput) => Promise<void>;

export type UploadFightVideoOptions = {
  /** Mp4 bytes. Required; empty body is rejected. */
  body: Uint8Array;
  /** Env for Spaces config. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Override config instead of reading env. */
  config?: FightMediaConfig;
  /** Object id for videos/<id>.mp4. Defaults to a new UUID (never overwrite). */
  objectId?: string;
  /** Injectable PUT. Defaults to an S3 client against the Spaces endpoint. */
  putObject?: PutFightVideo;
};

function createSpacesPutObject(config: FightMediaConfig): PutFightVideo {
  const clientConfig: S3ClientConfig = {
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: false,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };
  const client = new S3Client(clientConfig);
  return async (input) => {
    await client.send(
      new PutObjectCommand({
        Bucket: input.Bucket,
        Key: input.Key,
        Body: input.Body,
        ACL: input.ACL,
        ContentType: input.ContentType,
      }),
    );
  };
}

/**
 * Upload fight mp4 bytes to Spaces under videos/<id>.mp4 and return the public CDN URL.
 * That URL is what RoundState.videoUrl uses. Fails closed — no placeholder URL.
 */
export async function uploadFightVideo(options: UploadFightVideoOptions): Promise<string> {
  if (options.body.byteLength === 0) {
    throw new Error("fight video body is empty. Refusing to upload.");
  }

  const config = options.config ?? readFightMediaConfig(options.env ?? process.env);
  const objectId = options.objectId ?? randomUUID();
  const key = videoObjectKey(objectId);
  const putObject = options.putObject ?? createSpacesPutObject(config);

  const putInput: PutFightVideoInput = {
    Bucket: config.bucket,
    Key: key,
    Body: options.body,
    ACL: "public-read",
    ContentType: "video/mp4",
  };

  try {
    await putObject(putInput);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Spaces put_object failed for s3://${config.bucket}/${key}: ${detail}. Refusing to return a placeholder video URL.`,
      { cause },
    );
  }

  return fightMediaCdnUrl(config.cdnHost, key);
}

/** Exported for tests that assert request construction without a live Spaces PUT. */
export function buildPutFightVideoInput(
  config: FightMediaConfig,
  body: Uint8Array,
  objectId: string,
): PutFightVideoInput {
  return {
    Bucket: config.bucket,
    Key: videoObjectKey(objectId),
    Body: body,
    ACL: "public-read",
    ContentType: "video/mp4",
  };
}
