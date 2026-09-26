import { fetchReplayVideoUrl } from "./round-client.ts";

export type ReplayVideoSink = {
  currentSrc: string | null;
  setSrc: (url: string) => void;
  note: (text: string, kind?: string) => void;
};

export async function playReplayVideo(
  sink: ReplayVideoSink,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    const url = await fetchReplayVideoUrl(fetchImpl);
    if (sink.currentSrc !== url) {
      sink.setSrc(url);
    }
  } catch (cause) {
    sink.note(`REPLAY FAILED. ${cause instanceof Error ? cause.message : String(cause)}`, "bad");
  }
}
