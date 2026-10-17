import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

let composeAvailable = false;
try {
  execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
  composeAvailable = true;
} catch {
  // Unit tests can run without Docker; CI validates both Compose variants.
}

interface Volume {
  source: string;
  target: string;
  read_only?: boolean;
}
type Service = Record<string, unknown> & {
  environment: Record<string, string>;
  volumes: Volume[];
};

function config(file: string, profile?: string) {
  const fixture = Object.fromEntries(
    [
      "AGE_RECIPIENT",
      "BACKUP_IMAGE",
      "COUCHDB_PASSWORD",
      "COUCHDB_USER",
      "PANEL_ADMINS",
      "PANEL_CSRF_SECRET",
      "PANEL_IMAGE",
      "PUBLIC_ADMIN_URL",
      "PUBLIC_COUCHDB_URL",
      "PUBLIC_SETUP_URL",
      "RCLONE_REMOTE",
      "TS_AUTHKEY",
      "TS_FQDN",
    ].map((key) => [key, "fixture"]),
  );
  const args = ["compose", "-f", file, ...(profile ? ["--profile", profile] : [])];
  return JSON.parse(
    execFileSync("docker", [...args, "config", "--format", "json"], {
      encoding: "utf8",
      env: { ...process.env, ...fixture, COMPOSE_PROFILES: "" },
    }),
  ) as { services: Record<string, Service> };
}

test(
  "The secondary backup worker is opt-in and mirrors the primary worker",
  { skip: !composeAvailable },
  () => {
    for (const file of ["deploy/compose.yml", "deploy/compose.dokploy.yml"]) {
      assert.equal(config(file).services["backup-secondary"], undefined);
      const { services } = config(file, "secondary-backup");
      const primary = services.backup;
      const secondary = services["backup-secondary"];
      assert.deepEqual(secondary.profiles, ["secondary-backup"]);
      const hardening = (service: Service) =>
        Object.fromEntries(
          Object.entries(service).filter(
            ([key]) => !["profiles", "environment", "volumes"].includes(key),
          ),
        );
      assert.deepEqual(hardening(secondary), hardening(primary));
      assert.deepEqual(Object.keys(secondary.environment), Object.keys(primary.environment));
      assert.equal(secondary.environment.AGE_RECIPIENT, primary.environment.AGE_RECIPIENT);
      assert.equal(secondary.environment.RCLONE_REMOTE, "");
      const mounts = (service: Service) =>
        Object.fromEntries(service.volumes.map((volume) => [volume.target, volume]));
      const own = mounts(secondary);
      const shared = mounts(primary);
      assert.deepEqual(Object.keys(own).sort(), Object.keys(shared).sort());
      assert.equal(own["/data"].source, "couchdb-data");
      assert.equal(own["/data"].read_only, true);
      // Shared state would let both workers overwrite one status and claim the panel's requests.
      for (const target of ["/config/rclone", "/backup/status", "/backup/requests", "/work"]) {
        assert.notEqual(own[target].source, shared[target].source);
      }
      const panelSources = services.panel.volumes.map((volume) => volume.source);
      for (const volume of secondary.volumes.filter((item) => item.target !== "/data")) {
        assert.ok(!panelSources.includes(volume.source));
      }
    }
  },
);
