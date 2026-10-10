import { testServer } from "./server.ts";
import { test } from "node:test";
import { assert, assertEquals, assertExists, assertStringIncludes } from "./assert.ts";
import { CouchClient, type CouchDocument } from "../src/couchdb/client.ts";
import { CouchDashboardService } from "../src/domain/service.ts";
import { QuotaGateway } from "../src/quota/gateway.ts";
import { documentBytes } from "../src/quota/bytes.ts";
import { assertDisposableFixture } from "./fixture.ts";
import { createApps } from "../src/web/apps.ts";
import { loadConfig } from "../src/config.ts";
import { ownerCookie } from "./owner-login.ts";

const url = process.env.TEST_COUCHDB_URL;
const username = process.env.TEST_COUCHDB_USER;
const password = process.env.TEST_COUCHDB_PASSWORD;

function authorization(user: string, secret: string): string {
  return `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${secret}`)))}`;
}

test(
  "real CouchDB quota gateway enforces authenticated replication and attachment writes",
  { skip: !url },
  async (t) => {
    assertDisposableFixture(url!, username, password);
    assertExists(username);
    assertExists(password);
    const client = new CouchClient(url!, username, password);
    const prefix = `test_gateway_${crypto.randomUUID().replaceAll("-", "")}_`;
    const registry = `${prefix}panel`;
    const db = `${prefix}one`;
    const second = `${prefix}two`;
    const other = `${prefix}other`;
    const user = `${prefix}alice`;
    const outsider = `${prefix}bob`;
    const login = `${prefix}alice@example.test`;
    const secret = "gateway-password-long-enough";
    const settings = { instanceLimitBytes: null as number | null, defaultUserLimitBytes: null };
    const service = new CouchDashboardService(
      client,
      registry,
      "https://sync.example.test",
      settings,
    );
    const gateway = new QuotaGateway(client, service.quotas, url!, username, password);
    let personId = "";

    async function request(
      path: string,
      method = "GET",
      body?: unknown,
      extra: HeadersInit = {},
      auth = authorization(user, secret),
    ) {
      const headers = new Headers(extra);
      if (auth) headers.set("authorization", auth);
      const raw = body instanceof Uint8Array || typeof body === "string";
      if (body !== undefined && !headers.has("content-type")) {
        headers.set("content-type", raw ? "application/octet-stream" : "application/json");
      }
      const response = await gateway.fetch(
        new Request(`https://sync.example.test/${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
        }),
      );
      const text = await response.text();
      let result: Record<string, unknown> = {};
      try {
        result = JSON.parse(text);
      } catch {
        // Attachment responses intentionally have a binary body.
      }
      return { status: response.status, body: result, text, headers: response.headers };
    }

    async function used(): Promise<number> {
      return (await service.personQuota(login)).usedBytes;
    }

    async function unlimited(): Promise<void> {
      settings.instanceLimitBytes = null;
      await service.setPersonQuota("admin@example.test", personId, null);
    }

    try {
      await service.initialize();
      const alice = await service.createPerson("admin@example.test", {
        couchUser: user,
        displayName: "Alice",
        tailscaleLogin: login,
        vaultLabel: "One",
        vaultSlug: db,
      });
      personId = alice.id;
      await service.createVault("admin@example.test", personId, { label: "Two", slug: second });
      await service.setInitialPassword(login, secret);
      await service.createPerson("admin@example.test", {
        couchUser: outsider,
        displayName: "Bob",
        tailscaleLogin: `${prefix}bob@example.test`,
        vaultLabel: "Other",
        vaultSlug: other,
      });
      await service.setInitialPassword(`${prefix}bob@example.test`, secret);

      await t.test(
        "invalid credentials and foreign vault permissions cannot become admin writes",
        async () => {
          assertEquals(
            (await request(`${db}/unauthenticated`, "PUT", { text: "blocked" }, {}, "")).status,
            401,
          );
          assertEquals(
            (
              await request(
                `${db}/bad-password`,
                "PUT",
                { text: "blocked" },
                {},
                authorization(user, "wrong"),
              )
            ).status,
            401,
          );
          const foreign = await request(`${other}/foreign`, "PUT", { text: "blocked" });
          assert([401, 403].includes(foreign.status));
          assertEquals(await client.get(other, "foreign"), undefined);
          const spoofed = await request(
            `${other}/spoofed`,
            "PUT",
            { text: "blocked" },
            {
              "x-auth-couchdb-user": outsider,
              "x-auth-couchdb-roles": "_admin",
              "tailscale-user-login": `${prefix}bob@example.test`,
            },
          );
          assert([401, 403].includes(spoofed.status));
        },
      );

      await t.test(
        "session cookies authenticate writes and readonly replication endpoints remain available",
        async () => {
          const session = await request(
            "_session",
            "POST",
            { name: user, password: secret },
            {},
            "",
          );
          assertEquals(session.status, 200);
          const cookie = session.headers.get("set-cookie")?.split(";")[0];
          assertExists(cookie);
          assertEquals(
            (await request(`${db}/cookie-auth`, "PUT", { payload: "ok" }, { cookie }, "")).status,
            201,
          );
          assertEquals((await request(db, "HEAD")).status, 200);
          assertEquals((await request(`${db}/_changes`, "POST", { since: 0 })).status, 200);
          assertEquals(
            (await request(`${db}/_revs_diff`, "POST", { missing: ["1-abc"] })).status,
            200,
          );
          assertEquals(
            (await request(`${db}/_bulk_get`, "POST", { docs: [{ id: "cookie-auth" }] })).status,
            200,
          );
          assertEquals(
            (await request(`${db}/_all_docs`, "POST", { keys: ["cookie-auth"] })).status,
            200,
          );
        },
      );

      await t.test("a slow request body does not hold back other writers", async () => {
        let release!: () => void;
        const stalled = gateway.fetch(
          new Request(`https://sync.example.test/${second}/slow-upload`, {
            method: "PUT",
            headers: {
              authorization: authorization(user, secret),
              "content-type": "application/json",
            },
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"text":'));
                release = () => {
                  controller.enqueue(new TextEncoder().encode('"late"}'));
                  controller.close();
                };
              },
            }),
            ...{ duplex: "half" as const },
          }),
        );
        try {
          // Let the stalled request authenticate and start reading its body first.
          await new Promise((resolve) => setTimeout(resolve, 500));
          assertEquals((await request(`${db}/while-stalled`, "PUT", { text: "ok" })).status, 201);
        } finally {
          release();
        }
        assertEquals((await stalled).status, 201);
      });

      await t.test(
        "user quota aggregates vaults, serializes concurrency and accepts an admin increase",
        async () => {
          const baseline = await used();
          const a = { _id: "race-a", payload: "a".repeat(60) };
          const b = { _id: "race-b", payload: "b".repeat(60) };
          await service.setPersonQuota("admin@example.test", personId, baseline + documentBytes(a));
          const results = await Promise.all([
            request(`${db}/race-a`, "PUT", a),
            request(`${second}/race-b`, "PUT", b),
          ]);
          assertEquals(results.map((result) => result.status).sort(), [201, 413]);
          assertEquals(
            results.find((result) => result.status === 413)?.body.reason,
            "quota_exceeded",
          );
          const deniedIndex = results.findIndex((result) => result.status === 413);
          await service.setPersonQuota(
            "admin@example.test",
            personId,
            baseline + documentBytes(a) + documentBytes(b),
          );
          assertEquals(
            (
              await request(
                `${deniedIndex ? second : db}/${deniedIndex ? "race-b" : "race-a"}`,
                "PUT",
                deniedIndex ? b : a,
              )
            ).status,
            201,
          );
          assertEquals(await used(), baseline + documentBytes(a) + documentBytes(b));
        },
      );

      await t.test(
        "reads, shrinking updates and deletion work after quota is lowered below usage",
        async () => {
          await unlimited();
          assertEquals(
            (await request(`${db}/shrink`, "PUT", { payload: "x".repeat(150) })).status,
            201,
          );
          await service.setPersonQuota("admin@example.test", personId, 0);
          const current = await request(`${db}/shrink`);
          assertEquals(current.status, 200);
          const shrink = await request(`${db}/shrink`, "PUT", {
            _rev: current.body._rev,
            payload: "",
          });
          assertEquals(shrink.status, 201);
          assertEquals(
            (await request(`${db}/shrink?rev=${shrink.body.rev}`, "DELETE")).status,
            200,
          );
          assertEquals((await request(`${db}/denied-growth`, "PUT", { payload: "x" })).status, 413);
          assertEquals(
            (
              await request(`${db}/deleted-payload`, "PUT", {
                _deleted: true,
                payload: "x".repeat(200),
              })
            ).status,
            413,
          );
        },
      );

      await t.test(
        "instance quota constrains an unlimited user independently of the user setting",
        async () => {
          await unlimited();
          const summary = await service.quotaSummary();
          settings.instanceLimitBytes = summary.instance.usedBytes + 20;
          const rejected = await request(`${db}/global-denied`, "PUT", { payload: "x".repeat(50) });
          assertEquals(rejected.status, 413);
          assertEquals(rejected.body.reason, "quota_exceeded");
          assertEquals((await service.personQuota(login)).remainingBytes, 20);
          settings.instanceLimitBytes = null;
          assertEquals(
            (await request(`${db}/global-denied`, "PUT", { payload: "x".repeat(50) })).status,
            201,
          );
        },
      );

      await t.test(
        "replication counts conflicting leaves and duplicate revisions spend no quota",
        async () => {
          await unlimited();
          const a = {
            _id: "conflict",
            _rev: "1-aaaaaaaa",
            _revisions: { start: 1, ids: ["aaaaaaaa"] },
            payload: "a".repeat(40),
          };
          const b = {
            _id: "conflict",
            _rev: "1-bbbbbbbb",
            _revisions: { start: 1, ids: ["bbbbbbbb"] },
            payload: "b".repeat(50),
          };
          const before = await used();
          assertEquals(
            (await request(`${db}/_bulk_docs`, "POST", { new_edits: false, docs: [a, b] })).status,
            201,
          );
          assertEquals(await used(), before + documentBytes(a) + documentBytes(b));
          await service.setPersonQuota("admin@example.test", personId, await used());
          assertEquals(
            (await request(`${db}/_bulk_docs`, "POST", { new_edits: false, docs: [a] })).status,
            201,
          );
          assertEquals(await used(), before + documentBytes(a) + documentBytes(b));
          assertEquals(
            (
              await request(`${db}/_bulk_docs`, "POST", {
                new_edits: false,
                docs: [{ ...a, _rev: "1-cccccccc", _revisions: { start: 1, ids: ["cccccccc"] } }],
              })
            ).status,
            413,
          );
          assertEquals(
            (await request(`${db}/_bulk_docs`, "POST", { new_edits: false, docs: [a, a] })).status,
            201,
          );
          assertEquals(await used(), before + documentBytes(a) + documentBytes(b));
        },
      );

      await t.test("asynchronous batch writes cannot release admission before commit", async () => {
        await unlimited();
        const result = await request(`${db}/deferred?batch=ok`, "PUT", { payload: "blocked" });
        assertEquals(result.status, 400);
        assertEquals(result.body.reason, "asynchronous_write_not_supported");
        assertEquals(await client.get(db, "deferred"), undefined);
      });

      await t.test("partial bulk failures only charge documents actually stored", async () => {
        await unlimited();
        const existing = { _id: "partial-existing", payload: "keep" };
        const fresh = { _id: "partial-fresh", payload: "new" };
        assertEquals((await request(`${db}/partial-existing`, "PUT", existing)).status, 201);
        const before = await used();
        const bulk = await request(`${db}/_bulk_docs`, "POST", {
          docs: [{ ...existing, payload: "must conflict" }, fresh],
        });
        assertEquals(bulk.status, 201);
        const results = JSON.parse(bulk.text) as Array<{ error?: string; ok?: boolean }>;
        assertEquals(results[0].error, "conflict");
        assertEquals(results[1].ok, true);
        assertEquals(await used(), before + documentBytes(fresh));
      });

      await t.test(
        "PUT replication query preserves supplied revisions and remains idempotent",
        async () => {
          await unlimited();
          const replicated = {
            _id: "put-replicated",
            _rev: "1-dddddddd",
            _revisions: { start: 1, ids: ["dddddddd"] },
            payload: "replicated",
          };
          const before = await used();
          assertEquals(
            (await request(`${db}/put-replicated?new_edits=false`, "PUT", replicated)).status,
            201,
          );
          assertEquals(
            (await client.get<CouchDocument>(db, "put-replicated"))?._rev,
            replicated._rev,
          );
          assertEquals(await used(), before + documentBytes(replicated));
          await service.setPersonQuota("admin@example.test", personId, await used());
          assertEquals(
            (await request(`${db}/put-replicated?new_edits=false`, "PUT", replicated)).status,
            201,
          );
          assertEquals(await used(), before + documentBytes(replicated));
          assertEquals(
            (await request(`${db}/invalid-query?new_edits=invalid`, "PUT", { payload: "invalid" }))
              .status,
            400,
          );
        },
      );

      await t.test(
        "inline and raw attachments count bytes; deleting an attachment works at full quota",
        async () => {
          await unlimited();
          const before = await used();
          const doc = {
            _id: "attached",
            _attachments: {
              "inline.bin": {
                content_type: "application/octet-stream",
                data: btoa("x".repeat(250)),
                length: 0,
              },
            },
          };
          assertEquals((await request(`${db}/attached`, "PUT", doc)).status, 201);
          assertEquals(await used(), before + documentBytes(doc));
          const current = await request(`${db}/attached`);
          const stub = (current.body._attachments as Record<string, Record<string, unknown>>)[
            "inline.bin"
          ];
          await service.setPersonQuota("admin@example.test", personId, await used());
          const spoofed = await request(`${db}/attached`, "PUT", {
            ...current.body,
            payload: "new payload",
            _attachments: { "inline.bin": { ...stub, length: 0 } },
          });
          assertEquals(spoofed.status, 413);
          assertEquals(
            (
              await request(
                `${db}/attached/another.bin?rev=${current.body._rev}`,
                "PUT",
                new Uint8Array(400),
              )
            ).status,
            413,
          );
          assertEquals(
            (await request(`${db}/attached/inline.bin?rev=${current.body._rev}`, "DELETE")).status,
            200,
          );
          await unlimited();
          const empty = await request(`${db}/attached`);
          const raw = await request(
            `${db}/attached/raw.bin?rev=${empty.body._rev}`,
            "PUT",
            new Uint8Array(350),
          );
          assertEquals(raw.status, 201);
          const stored = await client.get<CouchDocument>(db, "attached");
          assertExists(stored);
          assertEquals(await used(), before + documentBytes(stored));
          await service.setPersonQuota("admin@example.test", personId, 0);
          assertEquals(
            (await request(`${db}/attached/raw.bin?rev=${raw.body.rev}`, "DELETE")).status,
            200,
          );
        },
      );

      await t.test(
        "attachment names retain empty path segments when projecting exact limits",
        async () => {
          await unlimited();
          assertEquals(
            (await request(`${db}/path-attachment`, "PUT", { payload: "base" })).status,
            201,
          );
          const current = await request(`${db}/path-attachment`);
          const bytes = new Uint8Array(200);
          const projected = {
            ...current.body,
            _attachments: {
              "a//b.bin": { content_type: "application/octet-stream", length: bytes.length },
            },
          };
          const limit = (await used()) + documentBytes(projected) - documentBytes(current.body);
          await service.setPersonQuota("admin@example.test", personId, limit - 1);
          assertEquals(
            (await request(`${db}/path-attachment/a//b.bin?rev=${current.body._rev}`, "PUT", bytes))
              .status,
            413,
          );
          await service.setPersonQuota("admin@example.test", personId, limit);
          assertEquals(
            (await request(`${db}/path-attachment/a//b.bin?rev=${current.body._rev}`, "PUT", bytes))
              .status,
            201,
          );
          assert((await used()) <= limit);
        },
      );

      await t.test(
        "If-Match revisions allow shrinking writes and deletes at full quota",
        async () => {
          await unlimited();
          const created = await request(`${db}/header-revision`, "PUT", {
            payload: "remove me",
            _attachments: { "a.bin": { data: btoa("x".repeat(100)) } },
          });
          assertEquals(created.status, 201);
          await service.setPersonQuota("admin@example.test", personId, 0);
          const removed = await request(`${db}/header-revision/a.bin`, "DELETE", undefined, {
            "if-match": `"${created.body.rev}"`,
          });
          assertEquals(removed.status, 200);
          const shrunk = await request(
            `${db}/header-revision`,
            "PUT",
            {},
            {
              "if-match": `"${removed.body.rev}"`,
            },
          );
          assertEquals(shrunk.status, 201);
          assertEquals(
            (
              await request(`${db}/header-revision`, "DELETE", undefined, {
                "if-match": `"${shrunk.body.rev}"`,
              })
            ).status,
            200,
          );
        },
      );

      await t.test(
        "checkpoints work at full quota including encoded IDs, with bounded checkpoint size",
        async () => {
          await service.setPersonQuota("admin@example.test", personId, 0);
          assertEquals(
            (await request(`${db}/_local/checkpoint`, "PUT", { sequence: 123 })).status,
            201,
          );
          assertEquals(
            (await request(`${db}/_local%2Fencoded-checkpoint`, "PUT", { sequence: 456 })).status,
            201,
          );
          const checkpoint = await request(`${db}/_local%2Fencoded-checkpoint`);
          assertEquals(checkpoint.status, 200);
          assertEquals(checkpoint.body.sequence, 456);
          assertEquals(
            (await request(`${db}/_local/huge`, "PUT", { payload: "x".repeat(65536) })).status,
            413,
          );
          assertEquals(
            (await request(`${db}/_local%2Fdashboard-owner`, "PUT", { payload: "tampered" }))
              .status,
            403,
          );
          const existing = await request(`${db}/_local/checkpoint`);
          assertEquals(
            (await request(`${db}/_local/checkpoint?rev=${existing.body._rev}`, "DELETE")).status,
            200,
          );
        },
      );

      await t.test(
        "invalid attachment encodings and unknown stubs fail before storing data",
        async () => {
          await unlimited();
          const invalid = await request(`${db}/invalid-base64`, "PUT", {
            _attachments: {
              "file.bin": { content_type: "application/octet-stream", data: "invalid!!" },
            },
          });
          assertEquals(invalid.status, 400);
          assertEquals(await client.get(db, "invalid-base64"), undefined);
          const missing = await request(`${db}/missing-stub`, "PUT", {
            _attachments: {
              "file.bin": { stub: true, digest: "md5-unknown", length: 0, revpos: 1 },
            },
          });
          assertEquals(missing.status, 400);
          assertEquals(await client.get(db, "missing-stub"), undefined);
        },
      );

      await t.test(
        "compressed attachment writes cannot spend only their compressed length",
        async () => {
          await unlimited();
          assertEquals(
            (await request(`${db}/compressed`, "PUT", { payload: "empty" })).status,
            201,
          );
          const current = await request(`${db}/compressed`);
          await service.setPersonQuota("admin@example.test", personId, (await used()) + 200);
          const compressed = new Uint8Array(
            await new Response(
              new Blob([new Uint8Array(4096)]).stream().pipeThrough(new CompressionStream("gzip")),
            ).arrayBuffer(),
          );
          assert(compressed.length < 200);
          const result = await request(
            `${db}/compressed/file.bin?rev=${current.body._rev}`,
            "PUT",
            compressed,
            {
              "content-encoding": "gzip",
              "content-type": "application/octet-stream",
            },
          );
          assert([400, 413, 415].includes(result.status), result.text);
          const stored = await client.get<CouchDocument>(db, "compressed");
          assertEquals(stored?._attachments, undefined);
        },
      );

      await t.test(
        "replicator, design updates and ownership marker writes cannot bypass admission",
        async () => {
          const dangerous = [
            ["_replicate", "POST"],
            ["_replicator/job", "PUT"],
            [`${db}/_design/danger/_update/write`, "POST"],
            [`${db}/_design/danger/_rewrite`, "POST"],
            [`${db}/_purge`, "POST"],
            [`${db}/_security`, "PUT"],
            [`${db}/_local/dashboard-owner`, "PUT"],
          ];
          for (const [path, method] of dangerous) {
            assertEquals((await request(path, method, {})).status, 403, path);
          }
          // Without a reset handler the gateway refuses a rebuild; creation finds the database.
          const rebuild = await request(db, "DELETE");
          assertEquals(rebuild.status, 403);
          assertStringIncludes(rebuild.text, "remote_rebuild_forbidden");
          assertEquals((await request(db, "PUT")).status, 412);
          assertExists(await client.request(encodeURIComponent(db)));
          assertEquals(
            (
              await request(`${db}/_bulk_docs`, "POST", {
                docs: [{ _id: "_design/danger", validate_doc_update: "function(){}" }],
              })
            ).status,
            403,
          );
        },
      );

      await t.test(
        "Unicode and prototype-named properties survive metering and reconciliation",
        async () => {
          await unlimited();
          const before = await used();
          const id = "日本語/nota-é";
          const value = JSON.parse(
            '{"payload":"á😀日本語","nested":{"__proto__":{"polluted":true}},"constructor":"value"}',
          );
          const written = await request(`${db}/${encodeURIComponent(id)}`, "PUT", value);
          assertEquals(written.status, 201);
          const stored = await client.get<CouchDocument>(db, id);
          assertExists(stored);
          assertEquals(await used(), before + documentBytes(stored));
          assertEquals(({} as Record<string, unknown>).polluted, undefined);
          const named = await request(`${db}/constructor`, "PUT", { payload: "prototype name" });
          assertEquals(named.status, 201);
          const namedStored = await client.get<CouchDocument>(db, "constructor");
          assertExists(namedStored);
          assertEquals(await used(), before + documentBytes(stored) + documentBytes(namedStored));
          const restarted = new CouchDashboardService(
            client,
            registry,
            "https://sync.example.test",
            settings,
          );
          await restarted.initialize();
          assertEquals((await restarted.personQuota(login)).usedBytes, await used());
        },
      );
      await t.test("an upstream accepted response keeps admission pending", async () => {
        await unlimited();
        const upstream = await testServer(async (incoming) => {
          const source = new URL(incoming.url);
          if (incoming.method === "PUT" && source.pathname === `/${db}/accepted`) {
            await client.put(db, { ...(await incoming.json()), _id: "accepted" });
            return Response.json({ ok: true }, { status: 202 });
          }
          const target = new URL(url!);
          target.pathname = source.pathname;
          target.search = source.search;
          return await fetch(target, {
            method: incoming.method,
            ...{ duplex: "half" as const },
            headers: incoming.headers,
            body:
              incoming.method === "GET" || incoming.method === "HEAD" ? undefined : incoming.body,
          });
        });
        try {
          const accepting = new QuotaGateway(
            client,
            service.quotas,
            `http://127.0.0.1:${upstream.port}`,
            username!,
            password!,
          );
          const response = await accepting.fetch(
            new Request(`https://sync.example.test/${db}/accepted`, {
              method: "PUT",
              headers: {
                authorization: authorization(user, secret),
                "content-type": "application/json",
              },
              body: JSON.stringify({ payload: "stored but not confirmed" }),
            }),
          );
          assertEquals(response.status, 503);
          await response.body?.cancel();
          assertExists(await client.get(db, "accepted"));
          const ledger = await client.get<CouchDocument>(registry, "quota:ledger");
          assertExists(ledger?.pending);
          const apps = createApps({
            service,
            config: loadConfig({
              COUCHDB_URL: url!,
              COUCHDB_USER: username!,
              COUCHDB_PASSWORD: password!,
              PUBLIC_COUCHDB_URL: "https://sync.example.test",
              PUBLIC_ADMIN_URL: "https://sync.example.test:8443",
              PUBLIC_SETUP_URL: "https://sync.example.test:9443",
              PANEL_ADMINS: "admin@example.test",
              PANEL_CSRF_SECRET: "fixture-secret-with-at-least-32-characters",
            }),
            backup: { status: async () => null, request: async () => ({ requestId: "unused" }) },
          });
          for (const path of ["/", "/people", `/people/${personId}`]) {
            const page = await apps.admin.fetch(
              new Request(`https://sync.example.test:8443${path}`, {
                headers: {
                  "Tailscale-User-Login": "admin@example.test",
                  cookie: "panel_locale=es",
                },
              }),
            );
            assertEquals(page.status, 200);
            const html = await page.text();
            assertStringIncludes(html, "Las cuotas requieren reconciliación");
            assertStringIncludes(html, "No disponible");
          }
          const ownerPage = await apps.owner.fetch(
            new Request("https://sync.example.test:9443/", {
              headers: {
                cookie: await ownerCookie(
                  "fixture-secret-with-at-least-32-characters",
                  service,
                  user,
                  secret,
                ),
              },
            }),
          );
          assertEquals(ownerPage.status, 200);
          assertStringIncludes(await ownerPage.text(), "Quotas require reconciliation");
          assertEquals(
            (await request(`${db}/after-accepted`, "PUT", { payload: "blocked" })).status,
            503,
          );
          assertExists((await client.get<CouchDocument>(registry, "quota:ledger"))?.pending);
        } finally {
          await upstream.close();
        }
      });

      await t.test("repeated failed logins are refused before reaching CouchDB", async () => {
        const wrong = authorization(outsider, "wrong-password");
        for (let attempt = 0; attempt < 5; attempt++)
          assertEquals((await request(other, "GET", undefined, {}, wrong)).status, 401);
        const blocked = await request(other, "GET", undefined, {}, authorization(outsider, secret));
        assertEquals([blocked.status, blocked.body.reason], [429, "too_many_attempts"]);
        const session = await request(
          "_session",
          "POST",
          { name: outsider, password: secret },
          {},
          "",
        );
        assertEquals(session.status, 429);
        assertEquals((await request(db, "GET")).status, 200);
      });
    } finally {
      settings.instanceLimitBytes = null;
      for (const database of [db, second, other, registry]) {
        assert(database.startsWith(prefix), "Unsafe database fixture cleanup");
        await client.request(database, "DELETE").catch(() => {});
      }
      for (const name of [user, outsider]) {
        assert(name.startsWith(prefix), "Unsafe user fixture cleanup");
        const account = await client.get<CouchDocument>("_users", `org.couchdb.user:${name}`);
        if (account?._rev) {
          await client.request(
            `_users/${encodeURIComponent(account._id)}?rev=${account._rev}`,
            "DELETE",
          );
        }
      }
    }
  },
);
