import { test } from "node:test";
import { assertEquals, assertThrows } from "./assert.ts";
import { QuotaManager, quotaUsage, validateQuotaLimit } from "../src/domain/quota.ts";
import { CouchClient } from "../src/couchdb/client.ts";
import { ServiceError } from "../src/contracts.ts";
import { base64Bytes } from "../src/quota/bytes.ts";

test("base64 attachment validation handles 48 MiB without recursive matching", () => {
  const bytes = 48 * 1024 * 1024;
  assertEquals(base64Bytes(Buffer.alloc(bytes, 7).toString("base64")), bytes);
});

test("base64 attachment validation accepts final padding and rejects malformed encodings", () => {
  for (const [encoded, bytes] of [
    ["", 0],
    ["YQ==", 1],
    ["YWI=", 2],
    ["YWJj", 3],
    ["+/09", 3],
  ] as const) {
    assertEquals(base64Bytes(encoded), bytes);
  }
  for (const encoded of [
    "Y=Q=",
    "YQ",
    "YWJ!",
    "Y===",
    "====",
    "YQ==YWJj",
    "YWJj\n",
    "YWJé",
    "YWJ_",
  ]) {
    assertThrows(() => base64Bytes(encoded), ServiceError, "invalid_attachment_encoding");
  }
});

test("quota byte limits require nonnegative safe integers or explicit unlimited", () => {
  for (const limit of [null, 0, 1024, Number.MAX_SAFE_INTEGER]) validateQuotaLimit(limit);
  for (const limit of [
    -1,
    1.5,
    Number.POSITIVE_INFINITY,
    Number.NaN,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assertThrows(() => validateQuotaLimit(limit), ServiceError, "invalid_quota");
  }
});

test("quota remaining space floors at zero and keeps unlimited distinct", () => {
  assertEquals(quotaUsage(100, 25), {
    limitBytes: 100,
    usedBytes: 25,
    remainingBytes: 75,
    exceeded: false,
  });
  assertEquals(quotaUsage(100, 125), {
    limitBytes: 100,
    usedBytes: 125,
    remainingBytes: 0,
    exceeded: true,
  });
  assertEquals(quotaUsage(null, 125), {
    limitBytes: null,
    usedBytes: 125,
    remainingBytes: null,
    exceeded: false,
  });
  assertEquals(quotaUsage(0, 0), {
    limitBytes: 0,
    usedBytes: 0,
    remainingBytes: 0,
    exceeded: false,
  });
});

test("user limits cannot exceed finite instance capacity but unlimited remains globally bounded", () => {
  const client = new CouchClient("http://127.0.0.1:5984", "admin", "unused");
  const quotas = new QuotaManager(client, "panel", {
    instanceLimitBytes: 100,
    defaultUserLimitBytes: 50,
  });
  quotas.validatePersonLimit(null);
  quotas.validatePersonLimit(100);
  quotas.validatePersonLimit(0);
  assertThrows(() => quotas.validatePersonLimit(101), ServiceError, "quota_exceeds_instance");
  assertThrows(
    () =>
      new QuotaManager(client, "panel", { instanceLimitBytes: 100, defaultUserLimitBytes: 101 }),
    ServiceError,
    "quota_exceeds_instance",
  );
});
