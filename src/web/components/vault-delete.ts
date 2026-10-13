import type { Vault } from "../../contracts.ts";
import { icon } from "../../icons.ts";
import { escape, field, form, heading, notice, t, type View } from "./html.ts";

export function vaultDeletePanel(view: View, vault: Vault): string {
  const base = `/vaults/${encodeURIComponent(vault.id)}`;
  return `<div class="setup-flow"><section class="panel setup-section">${heading(view, escape(vault.label), { icon: "vault" })}<p class="meta"><code>${escape(vault.db)}</code></p>${notice(view, "vaultDeleteWarning", "danger")}<p class="muted">${t(view, "vaultDeleteLocal")}</p></section>
  <section class="panel setup-section">${heading(view, t(view, "vaultDownloadFirst"), { icon: "download", hint: "vaultArchiveHelp" })}<p class="muted">${t(view, "vaultArchiveCheck")}</p><div class="actions"><a class="button" href="${base}/archive.zip" hx-boost="false" data-download-vault download="livesync-${escape(vault.db)}.zip">${icon("download")}${t(view, "downloadVaultZip")}</a></div><p id="vault-archive-status" class="status-line" role="status" aria-live="polite"></p></section>
  <section class="panel setup-section">${heading(view, t(view, "vaultDeleteConfirmTitle"), { icon: "trash", hint: "vaultDeleteConfirmHelp" })}${form(view, `${base}/delete`, `<fieldset class="delete-backup-choice"><legend>${t(view, "vaultBackupDecision")}</legend><label><input type="radio" name="backup" value="downloaded" required> ${t(view, "vaultBackupDownloaded")}</label><label><input type="radio" name="backup" value="skip" required> ${t(view, "vaultBackupSkip")}</label></fieldset>${field(view, "vaultConfirmLabel", "label")}${field(view, "setupSyncPassword", "password", { type: "password" })}<label class="delete-acknowledgement"><input type="checkbox" name="irreversible" required> <span>${t(view, "vaultDeleteAcknowledge")}</span></label>`, "deleteVaultPermanently", "danger delete-button", "vaultDeleteFinalWarning")}</section></div>`;
}
