import { serve } from "@hono/node-server";
import { FileBackupGateway } from "./backup/files.ts";
import { PersonalBackups } from "./backup/personal.ts";
import { CONFIG_KEYS, loadConfig } from "./config.ts";
import { CouchClient } from "./couchdb/client.ts";
import { CouchDashboardService } from "./domain/service.ts";
import { QuotaGateway } from "./quota/gateway.ts";
import { type AppDependencies, createApps } from "./web/apps.ts";

const serverOptions = { headersTimeout: 10_000, requestTimeout: 35_000 };

export function startApp(dependencies: AppDependencies) {
  const apps = createApps(dependencies);
  const admin = serve({
    hostname: "127.0.0.1",
    port: 8080,
    fetch: apps.admin.fetch,
    overrideGlobalObjects: false,
    serverOptions,
  });
  const owner = serve({
    hostname: "127.0.0.1",
    port: 8081,
    fetch: apps.owner.fetch,
    overrideGlobalObjects: false,
    serverOptions,
  });
  return { admin, owner };
}

if (import.meta.main) {
  try {
    const config = loadConfig(
      Object.fromEntries(CONFIG_KEYS.map((key) => [key, process.env[key]])),
    );
    const client = new CouchClient(
      config.couchdbUrl,
      config.couchdbUsername,
      config.couchdbPassword,
    );
    const service = new CouchDashboardService(client, config.panelDb, config.publicCouchdbUrl, {
      instanceLimitBytes: config.instanceQuotaBytes ?? null,
      defaultUserLimitBytes: config.defaultUserQuotaBytes ?? null,
      recoverPending: config.recoverPendingQuota,
    });
    await service.initialize();
    const personalBackup = config.personalDrive
      ? new PersonalBackups(client, service, config.panelDb, config.personalDrive)
      : undefined;
    startApp({
      config,
      service,
      backup: new FileBackupGateway(config.backupStateDir, config.backupRequestsDir),
      personalBackup,
    });
    if (personalBackup) {
      let ticking = false;
      const tick = async () => {
        if (ticking) return;
        ticking = true;
        try {
          await personalBackup.tick();
        } catch {
          console.error("Personal backup scheduler unavailable.");
        } finally {
          ticking = false;
        }
      };
      void tick();
      setInterval(() => void tick(), 60_000).unref();
    }
    const sync = new QuotaGateway(
      client,
      service.quotas,
      config.couchdbUrl,
      config.couchdbUsername,
      config.couchdbPassword,
      (user, database) => service.resetVaultDatabase(user, database),
    );
    serve({
      hostname: "127.0.0.1",
      port: 8082,
      fetch: (request) => sync.fetch(request),
      overrideGlobalObjects: false,
      serverOptions,
    });
  } catch {
    console.error("Dashboard startup failed. Check configuration and CouchDB availability.");
    process.exit(1);
  }
}
