import { confirmDialog } from "./dialog.ts";
import { randomSecret, downloadText, downloadBlob } from "./secrets.ts";
import { message } from "./text.ts";

function theme(value: string) {
  document.documentElement.dataset.theme = ["light", "dark"].includes(value) ? value : "system";
}
function init() {
  const invitation = document.querySelector<HTMLInputElement>(
    'form[action="/activate"] input[name="invitation"]',
  );
  if (invitation && location.hash) {
    invitation.value = location.hash.slice(1);
    history.replaceState(null, "", location.pathname);
  }
  let selected = "system";
  try {
    selected = localStorage.getItem("theme") ?? "system";
  } catch {
    /* Preferences remain usable without browser storage. */
  }
  theme(selected);
  const themeSelect = document.querySelector<HTMLSelectElement>("#theme-select");
  if (themeSelect && !themeSelect.dataset.ready) {
    themeSelect.dataset.ready = "true";
    themeSelect.value = selected;
    themeSelect.addEventListener("change", () => {
      theme(themeSelect.value);
      try {
        localStorage.setItem("theme", themeSelect.value);
      } catch {
        /* Keep the selected theme for this page. */
      }
    });
  }
  const localeSelect = document.querySelector<HTMLSelectElement>("#locale-select");
  if (localeSelect && !localeSelect.dataset.ready) {
    localeSelect.dataset.ready = "true";
    localeSelect.addEventListener("change", () => {
      const locale = localeSelect.value === "es" ? "es" : "en";
      document.cookie = `panel_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
      location.reload();
    });
  }
}
const copying = new WeakMap<HTMLButtonElement, Node[]>();
function copied(button: HTMLButtonElement) {
  if (button.classList.contains("icon-button")) {
    button.dataset.copied = "true";
    setTimeout(() => delete button.dataset.copied, 2000);
    return;
  }
  // Keeps the original icon and label to restore after the confirmation.
  const original = copying.get(button) ?? [...button.childNodes];
  copying.set(button, original);
  button.textContent = message("copied");
  setTimeout(() => {
    button.replaceChildren(...original);
    copying.delete(button);
  }, 2000);
}
document.addEventListener("DOMContentLoaded", init);
document.addEventListener("htmx:afterSwap", init);
document.addEventListener("htmx:afterSwap", () => (document.body.dataset.swapped = "true"));

// hx-confirm asks through the page's dialog instead of window.confirm.
document.addEventListener("htmx:confirm", (event) => {
  const detail = (
    event as CustomEvent<{ question?: string; elt: Element; issueRequest(skip: boolean): void }>
  ).detail;
  if (!detail.question) return;
  event.preventDefault();
  const danger = !!detail.elt.querySelector("button[type=submit].danger");
  void confirmDialog(detail.question, { danger }).then((accepted) => {
    if (accepted) detail.issueRequest(true);
  });
});

document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    event.target instanceof HTMLElement &&
    event.target.closest(".help-tip")
  )
    event.target.blur();
});
document.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest("button[data-history-back]")) {
    // An htmx error replaces the form in place, so the form's page is the current URL.
    if (document.body.dataset.swapped) location.reload();
    else history.back();
    return;
  }
  const archiveLink = event.target.closest<HTMLAnchorElement>("a[data-download-vault]");
  if (archiveLink) {
    event.preventDefault();
    if (archiveLink.getAttribute("aria-disabled") === "true") return;
    const status = document.getElementById("vault-archive-status");
    archiveLink.setAttribute("aria-disabled", "true");
    if (status) status.textContent = message("vaultArchiveDownloading");
    try {
      const response = await fetch(archiveLink.href, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/zip" },
      });
      if (!response.ok || response.headers.get("content-type") !== "application/zip")
        throw new Error("archive_unavailable");
      const blob = await response.blob();
      const end = new DataView(await blob.slice(-22).arrayBuffer());
      if (end.byteLength !== 22 || end.getUint32(0, true) !== 0x06054b50)
        throw new Error("archive_incomplete");
      downloadBlob(archiveLink.download, blob);
      if (status) status.textContent = message("vaultArchiveReady");
    } catch {
      if (status) status.textContent = message("vaultArchiveFailed");
    } finally {
      archiveLink.removeAttribute("aria-disabled");
    }
    return;
  }
  const toggle = event.target.closest<HTMLButtonElement>("button[data-toggle-password]");
  if (toggle) {
    const input = document.getElementById(toggle.dataset.togglePassword!);
    if (!(input instanceof HTMLInputElement) || input.disabled) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
    const label = message(show ? "hidePassword" : "showPassword");
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
    return;
  }
  const namedCopy = event.target.closest<HTMLButtonElement>("button[data-copy-name]");
  if (namedCopy) {
    const field = namedCopy.closest("form")?.elements.namedItem(namedCopy.dataset.copyName!);
    if (!(field instanceof HTMLInputElement) || !field.value) return;
    try {
      await navigator.clipboard.writeText(field.value);
      copied(namedCopy);
    } catch {
      field.focus();
      field.select();
    }
    return;
  }
  const accountExport = event.target.closest<HTMLButtonElement>("button[data-export-account]");
  if (accountExport) {
    const form = accountExport.closest("form");
    const username = form?.elements.namedItem("username");
    const password = form?.elements.namedItem("password");
    if (
      !(username instanceof HTMLInputElement) ||
      !(password instanceof HTMLInputElement) ||
      !password.value
    )
      return;
    downloadText(
      "livesync-account.txt",
      `${message("accountExportTitle")}\n\nURL: ${location.origin}\nUsername: ${username.value}\nSync password: ${password.value}\n`,
    );
    return;
  }
  const generator = event.target.closest<HTMLButtonElement>("button[data-generate-name]");
  if (generator) {
    const form = generator.closest("form");
    const field = form?.elements.namedItem(generator.dataset.generateName!);
    if (!(field instanceof HTMLInputElement)) return;
    field.value = randomSecret();
    const confirmation = form?.elements.namedItem("confirmPassword");
    if (confirmation instanceof HTMLInputElement) confirmation.value = field.value;
    return;
  }
  const button = event.target.closest<HTMLButtonElement>("button[data-copy-target]");
  if (!button) return;
  const target = document.getElementById(button.dataset.copyTarget!);
  if (
    !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) ||
    !target.value
  )
    return;
  try {
    await navigator.clipboard.writeText(target.value);
    copied(button);
  } catch {
    target.focus();
    target.select();
  }
});
