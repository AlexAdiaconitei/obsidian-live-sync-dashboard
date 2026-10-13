import { type InstanceQuota, type QuotaUsage, ServiceError } from "../../contracts.ts";
import type { MessageKey } from "../../locales/index.ts";
import { escape, heading, help, notice, t, type View } from "./html.ts";

const gib = 1024 ** 3;

export async function quotaForView<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ServiceError && error.code === "quota_reconciliation_required")
      return undefined;
    throw error;
  }
}

export function quotaUnavailable(view: View): string {
  return `<section class="panel quota-panel">${notice(view, "quotaReconciliation", "danger")}<p>${t(view, "quotaUsed")}: ${t(view, "quotaUnavailable")}</p></section>`;
}

export function quotaBytes(view: View, bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4) : 0;
  return `${new Intl.NumberFormat(view.locale, {
    maximumFractionDigits: 2,
  }).format(bytes / 1024 ** index)} ${units[index]}`;
}

export function quotaLimit(view: View, bytes: number | null): string {
  return bytes === null ? t(view, "quotaUnlimited") : quotaBytes(view, bytes);
}

export function quotaPanel(view: View, quota: QuotaUsage, instance = false, footer = ""): string {
  const percentage =
    quota.limitBytes === null
      ? null
      : Math.max(
          0,
          Math.min(100, quota.limitBytes === 0 ? 100 : (quota.usedBytes / quota.limitBytes) * 100),
        );
  const extra = instance
    ? `<p class="muted">${t(
        view,
        "quotaDefaultUser",
      )}: ${quotaLimit(view, (quota as InstanceQuota).defaultUserLimitBytes)}</p>${
        (quota as InstanceQuota).unassignedBytes
          ? `<p class="muted">${t(view, "quotaUnassigned")}: ${quotaBytes(
              view,
              (quota as InstanceQuota).unassignedBytes!,
            )}</p>`
          : ""
      }`
    : "";
  const hints: MessageKey[] = instance
    ? ["quotaMeasurementHelp", "quotaStartupHelp"]
    : view.surface === "owner"
      ? ["quotaMeasurementHelp", "quotaInstanceCapacityHelp"]
      : ["quotaMeasurementHelp"];
  return `<section class="panel quota-panel">${heading(
    view,
    t(view, instance ? "quotaInstance" : view.surface === "admin" ? "quotaUser" : "quotaPersonal"),
    { icon: "hard-drives", hint: hints },
  )}<dl class="quota-metrics"><div><dt>${t(view, "quotaUsed")}</dt><dd>${quotaBytes(
    view,
    quota.usedBytes,
  )}</dd></div><div><dt>${t(view, "quotaLimit")}</dt><dd>${quotaLimit(
    view,
    quota.limitBytes,
  )}</dd></div><div><dt>${t(view, "quotaRemaining")}</dt><dd>${quotaLimit(
    view,
    quota.remainingBytes,
  )}</dd></div></dl>${
    percentage === null
      ? ""
      : `<progress class="quota-progress" max="100" value="${percentage}" aria-label="${t(
          view,
          "quotaUsed",
        )}">${Math.round(percentage)}%</progress>`
  }${
    quota.exceeded || quota.remainingBytes === 0 ? notice(view, "quotaExceeded", "danger") : ""
  }${extra}${footer}</section>`;
}

export function quotaField(view: View, bytes: number | null): string {
  const value = bytes === null ? "0" : (bytes / gib).toFixed(20).replace(/\.?0+$/, "");
  return `<div class="field"><div class="field-heading"><label for="quota">${t(
    view,
    "quotaInput",
  )}</label>${help(view, "quota", "quotaInputHelp")}</div><div class="unit-control"><input id="quota" name="quotaGiB" type="number" min="0" step="any" value="${escape(
    value,
  )}" aria-describedby="quota-help"><span aria-hidden="true">GiB</span></div></div>`;
}

export function parseQuota(fields: Record<string, string>): number | null {
  const value = fields.quotaGiB?.trim() ?? "";
  if (!value) return null;
  if (!/^\d+(?:\.\d{1,20})?$/.test(value)) throw new ServiceError("invalid_quota", 400);
  const amount = Number(value);
  if (amount === 0) return null;
  const bytes = Math.round(amount * gib);
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new ServiceError("invalid_quota", 400);
  return bytes;
}
