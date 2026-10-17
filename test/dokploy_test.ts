import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dokployEnvironment } from "../scripts/dokploy-bundle.ts";

const template = readFileSync("deploy/.env.dokploy.example", "utf8");
const digest = (value: string) => `sha256:${value.repeat(64)}`;
let composeAvailable = false;
try {
  execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
  composeAvailable = true;
} catch {
  // Unit tests can run without Docker; CI validates both Compose variants.
}

test("Dokploy release bundle pins both GHCR packages and keeps secrets as placeholders", () => {
  const output = dokployEnvironment(
    template,
    "fixture/dashboard",
    "0.1.0-rc.1",
    digest("a"),
    digest("b"),
  );
  assert.match(output, new RegExp(`^PANEL_IMAGE=ghcr.io/fixture/dashboard@${digest("a")}$`, "m"));
  assert.match(
    output,
    new RegExp(`^BACKUP_IMAGE=ghcr.io/fixture/dashboard-backup@${digest("b")}$`, "m"),
  );
  assert.match(output, /^COUCHDB_PASSWORD=replace-with-long-random-password$/m);
  assert.match(output, /^TS_AUTHKEY=replace-with-/m);
  for (const repository of ["OWNER/repo", "owner/repo:latest", "owner/repo\nSECRET=bad"]) {
    assert.throws(() =>
      dokployEnvironment(template, repository, "0.1.0", digest("a"), digest("b")),
    );
  }
  assert.throws(() =>
    dokployEnvironment(template, "owner/repo", "latest", digest("a"), digest("b")),
  );
  assert.throws(() =>
    dokployEnvironment(template, "owner/repo", "0.1.0", "sha256:short", digest("b")),
  );
  assert.throws(() =>
    dokployEnvironment(
      template + "\nPANEL_IMAGE=duplicate",
      "owner/repo",
      "0.1.0",
      digest("a"),
      digest("b"),
    ),
  );
});

test(
  "Dokploy Compose definitions cannot build and preserve private Tailscale routing",
  { skip: !composeAvailable },
  () => {
    for (const file of ["deploy/compose.dokploy.yml", "deploy/compose.dokploy.existing.yml"]) {
      const compose = JSON.parse(
        execFileSync(
          "docker",
          ["compose", "-f", file, "config", "--no-interpolate", "--format", "json"],
          { encoding: "utf8" },
        ),
      );
      for (const service of Object.values(compose.services) as Record<string, unknown>[]) {
        assert.equal(service.build, undefined);
        assert.equal(service.ports, undefined);
      }
      assert.equal(compose.services.panel.pull_policy, "always");
      assert.equal(compose.services.panel.network_mode, "service:ts");
      assert.equal(compose.services.panel.networks, undefined);
      assert.equal(compose.services.panel.read_only, true);
      assert.equal(compose.services.panel.user, "1000:1000");
      assert.equal(compose.services.ts.environment.TS_LOCAL_ADDR_PORT, "127.0.0.1:9002");
      assert.equal(
        compose.services.panel.environment.PUBLIC_ADMIN_URL,
        "https://${TS_FQDN:?Set full Tailscale DNS name}:8443",
      );
      assert.equal(
        compose.services.panel.environment.PUBLIC_SETUP_URL,
        "https://${TS_FQDN:?Set full Tailscale DNS name}:9443",
      );
      assert.equal(
        compose.services.panel.environment.PUBLIC_COUCHDB_URL,
        "https://${TS_FQDN:?Set full Tailscale DNS name}",
      );
      for (const config of Object.values(compose.configs) as Record<string, unknown>[]) {
        assert.equal(config.file, undefined);
        assert.equal(typeof config.content, "string");
      }
      const serve = JSON.parse(compose.configs.serve.content.replaceAll("$${", "${"));
      assert.equal(serve.Web["${TS_CERT_DOMAIN}:443"].Handlers["/"].Proxy, "http://127.0.0.1:8082");
      assert.equal(
        serve.Web["${TS_CERT_DOMAIN}:8443"].Handlers["/"].Proxy,
        "http://127.0.0.1:8080",
      );
      assert.equal(
        serve.Web["${TS_CERT_DOMAIN}:9443"].Handlers["/"].Proxy,
        "http://127.0.0.1:8081",
      );
      assert.deepEqual(Object.values(serve.AllowFunnel), [false, false, false]);
    }
  },
);
