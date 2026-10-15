import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileBackupGateway, validateBackupStatus } from "../src/backup/files.ts";

const empty = () => ({
  schemaVersion: 1,
  running: null,
  lastAttempt: null,
  lastSuccess: null,
  history: [],
  schedule: "30 3 * * *",
  timezone: "UTC",
  retentionDays: 30,
});

test("backup status rejects impossible calendar dates instead of normalizing them", () => {
  const success = {
    requestId: crypto.randomUUID(),
    actor: "admin@example.test",
    trigger: "manual",
    startedAt: "2026-02-28T00:00:00Z",
    endedAt: "2026-03-01T00:00:00Z",
    outcome: "success",
    file: "obsidian-couchdb-test.tar.gz.age",
    sizeBytes: 100,
    error: null,
    uploadOk: true,
    retentionOk: true,
    notificationOk: false,
  };
  validateBackupStatus({ ...empty(), lastSuccess: success });
  assert.throws(
    () =>
      validateBackupStatus({
        ...empty(),
        lastSuccess: { ...success, startedAt: "2026-02-30T00:00:00Z" },
      }),
    { message: "backup_status_invalid" },
  );
});

test("backup queues concurrent requests atomically and rejects overflow", async () => {
  const dir = await mkdtemp(join(tmpdir(), "livesync-backup-"));
  try {
    const gateway = new FileBackupGateway(undefined, dir);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => gateway.request("admin@example.com")),
    );
    if (results.filter((r) => r.status === "fulfilled").length !== 16) throw Error("queue limit");
    for (const file of await readdir(dir, { withFileTypes: true })) {
      if (!file.name.endsWith(".json")) throw Error("partial file exposed");
      const request = JSON.parse(await readFile(`${dir}/${file.name}`, "utf8"));
      if (`${request.requestId}.json` !== file.name || request.actor !== "admin@example.com") {
        throw Error();
      }
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("backup rejects corrupt, oversized and incompatible worker status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "livesync-backup-"));
  const gateway = new FileBackupGateway(dir);
  try {
    if ((await gateway.status()) !== null) throw Error();
    await writeFile(`${dir}/status.json`, JSON.stringify(empty()));
    if ((await gateway.status())?.retentionDays !== 30) throw Error();
    for (const value of [
      "{broken",
      "x".repeat(65537),
      JSON.stringify({ ...empty(), schemaVersion: 2 }),
    ]) {
      await writeFile(`${dir}/status.json`, value);
      let rejected = false;
      try {
        await gateway.status();
      } catch {
        rejected = true;
      }
      if (!rejected) throw Error("accepted invalid status");
    }
    let rejected = false;
    try {
      validateBackupStatus({ ...empty(), history: Array(33).fill({}) });
    } catch {
      rejected = true;
    }
    if (!rejected) throw Error();
    const falseSuccess = {
      requestId: crypto.randomUUID(),
      actor: "admin@example.com",
      trigger: "manual",
      startedAt: "2026-10-07T00:00:00Z",
      endedAt: null,
      outcome: "success",
      file: null,
      sizeBytes: null,
      error: null,
      uploadOk: false,
      retentionOk: false,
      notificationOk: false,
    };
    rejected = false;
    try {
      validateBackupStatus({ ...empty(), lastSuccess: falseSuccess });
    } catch {
      rejected = true;
    }
    if (!rejected) throw Error("Accepted uncompleted success");
  } finally {
    await rm(dir, { recursive: true });
  }
});
