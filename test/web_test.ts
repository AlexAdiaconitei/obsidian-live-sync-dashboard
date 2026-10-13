import { test } from "node:test";
import { assert, assertEquals, assertFalse, assertStringIncludes, assertThrows } from "./assert.ts";
import { Csrf } from "../src/access/csrf.ts";
import { OwnerSessions, SESSION_MAX_MS } from "../src/access/owner-session.ts";
import type { PersonalBackupGateway, PersonalBackupStatus } from "../src/backup/personal.ts";
import { loadConfig } from "../src/config.ts";
import {
  type BackupGateway,
  type BackupRun,
  type BackupStatus,
  type DashboardService,
  type Person,
  ServiceError,
} from "../src/contracts.ts";
import { createApps } from "../src/web/apps.ts";
import { parseQuota, quotaField } from "../src/web/components/quotas.ts";
import {
  personalBackupPanel,
  personalBackupStatusPanel,
} from "../src/web/components/personal-backups.ts";

const configuration = {
  COUCHDB_URL: "http://127.0.0.1:5984",
  COUCHDB_USER: "admin",
  COUCHDB_PASSWORD: "test",
  PUBLIC_COUCHDB_URL: "https://notes.example.test",
  PUBLIC_ADMIN_URL: "https://notes.example.test:8443",
  PUBLIC_SETUP_URL: "https://notes.example.test:9443",
  PANEL_ADMINS: "admin@example.test",
  PANEL_CSRF_SECRET: "test-key-must-contain-at-least-32-characters",
};
const person: Person = {
  id: "alice",
  couchUser: "alice",
  displayName: "Alice",
  tailscaleLogin: "alice@example.test",
  status: "active",
  createdAt: "2026-01-01T00:00:00Z",
};
function fixture(
  status: Person["status"] = "active",
  options: {
    backup?: BackupGateway;
    personalBackup?: PersonalBackupGateway;
    passwordError?: string;
    provisioning?: boolean;
    setupError?: string;
    auditError?: boolean;
    quotaBytes?: number | null;
    usedBytes?: number;
    quotaError?: string;
    recoveryCode?: string | null;
  } = {},
) {
  const recoveries: Array<[string, string, string, boolean]> = [];
  let password = "";
  let instruction: "new" | "additional" = "new";
  const reconciliations: string[][] = [];
  let quotaLimitBytes = options.quotaBytes === undefined ? 1024 ** 3 : options.quotaBytes;
  const quotaChanges: Array<{ actor: string; id: string; limitBytes: number | null }> = [];
  const personQuota = () => ({
    personId: person.id,
    limitBytes: quotaLimitBytes,
    usedBytes: options.usedBytes ?? 1024 ** 3 / 4,
    remainingBytes:
      quotaLimitBytes === null
        ? null
        : Math.max(0, quotaLimitBytes - (options.usedBytes ?? 1024 ** 3 / 4)),
    exceeded: quotaLimitBytes !== null && (options.usedBytes ?? 1024 ** 3 / 4) >= quotaLimitBytes,
  });
  const service = {
    quotaSummary() {
      if (options.quotaError) return Promise.reject(new ServiceError(options.quotaError, 503));
      return Promise.resolve({
        instance: {
          limitBytes: 10 * 1024 ** 3,
          usedBytes: 1024 ** 3,
          remainingBytes: 9 * 1024 ** 3,
          exceeded: false,
          defaultUserLimitBytes: 1024 ** 3,
        },
        people: [
          personQuota(),
          {
            personId: "secret-person",
            limitBytes: 812345678,
            usedBytes: 123456789,
            remainingBytes: 688888889,
            exceeded: false,
          },
        ],
      });
    },
    personQuota(login: string) {
      if (options.quotaError) return Promise.reject(new ServiceError(options.quotaError, 503));
      if (login !== person.tailscaleLogin) {
        return Promise.reject(new ServiceError("forbidden", 403));
      }
      return Promise.resolve(personQuota());
    },
    setPersonQuota(actor: string, id: string, limitBytes: number | null) {
      quotaChanges.push({ actor, id, limitBytes });
      quotaLimitBytes = limitBytes;
      return Promise.resolve();
    },
    findPersonByLogin(login: string) {
      return Promise.resolve(login === person.tailscaleLogin ? { ...person, status } : null);
    },
    ownerSession(id: string, version: string) {
      return Promise.resolve(
        id === person.id && version === sessionVersion && status === "active"
          ? { ...person, status }
          : null,
      );
    },
    health() {
      return Promise.resolve({ up: true, version: "3.5" });
    },
    listPeople() {
      return Promise.resolve({ items: [person] });
    },
    getPerson() {
      return Promise.resolve(person);
    },
    listVaults() {
      return Promise.resolve({
        items: [
          {
            id: "owned",
            personId: person.id,
            db: "alice_vault",
            label: "<script>oops</script>",
            adopted: false,
            idRecoveryCode: options.recoveryCode === undefined ? "code" : options.recoveryCode,
            createdAt: person.createdAt,
            provisioning: options.provisioning,
          },
        ],
      });
    },
    getSetupMetadata(login: string, id: string) {
      if (options.setupError) return Promise.reject(new ServiceError(options.setupError, 409));
      if (login !== person.tailscaleLogin || id !== "owned") {
        return Promise.reject(new ServiceError("not_found", 404));
      }
      return Promise.resolve({
        vaultId: id,
        label: "Notes",
        hostname: configuration.PUBLIC_COUCHDB_URL,
        database: "alice_vault",
        username: "alice",
        idRecoveryCode: "code",
        instruction,
      });
    },
    recordUriIssued(login: string, id: string) {
      if (login !== person.tailscaleLogin || id !== "owned") {
        return Promise.reject(new ServiceError("not_found", 404));
      }
      return Promise.resolve();
    },
    registerRecoveryCode(
      actor: string,
      id: string,
      code: string,
      registration: { asOwner?: boolean } = {},
    ) {
      if (registration.asOwner && (actor !== person.tailscaleLogin || id !== "owned")) {
        return Promise.reject(new ServiceError("forbidden", 403));
      }
      if (code === "conflict") {
        return Promise.reject(new ServiceError("recovery_identity_conflict", 409));
      }
      recoveries.push([actor, id, code, registration.asOwner ?? false]);
      return Promise.resolve();
    },
    reconcileVaultOwnership(actor: string, id: string, name: string) {
      if (name !== "alice_vault") {
        return Promise.reject(new ServiceError("confirmation_mismatch", 409));
      }
      reconciliations.push([actor, id, name]);
      return Promise.resolve({
        id,
        personId: person.id,
        db: name,
        label: "Vault",
        adopted: false,
        createdAt: person.createdAt,
      });
    },
    setInitialPassword(_login: string, value: string) {
      password = value;
      return Promise.resolve();
    },
    changePassword(_login: string, _current: string, value: string) {
      if (options.passwordError) {
        return Promise.reject(new ServiceError(options.passwordError, 403));
      }
      password = value;
      return Promise.resolve();
    },
    loginOwner(username: string) {
      return username === person.couchUser
        ? Promise.resolve({ person, version: sessionVersion })
        : Promise.reject(new ServiceError("invalid_credentials", 401));
    },
    stats() {
      return Promise.resolve([
        { vaultId: "owned", db: "alice_vault", docCount: 3, sizeFile: 5_242_880, sizeActive: 1 },
      ]);
    },
    recordBackupRequested() {
      if (options.auditError) return Promise.reject(new Error("private-audit-error"));
      return Promise.resolve();
    },
  } as unknown as DashboardService;
  const apps = createApps({
    personalBackup: options.personalBackup,
    config: loadConfig(configuration),
    service,
    backup: options.backup ?? {
      status() {
        return Promise.resolve(null);
      },
      request() {
        return Promise.resolve({ requestId: "request" });
      },
    },
  });
  return {
    ...apps,
    savedPassword: () => password,
    setInstruction: (value: "new" | "additional") => {
      instruction = value;
    },
    reconciliations,
    recoveries,
    quotaChanges,
  };
}
// Administration trusts the Tailscale header; owners carry a signed session for Alice.
const sessionVersion = "test-session";
const ownerSession = `__Host-panel-session=${await new OwnerSessions(
  configuration.PANEL_CSRF_SECRET,
  {} as DashboardService,
).issue({ person, version: sessionVersion })}`;
function request(path: string, login?: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (login) headers.set("Tailscale-User-Login", login);
  if (login === person.tailscaleLogin)
    headers.set("cookie", [headers.get("cookie"), ownerSession].filter(Boolean).join("; "));
  return new Request(`https://notes.example.test:9443${path}`, { ...options, headers });
}
function token(response: Response) {
  return response.headers.get("set-cookie")!.split(";")[0];
}

