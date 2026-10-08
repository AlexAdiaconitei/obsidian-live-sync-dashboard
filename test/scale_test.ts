import { test } from "node:test";
import { assertEquals } from "./assert.ts";
import { CouchClient } from "../src/couchdb/client.ts";
import { CouchDashboardService } from "../src/domain/service.ts";
import { documentBytes } from "../src/quota/bytes.ts";

class CountingClient extends CouchClient {
  requests: string[] = [];
  override async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    auth?: string,
  ): Promise<T> {
    this.requests.push(`${method} ${path}`);
    return super.request<T>(path, method, body, auth);
  }
}

const url = process.env.TEST_COUCHDB_URL;

test(
  "control-plane target supports 20 people and 100 vaults with pagination and bulk stats",
  { skip: !url },
  async () => {
    if (!url) throw new Error("Missing disposable CouchDB URL");
    const client = new CountingClient(
      url,
      process.env.TEST_COUCHDB_USER!,
      process.env.TEST_COUCHDB_PASSWORD!,
    );
    const prefix = `test_scale_${crypto.randomUUID().replaceAll("-", "")}_`;
    const registry = `${prefix}registry`;
    const databases: string[] = [registry];
    const users: string[] = [];
    const service = new CouchDashboardService(client, registry, "https://notes.example.test");
    const started = performance.now();
    let singleVaultRequests = 0;
    async function measureWrite(id: string): Promise<number> {
      const database = databases[1];
      await service.quotas.withWrite(
        database,
        [],
        () => 0,
        async () => {},
      );
      client.requests = [];
      const doc = { _id: id, payload: "request-count sample" };
      await service.quotas.withWrite(
        database,
        [id],
        () => documentBytes(doc),
        () => client.put(database, doc),
      );
      assertEquals(
        client.requests.some(
          (path) =>
            path.includes("_all_dbs") || path.includes("/_find") || path.includes("_design/"),
        ),
        false,
      );
      return client.requests.length;
    }
    try {
      await service.initialize();
      for (let personIndex = 0; personIndex < 20; personIndex++) {
        const couchUser = `${prefix}user${personIndex}`;
        const firstDb = `${prefix}p${personIndex}v0`;
        users.push(couchUser);
        databases.push(firstDb);
        const person = await service.createPerson("admin@example.test", {
          couchUser,
          tailscaleLogin: `${couchUser}@example.test`,
          displayName: `Person ${personIndex}`,
          vaultLabel: "Vault 0",
          vaultSlug: firstDb,
        });
        if (personIndex === 0) singleVaultRequests = await measureWrite("sample-one");
        for (let vaultIndex = 1; vaultIndex < 5; vaultIndex++) {
          const db = `${prefix}p${personIndex}v${vaultIndex}`;
          databases.push(db);
          await service.createVault("admin@example.test", person.id, {
            label: `Vault ${vaultIndex}`,
            slug: db,
          });
        }
        assertEquals((await service.listVaults(person.id)).items.length, 5);
      }
      let bookmark: string | undefined;
      const people = new Set<string>();
      do {
        const page = await service.listPeople({ limit: 7, bookmark });
        for (const person of page.items) people.add(person.id);
        bookmark = page.bookmark;
      } while (bookmark);
      assertEquals(people.size, 20);
      const [stats, concurrent] = await Promise.all([service.stats(), service.stats()]);
      assertEquals(stats.length, 100);
      assertEquals(concurrent, stats);
      assertEquals(new Set(stats.map((vault) => vault.db)).size, 100);
      const hundredVaultRequests = await measureWrite("sample-hundred");
      assertEquals(hundredVaultRequests, singleVaultRequests);
      assertEquals(hundredVaultRequests <= 10, true);
      console.log(
        `Quota write requests: ${singleVaultRequests} with 1 vault, ${hundredVaultRequests} with 100 vaults.`,
      );
      assertEquals(
        stats.every((vault) => vault.docCount >= 1),
        true,
      );
      console.log(
        `Control-plane fixture: 20 people, 100 vaults in ${Math.round(
          performance.now() - started,
        )} ms.`,
      );
    } finally {
      for (const database of databases) {
        await client.request(encodeURIComponent(database), "DELETE").catch(() => {});
      }
      for (const user of users) {
        const doc = await client.get<{ _id: string; _rev?: string }>(
          "_users",
          `org.couchdb.user:${user}`,
        );
        if (doc?._rev) {
          await client.request(
            `_users/${encodeURIComponent(doc._id)}?rev=${encodeURIComponent(doc._rev)}`,
            "DELETE",
          );
        }
      }
    }
  },
);
