import { AttemptLimiter } from "../access/limiter.ts";
import { type CouchClient, CouchError } from "../couchdb/client.ts";
import { ServiceError } from "../contracts.ts";
import type { QuotaLeaf, QuotaManager } from "../domain/quota.ts";
import { documentBytes } from "./bytes.ts";

const maxBody = 64 * 1024 ** 2;
// Total of buffered write bodies: two maximum-size bodies within the panel's memory limit.
const maxBuffered = 128 * 1024 ** 2;
const maxCheckpoint = 64 * 1024;
const maxCheckpointDatabase = 1024 ** 2;
const hopHeaders = [
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "keep-alive",
  "proxy-authorization",
  "proxy-authenticate",
];
const readonlyPost = new Set([
  "_all_docs",
  "_bulk_get",
  "_revs_diff",
  "_find",
  "_changes",
  "_explain",
]);

function headers(request: Request): Headers {
  const result = new Headers(request.headers);
  for (const key of hopHeaders) result.delete(key);
  for (const key of [...result.keys()]) {
    if (
      key.toLowerCase().startsWith("x-auth-couchdb-") ||
      key.toLowerCase().startsWith("tailscale-")
    )
      result.delete(key);
  }
  result.set("accept-encoding", "identity");
  return result;
}

async function limitedBody(
  request: Request,
  maximum = maxBody,
  budget?: { used: number },
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maximum) throw new ServiceError("sync_request_too_large", 413);
  if (budget && budget.used + declared > maxBuffered) {
    throw new ServiceError("sync_queue_full", 429);
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = setTimeout(() => reader.cancel("body_read_timeout").catch(() => {}), 30_000);
  const started = Date.now();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (Date.now() - started >= 30_000) throw new ServiceError("sync_request_timeout", 408);
      if (done) break;
      total += value.length;
      if (total > maximum) throw new ServiceError("sync_request_too_large", 413);
      if (budget) {
        if (budget.used + value.length > maxBuffered) {
          throw new ServiceError("sync_queue_full", 429);
        }
        budget.used += value.length;
      }
      chunks.push(value);
    }
  } catch (error) {
    if (budget) budget.used -= chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function streamedBody(request: Request): ReadableStream<Uint8Array> | null {
  if (Number(request.headers.get("content-length") ?? 0) > maxBody) {
    throw new ServiceError("sync_request_too_large", 413);
  }
  let received = 0;
  return (
    request.body?.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.length;
          if (received > maxBody) throw new ServiceError("sync_request_too_large", 413);
          controller.enqueue(chunk);
        },
      }),
    ) ?? null
  );
}

function json(bytes: Uint8Array): Record<string, unknown> {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new ServiceError("invalid_json", 400);
  }
}

function requestRevision(request: Request): string | undefined {
  return (
    new URL(request.url).searchParams.get("rev") ??
    request.headers
      .get("if-match")
      ?.trim()
      .replace(/^"(.*)"$/, "$1")
  );
}

function document(value: unknown): Record<string, unknown> & { _id: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceError("invalid_document", 400);
  }
  const doc = value as Record<string, unknown>;
  if (
    typeof doc._id !== "string" ||
    !doc._id ||
    doc._id.length > 1024 ||
    [...doc._id].some((character) => character.charCodeAt(0) < 32)
  )
    throw new ServiceError("invalid_document_id", 400);
  if (doc._id.startsWith("_design/") || doc._id === "_local/dashboard-owner") {
    throw new ServiceError("reserved_document", 403);
  }
  return doc as Record<string, unknown> & { _id: string };
}

function ancestors(doc: Record<string, unknown>, newEdits: boolean): Set<string> {
  if (newEdits) return new Set(typeof doc._rev === "string" ? [doc._rev] : []);
  const revs = doc._revisions as { start?: unknown; ids?: unknown } | undefined;
  if (!revs) return new Set();
  if (
    !Number.isSafeInteger(revs.start) ||
    Number(revs.start) < 1 ||
    !Array.isArray(revs.ids) ||
    revs.ids.length > Number(revs.start) ||
    !revs.ids.every((id) => typeof id === "string" && /^[a-zA-Z0-9]+$/.test(id))
  )
    throw new ServiceError("invalid_revisions", 400);
  if (doc._rev !== `${revs.start}-${revs.ids[0]}`) throw new ServiceError("invalid_revisions", 400);
  return new Set(revs.ids.slice(1).map((id, index) => `${Number(revs.start) - index - 1}-${id}`));
}