test("limiter evicts the least-used login keys without blocking everyone or resetting retained limits", async () => {
  const owner = createApps({
    config: loadConfig(configuration),
    service: {
      loginOwner: async () => {
        throw new ServiceError("invalid_credentials", 401);
      },
    } as unknown as DashboardService,
    backup: { status: async () => null, request: async () => ({ requestId: "test" }) },
  }).owner;
  const response = await owner.fetch(request("/login"));
  const cookie = token(response);
  const csrf = decodeURIComponent(cookie.split("=")[1]);
  const login = (username: string) =>
    owner.fetch(
      request("/login", undefined, {
        method: "POST",
        headers: {
          cookie,
          Origin: configuration.PUBLIC_SETUP_URL,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ csrf, username, password: "wrong-password" }),
      }),
    );
  for (let index = 0; index < 4; index++) assertEquals((await login("target")).status, 401);
  for (let index = 0; index < 1002; index++)
    assertEquals((await login(`person-${index}`)).status, 401);
  for (let index = 0; index < 4; index++) assertEquals((await login("person-1001")).status, 401);
  assertEquals((await login("person-1001")).status, 429);
  assertEquals((await login("another-person")).status, 401);
  assertEquals((await login("target")).status, 401);
  assertEquals((await login("target")).status, 429);
});

test("expired owner sessions send htmx requests to the login page instead of swapping it in", async () => {
  const owner = createApps({
    config: loadConfig(configuration),
    service: {} as DashboardService,
    backup: { status: async () => null, request: async () => ({ requestId: "test" }) },
  }).owner;
  const fragment = await owner.fetch(
    request("/backups/status", undefined, { headers: { "HX-Request": "true" } }),
  );
  assertEquals([fragment.status, fragment.headers.get("HX-Redirect")], [204, "/login"]);
  const page = await owner.fetch(request("/backups"));
  assertEquals([page.status, page.headers.get("Location")], [303, "/login"]);
});

test("quota reconciliation leaves admin and owner views readable in both languages", async () => {
  const apps = fixture("active", { quotaError: "quota_reconciliation_required" });
  for (const [locale, message, unavailable] of [
    ["en", "Quotas require reconciliation", "Unavailable"],
    ["es", "Las cuotas requieren reconciliación", "No disponible"],
  ]) {
    for (const path of ["/", "/people", `/people/${person.id}`]) {
      const response = await apps.admin.fetch(
        request(path, "admin@example.test", { headers: { cookie: `panel_locale=${locale}` } }),
      );
      assertEquals(response.status, 200);
      const html = await response.text();
      assertStringIncludes(html, message);
      assertStringIncludes(html, "/docs/guides/quotas/#interrupted-writes");
      assertStringIncludes(html, unavailable);
      assertFalse(html.includes('class="quota-progress"'));
      if (path !== "/") assertStringIncludes(html, "Alice");
      if (path.includes(person.id)) assertStringIncludes(html, "alice_vault");
    }
    const response = await apps.owner.fetch(
      request("/", person.tailscaleLogin, { headers: { cookie: `panel_locale=${locale}` } }),
    );
    assertEquals(response.status, 200);
    const html = await response.text();
    assertStringIncludes(html, message);
    assertStringIncludes(html, "alice_vault");
    assertFalse(html.includes("secret-person"));
  }
});

test("quota view fallback preserves failures unrelated to pending reconciliation", async () => {
  const apps = fixture("active", { quotaError: "quota_state_invalid" });
  for (const path of ["/", "/people", `/people/${person.id}`]) {
    assertEquals((await apps.admin.fetch(request(path, "admin@example.test"))).status, 503);
  }
  assertEquals((await apps.owner.fetch(request("/", person.tailscaleLogin))).status, 503);
});

