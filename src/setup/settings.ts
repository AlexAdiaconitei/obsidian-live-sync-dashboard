import {
  createNewVaultSettings,
  PREFERRED_SETTING_SELF_HOSTED,
} from "@vrtmrz/livesync-commonlib/settings";
import { TweakValuesTemplate } from "@vrtmrz/livesync-commonlib/compat/common/models/tweak.definition";
import { E2EEAlgorithms, REMOTE_COUCHDB } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { extractObject } from "@vrtmrz/livesync-commonlib/compat/common/utils";

export type LiveSyncSettings = ReturnType<typeof createNewVaultSettings>;

// The settings every generated Setup URI carries, without connection details or secrets.
export function vaultSettings(): LiveSyncSettings {
  const settings = createNewVaultSettings();
  Object.assign(settings, PREFERRED_SETTING_SELF_HOSTED, {
    encrypt: true,
    usePathObfuscation: true,
    isConfigured: true,
    batchSave: true,
    periodicReplication: true,
    syncOnStart: true,
    syncOnFileOpen: true,
    syncAfterMerge: true,
    idDerivationVersion: 1,
  });
  return settings;
}

// What LiveSync stores as the remote's preferred tweak values. A device that finds none
// asks whether to push its own settings, which leads to a remote rebuild the sync account
// cannot perform. Mirrors getEffectiveTweakValues in livesync-commonlib.
export function preferredTweakValues(): Record<string, unknown> {
  const settings = vaultSettings();
  return {
    ...extractObject(TweakValuesTemplate, settings),
    encryptInternalMetadata:
      settings.remoteType === REMOTE_COUCHDB &&
      settings.encryptInternalMetadata === true &&
      settings.encrypt === true &&
      settings.usePathObfuscation === true &&
      settings.E2EEAlgorithm === E2EEAlgorithms.V2,
  };
}
