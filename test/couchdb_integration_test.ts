import { test } from "node:test";
import { assertEquals, assertExists, assertRejects } from "./assert.ts";
import {
  CouchClient,
  type CouchDocument,
  CouchError,
  type CouchUser,
} from "../src/couchdb/client.ts";
import { CouchDashboardService } from "../src/domain/service.ts";
import { DomainError, newRecoveryCode } from "../src/domain/security.ts";
import { initializeLiveSyncVersion } from "../src/couchdb/livesync.ts";
import { VER, VERSIONING_DOCID } from "@vrtmrz/livesync-commonlib/compat/common/types";

const url = process.env.TEST_COUCHDB_URL;
const username = process.env.TEST_COUCHDB_USER;
const password = process.env.TEST_COUCHDB_PASSWORD;

class FaultClient extends CouchClient {
  failPath: string | null = null;
  failMethod = "PUT";
  failAfter = false;
  failKind: string | null = null;
  dbsInfoCalls = 0;
  dbsInfoSizes: number[] = [];

  override async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    auth?: string,
  ): Promise<T> {
    if (path === "_dbs_info" && method === "POST") {
      this.dbsInfoCalls++;
      if (body && typeof body === "object" && "keys" in body && Array.isArray(body.keys)) {
        this.dbsInfoSizes.push(body.keys.length);
      }
    }
    const kind = body && typeof body === "object" && "kind" in body ? body.kind : undefined;
    if (
      (path === this.failPath || (this.failKind !== null && kind === this.failKind)) &&
      method === this.failMethod
    ) {
      this.failPath = null;
      this.failKind = null;
      if (this.failAfter) await super.request<T>(path, method, body, auth);
      throw new CouchError(503);
    }
    return super.request<T>(path, method, body, auth);
  }
}

