import type {
  AdoptVaultInput,
  AuditEvent,
  CouchHealth,
  CreatePersonInput,
  DashboardService,
  Inventory,
  Page,
  PageQuery,
  Person,
  OwnerSession,
  PersonQuota,
  QuotaSummary,
  SetupMetadata,
  Vault,
  VaultStats,
} from "../contracts.ts";
import { ServiceError } from "../contracts.ts";
import {
  assertLiveSyncVersion,
  ensureLiveSyncMilestone,
  hasRemoteUserContent,
  initializeLiveSyncVersion,
} from "../couchdb/livesync.ts";
import {
  type CouchClient,
  type CouchDocument,
  CouchError,
  type CouchSecurity,
  type CouchUser,
  restrictedSecurity,
} from "../couchdb/client.ts";
import {
  DomainError,
  grantAccess,
  newRecoveryCode,
  revokeAccess,
  securityEqual,
  validateDatabaseName,
  validatePassword,
  validateRecoveryCode,
  validateUsername,
} from "./security.ts";
import { guardId, QuotaManager, type QuotaSettings } from "./quota.ts";
import { documentBytes } from "../quota/bytes.ts";
import { vaultRecords } from "../backup/export.ts";
import { VER, VERSIONING_DOCID } from "@vrtmrz/livesync-commonlib/compat/common/types";

// No account can take this name: usernames must start with a letter or digit.
const unknownAccount = "-livesync-dashboard-no-account";
// Each vault is a CouchDB database. Owners create their own; administrators are not limited.
export const OWNER_VAULT_LIMIT = 20;

interface Stored extends CouchDocument {
  kind: string;
  schemaVersion: 1;
}
interface PersonDoc extends Stored {
  kind: "person";
  value: Person;
  operationId: string;
  transition?: "enable" | "disable" | "reset";
  resumeStatus?: "active" | "pending_credentials";
  pendingLogin?: { old: string; next: string; actor: string };
  sessionVersion?: string;
  invitation?: { hash: string; expires: number };
}
interface VaultDoc extends Stored {
  kind: "vault";
  value: Vault;
  operationId: string;
  provisioned: boolean;
  security: CouchSecurity;
  suspendedSecurity?: CouchSecurity;
  pendingSecurity?: { from: CouchSecurity; to: CouchSecurity };
  ownershipConfirmation?: { actor: string; at: string };
  deletion?: { actor: string; token: string };
}
interface Claim extends Stored {
  kind: "claim";
  owner: string;
}
interface Operation extends Stored {
  kind: "operation";
  action: string;
  actor: string;
  person?: Person;
  vault?: Vault;
  security?: CouchSecurity;
  state: "pending" | "complete";
  at: string;
}
interface EventDoc extends Stored {
  kind: "event";
  value: AuditEvent;
}

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

export class CouchDashboardService implements DashboardService {
  readonly quotas: QuotaManager;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly exporting = new Set<string>();
  private statsEpoch = 0;
  private statsCache: { expires: number; items: VaultStats[] } | null = null;
  private statsLoading: { epoch: number; task: Promise<VaultStats[]> } | null = null;

