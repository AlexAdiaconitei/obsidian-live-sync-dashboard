import type { DriveConfig } from "./backup/drive.ts";

export interface AppConfig {
  couchdbUrl: string;
  couchdbUsername: string;
  couchdbPassword: string;
  publicCouchdbUrl: string;
  adminOrigin: string;
  ownerOrigin: string;
  admins: string[];
  panelDb: string;
  csrfSecret: string;
  backupStateDir?: string;
  backupRequestsDir?: string;
  backupMaxAgeHours: number;
  instanceQuotaBytes?: number | null;
  defaultUserQuotaBytes?: number | null;
  recoverPendingQuota?: boolean;
  personalDrive?: DriveConfig;
}

export const CONFIG_KEYS = [
  "COUCHDB_URL",
  "COUCHDB_USER",
  "COUCHDB_PASSWORD",
  "COUCHDB_ADMIN_USER",
  "COUCHDB_ADMIN_PASSWORD",
  "PUBLIC_COUCHDB_URL",
  "PUBLIC_ADMIN_URL",
  "PUBLIC_SETUP_URL",
  "PANEL_ADMINS",
  "PANEL_DB",
  "PANEL_CSRF_SECRET",
  "BACKUP_STATE_DIR",
  "BACKUP_REQUESTS_DIR",
  "BACKUP_MAX_AGE_HOURS",
  "INSTANCE_QUOTA_GIB",
  "DEFAULT_USER_QUOTA_GIB",
  "QUOTA_RECOVER_PENDING",
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_TOKEN_KEY",
  "GOOGLE_DRIVE_PICKER_API_KEY",
  "GOOGLE_DRIVE_PROJECT_NUMBER",
  "PERSONAL_BACKUP_WORK_DIR",
] as const;

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const required = (key: string, secret = false) => {
    const value = secret ? env[key] : env[key]?.trim();
    if (!value) throw new Error(`Missing configuration: ${key}`);
    return value;
  };
  const url = (key: string, local = false) => {
    const value = new URL(required(key));
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(value.hostname);
    if (
      value.username ||
      value.password ||
      value.search ||
      value.hash ||
      (value.protocol !== "https:" && !(local && loopback && value.protocol === "http:")) ||
      value.pathname !== "/"
    )
      throw new Error(`Invalid URL configuration: ${key}`);
    return value.origin;
  };
  const csrfSecret = required("PANEL_CSRF_SECRET");
  if (csrfSecret.length < 32) {
    throw new Error("PANEL_CSRF_SECRET must contain at least 32 characters");
  }
  const admins = required("PANEL_ADMINS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (admins.length === 0) throw new Error("PANEL_ADMINS must not be empty");
  const panelDb = env.PANEL_DB ?? "livesync_dashboard";
  if (!/^[a-z][a-z0-9_$()+/-]*$/.test(panelDb) || panelDb.startsWith("_")) {
    throw new Error("Invalid PANEL_DB");
  }
  const adminOrigin = url("PUBLIC_ADMIN_URL");
  const ownerOrigin = url("PUBLIC_SETUP_URL");
  if (adminOrigin === ownerOrigin) throw new Error("Admin and owner origins must be different");
  const backupMaxAgeHours = Number(env.BACKUP_MAX_AGE_HOURS ?? 26);
  if (!Number.isFinite(backupMaxAgeHours) || backupMaxAgeHours < 1 || backupMaxAgeHours > 8760) {
    throw new Error("Invalid BACKUP_MAX_AGE_HOURS");
  }
  const instanceQuotaBytes = configuredQuota(env.INSTANCE_QUOTA_GIB);
  const defaultUserQuotaBytes = configuredQuota(env.DEFAULT_USER_QUOTA_GIB);
  if (
    instanceQuotaBytes !== null &&
    defaultUserQuotaBytes !== null &&
    defaultUserQuotaBytes > instanceQuotaBytes
  ) {
    throw new Error("Default user quota exceeds instance quota");
  }
  if (env.QUOTA_RECOVER_PENDING !== undefined && !["0", "1"].includes(env.QUOTA_RECOVER_PENDING)) {
    throw new Error("Invalid QUOTA_RECOVER_PENDING");
  }
  const driveKeys = [
    "GOOGLE_DRIVE_CLIENT_ID",
    "GOOGLE_DRIVE_CLIENT_SECRET",
    "GOOGLE_DRIVE_TOKEN_KEY",
  ];
  const hasPicker = !!env.GOOGLE_DRIVE_PICKER_API_KEY || !!env.GOOGLE_DRIVE_PROJECT_NUMBER;
  const hasDrive = hasPicker || driveKeys.some((key) => !!env[key]);
  const picker = hasPicker
    ? {
        apiKey: required("GOOGLE_DRIVE_PICKER_API_KEY"),
        appId: required("GOOGLE_DRIVE_PROJECT_NUMBER"),
      }
    : undefined;
  if (picker && !/^\d{1,30}$/.test(picker.appId))
    throw new Error("Invalid GOOGLE_DRIVE_PROJECT_NUMBER");
  const tokenKey = hasDrive ? required("GOOGLE_DRIVE_TOKEN_KEY") : "";
  if (
    hasDrive &&
    (!/^[A-Za-z0-9+/]{43}=$/.test(tokenKey) || Buffer.from(tokenKey, "base64").length !== 32)
  ) {
    throw new Error("GOOGLE_DRIVE_TOKEN_KEY must be 32 random bytes encoded as base64");
  }
  return {
    couchdbUrl: url("COUCHDB_URL", true),
    couchdbUsername: env.COUCHDB_ADMIN_USER?.trim() || required("COUCHDB_USER"),
    couchdbPassword: env.COUCHDB_ADMIN_PASSWORD || required("COUCHDB_PASSWORD", true),
    publicCouchdbUrl: url("PUBLIC_COUCHDB_URL"),
    adminOrigin,
    ownerOrigin,
    admins,
    panelDb,
    csrfSecret,
    backupStateDir: env.BACKUP_STATE_DIR,
    backupRequestsDir: env.BACKUP_REQUESTS_DIR,
    backupMaxAgeHours,
    instanceQuotaBytes,
    defaultUserQuotaBytes,
    recoverPendingQuota: env.QUOTA_RECOVER_PENDING === "1",
    personalDrive: hasDrive
      ? {
          clientId: required("GOOGLE_DRIVE_CLIENT_ID"),
          clientSecret: required("GOOGLE_DRIVE_CLIENT_SECRET", true),
          tokenKey,
          redirectUri: `${ownerOrigin}/backups/google/callback`,
          workDir: env.PERSONAL_BACKUP_WORK_DIR || "/tmp",
          picker,
        }
      : undefined,
  };
}

export function configuredQuota(value = "0"): number | null {
  if (!/^\d+(?:\.\d{1,3})?$/.test(value)) throw new Error("Invalid storage quota");
  const bytes = Math.round(Number(value) * 1024 ** 3);
  if (!Number.isSafeInteger(bytes)) throw new Error("Invalid storage quota");
  return bytes === 0 ? null : bytes;
}
