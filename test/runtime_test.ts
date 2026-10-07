import { test } from "node:test";
import assert from "node:assert/strict";
import { CouchClient } from "../src/couchdb/client.ts";
import { QuotaManager } from "../src/domain/quota.ts";
import { QuotaGateway } from "../src/quota/gateway.ts";
import { testServer } from "./server.ts";

function deferred() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve: () => resolve(),
  };
}

test("authentication errors retain only the upstream's allowed CORS policy", async () => {
  const upstream = await testServer((request) =>
    Response.json(
      { error: "unauthorized" },
      {
        status: 401,
        headers:
          request.headers.get("origin") === "app://obsidian.md"
            ? {
                "access-control-allow-origin": "app://obsidian.md",
                "access-control-allow-credentials": "true",
                vary: "Origin",
              }
            : {},
      },
    ),
  );
  const url = `http://127.0.0.1:${upstream.port}`;
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
  try {
    for (const origin of ["app://obsidian.md", "https://attacker.example"]) {
      const response = await gateway.fetch(
        new Request("https://sync.example.test/vault/note", {
          headers: { origin, authorization: `Basic ${btoa("alice:wrong-password")}` },
        }),
      );
      assert.equal(response.status, 401);
      assert.equal(
        response.headers.get("access-control-allow-origin"),
        origin === "app://obsidian.md" ? origin : null,
      );
    }
  } finally {
    await upstream.close();
  }
});

test(
  "queued writes recheck vault permissions before using administrator credentials",
  { timeout: 5000 },
  async () => {
    const entered = deferred();
    const release = deferred();
    const checkedTwice = deferred();
    let permissions = 0;
    let permitted = true;
    let writes = 0;
    const upstream = await testServer((request) => {
      const path = new URL(request.url).pathname;
      if (path === "/_session") return Response.json({ userCtx: { name: "alice", roles: [] } });
      if (request.method === "GET") {
        if (++permissions === 2) checkedTwice.resolve();
        return Response.json({}, { status: permitted ? 200 : 403 });
      }
      writes++;
      return Response.json({ ok: true }, { status: 201 });
    });
    const url = `http://127.0.0.1:${upstream.port}`;
    const client = new CouchClient(url, "admin", "unused");
    class BlockingQuota extends QuotaManager {
      override async withWrite<T>(
        _database: string,
        _ids: string[],
        _project: Parameters<QuotaManager["withWrite"]>[2],
        forward: () => Promise<T>,
        authorize?: () => Promise<void>,
      ): Promise<T> {
        entered.resolve();
        await release.promise;
        await authorize?.();
        return forward();
      }
    }
    const gateway = new QuotaGateway(
      client,
      new BlockingQuota(client, "panel", {
        instanceLimitBytes: null,
        defaultUserLimitBytes: null,
      }),
      url,
      "admin",
      "unused",
    );
    const write = (id: string) =>
      gateway.fetch(
        new Request(`https://sync.example.test/vault/${id}`, {
          method: "PUT",
          body: JSON.stringify({ payload: "queued" }),
          headers: { authorization: `Basic ${btoa("alice:password")}` },
        }),
      );
    const first = write("first");
    let second: Promise<Response> | undefined;
    try {
      await entered.promise;
      second = write("second");
      await checkedTwice.promise;
      permitted = false;
      release.resolve();
      assert.equal((await first).status, 403);
      assert.equal((await second).status, 403);
      assert.equal(writes, 0);
    } finally {
      release.resolve();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
      await upstream.close();
    }
  },
);

test(
  "disconnecting a streaming client closes its upstream connection",
  { timeout: 5000 },
  async () => {
    let cancelled = false;
    const upstream = await testServer((request) => {
      request.signal.addEventListener("abort", () => {
        cancelled = true;
      });
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("heartbeat\n"));
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    });
    const url = `http://127.0.0.1:${upstream.port}`;
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
    const server = await testServer((request) => gateway.fetch(request));
    const abort = new AbortController();
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/_session`, {
        signal: abort.signal,
      });
      const reader = response.body!.getReader();
      await reader.read();
      abort.abort();
      await reader.cancel().catch(() => {});
      for (let attempt = 0; attempt < 40 && !cancelled; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(cancelled, true);
    } finally {
      abort.abort();
      await server.close();
      await upstream.close();
    }
  },
);

test(
  "disconnecting before upstream headers cancels the pending upstream request",
  { timeout: 5000 },
  async () => {
    const arrived = deferred();
    const finish = deferred();
    let cancelled = false;
    const upstream = await testServer(async (request) => {
      request.signal.addEventListener("abort", () => {
        cancelled = true;
      });
      arrived.resolve();
      await finish.promise;
      return new Response("finished");
    });
    const url = `http://127.0.0.1:${upstream.port}`;
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
    const server = await testServer((request) => gateway.fetch(request));
    const abort = new AbortController();
    const response = fetch(`http://127.0.0.1:${server.port}/_session`, {
      signal: abort.signal,
    }).catch(() => undefined);
    try {
      await arrived.promise;
      abort.abort();
      await response;
      for (let attempt = 0; attempt < 40 && !cancelled; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(cancelled, true);
    } finally {
      abort.abort();
      finish.resolve();
      await server.close();
      await upstream.close();
    }
  },
);

test("Node HTTP gateway forwards streamed bodies, cookies and response chunks", async () => {
  const payload = "name=alice&password=fixture-password";
  const upstream = await testServer(async (request) => {
    assert.equal(new URL(request.url).pathname, "/_session");
    assert.equal(await request.text(), payload);
    assert.equal(request.headers.get("tailscale-user-login"), null);
    const bytes = new TextEncoder().encode('{"ok":true}');
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, 4));
          controller.enqueue(bytes.slice(4));
          controller.close();
        },
      }),
      {
        headers: { "set-cookie": "AuthSession=test; HttpOnly", "content-type": "application/json" },
      },
    );
  });
  const url = `http://127.0.0.1:${upstream.port}`;
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
  const server = await testServer((request) => gateway.fetch(request));
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/_session`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "tailscale-user-login": "alice",
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(payload));
          controller.close();
        },
      }),
      ...{ duplex: "half" as const },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), "AuthSession=test; HttpOnly");
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    await server.close();
    await upstream.close();
  }
});
