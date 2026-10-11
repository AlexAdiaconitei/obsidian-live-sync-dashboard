import { Csrf } from "./csrf.ts";
import type { OwnerSession, DashboardService, Person } from "../contracts.ts";

export const SESSION_IDLE_MS = 3_600_000;
export const SESSION_MAX_MS = 12 * 3_600_000;
const RENEW_AFTER_MS = 10 * 60_000;

export interface VerifiedSession {
  person: Person;
  renewed?: string;
}

export class OwnerSessions {
  private readonly signatures: Csrf;
  constructor(
    secret: string,
    private readonly service: DashboardService,
  ) {
    this.signatures = new Csrf(secret, SESSION_IDLE_MS);
  }

  async issue(session: OwnerSession, startedAt = Date.now()): Promise<string> {
    const payload = Buffer.from(
      JSON.stringify([session.person.id, session.version, startedAt]),
    ).toString("base64url");
    return `${payload}.${await this.signatures.issue(payload, "owner-session")}`;
  }

  async verify(cookie: string | undefined): Promise<VerifiedSession | null> {
    if (!cookie || cookie.length > 2048) return null;
    const separator = cookie.indexOf(".");
    const payload = cookie.slice(0, separator);
    const signature = cookie.slice(separator + 1);
    if (!(await this.signatures.verify(signature, payload, "owner-session"))) return null;
    try {
      const values: unknown = JSON.parse(Buffer.from(payload, "base64url").toString());
      if (
        !Array.isArray(values) ||
        values.length !== 3 ||
        typeof values[0] !== "string" ||
        typeof values[1] !== "string" ||
        !Number.isSafeInteger(values[2])
      )
        return null;
      const [id, version, startedAt] = values as [string, string, number];
      const now = Date.now();
      if (startedAt > now || now - startedAt > SESSION_MAX_MS) return null;
      const person = await this.service.ownerSession(id, version);
      if (!person) return null;
      const issuedAt = Number(signature.split(".")[0]);
      return now - issuedAt > RENEW_AFTER_MS
        ? { person, renewed: await this.issue({ person, version }, startedAt) }
        : { person };
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }
}
