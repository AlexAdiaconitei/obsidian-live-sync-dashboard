import { open, readdir, rename, rm, writeFile } from "node:fs/promises";
import {
  type BackupGateway,
  type BackupRun,
  type BackupStatus,
  ServiceError,
} from "../contracts.ts";

function hasControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function run(value: unknown): value is BackupRun {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const date = (value: unknown) => {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
      !Number.isFinite(Date.parse(value))
    )
      return false;
    const normalized = value.length === 20 ? value.replace("Z", ".000Z") : value;
    return new Date(value).toISOString() === normalized;
  };
  const consistent =
    item.outcome === "running"
      ? item.endedAt === null && item.error === null
      : date(item.endedAt) &&
        (item.outcome === "success"
          ? item.error === null &&
            item.uploadOk === true &&
            item.retentionOk === true &&
            item.file !== null &&
            Number(item.sizeBytes) > 0
          : typeof item.error === "string");
  return (
    typeof item.requestId === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.requestId) &&
    typeof item.actor === "string" &&
    item.actor.length > 0 &&
    item.actor.length <= 254 &&
    !hasControl(item.actor) &&
    ["cron", "manual"].includes(String(item.trigger)) &&
    date(item.startedAt) &&
    (item.endedAt === null || date(item.endedAt)) &&
    ["running", "success", "failure"].includes(String(item.outcome)) &&
    (item.file === null ||
      (typeof item.file === "string" &&
        /^obsidian-couchdb-[a-zA-Z0-9-]+\.tar\.gz\.age$/.test(item.file))) &&
    (item.sizeBytes === null ||
      (Number.isSafeInteger(item.sizeBytes) && Number(item.sizeBytes) >= 0)) &&
    (item.error === null ||
      (typeof item.error === "string" &&
        [
          "archive_failed",
          "upload_failed",
          "retention_failed",
          "interrupted",
          "worker_failed",
        ].includes(item.error))) &&
    [item.uploadOk, item.retentionOk, item.notificationOk].every(
      (value) => typeof value === "boolean",
    ) &&
    (!item.retentionOk || item.uploadOk === true) &&
    (!item.notificationOk || item.retentionOk === true) &&
    consistent
  );
}

export function validateBackupStatus(value: unknown): BackupStatus {
  if (!value || typeof value !== "object") throw new ServiceError("backup_status_invalid", 503);
  const status = value as BackupStatus;
  if (
    status.schemaVersion !== 1 ||
    !Array.isArray(status.history) ||
    status.history.length > 32 ||
    !status.history.every(run) ||
    ![status.running, status.lastAttempt, status.lastSuccess].every(
      (item) => item === null || run(item),
    ) ||
    (status.running !== null && status.running.outcome !== "running") ||
    (status.lastSuccess !== null && status.lastSuccess.outcome !== "success") ||
    typeof status.schedule !== "string" ||
    status.schedule.length > 100 ||
    !/^[\d*,/\- ]+$/.test(status.schedule) ||
    typeof status.timezone !== "string" ||
    !/^[\w+/-]{1,64}$/.test(status.timezone) ||
    !Number.isInteger(status.retentionDays) ||
    status.retentionDays < 1 ||
    status.retentionDays > 3650
  ) {
    throw new ServiceError("backup_status_invalid", 503);
  }
  return status;
}

export class FileBackupGateway implements BackupGateway {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private statusDir?: string,
    private requestsDir?: string,
  ) {}

  async status(): Promise<BackupStatus | null> {
    if (!this.statusDir) return null;
    try {
      const file = await open(`${this.statusDir}/status.json`, "r");
      try {
        if ((await file.stat()).size > 65536) throw new Error("size");
        const bytes = new Uint8Array(65537);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead: count } = await file.read(bytes.subarray(offset));
          if (count === 0) break;
          offset += count;
        }
        if (offset > 65536) throw new Error("size");
        return validateBackupStatus(
          JSON.parse(new TextDecoder().decode(bytes.subarray(0, offset))),
        );
      } finally {
        await file.close();
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw new ServiceError("backup_status_invalid", 503);
    }
  }

  request(actor: string): Promise<{ requestId: string }> {
    const result = this.queue.then(() => this.enqueue(actor));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async enqueue(actor: string): Promise<{ requestId: string }> {
    if (!this.requestsDir) throw new ServiceError("backup_not_configured", 503);
    if (!actor || actor.length > 254 || hasControl(actor)) {
      throw new ServiceError("invalid_actor");
    }
    let temporary: string | undefined;
    try {
      let pending = 0;
      for (const entry of await readdir(this.requestsDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".json")) pending++;
        if (pending >= 16) throw new ServiceError("backup_queue_full", 429);
      }
      const requestId = crypto.randomUUID();
      temporary = `${this.requestsDir}/.${requestId}.tmp`;
      const request = { schemaVersion: 1, requestId, actor, requestedAt: new Date().toISOString() };
      await writeFile(temporary, JSON.stringify(request) + "\n", {
        flag: "wx",
        mode: 0o660,
      });
      await rename(temporary, `${this.requestsDir}/${requestId}.json`);
      temporary = undefined;
      return { requestId };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError("backup_request_failed", 503);
    } finally {
      if (temporary) await rm(temporary).catch(() => undefined);
    }
  }
}
