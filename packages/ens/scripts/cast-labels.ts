/**
 * ENS labels for the fixed cast. Sourced from packages/roster/roster/cast.json
 * (same list propose/register use). Browser-safe: JSON import, no node:fs.
 */
import cast from "../../roster/roster/cast.json";

export function labelsFromCastEntries(entries: unknown): string[] {
  if (!Array.isArray(entries)) {
    throw new Error(
      `cast labels: expected an array of cast entries. Got ${typeof entries}.`,
    );
  }
  const labels: string[] = [];
  for (const entry of entries) {
    if (
      entry !== null &&
      typeof entry === "object" &&
      "label" in entry &&
      typeof (entry as { label: unknown }).label === "string" &&
      (entry as { label: string }).label.trim() !== ""
    ) {
      labels.push((entry as { label: string }).label.trim());
    }
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