test("quota overview shows the startup limit and owner sees only personal usage", async () => {
  const apps = fixture();
  const overview = await apps.admin.fetch(request("/", "admin@example.test"));
  const adminHtml = await overview.text();
  assertStringIncludes(adminHtml, "Instance storage quota");
  assertStringIncludes(adminHtml, "10 GiB");
  assertStringIncludes(adminHtml, "9 GiB");
  assertFalse(adminHtml.includes('name="quotaGiB"'));
  const owner = await apps.owner.fetch(request("/", person.tailscaleLogin));
  const ownerHtml = await owner.text();
  assertStringIncludes(ownerHtml, "Your storage quota");
  assertStringIncludes(ownerHtml, "256 MiB");
  assertStringIncludes(ownerHtml, "768 MiB");
  assertStringIncludes(ownerHtml, 'value="25"');
  assertFalse(ownerHtml.includes("secret-person"));
  assertFalse(ownerHtml.includes("10 GiB"));
  assertFalse(ownerHtml.includes('name="quotaGiB"'));
  const people = await apps.admin.fetch(request("/people", "admin@example.test"));
  const peopleHtml = await people.text();
  assertStringIncludes(peopleHtml, "256 MiB");
  assertStringIncludes(peopleHtml, "768 MiB");
  assertStringIncludes(peopleHtml, 'name="quotaGiB"');
});

test("quota changes accept GiB fractions and unlimited, reject malformed input, and require admin CSRF", async () => {
  const apps = fixture();
  const get = await apps.admin.fetch(request("/people/alice", "admin@example.test"));
  const cookie = token(get);
  const csrf = cookie.split("=").slice(1).join("=");
  const send = (value: string, withCsrf = true) =>
    apps.admin.fetch(
      request("/people/alice/quota", "admin@example.test", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: configuration.PUBLIC_ADMIN_URL,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ quotaGiB: value, ...(withCsrf ? { csrf } : {}) }),
      }),
    );
  assertEquals((await send("2", false)).status, 403);
  for (const value of [
    "-1",
    "NaN",
    "1e3",
    "1.123456789012345678901",
    "9007199254740991",
    "0.00000000000000000001",
  ]) {
    assertEquals((await send(value)).status, 400);
  }
  assertEquals(apps.quotaChanges.length, 0);
  const response = await send("2.125");
  assertEquals(response.status, 303);
  assertEquals(response.headers.get("location"), "/people/alice?done=saved");
  assertEquals(apps.quotaChanges[0], {
    actor: "admin@example.test",
    id: "alice",
    limitBytes: 2.125 * 1024 ** 3,
  });
  assertEquals((await send("0")).status, 303);
  assertEquals(apps.quotaChanges[1].limitBytes, null);
  assertEquals((await send("")).status, 303);
  assertEquals(apps.quotaChanges[2].limitBytes, null);
  assertEquals(
    (await apps.owner.fetch(request("/people/alice/quota", person.tailscaleLogin))).status,
    404,
  );
});

test("owner quota is translated and clamps over-limit progress without negative remaining space", async () => {
  const apps = fixture("active", { usedBytes: 2 * 1024 ** 3 });
  const response = await apps.owner.fetch(
    request("/", person.tailscaleLogin, { headers: { Cookie: "panel_locale=es" } }),
  );
  const html = await response.text();
  assertStringIncludes(html, "Tu cuota de espacio");
  assertStringIncludes(html, "0 B");
  assertStringIncludes(html, 'value="100"');
  assertStringIncludes(html, "Se ha alcanzado el límite de espacio");
  assertStringIncludes(
    html,
    "El espacio disponible también depende de la capacidad de la instancia",
  );
  const unlimited = fixture("active", { quotaBytes: null });
  const unlimitedHtml = await (
    await unlimited.owner.fetch(request("/", person.tailscaleLogin))
  ).text();
  assertStringIncludes(unlimitedHtml, "Unlimited");
  assertFalse(unlimitedHtml.includes("<progress"));
});

test("quota editor preserves exact byte limits, including quotas below one MiB", () => {
  for (const bytes of [1, 4096, 1_234_567, 1024 ** 3, Number.MAX_SAFE_INTEGER]) {
    const html = quotaField(
      {
        locale: "en",
        csrf: "",
        surface: "admin",
        actor: "",
        path: "/people/alice",
      },
      bytes,
    );
    const value = html.match(/value="([\d.]+)"/)?.[1];
    assert(value);
    assertEquals(parseQuota({ quotaGiB: value }), bytes);
    assertFalse(value === "0");
  }
});

test("Tailscale identity and apps prevent administrative access from owner portal", async () => {
  const { admin, owner } = fixture();
  assertEquals((await admin.fetch(request("/"))).status, 403);
  assertEquals((await admin.fetch(request("/", person.tailscaleLogin))).status, 403);
  assertEquals((await admin.fetch(request("/", "admin@example.test"))).status, 200);
  assertEquals(
    (await admin.fetch(request("/", "admin@example.test,alice@example.test"))).status,
    403,
  );
  assertEquals((await owner.fetch(request("/people", person.tailscaleLogin))).status, 404);
  // The owner portal ignores the Tailscale identity: without a session it asks for sign-in.
  const header = await owner.fetch(request("/", "admin@example.test"));
  assertEquals([header.status, header.headers.get("Location")], [303, "/login"]);
});
test("disabled and onboarding identities cannot obtain vault metadata", async () => {
  for (const status of ["disabled", "pending_credentials"] as const) {
    const owner = fixture(status).owner;
    const home = await owner.fetch(request("/", person.tailscaleLogin));
    assertEquals([home.status, home.headers.get("Location")], [303, "/login"]);
    assertEquals(
      (await owner.fetch(request("/vaults/owned/setup-metadata", person.tailscaleLogin))).status,
      401,
    );
  }
});
test("resource IDs cannot reveal another person's setup", async () => {
  const { owner } = fixture();
  assertEquals(
    (await owner.fetch(request("/vaults/owned/setup-metadata", person.tailscaleLogin))).status,
    200,
  );
  assertEquals(
    (await owner.fetch(request("/vaults/other/setup-metadata", person.tailscaleLogin))).status,
    404,
  );
  assertEquals(
    (await owner.fetch(request("/vaults/other/setup", person.tailscaleLogin))).status,
    404,
  );
});
test("metadata fetch preserves the browser CSRF token used to audit URI issuance", async () => {
  const { owner } = fixture();
  const page = await owner.fetch(request("/vaults/owned/setup", person.tailscaleLogin));
  const cookie = token(page);
  const csrf = cookie.split("=").slice(1).join("=");
  const metadata = await owner.fetch(
    request("/vaults/owned/setup-metadata", person.tailscaleLogin, { headers: { Cookie: cookie } }),
  );
  assertEquals(token(metadata), cookie);
  const issued = await owner.fetch(
    request("/vaults/owned/uri-issued", person.tailscaleLogin, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: configuration.PUBLIC_SETUP_URL,
        "X-CSRF-Token": csrf,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "",
    }),
  );
  assertEquals(issued.status, 200);
  assertEquals(await issued.json(), { instruction: "new" });
});
test("CSRF tokens bind exact actor and surface and expire", async () => {
  const csrf = new Csrf(configuration.PANEL_CSRF_SECRET, SESSION_MAX_MS);
  const issued = await csrf.issue("alice", "owner");
  assert(await csrf.verify(issued, "alice", "owner"));
  assertFalse(await csrf.verify(issued, "bob", "owner"));
  assertFalse(await csrf.verify(issued, "alice", "admin"));
  assertFalse(await csrf.verify(issued.replace(/^\d+/, "1"), "alice", "owner"));
});

