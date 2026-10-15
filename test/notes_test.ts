import { test } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "octagonal-wheels/encryption/hkdf";
import {
  ArchiveError,
  checkPassphrase,
  isEncrypted,
  readArchive,
  safePath,
  vaultFiles,
} from "../src/backup/notes.ts";

const passphrase = "correct horse battery staple";
const salt = crypto.getRandomValues(new Uint8Array(32));
const saltText = Buffer.from(salt).toString("base64");
const vault = { id: "vault-1", label: "Notes", db: "alice_notes" };

async function* lines(records: unknown[]) {
  for (const record of records) yield JSON.stringify(record);
}
const meta = async (props: object) =>
  "/\\:" + (await encrypt(JSON.stringify(props), passphrase, salt));
const chunk = async (id: string, data: string) => ({
  type: "document",
  vaultId: vault.id,
  doc: {
    _id: id,
    _rev: "1-x",
    type: "leaf",
    data: await encrypt(data, passphrase, salt),
    e_: true,
  },
});
const file = (id: string, rev: string, path: string, extra: object = {}) => ({
  type: "document",
  vaultId: vault.id,
  doc: { _id: id, _rev: rev, type: "plain", path, children: [], eden: {}, mtime: 0, ...extra },
});

async function encryptedArchive(withSalt = true) {
  const image = Buffer.from([0, 1, 2, 250, 255]).toString("base64");
  return readArchive(
    lines([
      { type: "manifest", format: "obsidian-personal-backup", schemaVersion: 1, vaults: [vault] },
      ...(withSalt
        ? [
            {
              type: "local",
              vaultId: vault.id,
              doc: { _id: "_local/obsidian_livesync_sync_parameters", pbkdf2salt: saltText },
            },
          ]
        : []),
      await chunk("h:+one", "Hello "),
      await chunk("h:+two", "world"),
      await chunk("h:+old", "stale"),
      file(
        "f:note",
        "2-b",
        await meta({
          path: "Folder/Note.md",
          mtime: Date.UTC(2026, 0, 2),
          children: ["h:+one", "h:+two"],
        }),
      ),
      file("f:note", "1-a", await meta({ path: "Folder/Note.md", children: ["h:+old"] })),
      file("f:image", "1-a", await meta({ path: "pic.png", children: ["h:+img"] }), {
        type: "newnote",
        eden: {
          "h:++encrypted-hkdf": {
            data: await encrypt(
              JSON.stringify({ "h:+img": { data: image, epoch: 1 } }),
              passphrase,
              salt,
            ),
            epoch: 999999,
          },
        },
      }),
      file("f:gone", "3-a", await meta({ path: "gone.md", children: ["h:+one"] }), {
        deleted: true,
      }),
      { type: "document", vaultId: vault.id, doc: { _id: "f:tomb", _rev: "2-z", _deleted: true } },
      file("i:f:config", "1-a", await meta({ path: ".obsidian/app.json", children: [] })),
    ]),
  );
}

test("rebuilds encrypted notes and attachments from their winning revisions", async () => {
  const archive = await encryptedArchive();
  const [content] = archive.vaults;
  assert.equal(isEncrypted(content), true);
  await checkPassphrase(content, passphrase);
  const files = new Map<string, { content: Uint8Array; mtime?: number }>();
  for await (const item of vaultFiles(content, passphrase)) files.set(item.path, item);
  assert.deepEqual([...files.keys()].sort(), ["Folder/Note.md", "pic.png"]);
  assert.equal(new TextDecoder().decode(files.get("Folder/Note.md")!.content), "Hello world");
  assert.equal(files.get("Folder/Note.md")!.mtime, Date.UTC(2026, 0, 2));
  assert.deepEqual([...files.get("pic.png")!.content], [0, 1, 2, 250, 255]);
});

test("a wrong passphrase or a backup without the salt fails with its own error", async () => {
  const [content] = (await encryptedArchive()).vaults;
  await assert.rejects(checkPassphrase(content, "wrong"), (error: ArchiveError) => {
    assert.equal(error.code, "archive_wrong_passphrase");
    return true;
  });
  const [old] = (await encryptedArchive(false)).vaults;
  await assert.rejects(checkPassphrase(old, passphrase), (error: ArchiveError) => {
    assert.equal(error.code, "archive_missing_salt");
    return true;
  });
});

test("unencrypted vaults need no salt and archives must start with a manifest", async () => {
  const archive = await readArchive(
    lines([
      { type: "manifest", format: "obsidian-personal-backup", vaults: [vault] },
      {
        type: "document",
        vaultId: vault.id,
        doc: { _id: "h:1", type: "leaf", data: "plain text" },
      },
      file("note.md", "1-a", "note.md", { children: ["h:1"] }),
    ]),
  );
  const [content] = archive.vaults;
  assert.equal(isEncrypted(content), false);
  const files = [];
  for await (const item of vaultFiles(content, "")) files.push(item);
  assert.equal(new TextDecoder().decode(files[0].content), "plain text");
  await assert.rejects(readArchive(lines([{ type: "document" }])), ArchiveError);
  await assert.rejects(
    readArchive(
      lines([
        { type: "manifest", format: "obsidian-personal-backup", vaults: [vault] },
        { type: "document", vaultId: "other", doc: { _id: "x" } },
      ]),
    ),
    ArchiveError,
  );
});

test("archive paths stay inside the destination on every platform", () => {
  assert.equal(safePath("../../etc/passwd"), "etc/passwd");
  assert.equal(safePath("/abs\\win:name?.md"), "abs/win_name_.md");
  assert.equal(safePath("trailing. /x"), "trailing/x");
  assert.equal(safePath(".."), "untitled");
  assert.equal(safePath("Notas/Café ✓.md"), "Notas/Café ✓.md");
});
