import { test } from "node:test";
import { changelogSection, releaseVersion } from "../scripts/release-check.ts";

function rejects(action: () => unknown) {
  try {
    action();
  } catch {
    return;
  }
  throw new Error("Expected rejection");
}

test("release version requires canonical exact RC or stable tag", () => {
  if (releaseVersion("v1.0.0", "1.0.0") !== "1.0.0") throw Error();
  if (releaseVersion("v0.1.0-rc.1", "0.1.0-rc.1") !== "0.1.0-rc.1") throw Error();
  for (const tag of ["0.1.0", "v01.1.0", "v0.1.0junk", "v0.1.0-rc.01", "v0.1.0+build"]) {
    rejects(() => releaseVersion(tag, tag.slice(1)));
  }
  rejects(() => releaseVersion("v0.1.0", "0.1.0-rc.1"));
});

test("notes preserve markdown and select exact RC without adjacent entries", () => {
  const source =
    "## [Unreleased]\nfuture\n## [0.1.0-rc.10] - date\nwrong\n## [0.1.0-rc.1] - date\n\n### Added\n\n- Browser setup.\n\n## [0.0.1]\nold\n";
  const notes = changelogSection(source, "0.1.0-rc.1");
  if (notes !== "### Added\n\n- Browser setup.\n") throw Error(notes);
  rejects(() => changelogSection(source, "0.1.0"));
  rejects(() => changelogSection(source + "## [0.1.0-rc.1]\nagain", "0.1.0-rc.1"));
  rejects(() => changelogSection("## [0.1.0]\n \n\t\n", "0.1.0"));
});
