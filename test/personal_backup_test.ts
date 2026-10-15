import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { gunzipSync } from "node:zlib";
import {
  type ArchiveWriter,
  GoogleDrive,
  TokenCipher,
  DRIVE_FOLDER,
  type DriveConfig,
} from "../src/backup/drive.ts";
import { ServiceError } from "../src/contracts.ts";
import { ageArchive, backupDue, PersonalBackups } from "../src/backup/personal.ts";
import { CouchClient, type CouchDocument } from "../src/couchdb/client.ts";
import type { DashboardService, Person, Vault } from "../src/contracts.ts";

const config: DriveConfig = {
  clientId: "fixture-client",
  clientSecret: "fixture-secret",
  tokenKey: Buffer.alloc(32, 7).toString("base64"),
  redirectUri: "https://owner.example.test/backups/google/callback",
  workDir: tmpdir(),
};
const person: Person = {
  id: "alice-id",
  couchUser: "alice",
  displayName: "Alice",
  tailscaleLogin: "alice@example.test",
  status: "active",
  createdAt: "2026-01-01T00:00:00Z",
};
const vault: Vault = {
  id: "vault-id",
  personId: person.id,
  db: "alice_notes",
  label: "Notes",
  adopted: false,
  idRecoveryCode: "owner-recovery",
  createdAt: person.createdAt,
};
class MemoryClient extends CouchClient {
  docs = new Map<string, CouchDocument>();
  paths: string[] = [];
  member = "alice";
  constructor() {
    super("http://127.0.0.1:1", "fixture", "unused");
  }
  override async get<T>(_db: string, id: string): Promise<T | undefined> {
    return structuredClone(this.docs.get(id)) as T | undefined;
  }
  override async put<T extends CouchDocument>(_db: string, doc: T): Promise<T> {
    this.docs.set(doc._id, structuredClone(doc));
    return doc;
  }
  override async security() {
    return {
      admins: { names: [], roles: ["_admin"] },
      members: { names: [this.member], roles: [] },
    };
  }
  override async request<T>(path: string): Promise<T> {
    this.paths.push(path);
    const url = new URL(path, "http://fixture/");
    if (url.pathname.endsWith("/_changes")) {
      assert.equal(url.searchParams.get("style"), "all_docs");
      const first = url.searchParams.get("since") === "0";
      return {
        results: first
          ? [{ id: "note", changes: [{ rev: "2-a" }, { rev: "2-b" }] }]
          : [{ id: "removed", changes: [{ rev: "3-c" }] }],
        last_seq: first ? "1-seq" : "2-seq",
        pending: first ? 1 : 0,
      } as T;
    }
    const rev = url.searchParams.get("rev");
    assert.equal(url.searchParams.get("revs"), "true");
    assert.equal(url.searchParams.get("attachments"), "true");
    const id = url.pathname.split("/").at(-1);
    return {
      _id: id,
      _rev: rev,
      _revisions: { start: Number(rev?.[0]), ids: [rev?.slice(2), "ancestor"] },
      ...(id === "removed"
        ? { _deleted: true }
        : {
            payload: "owner-note",
            _attachments: { pic: { content_type: "text/plain", data: "aGVsbG8=" } },
          }),
    } as T;
  }
}
class FakeDrive extends GoogleDrive {
  uploads = 0;
  retained = 0;
  revoked = 0;
  exchanged = 0;
  failUpload = false;
  failRetention = false;
  constructor() {
    super(config);
  }
  override async exchange() {
    this.exchanged++;
    return "private-refresh-token";
  }
  override async access() {
    return "private-access-token";
  }
  override async folder() {
    return "personal-folder";
  }
  override async folderInfo(_token: string, id: string) {
    if (!["personal-folder", "selected-folder"].includes(id))
      throw new ServiceError("invalid_drive_folder", 400);
    return { id, name: id === "personal-folder" ? DRIVE_FOLDER : "Selected notes" };
  }
  override async revoke() {
    this.revoked++;
  }
  override async upload(
    _token: string,
    folder: string,
    _owner: string,
    _name: string,
    path: string,
  ) {
    assert.equal(folder, "personal-folder");
    assert.ok((await readFile(path)).length > 0);
    if (this.failUpload) throw new Error("private-access-token");
    this.uploads++;
  }
  override async retention() {
    if (this.failRetention) throw new Error("private-provider-details");
    this.retained++;
  }
}
function fixture(workDir = tmpdir(), picker = true, archive?: ArchiveWriter) {
  const client = new MemoryClient();
  const drive = new FakeDrive();
  let active = true;
  let vaults = [vault];
  const service = {
    async getPerson() {
      return { ...person, status: active ? "active" : "disabled" };
    },
    async listVaults() {
      return { items: vaults };
    },
    async listPeople() {
      return { items: [person] };
    },
  } as unknown as DashboardService;
  const backups = new PersonalBackups(
    client,
    service,
    "panel",
    { ...config, workDir, picker: picker ? { apiKey: "browser-key", appId: "123" } : undefined },
    drive,
    archive ??
      (async (source, _recipient, path) => {
        let content = "";
        for await (const chunk of source) content += chunk;
        await writeFile(path, content);
      }),
  );
  const ready = () =>
    client.docs.set(`personal-backup:${person.id}`, {
      _id: `personal-backup:${person.id}`,
      kind: "personal-backup",
      schemaVersion: 1,
      personId: person.id,
      token: new TokenCipher(config.tokenKey).seal("private-refresh-token", person.id),
      defaultFolderId: "personal-folder",
      value: {
        connected: true,
        folderId: "personal-folder",
        folderName: DRIVE_FOLDER,
        recipient: "public-recipient",
        retentionDays: 30,
        enabled: true,
        running: false,
        lastAttempt: null,
        lastSuccess: null,
        error: null,
      },
    });
  return {
    backups,
    client,
    drive,
    ready,
    disable: () => {
      active = false;
    },
    setVaults: (next: Vault[]) => {
      vaults = next;
    },
  };
}
async function finished(backups: PersonalBackups) {
  for (let n = 0; n < 200; n++) {
    const status = await backups.status(person.id);
    if (!status.running) return status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("backup did not finish");
}

test("Drive token ciphertext is authenticated and bound to its owner", () => {
  const cipher = new TokenCipher(config.tokenKey);
  const value = cipher.seal("refresh-secret", "alice");
  assert.equal(cipher.open(value, "alice"), "refresh-secret");
  assert.throws(() => cipher.open(value, "bob"));
  const modified = Buffer.from(value, "base64");
  modified[30] ^= 1;
  assert.throws(() => cipher.open(modified.toString("base64"), "alice"));
  assert.notEqual(value, cipher.seal("refresh-secret", "alice"));
});

test("folder selection uses the connection's token, retains the default and rejects changes during a run", async () => {
  const { backups, ready, client } = fixture();
  ready();
  assert.equal(DRIVE_FOLDER, "obsidian-livesync-backups");
  assert.deepEqual(await backups.pickerSession(person.id), {
    accessToken: "private-access-token",
    apiKey: "browser-key",
    appId: "123",
  });
  await backups.chooseFolder(person.id, "selected-folder");
  assert.equal((await backups.status(person.id)).folderId, "selected-folder");
  assert.equal((await backups.status(person.id)).folderName, "Selected notes");
  assert.equal(client.docs.get(`personal-backup:${person.id}`)!.defaultFolderId, "personal-folder");
  await assert.rejects(backups.chooseFolder(person.id, "not-authorized"));
  assert.equal((await backups.status(person.id)).folderId, "selected-folder");
  await backups.useDefaultFolder(person.id);
  assert.equal((await backups.status(person.id)).folderName, DRIVE_FOLDER);
  const doc = client.docs.get(`personal-backup:${person.id}`)!;
  (doc.value as { running: boolean }).running = true;
  await assert.rejects(backups.chooseFolder(person.id, "selected-folder"), {
    message: "backup_busy",
  });
  await assert.rejects(backups.useDefaultFolder(person.id), { message: "backup_busy" });
  const unavailable = fixture(tmpdir(), false);
  unavailable.ready();
  await assert.rejects(unavailable.backups.pickerSession(person.id), {
    message: "drive_picker_not_configured",
  });
  await assert.rejects(fixture().backups.pickerSession(person.id), {
    message: "backup_not_configured",
  });
});

test("Google validates selected folder ownership, write access, type and trash state", async () => {
  const good = {
    id: "selected-folder",
    name: "mis-copias",
    mimeType: "application/vnd.google-apps.folder",
    trashed: false,
    ownedByMe: true,
    capabilities: { canAddChildren: true },
  };
  let metadata = good;
  let calls = 0;
  const drive = new GoogleDrive(config, async (input, init) => {
    calls++;
    assert.equal(new URL(String(input)).pathname, "/drive/v3/files/selected-folder");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer owner-access");
    return Response.json(metadata);
  });
  assert.deepEqual(await drive.folderInfo("owner-access", "selected-folder"), {
    id: "selected-folder",
    name: "mis-copias",
  });
  for (const override of [
    { ownedByMe: false },
    { trashed: true },
    { capabilities: { canAddChildren: false } },
    { mimeType: "text/plain" },
    { id: "another-folder" },
  ]) {
    metadata = { ...good, ...override };
    await assert.rejects(drive.folderInfo("owner-access", "selected-folder"), {
      message: "invalid_drive_folder",
    });
  }
  const previous = calls;
  await assert.rejects(drive.folderInfo("owner-access", "../other?token=bad"));
  assert.equal(calls, previous);
});
test("Google consent is offline, narrow-scoped and bound to owner, browser and single-use state", async () => {
  const { backups, client, drive } = fixture();
  const { url, state } = backups.connect(person.id);
  const auth = new URL(url);
  assert.equal(auth.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file");
  assert.equal(auth.searchParams.get("access_type"), "offline");
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
  await assert.rejects(backups.callback("bob", state, state, "code"));
  await assert.rejects(backups.callback(person.id, state, "other-browser", "code"));
  assert.equal(drive.exchanged, 0);
  await backups.callback(person.id, state, state, "code");
  await assert.rejects(backups.callback(person.id, state, state, "code"));
  assert.equal((await backups.status(person.id)).folderId, "personal-folder");
  assert.ok(!JSON.stringify([...client.docs.values()]).includes("private-refresh-token"));
  assert.ok(!JSON.stringify(await backups.status(person.id)).includes("token"));
  await backups.disconnect(person.id);
  assert.equal(drive.revoked, 1);
  assert.equal((await backups.status(person.id)).connected, false);
  const next = backups.connect(person.id);
  await backups.callback(person.id, next.state, next.state, "code");
  const stored = client.docs.get(`personal-backup:${person.id}`)!;
  stored.token = "corrupt-token-after-key-loss";
  await backups.disconnect(person.id);
  assert.equal((await backups.status(person.id)).connected, false);
  assert.equal((await backups.status(person.id)).error, "drive_revoke_failed");
  assert.equal(client.docs.get(`personal-backup:${person.id}`)!.token, null);
});
test("personal export includes conflicts, ancestry, attachments, tombstones and only owned vaults", async () => {
  const { backups, client, setVaults } = fixture();
  client.docs.set("_local/obsidian_livesync_sync_parameters", {
    _id: "_local/obsidian_livesync_sync_parameters",
    _rev: "0-3",
    type: "sync-parameters",
    protocolVersion: 2,
    pbkdf2salt: "c2FsdA==",
  });
  let content = "";
  for await (const line of backups.export(person.id)) content += line;
  const lines = content
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(lines[0].vaults[0].idRecoveryCode, "owner-recovery");
  assert.deepEqual(lines[1], {
    type: "local",
    vaultId: vault.id,
    doc: {
      _id: "_local/obsidian_livesync_sync_parameters",
      type: "sync-parameters",
      protocolVersion: 2,
      pbkdf2salt: "c2FsdA==",
    },
  });
  assert.deepEqual(
    lines.slice(2).map((line) => line.doc._rev),
    ["2-a", "2-b", "3-c"],
  );
  assert.equal(lines[2].doc._attachments.pic.data, "aGVsbG8=");
  assert.equal(lines[4].doc._deleted, true);
  assert.ok(client.paths.every((path) => path.startsWith("alice_notes/")));
  for (const invalid of [
    { ...vault, personId: "bob" },
    { ...vault, provisioning: true },
    { ...vault, db: "_users" },
    { ...vault, db: "panel" },
  ]) {
    setVaults([invalid]);
    await assert.rejects(async () => {
      for await (const line of backups.export(person.id)) {
        assert.ok(line);
      }
    });
  }
  setVaults([vault]);
  client.member = "bob";
  await assert.rejects(async () => {
    for await (const line of backups.export(person.id)) {
      assert.ok(line);
    }
  });
});
test("upload failures preserve success and skip retention; retention failures preserve the new upload", async () => {
  const dir = await mkdtemp(join(tmpdir(), "personal-test-"));
  try {
    const { backups, drive, ready, disable } = fixture(dir);
    ready();
    await backups.request(person.id);
    const first = await finished(backups);
    assert.ok(first.lastSuccess);
    assert.equal(first.error, null);
    drive.failUpload = true;
    await backups.request(person.id);
    const failure = await finished(backups);
    assert.equal(failure.lastSuccess, first.lastSuccess);
    assert.equal(failure.error, "drive_upload_failed");
    assert.equal(drive.retained, 1);
    drive.failUpload = false;
    drive.failRetention = true;
    await backups.request(person.id);
    const retention = await finished(backups);
    assert.equal(retention.error, "drive_retention_failed");
    assert.ok(retention.lastSuccess);
    assert.equal(drive.uploads, 2);
    assert.deepEqual(await readdir(dir), []);
    assert.ok(!JSON.stringify(retention).includes("private-"));
    disable();
    await assert.rejects(backups.request(person.id));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("daily scheduler survives interrupted status and does not repeat a recent attempt", async () => {
  const { backups, drive, client, ready } = fixture();
  ready();
  const doc = client.docs.get(`personal-backup:${person.id}`)!;
  (doc.value as { running: boolean }).running = true;
  await backups.tick();
  assert.equal((await finished(backups)).error, null);
  await backups.tick();
  assert.equal(drive.uploads, 1);
  await backups.disconnect(person.id);
  await backups.tick();
  assert.equal(drive.uploads, 1);
});
test("Drive resumable upload validates its destination and confirms intermediate byte ranges", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drive-upload-"));
  try {
    const path = join(dir, "encrypted.age");
    await writeFile(path, Buffer.alloc(8 * 1024 * 1024 + 7, 1));
    let calls = 0;
    const drive = new GoogleDrive(config, async (_input, init) => {
      calls++;
      if (calls === 1)
        return new Response(null, {
          status: 200,
          headers: {
            location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=fixture",
          },
        });
      const headers = new Headers(init?.headers);
      assert.equal(
        headers.get("content-range"),
        calls === 2 ? "bytes 0-8388607/8388615" : "bytes 8388608-8388614/8388615",
      );
      return new Response(
        null,
        calls === 2 ? { status: 308, headers: { range: "bytes=0-8388607" } } : { status: 200 },
      );
    });
    await drive.upload("access", "folder", "owner", "name.age", path);
    assert.equal(calls, 3);
    let leaked = false;
    const unsafe = new GoogleDrive(config, async () => {
      if (leaked) throw new Error("request reached untrusted host");
      leaked = true;
      return new Response(null, {
        headers: { location: "https://attacker.example/upload/drive/" },
      });
    });
    await assert.rejects(unsafe.upload("access", "folder", "owner", "name.age", path), {
      message: "drive_upload_failed",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("Drive retention filters by folder, application, owner, format and age", async () => {
  const requests: { url: URL; init?: RequestInit }[] = [];
  const drive = new GoogleDrive(config, async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    return Response.json(
      init?.method === "PATCH" ? { id: "old-backup" } : { files: [{ id: "old-backup" }] },
    );
  });
  await drive.retention("access", "personal-folder", "owner-hash", 30);
  const query = requests[0].url.searchParams.get("q")!;
  for (const fragment of [
    "'personal-folder' in parents",
    "createdTime <",
    "application",
    "owner-hash",
    "personal-v1",
  ])
    assert.ok(query.includes(fragment));
  assert.equal(requests[1].init?.body, '{"trashed":true}');
});

const ageAvailable = spawnSync("age", ["--version"], { stdio: "ignore" }).status === 0;
test(
  "personal archives decrypt with the owner's age identity and reject another identity",
  { skip: !ageAvailable },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "age-personal-"));
    try {
      const key = spawnSync("age-keygen", [], { encoding: "utf8" });
      assert.equal(key.status, 0);
      const publicKey = spawnSync("age-keygen", ["-y"], {
        input: key.stdout,
        encoding: "utf8",
      }).stdout.trim();
      const identity = join(dir, "identity.txt");
      await writeFile(identity, key.stdout);
      const path = join(dir, "backup.age");
      const plaintext = '{"type":"manifest","private":"owner-note"}\n';
      await ageArchive(Readable.from([plaintext]), publicKey, path);
      assert.ok(!(await readFile(path)).includes(Buffer.from("owner-note")));
      const decrypted = spawnSync("age", ["-d", "-i", identity, path]);
      assert.equal(decrypted.status, 0);
      assert.equal(gunzipSync(decrypted.stdout).toString(), plaintext);
      const wrong = spawnSync("age-keygen", [], { encoding: "utf8" });
      const wrongPath = join(dir, "wrong.txt");
      await writeFile(wrongPath, wrong.stdout);
      assert.notEqual(
        spawnSync("age", ["-d", "-i", wrongPath, path], { stdio: "ignore" }).status,
        0,
      );
      const { backups } = fixture();
      await backups.settings(person.id, publicKey, 30, true);
      await assert.rejects(backups.settings(person.id, "AGE-SECRET-KEY-NEVER-SUBMIT", 30, true));
      await assert.rejects(backups.settings(person.id, publicKey, 0, true));
      const invalidChecksum = publicKey.slice(0, -1) + (publicKey.endsWith("q") ? "p" : "q");
      await assert.rejects(backups.settings(person.id, invalidChecksum, 30, true));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
test("a request during another owner's run is queued and the scheduler starts it", async () => {
  const { backups, drive, client, ready } = fixture();
  ready();
  const doc = client.docs.get(`personal-backup:${person.id}`)!;
  (doc.value as { enabled: boolean }).enabled = false;
  const scheduler = backups as unknown as { busy: boolean };
  scheduler.busy = true;
  await backups.request(person.id);
  assert.equal((await backups.status(person.id)).queued, true);
  assert.equal(drive.uploads, 0);
  scheduler.busy = false;
  await backups.tick();
  const status = await finished(backups);
  assert.equal(status.queued, false);
  assert.equal(drive.uploads, 1);
});
test("failed runs retry after an hour and successful ones after a day", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  const due = (lastAttempt: string, lastSuccess: string | null, error: string | null = null) =>
    backupDue(
      {
        connected: true,
        folderId: "folder",
        recipient: "age1",
        retentionDays: 30,
        enabled: true,
        running: false,
        lastAttempt,
        lastSuccess,
        error,
      },
      now,
    );
  assert.equal(due("2026-10-17T10:30:00Z", "2026-10-17T10:30:00Z"), false);
  assert.equal(due("2026-10-17T10:30:00Z", null, "drive_upload_failed"), true);
  assert.equal(due("2026-10-17T11:30:00Z", null, "drive_upload_failed"), false);
  assert.equal(due("2026-10-16T11:00:00Z", "2026-10-16T11:00:00Z"), true);
});
test("an export over the archive limit reports its own error", async () => {
  const { backups, ready } = fixture(tmpdir(), true, async () => {
    throw new Error("backup_too_large");
  });
  ready();
  await backups.request(person.id);
  assert.equal((await finished(backups)).error, "backup_too_large");
});
