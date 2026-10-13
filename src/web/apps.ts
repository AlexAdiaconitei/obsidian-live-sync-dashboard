import { setupPanel } from "./components/setup.ts";
import { vaultDeletePanel } from "./components/vault-delete.ts";
import { zipArchive } from "../backup/zip.ts";
import { readFile } from "node:fs/promises";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { PersonalBackupGateway } from "../backup/personal.ts";
import {
  personalBackupPanel,
  personalBackupStatusPanel,
  folderPickerPanel,
  restorePanel,
} from "./components/personal-backups.ts";
import { Csrf } from "../access/csrf.ts";
import { AttemptLimiter } from "../access/limiter.ts";
import { OwnerSessions, SESSION_MAX_MS } from "../access/owner-session.ts";
import type { AppConfig } from "../config.ts";
import {
  type AdoptVaultInput,
  type BackupGateway,
  type DashboardService,
  type Inventory,
  type Person,
  ServiceError,
} from "../contracts.ts";
import { type Locale, type MessageKey, resolveLocale } from "../locales/index.ts";
import { icon } from "../icons.ts";
import { backupPanel, type BackupSnapshot, backupSummary } from "./components/backups.ts";
import {
  parseQuota,
  quotaBytes,
  quotaField,
  quotaForView,
  quotaLimit,
  quotaPanel,
  quotaUnavailable,
} from "./components/quotas.ts";
import {
  badge,
  date,
  escape,
  field,
  form,
  heading,
  notice,
  page,
  t,
  table,
  type View,
} from "./components/html.ts";

type Variables = { view: View; person: Person; fields: Record<string, string> };
type App = Hono<{ Variables: Variables }>;
type WebContext = Context<{ Variables: Variables }>;
export interface AppDependencies {
  config: AppConfig;
  service: DashboardService;
  backup: BackupGateway;
  personalBackup?: PersonalBackupGateway;
}

