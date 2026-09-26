import { randomUUID } from "node:crypto";

import { PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";

import { type FightMediaConfig, readFightMediaConfig } from "./env.js";
import { fightMediaCdnUrl, frameObjectKey, videoObjectKey } from "./keys.js";

export type PutFightMediaInput = {
  Bucket: string;
  Key: string;
  Body: Uint8Array;
  ACL: "public-read";
  ContentType: "video/mp4" | "image/jpeg";
};

export type PutFightVideoInput = PutFightMediaInput;

export type PutFightVideo = (input: PutFightMediaInput) => Promise<void>;

export type UploadFightVideoOptions = {
  body: Uint8Array;
  env?: NodeJS.ProcessEnv;
  config?: FightMediaConfig;
  putObject?: PutFightVideo;
};

export type UploadFightFrameOptions = {
  body: Uint8Array;
  env?: NodeJS.ProcessEnv;
  config?: FightMediaConfig;
  putObject?: PutFightVideo;
};

export function buildPutFightVideoInput(
  config: FightMediaConfig,
  body: Uint8Array,
  objectId: string,
): PutFightMediaInput {
  return {
    Bucket: config.bucket,
    Key: videoObjectKey(objectId),
    Body: body,
    ACL: "public-read",
    ContentType: "video/mp4",
  };
}

export function buildPutFightFrameInput(
  config: FightMediaConfig,
  body: Uint8Array,
  objectId: string,
): PutFightMediaInput {
  return {
    Bucket: config.bucket,
    Key: frameObjectKey(objectId),
    Body: body,
    ACL: "public-read",
    ContentType: "image/jpeg",
  };
}

function createSpacesPutObject(config: FightMediaConfig): PutFightVideo {
  const clientConfig: S3ClientConfig = {
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: false,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
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

async function putAndCdnUrl(
  config: FightMediaConfig,
  putInput: PutFightMediaInput,
  putObject: PutFightVideo,
): Promise<string> {
  try {
    await putObject(putInput);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Spaces put_object failed for s3://${config.bucket}/${putInput.Key}: ${detail}. Refusing to return a placeholder CDN URL.`,
      { cause },
    );
  }
  return fightMediaCdnUrl(config.cdnHost, putInput.Key);
}

// WARNING: body must be raw mp4 bytes, not a fal.media URL. Download the bytes first.
export async function uploadFightVideo(options: UploadFightVideoOptions): Promise<string> {
  if (options.body.byteLength === 0) {
    throw new Error("fight video body is empty. Refusing to upload.");
  }

  const config = options.config ?? readFightMediaConfig(options.env ?? process.env);
  const putInput = buildPutFightVideoInput(config, options.body, randomUUID());
  const putObject = options.putObject ?? createSpacesPutObject(config);
  return putAndCdnUrl(config, putInput, putObject);
}

export async function uploadFightFrame(options: UploadFightFrameOptions): Promise<string> {
  if (options.body.byteLength === 0) {
    throw new Error("fight frame body is empty. Refusing to upload.");
  }

  const config = options.config ?? readFightMediaConfig(options.env ?? process.env);
  const putInput = buildPutFightFrameInput(config, options.body, randomUUID());
  const putObject = options.putObject ?? createSpacesPutObject(config);
  return putAndCdnUrl(config, putInput, putObject);
}
