import { vaultRecords } from "./export.ts";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { type DashboardService, ServiceError, type Vault } from "../contracts.ts";
import type { CouchClient, CouchDocument } from "../couchdb/client.ts";
import {
  type ArchiveWriter,
  type DriveConfig,
  DRIVE_FOLDER,
  type DrivePickerSession,
  GoogleDrive,
  TokenCipher,
} from "./drive.ts";

export interface PersonalBackupStatus {
  connected: boolean;
  folderId: string | null;
  folderName?: string;
  pickerAvailable?: boolean;
  recipient: string;
  retentionDays: number;
  enabled: boolean;
  running: boolean;
  // Requested while another owner's backup was running; the scheduler starts it next.
  queued?: boolean;
  lastAttempt: string | null;
  lastSuccess: string | null;
  error: string | null;
}
interface BackupDoc extends CouchDocument {
  kind: "personal-backup";
  schemaVersion: 1;
  personId: string;
  token: string | null;
  defaultFolderId?: string;
  value: PersonalBackupStatus;
}
const defaults = (): PersonalBackupStatus => ({
  connected: false,
  folderId: null,
  recipient: "",
  retentionDays: 30,
  enabled: false,
  running: false,
  lastAttempt: null,
  lastSuccess: null,
  error: null,
});
const ownerTag = (id: string) => createHash("sha256").update(id).digest("hex");
const DAY_MS = 86_400_000;
const RETRY_MS = 3_600_000;
// A daily backup older than this has missed its slot and two retries.
export const BACKUP_STALE_MS = DAY_MS + 2 * RETRY_MS;
const MAX_ARCHIVE_BYTES = 1024 ** 3;

export function backupDue(status: PersonalBackupStatus, now = Date.now()): boolean {
  if (status.queued) return true;
  const since = (value: string | null) => (value ? now - Date.parse(value) : Infinity);
  return (
    since(status.lastSuccess) >= DAY_MS &&
    since(status.lastAttempt) >= (status.error ? RETRY_MS : DAY_MS)
  );
}