test("setup metadata reports an expired session on long-open setup pages", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const apps = fixture();
  const cookie = token(
    await apps.owner.fetch(request("/vaults/owned/setup", person.tailscaleLogin)),
  );
  // Form tokens last as long as the longest session, so the session runs out first.
  t.mock.timers.tick(SESSION_MAX_MS + 1);
  const metadata = await apps.owner.fetch(
    request("/vaults/owned/setup-metadata", person.tailscaleLogin, {
      headers: { Cookie: cookie },
    }),
  );
  assertEquals(metadata.status, 401);
  assertEquals(await metadata.json(), { error: "session_expired" });
});
test("writes require matching cookie token and exact origin including port", async () => {
  const apps = fixture();
  const get = await apps.owner.fetch(request("/password", person.tailscaleLogin));
  const cookie = token(get);
  const csrf = cookie.split("=").slice(1).join("=");
  const body = new URLSearchParams({
    csrf,
    currentPassword: "previous-test-password",
    password: "strong-test-password",
    confirmPassword: "strong-test-password",
  });
  const headers = {
    Cookie: cookie,
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: configuration.PUBLIC_SETUP_URL,
  };
  assertEquals(
    (
      await apps.owner.fetch(
        request("/password", person.tailscaleLogin, {
          method: "POST",
          headers: { ...headers, Origin: configuration.PUBLIC_ADMIN_URL },
          body,
        }),
      )
    ).status,
    403,
  );
  assertEquals(
    (
      await apps.owner.fetch(
        request("/password", person.tailscaleLogin, {
          method: "POST",
          headers,
          body: new URLSearchParams({ password: "strong-test-password" }),
        }),
      )
    ).status,
    403,
  );
  const changed = await apps.owner.fetch(
    request("/password", person.tailscaleLogin, { method: "POST", headers, body }),
  );
  assertEquals(changed.status, 303);
  assertEquals(apps.savedPassword(), "strong-test-password");
  assertFalse((await changed.text()).includes("strong-test-password"));
});

test("rejected cross-origin writes cannot exhaust a victim's password rate limit", async () => {
  const apps = fixture();
  const cookie = token(await apps.owner.fetch(request("/password", person.tailscaleLogin)));
  const body = new URLSearchParams({
    csrf: cookie.split("=").slice(1).join("="),
    currentPassword: "previous-test-password",
    password: "strong-test-password",
    confirmPassword: "strong-test-password",
  });
  const headers = {
    Cookie: cookie,
    Origin: configuration.PUBLIC_SETUP_URL,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  for (let attempt = 0; attempt < 6; attempt++) {
    assertEquals(
      (
        await apps.owner.fetch(
          request("/password", person.tailscaleLogin, {
            method: "POST",
            headers: { ...headers, Origin: "https://attacker.example" },
            body,
          }),
        )
      ).status,
      403,
    );
  }
  assertEquals(
    (
      await apps.owner.fetch(
        request("/password", person.tailscaleLogin, {
          method: "POST",
          headers,
          body,
        }),
      )
    ).status,
    303,
  );
});

test("form MIME types require an exact match", async () => {
  const apps = fixture();
  const cookie = token(await apps.owner.fetch(request("/password", person.tailscaleLogin)));
  const response = await apps.owner.fetch(
    request("/password", person.tailscaleLogin, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: configuration.PUBLIC_SETUP_URL,
        "Content-Type": "application/x-www-form-urlencoded-invalid",
      },
      body: new URLSearchParams({
        csrf: cookie.split("=").slice(1).join("="),
        password: "strong-test-password",
        confirmPassword: "strong-test-password",
      }),
    }),
  );
  assertEquals(response.status, 415);
  assertEquals(apps.savedPassword(), "");
});
test("setup secret fields have no name, no submit action and no history cache", async () => {
  const response = await fixture().owner.fetch(
    request("/vaults/owned/setup", person.tailscaleLogin),
  );
  const html = await response.text();
  assertStringIncludes(html, 'id="setup-form"');
  for (const id of ["setup-password", "setup-e2e", "setup-e2e-confirm", "setup-uri-passphrase"]) {
    const input = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))![0];
    assertFalse(input.includes("name="));
  }
  assertFalse(html.match(/<form id="setup-form"[^>]*>/)![0].includes("action="));
  assertStringIncludes(html, "hx-disable");
  assertStringIncludes(html, '"historyCacheSize":0');
  assertStringIncludes(response.headers.get("content-security-policy")!, "script-src 'self'");
  assertEquals(response.headers.get("cache-control"), "no-store");
});
test("HTML escapes vault labels and health endpoints are independent of identity", async () => {
  const { owner } = fixture();
  const response = await owner.fetch(request("/", person.tailscaleLogin));
  assertStringIncludes(await response.text(), "&lt;script&gt;oops&lt;/script&gt;");
  assertEquals((await owner.fetch(request("/health/live"))).status, 200);
  assertEquals((await owner.fetch(request("/health/ready"))).status, 200);
});
test("English defaults and Spanish preference localizes backend views", async () => {
  const { owner } = fixture();
  assertStringIncludes(
    await (await owner.fetch(request("/", person.tailscaleLogin))).text(),
    '<html lang="en">',
  );
  const response = await owner.fetch(
    request("/", person.tailscaleLogin, { headers: { Cookie: "panel_locale=es" } }),
  );
  const html = await response.text();
  assertStringIncludes(html, '<html lang="es">');
  assertStringIncludes(html, "Tus vaults");
});
test("configuration preserves credentials and rejects unsafe public and remote URLs", () => {
  assertEquals(
    loadConfig({ ...configuration, COUCHDB_ADMIN_PASSWORD: " space sensitive " }).couchdbPassword,
    " space sensitive ",
  );
  assertEquals(
    loadConfig({ ...configuration, COUCHDB_PASSWORD: " space sensitive " }).couchdbPassword,
    " space sensitive ",
  );
  for (const url of [
    "http://notes.example.test:8443",
    "https://user:password@notes.example.test:8443",
    "https://notes.example.test:8443/path",
  ]) {
    assertThrows(() => loadConfig({ ...configuration, PUBLIC_ADMIN_URL: url }));
  }
  assertThrows(() => loadConfig({ ...configuration, COUCHDB_URL: "http://192.0.2.4:5984" }));
  assertThrows(() => loadConfig({ ...configuration, PANEL_CSRF_SECRET: "short" }));
  assertThrows(() =>
    loadConfig({ ...configuration, PUBLIC_SETUP_URL: configuration.PUBLIC_ADMIN_URL }),
  );
});
test("body limits reject oversized password forms before mutation", async () => {
  const apps = fixture("pending_credentials");
  const response = await apps.owner.fetch(
    request("/password", person.tailscaleLogin, { method: "POST", body: "x".repeat(32_769) }),
  );
  assertEquals(response.status, 413);
  assertEquals(apps.savedPassword(), "");
});

