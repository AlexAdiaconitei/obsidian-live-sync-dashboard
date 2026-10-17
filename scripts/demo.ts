import { serve } from "@hono/node-server";
import { createApps } from "../src/web/apps.ts";
import type { AppConfig } from "../src/config.ts";
import {
  type AuditEvent,
  type BackupGateway,
  type BackupRun,
  type BackupStatus,
  type DashboardService,
  type PageQuery,
  type Person,
  type QuotaUsage,
  ServiceError,
  type Vault,
} from "../src/contracts.ts";
import type { PersonalBackupGateway, PersonalBackupStatus } from "../src/backup/personal.ts";

const adminLogin = "admin@demo.local";
// Owners sign in with their CouchDB username; the demo accepts this test password.
const ownerLogin = "ana";
const demoPassword = "demo-owner-password";
const now = () => new Date().toISOString();
const gib = 1024 ** 3;
const instanceLimitBytes = 10 * gib;
const defaultUserLimitBytes = gib;
const people: Person[] = [
  {
    id: "ana",
    couchUser: "ana",
    displayName: "Ana García",
    tailscaleLogin: ownerLogin,
    status: "active",
    createdAt: now(),
    quotaBytes: gib,
  },
  {
    id: "marcos",
    couchUser: "marcos",
    displayName: "Marcos López",
    tailscaleLogin: "marcos",
    status: "active",
    createdAt: now(),
    quotaBytes: 2 * gib,
  },
  {
    id: "lucia",
    couchUser: "lucia",
    displayName: "Lucía Martín",
    tailscaleLogin: "lucia",
    status: "pending_credentials",
    createdAt: now(),
    quotaBytes: gib,
  },
];
function vault(personId: string, label: string, db: string, adopted = false): Vault {
  return {
    id: crypto.randomUUID(),
    personId,
    label,
    db,
    adopted,
    createdAt: now(),
    idRecoveryCode: `sls-id-v1:${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")}`,
  };
}
const vaults: Vault[] = [
  vault("ana", "Personal notes", "obsidian-ana-notes"),
  vault("ana", "Research", "obsidian-ana-research"),
  vault("marcos", "Work", "obsidian-marcos-work"),
  vault("lucia", "Studies", "obsidian-lucia-studies"),
  { ...vault("ana", "Archive", "obsidian", true), idRecoveryCode: null },
];
const events: AuditEvent[] = [];
function audit(actor: string, action: string, target: string) {
  events.unshift({ id: crypto.randomUUID(), at: now(), actor, action, target, result: "success" });
}
audit(adminLogin, "person.created", "ana");
audit(ownerLogin, "setup.generated", vaults[0].id);
function person(id: string) {
  const value = people.find((value) => value.id === id);
  if (!value) throw new ServiceError("not_found", 404);
  return value;
}
function owner(login: string) {
  const value = people.find((value) => value.tailscaleLogin === login);
  if (!value || value.status === "disabled") throw new ServiceError("forbidden", 403);
  return value;
}
function page<T>(items: T[], query: PageQuery = {}) {
  const offset = Number(query.bookmark ?? 0);
  const limit = query.limit ?? 25;
  return {
    items: items.slice(offset, offset + limit),
    ...(offset + limit < items.length ? { bookmark: String(offset + limit) } : {}),
  };
}
function usedBytes(id: string) {
  const usage = new Map([
    ["ana", Math.round(0.32 * gib)],
    ["marcos", Math.round(0.74 * gib)],
    ["lucia", Math.round(0.08 * gib)],
  ]);
  return usage.get(id) ?? 0;
}
function quota(limitBytes: number | null, usedBytes: number): QuotaUsage {
  return {
    limitBytes,
    usedBytes,
    remainingBytes: limitBytes === null ? null : Math.max(0, limitBytes - usedBytes),
    exceeded: limitBytes !== null && usedBytes > limitBytes,
  };
}
function personalQuota(value: Person) {
  const individual = quota(
    value.quotaBytes === undefined ? defaultUserLimitBytes : value.quotaBytes,
    usedBytes(value.id),
  );
  const instance = quota(
    instanceLimitBytes,
    people.reduce((total, value) => total + usedBytes(value.id), 0),
  );
  return {
    ...individual,
    personId: value.id,
    remainingBytes:
      individual.remainingBytes === null
        ? instance.remainingBytes
        : Math.min(individual.remainingBytes, instance.remainingBytes!),
    exceeded: individual.exceeded || instance.exceeded,
  };
}
function validateLimit(limitBytes: number | null) {
  if (limitBytes !== null && (!Number.isSafeInteger(limitBytes) || limitBytes <= 0)) {
    throw new ServiceError("invalid_quota", 400);
  }
  if (limitBytes !== null && limitBytes > instanceLimitBytes) {
    throw new ServiceError("quota_exceeds_instance", 400);
  }
}
const service: DashboardService = {
  getOwnedVault: async (login, id) => {
    const value = vaults.find((vault) => vault.id === id && vault.personId === owner(login).id);
    if (!value) throw new ServiceError("not_found", 404);
    return value;
  },
  exportOwnedVault: async function* (login, id) {
    const value = await service.getOwnedVault(login, id);
    yield JSON.stringify({
      type: "manifest",
      format: "obsidian-personal-backup",
      schemaVersion: 1,
      demo: true,
      vaults: [value],
    }) + "\n";
  },
  deleteOwnedVault: async (login, id, confirmation) => {
    const value = await service.getOwnedVault(login, id);
    if (
      confirmation.label !== value.label ||
      !confirmation.acknowledged ||
      !["downloaded", "skip"].includes(confirmation.backup)
    )
      throw new ServiceError("vault_delete_confirmation", 400);
    if (confirmation.password.length < 12) throw new ServiceError("invalid_credentials", 401);
    vaults.splice(vaults.indexOf(value), 1);
    audit(login, "vault.deleted", id);
  },
  loginOwner: async (username, password) => {
    const value = people.find((person) => person.couchUser === username);
    if (!value || value.status !== "active" || password !== demoPassword)
      throw new ServiceError("invalid_credentials", 401);
    return { person: value, version: "demo" };
  },
  ownerSession: async (id, version) => {
    const value = people.find((person) => person.id === id);
    return value?.status === "active" && version === "demo" ? value : null;
  },
  revokeOwnerSessions: async () => {},
  // A placeholder token previews the invitation page; activation stays disabled.
  issueInvitation: async () => `demo-invitation.${crypto.randomUUID()}`,
  acceptInvitation: async () => {
    throw new ServiceError("forbidden", 403);
  },
  createOwnedVault: async (login, label) =>
    service.createVault(login, people.find((value) => value.tailscaleLogin === login)!.id, {
      label,
      slug: `vault_${crypto.randomUUID()}`,
    }),
  verifySetupCredentials: async () => {},
  quotaSummary: () =>
    Promise.resolve({
      instance: {
        ...quota(
          instanceLimitBytes,
          people.reduce((total, value) => total + usedBytes(value.id), 0),
        ),
        defaultUserLimitBytes,
        assignedLimitBytes: people.reduce((total, value) => total + (value.quotaBytes ?? 0), 0),
      },
      people: people.map(personalQuota),
    }),
  personQuota: (login) => {
    const value = owner(login);
    return Promise.resolve(personalQuota(value));
  },
  setPersonQuota: (actor, id, limitBytes) => {
    validateLimit(limitBytes);
    person(id).quotaBytes = limitBytes;
    audit(actor, "person.quota_change", id);
    return Promise.resolve();
  },
  initialize: () => Promise.resolve(),
  health: () => Promise.resolve({ up: true, version: "3.5.2 · demo" }),
  listPeople: (query) => Promise.resolve(page(people, query)),
  getPerson: (id) => Promise.resolve(person(id)),
  findPersonByLogin: (login) =>
    Promise.resolve(people.find((person) => person.tailscaleLogin === login) ?? null),
  listVaults: (id, query) =>
    Promise.resolve(
      page(
        vaults.filter((vault) => vault.personId === id),
        query,
      ),
    ),
  createPerson: (actor, input) => {
    validateLimit(input.quotaBytes === undefined ? defaultUserLimitBytes : input.quotaBytes);
    if (
      people.some(
        (person) =>
          person.couchUser === input.couchUser || person.tailscaleLogin === input.tailscaleLogin,
      )
    )
      throw new ServiceError("login_already_registered", 409);
    const value: Person = {
      id: crypto.randomUUID(),
      couchUser: input.couchUser,
      displayName: input.displayName,
      tailscaleLogin: input.tailscaleLogin,
      status: "pending_credentials",
      createdAt: now(),
      quotaBytes: input.quotaBytes === undefined ? defaultUserLimitBytes : input.quotaBytes,
    };
    people.push(value);
    if (input.vaultLabel && input.vaultSlug)
      vaults.push(vault(value.id, input.vaultLabel, input.vaultSlug));
    audit(actor, "person.created", value.id);
    return Promise.resolve(value);
  },
  createVault: (actor, id, input) => {
    person(id);
    if (vaults.some((vault) => vault.db === input.slug)) {
      throw new ServiceError("database_already_registered", 409);
    }
    const value = vault(id, input.label, input.slug);
    vaults.push(value);
    audit(actor, "vault.created", value.id);
    return Promise.resolve(value);
  },
  inventory: () =>
    Promise.resolve({
      users: [
        ...people.map((person) => ({ name: person.couchUser, roles: [], managed: true })),
        {
          name: "kuma",
          roles: [],
          managed: false,
        },
        { name: "legacy", roles: [], managed: false },
      ],
      databases: [
        ...vaults.map((vault) => ({
          name: vault.db,
          members: [person(vault.personId).couchUser],
          admins: [],
          managed: true,
          membersRoles: ["_admin"],
          adminsRoles: ["_admin"],
        })),
        {
          name: "obsidian-legacy",
          members: ["legacy"],
          admins: [],
          managed: false,
          membersRoles: ["_admin"],
          adminsRoles: ["_admin"],
        },
      ],
    }),
  adoptVault: (actor, input) => {
    let existing = people.find((person) => person.tailscaleLogin === input.tailscaleLogin);
    if (!existing) {
      existing = {
        id: crypto.randomUUID(),
        displayName: input.displayName,
        couchUser: input.couchUser,
        tailscaleLogin: input.tailscaleLogin,
        status: "active",
        createdAt: now(),
        quotaBytes: defaultUserLimitBytes,
      };
      people.push(existing);
    }
    const value = vault(existing.id, input.label, input.db, true);
    value.idRecoveryCode = input.idRecoveryCode ?? null;
    vaults.push(value);
    audit(actor, "vault.adopted", value.id);
    return Promise.resolve(value);
  },
  setInitialPassword: (login) => {
    owner(login).status = "active";
    audit(login, "credentials.initialized", owner(login).id);
    return Promise.resolve();
  },
  changePassword: (login) => {
    audit(login, "credentials.changed", owner(login).id);
    return Promise.resolve();
  },
  resetPassword: (actor, id) => {
    person(id).status = "pending_credentials";
    audit(actor, "credentials.reset_requested", id);
    return Promise.resolve();
  },
  setPersonEnabled: (actor, id, enabled) => {
    person(id).status = enabled ? "active" : "disabled";
    audit(actor, enabled ? "person.enabled" : "person.disabled", id);
    return Promise.resolve();
  },
  reconcileVaultOwnership: (actor, id) => {
    const value = vaults.find((vault) => vault.id === id);
    if (!value) throw new ServiceError("not_found", 404);
    audit(actor, "vault.reconciled", id);
    return Promise.resolve(value);
  },
  getSetupMetadata: (login, id) => {
    const value = vaults.find((vault) => vault.id === id);
    const account = owner(login);
    if (!value || value.personId !== account.id || account.status !== "active") {
      throw new ServiceError("forbidden", 403);
    }
    if (!value.idRecoveryCode) throw new ServiceError("missing_recovery_code", 409);
    return Promise.resolve({
      vaultId: value.id,
      label: value.label,
      hostname: "https://notes.demo.invalid",
      database: value.db,
      username: account.couchUser,
      idRecoveryCode: value.idRecoveryCode,
      instruction: "additional",
    });
  },
  recordUriIssued: (login, id) => {
    audit(login, "setup.generated", id);
    return Promise.resolve();
  },
  registerRecoveryCode: (actor, id, code, options) => {
    const value = vaults.find((vault) => vault.id === id);
    if (!value || (options?.asOwner && value.personId !== owner(actor).id)) {
      throw new ServiceError("forbidden", 403);
    }
    if (!/^sls-id-v1:[0-9a-f]{64}$/.test(code)) {
      throw new ServiceError("invalid_recovery_code", 400);
    }
    if (value.idRecoveryCode && value.idRecoveryCode !== code) {
      throw new ServiceError("recovery_identity_conflict", 409);
    }
    value.idRecoveryCode = code;
    audit(actor, "vault.recovery_registered", id);
    return Promise.resolve();
  },
  recordBackupRequested: (actor, id) => {
    audit(actor, "backup.requested", id);
    return Promise.resolve();
  },
  listEvents: (query) => Promise.resolve(page(events, query)),
  stats: () =>
    Promise.resolve(
      vaults.map((vault, index) => ({
        vaultId: vault.id,
        db: vault.db,
        docCount: [1482, 386, 924, 75][index % 4],
        sizeFile: [18_600_000, 7_900_000, 12_400_000, 2_100_000][index % 4],
        sizeActive: [14_100_000, 6_200_000, 9_700_000, 1_800_000][index % 4],
      })),
    ),
};

