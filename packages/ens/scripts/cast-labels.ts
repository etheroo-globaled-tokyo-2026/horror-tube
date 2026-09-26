/**
 * ENS labels for the fixed cast. Sourced from packages/roster/roster/cast.json
 * (same list propose/register use). Browser-safe: JSON import, no node:fs.
 */
import cast from "../../roster/roster/cast.json";

function entryLabel(entry: unknown): string | undefined {
  if (entry === null || typeof entry !== "object" || !("label" in entry)) {
    return undefined;
  }
  const label = entry.label;
  if (typeof label !== "string") {
    return undefined;
  }
  const trimmed = label.trim();
  if (trimmed === "") {
    return undefined;
  }
  return trimmed;
}

export function labelsFromCastEntries(entries: unknown): string[] {
  if (!Array.isArray(entries)) {
    throw new Error(`cast labels: expected an array of cast entries. Got ${typeof entries}.`);
  }
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const label = entryLabel(entry);
    if (label === undefined) {
      continue;
    }
    if (seen.has(label)) {
      throw new Error(`cast labels: duplicate label ${label}`);
    }
    seen.add(label);
    labels.push(label);
  }
  if (labels.length !== entries.length) {
    throw new Error(
      `cast entry count (${String(entries.length)}) and label count (${String(labels.length)}) differ`,
    );
  }
  return labels;
}

/** Labels in cast.json order. Chain text is still the sheet content source. */
export function castLabels(): string[] {
  return labelsFromCastEntries(cast);
}
