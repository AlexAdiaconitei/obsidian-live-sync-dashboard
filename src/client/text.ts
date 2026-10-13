import type { ClientMessage } from "../locales/index.ts";

type Messages = Partial<Record<ClientMessage, string>>;
let messages: Messages | undefined;

export function message(key: ClientMessage): string {
  messages ??= JSON.parse(document.getElementById("client-text")?.textContent || "{}") as Messages;
  return messages[key] ?? "";
}