export async function ageArchive(source: Readable, recipient: string, path: string): Promise<void> {
  const child = spawn("age", ["-r", recipient], {
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30 * 60_000);
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error("age_failed"))));
  });
  let bytes = 0;
  const limit = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > MAX_ARCHIVE_BYTES ? new Error("backup_too_large") : null, chunk);
    },
  });
  try {
    await Promise.all([
      exited,
      pipeline(source, createGzip(), child.stdin, { signal: controller.signal }),
      pipeline(child.stdout, limit, createWriteStream(path, { flags: "wx", mode: 0o600 }), {
        signal: controller.signal,
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    child.kill();
  }
}

export class PersonalBackups {
  private cipher: TokenCipher;
  private pending = new Map<string, { personId: string; verifier: string; expires: number }>();
  private busy = false;
  private cleaned = false;
  private mutation: Promise<unknown> = Promise.resolve();
  constructor(
    private client: CouchClient,
    private service: DashboardService,
    private panelDb: string,
    private config: DriveConfig,
    private drive = new GoogleDrive(config),
    private archive: ArchiveWriter = ageArchive,
  ) {
    this.cipher = new TokenCipher(config.tokenKey);
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.mutation.then(fn, fn);
    this.mutation = task.catch(() => undefined);
    return task;
  }
  private async doc(personId: string): Promise<BackupDoc> {
    return (
      (await this.client.get<BackupDoc>(this.panelDb, `personal-backup:${personId}`)) ?? {
        _id: `personal-backup:${personId}`,
        kind: "personal-backup",
        schemaVersion: 1,
        personId,
        token: null,
        value: defaults(),
      }
    );
  }
  async status(personId: string): Promise<PersonalBackupStatus> {
    return { ...(await this.doc(personId)).value, pickerAvailable: !!this.config.picker };
  }
  async pickerSession(personId: string): Promise<DrivePickerSession> {
    if (!this.config.picker) throw new ServiceError("drive_picker_not_configured", 503);
    const doc = await this.doc(personId);
    if (!doc.token) throw new ServiceError("backup_not_configured", 400);
    return {
      ...this.config.picker,
      accessToken: await this.drive.access(this.cipher.open(doc.token, personId)),
    };
  }
  async chooseFolder(personId: string, folderId: string): Promise<void> {
    await this.serial(async () => {
      const doc = await this.doc(personId);
      if (doc.value.running) throw new ServiceError("backup_busy", 409);
      if (!doc.token) throw new ServiceError("backup_not_configured", 400);
      const access = await this.drive.access(this.cipher.open(doc.token, personId));
      const folder = await this.drive.folderInfo(access, folderId);
      doc.defaultFolderId ??= doc.value.folderId ?? undefined;
      doc.value = { ...doc.value, folderId: folder.id, folderName: folder.name };
      await this.client.put(this.panelDb, doc);
    });
  }
  async useDefaultFolder(personId: string): Promise<void> {
    await this.serial(async () => {
      const doc = await this.doc(personId);
      if (doc.value.running) throw new ServiceError("backup_busy", 409);
      if (!doc.token) throw new ServiceError("backup_not_configured", 400);
      const access = await this.drive.access(this.cipher.open(doc.token, personId));
      let folder = doc.defaultFolderId
        ? await this.drive.folderInfo(access, doc.defaultFolderId)
        : { id: await this.drive.folder(access), name: DRIVE_FOLDER };
      if (folder.name === "Obsidian LiveSync Backups") {
        folder = { id: await this.drive.folder(access), name: DRIVE_FOLDER };
      }
      doc.defaultFolderId = folder.id;
      doc.value = { ...doc.value, folderId: folder.id, folderName: folder.name };
      await this.client.put(this.panelDb, doc);
    });
  }
  async settings(
    personId: string,
    recipient: string,
    retentionDays: number,
    enabled: boolean,
  ): Promise<void> {
    if (
      !/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(recipient) ||
      !Number.isInteger(retentionDays) ||
      retentionDays < 1 ||
      retentionDays > 3650
    ) {
      throw new ServiceError("invalid_backup_settings", 400);
    }
    // age validates the recipient's checksum before any settings are persisted.
    await this.validateRecipient(recipient);
    await this.serial(async () => {
      const doc = await this.doc(personId);
      if (doc.value.running) throw new ServiceError("backup_busy", 409);
      doc.value = { ...doc.value, recipient, retentionDays, enabled };
      await this.client.put(this.panelDb, doc);
    });
  }
  private async validateRecipient(recipient: string) {
    const child = spawn("age", ["-r", recipient], {
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
      timeout: 5000,
    });
    await new Promise<void>((resolve, reject) => {
      child.once("error", () => reject(new ServiceError("backup_encrypt_failed", 503)));
      child.once("close", (code) =>
        code === 0 ? resolve() : reject(new ServiceError("invalid_backup_settings")),
      );
      child.stdin.on("error", () => undefined);
      child.stdin.end();
    });
  }
  connect(personId: string): { url: string; state: string } {
    for (const [key, value] of this.pending)
      if (value.expires < Date.now()) this.pending.delete(key);
    if (this.pending.size >= 1000) throw new ServiceError("too_many_requests", 429);
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    this.pending.set(state, { personId, verifier, expires: Date.now() + 600_000 });
    return { url: this.drive.authorization(state, verifier), state };
  }
  async callback(
    personId: string,
    state: string,
    cookie: string | undefined,
    code: string,
  ): Promise<void> {
    const pending = this.pending.get(state);
    if (
      !pending ||
      pending.personId !== personId ||
      state !== cookie ||
      pending.expires < Date.now()
    ) {
      throw new ServiceError("invalid_oauth_state", 403);
    }
    this.pending.delete(state);
    if (!code || code.length > 4096) throw new ServiceError("drive_consent_required", 400);
    await this.serial(async () => {
      const doc = await this.doc(personId);
      if (doc.value.running) throw new ServiceError("backup_busy", 409);
      if (doc.token) throw new ServiceError("drive_already_connected", 409);
      const token = await this.drive.exchange(code, pending.verifier);
      let committed = false;
      try {
        const access = await this.drive.access(token);
        const folderId = await this.drive.folder(access);
        doc.token = this.cipher.seal(token, personId);
        doc.defaultFolderId = folderId;
        doc.value = {
          ...doc.value,
          connected: true,
          folderId,
          folderName: DRIVE_FOLDER,
          error: null,
        };
        await this.client.put(this.panelDb, doc);
        committed = true;
      } finally {
        if (!committed) await this.drive.revoke(token).catch(() => undefined);
      }
    });
  }
  async disconnect(personId: string): Promise<void> {
    await this.serial(async () => {
      const doc = await this.doc(personId);
      if (doc.value.running) throw new ServiceError("backup_busy", 409);
      let error: string | null = null;
      if (doc.token) {
        try {
          await this.drive.revoke(this.cipher.open(doc.token, personId));
        } catch {
          error = "drive_revoke_failed";
        }
      }
      doc.token = null;
      delete doc.defaultFolderId;
      doc.value = {
        ...doc.value,
        connected: false,
        folderId: null,
        folderName: undefined,
        enabled: false,
        error,
      };
      await this.client.put(this.panelDb, doc);
      for (const [state, pending] of this.pending)
        if (pending.personId === personId) this.pending.delete(state);
    });
  }
  async request(personId: string): Promise<void> {
    await this.serial(async () => {
      const person = await this.service.getPerson(personId);
      if (person.status !== "active") throw new ServiceError("forbidden", 403);
      const doc = await this.doc(personId);
      if (!doc.token || !doc.value.recipient || !doc.value.folderId)
        throw new ServiceError("backup_not_configured", 400);
      if (doc.value.running) throw new ServiceError("backup_busy", 409);
      // One export runs at a time.
      if (this.busy) {
        doc.value = { ...doc.value, queued: true };
        await this.client.put(this.panelDb, doc);
        return;
      }
      this.busy = true;
      doc.value = {
        ...doc.value,
        running: true,
        queued: false,
        lastAttempt: new Date().toISOString(),
        error: null,
      };
      try {
        await this.client.put(this.panelDb, doc);
      } catch (error) {
        this.busy = false;
        throw error;
      }
      void this.execute(personId)
        .catch(() => undefined)
        .finally(() => {
          this.busy = false;
        });
    });
  }
  private async execute(personId: string): Promise<void> {
    let directory: string | undefined;
    let error: string | null = "backup_export_failed";
    let success: string | null = null;
    try {
      const doc = await this.doc(personId);
      const refresh = this.cipher.open(doc.token!, personId);
      await mkdir(this.config.workDir, { recursive: true });
      if (!this.cleaned) {
        for (const entry of await readdir(this.config.workDir, { withFileTypes: true })) {
          if (entry.isDirectory() && /^livesync-personal-[\w-]+$/.test(entry.name)) {
            await rm(join(this.config.workDir, entry.name), { recursive: true, force: true });
          }
        }
        this.cleaned = true;
      }
      directory = await mkdtemp(join(this.config.workDir, "livesync-personal-"));
      const file = join(directory, "vaults.ndjson.gz.age");
      await this.archive(Readable.from(this.export(personId)), doc.value.recipient, file);
      error = "drive_upload_failed";
      let access = await this.drive.access(refresh);
      // A disabled account must not continue to upload an export created earlier.
      if ((await this.service.getPerson(personId)).status !== "active")
        throw new ServiceError("forbidden", 403);
      const tag = ownerTag(personId);
      const filename = `obsidian-vaults-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}.ndjson.gz.age`;
      await this.drive.upload(access, doc.value.folderId!, tag, filename, file);
      success = new Date().toISOString();
      error = "drive_retention_failed";
      access = await this.drive.access(refresh);
      await this.drive.retention(access, doc.value.folderId!, tag, doc.value.retentionDays);
      error = null;
    } catch (cause) {
      // Only stage codes are published; provider errors can contain credentials.
      if (cause instanceof Error && cause.message === "backup_too_large")
        error = "backup_too_large";
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      await this.serial(async () => {
        const doc = await this.doc(personId);
        doc.value = {
          ...doc.value,
          running: false,
          error,
          lastSuccess: success ?? doc.value.lastSuccess,
        };
        await this.client.put(this.panelDb, doc);
      });
    }
  }
  async *export(personId: string): AsyncGenerator<string> {
    const person = await this.service.getPerson(personId);
    if (person.status !== "active") throw new ServiceError("forbidden", 403);
    const vaults: Vault[] = [];
    let bookmark: string | undefined;
    do {
      const page = await this.service.listVaults(personId, { limit: 100, bookmark });
      vaults.push(...page.items);
      if (page.bookmark && page.bookmark === bookmark)
        throw new ServiceError("backup_export_failed", 503);
      bookmark = page.bookmark;
    } while (bookmark);
    yield JSON.stringify({
      type: "manifest",
      format: "obsidian-personal-backup",
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      vaults,
    }) + "\n";
    for (const vault of vaults) {
      if (
        vault.personId !== personId ||
        vault.provisioning ||
        vault.db.startsWith("_") ||
        vault.db === this.panelDb
      )
        throw new ServiceError("backup_export_failed", 503);
      const security = await this.client.security(vault.db);
      if (!security.members.names.includes(person.couchUser))
        throw new ServiceError("forbidden", 403);
      yield* vaultRecords(this.client, vault);
    }
  }
  async tick(): Promise<void> {
    if (this.busy) return;
    let bookmark: string | undefined;
    do {
      const people = await this.service.listPeople({ limit: 100, bookmark });
      for (const person of people.items) {
        if (this.busy) return;
        const doc = await this.doc(person.id);
        if (doc.value.running) {
          await this.serial(async () => {
            if (this.busy) return;
            const current = await this.doc(person.id);
            current.value = { ...current.value, running: false, error: "interrupted" };
            await this.client.put(this.panelDb, current);
          });
        }
        if (this.busy) return;
        if (
          person.status === "active" &&
          doc.value.connected &&
          (doc.value.enabled || doc.value.queued) &&
          doc.value.recipient &&
          backupDue(doc.value)
        ) {
          await this.request(person.id);
          return;
        }
      }
      if (people.bookmark === bookmark) break;
      bookmark = people.bookmark;
    } while (bookmark);
  }
}

export type PersonalBackupGateway = Pick<
  PersonalBackups,
  | "status"
  | "settings"
  | "connect"
  | "callback"
  | "disconnect"
  | "request"
  | "pickerSession"
  | "chooseFolder"
  | "useDefaultFolder"
>;
