import { test } from "node:test";
import assert from "node:assert/strict";
import { CouchClient } from "../src/couchdb/client.ts";
import { CouchDashboardService, OWNER_VAULT_LIMIT } from "../src/domain/service.ts";
import { QuotaGateway } from "../src/quota/gateway.ts";
import { createApps } from "../src/web/apps.ts";
import { loadConfig } from "../src/config.ts";
import { generateSetup } from "../src/setup/generate.ts";
import { decodeSettingsFromSetupURI } from "@vrtmrz/livesync-commonlib/setup-uri";
import { assertDisposableFixture } from "./fixture.ts";
import { ownerCookie, withSession } from "./owner-login.ts";
import { OwnerSessions, SESSION_MAX_MS } from "../src/access/owner-session.ts";
import {
  DEFAULT_SETTINGS,
  DEVICE_ID_PREFERRED,
  type FilePathWithPrefix,
  MILESTONE_DOCID,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { TweakCompatibilityRules } from "@vrtmrz/livesync-commonlib/compat/common/models/tweak.definition";

test(
  "setup refuses credentials that would cause LiveSync 401; both URI modes replicate",
  { skip: !process.env.TEST_COUCHDB_URL },
  async () => {
    const url = process.env.TEST_COUCHDB_URL!;
    const user = process.env.TEST_COUCHDB_USER!;
    const password = process.env.TEST_COUCHDB_PASSWORD!;
    assertDisposableFixture(url, user, password);
    const client = new CouchClient(url, user, password);
    const prefix = `test_onboarding_${crypto.randomUUID().replaceAll("-", "")}`;
    const registry = `${prefix}_panel`;
    const database = `${prefix}_notes`;
    const login = `${prefix}@example.test`;
    const service = new CouchDashboardService(client, registry, "https://sync.example.test");
    const config = loadConfig({
      COUCHDB_URL: url,
      COUCHDB_USER: user,
      COUCHDB_PASSWORD: password,
      PUBLIC_COUCHDB_URL: "https://sync.example.test",
      PUBLIC_ADMIN_URL: "https://admin.example.test",
      PUBLIC_SETUP_URL: "https://owner.example.test",
      PANEL_ADMINS: "admin@example.test",
      PANEL_CSRF_SECRET: "test-secret-at-least-32-characters",
    });
    const apps = createApps({
      config,
      service,
      backup: { status: async () => null, request: async () => ({ requestId: "test" }) },
    });
    const secret = "actual-sync-password-long";
    let session = "";
    const request = (path: string, init?: RequestInit) =>
      apps.owner.fetch(
        new Request(`${config.ownerOrigin}${path}`, {
          ...init,
          headers: withSession(init?.headers, session),
        }),
      );
    try {
      await service.initialize();
      const person = await service.createPerson("admin@example.test", {
        couchUser: prefix,
        displayName: "Alice",
        tailscaleLogin: login,
        vaultLabel: "Notes",
        vaultSlug: database,
      });
      await service.setInitialPassword(login, secret);
      session = await ownerCookie(config.csrfSecret, service, prefix, secret);
      const vault = (await service.listVaults(person.id)).items[0];
      const response = await request(`/vaults/${vault.id}/setup`);
      const cookie = response.headers.get("set-cookie")!.split(";")[0];
      const csrf = decodeURIComponent(cookie.split("=")[1]);
      for (const [candidate, status] of [
        ["wrong-password-long", 401],
        [secret, 200],
      ] as const) {
        const verification = await request(`/vaults/${vault.id}/verify-credentials`, {
          method: "POST",
          headers: {
            cookie,
            Origin: config.ownerOrigin,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ csrf, password: candidate }),
        });
        assert.equal(verification.status, status);
      }
      type Milestone = {
        _id: string;
        _rev?: string;
        locked: boolean;
        tweak_values: Record<string, Record<string, unknown>>;
      };
      const seeded = await client.get<Milestone>(database, MILESTONE_DOCID);
      assert.ok(seeded?.tweak_values[DEVICE_ID_PREFERRED]);
      // A rebuild the sync account could not finish leaves the remote locked and unconfigured.
      await client.put(database, { ...seeded, locked: true, tweak_values: {} });
      const metadata = await service.getSetupMetadata(login, vault.id);
      assert.equal(metadata.instruction, "new");
      const milestone = await client.get<Milestone>(database, MILESTONE_DOCID);
      assert.equal(milestone?.locked, false);
      const gateway = new QuotaGateway(client, service.quotas, url, user, password);
      // LiveSync compares these keys to decide whether a device may join without a rebuild.
      const sample = await generateSetup(metadata, {
        password: secret,
        e2ePassphrase: "vault-encryption-secret",
      });
      const imported: Record<string, unknown> = {
        ...DEFAULT_SETTINGS,
        ...(await decodeSettingsFromSetupURI(sample.uri, sample.passphrase)),
      };
      for (const { key } of TweakCompatibilityRules) {
        assert.equal(milestone?.tweak_values[DEVICE_ID_PREFERRED][key], imported[key], key);
      }
      for (const mode of ["persistent", "ephemeral"] as const) {
        const generated = await generateSetup(metadata, {
          password: secret,
          e2ePassphrase: "vault-encryption-secret",
          mode,
        });
        const decoded = await decodeSettingsFromSetupURI(generated.uri, generated.passphrase);
        assert.ok(decoded);
        const authorization = `Basic ${Buffer.from(`${decoded.couchDB_USER}:${decoded.couchDB_PASSWORD}`).toString("base64")}`;
        const write = await gateway.fetch(
          new Request(`${decoded.couchDB_URI}/${decoded.couchDB_DBNAME}/${mode}`, {
            method: "PUT",
            headers: { authorization, "Content-Type": "application/json" },
            body: JSON.stringify({ text: mode }),
          }),
        );
        assert.equal(write.status, 201);
        const { DirectFileManipulator } = await import("@vrtmrz/livesync-commonlib");
        const options = {
          url: decoded.couchDB_URI,
          database: decoded.couchDB_DBNAME,
          username: decoded.couchDB_USER,
          password: decoded.couchDB_PASSWORD,
          passphrase: decoded.passphrase,
          obfuscatePassphrase: decoded.passphrase,
          idDerivationVersion: decoded.idDerivationVersion,
          idDerivationKey: decoded.idDerivationKey,
          E2EEAlgorithm: decoded.E2EEAlgorithm,
          encryptInternalMetadata: decoded.encryptInternalMetadata,
        };
        const transport = {
          fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
            gateway.fetch(new Request(input, init)),
        };
        const writer = new DirectFileManipulator(options, transport);
        const reader = new DirectFileManipulator(options, transport);
        try {
          await Promise.all([writer.ready.promise, reader.ready.promise]);
          const path = `${mode}-encrypted-note.md` as FilePathWithPrefix;
          const content = `Private LiveSync text for ${mode}`;
          assert.equal(
            await writer.put(path, [content], { ctime: 1, mtime: 1, size: content.length }),
            true,
          );
          const loaded = await reader.get(path);
          assert.ok(loaded);
          assert.equal(
            typeof loaded.data === "string" ? loaded.data : loaded.data.join(""),
            content,
          );
          const raw = await client.request<{ rows: unknown[] }>(
            `${database}/_all_docs?include_docs=true`,
          );
          assert.equal(JSON.stringify(raw).includes(content), false);
          assert.equal(JSON.stringify(raw).includes(path), false);
          assert.equal(await writer.delete(path), true);
        } finally {
          await Promise.all([writer.close(), reader.close()]);
        }
      }
      // LiveSync's rebuild deletes the remote and creates it again with the sync account.
      const rebuilding = new QuotaGateway(client, service.quotas, url, user, password, (name, db) =>
        service.resetVaultDatabase(name, db),
      );
      const owner = `Basic ${Buffer.from(`${prefix}:${secret}`).toString("base64")}`;
      const sync = (path: string, method = "GET", body?: unknown) =>
        rebuilding.fetch(
          new Request(`https://sync.example.test/${path}`, {
            method,
            headers: { authorization: owner, "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        );
      assert.equal((await sync(`${database}/before-rebuild`, "PUT", { text: "old" })).status, 201);
      assert.equal((await sync(database, "DELETE")).status, 200);
      assert.equal((await sync(database, "PUT")).status, 412);
      assert.equal((await sync(`${database}/before-rebuild`)).status, 404);
      assert.ok(await client.get(database, "obsydian_livesync_version"));
      const security = await client.security(database);
      assert.deepEqual(security.members.names, [prefix]);
      assert.equal((await sync(`${database}/after-rebuild`, "PUT", { text: "new" })).status, 201);
      const outsider = new QuotaGateway(client, service.quotas, url, user, password, () =>
        Promise.reject(new Error("must not reset")),
      );
      const anonymous = await outsider.fetch(
        new Request(`https://sync.example.test/${database}`, { method: "DELETE" }),
      );
      assert.equal(anonymous.status, 401);
    } finally {
      for (const db of [database, registry])
        await client.request(encodeURIComponent(db), "DELETE").catch(() => {});
      const account = await client.get<{ _rev: string }>("_users", `org.couchdb.user:${prefix}`);
      if (account)
        await client.request(
          `_users/${encodeURIComponent(`org.couchdb.user:${prefix}`)}?rev=${account._rev}`,
          "DELETE",
        );
    }
  },
);

test(
  "password accounts, one-use invitations and owner vaults stay isolated on a shared tailnet",
  { skip: !process.env.TEST_COUCHDB_URL },
  async (t) => {
    const url = process.env.TEST_COUCHDB_URL!;
    const user = process.env.TEST_COUCHDB_USER!;
    const password = process.env.TEST_COUCHDB_PASSWORD!;
    assertDisposableFixture(url, user, password);
    const client = new CouchClient(url, user, password);
    const prefix = `test_accounts_${crypto.randomUUID().replaceAll("-", "")}`;
    const registry = `${prefix}_panel`;
    const service = new CouchDashboardService(client, registry, "https://sync.example.test");
    const config = loadConfig({
      COUCHDB_URL: url,
      COUCHDB_USER: user,
      COUCHDB_PASSWORD: password,
      PUBLIC_COUCHDB_URL: "https://sync.example.test",
      PUBLIC_ADMIN_URL: "https://admin.example.test",
      PUBLIC_SETUP_URL: "https://owner.example.test",
      PANEL_ADMINS: "admin@example.test",
      PANEL_CSRF_SECRET: "test-secret-at-least-32-characters",
    });
    const sessions = new OwnerSessions(config.csrfSecret, service);
    const apps = createApps({
      config,
      service,
      backup: { status: async () => null, request: async () => ({ requestId: "test" }) },
    });
    const secret = "account-password-long-enough";
    const accounts: string[] = [];
    const databases: string[] = [];
    const request = (
      path: string,
      cookie = "",
      method = "GET",
      fields?: Record<string, string>,
      extra: Record<string, string> = {},
    ) =>
      apps.owner.fetch(
        new Request(`${config.ownerOrigin}${path}`, {
          method,
          headers: {
            cookie,
            "Tailscale-User-Login": "shared@example.test",
            ...(method === "POST"
              ? { Origin: config.ownerOrigin, "Content-Type": "application/x-www-form-urlencoded" }
              : {}),
            ...extra,
          },
          body: fields ? new URLSearchParams(fields) : undefined,
        }),
      );
    const cookies = (response: Response) =>
      response.headers.getSetCookie().map((value) => value.split(";")[0]);
    const csrfValue = (cookie: string) => decodeURIComponent(cookie.split("=")[1]);
    try {
      await service.initialize();
      const person = await service.createPerson("admin@example.test", {
        couchUser: `${prefix}_alice`,
        displayName: "Alice",
        tailscaleLogin: "alice",
      });
      accounts.push(person.couchUser);
      assert.equal((await service.listVaults(person.id)).items.length, 0);
      assert.equal(
        (
          await service.createPerson("admin@example.test", {
            couchUser: person.couchUser,
            displayName: "Alice",
            tailscaleLogin: "alice",
          })
        ).id,
        person.id,
      );
      assert.equal((await request("/")).status, 303);
      assert.equal((await request("/vaults/foreign/setup-metadata")).status, 401);
      const invitation = await service.issueInvitation("admin@example.test", person.id);
      const replacement = await service.issueInvitation("admin@example.test", person.id);
      await assert.rejects(() => service.acceptInvitation(invitation, secret), {
        message: "invalid_invitation",
      });
      const activation = await request("/activate");
      const anonymousCsrf = cookies(activation)[0];
      const fields = {
        csrf: csrfValue(anonymousCsrf),
        invitation: replacement,
        password: secret,
        confirmPassword: secret,
      };
      assert.equal(
        (
          await request("/activate", anonymousCsrf, "POST", fields, {
            Origin: "https://evil.example.test",
          })
        ).status,
        403,
      );
      const accepted = await request("/activate", anonymousCsrf, "POST", fields);
      assert.equal(accepted.status, 303);
      const ownerCookie = cookies(accepted).find((value) =>
        value.startsWith("__Host-panel-session="),
      )!;
      assert.ok(ownerCookie);
      await assert.rejects(() => service.acceptInvitation(replacement, secret), {
        message: "invalid_invitation",
      });
      const home = await request("/", ownerCookie);
      assert.equal(home.status, 200);
      assert.match(await home.text(), /action="\/vaults"/);
      const csrfCookie = cookies(home)[0];
      const cookie = `${ownerCookie}; ${csrfCookie}`;
      const created = await request("/vaults", cookie, "POST", {
        csrf: csrfValue(csrfCookie),
        label: "My notes",
        personId: "foreign",
        slug: "foreign",
      });
      assert.equal(created.status, 303);
      const vault = (await service.listVaults(person.id)).items[0];
      databases.push(vault.db);
      assert.equal(vault.label, "My notes");
      assert.equal(vault.personId, person.id);
      assert.notEqual(vault.db, "foreign");
      assert.equal((await service.createOwnedVault("alice", "My notes")).id, vault.id);
      assert.equal((await service.listVaults(person.id)).items.length, 1);
      for (let index = 1; index < OWNER_VAULT_LIMIT; index++)
        databases.push((await service.createOwnedVault("alice", `Notes ${index}`)).db);
      await assert.rejects(() => service.createOwnedVault("alice", "One too many"), {
        message: "vault_limit_reached",
      });
      assert.equal((await service.createOwnedVault("alice", "My notes")).id, vault.id);
      assert.equal(created.headers.get("location"), `/vaults/${vault.id}/setup`);
      const repeated = await request("/vaults", cookie, "POST", {
        csrf: csrfValue(csrfCookie),
        label: "My notes",
      });
      assert.equal(repeated.headers.get("location"), `/vaults/${vault.id}/setup?existing=1`);
      const other = await service.createPerson("admin@example.test", {
        couchUser: `${prefix}_bob`,
        displayName: "Bob",
        tailscaleLogin: "bob",
      });
      accounts.push(other.couchUser);
      const otherSession = await service.acceptInvitation(
        await service.issueInvitation("admin@example.test", other.id),
        secret,
      );
      const otherCookie = `__Host-panel-session=${await sessions.issue(otherSession)}`;
      assert.equal((await request(`/vaults/${vault.id}/setup-metadata`, otherCookie)).status, 403);
      assert.equal(
        (
          await apps.admin.fetch(
            new Request(`${config.adminOrigin}/`, {
              headers: { cookie, "Tailscale-User-Login": "shared@example.test" },
            }),
          )
        ).status,
        403,
      );
      assert.equal(await sessions.verify(`${ownerCookie.split("=")[1]}tampered`), null);
      await assert.rejects(() => service.loginOwner(person.couchUser, "wrong-password"), {
        message: "invalid_credentials",
      });
      const loggedIn = await service.loginOwner(person.couchUser, secret);
      const signed = await sessions.issue(loggedIn);
      const now = Date.now();
      t.mock.method(Date, "now", () => now + 3_600_001);
      assert.equal(await sessions.verify(signed), null);
      t.mock.restoreAll();
      // Activity renews the cookie, so a session stays open past the idle hour.
      t.mock.method(Date, "now", () => now + 11 * 60_000);
      const active = await sessions.verify(signed);
      assert.ok(active?.renewed);
      t.mock.method(Date, "now", () => now + 70 * 60_000);
      assert.equal((await sessions.verify(active.renewed))?.person.id, person.id);
      t.mock.restoreAll();
      assert.equal(
        await sessions.verify(await sessions.issue(loggedIn, now - SESSION_MAX_MS)),
        null,
      );
      await service.changePassword("alice", secret, `${secret}-new`);
      assert.equal(await sessions.verify(signed), null);
      const changed = await sessions.issue(
        await service.loginOwner(person.couchUser, `${secret}-new`),
      );
      await service.setPersonEnabled("admin@example.test", person.id, false);
      assert.equal(await sessions.verify(changed), null);
      await service.setPersonEnabled("admin@example.test", person.id, true);
      assert.equal(await sessions.verify(changed), null);
      const renewed = await sessions.issue(
        await service.loginOwner(person.couchUser, `${secret}-new`),
      );
      await service.resetPassword("admin@example.test", person.id);
      assert.equal(await sessions.verify(renewed), null);
      await assert.rejects(() => service.loginOwner(person.couchUser, `${secret}-new`), {
        message: "invalid_credentials",
      });
      const recovered = await service.acceptInvitation(
        await service.issueInvitation("admin@example.test", person.id),
        secret,
      );
      const recoveredCookie = `__Host-panel-session=${await sessions.issue(recovered)}`;
      const recoveredHome = await request("/", recoveredCookie);
      const recoveredCsrf = cookies(recoveredHome)[0];
      assert.equal(
        (
          await request("/logout", `${recoveredCookie}; ${recoveredCsrf}`, "POST", {
            csrf: csrfValue(recoveredCsrf),
          })
        ).status,
        303,
      );
      assert.equal((await request("/", recoveredCookie)).status, 303);
      const login = await request("/login");
      const loginCsrf = cookies(login)[0];
      const response = await request("/login", loginCsrf, "POST", {
        csrf: csrfValue(loginCsrf),
        username: person.couchUser,
        password: secret,
      });
      assert.equal(response.status, 303);
      assert.ok(cookies(response).some((value) => value.startsWith("__Host-panel-session=")));
      for (let attempt = 0; attempt < 4; attempt++) {
        assert.equal(
          (
            await request("/login", loginCsrf, "POST", {
              csrf: csrfValue(loginCsrf),
              username: person.couchUser,
              password: "wrong-password",
            })
          ).status,
          401,
        );
      }
      assert.equal(
        (
          await request("/login", loginCsrf, "POST", {
            csrf: csrfValue(loginCsrf),
            username: ` ${person.couchUser} `,
            password: secret,
          })
        ).status,
        429,
      );
      assert.equal(
        (
          await request("/login", loginCsrf, "POST", {
            csrf: csrfValue(loginCsrf),
            username: other.couchUser,
            password: secret,
          })
        ).status,
        303,
      );

      const pending = await service.createPerson("admin@example.test", {
        couchUser: `${prefix}_expired`,
        displayName: "Expired",
        tailscaleLogin: "expired",
      });
      accounts.push(pending.couchUser);
      const expired = await service.issueInvitation("admin@example.test", pending.id);
      const stored = await client.get<import("../src/couchdb/client.ts").CouchDocument>(
        registry,
        `person:${pending.id}`,
      );
      assert.ok(stored);
      (stored.invitation as { expires: number }).expires = Date.now() - 1;
      await client.put(registry, stored);
      await assert.rejects(() => service.acceptInvitation(expired, secret), {
        message: "invalid_invitation",
      });
    } finally {
      for (const db of [...databases, registry])
        await client.request(encodeURIComponent(db), "DELETE").catch(() => {});
      for (const username of accounts) {
        const account = await client.get<{ _rev: string }>(
          "_users",
          `org.couchdb.user:${username}`,
        );
        if (account)
          await client.request(
            `_users/${encodeURIComponent(`org.couchdb.user:${username}`)}?rev=${account._rev}`,
            "DELETE",
          );
      }
    }
  },
);
