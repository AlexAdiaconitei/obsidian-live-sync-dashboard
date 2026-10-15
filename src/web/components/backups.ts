import type { BackupRun, BackupStatus } from "../../contracts.ts";
import type { MessageKey } from "../../locales/index.ts";
import { icon } from "../../icons.ts";
import { badge, date, escape, notice, t, table, type View } from "./html.ts";
import { quotaBytes } from "./quotas.ts";

export interface BackupSnapshot {
  status: BackupStatus | null;
  unreadable: boolean;
}
export const backupErrors: Record<string, MessageKey> = {
  archive_failed: "archiveFailed",
  upload_failed: "uploadFailed",
  retention_failed: "retentionFailed",
  interrupted: "interrupted",
  worker_failed: "workerFailed",
};
export function backupWarnings(view: View, snapshot: BackupSnapshot, maxAgeHours: number): string {
  if (snapshot.unreadable) return notice(view, "backupUnreadable", "danger");
  if (!snapshot.status) return notice(view, "unavailable");
  const { lastAttempt, lastSuccess } = snapshot.status;
  let warnings = lastAttempt?.outcome === "failure" ? notice(view, "backupFailure", "danger") : "";
  if (!lastSuccess) warnings += notice(view, "backupMissing", "danger");
  else if (
    Date.now() - Date.parse(lastSuccess.endedAt ?? lastSuccess.startedAt) >
    maxAgeHours * 3_600_000
  )
    warnings += notice(view, "backupStale", "danger");
  return warnings;
}
export function backupSummary(view: View, snapshot: BackupSnapshot, maxAgeHours: number): string {
  // The metric matches the other overview cards: the latest outcome, then its date.
  const outcome = snapshot.status?.running ? "running" : snapshot.status?.lastAttempt?.outcome;
  return `<section class="panel stat"><h2>${icon("cloud-arrow-up")}${t(view, "backups")}</h2>${
    outcome ? `<p class="metric">${t(view, outcome)}</p>` : ""
  }${backupWarnings(view, snapshot, maxAgeHours)}<p class="muted">${t(view, "lastSuccess")}: ${date(
    view,
    snapshot.status?.lastSuccess?.endedAt,
  )}</p><a href="/backups">${t(view, "details")}</a></section>`;
}
export function backupPanel(
  view: View,
  snapshot: BackupSnapshot,
  maxAgeHours: number,
  requestId?: string,
): string {
  const pollingUrl = `/backups/status${
    requestId ? `?requestId=${encodeURIComponent(requestId)}` : ""
  }`;
  const status = snapshot.status;
  const requested = requestId
    ? [status?.running, status?.lastAttempt, status?.lastSuccess, ...(status?.history ?? [])].find(
        (run) => run?.requestId === requestId,
      )
    : undefined;
  const correlation = requestId
    ? `<section class="panel"><h2>${t(view, "requestId")}</h2><code>${escape(requestId)}</code> ${badge(
        view,
        requested?.outcome ?? "pending",
      )}${
        requested ? runDetails(view, requested) : `<p class="muted">${t(view, "backupHelp")}</p>`
      }</section>`
    : "";
  const config = status
    ? `<section class="panel"><dl class="quota-metrics"><div><dt>${t(
        view,
        "schedule",
      )}</dt><dd><code>${escape(status.schedule)}</code></dd></div><div><dt>${t(
        view,
        "timezone",
      )}</dt><dd>${escape(status.timezone)}</dd></div><div><dt>${t(
        view,
        "retention",
      )}</dt><dd>${status.retentionDays} ${t(view, "days")}</dd></div></dl><div class="grid backup-runs"><div><h2>${t(
        view,
        "lastSuccess",
      )}</h2>${status.lastSuccess ? runDetails(view, status.lastSuccess) : "—"}</div><div><h2>${t(
        view,
        "lastAttempt",
      )}</h2>${status.lastAttempt ? runDetails(view, status.lastAttempt) : "—"}</div></div></section>${
        status.running
          ? `<section class="panel"><h2>${t(view, "running")}</h2>${runDetails(
              view,
              status.running,
            )}</section>`
          : ""
      }<section class="panel">${table(
        view,
        ["requestId", "date", "status", "size", "error"],
        status.history.map((run) => [
          escape(run.requestId),
          date(view, run.startedAt),
          badge(view, run.outcome),
          size(view, run.sizeBytes),
          error(view, run.error),
        ]),
        [3],
      )}</section>`
    : "";
  const active =
    !!status?.running || (!!requestId && (!requested || requested.outcome === "running"));
  return `<div id="backup-status" hx-get="${pollingUrl}" hx-trigger="every ${active ? 5 : 60}s" hx-target="this" hx-swap="outerHTML">${backupWarnings(
    view,
    snapshot,
    maxAgeHours,
  )}${correlation}${config}</div>`;
}
function error(view: View, code: string | null): string {
  return code ? t(view, backupErrors[code] ?? "workerFailed") : "—";
}
function size(view: View, bytes: number | null): string {
  return bytes === null ? "—" : quotaBytes(view, bytes);
}
function runDetails(view: View, run: BackupRun): string {
  return `<p>${badge(view, run.outcome)} ${date(
    view,
    run.endedAt ?? run.startedAt,
  )}</p><p class="muted">${t(view, "size")}: ${size(view, run.sizeBytes)}</p>${
    run.error ? `<p class="notice danger">${error(view, run.error)}</p>` : ""
  }<p class="muted">${t(view, "upload")}: ${t(
    view,
    run.uploadOk ? "success" : run.outcome === "running" ? "pending" : "failure",
  )} · ${t(view, "retention")}: ${t(
    view,
    run.retentionOk ? "success" : run.outcome === "running" ? "pending" : "failure",
  )} · ${t(view, "notifications")}: ${t(
    view,
    run.notificationOk ? "success" : run.outcome === "running" ? "pending" : "failure",
  )}</p>`;
}
