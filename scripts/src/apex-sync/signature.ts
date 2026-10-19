import { createHash } from "node:crypto";
import type { Incident } from "./types.js";

/** Strip volatile tokens (ids, timestamps, numbers) so the same failure hashes the same across ticks. */
export function normalizeSignature(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b\d{4}-\d{2}-\d{2}t[\d:.]+z?\b/g, "<ts>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "<id>")
    .replace(/\b[0-9a-f]{12,}\b/g, "<hex>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

export function signatureOf(incident: Pick<Incident, "component" | "errorSignature">): string {
  const basis = `${incident.component.toLowerCase()}|${normalizeSignature(incident.errorSignature)}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}
