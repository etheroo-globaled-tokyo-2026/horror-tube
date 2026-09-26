export type InjuriesRewriteAction =
  | { action: "rewrite"; next: "[]" }
  | { action: "skip" }
  | { action: "stop"; raw: string };

export function classifyInjuriesRewrite(raw: string): InjuriesRewriteAction {
  if (raw === "") {
    return { action: "rewrite", next: "[]" };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { action: "skip" };
    }
  } catch {
    return { action: "stop", raw };
  }
  return { action: "stop", raw };
}

export type InjuriesRewriteBatch = {
  rewrites: { label: string; next: "[]" }[];
  skipped: string[];
  stop?: { label: string; raw: string };
};

export function rewriteEmptyInjuriesValues(
  entries: readonly { label: string; injuries: string }[],
): InjuriesRewriteBatch {
  const rewrites: { label: string; next: "[]" }[] = [];
  const skipped: string[] = [];
  for (const entry of entries) {
    const decision = classifyInjuriesRewrite(entry.injuries);
    if (decision.action === "rewrite") {
      rewrites.push({ label: entry.label, next: decision.next });
      continue;
    }
    if (decision.action === "skip") {
      skipped.push(entry.label);
      continue;
    }
    return {
      rewrites,
      skipped,
      stop: { label: entry.label, raw: decision.raw },
    };
  }
  return { rewrites, skipped };
}
