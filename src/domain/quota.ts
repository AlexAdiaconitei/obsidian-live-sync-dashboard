import type { Person, PersonQuota, QuotaSummary, QuotaUsage } from "../contracts.ts";
import { ServiceError } from "../contracts.ts";
import { type CouchClient, type CouchDocument, CouchError } from "../couchdb/client.ts";
import { documentBytes } from "../quota/bytes.ts";

export interface QuotaSettings {
  instanceLimitBytes: number | null;
  defaultUserLimitBytes: number | null;
  recoverPending?: boolean;
}

export interface QuotaLeaf {
  rev: string;
  bytes: number;
  doc: CouchDocument;
}

interface RegistryPerson extends CouchDocument {
  kind: "person";
  value: Person;
}
interface RegistryVault extends CouchDocument {
  kind: "vault";
  value: { db: string; personId: string };
  provisioned: boolean;
}
interface Meter {
  personId: string;
  sequence: unknown;
  records: Record<string, Array<{ rev: string; bytes: number }>>;
  recordCount?: number;
  usedBytes?: number;
}
interface Ledger extends CouchDocument {
  kind: "quota_ledger";
  schemaVersion: 1;
  databases: Record<string, Meter>;
  pending?: { database: string; ids: string[]; growth: number; startedAt: string };
}
interface MeterDoc extends CouchDocument {
  kind: "quota_meter";
  schemaVersion: 1;
  database: string;
  documentId: string;
  leaves: Array<{ rev: string; bytes: number }>;
}

const ledgerId = "quota:ledger";
export const guardId = "_design/livesync-dashboard-quota";
const guard =
  "function(newDoc, oldDoc, userCtx) { if (userCtx.roles.indexOf('_admin') === -1) { throw({forbidden: 'Writes require the quota gateway'}); } }";

export function validateQuotaLimit(value: number | null): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new ServiceError("invalid_quota", 400);
  }
}

export function quotaUsage(limitBytes: number | null, usedBytes: number): QuotaUsage {
  return {
    limitBytes,
    usedBytes,
    remainingBytes: limitBytes === null ? null : Math.max(0, limitBytes - usedBytes),
    exceeded: limitBytes !== null && usedBytes > limitBytes,
  };
}

/** One panel instance serializes admission globally. The journal survives process restarts. */
export class QuotaManager {
  private queue: Promise<unknown> = Promise.resolve();
  private ledger: Ledger = {
    _id: ledgerId,
    kind: "quota_ledger",
    schemaVersion: 1,
    databases: Object.create(null),
  };
  private initialized = false;
  private reconciledAt = 0;
  private savedState?: string;
  private meterDocs = new Map<string, MeterDoc>();
  private dirty = new Map<string, { database: string; documentId: string }>();

