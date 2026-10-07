import assert from "node:assert/strict";

export function assertDisposableFixture(url: string, username?: string, password?: string): void {
  assert(
    /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]+)?\/?$/.test(url) &&
      username === "adminfixture" &&
      password === "fixture-password-long",
    "Gateway tests require the documented disposable loopback fixture",
  );
  const parsed = new URL(url);
  assert(parsed.port !== "0", "Fixture port must be nonzero");
}
