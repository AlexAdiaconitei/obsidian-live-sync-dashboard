import { test } from "node:test";
import assert from "node:assert/strict";
import { CouchClient, restrictedSecurity } from "../src/couchdb/client.ts";
import { CouchDashboardService } from "../src/domain/service.ts";

class AdoptionClient extends CouchClient {
  writes = 0;
  constructor(
    private readonly roles: string[] = [],
    private readonly admins: string[] = [],
  ) {
    super("http://127.0.0.1:1", "admin", "unused");
  }
  override globalAdminNames() {
    return Promise.resolve(this.admins);
  }
  override async request<T>(_path: string, method = "GET", body?: unknown): Promise<T> {
    if (
      method === "PUT" &&
      body &&
      typeof body === "object" &&
      "kind" in body &&
      body.kind === "event"
    ) {
      return { rev: "1-test" } as T;
    }
    if (method !== "GET") {
      this.writes++;
      throw new Error("unexpected_write");
    }
    return {} as T;
  }
  override async get<T>(database: string): Promise<T | undefined> {
    return database === "_users" ? ({ name: "alice", roles: this.roles } as T) : undefined;
  }
  override security() {
    return Promise.resolve({
      ...restrictedSecurity(),
      members: { names: ["alice"], roles: ["_admin"] },
    });
  }
}

test("adoption refuses global administrators before writing registry or vault data", async () => {
  for (const client of [new AdoptionClient([], ["alice"]), new AdoptionClient(["_admin"])]) {
    const service = new CouchDashboardService(client, "panel", "https://sync.example.test");
    await assert.rejects(
      () =>
        service.adoptVault("admin@example.test", {
          db: "vault",
          couchUser: "alice",
          tailscaleLogin: "alice@example.test",
          displayName: "Alice",
          label: "Existing",
        }),
      { message: "global_admin_access" },
    );
    assert.equal(client.writes, 0);
  }
});

test("registration refuses identities the HTTP authentication layer cannot accept", async () => {
  const client = new AdoptionClient();
  const service = new CouchDashboardService(client, "panel", "https://sync.example.test");
  for (const tailscaleLogin of [
    "alice,bob@example.test",
    "alice\u007f@example.test",
    "alice\u0080@example.test",
  ]) {
    await assert.rejects(
      () =>
        service.createPerson("admin@example.test", {
          couchUser: "alice",
          tailscaleLogin,
          displayName: "Alice",
          vaultLabel: "Notes",
          vaultSlug: "vault",
        }),
      { message: "invalid_login" },
    );
  }
  assert.equal(client.writes, 0);
});

test("recovery registration rejects malformed codes before reading or writing the registry", async () => {
  const client = new AdoptionClient();
  const service = new CouchDashboardService(client, "panel", "https://sync.example.test");
  for (const code of [
    "",
    "sls-id-v1:abc",
    `sls-id-v2:${"a".repeat(64)}`,
    `sls-id-v1:${"A".repeat(64)}`,
  ]) {
    await assert.rejects(() => service.registerRecoveryCode("admin@example.test", "vault", code), {
      message: "invalid_recovery_code",
    });
  }
  assert.equal(client.writes, 0);
});

test("owner login neither waits for registry mutations nor skips CouchDB for unknown names", async () => {
  let release!: () => void;
  const stalled = new Promise<undefined>((resolve) => (release = () => resolve(undefined)));
  const sessions: string[] = [];
  const client = new (class extends CouchClient {
    constructor() {
      super("http://127.0.0.1:1", "admin", "unused");
    }
    override get<T>(_database: string, id: string): Promise<T | undefined> {
      return id.startsWith("vault:")
        ? (stalled as Promise<T | undefined>)
        : Promise.resolve(undefined);
    }
    override async authenticate(username: string): Promise<string[]> {
      sessions.push(username);
      throw new Error("invalid_credentials");
    }
  })();
  const service = new CouchDashboardService(client, "panel", "https://sync.example.test");
  const mutation = service
    .registerRecoveryCode("admin@example.test", "vault-1", `sls-id-v1:${"a".repeat(64)}`)
    .catch(() => undefined);
  await assert.rejects(() => service.loginOwner("nobody", "a-long-password"), {
    message: "invalid_credentials",
  });
  assert.equal(sessions.length, 1);
  release();
  await mutation;
});