test(
  "real CouchDB ownership, onboarding, ACL recovery and adopted accounts",
  { skip: !url },
  async (t) => {
    if (!url || !username || !password) throw new Error("TEST_COUCHDB credentials are required");
    const prefix = `test_lsd_${crypto.randomUUID().replaceAll("-", "")}_`;
    const registry = `${prefix}registry`;
    const firstDb = `${prefix}first`;
    const secondDb = `${prefix}second`;
    const adoptedDb = `${prefix}adopted`;
    const alice = `${prefix}alice`;
    const bob = `${prefix}bob`;
    const monitor = `${prefix}monitor`;
    const charlie = `${prefix}charlie`;
    const diana = `${prefix}diana`;
    const client = new FaultClient(url, username, password);
    const service = new CouchDashboardService(client, registry, "https://notes.example.test");
    const aliceLogin = `${prefix}alice@example.test`;
    const bobLogin = `${prefix}bob@example.test`;
    const initialPassword = "alice-initial-password-long";
    const changedPassword = "alice-changed-password-long";
    let personId = "";
    let vaultId = "";
    let originalRecovery = "";

    try {
      await client.createDatabase("_users");
      await service.initialize();
      await t.test("health checks CouchDB maintenance readiness", async () => {
        assertEquals((await service.health()).up, true);
        client.failPath = "_up";
        client.failMethod = "GET";
        assertEquals((await service.health()).up, false);
        client.failMethod = "PUT";
      });
      await t.test("foreign registry database is never claimed or modified", async () => {
        const foreign = `${prefix}foreign`;
        await client.createDatabase(foreign);
        const security = await client.security(foreign);
        await assertRejects(
          () =>
            new CouchDashboardService(client, foreign, "https://notes.example.test").initialize(),
          DomainError,
          "registry_database_not_owned",
        );
        assertEquals(await client.security(foreign), security);
        const foreignSchema = await client.put(foreign, {
          _id: "schema",
          kind: "note",
          schemaVersion: 1,
          payload: "unrelated data",
        });
        await assertRejects(
          () =>
            new CouchDashboardService(client, foreign, "https://notes.example.test").initialize(),
          DomainError,
          "registry_database_not_owned",
        );
        assertEquals(await client.security(foreign), security);
        assertEquals(await client.get(foreign, "schema"), foreignSchema);
      });
      await t.test("registry is admin-only and password is absent from registry", async () => {
        const security = await client.security(registry);
        assertEquals(security.members.roles, ["_admin"]);
        const person = await service.createPerson("admin@example.test", {
          couchUser: alice,
          displayName: "Alice",
          tailscaleLogin: aliceLogin,
          vaultLabel: "First vault",
          vaultSlug: firstDb,
        });
        personId = person.id;
        assertEquals(person.status, "pending_credentials");
        const vaults = await service.listVaults(personId);
        vaultId = vaults.items[0].id;
        originalRecovery = vaults.items[0].idRecoveryCode!;
        assertExists(originalRecovery);
        const version = await client.get<CouchDocument>(firstDb, VERSIONING_DOCID);
        assertEquals(version?.type, "versioninfo");
        assertEquals(version?.version, VER);
        const anonymous = new CouchClient(url, "", "");
        await assertRejects(() => anonymous.request(encodeURIComponent(registry)), CouchError);
        await assertRejects(() => anonymous.request(encodeURIComponent(firstDb)), CouchError);
        await assertRejects(
          () => service.getSetupMetadata(aliceLogin, vaultId),
          DomainError,
          "forbidden",
        );
      });

      await t.test("server admin username cannot become managed person", async () => {
        await assertRejects(
          () =>
            service.createPerson("admin@example.test", {
              couchUser: username,
              displayName: "Server admin",
              tailscaleLogin: `${prefix}admin@example.test`,
              vaultLabel: "Blocked",
              vaultSlug: `${prefix}blocked`,
            }),
          DomainError,
          "global_admin_access",
        );
      });

      await t.test("interrupted onboarding resumes without storing password", async () => {
        client.failPath = `${encodeURIComponent(firstDb)}/_security`;
        client.failAfter = true;
        await assertRejects(
          () => service.setInitialPassword(aliceLogin, initialPassword),
          CouchError,
        );
        const restarted = new CouchDashboardService(client, registry, "https://notes.example.test");
        await restarted.initialize();
        await restarted.setInitialPassword(aliceLogin, initialPassword);
        assertEquals((await restarted.getPerson(personId)).status, "active");
        assertEquals(
          (await restarted.getSetupMetadata(aliceLogin, vaultId)).idRecoveryCode,
          originalRecovery,
        );
        const all = await client.request<{ rows: Array<{ doc: unknown }> }>(
          `${encodeURIComponent(registry)}/_all_docs?include_docs=true`,
        );
        assertEquals(JSON.stringify(all).includes(initialPassword), false);
        const aliceClient = new CouchClient(url, alice, initialPassword);
        await aliceClient.request(encodeURIComponent(firstDb));
        await assertRejects(() => aliceClient.request(encodeURIComponent(registry)), CouchError);
      });

      await t.test("several vaults, isolation and durable setup identity", async () => {
        const second = await service.createVault("admin@example.test", personId, {
          label: "Second vault",
          slug: secondDb,
        });
        const retry = await service.createVault("admin@example.test", personId, {
          label: "Second vault",
          slug: secondDb,
        });
        assertEquals(retry.id, second.id);
        assertEquals((await service.listVaults(personId)).items.length, 2);
        const firstMetadata = await service.getSetupMetadata(aliceLogin, vaultId);
        const parallel = await Promise.all([
          service.getSetupMetadata(aliceLogin, vaultId),
          service.getSetupMetadata(aliceLogin, vaultId),
        ]);
        assertEquals(parallel[0].idRecoveryCode, parallel[1].idRecoveryCode);
        assertEquals(firstMetadata.instruction, "new");
        assertEquals(firstMetadata.encryptionSetup, "new");
        await service.recordUriIssued(aliceLogin, vaultId);
        assertEquals((await service.getSetupMetadata(aliceLogin, vaultId)).instruction, "new");
        assertEquals(
          (await service.getSetupMetadata(aliceLogin, vaultId)).encryptionSetup,
          "existing",
        );
        await assertRejects(
          () => service.getSetupMetadata(bobLogin, vaultId),
          DomainError,
          "forbidden",
        );
        const aliceClient = new CouchClient(url, alice, initialPassword);
        await assertRejects(
          () => aliceClient.put(firstDb, { _id: "bypass", text: "blocked" }),
          CouchError,
        );
        await client.put(firstDb, { _id: "note", text: "retained" });
        assertEquals(
          (await service.getSetupMetadata(aliceLogin, vaultId)).instruction,
          "additional",
        );
      });

      await t.test("disable last member denies reads while retaining documents", async () => {
        await service.setPersonEnabled("admin@example.test", personId, false);
        assertEquals((await service.getPerson(personId)).status, "disabled");
        assertEquals((await client.security(firstDb)).members, { names: [], roles: ["_admin"] });
        await assertRejects(
          () => new CouchClient(url, alice, initialPassword).request(encodeURIComponent(firstDb)),
          CouchError,
        );
        await assertRejects(
          () => service.getSetupMetadata(aliceLogin, vaultId),
          DomainError,
          "forbidden",
        );
        await service.setPersonEnabled("admin@example.test", personId, true);
        assertEquals(
          (await new CouchClient(url, alice, initialPassword).get<CouchDocument>(firstDb, "note"))
            ?.text,
          "retained",
        );
      });

      await t.test(
        "password changes verify existing credential and reset returns to onboarding",
        async () => {
          await assertRejects(
            () => service.changePassword(aliceLogin, "incorrect-password", changedPassword),
            DomainError,
            "invalid_credentials",
          );
          await service.changePassword(aliceLogin, initialPassword, changedPassword);
          await assertRejects(
            () => new CouchClient(url, alice, initialPassword).authenticate(alice, initialPassword),
            CouchError,
          );
          await service.resetPassword("admin@example.test", personId);
          assertEquals((await service.getPerson(personId)).status, "pending_credentials");
          await service.setInitialPassword(aliceLogin, initialPassword);
          assertEquals(
            (await service.getSetupMetadata(aliceLogin, vaultId)).idRecoveryCode,
            originalRecovery,
          );
        },
      );

      await t.test("external ACL changes stop writes without overwriting grants", async () => {
        const security = await client.security(firstDb);
        await client.setSecurity(firstDb, {
          ...security,
          members: { ...security.members, names: [...security.members.names, "external"] },
        });
        await assertRejects(
          () => service.setPersonEnabled("admin@example.test", personId, false),
          DomainError,
          "security_drift",
        );
        assertEquals((await service.getPerson(personId)).status, "active");
        assertEquals((await client.security(firstDb)).members.names.includes("external"), true);
        await client.setSecurity(firstDb, security);
      });

      await t.test("registration claims recover after registry document failure", async () => {
        const input = {
          couchUser: charlie,
          displayName: "Charlie",
          tailscaleLogin: `${prefix}charlie@example.test`,
          vaultLabel: "Recoverable",
          vaultSlug: `${prefix}charlie`,
        };
        client.failKind = "person";
        client.failAfter = false;
        await assertRejects(() => service.createPerson("admin@example.test", input), CouchError);
        const recovered = await service.createPerson("admin@example.test", input);
        assertEquals(recovered.status, "pending_credentials");
        assertEquals((await service.createPerson("admin@example.test", input)).id, recovered.id);
        await service.setPersonEnabled("admin@example.test", recovered.id, false);
        await service.setPersonEnabled("admin@example.test", recovered.id, true);
        assertEquals((await service.getPerson(recovered.id)).status, "pending_credentials");
      });

      await t.test(
        "additional vault claims resume after failure without duplicate identity",
        async () => {
          const input = { label: "Third vault", slug: `${prefix}third` };
          client.failKind = "vault";
          client.failAfter = false;
          await assertRejects(
            () => service.createVault("admin@example.test", personId, input),
            CouchError,
          );
          const recovered = await service.createVault("admin@example.test", personId, input);
          assertEquals(
            recovered.id,
            (await service.createVault("admin@example.test", personId, input)).id,
          );
        },
      );

      await t.test("interrupted revocation finishes on restart before owner access", async () => {
        client.failPath = `${encodeURIComponent(firstDb)}/_security`;
        client.failAfter = true;
        await assertRejects(
          () => service.setPersonEnabled("admin@example.test", personId, false),
          CouchError,
        );
        assertEquals((await service.getPerson(personId)).status, "provisioning");
        const restarted = new CouchDashboardService(client, registry, "https://notes.example.test");
        await restarted.initialize();
        assertEquals((await service.getPerson(personId)).status, "disabled");
        await restarted.setPersonEnabled("admin@example.test", personId, true);
      });

      await t.test(
        "adoption does not mutate accounts or ACL and preserves technical access",
        async () => {
          await client.put("_users", {
            _id: `org.couchdb.user:${bob}`,
            name: bob,
            type: "user",
            roles: [],
            password: "bob-existing-password-long",
          });
          await client.put("_users", {
            _id: `org.couchdb.user:${monitor}`,
            name: monitor,
            type: "user",
            roles: [],
            password: "monitor-existing-password-long",
          });
          await client.createDatabase(adoptedDb);
          await initializeLiveSyncVersion(client, adoptedDb);
          const adoptedSecurity = {
            admins: { names: [bob], roles: [] },
            members: { names: [bob, monitor], roles: ["_admin"] },
            custom: { retained: true },
          };
          await client.setSecurity(adoptedDb, adoptedSecurity);
          const before = await client.get<CouchUser>("_users", `org.couchdb.user:${bob}`);
          const input = {
            db: adoptedDb,
            couchUser: bob,
            displayName: "Bob",
            tailscaleLogin: bobLogin,
            label: "Existing",
          };
          const validation = await client.put<CouchDocument>(adoptedDb, {
            _id: "_design/readonly",
            validate_doc_update: "function () { throw({ forbidden: 'read only' }); }",
          });
          await assertRejects(
            () => service.adoptVault("admin@example.test", input),
            DomainError,
            "database_has_validation",
          );
          await client.request(
            `${adoptedDb}/_design/readonly?rev=${encodeURIComponent(validation._rev!)}`,
            "DELETE",
          );
          client.failKind = "vault";
          client.failAfter = false;
          await assertRejects(() => service.adoptVault("admin@example.test", input), CouchError);
          const adopted = await service.adoptVault("admin@example.test", input);
          assertEquals(adopted.idRecoveryCode, null);
          assertEquals(await client.get("_users", `org.couchdb.user:${bob}`), before);
          assertEquals(await client.security(adoptedDb), adoptedSecurity);
          await assertRejects(
            () => service.getSetupMetadata(bobLogin, adopted.id),
            DomainError,
            "missing_recovery_code",
          );
          await service.setPersonEnabled("admin@example.test", adopted.personId, false);
          await new CouchClient(url, monitor, "monitor-existing-password-long").request(
            encodeURIComponent(adoptedDb),
          );
          await assertRejects(
            () =>
              new CouchClient(url, bob, "bob-existing-password-long").request(
                encodeURIComponent(adoptedDb),
              ),
            CouchError,
          );
          await service.setPersonEnabled("admin@example.test", adopted.personId, true);
          assertEquals(await client.security(adoptedDb), adoptedSecurity);
          const recovery = newRecoveryCode();
          await assertRejects(
            () => service.registerRecoveryCode(aliceLogin, adopted.id, recovery, { asOwner: true }),
            DomainError,
            "forbidden",
          );
          await service.registerRecoveryCode(bobLogin, adopted.id, recovery, { asOwner: true });
          await service.registerRecoveryCode(bobLogin, adopted.id, recovery, { asOwner: true });
          await assertRejects(
            () => service.registerRecoveryCode("admin@example.test", adopted.id, newRecoveryCode()),
            DomainError,
            "recovery_identity_conflict",
          );
          const withIdentity = await service.adoptVault("admin@example.test", {
            ...input,
            idRecoveryCode: recovery,
          });
          assertEquals(withIdentity.id, adopted.id);
          assertEquals(
            (await service.getSetupMetadata(bobLogin, adopted.id)).idRecoveryCode,
            recovery,
          );
          assertEquals(
            (await service.getSetupMetadata(bobLogin, adopted.id)).instruction,
            "additional",
          );
        },
      );

      await t.test("adopted role access cannot claim successful revocation", async () => {
        const bobUser = (await client.get<CouchUser>("_users", `org.couchdb.user:${bob}`))!;
        bobUser.roles = ["readers"];
        await client.put("_users", bobUser);
        const security = await client.security(adoptedDb);
        await client.setSecurity(adoptedDb, {
          ...security,
          members: { ...security.members, roles: ["_admin", "readers"] },
        });
        // Update the fixture registry snapshot to represent legitimate initial adoption with this role.
        const docs = await client.request<{ docs: CouchDocument[] }>(
          `${encodeURIComponent(registry)}/_find`,
          "POST",
          { selector: { kind: "vault", "value.db": adoptedDb } },
        );
        const registryVault = docs.docs[0];
        registryVault.security = await client.security(adoptedDb);
        await client.put(registry, registryVault);
        const bobPerson = (await service.findPersonByLogin(bobLogin))!;
        await assertRejects(
          () => service.setPersonEnabled("admin@example.test", bobPerson.id, false),
          DomainError,
          "role_access_cannot_be_revoked",
        );
        assertEquals((await service.getPerson(bobPerson.id)).status, "active");
      });

      await t.test(
        "adopted open database cannot be disabled or reset without changing implicit access",
        async () => {
          const user = (await client.get<CouchUser>("_users", `org.couchdb.user:${bob}`))!;
          user.roles = [];
          await client.put("_users", user);
          const db = `${prefix}open`;
          await client.createDatabase(db);
          await initializeLiveSyncVersion(client, db);
          const open = { admins: { names: [], roles: [] }, members: { names: [], roles: [] } };
          await client.setSecurity(db, open);
          const adopted = await service.adoptVault("admin@example.test", {
            db,
            couchUser: bob,
            displayName: "Bob",
            tailscaleLogin: bobLogin,
            label: "Open existing",
          });
          const beforePerson = await service.getPerson(adopted.personId);
          const beforeUser = await client.get<CouchUser>("_users", `org.couchdb.user:${bob}`);
          await new CouchClient(url, monitor, "monitor-existing-password-long").request(
            encodeURIComponent(db),
          );
          await assertRejects(
            () => service.setPersonEnabled("admin@example.test", adopted.personId, false),
            DomainError,
            "unrestricted_access_cannot_be_revoked",
          );
          await assertRejects(
            () => service.resetPassword("admin@example.test", adopted.personId),
            DomainError,
            "unrestricted_access_cannot_be_revoked",
          );
          assertEquals(await client.security(db), open);
          assertEquals(await service.getPerson(adopted.personId), beforePerson);
          assertEquals(
            await client.get<CouchUser>("_users", `org.couchdb.user:${bob}`),
            beforeUser,
          );
          await new CouchClient(url, monitor, "monitor-existing-password-long").request(
            encodeURIComponent(db),
          );
        },
      );

      await t.test(
        "explicit ownership reconciliation recovers marker crash and refuses unsafe confirmation",
        async () => {
          const db = `${prefix}reconcile`;
          const login = `${prefix}diana@example.test`;
          const input = {
            couchUser: diana,
            displayName: "Diana",
            tailscaleLogin: login,
            vaultLabel: "Interrupted creation",
            vaultSlug: db,
          };
          client.failPath = `${encodeURIComponent(db)}/${encodeURIComponent(
            "_local/dashboard-owner",
          )}`;
          client.failAfter = false;
          await assertRejects(() => service.createPerson("admin@example.test", input), CouchError);
          const person = (await service.findPersonByLogin(login))!;
          assertEquals(person.status, "provisioning");
          const vault = (await service.listVaults(person.id)).items[0];
          assertEquals(vault.provisioning, true);
          const restarted = new CouchDashboardService(
            client,
            registry,
            "https://notes.example.test",
          );
          await restarted.initialize();
          await assertRejects(
            () => restarted.createPerson("admin@example.test", input),
            DomainError,
            "resource_ownership_unknown",
          );
          await assertRejects(
            () => restarted.reconcileVaultOwnership("admin@example.test", vault.id, `${db} `),
            DomainError,
            "confirmation_mismatch",
          );
          assertEquals(await client.get(db, "_local/dashboard-owner"), undefined);
          const note = await client.put<CouchDocument>(db, {
            _id: "existing-note",
            text: "Preserve",
          });
          await assertRejects(
            () => restarted.reconcileVaultOwnership("admin@example.test", vault.id, db),
            DomainError,
            "remote_contains_data",
          );
          assertEquals((await client.get<CouchDocument>(db, "existing-note"))?.text, "Preserve");
          assertEquals(await client.get(db, "_local/dashboard-owner"), undefined);
          await client.request(
            `${encodeURIComponent(db)}/existing-note?rev=${encodeURIComponent(note._rev!)}`,
            "DELETE",
          );
          const security = await client.security(db);
          await client.setSecurity(db, {
            ...security,
            members: { names: [monitor], roles: ["_admin"] },
          });
          await assertRejects(
            () => restarted.reconcileVaultOwnership("admin@example.test", vault.id, db),
            DomainError,
            "security_drift",
          );
          await client.setSecurity(db, security);
          client.failPath = `${encodeURIComponent(db)}/${encodeURIComponent(VERSIONING_DOCID)}`;
          client.failAfter = true;
          await assertRejects(
            () => restarted.reconcileVaultOwnership("admin@example.test", vault.id, db),
            CouchError,
          );
          assertEquals((await restarted.getPerson(person.id)).status, "provisioning");
          assertExists(await client.get(db, "_local/dashboard-owner"));
          const recovered = new CouchDashboardService(
            client,
            registry,
            "https://notes.example.test",
            {
              instanceLimitBytes: null,
              defaultUserLimitBytes: null,
              recoverPending: true,
            },
          );
          await recovered.initialize();
          await recovered.reconcileVaultOwnership("admin@example.test", vault.id, db);
          assertEquals((await recovered.getPerson(person.id)).status, "pending_credentials");
          assertEquals((await recovered.listVaults(person.id)).items[0].provisioning, false);
          await recovered.setInitialPassword(login, "diana-onboarding-password-long");
          assertEquals((await recovered.getSetupMetadata(login, vault.id)).instruction, "new");
          await new CouchClient(url, diana, "diana-onboarding-password-long").request(
            encodeURIComponent(db),
          );
        },
      );

      await t.test("additional vault reconciliation preserves active owner state", async () => {
        const db = `${prefix}reconcile_additional`;
        const input = { label: "Interrupted extra vault", slug: db };
        client.failPath = `${encodeURIComponent(db)}/${encodeURIComponent(
          "_local/dashboard-owner",
        )}`;
        client.failAfter = false;
        await assertRejects(
          () => service.createVault("admin@example.test", personId, input),
          CouchError,
        );
        const vault = (await service.listVaults(personId)).items.find((item) => item.db === db)!;
        assertEquals(vault.provisioning, true);
        await service.reconcileVaultOwnership("admin@example.test", vault.id, db);
        assertEquals((await service.getPerson(personId)).status, "active");
        await new CouchClient(url, alice, initialPassword).request(encodeURIComponent(db));
      });

      await t.test("manual backup requests are audited by request ID", async () => {
        const requestId = crypto.randomUUID();
        await service.recordBackupRequested("admin@example.test", requestId);
        const events = await service.listEvents({ limit: 100 });
        assertEquals(
          events.items.some(
            (event) => event.action === "backup.requested" && event.target === requestId,
          ),
          true,
        );
        await assertRejects(
          () => service.recordBackupRequested("admin@example.test", "invalid"),
          DomainError,
          "invalid_request_id",
        );
      });

      await t.test("audit contains outcomes but no secrets", async () => {
        const events = await service.listEvents({ limit: 100 });
        assertEquals(
          events.items.some((event) => event.result === "failure"),
          true,
        );
        assertEquals(
          events.items.some((event) => event.action === "setup.generated"),
          true,
        );
        assertEquals(JSON.stringify(events).includes(initialPassword), false);
        assertEquals(JSON.stringify(events).includes(originalRecovery), false);
        assertEquals(newRecoveryCode().length, 74);
      });
      await t.test(
        "stats batch requests are cached and missing remotes do not hide healthy vaults",
        async () => {
          const calls = client.dbsInfoCalls;
          const first = await service.stats();
          assertEquals(client.dbsInfoCalls - calls, 1);
          assertEquals(first.find((item) => item.db === firstDb)?.docCount, 3);
          const cached = await Promise.all([service.stats(), service.stats()]);
          assertEquals(cached[0], first);
          assertEquals(cached[1], first);
          assertEquals(client.dbsInfoCalls - calls, 1);
          const missing = await service.createVault("admin@example.test", personId, {
            label: "Missing remote",
            slug: `${prefix}missing`,
          });
          await client.request(encodeURIComponent(missing.db), "DELETE");
          const result = await service.stats();
          assertEquals(client.dbsInfoCalls - calls, 2);
          assertEquals(
            result.some((item) => item.db === missing.db),
            false,
          );
          assertEquals(
            result.some((item) => item.db === firstDb),
            true,
          );
          assertEquals(
            client.dbsInfoSizes.every((count) => count <= 100),
            true,
          );
        },
      );
    } finally {
      const databases = await client.request<string[]>("_all_dbs");
      for (const database of databases.filter((name) => name.startsWith(prefix))) {
        await client.request(encodeURIComponent(database), "DELETE");
      }
      for (const name of [alice, bob, monitor, charlie, diana]) {
        assertEquals(name.startsWith(prefix), true, "Unsafe fixture cleanup");
        const user = await client.get<CouchDocument>("_users", `org.couchdb.user:${name}`);
        if (user?._rev) {
          await client.request(
            `_users/${encodeURIComponent(user._id)}?rev=${encodeURIComponent(user._rev)}`,
            "DELETE",
          );
        }
      }
    }
  },
);
