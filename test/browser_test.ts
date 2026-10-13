import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { testServer } from "./server.ts";
import { test } from "node:test";
import { assertEquals, assertExists } from "./assert.ts";
import { decodeSettingsFromSetupURI } from "@vrtmrz/livesync-commonlib/setup-uri";
import { CouchClient, type CouchDocument } from "../src/couchdb/client.ts";
import { assertDisposableFixture } from "./fixture.ts";
import { QuotaGateway } from "../src/quota/gateway.ts";
import { CouchDashboardService } from "../src/domain/service.ts";
import { PersonalBackups } from "../src/backup/personal.ts";
import { GoogleDrive, TokenCipher, DRIVE_FOLDER } from "../src/backup/drive.ts";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { encrypt } from "octagonal-wheels/encryption/hkdf";
import { createApps } from "../src/web/apps.ts";
import type { AppConfig } from "../src/config.ts";

async function temporaryCertificate(): Promise<{ cert: string; key: string }> {
  const generated = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--network=none",
      "--entrypoint",
      "sh",
      "couchdb:3.5.2",
      "-c",
      "openssl req -x509 -newkey rsa:2048 -sha256 -days 1 -nodes -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 -keyout /tmp/test-key.pem -out /tmp/test-cert.pem >/dev/null 2>&1 && cat /tmp/test-key.pem /tmp/test-cert.pem",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  if (generated.error || generated.status !== 0)
    throw new Error("Could not generate isolated test TLS certificate");
  const output = generated.stdout;
  const key = output.match(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/)?.[0];
  const cert = output.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];
  if (!key || !cert) throw new Error("Invalid test certificate output");
  return { cert, key };
}