const backupId = "11111111-1111-4111-8111-111111111111";
function backupRun(outcome: BackupRun["outcome"]): BackupRun {
  return {
    requestId: backupId,
    actor: "admin@example.test",
    trigger: "manual",
    startedAt: new Date().toISOString(),
    endedAt: outcome === "running" ? null : new Date().toISOString(),
    outcome,
    file: null,
    sizeBytes: 42,
    error: outcome === "failure" ? "upload_failed" : null,
    uploadOk: outcome === "success",
    retentionOk: outcome === "success",
    notificationOk: outcome === "success",
  };
}
function backupState(run?: BackupRun): BackupStatus {
  return {
    schemaVersion: 1,
    running: run?.outcome === "running" ? run : null,
    lastAttempt: run ?? null,
    lastSuccess: run?.outcome === "success" ? run : null,
    history: run ? [run] : [],
    schedule: "0 3 * * *",
    timezone: "Europe/Madrid",
    retentionDays: 30,
  };
}
test("backup polling correlates pending, running, success and failure by request ID", async () => {
  let state: BackupStatus = backupState();
  const { admin } = fixture("active", {
    backup: {
      status() {
        return Promise.resolve(state);
      },
      request() {
        return Promise.resolve({ requestId: backupId });
      },
    },
  });
  const first = await admin.fetch(request(`/backups?requestId=${backupId}`, "admin@example.test"));
  const cookie = token(first);
  const pending = await first.text();
  assertStringIncludes(pending, "Pending");
  assertStringIncludes(pending, 'hx-trigger="every 5s"');
  for (const outcome of ["running", "success", "failure"] as const) {
    state = backupState(backupRun(outcome));
    const response = await admin.fetch(
      request(`/backups/status?requestId=${backupId}`, "admin@example.test", {
        headers: { Cookie: cookie },
      }),
    );
    assertEquals(token(response), cookie);
    assertEquals(response.status, 200);
    const html = await response.text();
    assertStringIncludes(html, backupId);
    assertStringIncludes(
      html,
      outcome === "running" ? "Running" : outcome === "success" ? "Success" : "Failed",
    );
    assertStringIncludes(html, "42 B");
    assertStringIncludes(html, "Europe/Madrid");
    if (outcome === "failure") assertStringIncludes(html, "Encrypted archive upload failed.");
    assertStringIncludes(html, `hx-trigger="every ${outcome === "running" ? 5 : 60}s"`);
  }
  state = backupState({
    ...backupRun("success"),
    requestId: "22222222-2222-4222-8222-222222222222",
  });
  const unrelated = await admin.fetch(
    request(`/backups/status?requestId=${backupId}`, "admin@example.test"),
  );
  assertStringIncludes(await unrelated.text(), "Pending");
  assertEquals(
    (await admin.fetch(request("/backups/status?requestId=invalid", "admin@example.test"))).status,
    400,
  );
  assertEquals(
    (await fixture().owner.fetch(request("/backups/status", person.tailscaleLogin))).status,
    503,
  );
  assertEquals((await admin.fetch(request("/backups/status", person.tailscaleLogin))).status, 403);
});
test("backup dashboard warns on stale success and contains unreadable state without exposing errors", async () => {
  const stale = {
    ...backupRun("success"),
    endedAt: new Date(Date.now() - 27 * 3_600_000).toISOString(),
  };
  const staleApp = fixture("active", {
    backup: {
      status() {
        return Promise.resolve(backupState(stale));
      },
      request() {
        return Promise.resolve({ requestId: backupId });
      },
    },
  });
  const staleHtml = await (await staleApp.admin.fetch(request("/", "admin@example.test"))).text();
  assertStringIncludes(staleHtml, "older than the configured age limit");
  const broken = fixture("active", {
    backup: {
      status() {
        return Promise.reject(new Error("secret-worker-token"));
      },
      request() {
        return Promise.resolve({ requestId: backupId });
      },
    },
  });
  const response = await broken.admin.fetch(request("/", "admin@example.test"));
  assertEquals(response.status, 200);
  const html = await response.text();
  assertStringIncludes(html, "Backup status is unavailable.");
  assertFalse(html.includes("secret-worker-token"));
});
test("manual backup redirects to its correlation ID and never promises completion", async () => {
  const { admin } = fixture("active", {
    backup: {
      status() {
        return Promise.resolve(backupState());
      },
      request() {
        return Promise.resolve({ requestId: backupId });
      },
    },
  });
  const get = await admin.fetch(request("/backups", "admin@example.test"));
  const cookie = token(get);
  const csrf = cookie.split("=").slice(1).join("=");
  const response = await admin.fetch(
    request("/backups/request", "admin@example.test", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: configuration.PUBLIC_ADMIN_URL,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf }),
    }),
  );
  assertEquals(response.status, 303);
  assertEquals(response.headers.get("location"), `/backups?requestId=${backupId}`);
});
test("password failure uses a localized cause and never returns the submitted secrets", async () => {
  const { owner } = fixture("active", { passwordError: "invalid_credentials" });
  const get = await owner.fetch(
    request("/password", person.tailscaleLogin, { headers: { Cookie: "panel_locale=es" } }),
  );
  const cookie = token(get);
  const csrf = cookie.split("=").slice(1).join("=");
  const response = await owner.fetch(
    request("/password", person.tailscaleLogin, {
      method: "POST",
      headers: {
        Cookie: `${cookie}; panel_locale=es`,
        Origin: configuration.PUBLIC_SETUP_URL,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrf,
        currentPassword: "incorrect-secret",
        password: "new-secret-password",
        confirmPassword: "new-secret-password",
      }),
    }),
  );
  assertEquals(response.status, 403);
  const html = await response.text();
  assertStringIncludes(html, "La contraseña actual de sincronización es incorrecta.");
  assertFalse(html.includes("incorrect-secret"));
  assertFalse(html.includes("new-secret-password"));
  assertStringIncludes(html, 'name="currentPassword"');
});
test("manual restore guide is administrative and has no execution action", async () => {
  const { owner, admin } = fixture();
  assertEquals((await owner.fetch(request("/help/restore", person.tailscaleLogin))).status, 404);
  const response = await admin.fetch(request("/help/restore", "admin@example.test"));
  assertEquals(response.status, 200);
  const html = await response.text();
  assertStringIncludes(html, "This dashboard does not run restores.");
  assertFalse(html.includes('method="post"'));
});
test("compiled assets do not need Tailscale identity and do not expose arbitrary paths", async () => {
  const { owner } = fixture();
  const response = await owner.fetch(request("/assets/app.css"));
  assert([200, 404].includes(response.status));
  const favicon = await owner.fetch(request("/assets/favicon.svg"));
  assert([200, 404].includes(favicon.status));
  if (favicon.status === 200) assertEquals(favicon.headers.get("content-type"), "image/svg+xml");
  assertEquals((await owner.fetch(request("/assets/config.ts"))).status, 404);
  assertEquals((await owner.fetch(request("/assets/unknown.json"))).status, 404);
});
test("URI issuance returns fresh remote instructions after a state change", async () => {
  const apps = fixture();
  const response = await apps.owner.fetch(request("/vaults/owned/setup", person.tailscaleLogin));
  const cookie = token(response);
  const csrf = cookie.split("=").slice(1).join("=");
  const html = await response.text();
  assertStringIncludes(html, 'id="setup-instruction"');
  assertFalse(html.includes("Configure the first device, then initialize the remote"));
  apps.setInstruction("additional");
  const result = await apps.owner.fetch(
    request("/vaults/owned/uri-issued", person.tailscaleLogin, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: configuration.PUBLIC_SETUP_URL,
        "X-CSRF-Token": csrf,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "",
    }),
  );
  assertEquals(result.status, 200);
  assertEquals(await result.json(), { instruction: "additional" });
});
test("reconciliation requires administrative access and the exact database confirmation", async () => {
  const apps = fixture("active", { provisioning: true });
  const get = await apps.admin.fetch(request("/people/alice", "admin@example.test"));
  const cookie = token(get);
  const csrf = cookie.split("=").slice(1).join("=");
  const html = await get.text();
  assertStringIncludes(html, 'action="/vaults/owned/reconcile"');
  assertStringIncludes(
    html,
    "Check that this empty database was created by this dashboard operation.",
  );
  const send = (name: string) =>
    apps.admin.fetch(
      request("/vaults/owned/reconcile", "admin@example.test", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: configuration.PUBLIC_ADMIN_URL,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ csrf, confirmDatabase: name }),
      }),
    );
  assertEquals((await send(" alice_vault ")).status, 409);
  assertEquals(apps.reconciliations.length, 0);
  const reconciled = await send("alice_vault");
  assertEquals(
    [reconciled.status, reconciled.headers.get("Location")],
    [303, `/people/${person.id}?done=saved`],
  );
  assertEquals(apps.reconciliations, [["admin@example.test", "owned", "alice_vault"]]);
  const ownerPage = await apps.owner.fetch(request("/", person.tailscaleLogin));
  const ownerCookie = token(ownerPage);
  const ownerCsrf = ownerCookie.split("=").slice(1).join("=");
  const ownerResponse = await apps.owner.fetch(
    request("/vaults/owned/reconcile", person.tailscaleLogin, {
      method: "POST",
      headers: {
        Cookie: ownerCookie,
        Origin: configuration.PUBLIC_SETUP_URL,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf: ownerCsrf, confirmDatabase: "alice_vault" }),
    }),
  );
  assertEquals(ownerResponse.status, 404);
  assertEquals(apps.reconciliations.length, 1);
});
test("remote compatibility failures display a safe actionable message", async () => {
  for (const [code, expected] of [
    ["remote_version_missing", "no LiveSync version information"],
    ["remote_version_incompatible", "incompatible with this dashboard"],
    ["remote_requires_migration", "Complete it from an existing configured device"],
    ["remote_version_requires_migration", "Complete it from an existing configured device"],
  ]) {
    const response = await fixture("active", { setupError: code }).owner.fetch(
      request("/vaults/owned/setup", person.tailscaleLogin),
    );
    assertEquals(response.status, 409);
    assertStringIncludes(await response.text(), expected);
  }
});
test("queued backups retain their request ID when audit persistence fails", async () => {
  const { admin } = fixture("active", {
    auditError: true,
    backup: {
      status() {
        return Promise.resolve(backupState());
      },
      request() {
        return Promise.resolve({ requestId: backupId });
      },
    },
  });
  const get = await admin.fetch(request("/backups", "admin@example.test"));
  const cookie = token(get);
  const csrf = cookie.split("=").slice(1).join("=");
  const queued = await admin.fetch(
    request("/backups/request", "admin@example.test", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: configuration.PUBLIC_ADMIN_URL,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf }),
    }),
  );
  assertEquals(queued.status, 303);
  assertEquals(queued.headers.get("location"), `/backups?requestId=${backupId}&audit=unavailable`);
  const follow = await admin.fetch(
    request(queued.headers.get("location")!, "admin@example.test", { headers: { Cookie: cookie } }),
  );
  const html = await follow.text();
  assertStringIncludes(
    html,
    "The backup request is queued, but its audit entry could not be written.",
  );
  assertStringIncludes(html, backupId);
  assertFalse(html.includes("private-audit-error"));
});

