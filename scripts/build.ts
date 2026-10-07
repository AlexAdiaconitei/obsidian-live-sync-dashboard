import { build, stop } from "esbuild";
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import htmx from "htmx.org/package.json" with { type: "json" };
import { compile, optimize } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const output = new URL("../dist/", import.meta.url);
await mkdir(output, { recursive: true });

try {
  await build({
    entryPoints: [
      "src/client/setup.ts",
      "src/client/ui.ts",
      "src/client/drive-picker.ts",
      "src/client/backups.ts",
    ],
    outdir: "dist",
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome111", "safari16.4", "firefox128"],
    minify: true,
    sourcemap: false,
    plugins: [
      {
        name: "browser-dependencies",
        setup(builder) {
          builder.onResolve({ filter: /^(node:)?crypto$/ }, () => ({
            path: "webcrypto",
            namespace: "webcrypto",
          }));
          builder.onLoad({ filter: /.*/, namespace: "webcrypto" }, () => ({
            contents: "export const webcrypto = globalThis.crypto;",
            loader: "js",
          }));
        },
      },
    ],
  });
} finally {
  stop();
}

const stylesheet = resolve("src/styles/app.css");
const compiler = await compile(await readFile(stylesheet, "utf8"), {
  base: dirname(stylesheet),
  onDependency() {},
});
const sources =
  compiler.root === "none"
    ? []
    : [compiler.root ?? { base: process.cwd(), pattern: "**/*" }].map((source) => ({
        ...source,
        negated: false,
      }));
const scanner = new Scanner({ sources: [...sources, ...compiler.sources] });
await writeFile(
  new URL("app.css", output),
  optimize(compiler.build(scanner.scan()), { minify: true }).code,
);
await copyFile(require.resolve("htmx.org/dist/htmx.min.js"), new URL("htmx.js", output));
await copyFile("src/client/favicon.svg", new URL("favicon.svg", output));
console.log(`Built local assets with htmx ${htmx.version}`);
