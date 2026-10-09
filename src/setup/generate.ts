import {
  encodeTimeBoundSetupURI,
  isTimeBoundSetupURIUsableNow,
} from "@vrtmrz/livesync-commonlib/setup-uri";
import { upsertRemoteConfigurationInPlace } from "@vrtmrz/livesync-commonlib/remote-configurations";
import type { SetupMetadata } from "../contracts.ts";
import { vaultSettings } from "./settings.ts";

export interface SetupSecrets {
  password: string;
  e2ePassphrase: string;
  uriPassphrase?: string;
  mode?: "ephemeral" | "persistent";
}

export interface GeneratedSetup {
  uri: string;
  passphrase: string;
  usableUntil: number | null;
  idRecoveryCode: string;
}

function secret(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    throw new Error("invalid_secret");
  }
  return value;
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function generateSetup(
  metadata: SetupMetadata,
  secrets: SetupSecrets,
): Promise<GeneratedSetup> {
  const url = new URL(metadata.hostname);
  const match = /^sls-id-v1:([0-9a-f]{64})$/.exec(metadata.idRecoveryCode);
  if (url.protocol !== "https:" || url.username || url.password || !match) {
    throw new Error("invalid_setup_metadata");
  }
  const settings = vaultSettings();
  Object.assign(settings, {
    couchDB_URI: metadata.hostname,
    couchDB_DBNAME: metadata.database,
    couchDB_USER: metadata.username,
    couchDB_PASSWORD: secret(secrets.password),
    passphrase: secret(secrets.e2ePassphrase),
    idDerivationKey: match[1],
  });
  upsertRemoteConfigurationInPlace(settings, "couchdb", { activate: true });
  const passphrase =
    secrets.uriPassphrase === undefined || secrets.uriPassphrase === ""
      ? randomSecret()
      : secret(secrets.uriPassphrase);
  const mode = secrets.mode ?? "ephemeral";
  if (mode !== "ephemeral" && mode !== "persistent") throw new Error("invalid_uri_mode");
  const result = await encodeTimeBoundSetupURI(settings, passphrase, {
    mode,
    removeProperties: ["pluginSyncExtendedSetting", "doNotUseFixedRevisionForChunks"],
    skipDefaultValue: true,
  });
  if (!isTimeBoundSetupURIUsableNow(result.usableUntil)) throw new Error("uri_window_changed");
  return {
    uri: result.uri.trim(),
    passphrase,
    usableUntil: result.usableUntil,
    idRecoveryCode: metadata.idRecoveryCode,
  };
}