test("personal backup routes use the authenticated owner and require CSRF on all mutations", async () => {
  const calls: string[] = [];
  const personal: PersonalBackupGateway = {
    async status(id) {
      calls.push(`status:${id}`);
      return {
        connected: false,
        folderId: null,
        recipient: "",
        retentionDays: 30,
        enabled: false,
        running: false,
        lastAttempt: null,
        lastSuccess: null,
        error: null,
      };
    },
    async settings(id) {
      calls.push(`settings:${id}`);
    },
    connect(id) {
      calls.push(`connect:${id}`);
      return {
        state: "browser-state",
        url: "https://accounts.google.com/o/oauth2/v2/auth?state=browser-state",
      };
    },
    async callback(id, state, cookie) {
      calls.push(`callback:${id}:${state}:${cookie}`);
    },
    async disconnect(id) {
      calls.push(`disconnect:${id}`);
    },
    async request(id) {
      calls.push(`request:${id}`);
    },
    async pickerSession(id) {
      calls.push(`picker:${id}`);
      return { accessToken: "access", apiKey: "api-key", appId: "123" };
    },
    async chooseFolder(id, folder) {
      calls.push(`folder:${id}:${folder}`);
    },
    async useDefaultFolder(id) {
      calls.push(`default:${id}`);
    },
  };
  const apps = fixture("active", { personalBackup: personal });
  const page = await apps.owner.fetch(
    request("/backups?personId=bob", person.tailscaleLogin, {
      headers: { cookie: "panel_locale=es" },
    }),
  );
  assertEquals(page.status, 200);
  assertStringIncludes(await page.text(), "Conectar mi Google Drive");
  assertEquals(calls, ["status:alice"]);
  const cookie = token(page);
  const csrf = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
  for (const path of [
    "/backups/settings",
    "/backups/google/connect",
    "/backups/google/disconnect",
    "/backups/request",
    "/backups/google/picker-session",
    "/backups/folder",
    "/backups/folder/default",
  ]) {
    const denied = await apps.owner.fetch(
      request(path, person.tailscaleLogin, {
        method: "POST",
        headers: { origin: configuration.PUBLIC_SETUP_URL },
      }),
    );
    assertEquals(denied.status, 403);
    const response = await apps.owner.fetch(
      request(path, person.tailscaleLogin, {
        method: "POST",
        headers: {
          origin: configuration.PUBLIC_SETUP_URL,
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          csrf,
          personId: "bob",
          recipient: "public",
          retentionDays: "30",
          folderId: "owned-folder",
        }),
      }),
    );
    assertEquals(
      response.status,
      (path.endsWith("connect") && !path.endsWith("disconnect")) || path.endsWith("picker-session")
        ? 200
        : 303,
    );
    if (path === "/backups/google/connect") {
      assertStringIncludes(response.headers.get("set-cookie")!, "SameSite=Lax");
      assertStringIncludes(await response.text(), 'href="https://accounts.google.com/');
    }
  }
  for (const action of ["settings", "connect", "disconnect", "request"])
    assert(calls.includes(`${action}:alice`));
  assertFalse(calls.some((call) => call.includes("bob")));
  assert(calls.includes("picker:alice"));
  assert(calls.includes("folder:alice:owned-folder"));
  assert(calls.includes("default:alice"));
  const connected = fixture("active", {
    personalBackup: {
      ...personal,
      async status(id) {
        return {
          ...(await personal.status(id)),
          connected: true,
          pickerAvailable: true,
          folderId: "owned-folder",
          folderName: '<script>alert("x")</script>',
        };
      },
    },
  });
  const connectedPage = await connected.owner.fetch(request("/backups", person.tailscaleLogin));
  const connectedHtml = await connectedPage.text();
  assertStringIncludes(connectedHtml, "&lt;script&gt;");
  assertFalse(connectedPage.headers.get("content-security-policy")!.includes("apis.google.com"));
  const pickerPage = await connected.owner.fetch(
    request("/backups/folder-picker", person.tailscaleLogin),
  );
  assertEquals(pickerPage.status, 200);
  assertStringIncludes(
    pickerPage.headers.get("content-security-policy")!,
    "frame-src https://docs.google.com",
  );
  assertEquals(pickerPage.headers.get("referrer-policy"), "strict-origin");
  assertStringIncludes(await pickerPage.text(), "/assets/drive-picker.js");
  const setupPage = await connected.owner.fetch(
    request("/vaults/owned/setup", person.tailscaleLogin),
  );
  assertFalse(setupPage.headers.get("content-security-policy")!.includes("apis.google.com"));
  assertFalse((await setupPage.text()).includes("drive-picker.js"));
  const recovery = await apps.owner.fetch(request("/backups/help", person.tailscaleLogin));
  const recoveryHtml = await recovery.text();
  assertEquals(recovery.status, 200);
  assertStringIncludes(recoveryHtml, "new_edits=false");
  assertStringIncludes(recoveryHtml, "age -d");
  // Only the sidebar's sign-out form posts.
  assertFalse(
    recoveryHtml.replace(/<form class="logout"[\s\S]*?<\/form>/, "").includes('method="post"'),
  );
  const callback = await apps.owner.fetch(
    request("/backups/google/callback?state=browser-state&code=code", person.tailscaleLogin, {
      headers: { cookie: "__Host-panel-google-state=browser-state" },
    }),
  );
  assertEquals(callback.status, 303);
  assert(calls.includes("callback:alice:browser-state:browser-state"));
  assertEquals(
    (
      await fixture("disabled", { personalBackup: personal }).owner.fetch(
        request("/backups", person.tailscaleLogin),
      )
    ).status,
    303,
  );
  assertEquals(
    (
      await fixture("pending_credentials", { personalBackup: personal }).owner.fetch(
        request("/backups", person.tailscaleLogin),
      )
    ).status,
    303,
  );
  assertStringIncludes(
    await (await fixture().owner.fetch(request("/backups", person.tailscaleLogin))).text(),
    "not configured",
  );
});
test("vaults without a recovery code offer registration instead of setup", async () => {
  const apps = fixture("active", { recoveryCode: null });
  const home = await apps.owner.fetch(request("/", person.tailscaleLogin));
  const ownerCookie = token(home);
  const ownerCsrf = ownerCookie.split("=").slice(1).join("=");
  const html = await home.text();
  assertFalse(html.includes('href="/vaults/owned/setup"'));
  assertStringIncludes(html, 'action="/vaults/owned/recovery"');
  assertStringIncludes(html, "This vault has no recovery code");
  const setup = await fixture("active", { setupError: "missing_recovery_code" }).owner.fetch(
    request("/vaults/owned/setup", person.tailscaleLogin),
  );
  assertEquals(setup.status, 303);
  assertEquals(setup.headers.get("location"), "/");
  const send = (code: string, path = "/vaults/owned/recovery") =>
    apps.owner.fetch(
      request(path, person.tailscaleLogin, {
        method: "POST",
        headers: {
          Cookie: ownerCookie,
          Origin: configuration.PUBLIC_SETUP_URL,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ csrf: ownerCsrf, idRecoveryCode: code }),
      }),
    );
  assertEquals((await send(" sls-id-v1:abc ")).status, 303);
  const conflict = await send("conflict");
  assertEquals(conflict.status, 409);
  assertStringIncludes(await conflict.text(), "already has a different recovery code");
  assertEquals((await send("sls-id-v1:abc", "/vaults/other/recovery")).status, 403);
  assertEquals(apps.recoveries, [[person.tailscaleLogin, "owned", "sls-id-v1:abc", true]]);

  const adminPage = await apps.admin.fetch(request("/people/alice", "admin@example.test"));
  const adminCookie = token(adminPage);
  assertStringIncludes(await adminPage.text(), 'action="/people/alice/vaults/owned/recovery"');
  const admin = await apps.admin.fetch(
    request("/people/alice/vaults/owned/recovery", "admin@example.test", {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        Origin: configuration.PUBLIC_ADMIN_URL,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrf: adminCookie.split("=").slice(1).join("="),
        idRecoveryCode: "sls-id-v1:def",
      }),
    }),
  );
  assertEquals(admin.status, 303);
  assertEquals(admin.headers.get("location"), "/people/alice?done=saved");
  assertEquals(apps.recoveries[1], ["admin@example.test", "owned", "sls-id-v1:def", false]);
});

