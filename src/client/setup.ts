import { generateSetup, type SetupSecrets } from "../setup/generate.ts";
import type { SetupMetadata } from "../contracts.ts";
import { confirmDialog } from "./dialog.ts";
import { randomSecret, downloadText } from "./secrets.ts";
import { message } from "./text.ts";
import { qrSvg } from "./qr.ts";

// A full-screen copy: the camera needs several pixels per module, and this URI is dense.
function openLargeQr() {
  const dialog = document.getElementById("setup-qr-dialog");
  const target = dialog?.querySelector<HTMLElement>("[data-qr-large]");
  const uri = document.querySelector<HTMLTextAreaElement>("#setup-uri")?.value;
  if (!(dialog instanceof HTMLDialogElement) || !target || !uri) return;
  try {
    target.replaceChildren(qrSvg(uri));
  } catch {
    return;
  }
  dialog.addEventListener("close", () => target.replaceChildren(), { once: true });
  dialog.showModal();
}
function closeLargeQr() {
  const dialog = document.getElementById("setup-qr-dialog");
  if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
}

function showQr(open: boolean) {
  const panel = document.getElementById("setup-qr");
  const toggle = document.getElementById("setup-qr-toggle");
  const code = panel?.querySelector<HTMLElement>("[data-qr]");
  const error = panel?.querySelector<HTMLElement>("[data-qr-error]");
  if (!panel || !toggle || !code || !error) return;
  code.replaceChildren();
  closeLargeQr();
  error.hidden = true;
  code.hidden = false;
  const uri = document.querySelector<HTMLTextAreaElement>("#setup-uri")?.value;
  if (open && uri) {
    try {
      code.append(qrSvg(uri));
    } catch {
      code.hidden = true;
      error.hidden = false;
    }
  }
  panel.hidden = !(open && uri);
  for (const expand of panel.querySelectorAll<HTMLElement>("[data-qr-expand]"))
    expand.hidden = !error.hidden;
  toggle.setAttribute("aria-expanded", String(!panel.hidden));
  const label = toggle.querySelector("span");
  if (label) label.textContent = (panel.hidden ? toggle.dataset.show : toggle.dataset.hide) ?? "";
}

function clearSecrets(clearInputs = true) {
  exportText = "";
  needsExport = false;
  if (clearInputs)
    for (const field of document.querySelectorAll<HTMLInputElement>(
      "#setup-form input[data-secret]",
    )) {
      field.value = "";
    }
  for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    "#setup-uri, #setup-passphrase",
  ))
    field.value = "";
  showQr(false);
  document.getElementById("setup-result")?.setAttribute("hidden", "");
  document.getElementById("setup-form")?.removeAttribute("hidden");
  const instructions = document.getElementById("setup-instruction");
  if (instructions) {
    instructions.textContent = "";
    instructions.setAttribute("hidden", "");
  }
}

let active = false;
let generation = 0;
let pendingGeneration: AbortController | undefined;
let exportText = "";
let exportFilename = "livesync-setup.txt";
let needsExport = false;

function initializeSetup() {
  const form = document.querySelector<HTMLFormElement>('#setup-form[data-new-encryption="true"]');
  if (!form || form.dataset.initialized) return;
  form.dataset.initialized = "true";
  const e2e = form.querySelector<HTMLInputElement>("#setup-e2e");
  const confirm = form.querySelector<HTMLInputElement>("#setup-e2e-confirm");
  if (e2e && confirm && !e2e.value && !confirm.value) {
    e2e.value = randomSecret();
    confirm.value = e2e.value;
  }
}

document.addEventListener("DOMContentLoaded", initializeSetup);
document.addEventListener("htmx:afterSwap", initializeSetup);

// Leaving drops the generated setup; ask in the page instead of the browser's unload prompt.
document.addEventListener(
  "click",
  (event) => {
    if (!needsExport || !(event.target instanceof Element) || event.defaultPrevented) return;
    const link = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!link || link.target || link.hasAttribute("download") || link.href.startsWith("#")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void confirmDialog(message("setupLeave"), {
      confirmLabel: message("leavePage"),
      danger: true,
    }).then((leave) => {
      if (!leave) return;
      needsExport = false;
      location.href = link.href;
    });
  },
  true,
);

