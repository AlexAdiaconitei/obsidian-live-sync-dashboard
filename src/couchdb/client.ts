export class CouchError extends Error {
  constructor(
    public readonly status: number,
    public readonly code = "couchdb_unavailable",
  ) {
    super(code);
    this.name = "CouchError";
  }
}

export interface CouchSecurity {
  admins: { names: string[]; roles: string[]; [key: string]: unknown };
  members: { names: string[]; roles: string[]; [key: string]: unknown };
  [key: string]: unknown;
}

export interface CouchDocument {
  _id: string;
  _rev?: string;
  [key: string]: unknown;
}

export interface CouchUser extends CouchDocument {
  name: string;
  type: "user";
  roles: string[];
}

export const restrictedSecurity = (): CouchSecurity => ({
  admins: { names: [], roles: ["_admin"] },
  members: { names: [], roles: ["_admin"] },
});

export class CouchClient {
  private readonly base: URL;
  private readonly auth: string;

  constructor(
    url: string,
    username: string,
    password: string,
    private readonly timeout = 8000,
  ) {
    this.base = new URL(url.endsWith("/") ? url : `${url}/`);
    if (this.base.username || this.base.password || this.base.search || this.base.hash) {
      throw new Error("invalid_couchdb_url");
    }
    this.auth = basicAuth(username, password);
  }

  async request<T>(path: string, method = "GET", body?: unknown, auth = this.auth): Promise<T> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.base), {
        method,
        headers: {
          authorization: auth,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
        redirect: "error",
      });
    } catch {
      throw new CouchError(503);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new CouchError(
        response.status,
        response.status === 409
          ? "conflict"
          : response.status === 404
            ? "not_found"
            : "couchdb_unavailable",
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new CouchError(502);
    }
  }

  async get<T>(database: string, id: string): Promise<T | undefined> {
    try {
      return await this.request<T>(`${encodeURIComponent(database)}/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof CouchError && error.status === 404) return undefined;
      throw error;
    }
  }

  async put<T extends CouchDocument>(database: string, document: T): Promise<T> {
    const result = await this.request<{ rev: string }>(
      `${encodeURIComponent(database)}/${encodeURIComponent(document._id)}`,
      "PUT",
      document,
    );
    return { ...document, _rev: result.rev };
  }

  async createDatabase(database: string): Promise<boolean> {
    try {
      await this.request(encodeURIComponent(database), "PUT");
      return true;
    } catch (error) {
      if (error instanceof CouchError && error.status === 412) return false;
      throw error;
    }
  }

  async security(database: string): Promise<CouchSecurity> {
    const value = await this.request<Partial<CouchSecurity>>(
      `${encodeURIComponent(database)}/_security`,
    );
    return {
      ...value,
      admins: {
        ...value.admins,
        names: value.admins?.names ?? [],
        roles: value.admins?.roles ?? [],
      },
      members: {
        ...value.members,
        names: value.members?.names ?? [],
        roles: value.members?.roles ?? [],
      },
    };
  }

  async setSecurity(database: string, security: CouchSecurity): Promise<void> {
    await this.request(`${encodeURIComponent(database)}/_security`, "PUT", security);
  }

  async authenticate(username: string, password: string): Promise<string[]> {
    const result = await this.request<{ userCtx: { name: string | null; roles: string[] } }>(
      "_session",
      "GET",
      undefined,
      basicAuth(username, password),
    );
    if (result.userCtx.name !== username) throw new CouchError(401, "invalid_credentials");
    return result.userCtx.roles;
  }

  async updatePassword(username: string, password: string): Promise<void> {
    const user = await this.get<CouchUser>("_users", `org.couchdb.user:${username}`);
    if (!user) throw new CouchError(404, "not_found");
    const updated: CouchUser = { ...user, password };
    for (const field of ["derived_key", "salt", "iterations", "password_scheme", "pbkdf2_prf"]) {
      delete updated[field];
    }
    await this.put("_users", updated);
    // The authentication cache consumes _users changes asynchronously.
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await this.authenticate(username, password);
        return;
      } catch (error) {
        if (!(error instanceof CouchError) || ![401, 403].includes(error.status)) throw error;
        if (attempt === 19) throw new CouchError(503, "credential_update_pending");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }

  async globalAdminNames(): Promise<string[]> {
    const admins = await this.request<Record<string, string>>("_node/_local/_config/admins");
    return Object.keys(admins);
  }
}

function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}
