import type { SetupMetadata } from "../../contracts.ts";
import type { MessageKey } from "../../locales/index.ts";
import { icon } from "../../icons.ts";
import { escape, heading, help, type Hint, hint, notice, t, type View } from "./html.ts";

function secretField(
  view: View,
  key: MessageKey,
  id: string,
  description: Hint,
  generate = false,
  optional = false,
): string {
  return `<div class="field"><div class="field-heading"><label for="${id}">${t(view, key)}</label>${help(view, id, description)}</div><div class="secret-control"><input id="${id}" type="password" data-secret autocomplete="off" aria-describedby="${id}-help" ${optional ? 'minlength="12"' : "required"}><div class="input-actions">${generate ? `<button type="button" class="icon-button" data-generate-target="${id}" aria-label="${t(view, "generateSecret")}" title="${t(view, "generateSecret")}">${icon("dice-five")}</button>` : ""}<button type="button" class="icon-button" data-toggle-password="${id}" aria-label="${t(view, "showPassword")}" aria-pressed="false" title="${t(view, "showPassword")}">${icon("eye")}</button></div></div></div>`;
}

export function setupPanel(view: View, metadata: SetupMetadata, existing: boolean): string {
  const newEncryption = metadata.instruction === "new" && metadata.encryptionSetup !== "existing";
  const base = `/vaults/${encodeURIComponent(metadata.vaultId)}`;
  const connection = (
    [
      ["hostname", "setupServer", "setupServerHelp"],
      ["username", "username", "setupUsernameHelp"],
      ["database", "database", "setupDatabaseHelp"],
    ] as const
  )
    .map(
      ([property, key, description]) =>
        `<div class="field"><div class="field-heading"><label for="setup-${property}">${t(view, key)}</label>${help(view, `setup-${property}`, description)}</div><input id="setup-${property}" readonly value="${escape(metadata[property])}" aria-describedby="setup-${property}-help"></div>`,
    )
    .join("");
  const steps = (["setupImportOpen", "setupImportPassword", "setupImportSync"] as const)
    .map((key) => `<li>${t(view, key)}</li>`)
    .join("");
  return `<div class="setup-flow"><section class="panel setup-section setup-heading">${heading(
    view,
    escape(metadata.label),
    { icon: "vault", hint: "setupIntro" },
  )}<p class="meta"><code>${escape(metadata.database)}</code></p>${existing ? notice(view, "vaultExists") : ""}</section>
    <form id="setup-form" data-new-encryption="${newEncryption}" hx-disable hx-boost="false" data-metadata-url="${base}/setup-metadata" data-issued-url="${base}/uri-issued" autocomplete="off">
      <section class="panel setup-section" aria-labelledby="setup-connection">${heading(view, t(view, "setupConnection"), { id: "setup-connection", hint: "setupConnectionIntro" })}<div class="connection-fields">${connection}</div>${secretField(
        view,
        "setupSyncPassword",
        "setup-password",
        ["setupPasswordHelp", "syncPasswordHelp"],
      )}</section>
      <section class="panel setup-section" aria-labelledby="setup-encryption">${heading(view, t(view, "setupEncryptionSection"), { id: "setup-encryption" })}${notice(view, newEncryption ? "setupNewEncryptionHelp" : "existingEncryptionHelp", newEncryption ? "info" : "warning")}<div class="field-pair">${secretField(view, "e2e", "setup-e2e", "setupEncryptionHelp", newEncryption)}${secretField(view, "e2eConfirm", "setup-e2e-confirm", "setupConfirmHelp")}</div></section>
      <section class="panel setup-section" aria-labelledby="setup-link">${heading(view, t(view, "setupLink"), { id: "setup-link", hint: "setupLinkIntro" })}<div class="field-pair"><div class="field"><div class="field-heading"><label for="setup-mode">${t(view, "uriMode")}</label>${help(view, "setup-mode", "setupModeHelp")}</div><select id="setup-mode" aria-describedby="setup-mode-help"><option value="ephemeral">${t(view, "ephemeral")}</option><option value="persistent">${t(view, "persistent")}</option></select></div>${secretField(view, "uriPassphrase", "setup-uri-passphrase", "setupUriPasswordHelp", true, true)}</div><div class="actions"><button id="setup-generate" class="button primary" type="submit">${icon("key")}${t(view, "generate")}</button></div><p id="setup-status" class="status-line" role="status" aria-live="polite"></p></section>
    </form>
    <section id="setup-result" class="panel setup-result" hidden aria-labelledby="setup-result-title"><div class="panel-title"><div class="panel-title-text"><h2 id="setup-result-title" tabindex="-1">${icon("check-circle")}${t(view, "setupReady")}</h2>${hint(view, "setupResultIntro")}</div></div><p id="setup-instruction" class="notice" role="status" hidden></p><div class="field"><div class="field-heading"><label for="setup-uri">${t(view, "setupUri")}</label>${help(view, "setup-uri", "setupUriHelp")}</div><textarea id="setup-uri" readonly autocomplete="off" aria-describedby="setup-uri-help"></textarea></div><div class="field"><div class="field-heading"><label for="setup-passphrase">${t(view, "generatedPassword")}</label>${help(view, "setup-passphrase", "setupUriPasswordHelp")}</div><input id="setup-passphrase" type="text" readonly autocomplete="off" aria-describedby="setup-passphrase-help"></div><div class="actions"><button id="setup-export" class="button primary" type="button">${icon("download")}${t(view, "exportSetup")}</button><button class="button" type="button" data-copy-target="setup-uri">${icon("copy")}${t(view, "copy")} URI</button><button class="button" type="button" data-copy-target="setup-passphrase">${icon("copy")}${t(view, "copy")} ${t(view, "generatedPassword")}</button><button id="setup-qr-toggle" class="button" type="button" aria-expanded="false" aria-controls="setup-qr" data-show="${t(view, "setupQrShow")}" data-hide="${t(view, "setupQrHide")}">${icon("qr-code")}<span>${t(view, "setupQrShow")}</span></button></div><div id="setup-qr" class="setup-qr" hidden><button type="button" class="qr-code" data-qr data-qr-expand aria-label="${t(view, "setupQrExpand")}" title="${t(view, "setupQrExpand")}"></button><div class="setup-qr-text"><h3>${icon("device-mobile")}${t(view, "setupQrTitle")}</h3><p class="muted">${t(view, "setupQrHelp")}</p><p class="notice warning" data-qr-error hidden>${icon("warning")}<span>${t(view, "setupQrTooLong")}</span></p><div class="actions"><button type="button" class="button" data-qr-expand>${icon("arrows-out")}${t(view, "setupQrExpand")}</button></div></div></div><p id="setup-export-warning" class="notice warning" role="status">${icon("warning")}<span>${t(view, "exportWarning")}</span></p><p id="setup-expiry" class="meta"></p><div id="setup-import-steps">${heading(view, t(view, "setupImportTitle"), { level: 3, hint: "setupTroubleshooting" })}<ol class="steps">${steps}</ol><p class="muted">${t(view, "setupExpiry")}</p></div><div class="actions result-footer"><button id="setup-restart" class="button" type="button">${icon("arrows-clockwise")}${t(view, "setupAgain")}</button></div></section>
    <dialog id="setup-qr-dialog" class="qr-dialog" aria-labelledby="setup-qr-dialog-title"><div class="qr-dialog-header"><h2 id="setup-qr-dialog-title">${icon("device-mobile")}${t(view, "setupQrTitle")}</h2><form method="dialog"><button class="icon-button" value="close" aria-label="${t(view, "setupQrClose")}" title="${t(view, "setupQrClose")}">${icon("x")}</button></form></div><div class="qr-dialog-code" data-qr-large></div><p class="muted">${t(view, "setupQrDistance")}</p></dialog>
  </div>`;
}