const ownerView = (locale: "en" | "es" = "en") =>
  ({ locale, csrf: "token", surface: "owner", actor: "a", path: "/backups" }) as const;
const driveStatus = (changes: Partial<PersonalBackupStatus> = {}): PersonalBackupStatus => ({
  connected: true,
  folderId: "folder",
  recipient: "age1",
  retentionDays: 30,
  enabled: true,
  running: false,
  lastAttempt: null,
  lastSuccess: null,
  error: null,
  ...changes,
});

test("personal backup status shows localized dates, causes and queued requests", () => {
  const view = ownerView("es");
  const status = driveStatus({
    lastAttempt: "2026-10-17T10:30:00.000Z",
    error: "backup_too_large",
  });
  const failed = personalBackupStatusPanel(view, status);
  assertStringIncludes(failed, "supera 1 GiB");
  assertStringIncludes(failed, "2026");
  assert(!failed.includes("2026-10-17T10:30"));
  assert(!failed.includes("backup_too_large"));
  assertStringIncludes(failed, 'hx-trigger="every 60s"');
  const queued = personalBackupStatusPanel(view, { ...status, error: null, queued: true });
  assertStringIncludes(queued, "otra persona");
  assert(!queued.includes('action="/backups/request"'));
  assertStringIncludes(
    personalBackupStatusPanel(view, { ...status, running: true }),
    'hx-trigger="every 5s"',
  );
});

