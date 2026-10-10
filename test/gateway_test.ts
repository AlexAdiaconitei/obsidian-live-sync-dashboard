import { test } from "node:test";
import { assertEquals } from "./assert.ts";
import { CouchClient } from "../src/couchdb/client.ts";
import { QuotaManager } from "../src/domain/quota.ts";
import { QuotaGateway } from "../src/quota/gateway.ts";

test("gateway rejects network-path URLs before contacting any upstream", async () => {
  const url = "http://127.0.0.1:1";
  const client = new CouchClient(url, "admin", "secret");
  const quotas = new QuotaManager(client, "panel", {
    instanceLimitBytes: null,
    defaultUserLimitBytes: null,
  });
  const gateway = new QuotaGateway(client, quotas, url, "admin", "secret");
  for (const method of ["GET", "OPTIONS", "PUT"]) {
    const response = await gateway.fetch(
      new Request("https://sync.example.test//attacker.test/path", {
        method,
        headers: { authorization: "Basic dXNlcjpwYXNz" },
      }),
    );
    assertEquals(response.status, 400);
    assertEquals((await response.json()).reason, "invalid_sync_path");
  }
});

test("malformed paths and oversized login bodies fail before contacting CouchDB", async () => {
  const url = "http://127.0.0.1:1";
  const client = new CouchClient(url, "admin", "unused");
  const gateway = new QuotaGateway(
    client,
    new QuotaManager(client, "panel", {
      instanceLimitBytes: null,
      defaultUserLimitBytes: null,
    }),
    url,
    "admin",
    "unused",
  );
  const malformed = await gateway.fetch(new Request("https://sync.example.test/vault/%ZZ"));
  const oversized = await gateway.fetch(
    new Request("https://sync.example.test/_session", {
      method: "POST",
      body: "small",
      headers: { "content-length": "65537" },
    }),
  );
  const chunked = await gateway.fetch(
    new Request("https://sync.example.test/_session", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(32_769));
          controller.close();
        },
      }),
      ...{ duplex: "half" as const },
    }),
  );
  assertEquals([malformed.status, oversized.status, chunked.status], [400, 413, 413]);
});
