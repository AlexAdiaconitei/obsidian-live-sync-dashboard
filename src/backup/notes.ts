// Rebuilds the files of a LiveSync vault from an exported archive. Runs in the owner's browser:
// the vault passphrase and the decrypted notes never reach the server.
import { decodeBinary } from "octagonal-wheels/binary";
import { decrypt } from "octagonal-wheels/encryption/hkdf";

export interface ArchiveVault {
  id: string;
  label: string;
  db: string;
}
interface Doc {
  _id: string;
  _rev?: string;
  _deleted?: boolean;
  [key: string]: unknown;
}
export interface VaultContent {
  vault: ArchiveVault;
  salt?: string;
  files: Map<string, Doc[]>;
  chunks: Map<string, Doc>;
}
export interface Archive {
  createdAt: string;
  vaults: VaultContent[];
}
export interface VaultFile {
  path: string;
  mtime?: number;
  content: Uint8Array;
}
export class ArchiveError extends Error {
  constructor(readonly code: ArchiveErrorCode) {
    super(code);
  }
}
export type ArchiveErrorCode =
  | "archive_invalid"
  | "archive_missing_salt"
  | "archive_wrong_passphrase"
  | "archive_unsupported_encryption"
  | "archive_missing_chunk";

const ENCRYPTED_META = "/\\:";
const HKDF = "%=";
const EDEN_HKDF = "h:++encrypted-hkdf";
const NOTE_TYPES = new Set(["plain", "newnote", "notes"]);
// Hidden files, customisation sync and other internal entries are not part of the vault's notes.
const INTERNAL = ["i:", "ix:", "ps:", "_design/"];

// Reads the NDJSON lines of a personal backup or a vault recovery ZIP.
export async function readArchive(lines: AsyncIterable<string>): Promise<Archive> {
  let archive: Archive | undefined;
  const byId = new Map<string, VaultContent>();
  for await (const line of lines) {
    if (!line.trim()) continue;
    let record: { type?: unknown; vaultId?: unknown; doc?: Doc; [key: string]: unknown };
    try {
      record = JSON.parse(line) as typeof record;
    } catch {
      throw new ArchiveError("archive_invalid");
    }
    if (!archive) {
      if (
        record.type !== "manifest" ||
        record.format !== "obsidian-personal-backup" ||
        !Array.isArray(record.vaults)
      )
        throw new ArchiveError("archive_invalid");
      archive = { createdAt: String(record.createdAt ?? ""), vaults: [] };
      for (const item of record.vaults as ArchiveVault[]) {
        if (typeof item?.id !== "string" || byId.has(item.id))
          throw new ArchiveError("archive_invalid");
        const content: VaultContent = {
          vault: { id: item.id, label: String(item.label ?? ""), db: String(item.db ?? "") },
          files: new Map(),
          chunks: new Map(),
        };
        byId.set(item.id, content);
        archive.vaults.push(content);
      }
      continue;
    }
    const content = byId.get(String(record.vaultId));
    const doc = record.doc;
    if (!content || !doc || typeof doc._id !== "string") throw new ArchiveError("archive_invalid");
    if (record.type === "local") {
      if (typeof doc.pbkdf2salt === "string") content.salt = doc.pbkdf2salt;
    } else if (record.type !== "document") {
      throw new ArchiveError("archive_invalid");
    } else if (doc.type === "leaf") {
      if (!doc._deleted) content.chunks.set(doc._id, doc);
    } else if (
      (NOTE_TYPES.has(String(doc.type)) || doc._deleted) &&
      !INTERNAL.some((prefix) => doc._id.startsWith(prefix))
    ) {
      const leaves = content.files.get(doc._id) ?? [];
      leaves.push(doc);
      content.files.set(doc._id, leaves);
    }
  }
  if (!archive) throw new ArchiveError("archive_invalid");
  return archive;
}

// CouchDB's winning revision: live before deleted, then the longest history, then the highest hash.
function winner(leaves: Doc[]): Doc {
  const rank = (doc: Doc) => Number.parseInt(String(doc._rev), 10) || 0;
  return leaves.reduce((best, doc) => {
    if (!!best._deleted !== !!doc._deleted) return doc._deleted ? best : doc;
    if (rank(best) !== rank(doc)) return rank(doc) > rank(best) ? doc : best;
    return String(doc._rev) > String(best._rev) ? doc : best;
  });
}