const successful: BackupRun = {
  requestId: crypto.randomUUID(),
  actor: "worker",
  trigger: "cron",
  startedAt: new Date(Date.now() - 3_600_000).toISOString(),
  endedAt: new Date(Date.now() - 3_550_000).toISOString(),
  outcome: "success",
  file: "obsidian-couchdb-demo.tar.gz.age",
  sizeBytes: 15_600_000,
  error: null,
  uploadOk: true,
  retentionOk: true,
  notificationOk: true,
};
const status: BackupStatus = {
  schemaVersion: 1,
  running: null,
  lastAttempt: successful,
  lastSuccess: successful,
  history: [successful],
  schedule: "30 3 * * *",
  timezone: "Europe/Madrid",
  retentionDays: 30,
};
const backup: BackupGateway = {
  status: () => Promise.resolve(structuredClone(status)),
  request: (actor) => {
    if (status.running) return Promise.resolve({ requestId: status.running.requestId });
    const run: BackupRun = {
      ...successful,
      requestId: crypto.randomUUID(),
      actor,
      trigger: "manual",
      startedAt: now(),
      endedAt: null,
      outcome: "running",
      file: null,
      sizeBytes: null,
      uploadOk: false,
      retentionOk: false,
      notificationOk: false,
    };
    status.running = run;
    status.lastAttempt = run;
    setTimeout(() => {
      Object.assign(run, {
        endedAt: now(),
        outcome: "success",
        file: successful.file,
        sizeBytes: successful.sizeBytes,
        uploadOk: true,
        retentionOk: true,
        notificationOk: true,
      });
      status.running = null;
      status.lastSuccess = run;
      status.history.unshift(run);
    }, 2000);
    return Promise.resolve({ requestId: run.requestId });
  },
};
const adminPort = Number(process.env.DEMO_ADMIN_PORT ?? 5173);
const ownerPort = Number(process.env.DEMO_OWNER_PORT ?? 5174);
const config: AppConfig = {
  couchdbUrl: "https://unconnected.demo.invalid",
  couchdbUsername: "demo",
  couchdbPassword: "not-a-real-password",
  publicCouchdbUrl: "https://notes.demo.invalid",
  adminOrigin: `http://127.0.0.1:${adminPort}`,
  ownerOrigin: `http://127.0.0.1:${ownerPort}`,
  admins: [adminLogin],
  panelDb: "demo_memory",
  csrfSecret: crypto.randomUUID() + crypto.randomUUID(),
  backupRequestsDir: "demo_memory",
  backupMaxAgeHours: 26,
};
const personalStatus: PersonalBackupStatus = {
  connected: true,
  folderId: "demo-folder",
  folderName: "obsidian-livesync-backups",
  pickerAvailable: true,
  recipient: "age1demo0000000000000000000000000000000000000000000000000000",
  retentionDays: 30,
  enabled: true,
  running: false,
  lastAttempt: successful.endedAt,
  lastSuccess: successful.endedAt,
  error: null,
};
// Drive is never contacted: every call only edits the in-memory status.
const personalBackup: PersonalBackupGateway = {
  status: () => Promise.resolve(structuredClone(personalStatus)),
  settings: (_id, recipient, retentionDays, enabled) => {
    Object.assign(personalStatus, { recipient, retentionDays, enabled });
    return Promise.resolve();
  },
  connect: () => ({ url: "/backups/google/callback?state=demo&code=demo", state: "demo" }),
  callback: () => {
    personalStatus.connected = true;
    return Promise.resolve();
  },
  disconnect: () => {
    personalStatus.connected = false;
    return Promise.resolve();
  },
  request: () => {
    personalStatus.lastAttempt = now();
    personalStatus.lastSuccess = now();
    return Promise.resolve();
  },
  pickerSession: () => Promise.reject(new ServiceError("drive_picker_not_configured", 503)),
  chooseFolder: () => Promise.resolve(),
  useDefaultFolder: () => Promise.resolve(),
};
const apps = createApps({ config, service, backup, personalBackup });

