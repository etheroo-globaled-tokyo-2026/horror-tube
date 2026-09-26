import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";

import { FightError, type RotoscopeConfig } from "./env.js";
import type { RotoscopeShotList } from "./shot-list.js";

/** The JSON body the rotoscope service sends with a 400, 500 or 504. */
export type RotoscopeServiceError = { error: string; detail?: unknown };

/** The rotoscope service refused, failed, timed out or could not be reached. */
export class RotoscopeError extends FightError {
  /** HTTP status, or null when no answer arrived. */
  readonly status: number | null;
  /** The service's JSON error, when it sent one. */
  readonly serviceError: RotoscopeServiceError | null;

  constructor(
    message: string,
    options: {
      status: number | null;
      serviceError?: RotoscopeServiceError | null;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "RotoscopeError";
    this.status = options.status;
    this.serviceError = options.serviceError ?? null;
  }
}

export type RotoscopeResult = {
  /** The line drawing as an mp4, with the input's sound. */
  video: Uint8Array;
  /** X-Rotoscope-Frames: frames the service drew. */
  frames: number | null;
  /** X-Rotoscope-Seconds: time the service spent. */
  seconds: number | null;
};

type HttpAnswer = {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
};

/**
 * POST the video and its shot list to `rotoscope serve` and return the drawing.
 * Fails closed: an error, a timeout or an empty answer is a RotoscopeError, never fal's footage.
 */
export async function rotoscopeVideo(
  mp4: Uint8Array,
  shotList: RotoscopeShotList,
  config: RotoscopeConfig,
): Promise<RotoscopeResult> {
  const endpoint = `${config.url}/v1/rotoscope`;
  const form = new FormData();
  form.append("video", new Blob([mp4.slice()], { type: "video/mp4" }), "fight.mp4");
  form.append("shots", JSON.stringify(shotList));

  const signal = AbortSignal.timeout(config.timeoutMs);
  let answer: HttpAnswer;
  try {
    answer = await postForm(endpoint, form, signal);
  } catch (cause) {
    if (signal.aborted) {
      throw new RotoscopeError(
        `rotoscope service at ${endpoint} did not answer within ${String(config.timeoutMs)} ms (ROTOSCOPE_TIMEOUT_MS). Refusing to upload the video undrawn.`,
        { status: null, cause },
      );
    }
    throw new RotoscopeError(
      `rotoscope service at ${endpoint} could not be reached: ${describeCause(cause)}. Is \`rotoscope serve\` running at ROTOSCOPE_URL?`,
      { status: null, cause },
    );
  }

  if (answer.status !== 200) {
    const text = answer.body.toString("utf8");
    const serviceError = parseServiceError(text);
    const what =
      serviceError === null
        ? text
        : `${serviceError.error} ${JSON.stringify(serviceError.detail ?? null)}`;
    throw new RotoscopeError(
      `rotoscope service answered HTTP ${String(answer.status)} for ${endpoint}: ${what}`,
      { status: answer.status, serviceError },
    );
  }
  const contentType = firstHeader(answer.headers["content-type"]) ?? "";
  if (!contentType.startsWith("video/mp4") || answer.body.byteLength === 0) {
    throw new RotoscopeError(
      `rotoscope service at ${endpoint} answered 200 without an mp4 (content-type ${JSON.stringify(contentType)}, ${String(answer.body.byteLength)} bytes).`,
      { status: answer.status },
    );
  }
  return {
    video: new Uint8Array(answer.body),
    frames: numberHeader(answer.headers["x-rotoscope-frames"]),
    seconds: numberHeader(answer.headers["x-rotoscope-seconds"]),
  };
}

// node:http rather than fetch: fetch has its own wait limit for response headers,
// shorter than the service's, that ROTOSCOPE_TIMEOUT_MS can't raise.
async function postForm(url: string, form: FormData, signal: AbortSignal): Promise<HttpAnswer> {
  // Request encodes the multipart body and its boundary header; nothing is sent here.
  const encoded = new Request(url, { method: "POST", body: form });
  const body = Buffer.from(await encoded.arrayBuffer());
  const send = url.startsWith("https:") ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        method: "POST",
        headers: {
          "content-type": encoded.headers.get("content-type") ?? "",
          "content-length": String(body.byteLength),
        },
        signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("error", reject);
        res.on("close", () => {
          if (!res.complete) {
            reject(new Error("the connection closed before the whole answer arrived"));
            return;
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

function parseServiceError(text: string): RotoscopeServiceError | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON (a proxy's page, say): the caller reports the raw text instead.
    return null;
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "error" in parsed &&
    typeof parsed.error === "string"
  ) {
    return "detail" in parsed
      ? { error: parsed.error, detail: parsed.detail }
      : { error: parsed.error };
  }
  return null;
}

function describeCause(cause: unknown): string {
  if (!(cause instanceof Error)) {
    return String(cause);
  }
  const code = "code" in cause && typeof cause.code === "string" ? ` (${cause.code})` : "";
  return `${cause.message}${code}`;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function numberHeader(value: string | string[] | undefined): number | null {
  const raw = firstHeader(value);
  if (raw === undefined || raw.trim() === "") {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