const salts = new WeakMap<VaultContent, Uint8Array<ArrayBuffer>>();
function salt(content: VaultContent): Uint8Array<ArrayBuffer> {
  let value = salts.get(content);
  if (!value) {
    if (!content.salt) throw new ArchiveError("archive_missing_salt");
    value = Uint8Array.from(atob(content.salt), (char) => char.charCodeAt(0));
    salts.set(content, value);
  }
  return value;
}

export function isEncrypted(content: VaultContent): boolean {
  for (const chunk of content.chunks.values()) if (chunk.e_ === true) return true;
  for (const leaves of content.files.values())
    if (leaves.some((doc) => String(doc.path ?? "").startsWith(ENCRYPTED_META))) return true;
  return false;
}

// Tries one encrypted value, so a wrong passphrase fails before the long export starts.
export async function checkPassphrase(content: VaultContent, passphrase: string): Promise<void> {
  for (const chunk of content.chunks.values()) {
    if (chunk.e_ === true) {
      await open(content, String(chunk.data), passphrase);
      return;
    }
  }
}

async function open(content: VaultContent, value: string, passphrase: string): Promise<string> {
  if (!value.startsWith(HKDF)) throw new ArchiveError("archive_unsupported_encryption");
  const key = salt(content);
  try {
    return await decrypt(value, passphrase, key);
  } catch {
    throw new ArchiveError("archive_wrong_passphrase");
  }
}

// Yields every live file of the vault, rebuilt from its chunks.
export async function* vaultFiles(
  content: VaultContent,
  passphrase: string,
): AsyncGenerator<VaultFile> {
  const encoder = new TextEncoder();
  for (const leaves of content.files.values()) {
    const doc = winner(leaves);
    if (doc._deleted || doc.deleted === true) continue;
    let meta = doc as Doc & {
      path?: string;
      mtime?: number;
      children?: string[];
    };
    if (typeof doc.path === "string" && doc.path.startsWith(ENCRYPTED_META)) {
      try {
        meta = {
          ...doc,
          ...(JSON.parse(
            await open(content, doc.path.slice(ENCRYPTED_META.length), passphrase),
          ) as object),
        };
      } catch (error) {
        if (error instanceof ArchiveError) throw error;
        throw new ArchiveError("archive_invalid");
      }
    } else if (doc._id.startsWith("f:")) {
      // Obfuscated paths from the first encryption scheme need its own key derivation.
      throw new ArchiveError("archive_unsupported_encryption");
    }
    const path = String(meta.path ?? doc._id);
    let data: string[];
    if (doc.type === "notes") {
      data = [String(doc.data ?? "")];
    } else {
      let eden = (doc.eden ?? {}) as Record<string, { data: string }>;
      if (eden[EDEN_HKDF]) {
        eden = JSON.parse(await open(content, eden[EDEN_HKDF].data, passphrase)) as typeof eden;
      }
      data = [];
      for (const id of meta.children ?? []) {
        const chunk = eden[id] ?? content.chunks.get(id);
        if (!chunk) throw new ArchiveError("archive_missing_chunk");
        const value = String(chunk.data ?? "");
        data.push(
          (chunk as { e_?: unknown }).e_ === true ? await open(content, value, passphrase) : value,
        );
      }
    }
    yield {
      path,
      mtime: typeof meta.mtime === "number" && meta.mtime > 0 ? meta.mtime : undefined,
      content:
        doc.type === "newnote" ? new Uint8Array(decodeBinary(data)) : encoder.encode(data.join("")),
    };
  }
}

// A relative path that unpacks inside the destination folder on Windows, macOS and Linux.
export function safePath(path: string): string {
  const parts = path
    .split(/[\\/]+/)
    .map((part) =>
      Array.from(part, (char) =>
        char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || ':*?"<>|'.includes(char)
          ? "_"
          : char,
      )
        .join("")
        .replace(/[. ]+$/, ""),
    )
    .filter((part) => part && part !== "." && part !== "..");
  return parts.join("/") || "untitled";
}
