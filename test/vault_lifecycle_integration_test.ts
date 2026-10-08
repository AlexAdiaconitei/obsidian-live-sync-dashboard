import { test } from "node:test";
import assert from "node:assert/strict";
import { CouchClient, CouchError, type CouchDocument } from "../src/couchdb/client.ts";
import { CouchDashboardService } from "../src/domain/service.ts";
import { assertDisposableFixture } from "./fixture.ts";
import { createApps } from "../src/web/apps.ts";
import { ownerCookie, withSession } from "./owner-login.ts";
import { loadConfig } from "../src/config.ts";
import { zipArchive } from "../src/backup/zip.ts";

test(
  "owners export recoverable leaves and delete only their own exclusive vault after explicit confirmation",
  { skip: !process.env.TEST_COUCHDB_URL },
  async () => {
    const url = process.env.TEST_COUCHDB_URL!;
    const user = process.env.TEST_COUCHDB_USER!;
    const password = process.env.TEST_COUCHDB_PASSWORD!;
    assertDisposableFixture(url, user, password);
    const client = new CouchClient(url, user, password);
    const prefix = `test_lifecycle_${crypto.randomUUID().replaceAll("-", "")}`;
    const registry = `${prefix}_panel`;
    const service = new CouchDashboardService(client, registry, "https://sync.example.test");
    const databases = new Set([registry]);
    const accounts = [`${prefix}_alice`, `${prefix}_bob`];
    const secret = "fixture-lifecycle-password";
    try {
      await service.initialize();
      for (const couchUser of accounts) {
        await service.createPerson("admin", {
          couchUser,
          displayName: couchUser,
          tailscaleLogin: couchUser,
        });
        await service.setInitialPassword(couchUser, secret);
      }
      const [alice, bob] = accounts;
      const vault = await service.createOwnedVault(alice, "Notes");
      databases.add(vault.db);
      const repeated = await Promise.all([
        service.createOwnedVault(alice, "Notes"),
        service.createOwnedVault(alice, "Notes"),
      ]);
      assert.ok(repeated.every((value) => value.id === vault.id));
      const other = await service.createOwnedVault(bob, "Private");
      databases.add(other.db);
      await client.put(other.db, { _id: "bob-secret", value: "never-export-bob" });
      await client.request(`${vault.db}/_bulk_docs`, "POST", {
        new_edits: false,
        docs: [
          {
            _id: "conflicted",
            _rev: `2-${"a".repeat(32)}`,
            _revisions: { start: 2, ids: ["a".repeat(32), "c".repeat(32)] },
            value: "alice-one",
            _attachments: {
              binary: { content_type: "application/octet-stream", data: "AAECAwQ=" },
            },
          },
          {
            _id: "conflicted",
            _rev: `2-${"b".repeat(32)}`,
            _revisions: { start: 2, ids: ["b".repeat(32), "c".repeat(32)] },
            value: "alice-two",
          },
          { _id: "removed", _rev: `1-${"d".repeat(32)}`, _deleted: true },
        ],
      });
      const config = loadConfig({
        COUCHDB_URL: url,
        COUCHDB_USER: user,
        COUCHDB_PASSWORD: password,
        PUBLIC_COUCHDB_URL: "https://sync.example.test",
        PUBLIC_ADMIN_URL: "https://admin.example.test",
        PUBLIC_SETUP_URL: "https://owner.example.test",
        PANEL_ADMINS: "admin",
        PANEL_CSRF_SECRET: "fixture-lifecycle-secret-at-least-32-characters",
      });
      const apps = createApps({
        config,
        service,
        backup: { status: async () => null, request: async () => ({ requestId: "test" }) },
      });
      const session = await ownerCookie(config.csrfSecret, service, alice, secret);
      const request = (path: string, init: RequestInit = {}) =>
        new Request(`${config.ownerOrigin}${path}`, {
          ...init,
          headers: withSession(init.headers, session),
        });
      const form = await apps.owner.fetch(request(`/vaults/${vault.id}/delete`));
      assert.equal(form.status, 200);
      const html = await form.text();
      assert.ok(html.includes("ALL its notes"));
      assert.ok(html.includes('value="downloaded"') && html.includes('value="skip"'));
      const cookie = form.headers.get("set-cookie")!.split(";")[0];
      const csrf = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
      const post = (fields: Record<string, string>) =>
        apps.owner.fetch(
          request(`/vaults/${vault.id}/delete`, {
            method: "POST",
            headers: {
              Cookie: cookie,
              Origin: config.ownerOrigin,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams(fields),
          }),
        );
      assert.equal((await post({ csrf: "wrong", password: secret })).status, 403);
      assert.equal((await post({ csrf, label: vault.label, password: secret })).status, 400);
      const confirmation = {
        label: vault.label,
        password: secret,
        acknowledged: true,
        backup: "downloaded" as const,
      };
      for (const invalid of [
        { ...confirmation, label: "Other" },
        { ...confirmation, acknowledged: false },
        { ...confirmation, password: "wrong-password" },
      ])
        await assert.rejects(() => service.deleteOwnedVault(alice, vault.id, invalid));
      await assert.rejects(() => service.getOwnedVault(bob, vault.id));
      await assert.rejects(() =>
        service.exportOwnedVault(bob, vault.id)[Symbol.asyncIterator]().next(),
      );
      await assert.rejects(() => service.deleteOwnedVault(bob, vault.id, confirmation));
      const archive = await apps.owner.fetch(request(`/vaults/${vault.id}/archive.zip`));
      assert.equal(archive.status, 200);
      assert.equal(archive.headers.get("content-type"), "application/zip");
      const zip = Buffer.from(await archive.arrayBuffer());
      assert.equal(zip.readUInt32LE(), 0x04034b50);
      assert.ok(zip.includes(Buffer.from("vault.ndjson")));
      assert.ok(!zip.includes(Buffer.from("never-export-bob")));
      const exported: string[] = [];
      for await (const line of service.exportOwnedVault(alice, vault.id)) exported.push(line);
      const records = exported.map((line) => JSON.parse(line));
      assert.equal(records[0].vaults[0].idRecoveryCode, vault.idRecoveryCode);
      assert.equal(records.filter((row) => row.doc?._id === "conflicted").length, 2);
      assert.ok(records.some((row) => row.doc?._deleted));
      assert.ok(records.some((row) => row.doc?._attachments?.binary?.data === "AAECAwQ="));
      const restored = `${prefix}_restore`;
      databases.add(restored);
      await client.createDatabase(restored);
      const imported = await client.request<Array<{ error?: string }>>(
        `${restored}/_bulk_docs`,
        "POST",
        {
          new_edits: false,
          docs: records.filter((row) => row.type === "document").map((row) => row.doc),
        },
      );
      assert.ok(imported.every((row) => !row.error));
      const restoredConflicts = await client.request<unknown[]>(
        `${restored}/conflicted?open_revs=all&attachments=true`,
      );
      assert.equal(restoredConflicts.length, 2);
      const inProgress = service.exportOwnedVault(alice, vault.id);
      await inProgress.next();
      await assert.rejects(() => service.deleteOwnedVault(alice, vault.id, confirmation), {
        message: "vault_export_busy",
      });
      await inProgress.return(undefined);
      const response = await post({
        csrf,
        label: vault.label,
        password: secret,
        irreversible: "on",
        backup: "downloaded",
      });
      assert.equal(response.status, 303);
      await assert.rejects(() => client.request(vault.db), { status: 404 });
      assert.ok(await client.get(other.db, "bob-secret"));
      assert.ok((await service.loginOwner(alice, secret)).person);
      const recreated = await service.createOwnedVault(alice, vault.label);
      databases.add(recreated.db);
      assert.notEqual(
        recreated.db,
        vault.db,
        "old devices must not reconnect to a recreated vault",
      );
      await service.deleteOwnedVault(alice, recreated.id, { ...confirmation, backup: "skip" });
      assert.equal((await service.personQuota(alice)).usedBytes, 0);
      const sharedDb = `${prefix}_shared`;
      databases.add(sharedDb);
      await client.createDatabase(sharedDb);
      await client.setSecurity(sharedDb, {
        admins: { names: [], roles: ["_admin"] },
        members: { names: [alice, bob], roles: ["_admin"] },
      });
      const shared = await service.adoptVault("admin", {
        personId: (await service.findPersonByLogin(alice))!.id,
        db: sharedDb,
        couchUser: alice,
        tailscaleLogin: alice,
        displayName: alice,
        label: "Shared",
      });
      assert.equal((await service.createOwnedVault(alice, "Shared")).id, shared.id);
      await assert.rejects(
        () => service.deleteOwnedVault(alice, shared.id, { ...confirmation, label: "Shared" }),
        { message: "vault_shared_delete" },
      );
      assert.ok(await client.request(sharedDb));
    } finally {
      for (const db of databases)
        await client.request(encodeURIComponent(db), "DELETE").catch(() => {});
      for (const account of accounts) {
        const doc = await client.get<CouchDocument>("_users", `org.couchdb.user:${account}`);
        if (doc)
          await client.request(`_users/${encodeURIComponent(doc._id)}?rev=${doc._rev}`, "DELETE");
      }
    }
  },
);

test(
  "vault deletion resumes after a crash but refuses a replacement database",
  { skip: !process.env.TEST_COUCHDB_URL },
  async () => {
    const url = process.env.TEST_COUCHDB_URL!;
    const user = process.env.TEST_COUCHDB_USER!;
    const password = process.env.TEST_COUCHDB_PASSWORD!;
    assertDisposableFixture(url, user, password);
    const prefix = `test_delete_resume_${crypto.randomUUID().replaceAll("-", "")}`;
    const registry = `${prefix}_panel`;
    class FaultClient extends CouchClient {
      fail = false;
      override async request<T>(
        path: string,
        method = "GET",
        body?: unknown,
        auth?: string,
      ): Promise<T> {
        if (this.fail && method === "DELETE" && path.startsWith(`${registry}/vault%3A`)) {
          this.fail = false;
          throw new CouchError(503);
        }
        return super.request<T>(path, method, body, auth);
      }
    }
    const client = new FaultClient(url, user, password);
    const databases = new Set([registry]);
    const secret = "fixture-delete-resume-password";
    try {
      let service = new CouchDashboardService(client, registry, "https://sync.example.test");
      await service.initialize();
      await service.createPerson("admin", {
        couchUser: prefix,
        displayName: "Alice",
        tailscaleLogin: prefix,
      });
      await service.setInitialPassword(prefix, secret);
      for (const replace of [false, true]) {
        const vault = await service.createOwnedVault(prefix, replace ? "Replacement" : "Resume");
        databases.add(vault.db);
        client.fail = true;
        await assert.rejects(() =>
          service.deleteOwnedVault(prefix, vault.id, {
            label: vault.label,
            password: secret,
            acknowledged: true,
            backup: "skip",
          }),
        );
        await assert.rejects(() => client.request(vault.db), { status: 404 });
        if (replace) {
          await client.createDatabase(vault.db);
          await client.put(vault.db, { _id: "unrelated", safe: true });
        }
        service = new CouchDashboardService(client, registry, "https://sync.example.test");
        if (replace) {
          await assert.rejects(() => service.initialize(), {
            message: "resource_ownership_unknown",
          });
          assert.ok(await client.get(vault.db, "unrelated"));
        } else {
          await service.initialize();
          await assert.rejects(() => service.getOwnedVault(prefix, vault.id));
          assert.equal((await service.personQuota(prefix)).usedBytes, 0);
        }
      }
    } finally {
      for (const db of databases) await client.request(db, "DELETE").catch(() => {});
      const doc = await client.get<CouchDocument>("_users", `org.couchdb.user:${prefix}`);
      if (doc)
        await client.request(`_users/${encodeURIComponent(doc._id)}?rev=${doc._rev}`, "DELETE");
    }
  },
);

test("streaming ZIP stores a standard CRC and refuses path traversal and oversized exports", async () => {
  const content = async function* () {
    yield "123456789";
  };
  const chunks: Uint8Array[] = [];
  for await (const chunk of zipArchive([{ name: "vault.ndjson", content: content() }]))
    chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.equal(bytes.readUInt32LE(central + 16), 0xcbf43926);
  assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  await assert.rejects(async () => {
    for await (const chunk of zipArchive([{ name: "../escape", content: content() }])) void chunk;
  });
  await assert.rejects(async () => {
    for await (const chunk of zipArchive([{ name: "file", content: content() }], 1)) void chunk;
  });
});
