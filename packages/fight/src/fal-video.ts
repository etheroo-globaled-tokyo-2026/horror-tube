import { ApiError, fal } from "@fal-ai/client";
import { z } from "zod";

import {
  FightError,
  resolveFalSubscribeModel,
  type FalVideoConfig,
} from "./env.js";
import { videoPromptFromTurn } from "./render.js";
import type { NarrationTurn } from "./types.js";

const falVideoOutputSchema = z.object({
  video: z
    .object({
      url: z.string().optional(),
      content_type: z.string().optional(),
      file_name: z.string().optional(),
      file_size: z.number().optional(),
    })
    .optional(),
  expanded_prompt: z.string().nullish(),
});

export type FalSubscribeResult = {
  data: z.infer<typeof falVideoOutputSchema>;
  requestId: string;
};

export type FalClient = {
  subscribe: (
    model: string,
    opts: { input: FalVideoInput },
  ) => Promise<FalSubscribeResult>;
};

export type FalVideoInputBase = {
  prompt: string;
  duration: number;
  resolution: string;
  prompt_expansion_mode: string;
};

export type FalTextToVideoInput = FalVideoInputBase & {
  aspect_ratio: string;
};

export type FalImageToVideoInput = FalVideoInputBase & {
  image_url: string;
};

export type FalVideoInput = FalTextToVideoInput | FalImageToVideoInput;

export function buildFalInput(
  turn: NarrationTurn,
  config: FalVideoConfig,
  options: { priorFrameUrl?: string } = {},
): FalVideoInput {
  const prior =
    options.priorFrameUrl === undefined
      ? undefined
      : options.priorFrameUrl.trim();
  if (prior !== undefined && prior === "") {
    throw new FightError(
      "priorFrameUrl is blank. Pass a CDN frame URL or omit it for text-to-video. Refusing to build a fal input.",
    );
  }

  const base: FalVideoInputBase = {
    prompt: videoPromptFromTurn(turn, {
      continueFromFrame: prior !== undefined,
    }),
    duration: config.durationSeconds,
    resolution: config.resolution,
    prompt_expansion_mode: config.promptExpansionMode,
  };

  if (prior !== undefined) {
    return { ...base, image_url: prior };
  }
  return { ...base, aspect_ratio: config.aspectRatio };
}

export type FightVideoResult = {
  prompt: string;
  videoUrl: string;
  expandedPrompt: string | null;
  requestId: string;
  model: string;
};

export async function generateFightVideo(
  turn: NarrationTurn,
  config: FalVideoConfig,
  client: FalClient = defaultFalClient(config.apiKey),
  options: { priorFrameUrl?: string } = {},
): Promise<FightVideoResult> {
  const model = resolveFalSubscribeModel(config, options.priorFrameUrl);
  const input = buildFalInput(turn, config, options);
  let result: FalSubscribeResult;
  try {
    result = await client.subscribe(model, { input });
  } catch (err) {
    throw new FightError(`fal video generation failed: ${formatFalError(err)}`, {
      cause: err,
    });
  }
  const url = result.data.video?.url;
  if (url === undefined || url.trim() === "") {
    throw new FightError(
      `fal response missing video.url. requestId=${result.requestId} data=${JSON.stringify(result.data)}`,
    );
  }
  return {
    prompt: input.prompt,
    videoUrl: url,
    expandedPrompt: result.data.expanded_prompt ?? null,
    requestId: result.requestId,
    model,
  };
}

function defaultFalClient(apiKey: string): FalClient {
  return {
    async subscribe(model, opts) {
      fal.config({ credentials: apiKey });
      const result = await fal.subscribe(model, {
        input: opts.input,
        logs: true,
      });
      const data = falVideoOutputSchema.safeParse(result.data);
      if (!data.success) {
        throw new FightError(
          `fal response does not match the video output shape. requestId=${result.requestId}: ${z.prettifyError(data.error)}`,
        );
      }
      return { data: data.data, requestId: result.requestId };
    },
  };
}

function formatFalError(cause: unknown): string {
  if (cause instanceof ApiError) {
    const parts = [`status=${cause.status}`];
    if (cause.message.trim() !== "") {
      parts.push(cause.message);
    }
    if (cause.body !== undefined) {
      parts.push(`body=${JSON.stringify(cause.body)}`);
    }
    return parts.join(" ");
  }
  if (cause instanceof Error && cause.message.trim() !== "") {
    return cause.message;
  }
  return String(cause);
}
