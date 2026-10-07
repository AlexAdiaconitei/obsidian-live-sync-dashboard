import { checkRemoteVersion } from "@vrtmrz/livesync-commonlib/compat/pouchdb/negotiation";
import {
  DEVICE_ID_PREFERRED,
  MILESTONE_DOCID,
  VERSIONING_DOCID,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ServiceError } from "../contracts.ts";
import { preferredTweakValues } from "../setup/settings.ts";
import { type CouchClient, type CouchDocument, CouchError } from "./client.ts";

function databaseAdapter(client: CouchClient, database: string, writable: boolean) {
  return {
    async get(documentId: string) {
      const document = await client.get(database, documentId);
      if (!document) throw new CouchError(404, "not_found");
      return document;
    },
    async put(document: CouchDocument) {
      if (!writable) throw new ServiceError("remote_version_requires_migration", 409);
      const saved = await client.put(database, document);
      return { ok: true, id: saved._id, rev: saved._rev };
    },
    info: () => client.request(encodeURIComponent(database)),
  } as unknown as Parameters<typeof checkRemoteVersion>[0];
}

export async function initializeLiveSyncVersion(
  client: CouchClient,
  database: string,
): Promise<void> {
  if (
    !(await checkRemoteVersion(databaseAdapter(client, database, true), () =>
      Promise.resolve(false),
    ))
  ) {
    throw new ServiceError("remote_version_incompatible", 409);
  }
}

export async function assertLiveSyncVersion(client: CouchClient, database: string): Promise<void> {
  if (!(await client.get(database, VERSIONING_DOCID))) {
    throw new ServiceError("remote_version_missing", 409);
  }
  if (
    !(await checkRemoteVersion(databaseAdapter(client, database, false), () =>
      Promise.resolve(false),
    ))
  ) {
    throw new ServiceError("remote_version_incompatible", 409);
  }
}

export async function hasRemoteUserContent(
  client: CouchClient,
  database: string,
): Promise<boolean> {
  const page = await client.request<{ total_rows: number; rows: Array<{ id: string }> }>(
    `${encodeURIComponent(database)}/_all_docs?limit=32`,
  );
  return (
    page.total_rows > page.rows.length ||
    page.rows.some(({ id }) => id !== VERSIONING_DOCID && !id.startsWith("_design/"))
  );
}

interface Milestone extends CouchDocument {
  tweak_values?: Record<string, unknown>;
}

// Publishes the settings a generated Setup URI uses, so the first device joins the remote
// instead of offering to rebuild it. Call only for a remote without user content: an
// unusable milestone, such as one locked by a failed rebuild, is replaced.
export async function ensureLiveSyncMilestone(
  client: CouchClient,
  database: string,
): Promise<void> {
  const current = await client.get<Milestone>(database, MILESTONE_DOCID);
  if (current?.tweak_values?.[DEVICE_ID_PREFERRED]) return;
  await client.put(database, {
    _id: MILESTONE_DOCID,
    ...(current?._rev ? { _rev: current._rev } : {}),
    type: "milestoneinfo",
    created: Date.now(),
    locked: false,
    accepted_nodes: [],
    node_info: {},
    node_chunk_info: {},
    tweak_values: { [DEVICE_ID_PREFERRED]: preferredTweakValues() },
  });
}
