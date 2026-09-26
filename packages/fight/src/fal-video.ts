import { fal } from "@fal-ai/client";

import {
  FightError,
  resolveFalSubscribeModel,
  type FalVideoConfig,
} from "./env.js";
import { videoPromptFromTurn } from "./render.js";
import type { NarrationTurn } from "./types.js";

export type FalSubscribeResult = {
  data: {
    video?: { url?: string; content_type?: string; file_name?: string; file_size?: number };
    expanded_prompt?: string | null;
  };
  requestId: string;
};

export type FalClient = {
  subscribe: (
    model: string,
    opts: { input: Record<string, unknown> },
  ) => Promise<FalSubscribeResult>;
};

/** Shared fal fields for both text-to-video and image-to-video H3 Max. */
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
    // Image-to-video OpenAPI: image_url seeds the first frame; no aspect_ratio field.
    return { ...base, image_url: prior };
  }
  return { ...base, aspect_ratio: config.aspectRatio };
}

export type FightVideoResult = {
  prompt: string;
  videoUrl: string;
  expandedPrompt: string | null;
  requestId: string;
  /** fal endpoint id actually subscribed (text-to-video or image-to-video). */
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
  const url = result.data?.video?.url;
  if (typeof url !== "string" || url.trim() === "") {
    throw new FightError(
      `fal response missing video.url. requestId=${result.requestId} data=${JSON.stringify(result.data)}`,
    );
  }
  const expanded = result.data.expanded_prompt;
  return {
    prompt: input.prompt,
    videoUrl: url,
    expandedPrompt: typeof expanded === "string" ? expanded : null,
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
      return {
        data: result.data as FalSubscribeResult["data"],
        requestId: result.requestId,
      };
    },
  };
}

function formatFalError(err: unknown): string {
  if (err !== null && typeof err === "object") {
    const anyErr = err as {
      message?: string;
      status?: number;
      body?: unknown;
    };
    const parts: string[] = [];
    if (typeof anyErr.status === "number") {
      parts.push(`status=${anyErr.status}`);
    }
    if (typeof anyErr.message === "string" && anyErr.message.trim() !== "") {
      parts.push(anyErr.message);
    }
    if (anyErr.body !== undefined) {
      parts.push(`body=${JSON.stringify(anyErr.body)}`);
    }
    if (parts.length > 0) {
      return parts.join(" ");
    }
  }
  if (err instanceof Error && err.message.trim() !== "") {
    return err.message;
  }
  return String(err);
}
