import { ServiceError } from "../contracts.ts";

export interface QuotaLeaf {
  rev: string;
  bytes: number;
  doc: Record<string, unknown>;
}

const metadata = new Set(["_rev", "_revisions", "_conflicts", "_deleted_conflicts", "_local_seq"]);
const encoder = new TextEncoder();

export function base64Bytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  if (value.length % 4 !== 0 || (padding > 0 && value.length < 4)) {
    throw new ServiceError("invalid_attachment_encoding", 400);
  }
  for (let index = 0; index < value.length - padding; index++) {
    const code = value.charCodeAt(index);
    if (!(
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47
    )) {
      throw new ServiceError("invalid_attachment_encoding", 400);
    }
  }
  return (value.length / 4) * 3 - padding;
}

export function documentBytes(doc: Record<string, unknown>): number {
  if (
    typeof doc._id === "string" &&
    (doc._id.startsWith("_local/") || doc._id.startsWith("_design/"))
  )
    return 0;
  const body: Record<string, unknown> = Object.create(null);
  let attachments = 0;
  for (const key of Object.keys(doc).sort()) {
    if (metadata.has(key) || key === "_attachments") continue;
    if (doc._deleted === true && (key === "_id" || key === "_deleted")) continue;
    body[key] = doc[key];
  }
  if (doc._attachments && typeof doc._attachments === "object") {
    const normalized: Record<string, unknown> = Object.create(null);
    for (const [name, value] of Object.entries(
      doc._attachments as Record<string, Record<string, unknown>>,
    ).sort(([a], [b]) => a.localeCompare(b))) {
      if (!value || typeof value !== "object") throw new ServiceError("invalid_attachment", 400);
      const length = typeof value.data === "string" ? base64Bytes(value.data) : value.length;
      if (!Number.isSafeInteger(length) || Number(length) < 0) {
        throw new ServiceError("invalid_attachment_length", 400);
      }
      attachments += Number(length);
      normalized[name] = { content_type: value.content_type ?? "application/octet-stream", length };
    }
    if (Object.keys(normalized).length) body._attachments = normalized;
  }
  if (doc._deleted === true && !Object.keys(body).length) return 0;
  return encoder.encode(JSON.stringify(body)).length + attachments;
}