test(
  "shared-tailnet accounts create their vaults and export working setup in both modes",
  { skip: process.env.RUN_BROWSER_TESTS !== "1" },
  async (t) => {
    const { chromium, firefox, webkit } = await import("@playwright/test");
    const url = process.env.TEST_COUCHDB_URL!;
    const username = process.env.TEST_COUCHDB_USER!;
    const password = process.env.TEST_COUCHDB_PASSWORD!;
    assertDisposableFixture(url, username, password);
    const client = new CouchClient(url, username, password);
    const tls = await temporaryCertificate();
    for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
      if (process.env.BROWSER_ENGINES && !process.env.BROWSER_ENGINES.split(",").includes(name))
        continue;
      await t.test(name, async () => {
        const prefix = `test_account_browser_${crypto.randomUUID().replaceAll("-", "")}`;
        const registry = `${prefix}_panel`;
        let apps: ReturnType<typeof createApps>;
        const requests: string[] = [];
        const server = async (surface: "admin" | "owner") =>
          testServer(async (request) => {
            const headers = new Headers(request.headers);
            headers.set(
              "Tailscale-User-Login",
              surface === "admin" ? "admin@example.test" : "shared@example.test",
            );
            requests.push(`${request.method} ${request.url} ${await request.clone().text()}`);
            return apps[surface].fetch(new Request(request.clone(), { headers }));
          }, tls);
        const admin = await server("admin");
        const owner = await server("owner");
        const config: AppConfig = {
          couchdbUrl: url,
          couchdbUsername: username,
          couchdbPassword: password,
          publicCouchdbUrl: "https://sync.example.test",
          adminOrigin: `https://127.0.0.1:${admin.port}`,
          ownerOrigin: `https://127.0.0.1:${owner.port}`,
          admins: ["admin@example.test"],
          panelDb: registry,
          csrfSecret: "test-only-secret-at-least-32-characters",
          backupMaxAgeHours: 26,
        };
        const service = new CouchDashboardService(client, registry, config.publicCouchdbUrl);
        let browser: Awaited<ReturnType<typeof engine.launch>> | undefined;
        let database: string | undefined;
        try {
          await service.initialize();
          apps = createApps({
            config,
            service,
            backup: { status: async () => null, request: async () => ({ requestId: "test" }) },
          });
          browser = await engine.launch();
          const context = await browser.newContext({
            ignoreHTTPSErrors: true,
            acceptDownloads: true,
          });
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto(`${config.adminOrigin}/people`);
          const signup = page.locator('form[action="/people"]');
          const creation = page.locator("details.disclosure");
          if (!(await creation.evaluate((element) => (element as HTMLDetailsElement).open)))
            await creation.locator("summary").click();
          assertEquals(await signup.locator('[name="tailscaleLogin"]').count(), 0);
          assertEquals(await signup.locator('[name="vaultSlug"]').count(), 0);
          await signup.locator('[name="displayName"]').fill("Alice");
          await signup.locator('[name="couchUser"]').fill(prefix);
          await signup.locator('button[type="submit"]').click();
          await page.locator('form[action$="/invitation"] button[type="submit"]').click();
          const invitation = await page.locator("#invitation-link").inputValue();
          requests.length = 0;
          await page.goto(invitation);
          await page.waitForFunction(
            () => !!document.querySelector<HTMLInputElement>('[name="invitation"]')?.value,
          );
          assertEquals(
            requests.some((value) => value.includes(new URL(invitation).hash.slice(1))),
            false,
          );
          await page.locator('button[data-generate-name="password"]').click();
          const secret = await page.locator('[name="password"]').inputValue();
          assertEquals(secret.length, 48);
          assertEquals(await page.locator('[name="confirmPassword"]').inputValue(), secret);
          const accountDownload = page.waitForEvent("download");
          await page.locator("button[data-export-account]").click();
          const accountFile = await accountDownload;
          const accountText = await readFile((await accountFile.path())!, "utf8");
          assertEquals(accountText.includes(`Username: ${prefix}`), true);
          assertEquals(accountText.includes(secret), true);
          const activationPost = page.waitForRequest(
            (request) =>
              new URL(request.url()).pathname === "/activate" && request.method() === "POST",
          );
          await page.locator('form[action="/activate"] button[type="submit"]').click();
          assertEquals((await activationPost).headers().origin, config.ownerOrigin);
          await page.waitForURL(config.ownerOrigin + "/", { timeout: 5000 }).catch(async () => {
            throw new Error(
              `Owner navigation failed at ${new URL(page.url()).pathname}: ${(await page.locator("[role=status]").allTextContents()).join("; ")}`,
            );
          });
          const create = page.locator('form[action="/vaults"]');
          await create.locator('[name="label"]').fill("My notes");
          await create.locator('button[type="submit"]').click();
          await page.waitForSelector("#setup-form");
          const person = await service.findPersonByLogin(prefix);
          assertExists(person);
          const vault = (await service.listVaults(person.id)).items[0];
          database = vault.db;
          assertEquals(await page.locator("#setup-form .secret-control").count(), 4);
          const toggle = page.locator('button[data-toggle-password="setup-password"]');
          await toggle.click();
          assertEquals(await page.locator("#setup-password").getAttribute("type"), "text");
          assertEquals(await toggle.getAttribute("aria-pressed"), "true");
          await page.locator('.help-tip button[aria-describedby="setup-password-help"]').focus();
          assertEquals(await page.locator("#setup-password-help").isVisible(), true);
          if (name === "chromium") {
            const aligned = await page.evaluate(
              () =>
                Math.abs(
                  document.querySelector("#setup-username")!.getBoundingClientRect().top -
                    document.querySelector("#setup-database")!.getBoundingClientRect().top,
                ) < 2,
            );
            assertEquals(aligned, true);
            await page.screenshot({ path: ".local/setup-desktop.png", fullPage: true });
            await page.locator("#theme-select").selectOption("dark");
            await page.screenshot({ path: ".local/setup-dark.png", fullPage: true });
            await page.locator("#theme-select").selectOption("light");
            await page.setViewportSize({ width: 390, height: 844 });
            await page.screenshot({ path: ".local/setup-mobile.png", fullPage: true });
            assertEquals(
              await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
              true,
            );
            await page.setViewportSize({ width: 1280, height: 900 });
          }
          await page.locator('button[data-generate-target="setup-e2e"]').click();
          const e2e = await page.locator("#setup-e2e").inputValue();
          assertEquals(e2e.length, 48);
          assertEquals(await page.locator("#setup-e2e-confirm").inputValue(), e2e);
          assertEquals(await page.locator("button[data-repeat-target]").count(), 0);
          await page.locator('button[data-generate-target="setup-uri-passphrase"]').click();
          await page.locator("#setup-password").fill("incorrect-password-long");
          await page.locator("#setup-generate").click();
          await page.waitForFunction(
            () => {
              const text = document.querySelector("#setup-status")?.textContent;
              return text && !text.includes("Generating");
            },
            undefined,
            { timeout: 5000 },
          );
          assertEquals(
            (await page.locator("#setup-status").innerText()).includes("Incorrect sync password"),
            true,
          );
          assertEquals(await page.locator("#setup-result").isVisible(), false);
          assertEquals(await page.locator("#setup-e2e").inputValue(), e2e);
          const gateway = new QuotaGateway(client, service.quotas, url, username, password);
          for (const mode of ["persistent", "ephemeral"] as const) {
            if (mode === "ephemeral") {
              await page.reload();
              assertEquals(
                await page.locator('button[data-generate-target="setup-e2e"]').count(),
                0,
              );
              await page.locator("#setup-e2e").fill(e2e);
              await page.locator("#setup-e2e-confirm").fill(e2e);
            }
            await page.locator("#setup-password").fill(secret);
            await page.locator("#setup-mode").selectOption(mode);
            requests.length = 0;
            await page.locator("#setup-generate").click();
            await page.waitForFunction(
              () => !!document.querySelector<HTMLTextAreaElement>("#setup-uri")?.value,
            );
            const uri = await page.locator("#setup-uri").inputValue();
            const uriPassword = await page.locator("#setup-passphrase").inputValue();
            assertEquals(await page.locator("#setup-password").inputValue(), "");
            if (name === "chromium" && mode === "persistent") {
              const spacing = await page.evaluate(() => {
                const actions = document
                  .querySelector("#setup-result .actions")!
                  .getBoundingClientRect();
                const warning = document
                  .querySelector("#setup-export-warning")!
                  .getBoundingClientRect();
                return warning.top - actions.bottom;
              });
              assertEquals(spacing >= 20, true);
              await page.screenshot({
                path: ".local/setup-result.png",
                fullPage: true,
                mask: [page.locator("#setup-uri"), page.locator("#setup-passphrase")],
              });
            }
            assertEquals(
              requests.some((value) =>
                [e2e, uri, uriPassword].some((secret) => value.includes(secret)),
              ),
              false,
            );
            if (name === "chromium" && mode === "persistent") {
              // Leaving asks in the page; the browser's own dialogs stay unused.
              assertEquals(await page.locator("#setup-form").isVisible(), false);
              await page.locator('nav a[href="/password"]').click();
              await page.locator("#confirm-dialog").waitFor({ state: "visible" });
              await page.locator('#confirm-dialog button[value="cancel"]').click();
              assertEquals(new URL(page.url()).pathname.endsWith("/setup"), true);
              assertEquals(await page.locator("#setup-uri").inputValue(), uri);
            }
            if (name === "chromium" && mode === "persistent") {
              await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
              const selector = 'button[data-copy-target="setup-uri"]';
              const label = await page.locator(selector).innerText();
              const shows = (text: string) =>
                page.waitForFunction(
                  ([css, expected]) => document.querySelector(css)?.textContent === expected,
                  [selector, text],
                  { timeout: 4000 },
                );
              await page.locator(selector).click();
              await shows("Copied");
              await shows(label);
            }
            const download = page.waitForEvent("download");
            await page.locator("#setup-export").click();
            const downloaded = await download;
            assertEquals(downloaded.suggestedFilename(), `livesync-${database}.txt`);
            const content = await readFile((await downloaded.path())!, "utf8");
            for (const value of [
              uri,
              uriPassword,
              secret,
              e2e,
              vault.idRecoveryCode!,
              prefix,
              database,
            ])
              assertEquals(content.includes(value), true);
            const decoded = await decodeSettingsFromSetupURI(uri, uriPassword);
            if (!decoded) throw new Error("Official decoder rejected exported URI");
            assertEquals(decoded.passphrase, e2e);
            const headers = {
              authorization: `Basic ${Buffer.from(`${decoded.couchDB_USER}:${decoded.couchDB_PASSWORD}`).toString("base64")}`,
              "Content-Type": "application/json",
            };
            const write = await gateway.fetch(
              new Request(`${decoded.couchDB_URI}/${decoded.couchDB_DBNAME}/${mode}`, {
                method: "PUT",
                headers,
                body: JSON.stringify({ text: mode }),
              }),
            );
            assertEquals(write.status, 201);
          }
          await page.setViewportSize({ width: 390, height: 844 });
          assertEquals(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
          if (name === "chromium") {
            await mkdir(".local", { recursive: true });
            await page.screenshot({ path: ".local/account-setup-mobile.png", fullPage: true });
          }
          await page.locator('form[action="/logout"] button[type="submit"]').click();
          await page.waitForURL(config.ownerOrigin + "/login");
          await page.locator('[name="username"]').fill(prefix);
          await page.locator('[name="password"]').fill(secret);
          await page.locator('form[action="/login"] button[type="submit"]').click();
          await page.waitForURL(config.ownerOrigin + "/", { timeout: 5000 }).catch(async () => {
            throw new Error(
              `Owner navigation failed at ${new URL(page.url()).pathname}: ${(await page.locator("[role=status]").allTextContents()).join("; ")}`,
            );
          });
          assertEquals(await page.locator('a[href$="/setup"]').count(), 1);
          assertEquals(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
          assertEquals(errors, []);
          await page.locator(`a[href="/vaults/${vault.id}/delete"]`).click();
          await page.waitForURL(`${config.ownerOrigin}/vaults/${vault.id}/delete`);
          const recoveryDownload = page.waitForEvent("download");
          await page.locator(`a[href="/vaults/${vault.id}/archive.zip"]`).click();
          const recovery = await recoveryDownload;
          const recoveryBytes = await readFile((await recovery.path())!);
          assertEquals(recovery.suggestedFilename(), `livesync-${database}.zip`);
          assertEquals(recoveryBytes.readUInt32LE(), 0x04034b50);
          if (name === "chromium")
            await page.screenshot({ path: ".local/delete-vault.png", fullPage: true });
          await page.locator('[name="backup"][value="downloaded"]').check();
          await page.locator('[name="label"]').fill(vault.label);
          await page.locator('[name="password"]').fill(secret);
          await page.locator('[name="irreversible"]').check();
          await page
            .locator(`form[action="/vaults/${vault.id}/delete"] button[type="submit"]`)
            .click();
          await page.locator('#confirm-dialog button[value="confirm"]').click();
          await page.waitForURL((url) => url.pathname === "/");
          assertEquals(await page.locator(`a[href="/vaults/${vault.id}/setup"]`).count(), 0);
        } finally {
          await browser?.close();
          await admin.close();
          await owner.close();
          for (const db of [database, registry])
            if (db) await client.request(encodeURIComponent(db), "DELETE").catch(() => {});
          const user = await client.get<CouchDocument>("_users", `org.couchdb.user:${prefix}`);
          if (user)
            await client.request(
              `_users/${encodeURIComponent(user._id)}?rev=${user._rev}`,
              "DELETE",
            );
        }
      });
    }
  },
);

test(
  "browser onboarding, local URI encryption and presentation over real HTTPS",
  { skip: process.env.RUN_BROWSER_TESTS !== "1" },
  async (t) => {
    const { chromium, firefox, webkit } = await import("@playwright/test");
    const couchdbUrl = process.env.TEST_COUCHDB_URL;
    if (!couchdbUrl) throw new Error("TEST_COUCHDB_URL is required for browser integration tests");
    const username = process.env.TEST_COUCHDB_USER ?? "fixture-admin";
    const password = process.env.TEST_COUCHDB_PASSWORD ?? "fixture-password-long";
    const client = new CouchClient(couchdbUrl, username, password);
    const tls = await temporaryCertificate();
    for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
      const selected = process.env.BROWSER_ENGINES;
      if (selected && !selected.split(",").includes(name)) continue;
      await t.test(name, async () => {
        const prefix = `test_browser_${crypto.randomUUID().replaceAll("-", "")}_`;
        const registry = `${prefix}registry`;
        // The owner creates the vault; its database name is assigned then.
        let db = "";
        const couchUser = `${prefix}alice`;
        const adminLogin = "admin@example.test";
        const requests: string[] = [];
        let apps: ReturnType<typeof createApps>;
        const forward = async (request: Request, surface: "admin" | "owner") => {
          const body = await request.clone().text();
          requests.push(`${request.method} ${request.url} ${body}`);
          const headers = new Headers(request.headers);
          // Only administration trusts the Tailscale identity; the owner signs in.
          if (surface === "admin") headers.set("Tailscale-User-Login", adminLogin);
          return apps[surface].fetch(new Request(request.clone(), { headers }));
        };
        const admin = await testServer((request) => forward(request, "admin"), tls);
        const owner = await testServer((request) => forward(request, "owner"), tls);
        const config: AppConfig = {
          couchdbUrl,
          couchdbUsername: username,
          couchdbPassword: password,
          publicCouchdbUrl: "https://notes.example.test",
          adminOrigin: `https://127.0.0.1:${admin.port}`,
          ownerOrigin: `https://127.0.0.1:${owner.port}`,
          admins: [adminLogin],
          panelDb: registry,
          csrfSecret: "test-only-secret-at-least-32-characters",
          backupMaxAgeHours: 26,
        };
        const service = new CouchDashboardService(client, registry, config.publicCouchdbUrl);
        let browser: Awaited<ReturnType<typeof engine.launch>> | undefined;
        try {
          await service.initialize();
          const driveConfig = {
            clientId: "fixture-google-client",
            clientSecret: "fixture-google-secret",
            tokenKey: Buffer.alloc(32, 9).toString("base64"),
            redirectUri: `${config.ownerOrigin}/backups/google/callback`,
            workDir: tmpdir(),
            picker: { apiKey: "fixture-browser-key", appId: "123" },
          };
          const drive = new (class extends GoogleDrive {
            override async access() {
              return "fixture-picker-access";
            }
            override async folderInfo(_access: string, id: string) {
              if (!["default-folder", "selected-folder"].includes(id))
                throw new Error("unexpected folder");
              return { id, name: id === "default-folder" ? DRIVE_FOLDER : "mis-copias" };
            }
          })(driveConfig);
          apps = createApps({
            config,
            service,
            personalBackup: new PersonalBackups(client, service, registry, driveConfig, drive),
            backup: {
              status: () => Promise.resolve(null),
              request: () => Promise.reject(new Error()),
            },
          });
          browser = await engine.launch({ headless: true });
          const context = await browser.newContext({
            ignoreHTTPSErrors: true,
            viewport: { width: 1280, height: 900 },
          });
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
          });
          await page.goto(`${config.adminOrigin}/people`);
          const signup = page.locator('form[action="/people"]');
          const creation = page.locator("details.disclosure");
          if (!(await creation.evaluate((element) => (element as HTMLDetailsElement).open)))
            await creation.locator("summary").click();
          await signup.locator('[name="displayName"]').fill("Alice");
          await signup.locator('[name="couchUser"]').fill(couchUser);
          await signup.locator('button[type="submit"]').click();
          await page.waitForFunction(
            () => document.querySelector("#main h2")?.textContent === "Alice",
            undefined,
            { timeout: 10_000 },
          );
          const person = await service.findPersonByLogin(couchUser);
          assertExists(person);
          assertEquals(person.status, "pending_credentials");
          await page.locator('form[action$="/invitation"] button[type="submit"]').click();
          const invitation = await page.locator("#invitation-link").inputValue();

          await page.goto(invitation);
          await page.waitForFunction(
            () => !!document.querySelector<HTMLInputElement>('[name="invitation"]')?.value,
          );
          const syncPassword = "owner-browser-password-long";
          await page.locator('[name="password"]').fill(syncPassword);
          await page.locator('[name="confirmPassword"]').fill(syncPassword);
          await page.locator('form[action="/activate"] button[type="submit"]').click();
          await page.waitForURL(config.ownerOrigin + "/", { timeout: 10_000 });
          const create = page.locator('form[action="/vaults"]');
          await create.locator('[name="label"]').fill("Notes");
          await create.locator('button[type="submit"]').click();
          await page.waitForSelector("#setup-form");
          db = (await service.listVaults(person.id)).items[0].db;
          assertEquals(await page.locator("#setup-form input[name]").count(), 0);
          assertEquals(await page.locator("#setup-instruction").isVisible(), false);
          await client.put(db, {
            _id: "test-note",
            type: "test",
            value: "Remote initialized after opening setup",
          });
          const e2e = " llave privada española 🔒 ";
          await page.locator("#setup-password").fill(syncPassword);
          await page.locator("#setup-e2e").fill(e2e);
          await page.locator("#setup-e2e-confirm").fill(e2e);
          // Simulate a long-open tab whose cookie expired while its DOM token stayed unchanged.
          await context.addCookies([
            {
              name: "__Host-panel-owner",
              value: "expired",
              url: config.ownerOrigin,
              secure: true,
              httpOnly: true,
              sameSite: "Strict",
            },
          ]);
          requests.length = 0;
          await page.evaluate(() => {
            document.querySelector<HTMLFormElement>("#setup-form")!.requestSubmit();
            document.querySelector<HTMLInputElement>("#setup-e2e")!.value =
              "changed during metadata fetch";
          });
          await page.waitForFunction(
            () => !!document.querySelector<HTMLTextAreaElement>("#setup-uri")?.value,
            undefined,
            { timeout: 20_000 },
          );
          const uri = await page.locator("#setup-uri").inputValue();
          const passphrase = await page.locator("#setup-passphrase").inputValue();
          const decoded = await decodeSettingsFromSetupURI(uri, passphrase);
          if (!decoded) throw new Error("Official decoder rejected browser URI");
          assertEquals(decoded.passphrase, e2e);
          assertEquals(decoded.couchDB_PASSWORD, syncPassword);
          assertEquals(decoded.couchDB_DBNAME, db);
          assertEquals(
            (await page.locator("#setup-instruction").innerText()).includes("already has data"),
            true,
          );
          assertEquals(
            requests.some((request) =>
              [e2e, uri, passphrase].some((secret) => request.includes(secret)),
            ),
            false,
          );
          assertEquals(await page.locator("#setup-e2e").inputValue(), "");
          assertEquals(
            await page.evaluate(
              (secrets) => {
                const values = [sessionStorage, localStorage].flatMap((storage) =>
                  Array.from(
                    { length: storage.length },
                    (_, index) => storage.getItem(storage.key(index)!) ?? "",
                  ),
                );
                return values.some((value) => secrets.some((secret) => value.includes(secret)));
              },
              [e2e, syncPassword, passphrase, uri],
            ),
            false,
          );
          assertEquals(errors, []);

          await page.locator("#theme-select").selectOption("dark");
          assertEquals(await page.locator("html").getAttribute("data-theme"), "dark");
          await page.setViewportSize({ width: 390, height: 844 });
          assertEquals(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
          await mkdir(".local", { recursive: true });
          if (name === "chromium") {
            await page.screenshot({ path: ".local/owner-mobile.png", fullPage: true });
          }
          await Promise.all([
            page.waitForEvent("load"),
            page.locator("#locale-select").selectOption("es"),
          ]);
          assertEquals(await page.locator("html").getAttribute("lang"), "es");
          assertEquals(await page.locator("#setup-uri").inputValue(), "");
          await page.goto(`${config.ownerOrigin}/backups`);
          assertEquals(await page.locator("h1").innerText(), "Tus backups");
          const generatedIdentity = spawnSync("age-keygen", [], { encoding: "utf8" });
          assertEquals(generatedIdentity.status, 0);
          const recipient = spawnSync("age-keygen", ["-y"], {
            input: generatedIdentity.stdout,
            encoding: "utf8",
          }).stdout.trim();
          await page.locator('[name="recipient"]').fill(recipient);
          await page.locator('[name="retentionDays"]').fill("14");
          await page.locator('[name="enabled"]').check();
          await Promise.all([
            page.waitForResponse(
              (response) =>
                response.url().endsWith("/backups/settings") &&
                response.request().method() === "POST",
            ),
            page.locator('form[action="/backups/settings"] button[type="submit"]').click(),
          ]);
          await page.waitForSelector('[name="retentionDays"][value="14"]');
          assertEquals(await page.locator('[name="recipient"]').inputValue(), recipient);
          assertEquals(await page.locator('[name="enabled"]').isChecked(), true);
          assertEquals(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
          if (name === "chromium")
            await page.screenshot({ path: ".local/personal-backups-mobile.png", fullPage: true });
          const [keyDownload] = await Promise.all([
            page.waitForEvent("download"),
            page.getByRole("button", { name: "Crear clave de recuperación" }).click(),
          ]);
          const browserIdentity = /AGE-SECRET-KEY-1[0-9A-Z]+/.exec(
            await readFile((await keyDownload.path())!, "utf8"),
          )![0];
          const browserRecipient = await page.locator('[name="recipient"]').inputValue();
          assertEquals(
            spawnSync("age-keygen", ["-y"], {
              input: browserIdentity + "\n",
              encoding: "utf8",
            }).stdout.trim(),
            browserRecipient,
          );
          assertEquals(
            await page
              .locator('[name="keySaved"]')
              .evaluate((input) => (input as HTMLInputElement).required),
            true,
          );
          // A personal backup as the server writes it, with a note encrypted end to end using
          // the passphrase the setup page generated above.
          const salt = crypto.getRandomValues(new Uint8Array(32));
          const meta = async (props: object) =>
            "/\\:" + (await encrypt(JSON.stringify(props), passphrase, salt));
          const ndjson = [
            {
              type: "manifest",
              format: "obsidian-personal-backup",
              vaults: [{ id: "v1", label: "Notas", db }],
            },
            {
              type: "local",
              vaultId: "v1",
              doc: {
                _id: "_local/obsidian_livesync_sync_parameters",
                pbkdf2salt: Buffer.from(salt).toString("base64"),
              },
            },
            {
              type: "document",
              vaultId: "v1",
              doc: {
                _id: "h:+1",
                _rev: "1-a",
                type: "leaf",
                e_: true,
                data: await encrypt("Hola mundo ✓", passphrase, salt),
              },
            },
            {
              type: "document",
              vaultId: "v1",
              doc: {
                _id: "f:1",
                _rev: "1-a",
                type: "plain",
                path: await meta({
                  path: "Carpeta/Nota.md",
                  mtime: Date.now(),
                  children: ["h:+1"],
                }),
                children: [],
                eden: {},
              },
            },
          ]
            .map((line) => JSON.stringify(line))
            .join("\n");
          const backup = spawnSync("age", ["-r", browserRecipient], { input: gzipSync(ndjson) });
          assertEquals(backup.status, 0);
          await page.goto(`${config.ownerOrigin}/backups/restore`);
          await page.locator('[name="backup"]').setInputFiles({
            name: "obsidian-vaults.ndjson.gz.age",
            mimeType: "application/octet-stream",
            buffer: backup.stdout,
          });
          await page.locator('[name="keyText"]').fill(browserIdentity);
          await page.getByRole("button", { name: "Abrir backup" }).click();
          await page.getByText("Backup abierto").waitFor();
          const vaultPassphrase = page.locator("[data-restore-vaults] input");
          await vaultPassphrase.fill("incorrecta");
          await page.getByRole("button", { name: "Descargar notas (.zip)" }).click();
          await page.getByText("no es correcta").waitFor();
          await vaultPassphrase.fill(passphrase);
          const [notesDownload] = await Promise.all([
            page.waitForEvent("download"),
            page.getByRole("button", { name: "Descargar notas (.zip)" }).click(),
          ]);
          const notesZip = await readFile((await notesDownload.path())!);
          assertEquals(notesZip.includes(Buffer.from("Notas/Carpeta/Nota.md")), true);
          assertEquals(notesZip.includes(Buffer.from("Hola mundo ✓")), true);
          await page.goto(`${config.ownerOrigin}/backups`);
          await page.locator('form[action="/backups/google/connect"] button').click();
          const consentLink = page.getByRole("link", { name: "Continuar a Google" });
          await consentLink.waitFor();
          assertEquals(
            new URL((await consentLink.getAttribute("href"))!).hostname,
            "accounts.google.com",
          );
          const stored = await client.get<CouchDocument>(registry, `personal-backup:${person.id}`);
          assertExists(stored);
          await client.put(registry, {
            ...stored,
            token: new TokenCipher(driveConfig.tokenKey).seal("fixture-refresh-secret", person.id),
            defaultFolderId: "default-folder",
            value: {
              ...(stored.value as object),
              connected: true,
              folderId: "default-folder",
              folderName: DRIVE_FOLDER,
            },
          });
          await page.route("https://apis.google.com/js/api.js", (route) =>
            route.fulfill({
              contentType: "text/javascript",
              body: `
              window.gapi = {load(module, options) {
                if (module !== "picker") throw Error("unexpected API module");
                class DocsView {
                  setIncludeFolders(value) { this.folders=value; return this; }
                  setSelectFolderEnabled(value) { this.select=value; return this; }
                  setOwnedByMe(value) { this.owned=value; return this; }
                }
                class PickerBuilder {
                  setDeveloperKey(key) { if(key!=="fixture-browser-key") throw Error("API key mismatch"); return this; }
                  setAppId(id) { if(id!=="123") throw Error("app ID mismatch"); return this; }
                  setOAuthToken(token) { if(token!=="fixture-picker-access") throw Error("access token mismatch"); return this; }
                  setOrigin(origin) { if(origin!==location.origin) throw Error("origin mismatch"); return this; }
                  setLocale(locale) { if(locale!=="es") throw Error("locale mismatch"); return this; }
                  addView(view) { if(!view.folders || !view.select || !view.owned) throw Error("folder filter missing"); return this; }
                  setCallback(callback) { this.callback=callback; return this; }
                  build() {
                    const callback=this.callback;
                    return { setVisible() {
                      for (const action of ["cancel", "choose"]) {
                        const button=document.createElement("button"); button.id="fake-picker-"+action;
                        button.textContent=action;
                        button.onclick=()=>callback(action==="cancel" ? {action:"cancel"} : {action:"picked",docs:[{id:"selected-folder",mimeType:"application/vnd.google-apps.folder"}]});
                        document.body.append(button);
                      }
                    }, dispose() { document.querySelectorAll('[id^="fake-picker-"]').forEach(node=>node.remove()); } };
                  }
                }
                window.google={picker:{DocsView,PickerBuilder,ViewId:{FOLDERS:"folders"}}}; options.callback();
              }};
            `,
            }),
          );
          await page.goto(`${config.ownerOrigin}/backups`);
          await page.getByRole("link", { name: "Elegir carpeta de Google Drive" }).click();
          await page.getByRole("button", { name: "Elegir carpeta de Google Drive" }).click();
          await page.locator("#fake-picker-cancel").click();
          assertEquals(
            (await page.locator("#drive-picker-status").innerText()).includes("cancelada"),
            true,
          );
          await page.getByRole("button", { name: "Elegir carpeta de Google Drive" }).click();
          await page.locator("#fake-picker-choose").click();
          await page.waitForURL(`${config.ownerOrigin}/backups?done=saved`);
          await page.getByRole("link", { name: "mis-copias" }).waitFor();
          await page.getByRole("button", { name: "Usar la carpeta predeterminada" }).click();
          await page.getByRole("link", { name: DRIVE_FOLDER, exact: true }).waitFor();
          assertEquals(errors, []);
          await context.close();
        } finally {
          await browser?.close();
          await admin.close();
          await owner.close();
          if (db) await client.request(encodeURIComponent(db), "DELETE").catch(() => {});
          await client.request(encodeURIComponent(registry), "DELETE").catch(() => {});
          const doc = await client.get<{ _id: string; _rev?: string }>(
            "_users",
            `org.couchdb.user:${couchUser}`,
          );
          if (doc?._rev) {
            await client.request(
              `_users/${encodeURIComponent(doc._id)}?rev=${encodeURIComponent(doc._rev)}`,
              "DELETE",
            );
          }
        }
      });
    }
  },
);
