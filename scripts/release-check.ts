import { readFile } from "node:fs/promises";

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/;

export function releaseVersion(tag: string, canonical: string): string {
  if (!tag.startsWith("v") || !semver.test(tag.slice(1))) {
    throw new Error("Expected vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-rc.N");
  }
  const version = tag.slice(1);
  if (version !== canonical) throw new Error("Tag does not match package.json version");
  return version;
}

export function changelogSection(source: string, version: string): string {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const headings = lines.flatMap((line, index) => {
    const match = /^## \[([^\]]+)\](?:\s.*)?$/.exec(line);
    return match ? [{ version: match[1], index }] : [];
  });
  const matches = headings.filter((heading) => heading.version === version);
  if (matches.length !== 1) throw new Error("Expected one exact changelog section");
  const start = matches[0].index + 1;
  const end = headings.find((heading) => heading.index >= start)?.index ?? lines.length;
  const body = lines.slice(start, end).join("\n").trim();
  if (!body) throw new Error("Changelog section is empty");
  return body + "\n";
}

if (import.meta.main) {
  try {
    const tag = process.argv[2];
    const config = JSON.parse(await readFile("package.json", "utf8"));
    const version = releaseVersion(tag ?? "", config.version);
    changelogSection(await readFile("CHANGELOG.md", "utf8"), version);
    console.log(version);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid release");
    process.exit(1);
  }
}