export function createApps(deps: AppDependencies): { admin: App; owner: App } {
  // Form tokens last as long as the longest session, so a page left open still submits.
  const csrf = new Csrf(deps.config.csrfSecret, SESSION_MAX_MS);
  const sessions = new OwnerSessions(deps.config.csrfSecret, deps.service);
  const sessionCookie = "__Host-panel-session";
  const sessionOptions = {
    secure: true,
    httpOnly: true,
    sameSite: "Lax" as const,
    path: "/",
    maxAge: SESSION_MAX_MS / 1000,
  };
  const create = (surface: "admin" | "owner"): App => {
    const app: App = new Hono();
    const cookieName = `__Host-panel-${surface}`;
    const origin = surface === "admin" ? deps.config.adminOrigin : deps.config.ownerOrigin;
    const attempts = new AttemptLimiter();
    app.use("*", async (c, next) => {
      const pickerPage = surface === "owner" && c.req.path === "/backups/folder-picker";
      c.header(
        "Content-Security-Policy",
        pickerPage
          ? "default-src 'none'; script-src 'self' https://apis.google.com https://www.gstatic.com; style-src 'self' 'unsafe-inline'; img-src 'self' https://www.gstatic.com; font-src 'self'; connect-src 'self' https://www.googleapis.com https://apis.google.com; frame-src https://docs.google.com https://drive.google.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
          : "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      c.header("X-Content-Type-Options", "nosniff");
      const loginPage = surface === "owner" && ["/login", "/activate"].includes(c.req.path);
      c.header(
        "Referrer-Policy",
        pickerPage ? "strict-origin" : loginPage ? "same-origin" : "no-referrer",
      );
      c.header("Cache-Control", "no-store");
      c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      await next();
    });
    app.get("/health/live", (c) => c.json({ status: "ok" }));
    app.get("/health/ready", async (c) => {
      try {
        const health = await deps.service.health();
        return c.json({ status: health.up ? "ok" : "unavailable" }, health.up ? 200 : 503);
      } catch {
        return c.json({ status: "unavailable" }, 503);
      }
    });
    app.use(
      "*",
      bodyLimit({
        maxSize: 32_768,
        onError: (c) => {
          const view: View = {
            surface,
            actor: "",
            locale: resolveLocale(getCookie(c, "panel_locale")),
            csrf: "",
            path: c.req.path,
          };
          return c.html(page(view, "tooLarge", notice(view, "tooLarge", "danger")), 413);
        },
      }),
    );
    app.get("/assets/:file", (c) => asset(c, c.req.param("file")));
    app.get("/assets/icons/:file", (c) => asset(c, `icons/${c.req.param("file")}`));
    app.use("*", async (c, next) => {
      const publicAuth = surface === "owner" && ["/login", "/activate"].includes(c.req.path);
      // Owners always sign in with their username and password; only administration trusts
      // the identity header that Tailscale Serve adds.
      const verified =
        surface === "owner" && !publicAuth
          ? await sessions.verify(getCookie(c, sessionCookie))
          : null;
      if (verified?.renewed) setCookie(c, sessionCookie, verified.renewed, sessionOptions);
      const authenticated = verified?.person ?? null;
      const actor =
        surface === "owner"
          ? publicAuth
            ? "anonymous-owner"
            : authenticated?.tailscaleLogin
          : c.req.header("Tailscale-User-Login");
      const locale = resolveLocale(getCookie(c, "panel_locale"));
      const done = c.req.query("done");
      const view: View = {
        surface,
        actor: publicAuth ? "" : (actor ?? ""),
        locale,
        csrf: "",
        path: c.req.path,
        flash:
          done === "saved" ? "changesSaved" : done === "deleted" ? "vaultDeletedNotice" : undefined,
      };
      c.set("view", view);
      if (!actor || actor.length > 254 || /[\s,\p{Cc}]/u.test(actor)) {
        if (
          surface === "owner" &&
          /\/(setup-metadata|uri-issued|verify-credentials)$/.test(c.req.path)
        )
          return c.json({ error: "session_expired" }, 401);
        if (surface === "owner") {
          // An htmx fragment request would otherwise swap the whole login page into the panel.
          if (c.req.header("HX-Request") === "true") {
            c.header("HX-Redirect", "/login");
            return c.body(null, 204);
          }
          return c.req.method === "GET"
            ? c.redirect("/login", 303)
            : c.html(loginPage(view, false), 401);
        }
        return c.html(page(view, "forbidden", notice(view, "signIn", "danger")), 403);
      }
      if (surface === "admin") {
        if (!deps.config.admins.includes(actor)) {
          return c.html(page(view, "forbidden", notice(view, "signIn", "danger")), 403);
        }
      } else if (!publicAuth) {
        // A verified session belongs to an active person; see DashboardService.ownerSession.
        c.set("person", authenticated!);
      }
      if (!["GET", "HEAD", "POST"].includes(c.req.method)) {
        return c.html(page(view, "methodDenied", notice(view, "methodDenied", "danger")), 405);
      }
      if (c.req.method === "POST") {
        if (c.req.header("Origin") !== origin) {
          return c.html(page(view, "forbidden", notice(view, "csrf", "danger")), 403);
        }
        const contentType = c.req.header("Content-Type") ?? "";
        if (
          contentType &&
          contentType.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded"
        ) {
          return c.html(page(view, "unsupported", notice(view, "unsupported", "danger")), 415);
        }
        const fields = contentType
          ? Object.fromEntries(new URLSearchParams(await c.req.text()))
          : {};
        c.set("fields", fields);
        const cookie = getCookie(c, cookieName);
        const token = c.req.header("X-CSRF-Token") ?? fields.csrf;
        if (!cookie || !token || cookie !== token || !(await csrf.verify(token, actor, surface))) {
          return c.html(page(view, "forbidden", notice(view, "csrf", "danger")), 403);
        }
        view.csrf = token;
        const sensitive =
          ["/password", "/login", "/activate"].includes(c.req.path) ||
          c.req.path.endsWith("/verify-credentials") ||
          c.req.path.endsWith("/delete");
        const identity = publicAuth
          ? (
              (c.req.path === "/login"
                ? fields.username?.trim()
                : fields.invitation?.trim().split(".")[0]) ?? "anonymous"
            ).slice(0, 128)
          : actor;
        const limitKey = `${identity}:${sensitive ? "password" : "write"}`;
        const limit = sensitive ? 5 : 30;
        if (attempts.count(limitKey) >= limit) {
          if (c.req.path.endsWith("/verify-credentials")) return c.json({ error: "too_many" }, 429);
          return c.html(page(view, "tooMany", notice(view, "tooMany", "danger")), 429);
        }
        attempts.add(limitKey);
      } else {
        const existing = getCookie(c, cookieName);
        view.csrf =
          existing && (await csrf.verify(existing, actor, surface))
            ? existing
            : await csrf.issue(actor, surface);
        setCookie(c, cookieName, view.csrf, {
          secure: true,
          httpOnly: true,
          sameSite: "Strict",
          path: "/",
          maxAge: SESSION_MAX_MS / 1000,
        });
        if (c.req.path.endsWith("/setup-metadata")) c.header("X-CSRF-Token", view.csrf);
      }
      await next();
    });
    app.onError((error, c) => {
      const view = c.get("view") ?? {
        surface,
        actor: "",
        locale: "en" as Locale,
        csrf: "",
        path: c.req.path,
      };
      const status = error instanceof ServiceError ? error.status : 503;
      const safeStatus = (
        [400, 401, 403, 404, 409, 422, 429, 503].includes(status) ? status : 503
      ) as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503;
      if (
        c.req.path.endsWith("setup-metadata") ||
        c.req.path.endsWith("uri-issued") ||
        c.req.path.endsWith("verify-credentials") ||
        c.req.path.endsWith("picker-session")
      ) {
        return c.json(
          {
            error:
              error instanceof ServiceError && error.code === "invalid_credentials"
                ? "invalid_credentials"
                : "request_failed",
          },
          safeStatus,
        );
      }
      const message =
        error instanceof ServiceError ? publicError(error.code, status) : "requestFailed";
      if (surface === "owner" && ["/login", "/activate"].includes(c.req.path)) {
        return c.html(
          loginPage(
            view,
            c.req.path === "/activate",
            message,
            c.get("fields")?.username,
            c.get("fields")?.invitation,
          ),
          safeStatus,
        );
      }
      if (surface === "owner" && c.req.path === "/password" && c.get("person")) {
        return c.html(passwordPage(view, message), safeStatus);
      }
      return c.html(
        page(view, "errorTitle", notice(view, message, "danger"), { back: "history" }),
        safeStatus,
      );
    });
    app.notFound((c) => {
      const view = c.get("view") ?? {
        surface,
        actor: "",
        locale: "en" as Locale,
        csrf: "",
        path: c.req.path,
      };
      return c.html(page(view, "notFound", notice(view, "notFound")), 404);
    });
    return app;
  };
  const admin = create("admin");
  const owner = create("owner");
  owner.get("/login", (c) => c.html(loginPage(c.get("view"), false)));
  owner.get("/activate", (c) =>
    c.html(loginPage(c.get("view"), true, undefined, c.req.query("username"))),
  );
  for (const action of ["login", "activate"] as const) {
    owner.post(`/${action}`, async (c) => {
      const fields = c.get("fields");
      const password = read(fields, "password", false);
      if (action === "activate" && password !== fields.confirmPassword) {
        return c.html(
          loginPage(c.get("view"), true, "passwordsDiffer", fields.username, fields.invitation),
          400,
        );
      }
      const session =
        action === "login"
          ? await deps.service.loginOwner(read(fields, "username"), password)
          : await deps.service.acceptInvitation(read(fields, "invitation"), password);
      setCookie(c, sessionCookie, await sessions.issue(session), sessionOptions);
      return c.redirect("/", 303);
    });
  }
  owner.post("/logout", async (c) => {
    await deps.service.revokeOwnerSessions(c.get("view").actor);
    deleteCookie(c, sessionCookie, { secure: true, path: "/" });
    return navigate(c, "/login");
  });
  admin.get("/", async (c) => {
    const view = c.get("view");
    const health = await deps.service.health();
    const stats = await deps.service.stats();
    const backup = await backupSnapshot(deps.backup);
    const quotas = await quotaForView(() => deps.service.quotaSummary());
    return c.html(
      page(
        view,
        "overview",
        `<div class="grid"><section class="panel stat"><h2>${icon("database")}${t(
          view,
          "couchdb",
        )}</h2><p class="metric">${t(view, health.up ? "healthy" : "unhealthy")}</p><p class="muted">${escape(
          health.version,
        )}</p></section><section class="panel stat"><h2>${icon("vault")}${t(
          view,
          "vaults",
        )}</h2><p class="metric">${stats.length}</p><p class="muted">${t(view, "storage")}: ${quotaBytes(
          view,
          stats.reduce((total, s) => total + s.sizeFile, 0),
        )}</p></section>${backupSummary(
          view,
          backup,
          deps.config.backupMaxAgeHours,
        )}</div>${quotas ? quotaPanel(view, quotas.instance, true) : quotaUnavailable(view)}<section class="panel"><h2>${t(
          view,
          "vaults",
        )}</h2>${table(
          view,
          ["database", "documents", "storage"],
          stats.map((s) => [
            `<code>${escape(s.db)}</code>`,
            new Intl.NumberFormat(view.locale).format(s.docCount),
            quotaBytes(view, s.sizeFile),
          ]),
          [1, 2],
        )}</section>`,
      ),
    );
  });
  admin.get("/people", async (c) => {
    const view = c.get("view");
    const people = await deps.service.listPeople(query(c));
    const quotas = await quotaForView(() => deps.service.quotaSummary());
    const personQuotas = new Map(quotas?.people.map((quota) => [quota.personId, quota]));
    return c.html(
      page(
        view,
        "people",
        `${quotas ? "" : quotaUnavailable(view)}<details class="panel disclosure"${
          people.items.length ? "" : " open"
        }><summary>${icon("user-plus")}${t(view, "createPerson")}</summary>${form(
          view,
          "/people",
          personFields(view) +
            (quotas ? quotaField(view, quotas.instance.defaultUserLimitBytes) : ""),
          "createPerson",
        )}</details><section class="panel">${table(
          view,
          ["name", "username", "status", "quotaUsed", "quotaLimit", "quotaRemaining", "details"],
          people.items.map((p) => {
            const quota = personQuotas.get(p.id);
            return [
              escape(p.displayName),
              `<code>${escape(p.couchUser)}</code>`,
              badge(view, p.status),
              quota ? quotaBytes(view, quota.usedBytes) : t(view, "quotaUnavailable"),
              quota ? quotaLimit(view, quota.limitBytes) : t(view, "quotaUnavailable"),
              quota ? quotaLimit(view, quota.remainingBytes) : t(view, "quotaUnavailable"),
              `<a href="/people/${encodeURIComponent(p.id)}">${t(view, "details")}</a>`,
            ];
          }),
          [3, 4, 5, 6],
        )}${nextPage(view, "/people", people.bookmark)}</section>`,
      ),
    );
  });
  admin.post("/people", async (c) => {
    const f = c.get("fields");
    const person = await deps.service.createPerson(c.get("view").actor, {
      displayName: read(f, "displayName"),
      // The sign-in identifier is the CouchDB username.
      tailscaleLogin: read(f, "couchUser"),
      couchUser: read(f, "couchUser"),
      ...(Object.hasOwn(f, "quotaGiB") ? { quotaBytes: parseQuota(f) } : {}),
    });
    return navigate(c, `/people/${encodeURIComponent(person.id)}?done=saved`);
  });
  admin.get("/people/:id", async (c) => {
    const view = c.get("view");
    const person = await deps.service.getPerson(c.req.param("id"));
    const vaults = await deps.service.listVaults(person.id, query(c));
    const quotas = await quotaForView(() => deps.service.quotaSummary());
    const quota = quotas?.people.find((value) => value.personId === person.id);
    if (quotas && !quota) throw new ServiceError("not_found", 404);
    const base = `/people/${encodeURIComponent(person.id)}`;
    return c.html(
      page(
        view,
        "people",
        `<section class="panel"><div class="panel-header"><div><h2>${escape(person.displayName)}</h2><p class="meta"><code>${escape(person.couchUser)}</code>${badge(
          view,
          person.status,
        )}</p></div><div class="actions">${
          person.status === "disabled"
            ? form(view, `${base}/enable`, "", "enable")
            : form(view, `${base}/disable`, "", "disable", "danger", "confirmDisable")
        }${person.status !== "disabled" ? form(view, `${base}/reset`, "", "reset", "danger", "confirmReset") : ""}${person.status === "pending_credentials" ? form(view, `${base}/invitation`, "", "inviteOwner") : ""}</div></div></section>${
          quota
            ? quotaPanel(
                view,
                quota,
                false,
                form(view, `${base}/quota`, quotaField(view, quota.limitBytes), "quotaSave"),
              )
            : quotaUnavailable(view)
        }<section class="panel">${heading(view, t(view, "vaults"), { icon: "vault" })}${table(
          view,
          ["label", "database"],
          vaults.items.map((v) => [
            escape(v.label),
            `<code>${escape(v.db)}</code>${
              !v.provisioning && !v.idRecoveryCode
                ? recoveryForm(view, `${base}/vaults/${encodeURIComponent(v.id)}/recovery`)
                : ""
            }${
              v.provisioning
                ? notice(view, "reconcileHelp", "danger") +
                  form(
                    view,
                    `/vaults/${encodeURIComponent(v.id)}/reconcile`,
                    field(view, "confirmDatabase", "confirmDatabase"),
                    "reconcile",
                  )
                : ""
            }`,
          ]),
        )}${nextPage(view, base, vaults.bookmark)}</section><section class="panel">${heading(
          view,
          t(view, "createVault"),
          { icon: "plus", hint: "adminVaultCreationHelp" },
        )}${form(
          view,
          `${base}/vaults`,
          field(view, "label", "label") + field(view, "database", "slug"),
          "createVault",
        )}</section>`,
        { back: "/people" },
      ),
    );
  });
  admin.post("/people/:id/vaults", async (c) => {
    const f = c.get("fields");
    await deps.service.createVault(c.get("view").actor, c.req.param("id"), {
      label: read(f, "label"),
      slug: read(f, "slug"),
    });
    return c.redirect(`/people/${encodeURIComponent(c.req.param("id"))}?done=saved`, 303);
  });
  admin.post("/people/:id/invitation", async (c) => {
    const view = c.get("view");
    const token = await deps.service.issueInvitation(view.actor, c.req.param("id"));
    const person = await deps.service.getPerson(c.req.param("id"));
    const url = `${deps.config.ownerOrigin}/activate?username=${encodeURIComponent(person.couchUser)}#${token}`;
    return c.html(
      page(
        view,
        "inviteOwner",
        `<section class="panel invitation">${heading(view, escape(person.displayName), {
          icon: "envelope",
          hint: "invitationHelp",
        })}<p class="meta"><code>${escape(person.couchUser)}</code><span class="chip">${icon(
          "hourglass",
        )}${t(view, "invitationMeta")}</span></p><div class="field"><label for="invitation-link">${t(
          view,
          "invitationLink",
        )}</label><div class="secret-control"><input id="invitation-link" readonly value="${escape(
          url,
        )}"><div class="input-actions"><button type="button" class="icon-button" data-copy-target="invitation-link" aria-label="${t(
          view,
          "copy",
        )}" title="${t(view, "copy")}">${icon("copy")}</button></div></div></div></section>`,
        { back: `/people/${encodeURIComponent(c.req.param("id"))}` },
      ),
    );
  });
  admin.post("/people/:id/vaults/:vaultId/recovery", async (c) => {
    await deps.service.registerRecoveryCode(
      c.get("view").actor,
      c.req.param("vaultId"),
      read(c.get("fields"), "idRecoveryCode"),
    );
    return c.redirect(`/people/${encodeURIComponent(c.req.param("id"))}?done=saved`, 303);
  });
  admin.post("/people/:id/quota", async (c) => {
    await deps.service.setPersonQuota(
      c.get("view").actor,
      c.req.param("id"),
      parseQuota(c.get("fields")),
    );
    return c.redirect(`/people/${encodeURIComponent(c.req.param("id"))}?done=saved`, 303);
  });
  admin.post("/vaults/:id/reconcile", async (c) => {
    const vault = await deps.service.reconcileVaultOwnership(
      c.get("view").actor,
      c.req.param("id"),
      read(c.get("fields"), "confirmDatabase", false),
    );
    return c.redirect(`/people/${encodeURIComponent(vault.personId)}?done=saved`, 303);
  });
  for (const action of ["disable", "enable", "reset"]) {
    admin.post(`/people/:id/${action}`, async (c) => {
      const actor = c.get("view").actor;
      const id = c.req.param("id");
      if (action === "reset") {
        await deps.service.resetPassword(actor, id);
      } else await deps.service.setPersonEnabled(actor, id, action === "enable");
      return c.redirect(`/people/${encodeURIComponent(id)}?done=saved`, 303);
    });
  }
  admin.get("/inventory", async (c) => {
    const view = c.get("view");
    const data = await deps.service.inventory();
    return c.html(
      page(
        view,
        "inventory",
        `<section class="panel">${heading(view, t(view, "accounts"), { icon: "users" })}${table(
          view,
          ["username", "status", "roles"],
          data.users.map((u) => [
            `<code>${escape(u.name)}</code>`,
            u.managed ? t(view, "managed") : "—",
            escape(u.roles.join(", ")) || "—",
          ]),
        )}</section><section class="panel">${heading(view, t(view, "security"), {
          icon: "shield-check",
        })}${inventoryTable(view, data.databases)}</section><section class="panel">${heading(
          view,
          t(view, "adopt"),
          { icon: "plus", hint: "adoptionHelp" },
        )}${form(
          view,
          "/inventory/preview",
          personFields(view) +
            field(view, "database", "db") +
            field(view, "label", "label") +
            field(view, "recovery", "idRecoveryCode", { required: false }),
          "preview",
        )}</section>`,
        { intro: "inventoryIntro" },
      ),
    );
  });
  admin.post("/inventory/preview", async (c) => {
    const view = c.get("view");
    const input = adoptInput(c.get("fields"));
    const data = await deps.service.inventory();
    if (
      !data.users.some((u) => u.name === input.couchUser) ||
      !data.databases.some((d) => d.name === input.db)
    )
      throw new ServiceError("invalid_adoption", 400);
    const details = [input.displayName, input.couchUser, input.db, input.label]
      .map(escape)
      .join(" · ");
    const fields = Object.entries(input)
      .map(([key, value]) => `<input type="hidden" name="${escape(key)}" value="${escape(value)}">`)
      .join("");
    return c.html(
      page(
        view,
        "preview",
        `<section class="panel">${heading(view, escape(input.label), {
          icon: "vault",
        })}<p class="meta">${details}</p>${notice(view, "adoptionHelp", "warning")}${inventoryTable(
          view,
          data.databases.filter((database) => database.name === input.db),
        )}<p class="muted">${t(view, "roles")}: ${
          escape(data.users.find((user) => user.name === input.couchUser)?.roles.join(", ")) || "—"
        }</p>${form(view, "/inventory/adopt", fields, "adopt")}</section>`,
        { back: "/inventory" },
      ),
    );
  });
  admin.post("/inventory/adopt", async (c) => {
    const vault = await deps.service.adoptVault(c.get("view").actor, adoptInput(c.get("fields")));
    return c.redirect(`/people/${encodeURIComponent(vault.personId)}?done=saved`, 303);
  });
  admin.get("/backups", async (c) => {
    const view = c.get("view");
    const snapshot = await backupSnapshot(deps.backup);
    const requestId = backupRequestId(c);
    return c.html(
      page(
        view,
        "backups",
        (c.req.query("audit") === "unavailable"
          ? notice(view, "backupAuditUnavailable", "danger")
          : "") + backupPanel(view, snapshot, deps.config.backupMaxAgeHours, requestId),
        { intro: "backupHelp", actions: backupActions(view, deps.config) },
      ),
    );
  });
  admin.get("/backups/status", async (c) => {
    const snapshot = await backupSnapshot(deps.backup);
    return c.html(
      backupPanel(c.get("view"), snapshot, deps.config.backupMaxAgeHours, backupRequestId(c)),
    );
  });
  admin.post("/backups/request", async (c) => {
    const result = await deps.backup.request(c.get("view").actor);
    let auditFailed = false;
    try {
      await deps.service.recordBackupRequested(c.get("view").actor, result.requestId);
    } catch {
      auditFailed = true;
    }
    return c.redirect(
      `/backups?requestId=${encodeURIComponent(result.requestId)}${
        auditFailed ? "&audit=unavailable" : ""
      }`,
      303,
    );
  });
  admin.get("/help/restore", (c) => {
    const view = c.get("view");
    return c.html(
      page(
        view,
        "restoreManual",
        `${notice(view, "restoreIntro", "warning")}<section class="panel"><ol class="steps">${(
          ["restoreStep1", "restoreStep2", "restoreStep3", "restoreStep4"] as MessageKey[]
        )
          .map((key) => `<li>${t(view, key)}</li>`)
          .join("")}</ol></section>`,
        { back: "/backups" },
      ),
    );
  });
  admin.get("/events", async (c) => {
    const view = c.get("view");
    const events = await deps.service.listEvents(query(c));
    return c.html(
      page(
        view,
        "events",
        `<section class="panel">${table(
          view,
          ["date", "actor", "operation", "result"],
          events.items.map((event) => [
            date(view, event.at),
            escape(event.actor),
            `<code>${escape(event.action)}</code> <span class="muted">${escape(event.target)}</span>`,
            badge(view, event.result),
          ]),
        )}${nextPage(view, "/events", events.bookmark)}</section>`,
      ),
    );
  });
  owner.get("/", async (c) => {
    const view = c.get("view");
    const person = c.get("person");
    const vaults = await deps.service.listVaults(person.id, query(c));
    const quota = await quotaForView(() => deps.service.personQuota(view.actor));
    return c.html(
      page(
        view,
        "owner",
        `<div class="grid">${vaults.items
          .map(
            (vault) =>
              `<section class="panel vault-card"><h2>${icon("vault")}${escape(vault.label)}</h2><p class="muted"><code>${escape(
                vault.db,
              )}</code></p>${
                vault.idRecoveryCode
                  ? ""
                  : // Collapsed so the card keeps the grid height; opened, it spans the row.
                    `<details class="recovery-disclosure"><summary>${icon("warning-circle")}${t(
                      view,
                      "recoveryAdd",
                    )}</summary>${recoveryForm(
                      view,
                      `/vaults/${encodeURIComponent(vault.id)}/recovery`,
                      "warning",
                    )}</details>`
              }<div class="actions">${
                vault.idRecoveryCode
                  ? `<a class="button primary" href="/vaults/${encodeURIComponent(
                      vault.id,
                    )}/setup">${icon("device-mobile")}${t(view, "setup")}</a>`
                  : ""
              }<a class="button subtle danger" href="/vaults/${encodeURIComponent(vault.id)}/delete">${icon("trash")}${t(view, "deleteVault")}</a></div></section>`,
          )
          .join("")}</div>${nextPage(
          view,
          "/",
          vaults.bookmark,
        )}<section class="panel new-vault">${heading(view, t(view, "createVault"), { icon: "plus", hint: "ownerVaultCreationHelp" })}${form(view, "/vaults", field(view, "label", "label"), "createVault")}</section>${quota ? quotaPanel(view, quota) : quotaUnavailable(view)}`,
        { intro: "ownerIntro" },
      ),
    );
  });
  owner.post("/vaults", async (c) => {
    const label = read(c.get("fields"), "label");
    // A repeated label returns the existing vault; tell the owner.
    const existing = (await deps.service.listVaults(c.get("person").id)).items.some(
      (vault) => vault.label === label,
    );
    const vault = await deps.service.createOwnedVault(c.get("view").actor, label);
    return navigate(
      c,
      `/vaults/${encodeURIComponent(vault.id)}/setup${existing ? "?existing=1" : ""}`,
    );
  });
  owner.get("/password", (c) => c.html(passwordPage(c.get("view"))));
  owner.post("/password", async (c) => {
    const view = c.get("view");
    const f = c.get("fields");
    const password = read(f, "password", false);
    if (password !== f.confirmPassword) {
      return c.html(passwordPage(view, "passwordsDiffer"), 400);
    }
    if (password.length < 12) return c.html(passwordPage(view, "passwordMin"), 400);
    await deps.service.changePassword(view.actor, read(f, "currentPassword", false), password);
    // Changing the password revokes sessions; sign this browser in again.
    const session = await deps.service.loginOwner(c.get("person").couchUser, password);
    setCookie(c, sessionCookie, await sessions.issue(session), sessionOptions);
    return navigate(c, "/?done=saved");
  });
  owner.post("/vaults/:id/recovery", async (c) => {
    await deps.service.registerRecoveryCode(
      c.get("view").actor,
      c.req.param("id"),
      read(c.get("fields"), "idRecoveryCode"),
      { asOwner: true },
    );
    return c.redirect("/?done=saved", 303);
  });
  owner.get("/vaults/:id/delete", async (c) => {
    const vault = await deps.service.getOwnedVault(c.get("view").actor, c.req.param("id"));
    return c.html(
      page(c.get("view"), "deleteVault", vaultDeletePanel(c.get("view"), vault), { back: "/" }),
    );
  });
  owner.post("/vaults/:id/delete", async (c) => {
    const fields = c.get("fields");
    if (fields.backup !== "downloaded" && fields.backup !== "skip")
      throw new ServiceError("vault_delete_confirmation", 400);
    await deps.service.deleteOwnedVault(c.get("view").actor, c.req.param("id"), {
      label: read(fields, "label", false),
      password: read(fields, "password", false),
      acknowledged: fields.irreversible === "on",
      backup: fields.backup,
    });
    return navigate(c, "/?done=deleted");
  });
  owner.get("/vaults/:id/archive.zip", async (c) => {
    const vault = await deps.service.getOwnedVault(c.get("view").actor, c.req.param("id"));
    const records = deps.service.exportOwnedVault(c.get("view").actor, vault.id);
    const readme = async function* () {
      yield "LiveSync vault recovery archive / Copia de recuperación de la bóveda\n\n" +
        "vault.ndjson contains the vault manifest, the local record holding the end-to-end encryption salt, and current CouchDB leaves, including conflicts, deletions and attachments. It is a live export, not a snapshot. Stop synchronization before exporting if you need a stable copy.\n" +
        "LiveSync data retains its original encryption. This ZIP is not a folder of decrypted Markdown notes. To get your notes, open vault.ndjson on the panel's Your backups > Recover your vaults page with your original vault encryption passphrase; it runs in your browser. This archive has no additional ZIP encryption.\n" +
        "Restore into an isolated CouchDB of the same version: write the local record to _local/obsidian_livesync_sync_parameters first, then import document records with _bulk_docs and new_edits=false, preserving revision ancestry and attachments. Accounts and server configuration are not included. Adopt the restored database with its saved idRecoveryCode. Test a disposable Obsidian client before production use.\n\n" +
        "Los datos conservan su cifrado original. Este ZIP no es una carpeta de notas Markdown descifradas. Para obtener tus notas, abre vault.ndjson en Tus backups > Recuperar tus vaults del panel con la contraseña de cifrado original del vault; funciona en tu navegador. El ZIP no añade cifrado adicional. Detén la sincronización antes de exportar si necesitas una copia estable.\n" +
        "Restaura en un CouchDB aislado de la misma versión: escribe primero el registro local en _local/obsidian_livesync_sync_parameters y después importa los registros document con _bulk_docs y new_edits=false, conservando revisiones y adjuntos. Registra la base restaurada con su idRecoveryCode y verifica las notas desde un Obsidian de prueba. Las cuentas y la configuración del servidor no se incluyen.\n";
    };
    const iterator = zipArchive([
      { name: "README.txt", content: readme() },
      { name: "vault.ndjson", content: records },
    ]);
    const content = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await iterator.return(undefined);
      },
    });
    c.header("Content-Type", "application/zip");
    c.header(
      "Content-Disposition",
      `attachment; filename="livesync-${vault.db.replace(/[^a-zA-Z0-9_-]/g, "_")}.zip"`,
    );
    return c.body(content);
  });
  owner.get("/vaults/:id/setup", async (c) => {
    const view = c.get("view");
    const metadata = await deps.service
      .getSetupMetadata(view.actor, c.req.param("id"))
      .catch((error: unknown) => {
        if (error instanceof ServiceError && error.code === "missing_recovery_code") return null;
        throw error;
      });
    if (!metadata) return c.redirect("/", 303);
    const body = setupPanel(view, metadata, c.req.query("existing") === "1");
    return c.html(
      page(view, "setupTitle", body, { back: "/" }).replace(
        '<meta charset="utf-8">',
        `<meta charset="utf-8"><meta name="csrf-token" content="${escape(view.csrf)}">`,
      ),
    );
  });
  owner.get("/vaults/:id/setup-metadata", async (c) =>
    c.json(await deps.service.getSetupMetadata(c.get("view").actor, c.req.param("id"))),
  );
  owner.post("/vaults/:id/uri-issued", async (c) => {
    await deps.service.recordUriIssued(c.get("view").actor, c.req.param("id"));
    const metadata = await deps.service.getSetupMetadata(c.get("view").actor, c.req.param("id"));
    return c.json({ instruction: metadata.instruction });
  });
  owner.post("/vaults/:id/verify-credentials", async (c) => {
    await deps.service.verifySetupCredentials(
      c.get("view").actor,
      c.req.param("id"),
      read(c.get("fields"), "password", false),
    );
    return c.json({ ok: true });
  });
  const personalBackup = () => {
    if (!deps.personalBackup) throw new ServiceError("backup_not_configured", 503);
    return deps.personalBackup;
  };
  const backupScript = (html: string) =>
    html.replace("</head>", '<script src="/assets/backups.js" type="module"></script></head>');
  owner.get("/backups", async (c) =>
    c.html(
      backupScript(
        page(
          c.get("view"),
          "personalBackups",
          deps.personalBackup
            ? personalBackupPanel(
                c.get("view"),
                await deps.personalBackup.status(c.get("person").id),
              )
            : notice(c.get("view"), "personalBackupUnavailable"),
          { intro: "personalBackupHelp" },
        ),
      ),
    ),
  );
  owner.get("/backups/restore", (c) =>
    c.html(
      backupScript(
        page(c.get("view"), "personalRestoreTitle", restorePanel(c.get("view")), {
          back: "/backups",
          intro: "personalBackupRecovery",
          actions: `<a class="button subtle" href="/backups/help">${icon("terminal-window")}${t(
            c.get("view"),
            "personalRestoreAdvanced",
          )}</a>`,
        }),
      ),
    ),
  );
  owner.get("/backups/help", (c) => {
    const view = c.get("view");
    const steps: MessageKey[] = [
      "personalRestoreKey",
      "personalRestoreImport",
      "personalRestoreIdentity",
      "personalRestoreVerify",
    ];
    const commands =
      "age -d -i livesync-recovery.txt -o vaults.ndjson.gz backup.ndjson.gz.age\ngzip -dc vaults.ndjson.gz > vaults.ndjson";
    return c.html(
      page(
        view,
        "personalRestoreAdvanced",
        `<section class="panel"><ol class="steps">${steps.map((key) => `<li>${t(view, key)}</li>`).join("")}</ol><pre class="overflow-x-auto"><code>${escape(commands)}</code></pre></section>`,
        { back: "/backups/restore" },
      ),
    );
  });
  owner.post("/backups/settings", async (c) => {
    const fields = c.get("fields");
    await personalBackup().settings(
      c.get("person").id,
      read(fields, "recipient"),
      Number(read(fields, "retentionDays")),
      fields.enabled === "on",
    );
    return c.redirect("/backups?done=saved", 303);
  });
  owner.get("/backups/folder-picker", async (c) => {
    const status = await personalBackup().status(c.get("person").id);
    if (!status.connected) throw new ServiceError("backup_not_configured", 400);
    if (!status.pickerAvailable) throw new ServiceError("drive_picker_not_configured", 503);
    return c.html(
      page(c.get("view"), "personalDriveChooseFolder", folderPickerPanel(c.get("view")), {
        back: "/backups",
        intro: "personalDrivePickerHelp",
      }).replace("</head>", '<script src="/assets/drive-picker.js" type="module"></script></head>'),
    );
  });
  owner.post("/backups/google/picker-session", async (c) =>
    c.json(await personalBackup().pickerSession(c.get("person").id)),
  );
  owner.post("/backups/folder", async (c) => {
    await personalBackup().chooseFolder(c.get("person").id, read(c.get("fields"), "folderId"));
    return c.redirect("/backups?done=saved", 303);
  });
  owner.post("/backups/folder/default", async (c) => {
    await personalBackup().useDefaultFolder(c.get("person").id);
    return c.redirect("/backups?done=saved", 303);
  });
  owner.get("/backups/status", async (c) =>
    c.html(
      personalBackupStatusPanel(c.get("view"), await personalBackup().status(c.get("person").id)),
    ),
  );
  owner.post("/backups/google/connect", (c) => {
    const result = personalBackup().connect(c.get("person").id);
    setCookie(c, "__Host-panel-google-state", result.state, {
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 600,
    });
    return c.html(
      page(
        c.get("view"),
        "personalBackups",
        `<section class="panel empty-state"><span class="empty-icon">${icon("google-drive-logo")}</span><a class="button primary" href="${escape(result.url)}">${t(c.get("view"), "personalDriveContinue")}${icon("arrow-square-out")}</a></section>`,
        { back: "/backups" },
      ),
    );
  });
  owner.get("/backups/google/callback", async (c) => {
    const cookie = getCookie(c, "__Host-panel-google-state");
    deleteCookie(c, "__Host-panel-google-state", { secure: true, path: "/" });
    await personalBackup().callback(
      c.get("person").id,
      c.req.query("state") ?? "",
      cookie,
      c.req.query("code") ?? "",
    );
    return c.redirect("/backups", 303);
  });
  owner.post("/backups/google/disconnect", async (c) => {
    await personalBackup().disconnect(c.get("person").id);
    return c.redirect("/backups", 303);
  });
  owner.post("/backups/request", async (c) => {
    await personalBackup().request(c.get("person").id);
    return c.redirect("/backups", 303);
  });
  return { admin, owner };
}

