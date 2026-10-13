import { clientMessages, type Locale, type MessageKey, translate } from "../../locales/index.ts";
import { icon, type IconName } from "../../icons.ts";
import { APP_VERSION, REPOSITORY_URL } from "../../version.ts";

export function escape(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}
export type View = {
  locale: Locale;
  csrf: string;
  surface: "admin" | "owner";
  actor: string;
  path: string;
  // Confirmation carried by ?done= after a redirect.
  flash?: MessageKey;
};
export const t = (view: View, key: MessageKey) => escape(translate(view.locale, key));
export function field(
  view: View,
  key: MessageKey,
  name: string,
  options: {
    type?: string;
    required?: boolean;
    value?: string;
    minLength?: number;
    min?: number;
    max?: number;
    generate?: boolean;
    confirm?: boolean;
    // Optional explanation shown in a tooltip beside the label.
    hint?: Hint;
  } = {},
) {
  const attributes = `name="${escape(name)}" type="${options.type ?? "text"}" ${
    options.required === false ? "" : "required"
  } ${options.minLength ? `minlength="${options.minLength}"` : ""}${
    options.min === undefined ? "" : ` min="${options.min}"`
  }${options.max === undefined ? "" : ` max="${options.max}"`} value="${escape(options.value)}"`;
  const id = `field-${escape(name)}`;
  if (options.type !== "password") {
    // A tooltip button inside a <label> would become its control, so a hint needs for/id.
    return options.hint
      ? `<div class="field"><div class="field-heading"><label for="${id}">${t(view, key)}</label>${help(
          view,
          id,
          options.hint,
        )}</div><input id="${id}" ${attributes}></div>`
      : `<label class="field"><span>${t(view, key)}</span><input ${attributes}></label>`;
  }
  const action = (data: string, label: MessageKey, symbol: IconName) =>
    `<button type="button" class="icon-button" ${data} aria-label="${t(view, label)}" title="${t(view, label)}">${icon(symbol)}</button>`;
  return `<div class="field"><div class="field-heading"><label for="${id}">${t(view, key)}</label>${
    options.hint ? help(view, id, options.hint) : ""
  }</div><div class="secret-control"><input id="${id}" ${attributes} autocomplete="${
    options.generate || options.confirm ? "new-password" : "current-password"
  }"><div class="input-actions">${
    options.generate
      ? action(`data-generate-name="${escape(name)}"`, "generateSecret", "dice-five") +
        action(`data-copy-name="${escape(name)}"`, "copy", "copy")
      : ""
  }${action(`data-toggle-password="${id}" aria-pressed="false"`, "showPassword", "eye")}</div></div></div>`;
}
export function form(
  view: View,
  action: string,
  content: string,
  button: MessageKey,
  variant = "primary",
  // Asked by htmx before submitting.
  confirm?: MessageKey,
) {
  return `<form class="form" method="post" action="${escape(action)}" hx-post="${escape(
    action,
  )}"${confirm ? ` hx-confirm="${t(view, confirm)}"` : ""} hx-target="#main" hx-select="#main" hx-swap="outerHTML" hx-disabled-elt="find button"><input type="hidden" name="csrf" value="${escape(
    view.csrf,
  )}">${content}<button class="button ${variant}" type="submit">${t(view, button)}</button></form>`;
}
const noticeIcons: Record<string, IconName> = {
  info: "info",
  warning: "warning",
  danger: "warning-octagon",
};
export function notice(view: View, key: MessageKey, tone = "info") {
  return `<p class="notice ${tone}" role="status">${icon(noticeIcons[tone] ?? "info")}<span>${t(
    view,
    key,
  )}</span></p>`;
}
// Secondary explanations live behind an info button so pages stay scannable.
export type Hint = MessageKey | MessageKey[];
export function help(view: View, id: string, key: Hint): string {
  const text = (Array.isArray(key) ? key : [key])
    .map((part) => `<span class="tip-line">${t(view, part)}</span>`)
    .join("");
  return `<span class="help-tip"><button type="button" class="icon-button" aria-label="${t(view, "fieldHelp")}" aria-describedby="${id}-help">${icon("info")}</button><span id="${id}-help" role="tooltip">${text}</span></span>`;
}
let hints = 0;
export function hint(view: View, key: Hint): string {
  return help(view, `hint-${++hints}`, key);
}
// A panel title with an optional icon, tooltip and trailing actions.
export function heading(
  view: View,
  title: string,
  options: { icon?: IconName; hint?: Hint; actions?: string; level?: 2 | 3; id?: string } = {},
): string {
  const level = options.level ?? 2;
  return `<div class="panel-title"><div class="panel-title-text"><h${level}${
    options.id ? ` id="${options.id}"` : ""
  }>${
    options.icon ? icon(options.icon) : ""
  }${title}</h${level}>${options.hint ? hint(view, options.hint) : ""}</div>${
    options.actions ? `<div class="panel-title-actions">${options.actions}</div>` : ""
  }</div>`;
}
export interface PageOptions {
  // Where the header's back button leads; "history" returns to the previous page.
  back?: string;
  intro?: Hint;
  // Page-level buttons aligned with the title.
  actions?: string;
}
export function page(
  view: View,
  title: MessageKey,
  body: string,
  options: PageOptions = {},
): string {
  const links: [string, MessageKey, IconName][] =
    view.surface === "owner" && !view.actor
      ? []
      : view.surface === "admin"
        ? [
            ["/", "overview", "house"],
            ["/people", "people", "users"],
            ["/inventory", "inventory", "database"],
            ["/backups", "backups", "cloud-arrow-up"],
            ["/events", "events", "clock-counter-clockwise"],
          ]
        : [
            ["/", "owner", "vault"],
            ["/password", "changePassword", "lock-key"],
            ["/backups", "personalBackups", "cloud-arrow-up"],
          ];
  const preferences = `<div class="preferences"><label class="preference" title="${t(
    view,
    "language",
  )}">${icon("translate")}<select id="locale-select" aria-label="${t(
    view,
    "language",
  )}"><option value="en"${view.locale === "en" ? " selected" : ""}>English</option><option value="es"${
    view.locale === "es" ? " selected" : ""
  }>Español</option></select></label><label class="preference" title="${t(view, "theme")}">${icon(
    "circle-half",
  )}<select id="theme-select" aria-label="${t(view, "theme")}"><option value="system">${t(
    view,
    "system",
  )}</option><option value="light">${t(view, "light")}</option><option value="dark">${t(
    view,
    "dark",
  )}</option></select></label></div>`;
  const logout =
    view.surface === "owner" && view.actor
      ? `<form class="logout" method="post" action="/logout" hx-post="/logout" hx-target="#main" hx-select="#main" hx-swap="outerHTML" hx-disabled-elt="find button"><input type="hidden" name="csrf" value="${escape(
          view.csrf,
        )}"><button class="icon-button" type="submit" aria-label="${t(
          view,
          "logoutOwner",
        )}" title="${t(view, "logoutOwner")}">${icon("sign-out")}</button></form>`
      : "";
  const account = view.actor
    ? `<div class="account"><span class="avatar" aria-hidden="true">${escape(
        view.actor.charAt(0).toUpperCase(),
      )}</span><span class="identity" title="${escape(view.actor)}">${escape(
        view.actor,
      )}</span>${logout}</div>`
    : "";
  const meta = `<p class="app-meta">${
    APP_VERSION ? `<span>${t(view, "version")} ${escape(APP_VERSION)}</span>` : ""
  }<a href="${REPOSITORY_URL}" target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub">${icon(
    "github-logo",
  )}</a></p>`;
  const back = options.back
    ? options.back === "history"
      ? `<button type="button" class="back-button" data-history-back aria-label="${t(
          view,
          "back",
        )}" title="${t(view, "back")}">${icon("arrow-left")}</button>`
      : `<a class="back-button" href="${escape(options.back)}" aria-label="${t(
          view,
          "back",
        )}" title="${t(view, "back")}">${icon("arrow-left")}</a>`
    : "";
  return `<!DOCTYPE html><html lang="${view.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="htmx-config" content='{"allowEval":false,"allowScriptTags":false,"historyCacheSize":0,"includeIndicatorStyles":false,"selfRequestsOnly":true,"responseHandling":[{"code":"204","swap":false},{"code":"[23]..","swap":true},{"code":"[45]..","swap":true,"error":true}]}'><title>${t(
    view,
    title,
  )} · LiveSync</title><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/app.css"><script src="/assets/ui.js" type="module"></script><script src="/assets/htmx.js" defer></script>${
    view.surface === "owner" ? '<script src="/assets/setup.js" type="module"></script>' : ""
  }</head><body><a class="skip-link" href="#main">${t(
    view,
    title,
  )}</a>${links.length ? "" : authShell(view, title, body, preferences + meta)}${
    links.length
      ? `<div class="app-shell"><aside class="sidebar"><a class="brand" href="/"><span class="brand-symbol" aria-hidden="true">${icon(
          "notebook",
        )}</span><span>LiveSync<small>${t(
          view,
          view.surface === "admin" ? "admin" : "owner",
        )}</small></span></a>${
          links.length
            ? `<nav aria-label="${t(view, view.surface === "admin" ? "admin" : "owner")}">${links
                .map(
                  ([href, key, symbol]) =>
                    `<a href="${href}" ${
                      view.path === href || (href !== "/" && view.path.startsWith(href + "/"))
                        ? 'aria-current="page"'
                        : ""
                    }>${icon(symbol)}<span>${t(view, key)}</span></a>`,
                )
                .join("")}</nav>`
            : ""
        }<div class="sidebar-footer">${account}${preferences}${meta}</div></aside><main id="main" tabindex="-1">${flash(view)}<header class="page-header">${back}<h1>${t(
          view,
          title,
        )}</h1>${options.intro ? hint(view, options.intro) : ""}${
          options.actions ? `<div class="page-actions">${options.actions}</div>` : ""
        }</header>${body}</main></div>`
      : ""
  }${confirmDialog(view)}${clientText(view)}</body></html>`;
}
// Sign-in, activation and refusal pages have no navigation: a centred card instead of the shell.
function authShell(view: View, title: MessageKey, body: string, footer: string): string {
  return `<div class="auth-shell"><main id="main" tabindex="-1" class="auth-card"><a class="brand" href="/"><span class="brand-symbol" aria-hidden="true">${icon(
    "notebook",
  )}</span><span>LiveSync<small>${t(view, view.surface === "admin" ? "admin" : "owner")}</small></span></a><h1>${t(
    view,
    title,
  )}</h1>${body}</main><footer class="auth-footer">${footer}</footer></div>`;
}
function flash(view: View): string {
  return view.flash
    ? `<p class="toast" role="status">${icon("check-circle")}${t(view, view.flash)}</p>`
    : "";
}
function confirmDialog(view: View): string {
  return `<dialog id="confirm-dialog" class="dialog" aria-labelledby="confirm-dialog-title"><form method="dialog"><h2 id="confirm-dialog-title">${t(
    view,
    "confirmTitle",
  )}</h2><p data-dialog-message></p><div class="actions"><button class="button" value="cancel">${t(
    view,
    "cancel",
  )}</button><button class="button primary" value="confirm">${t(view, "confirmAction")}</button></div></form></dialog>`;
}
function clientText(view: View): string {
  const text = Object.fromEntries(clientMessages.map((key) => [key, translate(view.locale, key)]));
  // Inert JSON for the browser scripts. Escaping "<" keeps a message from closing the element.
  return `<script type="application/json" id="client-text">${JSON.stringify(text).replace(
    /</g,
    "\\u003c",
  )}</script>`;
}
// Columns listed in `numeric` align right so figures line up by magnitude.
export function table(
  view: View,
  headings: MessageKey[],
  rows: string[][],
  numeric: number[] = [],
) {
  if (rows.length === 0) return `<p class="empty">${t(view, "empty")}</p>`;
  const cell = (tag: "th" | "td", index: number, content: string) =>
    `<${tag}${tag === "th" ? ' scope="col"' : ""}${numeric.includes(index) ? ' class="numeric"' : ""}>${content}</${tag}>`;
  return `<div class="table-scroll"><table><thead><tr>${headings
    .map((key, index) => cell("th", index, t(view, key)))
    .join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((content, index) => cell("td", index, content)).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}
export function date(view: View, value: string | null | undefined) {
  const parsed = value ? new Date(value) : null;
  return !parsed || Number.isNaN(parsed.valueOf())
    ? "—"
    : escape(
        new Intl.DateTimeFormat(view.locale, { dateStyle: "medium", timeStyle: "short" }).format(
          parsed,
        ),
      );
}
export function badge(view: View, state: string) {
  return `<span class="badge" data-state="${escape(state)}">${escape(
    translate(view.locale, state as MessageKey) ?? state,
  )}</span>`;
}
