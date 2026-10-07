import { readFileSync } from "node:fs";

export const REPOSITORY_URL = "https://github.com/AlexAdiaconitei/obsidian-live-sync-dashboard";

// The runtime image ships package.json next to dist/, which the panel already reads
// relative to its working directory.
function readVersion(): string | null {
  try {
    const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version?: unknown };
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

export const APP_VERSION = readVersion();
