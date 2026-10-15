import { BACKUP_STALE_MS, type PersonalBackupStatus } from "../../backup/personal.ts";
import type { MessageKey } from "../../locales/index.ts";
import { icon } from "../../icons.ts";
import { badge, date, escape, field, form, heading, hint, notice, t, type View } from "./html.ts";

const errors: Record<string, MessageKey> = {
  backup_export_failed: "personalErrorExport",
  backup_too_large: "personalErrorTooLarge",
  drive_upload_failed: "personalErrorUpload",
  drive_retention_failed: "personalErrorRetention",
  interrupted: "personalErrorInterrupted",
  drive_revoke_failed: "personalErrorRevoke",
};

export function personalBackupPanel(view: View, status: PersonalBackupStatus): string {
  const settings =
    field(view, "backupRecipient", "recipient", {
      value: status.recipient,
      hint: "backupRecipientHelp",
    }) +
    `<p class="recovery-key"><button class="button" type="button" data-create-recovery-key>${icon("key")}${t(view, "personalRecoveryKeyCreate")}</button><span class="status-line" data-recovery-key-status role="status"></span></p>` +
    `<label class="field" hidden><span><input type="checkbox" name="keySaved"> ${t(view, "personalRecoveryKeySaved")}</span></label>` +
    field(view, "retention", "retentionDays", {
      type: "number",
      value: String(status.retentionDays),
      min: 1,
      max: 3650,
    }) +
    `<label class="field"><span><input type="checkbox" name="enabled" ${status.enabled ? "checked" : ""}> ${t(view, "personalBackupDaily")}</span></label>`;
  const google = status.connected
    ? `<div class="drive-folder">${icon("folder-simple")}<div><span class="muted">${t(view, "personalDriveFolder")}</span><a href="https://drive.google.com/drive/folders/${escape(status.folderId)}" target="_blank" rel="noopener noreferrer">${status.folderName ? escape(status.folderName) : t(view, "personalDriveFolder")}${icon("arrow-square-out")}</a></div>${hint(view, "personalDriveFolderChange")}</div><div class="actions">${status.pickerAvailable ? `<a class="button" href="/backups/folder-picker">${icon("folder-open")}${t(view, "personalDriveChooseFolder")}</a>` : ""}${form(view, "/backups/folder/default", "", "personalDriveDefaultFolder", "")}<span class="actions-spacer"></span>${form(view, "/backups/google/disconnect", "", "personalDriveDisconnect", "subtle danger", "confirmDisconnect")}</div>${status.pickerAvailable ? "" : `<p class="muted">${t(view, "personalDrivePickerUnavailable")}</p>`}`
    : `<p class="muted">${t(view, "personalDriveNotConnected")}</p>${form(view, "/backups/google/connect", "", "personalDriveConnect")}`;
  return `<section class="panel">${heading(view, "Google Drive", {
    icon: "google-drive-logo",
    actions: status.connected ? badge(view, "healthy") : "",
  })}${google}</section>
    <section class="panel">${heading(view, t(view, "personalBackupSettings"), { icon: "gear", hint: "personalBackupPrivacy" })}${form(view, "/backups/settings", settings, "personalBackupSave")}</section>
    ${personalBackupStatusPanel(view, status)}`;
}

export function folderPickerPanel(view: View): string {
  return `<section class="panel empty-state" id="drive-folder-picker" data-loading="${t(view, "personalDrivePickerLoading")}" data-failed="${t(view, "personalDrivePickerFailed")}" data-cancelled="${t(view, "personalDrivePickerCancelled")}"><span class="empty-icon">${icon("google-drive-logo")}</span><p class="muted">${t(view, "personalDrivePickerShort")}</p><button id="drive-picker-open" class="button primary" type="button">${icon("folder-open")}${t(view, "personalDriveChooseFolder")}</button><p id="drive-picker-status" class="status-line" role="status"></p><form id="drive-folder-selection" method="post" action="/backups/folder"><input type="hidden" name="csrf" value="${escape(view.csrf)}"><input type="hidden" name="folderId"></form></section>`;
}

export function personalBackupStatusPanel(view: View, status: PersonalBackupStatus): string {
  const request =
    status.connected && status.recipient && !status.running && !status.queued
      ? form(view, "/backups/request", "", "requestBackup")
      : "";
  return `<section class="panel" id="personal-backup-status" hx-get="/backups/status" hx-trigger="every ${status.running ? 5 : 60}s" hx-target="this" hx-swap="outerHTML">${heading(
    view,
    t(view, "status"),
    { icon: "clock-counter-clockwise", hint: "personalBackupRecovery", actions: request },
  )}
    ${status.running ? notice(view, "running") : ""}${status.queued ? notice(view, "personalBackupQueued") : ""}${status.error ? notice(view, "personalBackupFailure", "danger") + notice(view, errors[status.error] ?? "personalErrorExport", "danger") : ""}
    ${status.connected && !status.lastSuccess ? notice(view, "backupMissing") : ""}
    ${status.connected && status.enabled && status.lastSuccess && Date.now() - Date.parse(status.lastSuccess) > BACKUP_STALE_MS ? notice(view, "personalBackupStale", "danger") : ""}
    <dl class="quota-metrics status-metrics"><div><dt>${t(view, "lastAttempt")}</dt><dd>${date(view, status.lastAttempt)}</dd></div><div><dt>${t(view, "lastSuccess")}</dt><dd>${date(view, status.lastSuccess)}</dd></div></dl>
    <div class="actions"><a class="button" href="/backups/restore">${icon("lifebuoy")}${t(view, "personalRestoreTitle")}</a></div></section>`;
}

// Inputs without a form: if the script fails to load, nothing typed here can be submitted.
export function restorePanel(view: View): string {
  const file = (key: MessageKey, name: string, accept: string) =>
    `<label class="field"><span>${t(view, key)}</span><input type="file" name="${name}" accept="${accept}"></label>`;
  return `<section class="panel restore" id="backup-restore">${heading(view, t(view, "personalRestoreOpen"), { icon: "file-lock", hint: "personalRestoreLocal" })}<div class="restore-inputs">${file("personalRestoreFile", "backup", ".age,.gz,.ndjson")}${file("personalRestoreKeyFile", "keyFile", ".txt,.key")}<label class="field"><span>${t(view, "personalRestoreKeyText")}</span><input type="password" name="keyText" autocomplete="off" spellcheck="false"></label></div><div class="actions"><button class="button primary" type="button" data-restore-open>${t(view, "personalRestoreOpen")}</button></div><p class="status-line" data-restore-status role="status"></p><div class="restore-vaults" data-restore-vaults></div><p class="restore-actions" data-restore-actions hidden><button class="button primary" type="button" data-restore-notes>${icon("download")}${t(view, "personalRestoreNotes")}</button> <button class="button" type="button" data-restore-raw>${t(view, "personalRestoreRaw")}</button></p></section>`;
}
