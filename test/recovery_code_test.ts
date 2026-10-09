import { test } from "node:test";
import { SALT_OF_PASSPHRASE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { encryptString } from "@vrtmrz/livesync-commonlib/compat/encryption/stringEncryption";
import { assertEquals, assertRejects } from "./assert.ts";
import { recoveryCode } from "../scripts/recovery-code.ts";

const key = "0123456789abcdef".repeat(4);

test("recovery code is decrypted from LiveSync settings with the default configuration passphrase", async () => {
  const settings = {
    idDerivationVersion: 1,
    idDerivationKey: "",
    configPassphraseStore: "",
    encryptedIdDerivationKey: await encryptString(key, "*" + SALT_OF_PASSPHRASE),
  };
  assertEquals(await recoveryCode(settings), `sls-id-v1:${key}`);
});

test("recovery code requires the custom passphrase and rejects vaults without keyed IDs", async () => {
  const settings = {
    idDerivationVersion: 1,
    idDerivationKey: "",
    configPassphraseStore: "LOCALSTORAGE",
    encryptedIdDerivationKey: await encryptString(key, "custom" + SALT_OF_PASSPHRASE),
  };
  await assertRejects(() => recoveryCode(settings), Error, "config_passphrase_required");
  await assertRejects(() => recoveryCode(settings, "wrong"), Error, "decryption_failed");
  assertEquals(await recoveryCode(settings, "custom"), `sls-id-v1:${key}`);
  await assertRejects(
    () => recoveryCode({ idDerivationVersion: 0, idDerivationKey: "" }),
    Error,
    "vault_has_no_keyed_ids",
  );
});
