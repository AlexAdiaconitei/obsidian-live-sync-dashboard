import { test } from "node:test";
import assert from "node:assert/strict";
import { PersonalBackups } from "../src/backup/personal.ts";
import { CouchClient, restrictedSecurity } from "../src/couchdb/client.ts";
import { CouchDashboardService } from "../src/domain/service.ts";
import { assertDisposableFixture } from "./fixture.ts";
import { tmpdir } from "node:os";

test(
  "real personal export restores owner conflicts, attachments and deletions without another owner's data",
  {
    skip: !process.env.TEST_COUCHDB_URL,
  },
  async () => {
    const url = process.env.TEST_COUCHDB_URL!;
    const username = process.env.TEST_COUCHDB_USER!;
    const password = process.env.TEST_COUCHDB_PASSWORD!;
    assertDisposableFixture(url, username, password);
    const client = new CouchClient(url, username, password, 30_000);
    const prefix = `test_personal_${crypto.randomUUID().replaceAll("-", "")}`;
    const panel = `${prefix}_panel`;
    const alice = `${prefix}_alice`;
    const bob = `${prefix}_bob`;
    const restored = `${prefix}_restored`;
    const databases = [panel, alice, bob, restored];
    try {
      const service = new CouchDashboardService(client, panel, "https://sync.example.test");
      await service.initialize();
      const owner = await service.createPerson("fixture", {
        couchUser: alice,
        displayName: "Alice",
        tailscaleLogin: "alice@example.test",
        vaultLabel: "Notes",
        vaultSlug: alice,
      });
      await service.setInitialPassword("alice@example.test", "fixture-alice-long-password");
      await service.createPerson("fixture", {
        couchUser: bob,
        displayName: "Bob",
        tailscaleLogin: "bob@example.test",
        vaultLabel: "Private",
        vaultSlug: bob,
      });
      await client.put(bob, { _id: "bob-secret", payload: "never-export-bob" });
      await client.put(alice, {
        _id: "_local/obsidian_livesync_sync_parameters",
        type: "sync-parameters",
        protocolVersion: 2,
        pbkdf2salt: "c2FsdC1mb3ItYWxpY2U=",
      });
      await client.request(`${alice}/_bulk_docs`, "POST", {
        new_edits: false,
        docs: [
          {
            _id: "conflicted",
            _rev: "2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            _revisions: {
              start: 2,
              ids: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "cccccccccccccccccccccccccccccccc"],
            },
            payload: "first",
            _attachments: {
              pic: { content_type: "text/plain", data: "aGVsbG8=" },
            },
          },
          {
            _id: "conflicted",
            _rev: "2-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            _revisions: {
              start: 2,
              ids: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "cccccccccccccccccccccccccccccccc"],
            },
            payload: "second",
          },
          {
            _id: "removed",
            _rev: "2-dddddddddddddddddddddddddddddddd",
            _deleted: true,
            _revisions: {
              start: 2,
              ids: ["dddddddddddddddddddddddddddddddd", "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"],
            },
          },
        ],
      });
      const backup = new PersonalBackups(client, service, panel, {
        clientId: "fixture",
        clientSecret: "fixture",
        tokenKey: Buffer.alloc(32, 4).toString("base64"),
        redirectUri: "https://owner.example.test/backups/google/callback",
        workDir: tmpdir(),
      });
      let exported = "";
      for await (const line of backup.export(owner.id)) exported += line;
      assert.ok(!exported.includes("never-export-bob"));
      assert.ok(!exported.includes("org.couchdb.user"));
      const records = exported
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.ok(records[0].vaults[0].idRecoveryCode);
      await client.createDatabase(restored);
      await client.setSecurity(restored, restrictedSecurity());
      assert.equal(records[1].type, "local");
      await client.request(
        `${restored}/_local/obsidian_livesync_sync_parameters`,
        "PUT",
        records[1].doc,
      );
      for (const record of records.slice(2)) {
        const result = await client.request<unknown[]>(`${restored}/_bulk_docs`, "POST", {
          new_edits: false,
          docs: [record.doc],
        });
        assert.deepEqual(result, []);
      }
      const conflicts = await client.request<{ ok: { _rev: string } }[]>(
        `${restored}/conflicted?open_revs=all`,
      );
      assert.equal(conflicts.length, 2);
      const attachment = await client.request<{ _attachments: { pic: { data: string } } }>(
        `${restored}/conflicted?rev=2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&attachments=true`,
      );
      assert.equal(attachment._attachments.pic.data, "aGVsbG8=");
      const removed = await client.request<{ _deleted: boolean }>(
        `${restored}/removed?rev=2-dddddddddddddddddddddddddddddddd`,
      );
      assert.equal(removed._deleted, true);
      const parameters = await client.request<{ pbkdf2salt: string }>(
        `${restored}/_local/obsidian_livesync_sync_parameters`,
      );
      assert.equal(parameters.pbkdf2salt, "c2FsdC1mb3ItYWxpY2U=");
    } finally {
      for (const db of databases)
        await client.request(encodeURIComponent(db), "DELETE").catch(() => undefined);
      for (const name of [alice, bob]) {
        const id = `org.couchdb.user:${name}`;
        const user = await client.get<{ _rev: string }>("_users", id);
        if (user)
          await client.request(
            `_users/${encodeURIComponent(id)}?rev=${encodeURIComponent(user._rev)}`,
            "DELETE",
          );
      }
    }
  },
);