  constructor(
    private readonly client: CouchClient,
    private readonly panelDb: string,
    readonly settings: QuotaSettings,
  ) {
    validateQuotaLimit(settings.instanceLimitBytes);
    validateQuotaLimit(settings.defaultUserLimitBytes);
    this.validateLimit(settings.defaultUserLimitBytes);
  }

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const task = this.queue.then(run, run);
    this.queue = task.catch(() => {});
    return task;
  }

  private validateLimit(limit: number | null): void {
    validateQuotaLimit(limit);
    if (
      limit !== null &&
      this.settings.instanceLimitBytes !== null &&
      limit > this.settings.instanceLimitBytes
    ) {
      throw new ServiceError("quota_exceeds_instance", 400);
    }
  }

  validatePersonLimit(limit: number | null): void {
    this.validateLimit(limit);
  }

  private async registry<T extends CouchDocument>(kind: string): Promise<T[]> {
    const docs: T[] = [];
    let bookmark: string | undefined;
    do {
      const result = await this.client.request<{ docs: T[]; bookmark?: string }>(
        `${encodeURIComponent(this.panelDb)}/_find`,
        "POST",
        { selector: { kind }, limit: 100, ...(bookmark ? { bookmark } : {}) },
      );
      docs.push(...result.docs);
      if (result.docs.length < 100 || result.bookmark === bookmark) break;
      bookmark = result.bookmark;
    } while (bookmark);
    return docs;
  }

  private async load(): Promise<void> {
    const stored = await this.client.get<Ledger>(this.panelDb, ledgerId);
    if (!stored && this.initialized) throw new ServiceError("quota_state_invalid", 503);
    if (stored) {
      if (this.ledger._rev === stored._rev) return;
      if (
        stored.kind !== "quota_ledger" ||
        stored.schemaVersion !== 1 ||
        !stored.databases ||
        typeof stored.databases !== "object" ||
        Array.isArray(stored.databases)
      ) {
        throw new ServiceError("quota_state_invalid", 503);
      }
      if (
        stored.pending &&
        (typeof stored.pending.database !== "string" ||
          !Array.isArray(stored.pending.ids) ||
          stored.pending.ids.some((id) => typeof id !== "string") ||
          !Number.isSafeInteger(stored.pending.growth) ||
          stored.pending.growth < 0 ||
          typeof stored.pending.startedAt !== "string")
      )
        throw new ServiceError("quota_state_invalid", 503);
      for (const meter of Object.values(stored.databases)) {
        if (!meter || typeof meter.personId !== "string") {
          throw new ServiceError("quota_state_invalid", 503);
        }
        if (
          (typeof meter.sequence !== "string" && typeof meter.sequence !== "number") ||
          Array.isArray(meter.records)
        )
          throw new ServiceError("quota_state_invalid", 503);
        meter.records ??= Object.create(null);
        for (const leaves of Object.values(meter.records)) {
          if (
            !Array.isArray(leaves) ||
            leaves.some(
              (leaf) =>
                !Number.isSafeInteger(leaf.bytes) || leaf.bytes < 0 || typeof leaf.rev !== "string",
            )
          ) {
            throw new ServiceError("quota_state_invalid", 503);
          }
        }
        Object.setPrototypeOf(meter.records, null);
      }
      Object.setPrototypeOf(stored.databases, null);
      this.savedState = JSON.stringify({ databases: stored.databases, pending: stored.pending });
      this.ledger = stored;
      this.meterDocs.clear();
      this.dirty.clear();
      for (const doc of await this.registry<MeterDoc>("quota_meter")) {
        if (
          doc.schemaVersion !== 1 ||
          typeof doc.database !== "string" ||
          typeof doc.documentId !== "string" ||
          !Array.isArray(doc.leaves) ||
          doc.leaves.some(
            (leaf) =>
              !Number.isSafeInteger(leaf.bytes) || leaf.bytes < 0 || typeof leaf.rev !== "string",
          )
        )
          throw new ServiceError("quota_state_invalid", 503);
        const key = this.meterKey(doc.database, doc.documentId);
        this.meterDocs.set(key, doc);
        const meter = this.ledger.databases[doc.database];
        if (meter && doc.leaves.length) meter.records[doc.documentId] = doc.leaves;
      }
      for (const meter of Object.values(this.ledger.databases)) {
        const count = Object.keys(meter.records).length;
        const bytes = Object.values(meter.records)
          .flat()
          .reduce((sum, leaf) => sum + leaf.bytes, 0);
        if (
          meter.recordCount === undefined ||
          meter.usedBytes === undefined ||
          (meter.recordCount !== undefined && meter.recordCount !== count) ||
          (meter.usedBytes !== undefined && meter.usedBytes !== bytes)
        ) {
          // Replay authoritative CouchDB changes if a journal or missing meter left an incomplete cache.
          meter.sequence = 0;
          meter.records = Object.create(null);
        }
      }
    } else {
      // A crash before the first ledger commit may still have persisted individual meter records.
      for (const doc of await this.registry<MeterDoc>("quota_meter")) {
        this.meterDocs.set(this.meterKey(doc.database, doc.documentId), doc);
      }
    }
  }

  private meterKey(database: string, documentId: string): string {
    return `${database}\u0000${documentId}`;
  }

  private async save(): Promise<void> {
    for (const [key, { database, documentId }] of this.dirty) {
      const previous = this.meterDocs.get(key);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
      const _id = `quota:meter:${Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("")}`;
      const doc: MeterDoc = {
        _id,
        ...(previous?._rev ? { _rev: previous._rev } : {}),
        kind: "quota_meter",
        schemaVersion: 1,
        database,
        documentId,
        leaves: this.ledger.databases[database]?.records[documentId] ?? [],
      };
      this.meterDocs.set(key, await this.client.put(this.panelDb, doc));
      this.dirty.delete(key);
    }
    const databases = Object.fromEntries(
      Object.entries(this.ledger.databases).map(([database, meter]) => [
        database,
        {
          personId: meter.personId,
          sequence: meter.sequence,
          recordCount: Object.keys(meter.records).length,
          usedBytes: Object.values(meter.records)
            .flat()
            .reduce((sum, leaf) => sum + leaf.bytes, 0),
        },
      ]),
    );
    const state = JSON.stringify({ databases, pending: this.ledger.pending });
    if (state === this.savedState) return;
    const stored = await this.client.put(this.panelDb, { ...this.ledger, databases });
    this.ledger._rev = stored._rev;
    this.savedState = state;
  }

  private async releaseReservation(): Promise<void> {
    const pending = this.ledger.pending;
    delete this.ledger.pending;
    try {
      await this.save();
    } catch (error) {
      this.ledger.pending = pending;
      throw error;
    }
  }

  async initialize(): Promise<void> {
    await this.serial(async () => {
      await this.load();
      if (this.ledger.pending && !this.settings.recoverPending) {
        throw new ServiceError("quota_reconciliation_required", 503);
      }
      await this.reconcile(true);
      if (this.ledger.pending) {
        await this.reconcileIds(this.ledger.pending.database, this.ledger.pending.ids);
        await this.releaseReservation();
      } else await this.save();
      this.initialized = true;
    });
  }

  async installGuard(database: string): Promise<void> {
    const path = `${encodeURIComponent(database)}/${guardId}`;
    let existing: CouchDocument | undefined;
    try {
      existing = await this.client.request<CouchDocument>(path);
    } catch (error) {
      if (!(error instanceof CouchError) || error.status !== 404) throw error;
    }
    if (existing?.validate_doc_update === guard) return;
    if (existing && existing.validate_doc_update !== guard) {
      throw new ServiceError("quota_guard_conflict", 503);
    }
    await this.client.request(path, "PUT", { _id: guardId, validate_doc_update: guard });
  }

  async leaves(database: string, id: string): Promise<QuotaLeaf[]> {
    if (id.startsWith("_local/")) {
      const doc = await this.client.get<CouchDocument>(database, id);
      return doc ? [{ rev: doc._rev!, bytes: this.charge(doc), doc }] : [];
    }
    try {
      const values = await this.client.request<Array<{ ok?: CouchDocument; missing?: string }>>(
        `${encodeURIComponent(database)}/${
          id.startsWith("_design/")
            ? `_design/${encodeURIComponent(id.slice(8))}`
            : encodeURIComponent(id)
        }?open_revs=all&revs=true`,
      );
      return values.map((value) => {
        if (!value.ok || !value.ok._rev) throw new ServiceError("quota_reconciliation_failed", 503);
        return { rev: value.ok._rev, bytes: this.charge(value.ok), doc: value.ok };
      });
    } catch (error) {
      if (error instanceof CouchError && error.status === 404) return [];
      throw error;
    }
  }

  private charge(doc: CouchDocument): number {
    if (doc._id.startsWith("_design/") || doc._id === "_local/dashboard-owner") return 0;
    return documentBytes(doc);
  }

  private async reconcileIds(database: string, ids: string[]): Promise<void> {
    const meter = this.ledger.databases[database];
    if (!meter) throw new ServiceError("unmanaged_database", 403);
    for (const id of new Set(ids)) {
      const leaves = await this.leaves(database, id);
      const next = leaves
        .filter((leaf) => leaf.bytes > 0)
        .map(({ rev, bytes }) => ({
          rev,
          bytes,
        }));
      if (JSON.stringify(next) === JSON.stringify(meter.records[id] ?? [])) continue;
      if (next.length) meter.records[id] = next;
      else delete meter.records[id];
      this.dirty.set(this.meterKey(database, id), { database, documentId: id });
    }
  }

  private async reconcileDatabase(database: string, personId?: string): Promise<void> {
    const meter = (this.ledger.databases[database] ??= {
      personId: personId ?? "",
      sequence: 0,
      records: Object.create(null),
    });
    if (personId !== undefined) meter.personId = personId;
    let more = true;
    while (more) {
      const params = new URLSearchParams({
        since: String(meter.sequence),
        style: "all_docs",
        limit: "100",
      });
      const changes = await this.client.request<{
        results: Array<{ id: string }>;
        last_seq: unknown;
        pending?: number;
      }>(`${encodeURIComponent(database)}/_changes?${params}`);
      await this.reconcileIds(
        database,
        changes.results.map((row) => row.id),
      );
      meter.sequence = changes.last_seq;
      more = changes.pending !== undefined ? changes.pending > 0 : changes.results.length === 100;
    }
  }

  registerVault(database: string, personId: string): Promise<void> {
    return this.serial(async () => {
      await this.loadReady();
      await this.reconcileDatabase(database, personId);
      await this.save();
    });
  }

  private async reconcile(verifyGuards = false): Promise<void> {
    const vaults = await this.registry<RegistryVault>("vault");
    const databases = (await this.client.request<string[]>("_all_dbs")).filter(
      (database) => !database.startsWith("_") && database !== this.panelDb,
    );
    for (const database of databases) {
      try {
        const vault = vaults.find((item) => item.value.db === database);
        if (vault?.provisioned && (verifyGuards || !this.ledger.databases[database])) {
          await this.installGuard(database);
        }
        await this.reconcileDatabase(database, vault?.value.personId ?? "");
      } catch (error) {
        if (!(error instanceof CouchError) || error.status !== 404) throw error;
        // The database may disappear after the instance inventory read.
        delete this.ledger.databases[database];
      }
    }
    const current = new Set(databases);
    for (const database of Object.keys(this.ledger.databases)) {
      if (!current.has(database)) delete this.ledger.databases[database];
    }
    this.reconciledAt = Date.now();
  }

  private used(personId?: string): number {
    let bytes = 0;
    for (const meter of Object.values(this.ledger.databases)) {
      if (personId !== undefined && meter.personId !== personId) continue;
      for (const leaves of Object.values(meter.records)) {
        for (const leaf of leaves) bytes += leaf.bytes;
      }
    }
    if (!Number.isSafeInteger(bytes)) throw new ServiceError("quota_state_invalid", 503);
    return bytes;
  }

  private limit(person: Person): number | null {
    const limit =
      person.quotaBytes === undefined ? this.settings.defaultUserLimitBytes : person.quotaBytes;
    validateQuotaLimit(limit);
    return limit;
  }

  private async loadReady(): Promise<void> {
    if (!this.initialized) throw new ServiceError("quota_not_initialized", 503);
    await this.load();
    if (this.ledger.pending) throw new ServiceError("quota_reconciliation_required", 503);
  }

  private async refresh(database?: string): Promise<void> {
    await this.loadReady();
    if (!database || !this.ledger.databases[database] || Date.now() - this.reconciledAt >= 60_000) {
      await this.reconcile();
    } else {
      await this.reconcileDatabase(database);
      // Unmanaged databases have no gateway guard, so their usage cannot be cached for admission.
      for (const [name, meter] of Object.entries(this.ledger.databases)) {
        if (name === database || meter.personId) continue;
        try {
          await this.reconcileDatabase(name);
        } catch (error) {
          if (!(error instanceof CouchError) || error.status !== 404) throw error;
          delete this.ledger.databases[name];
        }
      }
    }
    await this.save();
  }

  summary(): Promise<QuotaSummary> {
    return this.serial(async () => {
      await this.refresh();
      const people = await this.registry<RegistryPerson>("person");
      return {
        instance: {
          ...quotaUsage(this.settings.instanceLimitBytes, this.used()),
          defaultUserLimitBytes: this.settings.defaultUserLimitBytes,
          unassignedBytes: this.used(""),
        },
        people: people.map(({ value }) => ({
          personId: value.id,
          ...quotaUsage(this.limit(value), this.used(value.id)),
        })),
      };
    });
  }

  forPerson(personId: string): Promise<PersonQuota> {
    return this.serial(async () => {
      await this.refresh();
      const person = await this.client.get<RegistryPerson>(this.panelDb, `person:${personId}`);
      if (!person || person.kind !== "person") throw new ServiceError("not_found", 404);
      const usage = quotaUsage(this.limit(person.value), this.used(personId));
      const globalRemaining = quotaUsage(
        this.settings.instanceLimitBytes,
        this.used(),
      ).remainingBytes;
      usage.remainingBytes =
        usage.remainingBytes === null
          ? globalRemaining
          : globalRemaining === null
            ? usage.remainingBytes
            : Math.min(usage.remainingBytes, globalRemaining);
      return { personId, ...usage };
    });
  }

  setPersonLimit(actor: string, personId: string, limit: number | null): Promise<void> {
    return this.serial(async () => {
      this.validateLimit(limit);
      const person = await this.client.get<RegistryPerson>(this.panelDb, `person:${personId}`);
      if (!person || person.kind !== "person") throw new ServiceError("not_found", 404);
      person.value.quotaBytes = limit;
      await this.client.put(this.panelDb, person);
      const eventId = crypto.randomUUID();
      await this.client.put(this.panelDb, {
        _id: `event:${eventId}`,
        kind: "event",
        schemaVersion: 1,
        value: {
          id: eventId,
          at: new Date().toISOString(),
          actor,
          action: "person.quota_changed",
          target: personId,
          result: "success",
        },
      });
    });
  }

  withWrite<T>(
    database: string,
    documentIds: string[],
    project: (leaves: Map<string, QuotaLeaf[]>) => number | Promise<number>,
    forward: () => Promise<T>,
    authorize?: () => Promise<void>,
  ): Promise<T> {
    return this.serial(async () => {
      await this.refresh(database);
      const meter = this.ledger.databases[database];
      if (!meter || !meter.personId) throw new ServiceError("unmanaged_database", 403);
      const ids = [...new Set(documentIds)];
      const leaves = new Map<string, QuotaLeaf[]>();
      for (const id of ids) leaves.set(id, await this.leaves(database, id));
      const growth = await project(leaves);
      if (!Number.isSafeInteger(growth)) throw new ServiceError("invalid_quota_projection", 400);
      const person = await this.client.get<RegistryPerson>(
        this.panelDb,
        `person:${meter.personId}`,
      );
      if (!person || person.kind !== "person") throw new ServiceError("quota_state_invalid", 503);
      const limit = this.limit(person.value);
      if (
        growth > 0 &&
        ((limit !== null && this.used(meter.personId) + growth > limit) ||
          (this.settings.instanceLimitBytes !== null &&
            this.used() + growth > this.settings.instanceLimitBytes))
      ) {
        throw new ServiceError("quota_exceeded", 413);
      }
      await authorize?.();
      this.ledger.pending = {
        database,
        ids,
        growth: Math.max(0, growth),
        startedAt: new Date().toISOString(),
      };
      await this.save();
      let result: T;
      try {
        result = await forward();
      } catch (error) {
        // A network timeout has an unknown commit outcome. Keep the reservation and fail closed.
        if (!(error instanceof CouchError) || error.status >= 500) throw error;
        await this.reconcileIds(database, ids);
        await this.releaseReservation();
        throw error;
      }
      await this.reconcileIds(database, ids);
      await this.releaseReservation();
      return result;
    });
  }

  removeDatabase(database: string, remove: () => Promise<void>): Promise<void> {
    return this.serial(async () => {
      await this.loadReady();
      await remove();
      delete this.ledger.databases[database];
      for (const [key, doc] of this.meterDocs) {
        if (doc.database !== database) continue;
        this.dirty.delete(key);
        await this.client.request(
          `${encodeURIComponent(this.panelDb)}/${encodeURIComponent(doc._id)}?rev=${encodeURIComponent(doc._rev!)}`,
          "DELETE",
        );
        this.meterDocs.delete(key);
      }
      await this.save();
    });
  }
}
