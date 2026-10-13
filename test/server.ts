import { serve } from "@hono/node-server";
import { once } from "node:events";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";

export async function testServer(
  fetch: (request: Request) => Response | Promise<Response>,
  tls?: { cert: string; key: string },
) {
  const server = serve({
    fetch,
    hostname: "127.0.0.1",
    port: 0,
    overrideGlobalObjects: false,
    ...(tls ? { createServer, serverOptions: tls } : {}),
  });
  await once(server, "listening");
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        if ("closeAllConnections" in server) server.closeAllConnections();
      }),
  };
}