async function preview(request: Request, surface: "admin" | "owner") {
  const url = new URL(request.url);
  if (url.hostname === "localhost" && request.method === "GET") {
    url.hostname = "127.0.0.1";
    return Response.redirect(url, 302);
  }
  if (url.hostname !== "127.0.0.1") return new Response("Local demo only", { status: 403 });
  const headers = new Headers(request.headers);
  // Only administration trusts the Tailscale identity header; owners sign in.
  if (surface === "admin") headers.set("Tailscale-User-Login", adminLogin);
  // Demo-only cookie translation keeps production Secure cookies unchanged.
  headers.set("Cookie", (headers.get("Cookie") ?? "").replaceAll("demo-panel-", "__Host-panel-"));
  const response = await apps[surface].fetch(new Request(request.clone(), { headers }));
  const outgoing = new Headers(response.headers);
  const cookies = outgoing.getSetCookie();
  outgoing.delete("Set-Cookie");
  for (const cookie of cookies) {
    outgoing.append(
      "Set-Cookie",
      cookie.replaceAll("__Host-panel-", "demo-panel-").replace(/;\s*Secure\b/gi, ""),
    );
  }
  if (outgoing.get("Content-Type")?.includes("text/html")) {
    const body = (await response.text()).replace(
      '<main id="main" tabindex="-1">',
      '<main id="main" tabindex="-1"><p class="notice info" role="status">Local demo · fictional data · use test passwords only · not connected to any server.</p>',
    );
    return new Response(body, { status: response.status, headers: outgoing });
  }
  return new Response(response.body, { status: response.status, headers: outgoing });
}

serve({
  hostname: "127.0.0.1",
  port: adminPort,
  fetch: (request) => preview(request, "admin"),
  overrideGlobalObjects: false,
});
serve({
  hostname: "127.0.0.1",
  port: ownerPort,
  fetch: (request) => preview(request, "owner"),
  overrideGlobalObjects: false,
});
console.log(`Demo administration: http://127.0.0.1:${adminPort}`);
console.log(`Demo owner: http://127.0.0.1:${ownerPort} (${ownerLogin} / ${demoPassword})`);