function navigate(c: WebContext, path: string): Response {
  if (c.req.header("HX-Request") === "true") {
    c.header("HX-Redirect", path);
    return c.body(null, 204);
  }
  return c.redirect(path, 303);
}

function loginPage(
  view: View,
  activate: boolean,
  error?: MessageKey,
  username = "",
  invitation = "",
) {
  const action = activate ? "/activate" : "/login";
  return page(
    view,
    activate ? "activateOwner" : "loginOwner",
    `<p class="muted">${t(view, activate ? "activationHelp" : "loginHelp")}</p>${error ? notice(view, error, "danger") : ""}<form class="form" method="post" action="${action}"><input type="hidden" name="csrf" value="${escape(view.csrf)}">${activate ? `<label class="field"><span>${t(view, "username")}</span><input name="username" value="${escape(username)}" readonly></label>` : ""}${field(view, activate ? "invitationCode" : "username", activate ? "invitation" : "username", { value: activate ? invitation : "" })}${field(view, "password", "password", { type: "password", minLength: activate ? 12 : undefined, generate: activate })}${activate ? field(view, "confirmPassword", "confirmPassword", { type: "password", minLength: 12, confirm: true }) : ""}${activate ? `<p class="muted">${t(view, "accountExportHelp")}</p><button class="button" type="button" data-export-account>${t(view, "exportAccount")}</button>` : ""}<button class="button primary" type="submit">${t(view, activate ? "activateOwner" : "loginOwner")}</button></form>`,
  );
}

