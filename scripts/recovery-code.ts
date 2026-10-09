import { readFile } from "node:fs/promises";
import { SALT_OF_PASSPHRASE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { decryptString } from "@vrtmrz/livesync-commonlib/compat/encryption/stringEncryption";

// LiveSync keeps a vault's ID key encrypted in data.json and blanks `idDerivationKey` on save.
// The key is encrypted with the "passphrase of sensitive configuration items", which defaults to
// "*" when `configPassphraseStore` is empty.
export async function recoveryCode(
  settings: Record<string, unknown>,
  configPassphrase?: string,
): Promise<string> {
  if (settings.idDerivationVersion !== 1) throw new Error("vault_has_no_keyed_ids");
  const plain = settings.idDerivationKey;
  if (typeof plain === "string" && /^[0-9a-f]{64}$/.test(plain)) return `sls-id-v1:${plain}`;
  const encrypted = settings.encryptedIdDerivationKey;
  if (typeof encrypted !== "string" || encrypted === "") throw new Error("missing_encrypted_key");
  const store = settings.configPassphraseStore ?? "";
  if (!configPassphrase && store !== "") throw new Error("config_passphrase_required");
  let key: string | false;
  try {
    key = await decryptString(encrypted, (configPassphrase || "*") + SALT_OF_PASSPHRASE);
  } catch {
    key = false;
  }
  if (!key || !/^[0-9a-f]{64}$/.test(key)) throw new Error("decryption_failed");
  return `sls-id-v1:${key}`;
}

const messages: Record<string, string> = {
  vault_has_no_keyed_ids:
    "This vault does not use keyed document IDs (idDerivationVersion is not 1), so it has no recovery code.",
  missing_encrypted_key: "data.json has no encryptedIdDerivationKey.",
  config_passphrase_required:
    "Sensitive configuration items use a custom passphrase. Pass it as the second argument.",
  decryption_failed: "Could not decrypt the ID key. Check the configuration passphrase.",
};

if (import.meta.main) {
  const [file, passphrase] = process.argv.slice(2);
  if (!file) {
    console.error(
      "Usage: pnpm run recovery-code <vault>/.obsidian/plugins/obsidian-livesync/data.json [passphrase]",
    );
    process.exit(2);
  }
  try {
    const settings = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    console.log(await recoveryCode(settings, passphrase));
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    console.error(messages[code] ?? `Could not read ${file}.`);
    process.exit(1);
  }
}
