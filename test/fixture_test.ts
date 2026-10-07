import { test } from "node:test";
import { assertThrows } from "./assert.ts";
import { assertDisposableFixture } from "./fixture.ts";

test("gateway fixtures accept loopback ports and reject remote hosts or other credentials", () => {
  for (const url of ["http://127.0.0.1:25984", "http://localhost:15984/", "http://[::1]:25984"]) {
    assertDisposableFixture(url, "adminfixture", "fixture-password-long");
  }
  for (const url of [
    "http://example.test:25984",
    "http://127.0.0.1.example.test",
    "http://192.168.1.2:25984",
    "http://user@localhost:25984",
    "http://localhost:25984/db",
    "http://localhost:25984?x=1",
    "http://localhost:0",
    "http://localhost:65536",
  ]) {
    assertThrows(() => assertDisposableFixture(url, "adminfixture", "fixture-password-long"));
  }
  assertThrows(() =>
    assertDisposableFixture("http://localhost:25984", "admin", "fixture-password-long"),
  );
  assertThrows(() => assertDisposableFixture("http://localhost:25984", "adminfixture", "other"));
});