  constructor(
    private readonly client: CouchClient,
    private readonly panelDb: string,
    private readonly publicCouchdbUrl: string,
    quotaSettings: QuotaSettings = { instanceLimitBytes: null, defaultUserLimitBytes: null },
  ) {
    validateDatabaseName(panelDb);
    this.quotas = new QuotaManager(client, panelDb, quotaSettings);
  }

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const task = this.queue.then(run, run);
    this.queue = task.catch(() => {});
    return task;
  }

  private mutation<T>(
    actor: string,
    action: string,
    target: string,
    run: () => Promise<T>,
  ): Promise<T> {
    return this.serial(async () => {
      this.statsEpoch++;
      this.statsCache = null;
      try {
        return await run();
      } catch (error) {
        await this.audit(actor, action, target, "failure").catch(() => {});
        throw error;
      } finally {
        this.statsEpoch++;
        this.statsCache = null;
      }
    });
  }

  async initialize(): Promise<void> {
    const created = await this.client.createDatabase(this.panelDb);
    const schema = await this.client.get<Stored>(this.panelDb, "schema");
    if ((!created && !schema) || (schema && schema.kind !== "schema")) {
      throw new DomainError("registry_database_not_owned");
    }
    if (schema && schema.schemaVersion !== 1) throw new DomainError("unsupported_schema");
    if (!schema) {
      await this.client.put(this.panelDb, { _id: "schema", kind: "schema", schemaVersion: 1 });
    }
    await this.client.setSecurity(this.panelDb, restrictedSecurity());
    await this.client.request(`${encodeURIComponent(this.panelDb)}/_index`, "POST", {
      index: { fields: ["kind", "value.createdAt", "_id"] },
      ddoc: "dashboard-kind",
      name: "dashboard-kind",
      type: "json",
    });
    await this.client.request(`${encodeURIComponent(this.panelDb)}/_index`, "POST", {
      index: { fields: ["kind", "value.personId", "_id"] },
      ddoc: "dashboard-owner",
      name: "dashboard-owner",
      type: "json",
    });
    // Replay journalled changes; credentials are never available to replay.
    for (const vault of await this.all<VaultDoc>("vault")) {
      if (vault.deletion) {
        await this.finishVaultDeletion(vault);
        continue;
      }
      if (vault.pendingSecurity) await this.applyPendingSecurity(vault);
    }
    for (const person of await this.all<PersonDoc>("person")) {
      if (person.pendingLogin) await this.serial(() => this.finishLoginChange(person));
      if (person.transition) await this.serial(() => this.finishTransition(person));
    }
    await this.quotas.initialize();
  }

  async health(): Promise<CouchHealth> {
    try {
      const up = await this.client.request<{ status: string }>("_up");
      if (up.status !== "ok") return { up: false, version: null };
      const result = await this.client.request<{ version: string }>("");
      return { up: true, version: result.version };
    } catch {
      return { up: false, version: null };
    }
  }

  private async page<T extends Stored>(
    kind: string,
    query: PageQuery = {},
    extra: Record<string, unknown> = {},
  ): Promise<Page<T>> {
    const limit = query.limit ?? 25;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (query.bookmark?.length ?? 0) > 4096
    )
      throw new DomainError("invalid_page", 400);
    const result = await this.client.request<{ docs: T[]; bookmark?: string }>(
      `${encodeURIComponent(this.panelDb)}/_find`,
      "POST",
      {
        selector: { kind, ...extra },
        limit,
        ...(query.bookmark ? { bookmark: query.bookmark } : {}),
      },
    );
    return {
      items: result.docs,
      bookmark: result.docs.length === limit ? result.bookmark : undefined,
    };
  }

  private async all<T extends Stored>(
    kind: string,
    extra: Record<string, unknown> = {},
  ): Promise<T[]> {
    const values: T[] = [];
    let bookmark: string | undefined;
    do {
      const page = await this.page<T>(kind, { limit: 100, bookmark }, extra);
      values.push(...page.items);
      if (page.bookmark === bookmark) break;
      bookmark = page.bookmark;
    } while (bookmark);
    return values;
  }

  async listPeople(query?: PageQuery): Promise<Page<Person>> {
    const page = await this.page<PersonDoc>("person", query);
    return { items: page.items.map((doc) => doc.value), bookmark: page.bookmark };
  }

  private async person(id: string): Promise<PersonDoc> {
    const doc = await this.client.get<PersonDoc>(this.panelDb, `person:${id}`);
    if (!doc || doc.kind !== "person") throw new DomainError("not_found", 404);
    return doc;
  }

  private async vault(id: string): Promise<VaultDoc> {
    const doc = await this.client.get<VaultDoc>(this.panelDb, `vault:${id}`);
    if (!doc || doc.kind !== "vault") throw new DomainError("not_found", 404);
    return doc;
  }

  async getPerson(id: string): Promise<Person> {
    return (await this.person(id)).value;
  }

  async findPersonByLogin(login: string): Promise<Person | null> {
    const claim = await this.client.get<Claim>(this.panelDb, await claimId("login", login));
    if (!claim) return null;
    const doc = await this.client.get<PersonDoc>(this.panelDb, `person:${claim.owner}`);
    return doc?.value.tailscaleLogin === login && !doc.pendingLogin ? doc.value : null;
  }

  async listVaults(personId: string, query?: PageQuery): Promise<Page<Vault>> {
    await this.person(personId);
    const page = await this.page<VaultDoc>("vault", query, { "value.personId": personId });
    return {
      items: page.items.map((doc) => ({ ...doc.value, provisioning: !doc.provisioned })),
      bookmark: page.bookmark,
    };
  }

  private async claim(type: string, name: string, owner: string): Promise<void> {
    const key = await claimId(type, name);
    const existing = await this.client.get<Claim>(this.panelDb, key);
    if (existing) {
      if (existing.owner !== owner) throw new DomainError(`${type}_already_registered`);
      return;
    }
    await this.client.put(this.panelDb, { _id: key, kind: "claim", schemaVersion: 1, owner });
  }

  createPerson(actor: string, input: CreatePersonInput): Promise<Person> {
    return this.mutation(actor, "person.create", input.tailscaleLogin, async () => {
      validateUsername(input.couchUser);
      const hasVault = !!input.vaultSlug;
      if (hasVault) validateDatabaseName(input.vaultSlug!);
      validateText(input.displayName);
      if (hasVault) validateText(input.vaultLabel ?? "");
      if (!hasVault && input.vaultLabel) throw new DomainError("invalid_input", 400);
      validateLogin(input.tailscaleLogin);
      if (input.quotaBytes !== undefined) this.quotas.validatePersonLimit(input.quotaBytes);
      if (input.vaultSlug === this.panelDb) throw new DomainError("reserved_database");
      if ((await this.client.globalAdminNames()).includes(input.couchUser)) {
        throw new DomainError("global_admin_access");
      }
      const existing = await this.findPersonByLogin(input.tailscaleLogin);
      let person: PersonDoc;
      if (existing) {
        person = await this.person(existing.id);
        if (person.transition || person.pendingLogin) {
          throw new DomainError("operation_in_progress");
        }
        if (existing.couchUser !== input.couchUser || existing.displayName !== input.displayName) {
          throw new DomainError("login_already_registered");
        }
        const operation = await this.client.get<Operation>(
          this.panelDb,
          `operation:${person.operationId}`,
        );
        if (
          !operation ||
          operation.vault?.db !== input.vaultSlug ||
          operation.vault?.label !== input.vaultLabel
        )
          throw new DomainError("login_already_registered");
        if (person.value.status !== "provisioning") return person.value;
        if (operation.vault) await this.claim("database", input.vaultSlug!, operation.vault.id);
        if (
          operation.vault &&
          !(await this.client.get(this.panelDb, `vault:${operation.vault.id}`))
        ) {
          await this.client.put(
            this.panelDb,
            this.vaultDocument(operation.vault, person.operationId),
          );
        }
      } else {
        const pending = (
          await this.page<Operation>(
            "operation",
            { limit: 1 },
            {
              action: "create_person",
              state: "pending",
              "person.tailscaleLogin": input.tailscaleLogin,
            },
          )
        ).items[0];
        if (
          pending &&
          (pending.person?.couchUser !== input.couchUser ||
            pending.person?.displayName !== input.displayName ||
            pending.vault?.db !== input.vaultSlug ||
            pending.vault?.label !== input.vaultLabel)
        )
          throw new DomainError("operation_input_mismatch");
        if (!pending) {
          if (await this.client.get("_users", `org.couchdb.user:${input.couchUser}`)) {
            throw new DomainError("account_exists_use_adoption");
          }
          if (hasVault) await this.assertDatabaseAbsent(input.vaultSlug!);
        }
        const personValue: Person = pending?.person ?? {
          id: id(),
          couchUser: input.couchUser,
          displayName: input.displayName,
          tailscaleLogin: input.tailscaleLogin,
          status: "provisioning",
          createdAt: now(),
          ...(input.quotaBytes !== undefined ? { quotaBytes: input.quotaBytes } : {}),
        };
        const operationId = pending?._id.slice("operation:".length) ?? id();
        person = {
          _id: `person:${personValue.id}`,
          kind: "person",
          schemaVersion: 1,
          value: personValue,
          operationId,
        };
        const vaultValue =
          pending?.vault ??
          (hasVault
            ? this.newVault(personValue.id, input.vaultSlug!, input.vaultLabel!)
            : undefined);
        if (!pending) {
          await this.client.put(this.panelDb, {
            _id: `operation:${operationId}`,
            kind: "operation",
            schemaVersion: 1,
            action: "create_person",
            actor,
            person: personValue,
            ...(vaultValue ? { vault: vaultValue } : {}),
            state: "pending",
            at: now(),
          });
        }
        await this.claim("account", input.couchUser, personValue.id);
        await this.claim("login", input.tailscaleLogin, personValue.id);
        if (vaultValue) await this.claim("database", input.vaultSlug!, vaultValue.id);
        person = await this.client.put(this.panelDb, person);
        if (vaultValue && !(await this.client.get(this.panelDb, `vault:${vaultValue.id}`))) {
          await this.client.put(this.panelDb, this.vaultDocument(vaultValue, operationId));
        }
      }
      const username = person.value.couchUser;
      const user = await this.client.get<CouchUser>("_users", `org.couchdb.user:${username}`);
      if (user && user.dashboardOperation !== person.operationId) {
        throw new DomainError("resource_ownership_unknown");
      }
      if (!user) {
        await this.client.put("_users", {
          _id: `org.couchdb.user:${username}`,
          name: username,
          type: "user",
          roles: [],
          password: `${id()}${id()}`,
          dashboardOperation: person.operationId,
        });
      }
      for (const vault of await this.all<VaultDoc>("vault", { "value.personId": person.value.id }))
        await this.provisionVault(vault, false, username);
      person.value.status = "pending_credentials";
      person = await this.client.put(this.panelDb, person);
      await this.complete(person.operationId);
      await this.audit(actor, "person.created", person.value.id);
      return person.value;
    });
  }

  private newVault(personId: string, db: string, label: string): Vault {
    return {
      id: id(),
      personId,
      db,
      label,
      idRecoveryCode: newRecoveryCode(),
      adopted: false,
      createdAt: now(),
      uriIssuedAt: null,
    };
  }

  private vaultDocument(value: Vault, operationId: string): VaultDoc {
    return {
      _id: `vault:${value.id}`,
      kind: "vault",
      schemaVersion: 1,
      value,
      operationId,
      provisioned: false,
      security: restrictedSecurity(),
    };
  }

  // The quota gateway writes with administrator credentials, and validation functions usually
  // let administrators through. A vault's own rules would stop applying after adoption.
  private async assertNoOwnValidation(db: string): Promise<void> {
    const designs = await this.client.request<{
      rows: Array<{ id: string; doc?: { validate_doc_update?: unknown } }>;
    }>(
      `${encodeURIComponent(db)}/_all_docs?${new URLSearchParams({
        startkey: JSON.stringify("_design/"),
        endkey: JSON.stringify("_design0"),
        include_docs: "true",
      })}`,
    );
    if (designs.rows.some((row) => row.id !== guardId && row.doc?.validate_doc_update)) {
      throw new DomainError("database_has_validation");
    }
  }

  private async assertDatabaseAbsent(db: string): Promise<void> {
    try {
      await this.client.request(encodeURIComponent(db));
    } catch (error) {
      if (error instanceof CouchError && error.status === 404) return;
      throw error;
    }
    throw new DomainError("database_exists_use_adoption");
  }

  private async provisionVault(
    vault: VaultDoc,
    activate: boolean,
    username: string,
  ): Promise<void> {
    if (vault.provisioned) return;
    const database = vault.value.db;
    const marker = await this.client.get<CouchDocument>(database, "_local/dashboard-owner");
    if (!marker) {
      if (!(await this.client.createDatabase(database))) {
        throw new DomainError("resource_ownership_unknown");
      }
      await this.client.put(database, {
        _id: "_local/dashboard-owner",
        operationId: vault.operationId,
        vaultId: vault.value.id,
      });
    } else if (marker.operationId !== vault.operationId || marker.vaultId !== vault.value.id) {
      throw new DomainError("resource_ownership_unknown");
    }
    const security = activate ? grantAccess(restrictedSecurity(), username) : restrictedSecurity();
    const actual = await this.client.security(database);
    if (!securityEqual(actual, restrictedSecurity()) && !securityEqual(actual, security)) {
      throw new DomainError("security_drift");
    }
    await this.client.setSecurity(database, security);
    await this.quotas.registerVault(database, vault.value.personId);
    if (await this.client.get(database, VERSIONING_DOCID)) {
      await assertLiveSyncVersion(this.client, database);
    } else {
      await this.quotas.withWrite(
        database,
        [VERSIONING_DOCID],
        (leaves) =>
          leaves.get(VERSIONING_DOCID)?.some((leaf) => leaf.bytes > 0)
            ? 0
            : documentBytes({ _id: VERSIONING_DOCID, version: VER, type: "versioninfo" }),
        () => initializeLiveSyncVersion(this.client, database),
      );
    }
    if (!vault.value.adopted && !(await hasRemoteUserContent(this.client, database))) {
      await ensureLiveSyncMilestone(this.client, database);
    }
    await this.quotas.installGuard(database);
    vault.security = security;
    vault.provisioned = true;
    await this.client.put(this.panelDb, vault);
  }

  reconcileVaultOwnership(
    actor: string,
    vaultId: string,
    confirmedDatabase: string,
  ): Promise<Vault> {
    return this.mutation(actor, "vault.ownership_reconcile", vaultId, async () => {
      let vault = await this.vault(vaultId);
      if (confirmedDatabase !== vault.value.db) throw new DomainError("confirmation_mismatch", 400);
      if (vault.provisioned || vault.value.adopted) {
        throw new DomainError("operation_not_reconcilable");
      }
      const operation = await this.client.get<Operation>(
        this.panelDb,
        `operation:${vault.operationId}`,
      );
      if (
        !operation ||
        operation.state !== "pending" ||
        !["create_person", "create_vault"].includes(operation.action) ||
        operation.vault?.id !== vaultId ||
        operation.vault.db !== confirmedDatabase ||
        operation.vault.personId !== vault.value.personId
      )
        throw new DomainError("operation_not_reconcilable");
      const claim = await this.client.get<Claim>(
        this.panelDb,
        await claimId("database", confirmedDatabase),
      );
      if (claim?.owner !== vaultId) throw new DomainError("resource_ownership_unknown");
      let person = await this.person(vault.value.personId);
      if (
        person.transition ||
        person.pendingLogin ||
        !["active", "pending_credentials", "provisioning"].includes(person.value.status)
      )
        throw new DomainError("operation_in_progress");
      const accountClaim = await this.client.get<Claim>(
        this.panelDb,
        await claimId("account", person.value.couchUser),
      );
      const loginClaim = await this.client.get<Claim>(
        this.panelDb,
        await claimId("login", person.value.tailscaleLogin),
      );
      if (accountClaim?.owner !== person.value.id || loginClaim?.owner !== person.value.id) {
        throw new DomainError("resource_ownership_unknown");
      }
      const user = await this.client.get<CouchUser>(
        "_users",
        `org.couchdb.user:${person.value.couchUser}`,
      );
      if (!user) throw new DomainError("resource_ownership_unknown");
      if (
        operation.action === "create_person" &&
        (operation.person?.id !== person.value.id ||
          operation.person.couchUser !== person.value.couchUser ||
          user.dashboardOperation !== person.operationId ||
          person.operationId !== vault.operationId)
      )
        throw new DomainError("resource_ownership_unknown");
      if (
        (await this.client.globalAdminNames()).includes(person.value.couchUser) ||
        user.roles.includes("_admin")
      )
        throw new DomainError("global_admin_access");
      await this.client.request(encodeURIComponent(confirmedDatabase));
      const marker = await this.client.get<CouchDocument>(
        confirmedDatabase,
        "_local/dashboard-owner",
      );
      if (
        marker &&
        (!vault.ownershipConfirmation ||
          marker.operationId !== vault.operationId ||
          marker.vaultId !== vaultId)
      )
        throw new DomainError("resource_ownership_unknown");
      const target =
        person.value.status === "active"
          ? grantAccess(restrictedSecurity(), person.value.couchUser)
          : restrictedSecurity();
      const security = await this.client.security(confirmedDatabase);
      // A retry may already have applied the confirmed operation's ACL.
      if (
        !securityEqual(security, restrictedSecurity()) &&
        !(marker && vault.ownershipConfirmation && securityEqual(security, target))
      )
        throw new DomainError("security_drift");
      if (await hasRemoteUserContent(this.client, confirmedDatabase)) {
        throw new DomainError("remote_contains_data");
      }
      try {
        await assertLiveSyncVersion(this.client, confirmedDatabase);
      } catch (error) {
        if (!(error instanceof ServiceError) || error.code !== "remote_version_missing") {
          throw error;
        }
      }
      if (!vault.ownershipConfirmation) {
        vault.ownershipConfirmation = { actor, at: now() };
        vault = await this.client.put(this.panelDb, vault);
      }
      if (!marker) {
        await this.client.put(confirmedDatabase, {
          _id: "_local/dashboard-owner",
          operationId: vault.operationId,
          vaultId,
        });
      }
      await this.provisionVault(vault, person.value.status === "active", person.value.couchUser);
      if (operation.action === "create_person") {
        const ownedVaults = await this.all<VaultDoc>("vault", {
          "value.personId": person.value.id,
        });
        if (
          ownedVaults.every((item) => item.provisioned) &&
          person.value.status === "provisioning"
        ) {
          person.value.status = "pending_credentials";
          person = await this.client.put(this.panelDb, person);
          await this.complete(person.operationId);
        }
      } else await this.complete(vault.operationId);
      await this.audit(actor, "vault.ownership_reconciled", vaultId);
      return vault.value;
    });
  }

  createVault(
    actor: string,
    personId: string,
    input: { label: string; slug: string },
    maxVaults?: number,
  ): Promise<Vault> {
    return this.mutation(actor, "vault.create", personId, async () => {
      if (maxVaults !== undefined) {
        const owned = (await this.all<VaultDoc>("vault", { "value.personId": personId })).find(
          (item) => item.value.label === input.label,
        );
        const pending = owned
          ? undefined
          : (
              await this.all<Operation>("operation", {
                action: "create_vault",
                state: "pending",
                "vault.personId": personId,
                "vault.label": input.label,
              })
            )[0];
        if (owned?.deletion) throw new DomainError("operation_in_progress");
        const knownDatabase = owned?.value.db ?? pending?.vault?.db;
        if (knownDatabase) input = { ...input, slug: knownDatabase };
      }
      validateDatabaseName(input.slug);
      validateText(input.label);
      if (input.slug === this.panelDb) throw new DomainError("reserved_database");
      const person = await this.person(personId);
      if (!["active", "pending_credentials"].includes(person.value.status)) {
        throw new DomainError("person_not_active");
      }
      const claim = await this.client.get<Claim>(
        this.panelDb,
        await claimId("database", input.slug),
      );
      let vault: VaultDoc;
      const existingVault = claim
        ? await this.client.get<VaultDoc>(this.panelDb, `vault:${claim.owner}`)
        : undefined;
      if (existingVault) {
        vault = existingVault;
        if (vault.deletion) throw new DomainError("operation_in_progress");
        if (
          vault.value.personId !== personId ||
          vault.value.label !== input.label ||
          (vault.value.adopted && (maxVaults === undefined || !vault.provisioned))
        )
          throw new DomainError("database_already_registered");
        if (vault.provisioned) return vault.value;
      } else {
        const pending = (
          await this.page<Operation>(
            "operation",
            { limit: 1 },
            {
              action: "create_vault",
              state: "pending",
              "vault.db": input.slug,
            },
          )
        ).items[0];
        if (claim && (!pending || pending.vault?.id !== claim.owner)) {
          throw new DomainError("resource_ownership_unknown");
        }
        if (
          pending &&
          (pending.vault?.personId !== personId || pending.vault.label !== input.label)
        )
          throw new DomainError("operation_input_mismatch");
        if (
          !pending &&
          maxVaults !== undefined &&
          (await this.all<VaultDoc>("vault", { "value.personId": personId })).length >= maxVaults
        )
          throw new DomainError("vault_limit_reached");
        if (!pending) await this.assertDatabaseAbsent(input.slug);
        const value = pending?.vault ?? this.newVault(personId, input.slug, input.label);
        const operationId = pending?._id.slice("operation:".length) ?? id();
        if (!pending) {
          await this.client.put(this.panelDb, {
            _id: `operation:${operationId}`,
            kind: "operation",
            schemaVersion: 1,
            action: "create_vault",
            actor,
            vault: value,
            state: "pending",
            at: now(),
          });
        }
        await this.claim("database", input.slug, value.id);
        vault = await this.client.put(this.panelDb, this.vaultDocument(value, operationId));
      }
      await this.provisionVault(vault, person.value.status === "active", person.value.couchUser);
      await this.complete(vault.operationId);
      await this.audit(actor, "vault.created", vault.value.id);
      return vault.value;
    });
  }

  async inventory(): Promise<Inventory> {
    const [databases, users, vaults, people] = await Promise.all([
      this.client.request<string[]>("_all_dbs"),
      this.client.request<{ rows: Array<{ doc: CouchUser }> }>(
        "_users/_all_docs?include_docs=true",
      ),
      this.all<VaultDoc>("vault"),
      this.all<PersonDoc>("person"),
    ]);
    const result: Inventory = { databases: [], users: [] };
    for (const name of databases.filter((name) => !name.startsWith("_") && name !== this.panelDb)) {
      const security = await this.client.security(name);
      const warnings =
        security.members.names.length === 0 && security.members.roles.length === 0
          ? ["unrestricted_database"]
          : [];
      result.databases.push({
        name,
        members: security.members.names,
        admins: security.admins.names,
        managed: vaults.some((v) => v.value.db === name),
        membersRoles: security.members.roles,
        adminsRoles: security.admins.roles,
        warnings,
      });
    }
    result.users = users.rows
      .filter((row) => row.doc?.type === "user")
      .map(({ doc }) => ({
        name: doc.name,
        roles: doc.roles,
        managed: people.some((p) => p.value.couchUser === doc.name),
      }));
    return result;
  }

  adoptVault(actor: string, input: AdoptVaultInput): Promise<Vault> {
    return this.mutation(actor, "vault.adopt", input.db, async () => {
      validateDatabaseName(input.db);
      validateUsername(input.couchUser);
      validateLogin(input.tailscaleLogin);
      validateText(input.label);
      validateText(input.displayName);
      if (input.db === this.panelDb) throw new DomainError("reserved_database");
      if (input.idRecoveryCode) validateRecoveryCode(input.idRecoveryCode);
      await this.client.request(encodeURIComponent(input.db));
      const user = await this.client.get<CouchUser>(
        "_users",
        `org.couchdb.user:${input.couchUser}`,
      );
      if (!user) throw new DomainError("account_not_found", 404);
      if (
        user.roles.includes("_admin") ||
        (await this.client.globalAdminNames()).includes(input.couchUser)
      )
        throw new DomainError("global_admin_access");
      const security = await this.client.security(input.db);
      const grants = [...security.members.names, ...security.admins.names];
      const roles = [...security.members.roles, ...security.admins.roles];
      const unrestricted =
        security.members.names.length === 0 && security.members.roles.length === 0;
      if (
        !unrestricted &&
        !grants.includes(input.couchUser) &&
        !user.roles.some((role) => roles.includes(role))
      )
        throw new DomainError("account_has_no_vault_access");
      await this.assertNoOwnValidation(input.db);
      let person: PersonDoc;
      const pending = (
        await this.page<Operation>(
          "operation",
          { limit: 1 },
          {
            action: "adopt_vault",
            state: "pending",
            "vault.db": input.db,
          },
        )
      ).items[0];
      if (
        pending &&
        (pending.person?.couchUser !== input.couchUser ||
          pending.person.tailscaleLogin !== input.tailscaleLogin ||
          pending.vault?.idRecoveryCode !== (input.idRecoveryCode ?? null) ||
          pending.vault.label !== input.label)
      )
        throw new DomainError("operation_input_mismatch");
      const existing = input.personId
        ? await this.getPerson(input.personId)
        : await this.findPersonByLogin(input.tailscaleLogin);
      if (existing) {
        if (
          existing.couchUser !== input.couchUser ||
          existing.tailscaleLogin !== input.tailscaleLogin ||
          existing.status !== "active"
        )
          throw new DomainError("person_mismatch");
        person = await this.person(existing.id);
      } else {
        const value: Person = pending?.person ?? {
          id: id(),
          couchUser: input.couchUser,
          displayName: input.displayName,
          tailscaleLogin: input.tailscaleLogin,
          status: "active",
          createdAt: now(),
        };
        person = {
          _id: `person:${value.id}`,
          kind: "person",
          schemaVersion: 1,
          value,
          operationId: pending?._id.slice("operation:".length) ?? id(),
        };
      }
      const existingClaim = await this.client.get<Claim>(
        this.panelDb,
        await claimId("database", input.db),
      );
      if (existingClaim) {
        const existingVault = await this.client.get<VaultDoc>(
          this.panelDb,
          `vault:${existingClaim.owner}`,
        );
        if (existingVault) {
          if (existingVault.value.personId !== person.value.id) {
            throw new DomainError("database_already_registered");
          }
          if (input.idRecoveryCode && !existingVault.value.idRecoveryCode) {
            existingVault.value.idRecoveryCode = input.idRecoveryCode;
            await this.client.put(this.panelDb, existingVault);
            await this.audit(actor, "vault.recovery_registered", existingVault.value.id);
          } else if (
            input.idRecoveryCode &&
            existingVault.value.idRecoveryCode !== input.idRecoveryCode
          )
            throw new DomainError("recovery_identity_conflict");
          return existingVault.value;
        }
        if (!pending || pending.vault?.id !== existingClaim.owner) {
          throw new DomainError("resource_ownership_unknown");
        }
      }
      const value: Vault = pending?.vault ?? {
        id: id(),
        personId: person.value.id,
        db: input.db,
        label: input.label,
        idRecoveryCode: input.idRecoveryCode ?? null,
        adopted: true,
        createdAt: now(),
        uriIssuedAt: null,
      };
      const operationId = pending?._id.slice("operation:".length) ?? id();
      if (!pending) {
        await this.client.put(this.panelDb, {
          _id: `operation:${operationId}`,
          kind: "operation",
          schemaVersion: 1,
          action: "adopt_vault",
          actor,
          person: person.value,
          vault: value,
          security,
          state: "pending",
          at: now(),
        });
      }
      await this.claim("account", input.couchUser, person.value.id);
      await this.claim("login", input.tailscaleLogin, person.value.id);
      if (!person._rev) person = await this.client.put(this.panelDb, person);
      await this.claim("database", input.db, value.id);
      await this.quotas.installGuard(input.db);
      await this.client.put(this.panelDb, {
        _id: `vault:${value.id}`,
        kind: "vault",
        schemaVersion: 1,
        value,
        operationId,
        provisioned: true,
        security: pending?.security ?? security,
      });
      await this.quotas.registerVault(input.db, person.value.id);
      await this.complete(operationId);
      await this.audit(actor, "vault.adopted", value.id);
      return value;
    });
  }

  setInitialPassword(login: string, password: string): Promise<void> {
    return this.mutation(login, "credentials.initialize", login, () =>
      this.initializePassword(login, password),
    );
  }

  private async initializePassword(login: string, password: string): Promise<void> {
    validatePassword(password);
    const person = await this.owner(login, true);
    if (person.value.status !== "pending_credentials") {
      throw new DomainError("onboarding_not_pending");
    }
    await this.client.updatePassword(person.value.couchUser, password);
    const vaults = await this.all<VaultDoc>("vault", { "value.personId": person.value.id });
    for (let vault of vaults) {
      vault = await this.changeSecurity(
        vault,
        vault.suspendedSecurity ?? grantAccess(vault.security, person.value.couchUser),
      );
      if (vault.suspendedSecurity) {
        delete vault.suspendedSecurity;
        await this.client.put(this.panelDb, vault);
      }
    }
    person.value.status = "active";
    person.sessionVersion = id();
    delete person.invitation;
    await this.client.put(this.panelDb, person);
    await this.audit(login, "credentials.initialized", person.value.id);
  }

  // Reads only. Each request checks the session version, so a login that races a password
  // change or a disable yields a session that is already invalid.
  async loginOwner(username: string, password: string): Promise<OwnerSession> {
    const claim = await this.client.get<Claim>(this.panelDb, await claimId("account", username));
    const person = claim ? await this.person(claim.owner) : null;
    if (!person || person.value.status !== "active" || person.transition || person.pendingLogin) {
      // Spend the same CouchDB round trip as a real check so response time does not reveal
      // which usernames exist.
      await this.client.authenticate(unknownAccount, password).catch(() => undefined);
      throw new DomainError("invalid_credentials", 401);
    }
    await this.checkPassword(person.value.couchUser, password);
    return { person: person.value, version: person.sessionVersion ?? person.operationId };
  }

  async ownerSession(personId: string, version: string): Promise<Person | null> {
    const person = await this.client.get<PersonDoc>(this.panelDb, `person:${personId}`);
    return person &&
      person.value.status === "active" &&
      !person.transition &&
      !person.pendingLogin &&
      (person.sessionVersion ?? person.operationId) === version
      ? person.value
      : null;
  }

  revokeOwnerSessions(login: string): Promise<void> {
    return this.mutation(login, "session.revoke", login, async () => {
      const person = await this.owner(login);
      person.sessionVersion = id();
      await this.client.put(this.panelDb, person);
      await this.audit(login, "session.revoked", person.value.id);
    });
  }

  issueInvitation(actor: string, personId: string): Promise<string> {
    return this.mutation(actor, "invitation.create", personId, async () => {
      const person = await this.person(personId);
      if (person.value.status !== "pending_credentials" || person.transition) {
        throw new DomainError("onboarding_not_pending");
      }
      const token = `${personId}.${newRecoveryCode().slice(10)}`;
      person.invitation = {
        hash: await claimId("invitation", token),
        expires: Date.now() + 86_400_000,
      };
      await this.client.put(this.panelDb, person);
      await this.audit(actor, "invitation.created", personId);
      return token;
    });
  }

  acceptInvitation(token: string, password: string): Promise<OwnerSession> {
    return this.mutation("invitation", "invitation.accept", "owner", async () => {
      const [personId, secret] = token.split(".");
      if (!personId || !/^[a-f0-9]{64}$/.test(secret ?? ""))
        throw new DomainError("invalid_invitation", 401);
      const person = await this.client.get<PersonDoc>(this.panelDb, `person:${personId}`);
      if (
        !person?.invitation ||
        person.invitation.expires <= Date.now() ||
        person.invitation.hash !== (await claimId("invitation", token)) ||
        person.value.status !== "pending_credentials"
      ) {
        throw new DomainError("invalid_invitation", 401);
      }
      await this.initializePassword(person.value.tailscaleLogin, password);
      const active = await this.person(personId);
      return { person: active.value, version: active.sessionVersion! };
    });
  }

  async createOwnedVault(login: string, label: string): Promise<Vault> {
    const person = await this.owner(login);
    return this.createVault(
      login,
      person.value.id,
      { label, slug: `vault_${id().replaceAll("-", "")}` },
      OWNER_VAULT_LIMIT,
    );
  }

  async getOwnedVault(login: string, vaultId: string): Promise<Vault> {
    const person = await this.owner(login);
    const vault = await this.vault(vaultId);
    if (
      vault.value.personId !== person.value.id ||
      !vault.provisioned ||
      vault.value.db === this.panelDb ||
      vault.value.db.startsWith("_")
    ) {
      throw new DomainError("forbidden", 403);
    }
    if (!vault.deletion) await this.assertSecurity(vault);
    return vault.value;
  }

  async *exportOwnedVault(login: string, vaultId: string): AsyncGenerator<string> {
    const vault = await this.serial(async () => {
      const value = await this.getOwnedVault(login, vaultId);
      if ((await this.vault(vaultId)).deletion) throw new DomainError("operation_in_progress");
      if (this.exporting.has(vaultId) || this.exporting.size >= 2)
        throw new DomainError("vault_export_busy", 429);
      this.exporting.add(vaultId);
      return value;
    });
    try {
      yield JSON.stringify({
        type: "manifest",
        format: "obsidian-personal-backup",
        schemaVersion: 1,
        createdAt: now(),
        vaults: [vault],
      }) + "\n";
      yield* vaultRecords(this.client, vault);
    } finally {
      this.exporting.delete(vaultId);
    }
  }

  deleteOwnedVault(
    login: string,
    vaultId: string,
    confirmation: {
      label: string;
      password: string;
      acknowledged: boolean;
      backup: "downloaded" | "skip";
    },
  ): Promise<void> {
    return this.mutation(login, "vault.delete", vaultId, async () => {
      const value = await this.getOwnedVault(login, vaultId);
      if (
        confirmation.label !== value.label ||
        !confirmation.acknowledged ||
        !["downloaded", "skip"].includes(confirmation.backup)
      )
        throw new DomainError("vault_delete_confirmation", 400);
      const person = await this.owner(login);
      await this.checkPassword(person.value.couchUser, confirmation.password);
      if (this.exporting.has(vaultId)) throw new DomainError("vault_export_busy", 409);
      let vault = await this.vault(vaultId);
      if (!vault.deletion) {
        await this.assertExclusiveVault(vault);
        const marker = await this.client.get<CouchDocument>(value.db, "_local/dashboard-owner");
        if (
          (!value.adopted && !marker) ||
          (marker && (marker.vaultId !== vaultId || marker.operationId !== vault.operationId))
        )
          throw new DomainError("resource_ownership_unknown");
        const deletion = { actor: login, token: id() };
        const previous = await this.client.get<CouchDocument>(
          value.db,
          "_local/dashboard-deletion",
        );
        await this.client.put(value.db, {
          ...previous,
          _id: "_local/dashboard-deletion",
          vaultId,
          token: deletion.token,
        });
        vault = await this.client.put(this.panelDb, { ...vault, deletion });
      }
      await this.quotas.removeDatabase(value.db, () => this.finishVaultDeletion(vault));
    });
  }

  // LiveSync rebuilds a remote by deleting and recreating its database, which needs server
  // admin rights. The sync gateway hands that request here: the panel recreates a vault it
  // provisioned, for the one account that owns it, with the same access and markers.
  resetVaultDatabase(couchUser: string, database: string): Promise<void> {
    return this.mutation(couchUser, "vault.reset", database, async () => {
      const claim = await this.client.get<Claim>(this.panelDb, await claimId("database", database));
      const vault = claim
        ? await this.client.get<VaultDoc>(this.panelDb, `vault:${claim.owner}`)
        : undefined;
      if (!vault || vault.kind !== "vault" || !vault.provisioned || vault.deletion) {
        throw new DomainError("remote_rebuild_forbidden", 403);
      }
      const person = await this.person(vault.value.personId);
      if (
        vault.value.adopted ||
        person.value.couchUser !== couchUser ||
        person.value.status !== "active"
      )
        throw new DomainError("remote_rebuild_forbidden", 403);
      await this.assertExclusiveVault(vault);
      const marker = await this.client.get<CouchDocument>(database, "_local/dashboard-owner");
      if (marker?.vaultId !== vault.value.id || marker.operationId !== vault.operationId) {
        throw new DomainError("resource_ownership_unknown");
      }
      const security = await this.client.security(database);
      await this.quotas.removeDatabase(database, async () => {
        await this.client.request(encodeURIComponent(database), "DELETE");
        if (!(await this.client.createDatabase(database))) {
          throw new DomainError("resource_ownership_unknown");
        }
        await this.client.put(database, {
          _id: "_local/dashboard-owner",
          operationId: vault.operationId,
          vaultId: vault.value.id,
        });
        await this.client.setSecurity(database, security);
      });
      await this.quotas.registerVault(database, vault.value.personId);
      await this.quotas.withWrite(
        database,
        [VERSIONING_DOCID],
        () => documentBytes({ _id: VERSIONING_DOCID, version: VER, type: "versioninfo" }),
        () => initializeLiveSyncVersion(this.client, database),
      );
      await this.quotas.installGuard(database);
      await this.audit(person.value.tailscaleLogin, "vault.reset", vault.value.id);
    });
  }

  private async assertExclusiveVault(vault: VaultDoc): Promise<void> {
    await this.assertSecurity(vault);
    const person = await this.person(vault.value.personId);
    const security = await this.client.security(vault.value.db);
    if (
      security.members.names.length !== 1 ||
      security.members.names[0] !== person.value.couchUser ||
      security.members.roles.some((role) => role !== "_admin") ||
      security.admins.names.length ||
      security.admins.roles.some((role) => role !== "_admin")
    )
      throw new DomainError("vault_shared_delete", 409);
  }

  private async finishVaultDeletion(vault: VaultDoc): Promise<void> {
    if (!vault.deletion) throw new DomainError("operation_not_reconcilable");
    const claim = await this.client.get<Claim>(
      this.panelDb,
      await claimId("database", vault.value.db),
    );
    if (claim && claim.owner !== vault.value.id)
      throw new DomainError("resource_ownership_unknown");
    const database = encodeURIComponent(vault.value.db);
    let exists = true;
    try {
      await this.client.request(database);
    } catch (error) {
      if (!(error instanceof CouchError) || error.status !== 404) throw error;
      exists = false;
    }
    if (exists) {
      const marker = await this.client.get<CouchDocument>(
        vault.value.db,
        "_local/dashboard-deletion",
      );
      if (marker?.vaultId !== vault.value.id || marker?.token !== vault.deletion.token)
        throw new DomainError("resource_ownership_unknown");
      await this.assertExclusiveVault(vault);
      await this.client.request(database, "DELETE");
    }
    if (claim) {
      await this.client.request(
        `${encodeURIComponent(this.panelDb)}/${encodeURIComponent(claim._id)}?rev=${encodeURIComponent(claim._rev!)}`,
        "DELETE",
      );
    }
    await this.audit(vault.deletion.actor, "vault.deleted", vault.value.id);
    await this.client.request(
      `${encodeURIComponent(this.panelDb)}/${encodeURIComponent(vault._id)}?rev=${encodeURIComponent(vault._rev!)}`,
      "DELETE",
    );
  }

  async verifySetupCredentials(login: string, vaultId: string, password: string): Promise<void> {
    const metadata = await this.getSetupMetadata(login, vaultId);
    await this.checkPassword(metadata.username, password);
  }

  private async checkPassword(username: string, password: string): Promise<void> {
    try {
      await this.client.authenticate(username, password);
    } catch (error) {
      if (error instanceof CouchError && [401, 403].includes(error.status)) {
        throw new DomainError("invalid_credentials", 401);
      }
      throw error;
    }
  }

  changePassword(login: string, currentPassword: string, newPassword: string): Promise<void> {
    return this.mutation(login, "credentials.change", login, async () => {
      validatePassword(newPassword);
      const person = await this.owner(login);
      try {
        await this.client.authenticate(person.value.couchUser, currentPassword);
      } catch (error) {
        if (error instanceof CouchError && [401, 403].includes(error.status)) {
          throw new DomainError("invalid_credentials", 403);
        }
        throw error;
      }
      await this.client.updatePassword(person.value.couchUser, newPassword);
      person.sessionVersion = id();
      await this.client.put(this.panelDb, person);
      await this.audit(login, "credentials.changed", person.value.id);
    });
  }

  resetPassword(actor: string, personId: string): Promise<void> {
    return this.mutation(actor, "credentials.reset", personId, async () => {
      const person = await this.person(personId);
      if (person.transition && person.transition !== "reset") {
        throw new DomainError("operation_in_progress");
      }
      if (!person.transition && !["active", "pending_credentials"].includes(person.value.status)) {
        throw new DomainError("person_not_active");
      }
      if (!person.transition) await this.prepareTransition(person, "reset");
      await this.finishTransition(person);
      await this.audit(actor, "credentials.reset_requested", personId);
    });
  }

  // Startup finishes a login change that an interrupted registry operation left pending.
  private async finishLoginChange(person: PersonDoc): Promise<void> {
    const pending = person.pendingLogin;
    if (!pending) return;
    await this.claim("login", pending.next, person.value.id);
    if (person.value.tailscaleLogin !== pending.next) {
      person.value.tailscaleLogin = pending.next;
      person.sessionVersion = id();
      person = await this.client.put(this.panelDb, person);
    }
    const key = await claimId("login", pending.old);
    const oldClaim = await this.client.get<Claim>(this.panelDb, key);
    if (oldClaim) {
      if (oldClaim.owner !== person.value.id) throw new DomainError("resource_ownership_unknown");
      await this.client.request(
        `${encodeURIComponent(this.panelDb)}/${encodeURIComponent(key)}?rev=${encodeURIComponent(
          oldClaim._rev!,
        )}`,
        "DELETE",
      );
    }
    delete person.pendingLogin;
    await this.client.put(this.panelDb, person);
    await this.audit(pending.actor, "person.login_changed", person.value.id);
  }

  setPersonEnabled(actor: string, personId: string, enabled: boolean): Promise<void> {
    return this.mutation(
      actor,
      enabled ? "person.enable" : "person.disable",
      personId,
      async () => {
        const person = await this.person(personId);
        if (
          !person.transition &&
          ((enabled && person.value.status === "active") ||
            (!enabled && person.value.status === "disabled"))
        )
          return;
        if (enabled && !person.transition && person.value.status !== "disabled")
          throw new DomainError("person_not_disabled");
        if (
          !enabled &&
          !person.transition &&
          !["active", "pending_credentials"].includes(person.value.status)
        )
          throw new DomainError("person_not_active");
        const transition = enabled ? "enable" : "disable";
        if (person.transition && person.transition !== transition) {
          throw new DomainError("operation_in_progress");
        }
        if (!person.transition) await this.prepareTransition(person, transition);
        await this.finishTransition(person);
        await this.audit(actor, enabled ? "person.enabled" : "person.disabled", personId);
      },
    );
  }

  private async prepareTransition(
    person: PersonDoc,
    transition: "enable" | "disable" | "reset",
  ): Promise<void> {
    const vaults = await this.all<VaultDoc>("vault", { "value.personId": person.value.id });
    const user = await this.client.get<CouchUser>(
      "_users",
      `org.couchdb.user:${person.value.couchUser}`,
    );
    if (!user) throw new DomainError("account_not_found", 404);
    if ((await this.client.globalAdminNames()).includes(person.value.couchUser)) {
      throw new DomainError("global_admin_access");
    }
    for (const vault of vaults) {
      await this.assertSecurity(vault);
      if (transition !== "enable") revokeAccess(vault.security, person.value.couchUser, user.roles);
      else if (!vault.suspendedSecurity) throw new DomainError("missing_access_snapshot");
    }
    person.transition = transition;
    person.sessionVersion = id();
    delete person.invitation;
    if (transition !== "enable") {
      person.resumeStatus =
        person.value.status === "pending_credentials" ? "pending_credentials" : "active";
    }
    person.value.status = "provisioning";
    const updated = await this.client.put(this.panelDb, person);
    person._rev = updated._rev;
  }

  private async finishTransition(person: PersonDoc): Promise<void> {
    const transition = person.transition;
    if (!transition) return;
    const vaults = await this.all<VaultDoc>("vault", { "value.personId": person.value.id });
    const user = await this.client.get<CouchUser>(
      "_users",
      `org.couchdb.user:${person.value.couchUser}`,
    );
    if (!user) throw new DomainError("account_not_found", 404);
    for (let vault of vaults) {
      if (vault.pendingSecurity) vault = await this.applyPendingSecurity(vault);
      if (transition === "enable") {
        if (vault.suspendedSecurity) {
          const saved = vault.suspendedSecurity;
          vault = await this.changeSecurity(vault, saved);
          delete vault.suspendedSecurity;
          await this.client.put(this.panelDb, vault);
        }
      } else {
        if (!vault.suspendedSecurity) {
          vault.suspendedSecurity = structuredClone(vault.security);
          vault = await this.client.put(this.panelDb, vault);
        }
        await this.changeSecurity(
          vault,
          revokeAccess(vault.security, person.value.couchUser, user.roles),
        );
      }
    }
    if (transition === "reset") {
      await this.client.updatePassword(person.value.couchUser, `${id()}${id()}`);
    }
    person.value.status =
      transition === "disable"
        ? "disabled"
        : transition === "reset"
          ? "pending_credentials"
          : (person.resumeStatus ?? "active");
    delete person.transition;
    await this.client.put(this.panelDb, person);
  }

  private async assertSecurity(vault: VaultDoc): Promise<void> {
    const actual = await this.client.security(vault.value.db);
    if (!securityEqual(actual, vault.security)) throw new DomainError("security_drift");
  }

  private async changeSecurity(vault: VaultDoc, target: CouchSecurity): Promise<VaultDoc> {
    if (vault.pendingSecurity) vault = await this.applyPendingSecurity(vault);
    await this.assertSecurity(vault);
    if (securityEqual(vault.security, target)) return vault;
    vault.pendingSecurity = { from: vault.security, to: target };
    vault = await this.client.put(this.panelDb, vault);
    return this.applyPendingSecurity(vault);
  }

  private async applyPendingSecurity(vault: VaultDoc): Promise<VaultDoc> {
    const pending = vault.pendingSecurity;
    if (!pending) return vault;
    const actual = await this.client.security(vault.value.db);
    if (securityEqual(actual, pending.from)) {
      await this.client.setSecurity(vault.value.db, pending.to);
    } else if (!securityEqual(actual, pending.to)) throw new DomainError("security_drift");
    if (!securityEqual(await this.client.security(vault.value.db), pending.to)) {
      throw new DomainError("security_drift");
    }
    vault.security = pending.to;
    delete vault.pendingSecurity;
    return this.client.put(this.panelDb, vault);
  }

  private async owner(login: string, allowPending = false): Promise<PersonDoc> {
    const person = await this.findPersonByLogin(login);
    if (
      !person ||
      (person.status !== "active" && !(allowPending && person.status === "pending_credentials"))
    )
      throw new DomainError("forbidden", 403);
    return this.person(person.id);
  }

  async getSetupMetadata(login: string, vaultId: string): Promise<SetupMetadata> {
    const person = await this.owner(login);
    const vault = await this.vault(vaultId);
    if (vault.value.personId !== person.value.id || !vault.provisioned || vault.deletion) {
      throw new DomainError("forbidden", 403);
    }
    if (!vault.value.idRecoveryCode) throw new DomainError("missing_recovery_code");
    await this.assertSecurity(vault);
    await assertLiveSyncVersion(this.client, vault.value.db);
    const hasContent = await hasRemoteUserContent(this.client, vault.value.db);
    // Repairs vaults created before the panel published settings, and remotes left locked
    // by a rebuild the sync account was not allowed to finish.
    if (!vault.value.adopted && !hasContent) {
      await ensureLiveSyncMilestone(this.client, vault.value.db);
    }
    return {
      vaultId,
      label: vault.value.label,
      hostname: this.publicCouchdbUrl,
      database: vault.value.db,
      username: person.value.couchUser,
      idRecoveryCode: vault.value.idRecoveryCode,
      instruction: vault.value.adopted || hasContent ? "additional" : "new",
      encryptionSetup:
        vault.value.adopted || hasContent || vault.value.uriIssuedAt ? "existing" : "new",
    };
  }

  recordUriIssued(login: string, vaultId: string): Promise<void> {
    return this.mutation(login, "setup.generate", vaultId, async () => {
      await this.getSetupMetadata(login, vaultId);
      const vault = await this.vault(vaultId);
      vault.value.uriIssuedAt = now();
      await this.client.put(this.panelDb, vault);
      await this.audit(login, "setup.generated", vaultId);
    });
  }

  registerRecoveryCode(
    actor: string,
    vaultId: string,
    code: string,
    options: { asOwner?: boolean } = {},
  ): Promise<void> {
    return this.mutation(actor, "vault.recovery_register", vaultId, async () => {
      validateRecoveryCode(code);
      const vault = await this.vault(vaultId);
      if (options.asOwner) {
        const person = await this.owner(actor);
        if (vault.value.personId !== person.value.id || !vault.provisioned) {
          throw new DomainError("forbidden", 403);
        }
      }
      if (vault.value.idRecoveryCode === code) return;
      if (vault.value.idRecoveryCode) throw new DomainError("recovery_identity_conflict");
      vault.value.idRecoveryCode = code;
      await this.client.put(this.panelDb, vault);
      await this.audit(actor, "vault.recovery_registered", vaultId);
    });
  }

  recordBackupRequested(actor: string, requestId: string): Promise<void> {
    return this.serial(async () => {
      validateLogin(actor);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)) {
        throw new DomainError("invalid_request_id", 400);
      }
      await this.audit(actor, "backup.requested", requestId);
    });
  }

  private async audit(
    actor: string,
    action: string,
    target: string,
    result: "success" | "failure" = "success",
  ): Promise<void> {
    const value: AuditEvent = { id: id(), at: now(), actor, action, target, result };
    await this.client.put(this.panelDb, {
      _id: `event:${value.id}`,
      kind: "event",
      schemaVersion: 1,
      value,
    });
  }

  private async complete(operationId: string): Promise<void> {
    const operation = await this.client.get<Operation>(this.panelDb, `operation:${operationId}`);
    if (operation && operation.state !== "complete") {
      operation.state = "complete";
      await this.client.put(this.panelDb, operation);
    }
  }

  async listEvents(query?: PageQuery): Promise<Page<AuditEvent>> {
    const page = await this.page<EventDoc>("event", query);
    return { items: page.items.map((doc) => doc.value), bookmark: page.bookmark };
  }

  async stats(): Promise<VaultStats[]> {
    if (this.statsCache && this.statsCache.expires > Date.now()) {
      return structuredClone(this.statsCache.items);
    }
    const epoch = this.statsEpoch;
    if (this.statsLoading?.epoch === epoch) return structuredClone(await this.statsLoading.task);
    const loading = { epoch, task: this.loadStats() };
    this.statsLoading = loading;
    try {
      const result = await loading.task;
      if (this.statsEpoch === epoch) {
        this.statsCache = { expires: Date.now() + 15_000, items: result };
      }
      return structuredClone(result);
    } finally {
      if (this.statsLoading === loading) this.statsLoading = null;
    }
  }

  quotaSummary(): Promise<QuotaSummary> {
    return this.quotas.summary();
  }

  async personQuota(login: string): Promise<PersonQuota> {
    const person = await this.owner(login, true);
    return this.quotas.forPerson(person.value.id);
  }

  setPersonQuota(actor: string, personId: string, limit: number | null): Promise<void> {
    return this.mutation(actor, "person.quota_change", personId, () =>
      this.quotas.setPersonLimit(actor, personId, limit),
    );
  }

  private async loadStats(): Promise<VaultStats[]> {
    const result: VaultStats[] = [];
    const vaults = (await this.all<VaultDoc>("vault")).filter((vault) => vault.provisioned);
    for (let offset = 0; offset < vaults.length; offset += 100) {
      const batch = vaults.slice(offset, offset + 100);
      const response = await this.client.request<
        Array<{
          key: string;
          error?: string;
          info?: { doc_count: number; sizes?: { file?: number; active?: number } };
        }>
      >("_dbs_info", "POST", { keys: batch.map((vault) => vault.value.db) });
      for (const vault of batch) {
        const item = response.find((entry) => entry.key === vault.value.db);
        if (item?.error === "not_found") continue;
        const stats = item?.info;
        if (!stats || !Number.isFinite(stats.doc_count)) throw new CouchError(502);
        result.push({
          vaultId: vault.value.id,
          db: vault.value.db,
          docCount: stats.doc_count,
          sizeFile: stats.sizes?.file ?? 0,
          sizeActive: stats.sizes?.active ?? 0,
        });
      }
    }
    return result;
  }
}

async function claimId(type: string, value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `claim:${type}:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function validateText(value: string): void {
  if (!value.trim() || value.length > 160 || [...value].some((char) => char.charCodeAt(0) < 32)) {
    throw new ServiceError("invalid_text", 400);
  }
}

function validateLogin(login: string): void {
  if (!login.trim() || login.length > 254 || /[\s,\p{Cc}]/u.test(login))
    throw new ServiceError("invalid_login", 400);
}