export function projectedGrowth(
  doc: Record<string, unknown>,
  leaves: QuotaLeaf[],
  newEdits: boolean,
): number {
  if (!newEdits && leaves.some((leaf) => leaf.rev === doc._rev)) return 0;
  const replaced = ancestors(doc, newEdits);
  const old = leaves.reduce((total, leaf) => total + leaf.bytes, 0);
  const next = leaves
    .filter((leaf) => !replaced.has(leaf.rev))
    .reduce((total, leaf) => total + leaf.bytes, documentBytes(doc));
  return Math.max(0, next - old);
}

// Failed logins per username and minute. CouchDB may lock accounts too, but an existing
// server's lockout settings are not under the panel's control.
const maxFailures = 5;

function basicUser(request: Request): string | undefined {
  const match = /^Basic\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) return undefined;
  try {
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0)),
    );
    const separator = decoded.indexOf(":");
    return separator > 0 ? decoded.slice(0, Math.min(separator, 256)) : undefined;
  } catch {
    return undefined;
  }
}

function sessionUser(request: Request, body: Uint8Array): string | undefined {
  const text = new TextDecoder().decode(body);
  try {
    const name = (request.headers.get("content-type") ?? "").includes("json")
      ? (JSON.parse(text) as { name?: unknown }).name
      : new URLSearchParams(text).get("name");
    return typeof name === "string" && name ? name.slice(0, 256) : undefined;
  } catch {
    return undefined;
  }
}

export class QuotaGateway {
  private waiting = 0;
  private readonly buffered = { used: 0 };
  private readonly failures = new AttemptLimiter();
  private readonly authorization: string;
  constructor(
    private readonly client: CouchClient,
    private readonly quotas: QuotaManager,
    private readonly url: string,
    username: string,
    password: string,
    // Recreates a vault database for the account that owns it; see resetVaultDatabase.
    private readonly resetDatabase?: (user: string, database: string) => Promise<void>,
  ) {
    this.authorization = `Basic ${btoa(
      String.fromCharCode(...new TextEncoder().encode(`${username}:${password}`)),
    )}`;
  }

  private async forward(
    request: Request,
    administrative = false,
    body?: Uint8Array<ArrayBuffer> | string,
  ): Promise<Response> {
    const incoming = new URL(request.url);
    const target = new URL(this.url);
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    const outgoing = headers(request);
    if (administrative) {
      outgoing.set("authorization", this.authorization);
      outgoing.delete("cookie");
    }
    try {
      const outgoingBody =
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : (body ?? streamedBody(request));
      const response = await fetch(target, {
        method: request.method,
        headers: outgoing,
        body: outgoingBody,
        redirect: "error",
        ...{ duplex: "half" as const },
        signal: administrative ? AbortSignal.timeout(30_000) : request.signal,
      });
      const responseHeaders = new Headers(response.headers);
      for (const key of hopHeaders) responseHeaders.delete(key);
      responseHeaders.delete("content-encoding");
      // Finish the write response before releasing admission for another request.
      const responseBody = administrative ? await response.arrayBuffer() : response.body;
      return new Response(responseBody, { status: response.status, headers: responseHeaders });
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      if (error instanceof Error && error.cause instanceof ServiceError) throw error.cause;
      throw new CouchError(503);
    }
  }

  private refuseBlocked(user: string | undefined): void {
    if (user && this.failures.count(user) >= maxFailures) {
      throw new ServiceError("too_many_attempts", 429);
    }
  }

  private async session(request: Request): Promise<Response> {
    const body = ["GET", "HEAD"].includes(request.method)
      ? undefined
      : await limitedBody(request, 32_768);
    const user = (body && sessionUser(request, body)) || basicUser(request);
    this.refuseBlocked(user);
    const response = await this.forward(request, false, body);
    if (user && response.status === 401) this.failures.add(user);
    return response;
  }

