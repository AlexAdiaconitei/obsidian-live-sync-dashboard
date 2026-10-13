import { OwnerSessions } from "../src/access/owner-session.ts";
import type { DashboardService } from "../src/contracts.ts";

// Owners sign in with a username and password; this returns the session cookie the panel sets.
export async function ownerCookie(
  secret: string,
  service: DashboardService,
  username: string,
  password: string,
): Promise<string> {
  const session = await service.loginOwner(username, password);
  return `__Host-panel-session=${await new OwnerSessions(secret, service).issue(session)}`;
}

// Adds the session cookie to any cookie the request already carries.
export function withSession(headers: HeadersInit | undefined, session: string): Headers {
  const merged = new Headers(headers);
  merged.set("cookie", [merged.get("cookie"), session].filter(Boolean).join("; "));
  return merged;
}
