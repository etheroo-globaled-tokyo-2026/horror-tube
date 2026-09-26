import { fal } from "@fal-ai/client";

import { FightError, type FalVideoConfig } from "./env.js";
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

export type FalVideoInput = {
  prompt: string;
  duration: number;
  resolution: string;
  prompt_expansion_mode: string;
  aspect_ratio: string;
};

export function buildFalInput(
  turn: NarrationTurn,
  config: FalVideoConfig,
): FalVideoInput {
  return {
    prompt: videoPromptFromTurn(turn),
    duration: config.durationSeconds,
    resolution: config.resolution,
    prompt_expansion_mode: config.promptExpansionMode,
    aspect_ratio: config.aspectRatio,
  };
}

export type FightVideoResult = {
  prompt: string;
  videoUrl: string;
  expandedPrompt: string | null;
  requestId: string;
};

export async function generateFightVideo(
  turn: NarrationTurn,
  config: FalVideoConfig,
  client: FalClient = defaultFalClient(config.apiKey),
): Promise<FightVideoResult> {
  const input = buildFalInput(turn, config);
  let result: FalSubscribeResult;
  try {
    result = await client.subscribe(config.model, { input });
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
