import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { releaseVersion } from "./release-check.ts";

export function dokployEnvironment(
  template: string,
  repository: string,
  version: string,
  panelDigest: string,
  backupDigest: string,
): string {
  if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/.test(repository)) {
    throw new Error("Expected lowercase GitHub owner/repository");
  }
  releaseVersion(`v${version}`, version);
  for (const digest of [panelDigest, backupDigest]) {
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid published image digest");
  }
  const set = (key: string, value: string) => {
    const pattern = new RegExp(`^${key}=.*$`, "gm");
    if ([...template.matchAll(pattern)].length !== 1) throw new Error(`Expected one ${key}`);
    template = template.replace(pattern, `${key}=${value}`);
  };
  set("PANEL_IMAGE", `ghcr.io/${repository}@${panelDigest}`);
  set("BACKUP_IMAGE", `ghcr.io/${repository}-backup@${backupDigest}`);
  return (
    `# Published release ${version}. Image digests are fixed; replace credential and hostname placeholders.\n` +
    template.replace(/^# Use the release.*\r?\n# These image paths.*\r?\n/, "")
  );
}

if (import.meta.main) {
  const required = (key: string) => {
    const value = process.env[key];
    if (!value) throw new Error(`Missing ${key}`);
    return value;
  };
  const environment = dokployEnvironment(
    await readFile("deploy/.env.dokploy.example", "utf8"),
    required("GHCR_REPOSITORY"),
    required("RELEASE_VERSION"),
    required("PANEL_DIGEST"),
    required("BACKUP_DIGEST"),
  );
  const directory = resolve(required("DOKPLOY_OUTPUT_DIR"));
  await mkdir(directory, { recursive: true });
  for (const name of ["compose.dokploy.yml", "compose.dokploy.existing.yml"]) {
    await writeFile(resolve(directory, name), await readFile(`deploy/${name}`, "utf8"));
  }
  await writeFile(resolve(directory, "dokploy.env.example"), environment);
}
