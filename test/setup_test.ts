import { test } from "node:test";
import { assertEquals, assertRejects } from "./assert.ts";
import { decodeSettingsFromSetupURI } from "@vrtmrz/livesync-commonlib/setup-uri";
import { generateSetup } from "../src/setup/generate.ts";
import type { SetupMetadata } from "../src/contracts.ts";

const metadata: SetupMetadata = {
  vaultId: "vault:test",
  label: "Notes",
  hostname: "https://notes.example.ts.net",
  database: "obsidian-test-notes",
  username: "test-person",
  idRecoveryCode: `sls-id-v1:${"a1".repeat(32)}`,
  instruction: "new",
};

test("official decoder opens both modes without changing credentials or identity", async () => {
  for (const mode of ["ephemeral", "persistent"] as const) {
    const secret = { password: " password with spaces ", e2ePassphrase: " clave española 🔒 " };
    const first = await generateSetup(metadata, { ...secret, mode });
    const second = await generateSetup(
      { ...metadata, instruction: "additional" },
      {
        ...secret,
        mode,
      },
    );
    for (const generated of [first, second]) {
      const decoded = await decodeSettingsFromSetupURI(generated.uri, generated.passphrase);
      if (!decoded) throw new Error("Official decoder rejected generated URI");
      assertEquals(decoded.couchDB_PASSWORD, secret.password);
      assertEquals(decoded.passphrase, secret.e2ePassphrase);
      assertEquals(decoded.couchDB_DBNAME, metadata.database);
      assertEquals(decoded.couchDB_USER, metadata.username);
      assertEquals(decoded.idDerivationVersion, 1);
      assertEquals(decoded.idDerivationKey, "a1".repeat(32));
      assertEquals(decoded.encrypt, true);
      assertEquals(decoded.usePathObfuscation, true);
      assertEquals(mode === "persistent", generated.usableUntil === null);
    }
    assertEquals(first.passphrase === second.passphrase, false);
  }
});

test("invalid metadata and blank E2E are refused before generating", async () => {
  await assertRejects(() =>
    generateSetup(
      { ...metadata, hostname: "http://notes.example" },
      {
        password: "password",
        e2ePassphrase: "secret",
      },
    ),
  );
  await assertRejects(() => generateSetup(metadata, { password: "password", e2ePassphrase: "" }));
});