test("missing pages and empty fields get their own messages", async () => {
  const apps = fixture("active");
  const missing = await apps.admin.fetch(request("/no-such-page", "admin@example.test"));
  assertEquals(missing.status, 404);
  assertStringIncludes(await missing.text(), "This page or item does not exist.");
  const get = await apps.admin.fetch(request("/people", "admin@example.test"));
  const cookie = token(get);
  const csrf = cookie.split("=").slice(1).join("=");
  const empty = await apps.admin.fetch(
    request("/people", "admin@example.test", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: configuration.PUBLIC_ADMIN_URL,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf, displayName: "Alice" }),
    }),
  );
  assertEquals(empty.status, 400);
  assertStringIncludes(await empty.text(), "Fill in every field.");
});

test("the overview shows vault sizes in binary units", async () => {
  const html = await (
    await fixture("active").admin.fetch(request("/", "admin@example.test"))
  ).text();
  assertStringIncludes(html, "5 MiB");
});

test("disabling, resetting and disconnecting ask for confirmation first", async () => {
  const html = await (
    await fixture("active").admin.fetch(request("/people/alice", "admin@example.test"))
  ).text();
  assertStringIncludes(html, 'hx-confirm="Disable this person?');
  assertStringIncludes(html, 'hx-confirm="Reset this person&#39;s password?');
  const drive = personalBackupPanel(ownerView(), driveStatus());
  assertStringIncludes(drive, 'hx-confirm="Disconnect Google Drive?');
  assertStringIncludes(drive, 'min="1" max="3650"');
});

test("pages embed browser messages for the current locale as inert JSON", async () => {
  const html = await (
    await fixture("active").owner.fetch(
      request("/", person.tailscaleLogin, { headers: { Cookie: "panel_locale=es" } }),
    )
  ).text();
  const json = /<script type="application\/json" id="client-text">(.*?)<\/script>/.exec(html)?.[1];
  assert(json);
  const messages = JSON.parse(json);
  assertEquals(messages.copied, "Copiado");
  assertEquals(messages.setupWorking, "Generando en este dispositivo…");
});

test("the setup page says when a repeated name opened an existing vault", async () => {
  const { owner } = fixture();
  const fetchSetup = async (query: string) =>
    (await owner.fetch(request(`/vaults/owned/setup${query}`, person.tailscaleLogin))).text();
  assertStringIncludes(await fetchSetup("?existing=1"), "You already had a vault with this name");
  assert(!(await fetchSetup("")).includes("You already had a vault with this name"));
});

test("setup separates credentials, explains every input and puts secret actions inside the control", async () => {
  const html = await (
    await fixture().owner.fetch(request("/vaults/owned/setup", person.tailscaleLogin))
  ).text();
  assertStringIncludes(html, 'class="setup-flow"');
  assertStringIncludes(html, 'class="secret-control"');
  assertStringIncludes(html, 'data-toggle-password="setup-password"');
  assertStringIncludes(html, 'aria-describedby="setup-password-help"');
  assertStringIncludes(html, 'role="tooltip"');
  assertStringIncludes(html, 'id="setup-connection"');
  assertStringIncludes(html, 'id="setup-import-steps"');
});

test("personal backups are stale only after the daily slot and two retries", () => {
  const panel = (hoursAgo: number) =>
    personalBackupStatusPanel(
      ownerView(),
      driveStatus({ lastSuccess: new Date(Date.now() - hoursAgo * 3_600_000).toISOString() }),
    );
  const stale = "The last successful backup is more than a day old";
  assert(!panel(25).includes(stale));
  assertStringIncludes(panel(27), stale);
});