document.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>("button");
  if (!button) return;
  if (button.id === "setup-export" && exportText) {
    downloadText(exportFilename, exportText);
    needsExport = false;
    return;
  }
  if (button.matches("[data-qr-expand]")) {
    openLargeQr();
    return;
  }
  if (button.id === "setup-qr-toggle") {
    showQr(button.getAttribute("aria-expanded") !== "true");
    return;
  }
  if (button.id === "setup-restart") {
    if (needsExport && !(await confirmDialog(message("setupRestartConfirm")))) return;
    generation++;
    clearSecrets();
    const status = document.getElementById("setup-status");
    if (status) status.textContent = "";
    document.getElementById("setup-password")?.focus();
    return;
  }
  const target = button.dataset.generateTarget;
  if (!target || active) return;
  const input = document.getElementById(target);
  if (!(input instanceof HTMLInputElement)) return;
  input.value = randomSecret();
  if (target === "setup-e2e") {
    const confirm = document.querySelector<HTMLInputElement>("#setup-e2e-confirm");
    if (confirm) confirm.value = input.value;
  }
});

document.addEventListener(
  "submit",
  async (event) => {
    if (!(event.target instanceof HTMLFormElement) || event.target.id !== "setup-form") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (active) return;
    const form = event.target;
    const button = form.querySelector<HTMLButtonElement>("#setup-generate");
    const status = document.getElementById("setup-status");
    const password = form.querySelector<HTMLInputElement>("#setup-password");
    const e2e = form.querySelector<HTMLInputElement>("#setup-e2e");
    const confirm = form.querySelector<HTMLInputElement>("#setup-e2e-confirm");
    const uriPassphrase = form.querySelector<HTMLInputElement>("#setup-uri-passphrase");
    if (!password || !e2e) return;
    if (confirm && e2e.value !== confirm.value) {
      if (status) status.textContent = message("setupMismatch");
      return;
    }
    const fields = [
      ...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
        "input[data-secret], select, button",
      ),
    ];
    const secrets: SetupSecrets = {
      password: password.value,
      e2ePassphrase: e2e.value,
      uriPassphrase: uriPassphrase?.value,
      mode:
        form.querySelector<HTMLSelectElement>("#setup-mode")?.value === "persistent"
          ? "persistent"
          : "ephemeral",
    };
    const controller = new AbortController();
    clearSecrets(false);
    pendingGeneration = controller;
    active = true;
    const currentGeneration = ++generation;
    if (button) button.disabled = true;
    for (const field of fields) field.disabled = true;
    if (status) status.textContent = message("setupWorking");
    try {
      const metadataUrl = form.dataset.metadataUrl;
      if (!metadataUrl || new URL(metadataUrl, location.href).origin !== location.origin) {
        throw new Error("invalid_metadata_url");
      }
      const response = await fetch(metadataUrl, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (currentGeneration !== generation || !form.isConnected) return;
      if (!response.ok)
        throw new Error(response.status === 401 ? "session_expired" : "metadata_unavailable");
      const refreshedToken = response.headers.get("X-CSRF-Token");
      const tokenElement = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]');
      if (refreshedToken && tokenElement) tokenElement.content = refreshedToken;
      const metadata: SetupMetadata = await response.json();
      const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content;
      const issuedUrl =
        form.dataset.issuedUrl ?? metadataUrl.replace(/setup-metadata$/, "uri-issued");
      if (!csrf || new URL(issuedUrl, location.href).origin !== location.origin) {
        throw new Error("invalid_audit_request");
      }
      const verification = await fetch(
        metadataUrl.replace(/setup-metadata$/, "verify-credentials"),
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "X-CSRF-Token": csrf, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ password: secrets.password }),
          signal: controller.signal,
        },
      );
      if (!verification.ok) {
        const error = await verification.json().catch(() => ({}));
        throw new Error(
          ["invalid_credentials", "session_expired", "too_many"].includes(error.error)
            ? error.error
            : "verification_failed",
        );
      }
      if (currentGeneration !== generation || !form.isConnected) return;
      const generated = await generateSetup(metadata, secrets);
      if (currentGeneration !== generation || !form.isConnected) return;
      const issued = await fetch(issuedUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": csrf, "Content-Type": "application/x-www-form-urlencoded" },
        body: "",
        signal: controller.signal,
      });
      if (!issued.ok) throw new Error("setup_access_changed");
      const state: { instruction?: string } = await issued.json();
      if (state.instruction !== "new" && state.instruction !== "additional") {
        throw new Error("invalid_instruction");
      }
      if (currentGeneration !== generation || !form.isConnected) return;
      const uri = document.querySelector<HTMLInputElement | HTMLTextAreaElement>("#setup-uri");
      const passphrase = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        "#setup-passphrase",
      );
      const expiry = document.getElementById("setup-expiry");
      if (uri) uri.value = generated.uri;
      if (passphrase) passphrase.value = generated.passphrase;
      if (expiry) {
        expiry.textContent =
          generated.usableUntil === null
            ? message("setupPersistent")
            : `${message("setupExpires")} ${new Intl.DateTimeFormat(document.documentElement.lang, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(generated.usableUntil))}`;
      }
      const result = document.getElementById("setup-result");
      result?.removeAttribute("hidden");
      // The next step replaces the form; "Configure another device" brings it back.
      form.setAttribute("hidden", "");
      result?.scrollIntoView({ block: "start" });
      document.getElementById("setup-result-title")?.focus();
      const instruction = document.getElementById("setup-instruction");
      if (instruction) {
        instruction.textContent =
          state.instruction === "new"
            ? message("setupNewDevice")
            : message("setupAdditionalDevice");
        instruction.removeAttribute("hidden");
      }
      if (status) status.textContent = message("setupGenerated");
      exportFilename = `livesync-${metadata.database.replace(/[^a-zA-Z0-9_-]/g, "_")}.txt`;
      exportText = [
        message("setupExportTitle"),
        "",
        `Vault: ${metadata.label}`,
        `URL: ${metadata.hostname}`,
        `Database: ${metadata.database}`,
        `Username: ${metadata.username}`,
        `Sync password: ${secrets.password}`,
        `${message("setupEncryption")}: ${secrets.e2ePassphrase}`,
        `Recovery code: ${generated.idRecoveryCode}`,
        `Setup URI password: ${generated.passphrase}`,
        `Setup URI: ${generated.uri}`,
        "",
        generated.usableUntil === null
          ? message("setupPersistent")
          : `${message("setupExpires")}: ${new Date(generated.usableUntil).toISOString()}`,
        state.instruction === "new" ? message("setupNewDevice") : message("setupAdditionalDevice"),
        "",
      ].join("\n");
      needsExport = true;
      for (const field of form.querySelectorAll<HTMLInputElement>("input[data-secret]")) {
        field.value = "";
      }
      if (generated.usableUntil !== null) {
        const delay = Math.min(generated.usableUntil - Date.now(), 2_147_483_647);
        setTimeout(
          () => {
            if (currentGeneration === generation) clearSecrets();
          },
          Math.max(0, delay),
        );
      }
    } catch (error) {
      if (controller.signal.aborted || currentGeneration !== generation || !form.isConnected)
        return;
      clearSecrets(false);
      if (status)
        status.textContent =
          error instanceof Error && error.message === "invalid_credentials"
            ? message("setupCredentials")
            : error instanceof Error && error.message === "session_expired"
              ? message("setupSession")
              : error instanceof Error && error.message === "too_many"
                ? message("setupTooMany")
                : message("setupError");
    } finally {
      active = false;
      pendingGeneration = undefined;
      for (const field of fields) field.disabled = false;
      if (button) button.disabled = false;
    }
  },
  true,
);

globalThis.addEventListener("pagehide", () => {
  generation++;
  pendingGeneration?.abort();
  clearSecrets();
});
document.addEventListener("htmx:beforeCleanupElement", (event) => {
  const element = (event as CustomEvent).detail?.elt;
  if (
    element instanceof Element &&
    (element.id === "setup-form" || element.querySelector("#setup-form"))
  ) {
    generation++;
    pendingGeneration?.abort();
    clearSecrets();
  }
});
