import { test } from "node:test";
import { assertEquals, assertExists, assertRejects } from "./assert.ts";
import { CouchClient, type CouchDocument, CouchError } from "../src/couchdb/client.ts";
import { CouchDashboardService } from "../src/domain/service.ts";
import { QuotaManager } from "../src/domain/quota.ts";
import { documentBytes } from "../src/quota/bytes.ts";
import { ServiceError } from "../src/contracts.ts";
import { VERSIONING_DOCID } from "@vrtmrz/livesync-commonlib/compat/common/types";

const url = process.env.TEST_COUCHDB_URL;

class MeterFaultClient extends CouchClient {
  failMeter = false;
  override async put<T extends CouchDocument>(database: string, document: T): Promise<T> {
    if (this.failMeter && document.kind === "quota_meter") {
      this.failMeter = false;
      throw new CouchError(503);
    }
    return await super.put(database, document);
  }
}

test(
  "real CouchDB quotas aggregate vaults, gate concurrent growth and recover journalled writes",
  { skip: !url },
  async (t) => {
    const client = new CouchClient(
      url!,
      process.env.TEST_COUCHDB_USER!,
      process.env.TEST_COUCHDB_PASSWORD!,
    );
    const prefix = `test_quota_${crypto.randomUUID().replaceAll("-", "")}_`;
    const registry = `${prefix}panel`;
    const db1 = `${prefix}one`;
    const db2 = `${prefix}two`;
    const unassigned = `${prefix}outside`;
    const blockedDb = `${prefix}blocked`;
    const login = `${prefix}alice@example.test`;
    const user = `${prefix}alice`;
    let personId = "";
    try {
      await client.createDatabase("_users");
      const service = new CouchDashboardService(client, registry, "https://sync.example.test");
      await service.initialize();
      const person = await service.createPerson("admin@example.test", {
        couchUser: user,
        displayName: "Alice",
        tailscaleLogin: login,
        vaultSlug: db1,
        vaultLabel: "One",
        quotaBytes: 5000,
      });
      personId = person.id;
      await service.createVault("admin@example.test", person.id, { slug: db2, label: "Two" });
      await client.createDatabase(unassigned);
      await client.put(db1, { _id: "first", payload: "α".repeat(25) });
      await client.put(db2, { _id: "second", payload: "x".repeat(70) });
      await client.put(unassigned, { _id: "outside", payload: "elsewhere" });
      const initial = await service.quotaSummary();
      const baseline = initial.people.find((entry) => entry.personId === person.id)!.usedBytes;

      await t.test(
        "admission reconciles known unmanaged growth before spending instance capacity",
        async () => {
          const doc = { _id: "external-growth", payload: "outside the gateway" };
          const limit = service.quotas.settings.instanceLimitBytes;
          service.quotas.settings.instanceLimitBytes = initial.instance.usedBytes + 1;
          try {
            await client.put(unassigned, doc);
            await assertRejects(
              () =>
                service.quotas.withWrite(
                  db1,
                  [],
                  () => 1,
                  async () => {
                    throw new Error("must not forward");
                  },
                ),
              ServiceError,
              "quota_exceeded",
            );
            assertEquals(
              (await client.get<CouchDocument>(registry, "quota:ledger"))?.pending,
              undefined,
            );
          } finally {
            service.quotas.settings.instanceLimitBytes = limit;
            const stored = await client.get<CouchDocument>(unassigned, doc._id);
            if (stored)
              await client.request(`${unassigned}/${doc._id}?rev=${stored._rev}`, "DELETE");
            await service.quotaSummary();
          }
        },
      );

      await t.test(
        "the next admission after a minute discovers new backend databases",
        async (subtest) => {
          const database = `${prefix}periodic`;
          const doc = { _id: "new-outside", payload: "new unmanaged database" };
          try {
            await client.createDatabase(database);
            await client.put(database, doc);
            const advanced = Date.now() + 61_000;
            subtest.mock.method(Date, "now", () => advanced);
            await service.quotas.withWrite(
              db1,
              [],
              () => 0,
              async () => {},
            );
            const ledger = await client.get<CouchDocument>(registry, "quota:ledger");
            const meters = ledger?.databases as Record<
              string,
              { usedBytes: number; personId: string }
            >;
            assertEquals(meters[database].usedBytes, documentBytes(doc));
            assertEquals(meters[database].personId, "");
            subtest.mock.restoreAll();
            await client.request(database, "DELETE");
            await service.quotas.withWrite(
              db1,
              [],
              () => 0,
              async () => {},
            );
            const updated = await client.get<CouchDocument>(registry, "quota:ledger");
            assertEquals((updated?.databases as Record<string, unknown>)[database], undefined);
          } finally {
            subtest.mock.restoreAll();
            await client.request(database, "DELETE").catch(() => {});
            await service.quotaSummary();
          }
        },
      );

      await t.test("read-only quota queries do not create new ledger revisions", async () => {
        const before = await client.get<CouchDocument>(registry, "quota:ledger");
        await service.quotaSummary();
        assertEquals(
          (await client.get<CouchDocument>(registry, "quota:ledger"))?._rev,
          before?._rev,
        );
      });

      await t.test("rejected authorization leaves no pending write reservation", async () => {
        let forwarded = false;
        await assertRejects(
          () =>
            service.quotas.withWrite(
              db1,
              ["never-written"],
              () => 0,
              async () => {
                forwarded = true;
              },
              () => Promise.reject(new ServiceError("forbidden", 403)),
            ),
          ServiceError,
          "forbidden",
        );
        assertEquals(forwarded, false);
        assertEquals(
          (await client.get<CouchDocument>(registry, "quota:ledger"))?.pending,
          undefined,
        );
        await service.quotaSummary();
      });

      await t.test("usage includes every owned vault and unassigned instance data", () => {
        assertEquals(
          initial.people.find((entry) => entry.personId === person.id)!.limitBytes,
          5000,
        );
        assertEquals(
          initial.instance.usedBytes >=
            baseline + documentBytes({ _id: "outside", payload: "elsewhere" }),
          true,
        );
        assertEquals(
          (initial.instance.unassignedBytes ?? 0) >=
            documentBytes({ _id: "outside", payload: "elsewhere" }),
          true,
        );
      });

      await t.test(
        "admin can raise or lower quota below current usage without deleting data",
        async () => {
          await service.setPersonQuota("admin@example.test", personId, baseline - 1);
          const lowered = await service.quotaSummary();
          assertEquals(lowered.people.find((entry) => entry.personId === personId)!.exceeded, true);
          await service.setPersonQuota("admin@example.test", personId, baseline + 100);
          const updated = await service.getPerson(personId);
          assertEquals(updated.quotaBytes, baseline + 100);
        },
      );

      const quotas = service.quotas;
      const write = (database: string, doc: CouchDocument, manager = quotas) =>
        manager.withWrite(
          database,
          [doc._id],
          (leaves) =>
            documentBytes(doc) -
            (leaves
              .get(doc._id)
              ?.filter((leaf) => leaf.rev === doc._rev)
              .reduce((sum, leaf) => sum + leaf.bytes, 0) ?? 0),
          () => client.put(database, doc),
        );

      await t.test("parallel writes cannot both spend the same remaining user quota", async () => {
        const docA = { _id: "race-a", payload: "a".repeat(50) };
        const docB = { _id: "race-b", payload: "b".repeat(50) };
        assertEquals(documentBytes(docA) + documentBytes(docB) > 100, true);
        const results = await Promise.allSettled([write(db1, docA), write(db2, docB)]);
        assertEquals(results.filter((result) => result.status === "fulfilled").length, 1);
        const rejected = results.find(
          (result) => result.status === "rejected",
        ) as PromiseRejectedResult;
        assertEquals(rejected.reason instanceof ServiceError, true);
        assertEquals(rejected.reason.code, "quota_exceeded");
      });

      await t.test(
        "reads, shrinking updates and deletion remain available when over quota",
        async () => {
          await service.setPersonQuota("admin@example.test", personId, 0);
          const doc = await client.get<CouchDocument>(db1, "first");
          assertExists(doc);
          await write(db1, { _id: "first", _rev: doc._rev, payload: "" });
          const updated = await client.get<CouchDocument>(db1, "first");
          await write(db1, { _id: "first", _rev: updated!._rev, _deleted: true });
          await assertRejects(
            () => write(db1, { _id: "denied", payload: "x" }),
            ServiceError,
            "quota_exceeded",
          );
        },
      );

      await t.test(
        "vault creation cannot spend versioninfo bytes outside quota admission",
        async () => {
          await assertRejects(
            () =>
              service.createVault("admin@example.test", personId, {
                slug: blockedDb,
                label: "Blocked",
              }),
            ServiceError,
            "quota_exceeded",
          );
          assertEquals(await client.get(blockedDb, VERSIONING_DOCID), undefined);
          await service.setPersonQuota("admin@example.test", personId, null);
          const vault = await service.createVault("admin@example.test", personId, {
            slug: blockedDb,
            label: "Blocked",
          });
          assertEquals(vault.db, blockedDb);
          assertExists(await client.get(blockedDb, VERSIONING_DOCID));
        },
      );

      await t.test(
        "unlimited user still obeys instance capacity and private owner remainder",
        async () => {
          await service.setPersonQuota("admin@example.test", personId, null);
          const current = await quotas.summary();
          const bounded = new QuotaManager(client, registry, {
            instanceLimitBytes: current.instance.usedBytes + 40,
            defaultUserLimitBytes: null,
          });
          await bounded.initialize();
          assertEquals((await bounded.forPerson(personId)).remainingBytes, 40);
          await assertRejects(
            () => write(db1, { _id: "too-big", payload: "x".repeat(80) }, bounded),
            ServiceError,
            "quota_exceeded",
          );
        },
      );

      await t.test("all live conflicting revisions and attachment bytes count", async () => {
        const first = {
          _id: "conflicted",
          _rev: `1-${"a".repeat(32)}`,
          _revisions: { start: 1, ids: ["a".repeat(32)] },
          payload: "a".repeat(20),
        };
        const second = {
          _id: "conflicted",
          _rev: `1-${"b".repeat(32)}`,
          _revisions: { start: 1, ids: ["b".repeat(32)] },
          payload: "b".repeat(25),
        };
        const before = (await quotas.summary()).people.find(
          (entry) => entry.personId === personId,
        )!.usedBytes;
        await client.request(`${db1}/_bulk_docs`, "POST", {
          new_edits: false,
          docs: [first, second],
        });
        const attachment = await client.put(db2, {
          _id: "attachment",
          _attachments: {
            "file.bin": { content_type: "application/octet-stream", data: btoa("x".repeat(300)) },
          },
        });
        const storedAttachment = await client.get<CouchDocument>(db2, attachment._id);
        const after = (await quotas.summary()).people.find(
          (entry) => entry.personId === personId,
        )!.usedBytes;
        assertEquals(
          after - before,
          documentBytes(first) + documentBytes(second) + documentBytes(storedAttachment!),
        );
      });

      await t.test("known conflict releases reservation without spending quota", async () => {
        await assertRejects(
          () =>
            quotas.withWrite(
              db1,
              ["missing"],
              () => 1,
              () => Promise.reject(new CouchError(409)),
            ),
          CouchError,
        );
        await quotas.summary();
      });

      await t.test(
        "unknown commit outcome fails closed and restart reconciles actual stored bytes",
        async () => {
          const doc = { _id: "uncertain", payload: "committed before timeout" };
          await assertRejects(
            () =>
              quotas.withWrite(
                db1,
                [doc._id],
                () => documentBytes(doc),
                async () => {
                  await client.put(db1, doc);
                  throw new CouchError(503);
                },
              ),
            CouchError,
          );
          const pending = await client.get<CouchDocument>(registry, "quota:ledger");
          assertExists(pending?.pending);
          await assertRejects(
            () => write(db1, { _id: "blocked", payload: "blocked" }),
            ServiceError,
            "quota_reconciliation_required",
          );
          const restarted = new QuotaManager(client, registry, {
            instanceLimitBytes: null,
            defaultUserLimitBytes: null,
            recoverPending: true,
          });
          const withoutRecovery = new QuotaManager(client, registry, {
            instanceLimitBytes: null,
            defaultUserLimitBytes: null,
          });
          await assertRejects(
            () => withoutRecovery.initialize(),
            ServiceError,
            "quota_reconciliation_required",
          );
          await restarted.initialize();
          await write(db1, { _id: "after-restart", payload: "works" }, restarted);
          assertEquals(
            (await client.get<CouchDocument>(registry, "quota:ledger"))?.pending,
            undefined,
          );
        },
      );

      await t.test("CouchDB validation blocks direct non-admin write bypass", async () => {
        await service.setInitialPassword(login, "alice-password-long-enough");
        const ordinary = new CouchClient(url!, user, "alice-password-long-enough");
        await assertRejects(
          () => ordinary.put(db1, { _id: "bypass", payload: "blocked" }),
          CouchError,
        );
      });

      await t.test(
        "meter persistence failure keeps admission journal and recovers on restart",
        async () => {
          const faulty = new MeterFaultClient(
            url!,
            process.env.TEST_COUCHDB_USER!,
            process.env.TEST_COUCHDB_PASSWORD!,
          );
          const manager = new QuotaManager(faulty, registry, {
            instanceLimitBytes: null,
            defaultUserLimitBytes: null,
          });
          await manager.initialize();
          const doc = { _id: "meter-failure", payload: "stored despite registry failure" };
          await assertRejects(
            () =>
              manager.withWrite(
                db1,
                [doc._id],
                () => documentBytes(doc),
                async () => {
                  const result = await client.put(db1, doc);
                  faulty.failMeter = true;
                  return result;
                },
              ),
            CouchError,
          );
          assertExists((await client.get<CouchDocument>(registry, "quota:ledger"))?.pending);
          await assertRejects(
            () => manager.summary(),
            ServiceError,
            "quota_reconciliation_required",
          );
          const restarted = new QuotaManager(client, registry, {
            instanceLimitBytes: null,
            defaultUserLimitBytes: null,
            recoverPending: true,
          });
          await restarted.initialize();
          await restarted.summary();
          assertEquals(
            (await client.get<CouchDocument>(registry, "quota:ledger"))?.pending,
            undefined,
          );
        },
      );

      await t.test("missing meter record triggers full authoritative reconciliation", async () => {
        const before = (await service.quotaSummary()).people.find(
          (entry) => entry.personId === personId,
        )!.usedBytes;
        const records = await client.request<{ docs: CouchDocument[] }>(
          `${registry}/_find`,
          "POST",
          { selector: { kind: "quota_meter", database: db2, documentId: "attachment" }, limit: 1 },
        );
        const meter = records.docs[0];
        assertExists(meter);
        await client.request(
          `${registry}/${encodeURIComponent(meter._id)}?rev=${meter._rev}`,
          "DELETE",
        );
        const restarted = new QuotaManager(client, registry, {
          instanceLimitBytes: null,
          defaultUserLimitBytes: null,
        });
        await restarted.initialize();
        const after = (await restarted.summary()).people.find(
          (entry) => entry.personId === personId,
        )!.usedBytes;
        assertEquals(after, before);
      });

      await t.test("corrupt stored meter blocks initialization", async () => {
        const ledger = await client.get<CouchDocument>(registry, "quota:ledger");
        const corrupt = {
          ...ledger!,
          databases: {
            [db1]: { personId, sequence: 0, records: { bad: [{ rev: "1-a", bytes: -1 }] } },
          },
        };
        await client.put(registry, corrupt);
        const restarted = new QuotaManager(client, registry, {
          instanceLimitBytes: null,
          defaultUserLimitBytes: null,
        });
        await assertRejects(() => restarted.initialize(), ServiceError, "quota_state_invalid");
      });
    } finally {
      for (const database of [db1, db2, blockedDb, unassigned, registry]) {
        await client.request(database, "DELETE").catch(() => {});
      }
      const account = await client.get<CouchDocument>("_users", `org.couchdb.user:${user}`);
      if (account) {
        await client.request(
          `_users/${encodeURIComponent(account._id)}?rev=${account._rev}`,
          "DELETE",
        );
      }
    }
  },
);
