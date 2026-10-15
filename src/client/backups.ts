// Recovery keys and backup restore run entirely in the owner's browser. Nothing chosen or typed
// on these pages is sent to the server.
import { Decrypter, generateX25519Identity, identityToRecipient } from "age-encryption";
import {
  type Archive,
  ArchiveError,
  type ArchiveErrorCode,
  checkPassphrase,
  isEncrypted,
  readArchive,
  safePath,
  vaultFiles,
} from "../backup/notes.ts";
import { zipArchive, type ZipEntry } from "../backup/zip.ts";
import type { ClientMessage } from "../locales/index.ts";
import { downloadBlob, downloadText } from "./secrets.ts";
import { message } from "./text.ts";

document.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) return;
  const create = event.target.closest<HTMLButtonElement>("button[data-create-recovery-key]");
  if (!create) return;
  const form = create.closest("form");
  const recipient = form?.elements.namedItem("recipient");
  const saved = form?.querySelector<HTMLInputElement>('input[name="keySaved"]');
  const status = form?.querySelector<HTMLElement>("[data-recovery-key-status]");
  if (!(recipient instanceof HTMLInputElement) || !saved || !status) return;
  create.disabled = true;
  try {
    const identity = await generateX25519Identity();
    const publicKey = await identityToRecipient(identity);
    // The same layout as age-keygen, so the age command line reads it too.
    downloadText(
      "livesync-recovery-key.txt",
      `# ${message("recoveryKeyFileTitle")}\n# created: ${new Date().toISOString()}\n# public key: ${publicKey}\n${identity}\n`,
    );
    recipient.value = publicKey;
    saved.checked = false;
    saved.required = true;
    saved.closest("label")!.hidden = false;
    status.textContent = message("recoveryKeyCreated");
  } catch {
    status.textContent = message("recoveryKeyFailed");
  } finally {
    create.disabled = false;
  }
});

const restore = document.getElementById("backup-restore");
if (restore) setupRestore(restore);

function setupRestore(root: HTMLElement) {
  const backupInput = root.querySelector<HTMLInputElement>('input[name="backup"]')!;
  const keyFile = root.querySelector<HTMLInputElement>('input[name="keyFile"]')!;
  const keyText = root.querySelector<HTMLInputElement>('input[name="keyText"]')!;
  const openButton = root.querySelector<HTMLButtonElement>("[data-restore-open]")!;
  const status = root.querySelector<HTMLElement>("[data-restore-status]")!;
  const list = root.querySelector<HTMLElement>("[data-restore-vaults]")!;
  const actions = root.querySelector<HTMLElement>("[data-restore-actions]")!;
  const notesButton = root.querySelector<HTMLButtonElement>("[data-restore-notes]")!;
  const rawButton = root.querySelector<HTMLButtonElement>("[data-restore-raw]")!;
  let opened:
    | { file: File; identity?: string; archive: Archive; passphrases: HTMLInputElement[] }
    | undefined;

  const say = (key: ClientMessage) => (status.textContent = message(key));
  const fail = (error: unknown) => {
    const codes: Record<ArchiveErrorCode, ClientMessage> = {
      archive_invalid: "restoreInvalid",
      archive_missing_salt: "restoreMissingSalt",
      archive_wrong_passphrase: "restoreWrongPassphrase",
      archive_unsupported_encryption: "restoreUnsupported",
      archive_missing_chunk: "restoreMissingChunk",
    };
    if (error instanceof ArchiveError) say(codes[error.code]);
    else if (error instanceof Error && error.message === "wrong_key") say("restoreWrongKey");
    else if (error instanceof Error && error.message === "missing_key") say("restoreNoKey");
    else say("restoreInvalid");
  };
  const busy = (value: boolean) => {
    for (const button of [openButton, notesButton, rawButton]) button.disabled = value;
  };

  openButton.addEventListener("click", async () => {
    const file = backupInput.files?.[0];
    if (!file) return say("restoreNoFile");
    busy(true);
    opened = undefined;
    list.replaceChildren();
    actions.hidden = true;
    say("restoreReading");
    try {
      const key = keyFile.files?.[0] ? await keyFile.files[0].text() : keyText.value;
      const identity = /AGE-SECRET-KEY-(?:PQ-)?1[0-9A-Z]+/.exec(key)?.[0];
      const archive = await readArchive(lines(await plaintext(file, identity)));
      const passphrases = archive.vaults.map((content) => {
        const row = document.createElement("label");
        row.className = "field";
        const title = document.createElement("span");
        title.textContent = content.vault.label || content.vault.db;
        const input = document.createElement("input");
        input.type = "password";
        input.autocomplete = "off";
        input.spellcheck = false;
        const encrypted = isEncrypted(content);
        input.disabled = !encrypted;
        input.placeholder = message(encrypted ? "restorePassphrase" : "restoreNotEncrypted");
        row.append(title, input);
        list.append(row);
        return input;
      });
      opened = { file, identity, archive, passphrases };
      rawButton.hidden = !identity;
      actions.hidden = false;
      say(archive.vaults.length ? "restoreOpened" : "restoreEmpty");
    } catch (error) {
      fail(error);
    } finally {
      busy(false);
    }
  });

  notesButton.addEventListener("click", async () => {
    if (!opened) return;
    const { archive, passphrases } = opened;
    busy(true);
    try {
      say("restoreChecking");
      for (const [index, content] of archive.vaults.entries()) {
        const input = passphrases[index];
        input.removeAttribute("aria-invalid");
        if (input.disabled) continue;
        try {
          await checkPassphrase(content, input.value);
        } catch (error) {
          input.setAttribute("aria-invalid", "true");
          input.focus();
          throw error;
        }
      }
      say("restoreBuilding");
      const parts: Uint8Array<ArrayBuffer>[] = [];
      for await (const part of zipArchive(entries(archive, passphrases), 0xffffffff))
        parts.push(part as Uint8Array<ArrayBuffer>);
      downloadBlob(
        `livesync-notes-${new Date().toISOString().slice(0, 10)}.zip`,
        new Blob(parts, { type: "application/zip" }),
      );
      say("restoreDone");
    } catch (error) {
      fail(error);
    } finally {
      busy(false);
    }
  });

  rawButton.addEventListener("click", async () => {
    if (!opened?.identity) return;
    busy(true);
    try {
      const stream = await ageStream(opened.file, opened.identity);
      downloadBlob(
        opened.file.name.replace(/\.age$/, "") || "livesync-backup.ndjson.gz",
        await new Response(stream).blob(),
      );
      say("restoreRawDone");
    } catch (error) {
      fail(error);
    } finally {
      busy(false);
    }
  });
}

