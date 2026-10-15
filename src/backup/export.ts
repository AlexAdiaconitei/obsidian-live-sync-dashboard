import { DOCID_SYNC_PARAMETERS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ServiceError, type Vault } from "../contracts.ts";
import type { CouchClient, CouchDocument } from "../couchdb/client.ts";

// Preserve every current leaf, including conflicts, tombstones and attachment bodies.
export async function* vaultRecords(client: CouchClient, vault: Vault): AsyncGenerator<string> {
  // End-to-end encryption derives its keys from this local document's salt, which _changes never
  // lists. Without it no passphrase can decrypt the exported notes.
  const parameters = await client.get<CouchDocument>(vault.db, DOCID_SYNC_PARAMETERS);
  if (parameters) {
    if (parameters._id !== DOCID_SYNC_PARAMETERS)
      throw new ServiceError("backup_export_failed", 503);
    const doc: Record<string, unknown> = { ...parameters };
    delete doc._rev;
    yield JSON.stringify({ type: "local", vaultId: vault.id, doc }) + "\n";
  }
  let since = "0";
  const started = Date.now();
  while (true) {
    if (Date.now() - started > 25 * 60_000) throw new ServiceError("backup_export_failed", 503);
    const query = new URLSearchParams({ since, style: "all_docs", limit: "100" });
    const changes = await client.request<{
      results: { id: string; changes: { rev: string }[] }[];
      last_seq: string | number;
      pending: number;
    }>(`${encodeURIComponent(vault.db)}/_changes?${query}`);
    for (const row of changes.results) {
      for (const { rev } of row.changes) {
        const query = new URLSearchParams({ rev, revs: "true", attachments: "true" });
        const path = row.id.startsWith("_design/")
          ? `_design/${encodeURIComponent(row.id.slice(8))}`
          : encodeURIComponent(row.id);
        const doc = await client.request<CouchDocument>(
          `${encodeURIComponent(vault.db)}/${path}?${query}`,
        );
        if (doc._id !== row.id || doc._rev !== rev)
          throw new ServiceError("backup_export_failed", 503);
        yield JSON.stringify({ type: "document", vaultId: vault.id, doc }) + "\n";
      }
    }
    if (changes.pending === 0 || changes.results.length === 0) break;
    const next = String(changes.last_seq);
    if (next === since) throw new ServiceError("backup_export_failed", 503);
    since = next;
  }
}