function passwordPage(view: View, error?: MessageKey) {
  return page(
    view,
    "changePassword",
    `<section class="panel">${error ? notice(view, error, "danger") : ""}${form(
      view,
      "/password",
      field(view, "currentPassword", "currentPassword", { type: "password" }) +
        field(view, "newPassword", "password", {
          type: "password",
          minLength: 12,
          generate: true,
        }) +
        field(view, "confirmPassword", "confirmPassword", {
          type: "password",
          minLength: 12,
          confirm: true,
        }),
      "changePassword",
    )}</section>`,
    { intro: ["passwordHelp", "sensitive"] },
  );
}
const publicErrors: Record<string, MessageKey> = {
  invalid_invitation: "invitationInvalid",
  vault_delete_confirmation: "vaultDeleteConfirmationError",
  vault_shared_delete: "vaultSharedDelete",
  vault_export_busy: "vaultExportBusy",
  vault_export_too_large: "vaultExportTooLarge",
  invalid_drive_folder: "personalDriveInvalidFolder",
  drive_picker_not_configured: "personalDrivePickerUnavailable",
  invalid_backup_settings: "personalBackupInvalid",
  backup_busy: "personalBackupBusy",
  invalid_oauth_state: "personalDriveError",
  drive_request_failed: "personalDriveError",
  drive_consent_required: "personalDriveError",
  drive_already_connected: "personalDriveError",
  invalid_quota: "quotaInvalid",
  quota_exceeds_instance: "quotaAllocationExceeded",
  quota_exceeded: "quotaExceeded",
  missing_recovery_code: "unknownRecovery",
  recovery_identity_conflict: "recoveryConflict",
  invalid_recovery_code: "invalidRecovery",
  invalid_credentials: "passwordWrong",
  password_wrong: "passwordWrong",
  invalid_password: "passwordMin",
  security_drift: "securityDrift",
  resource_ownership_unknown: "ownershipUnknown",
  unrestricted_access_cannot_be_revoked: "unrestrictedAccess",
  remote_version_missing: "remoteVersionMissing",
  remote_version_incompatible: "remoteIncompatible",
  remote_requires_migration: "remoteMigration",
  remote_version_requires_migration: "remoteMigration",
  confirmation_mismatch: "confirmDatabase",
  operation_not_reconcilable: "retryForm",
  remote_contains_data: "ownershipUnknown",
  role_access_cannot_be_revoked: "roleAccess",
  global_admin_access: "roleAccess",
  database_exists_use_adoption: "useAdoption",
  account_exists_use_adoption: "useAdoption",
  login_already_registered: "alreadyRegistered",
  database_already_registered: "alreadyRegistered",
  username_already_registered: "alreadyRegistered",
  vault_limit_reached: "vaultLimit",
  invalid_text: "invalidText",
  invalid_input: "missingField",
  not_found: "notFound",
  operation_in_progress: "operationInProgress",
  reserved_database: "invalidDatabase",
  invalid_adoption: "adoptionMissing",
  database_has_validation: "adoptionValidation",
  person_mismatch: "alreadyRegistered",
  too_many_requests: "tooMany",
  account_has_no_vault_access: "accountNoAccess",
  account_not_found: "accountMissing",
  missing_access_snapshot: "missingSnapshot",
  invalid_database_name: "invalidDatabase",
  invalid_username: "invalidUsername",
  invalid_login: "invalidLogin",
  person_not_active: "retryForm",
  person_not_disabled: "retryForm",
  onboarding_not_pending: "retryForm",
  operation_input_mismatch: "retryForm",
  forbidden: "forbidden",
  backup_queue_full: "tooMany",
  backup_not_configured: "unavailable",
  backup_status_invalid: "backupUnreadable",
};
function publicError(code: string, status: number): MessageKey {
  return publicErrors[code] ?? (status < 500 ? "invalid" : "requestFailed");
}
async function backupSnapshot(backup: BackupGateway): Promise<BackupSnapshot> {
  try {
    return { status: await backup.status(), unreadable: false };
  } catch {
    return { status: null, unreadable: true };
  }
}
function backupRequestId(c: WebContext): string | undefined {
  const id = c.req.query("requestId");
  if (id && !/^[a-f0-9-]{36}$/.test(id)) throw new ServiceError("invalid_request_id", 400);
  return id;
}
function backupActions(view: View, config: AppConfig): string {
  return `<a class="button" href="/help/restore">${icon("lifebuoy")}${t(view, "restoreManual")}</a>${
    config.backupRequestsDir ? form(view, "/backups/request", "", "requestBackup") : ""
  }`;
}
function inventoryTable(view: View, databases: Inventory["databases"]): string {
  return table(
    view,
    ["database", "people", "memberRoles", "admin", "adminRoles", "warnings"],
    databases.map((database) => [
      `<code>${escape(database.name)}</code>`,
      escape(database.members.join(", ")) || "—",
      escape(database.membersRoles?.join(", ")) || "—",
      escape(database.admins.join(", ")) || "—",
      escape(database.adminsRoles?.join(", ")) || "—",
      (database.warnings ?? [])
        .map((warning) =>
          warning === "unrestricted_database"
            ? t(view, "unrestrictedDatabase")
            : t(view, "roleAccess"),
        )
        .join(" ") || "—",
    ]),
  );
}
function personFields(view: View) {
  return field(view, "name", "displayName") + field(view, "username", "couchUser");
}
function recoveryForm(view: View, action: string, tone = "danger"): string {
  return `${notice(view, "recoveryMissing", tone)}${form(
    view,
    action,
    field(view, "recovery", "idRecoveryCode"),
    "recoverySave",
  )}`;
}
function read(fields: Record<string, string>, key: string, trim = true): string {
  const value = trim ? fields[key]?.trim() : fields[key];
  if (!value || value.length > 1024) throw new ServiceError("invalid_input", 400);
  return value;
}
function adoptInput(f: Record<string, string>): AdoptVaultInput {
  return {
    displayName: read(f, "displayName"),
    tailscaleLogin: read(f, "couchUser"),
    couchUser: read(f, "couchUser"),
    label: read(f, "label"),
    db: read(f, "db"),
    ...(f.idRecoveryCode ? { idRecoveryCode: read(f, "idRecoveryCode") } : {}),
  };
}
function query(c: WebContext) {
  return { limit: 25, bookmark: c.req.query("bookmark") };
}
function nextPage(view: View, path: string, bookmark?: string) {
  return bookmark
    ? `<p><a href="${path}?bookmark=${encodeURIComponent(bookmark)}">${t(view, "next")}</a></p>`
    : "";
}
async function asset(c: WebContext, file: string) {
  if (
    !/^(app\.css|favicon\.svg|ui\.js|setup\.js|drive-picker\.js|backups\.js|htmx\.js|icons\/[a-z-]+\.svg)$/.test(
      file,
    )
  )
    return c.notFound();
  try {
    const data = await readFile(`dist/${file}`);
    const contentType = file.endsWith("css")
      ? "text/css"
      : file.endsWith("svg")
        ? "image/svg+xml"
        : "text/javascript";
    return new Response(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return c.notFound();
  }
}
