import { test } from "node:test";
import { assertEquals, assertThrows } from "./assert.ts";
import { configuredQuota, loadConfig } from "../src/config.ts";

const env = {
  COUCHDB_URL: "http://127.0.0.1:5984",
  COUCHDB_USER: "admin",
  COUCHDB_PASSWORD: "fixture-password",
  PUBLIC_COUCHDB_URL: "https://sync.example.test",
  PUBLIC_ADMIN_URL: "https://sync.example.test:8443",
  PUBLIC_SETUP_URL: "https://sync.example.test:9443",
  PANEL_ADMINS: "admin@example.test",
  PANEL_CSRF_SECRET: "fixture-secret-at-least-32-characters",
};

test("startup quotas parse GiB and reject invalid or oversized limits", () => {
  assertEquals(configuredQuota(), null);
  assertEquals(configuredQuota("0"), null);
  assertEquals(configuredQuota("1.5"), 1.5 * 1024 ** 3);
  for (const value of ["-1", "NaN", "Infinity", "1e3", "0.0001", "9007199254740991"]) {
    assertThrows(() => configuredQuota(value));
  }
  const config = loadConfig({ ...env, INSTANCE_QUOTA_GIB: "100", DEFAULT_USER_QUOTA_GIB: "5" });
  assertEquals(config.instanceQuotaBytes, 100 * 1024 ** 3);
  assertEquals(config.defaultUserQuotaBytes, 5 * 1024 ** 3);
  assertEquals(config.recoverPendingQuota, false);
  assertThrows(() => loadConfig({ ...env, INSTANCE_QUOTA_GIB: "1", DEFAULT_USER_QUOTA_GIB: "2" }));
  assertThrows(() => loadConfig({ ...env, QUOTA_RECOVER_PENDING: "true" }));
  assertEquals(loadConfig({ ...env, QUOTA_RECOVER_PENDING: "1" }).recoverPendingQuota, true);
});

test("personal Drive is opt-in and requires a complete OAuth client and independent token key", () => {
  assertEquals(loadConfig(env).personalDrive, undefined);
  assertThrows(() => loadConfig({ ...env, GOOGLE_DRIVE_CLIENT_ID: "client" }));
  const drive = {
    GOOGLE_DRIVE_CLIENT_ID: "client",
    GOOGLE_DRIVE_CLIENT_SECRET: "client-secret",
    GOOGLE_DRIVE_TOKEN_KEY: Buffer.alloc(32, 3).toString("base64"),
  };
  assertEquals(
    loadConfig({ ...env, ...drive }).personalDrive?.redirectUri,
    "https://sync.example.test:9443/backups/google/callback",
  );
  assertThrows(() => loadConfig({ ...env, ...drive, GOOGLE_DRIVE_TOKEN_KEY: "short" }));
  assertThrows(() => loadConfig({ ...env, ...drive, GOOGLE_DRIVE_CLIENT_SECRET: "" }));
  const picker = {
    GOOGLE_DRIVE_PICKER_API_KEY: "browser-api-key",
    GOOGLE_DRIVE_PROJECT_NUMBER: "123456789",
  };
  assertEquals(
    loadConfig({ ...env, ...drive, ...picker }).personalDrive?.picker?.appId,
    "123456789",
  );
  assertThrows(() => loadConfig({ ...env, ...drive, GOOGLE_DRIVE_PICKER_API_KEY: "key" }));
  assertThrows(() =>
    loadConfig({ ...env, ...drive, ...picker, GOOGLE_DRIVE_PROJECT_NUMBER: "project-id" }),
  );
  assertThrows(() => loadConfig({ ...env, ...picker }));
});