  private async authenticate(request: Request, database?: string, cors = new Headers()) {
    const outgoing = headers(request);
    const session = await fetch(new URL("/_session", this.url), {
      headers: outgoing,
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    for (const [key, value] of session.headers) {
      if (key.startsWith("access-control-") || key === "vary") cors.set(key, value);
    }
    if (!session.ok) {
      await session.body?.cancel();
      throw new ServiceError("unauthorized", 401);
    }
    const result = (await session.json()) as { userCtx?: { name?: string; roles?: string[] } };
    if (!result.userCtx?.name) throw new ServiceError("unauthorized", 401);
    const admin = result.userCtx.roles?.includes("_admin") ?? false;
    if (database) {
      const permission = await fetch(new URL(`/${encodeURIComponent(database)}`, this.url), {
        headers: outgoing,
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      for (const [key, value] of permission.headers) {
        if (key.startsWith("access-control-") || key === "vary") cors.set(key, value);
      }
      if (!permission.ok) {
        const status = permission.status;
        await permission.body?.cancel();
        throw new ServiceError("forbidden", status);
      }
      await permission.body?.cancel();
    }
    return { admin, name: result.userCtx.name, cors };
  }

  private hydrated(doc: Record<string, unknown>, leaves: QuotaLeaf[]): Record<string, unknown> {
    const attachments = doc._attachments;
    if (!attachments) return doc;
    if (typeof attachments !== "object" || Array.isArray(attachments)) {
      throw new ServiceError("invalid_attachment", 400);
    }
    const normalized: Record<string, unknown> = Object.create(null);
    for (const [name, value] of Object.entries(attachments)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new ServiceError("invalid_attachment", 400);
      }
      const item = value as Record<string, unknown>;
      if (typeof item.data === "string") {
        if (item.encoding || item.encoded_length) {
          throw new ServiceError("encoded_attachment_not_supported", 400);
        }
        normalized[name] = item;
      } else if (item.stub === true) {
        const stored = leaves
          .flatMap((leaf) =>
            Object.entries(
              (leaf.doc._attachments ?? {}) as Record<string, Record<string, unknown>>,
            ),
          )
          .find(([key, current]) => key === name && current.digest === item.digest);
        if (!stored) throw new ServiceError("missing_attachment_stub", 400);
        normalized[name] = stored[1];
      } else throw new ServiceError("invalid_attachment", 400);
    }
    return { ...doc, _attachments: normalized };
  }

  private async checkpointBudget(database: string, docs: Record<string, unknown>[]) {
    const requested = docs.filter((doc) => String(doc._id).startsWith("_local/"));
    if (!requested.length) return;
    const stored = await this.client.request<{
      rows: Array<{ id: string; doc: Record<string, unknown> }>;
    }>(`${encodeURIComponent(database)}/_local_docs?include_docs=true&limit=2000`);
    const sizes = new Map(
      stored.rows.map((row) => [row.id, new TextEncoder().encode(JSON.stringify(row.doc)).length]),
    );
    for (const doc of requested) {
      const size = new TextEncoder().encode(JSON.stringify(doc)).length + 64;
      if (size > maxCheckpoint) throw new ServiceError("checkpoint_too_large", 413);
      // Bulk requests can partially fail. Never credit a shrink or deletion before it commits.
      if (doc._deleted !== true) {
        const id = String(doc._id);
        sizes.set(id, Math.max(sizes.get(id) ?? 0, size));
      }
    }
    if (
      (stored.rows.length >= 2000 && requested.some((doc) => doc._deleted !== true)) ||
      [...sizes.values()].reduce((a, b) => a + b, 0) > maxCheckpointDatabase
    )
      throw new ServiceError("checkpoint_quota_exceeded", 413);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let cors = new Headers();
    try {
      if (url.pathname.startsWith("//")) throw new ServiceError("invalid_sync_path", 400);
      if (request.method === "OPTIONS") return await this.forward(request);
      if (url.pathname === "/_session") return await this.session(request);
      let parts: string[];
      try {
        parts = url.pathname.slice(1).split("/").map(decodeURIComponent);
      } catch {
        throw new ServiceError("invalid_sync_path", 400);
      }
      if (parts[1]?.startsWith("_local/")) {
        parts.splice(1, 1, "_local", parts[1].slice(7));
      }
      const database = parts[0];
      const action = parts[1] ?? "";
      const unsafe =
        parts.includes("_rewrite") ||
        parts.includes("_update") ||
        parts.includes("_purge") ||
        database === "_replicate" ||
        database === "_replicator";
      const user = basicUser(request);
      this.refuseBlocked(user);
      const authentication = await this.authenticate(
        request,
        database && !database.startsWith("_") ? database : undefined,
        cors,
      ).catch((error: unknown) => {
        if (user && error instanceof ServiceError && error.status === 401) this.failures.add(user);
        throw error;
      });
      cors = authentication.cors;
      if (unsafe && !authentication.admin) throw new ServiceError("sync_operation_forbidden", 403);
      const read =
        request.method === "GET" ||
        request.method === "HEAD" ||
        (request.method === "POST" && readonlyPost.has(action));
      if (read) return await this.forward(request);
      if (!database || database.startsWith("_")) {
        if (!authentication.admin) throw new ServiceError("sync_operation_forbidden", 403);
        return await this.forward(request);
      }
      // Deleting and recreating the database is how LiveSync rebuilds a remote. The panel owns
      // database lifecycle, so it performs the reset; creation only confirms the database exists.
      if (!action && request.method !== "POST" && !authentication.admin) {
        if (request.method === "DELETE" && this.resetDatabase) {
          await this.resetDatabase(authentication.name, database);
          return Response.json({ ok: true }, { headers: cors });
        }
        if (request.method === "PUT") {
          return Response.json(
            {
              error: "file_exists",
              reason: "The database could not be created, the file already exists.",
            },
            { status: 412, headers: cors },
          );
        }
        throw new ServiceError("remote_rebuild_forbidden", 403);
      }
      if (!action && request.method !== "POST") return await this.forward(request);
      if (action.startsWith("_") && !["_bulk_docs", "_local"].includes(action)) {
        if (!authentication.admin) throw new ServiceError("sync_operation_forbidden", 403);
        return await this.forward(request);
      }
      if (this.waiting >= 32) throw new ServiceError("sync_queue_full", 429);
      this.waiting++;
      try {
        return await this.write(request, database, parts.slice(1), authentication.cors);
      } finally {
        this.waiting--;
      }
    } catch (error) {
      const status =
        error instanceof ServiceError || error instanceof CouchError ? error.status : 503;
      const reason = error instanceof ServiceError ? error.code : "quota_gateway_unavailable";
      // Sync clients often show only the status. The reason, method and endpoint in the
      // container log identify the refused request; document ids stay out of it.
      const [, database = "", action = ""] = url.pathname.split("/");
      console.warn(
        JSON.stringify({
          event: "sync_refused",
          status,
          reason,
          method: request.method,
          database,
          endpoint: action.startsWith("_") ? action : action ? "document" : "database",
        }),
      );
      return Response.json(
        {
          error: status === 401 ? "unauthorized" : status === 409 ? "conflict" : "forbidden",
          reason,
        },
        { status, headers: new Headers([...cors, ["Cache-Control", "no-store"]]) },
      );
    }
  }

  private async write(
    request: Request,
    database: string,
    path: string[],
    cors: Headers,
  ): Promise<Response> {
    if (new URL(request.url).searchParams.has("batch")) {
      throw new ServiceError("asynchronous_write_not_supported", 400);
    }
    const encoding = request.headers.get("content-encoding");
    if (encoding && encoding.toLowerCase() !== "identity") {
      throw new ServiceError("encoded_request_not_supported", 400);
    }
    const bytes = await limitedBody(request, maxBody, this.buffered);
    try {
      return await this.commit(request, database, path, cors, bytes);
    } finally {
      this.buffered.used -= bytes.length;
    }
  }

  private async commit(
    request: Request,
    database: string,
    path: string[],
    cors: Headers,
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<Response> {
    const action = path[0] ?? "";
    let docs: Array<Record<string, unknown> & { _id: string }>;
    let body: Uint8Array<ArrayBuffer> | string = bytes;
    let newEdits = true;
    let attachment: { id: string; name: string; length: number; type: string } | undefined;
    if (action === "_bulk_docs") {
      if (request.method !== "POST") throw new ServiceError("sync_operation_forbidden", 403);
      const input = json(bytes);
      if (!Array.isArray(input.docs) || input.docs.length > 1000) {
        throw new ServiceError("invalid_bulk_docs", 400);
      }
      if (input.new_edits !== undefined && typeof input.new_edits !== "boolean") {
        throw new ServiceError("invalid_bulk_docs", 400);
      }
      newEdits = input.new_edits !== false;
      docs = input.docs.map(document);
    } else {
      const id = action === "_local" ? path.slice(0, 2).join("/") : action;
      const attachmentPath = action === "_local" ? path.slice(2) : path.slice(1);
      if (attachmentPath.length) {
        if (action === "_local") throw new ServiceError("sync_operation_forbidden", 403);
        attachment = {
          id,
          name: attachmentPath.join("/"),
          length: bytes.length,
          type: request.headers.get("content-type") ?? "application/octet-stream",
        };
        docs = [document({ _id: id, _rev: requestRevision(request) })];
      } else if (request.method === "DELETE") {
        docs = [document({ _id: id, _rev: requestRevision(request), _deleted: true })];
      } else if (request.method === "POST" && !id) {
        const input = json(bytes);
        docs = [
          document({
            ...input,
            _id: typeof input._id === "string" ? input._id : crypto.randomUUID(),
          }),
        ];
        body = JSON.stringify(docs[0]);
      } else if (request.method === "PUT" && id) {
        const mode = new URL(request.url).searchParams.get("new_edits");
        if (mode !== null && !["true", "false"].includes(mode)) {
          throw new ServiceError("invalid_new_edits", 400);
        }
        newEdits = mode !== "false";
        const input = json(bytes);
        if (input._id !== undefined && input._id !== id) {
          throw new ServiceError("document_id_mismatch", 400);
        }
        docs = [document({ ...input, _id: id, _rev: input._rev ?? requestRevision(request) })];
      } else throw new ServiceError("sync_operation_forbidden", 403);
    }
    if (attachment && !["PUT", "DELETE"].includes(request.method)) {
      throw new ServiceError("sync_operation_forbidden", 403);
    }
    const response = await this.quotas.withWrite(
      database,
      docs.map((doc) => doc._id),
      async (leaves) => {
        let candidates: Record<string, unknown>[] = docs;
        if (attachment) {
          const current = (leaves.get(attachment.id) ?? []).find(
            (leaf) => leaf.rev === docs[0]._rev,
          )?.doc;
          const attachments: Record<string, unknown> = Object.assign(
            Object.create(null),
            current?._attachments ?? {},
          );
          if (request.method === "DELETE") delete attachments[attachment.name];
          else {
            attachments[attachment.name] = {
              length: attachment.length,
              content_type: attachment.type,
            };
          }
          candidates = [{ ...current, ...docs[0], _attachments: attachments }];
        }
        await this.checkpointBudget(database, candidates);
        let growth = 0;
        const groups = new Map<string, Record<string, unknown>[]>();
        for (const doc of candidates) {
          const hydrated = attachment ? doc : this.hydrated(doc, leaves.get(String(doc._id)) ?? []);
          const group = groups.get(String(doc._id)) ?? [];
          group.push(hydrated);
          groups.set(String(doc._id), group);
        }
        for (const [id, values] of groups) {
          const current = leaves.get(id) ?? [];
          const unique = newEdits
            ? values
            : values.filter(
                (doc, index) =>
                  !current.some((leaf) => leaf.rev === doc._rev) &&
                  values.findIndex((candidate) => candidate._rev === doc._rev) === index,
              );
          growth +=
            unique.length === 1
              ? projectedGrowth(unique[0], current, newEdits)
              : unique.reduce((sum, doc) => sum + documentBytes(doc), 0);
        }
        return growth;
      },
      async () => {
        const result = await this.forward(request, true, body);
        if (result.status === 202 || result.status >= 500) {
          await result.body?.cancel();
          throw new CouchError(result.status === 202 ? 503 : result.status);
        }
        return result;
      },
      async () => {
        request.signal.throwIfAborted();
        await this.authenticate(request, database, cors);
      },
    );
    const output = new Headers(response.headers);
    for (const [key, value] of cors) output.set(key, value);
    return new Response(response.body, { status: response.status, headers: output });
  }
}