// Web streams of bytes; age yields views that may sit on any buffer type.
type Bytes = ReadableStream<Uint8Array<ArrayBuffer>>;

async function ageStream(file: File, identity: string): Promise<Bytes> {
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  try {
    // The header, and with it the key check, is processed before the promise resolves.
    return (await decrypter.decrypt(file.stream())) as Bytes;
  } catch {
    throw new Error("wrong_key");
  }
}

// Accepts the encrypted backup, its decrypted .ndjson.gz, or a plain .ndjson.
async function plaintext(file: File, identity?: string): Promise<Bytes> {
  const head = new Uint8Array(await file.slice(0, 21).arrayBuffer());
  let stream: Bytes = file.stream();
  let gzip = head[0] === 0x1f && head[1] === 0x8b;
  if (new TextDecoder().decode(head) === "age-encryption.org/v1") {
    if (!identity) throw new Error("missing_key");
    stream = await ageStream(file, identity);
    gzip = true;
  }
  return gzip ? stream.pipeThrough(new DecompressionStream("gzip")) : stream;
}

async function* lines(stream: Bytes): AsyncGenerator<string> {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let rest = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const parts = (rest + value).split("\n");
    rest = parts.pop()!;
    yield* parts;
  }
  if (rest) yield rest;
}

async function* entries(
  archive: Archive,
  passphrases: HTMLInputElement[],
): AsyncGenerator<ZipEntry> {
  const used = new Set<string>();
  const unique = (path: string) => {
    let name = path;
    for (let copy = 2; used.has(name.toLowerCase()); copy++)
      name = path.replace(/(\.[^./]*)?$/, ` (${copy})$1`);
    used.add(name.toLowerCase());
    return name;
  };
  for (const [index, content] of archive.vaults.entries()) {
    const folder = unique(safePath(content.vault.label || content.vault.db));
    for await (const file of vaultFiles(content, passphrases[index].value)) {
      yield {
        name: unique(`${folder}/${safePath(file.path)}`),
        modified: file.mtime ? new Date(file.mtime) : undefined,
        content: (async function* () {
          yield file.content;
        })(),
      };
    }
  }
}
