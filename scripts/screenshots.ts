// Regenerates the README and documentation site screenshots from a running `pnpm run demo`.
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  chromium,
} from "@playwright/test";

const admin = `http://127.0.0.1:${process.env.DEMO_ADMIN_PORT ?? 5173}`;
const owner = `http://127.0.0.1:${process.env.DEMO_OWNER_PORT ?? 5174}`;
const media = "docs/site/public/media";
type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
const errors: string[] = [];

async function open(context: BrowserContext, url: string) {
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${url}: ${error.message}`));
  const response = await page.goto(url, { waitUntil: "networkidle" });
  if (response?.status() !== 200) throw new Error(`${url} returned ${response?.status()}`);
  if (!(await page.locator("#main").innerText()).includes("fictional data")) {
    throw new Error("Refusing to capture a non-demo portal");
  }
  // The demo banner is for people browsing the demo, not for the screenshots.
  await page.evaluate(async () => {
    document.querySelector("#main > .notice.info[role=status]")?.remove();
    await document.fonts.ready;
  });
  return page;
}

// The panel rate-limits owner logins, so every context reuses one session.
async function signIn(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${owner}/login`, { waitUntil: "networkidle" });
  await page.fill("input[name=username]", "ana");
  await page.fill("input[name=password]", "demo-owner-password");
  await Promise.all([page.waitForURL(`${owner}/`), page.click("button[type=submit]")]);
  const setup = await page.locator('a[href$="/setup"]').first().getAttribute("href");
  const session = await context.storageState();
  await context.close();
  if (!setup) throw new Error("The demo owner has no vault to configure");
  return { session, setup };
}

async function newContext(browser: Browser, session: StorageState, options: BrowserContextOptions) {
  const context = await browser.newContext({ locale: "en-US", storageState: session, ...options });
  await context.addCookies(
    [admin, owner].map((url) => ({ name: "panel_locale", value: "en", url })),
  );
  return context;
}

const browser = await chromium.launch();
try {
  const { session, setup } = await signIn(browser);
  const shots: [name: string, url: string, tall?: boolean][] = [
    ["admin-overview", `${admin}/`],
    ["admin-person", `${admin}/people/ana`, true],
    ["admin-inventory", `${admin}/inventory`],
    ["admin-backups", `${admin}/backups`],
    ["admin-events", `${admin}/events`],
    ["owner-vaults", `${owner}/`],
    ["owner-setup", `${owner}${setup}`],
    ["owner-backups", `${owner}/backups`],
  ];
  for (const colorScheme of ["light", "dark"] as const) {
    const context = await newContext(browser, session, {
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme,
    });
    for (const [name, url, tall] of shots) {
      const page = await open(context, url);
      // Growing the viewport, rather than fullPage, keeps the sidebar the full height of the shot.
      if (tall) {
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width: 1440, height });
      }
      const path = `${media}/${name}${colorScheme === "dark" ? "-dark" : ""}.png`;
      await page.screenshot({ path });
      console.log(`${path}: ${page.viewportSize()?.height ?? 0}px tall`);
      await page.close();
    }
    await context.close();
  }

  const readme = await newContext(browser, session, {
    viewport: { width: 1440, height: 1020 },
    colorScheme: "light",
  });
  for (const [name, url] of [
    ["admin", `${admin}/`],
    ["owner", `${owner}/`],
  ]) {
    const page = await open(readme, url);
    await page.screenshot({ path: `docs/images/${name}-demo.png`, fullPage: true });
  }
  await readme.close();
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
}
