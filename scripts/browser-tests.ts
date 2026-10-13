import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "test/browser_test.ts"], {
  stdio: "inherit",
  env: { ...process.env, RUN_BROWSER_TESTS: "1" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
