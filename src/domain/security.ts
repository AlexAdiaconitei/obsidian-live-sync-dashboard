import type { CouchSecurity } from "../couchdb/client.ts";
import { ServiceError } from "../contracts.ts";

export class DomainError extends ServiceError {
  constructor(code: string, status = 409) {
    super(code, status);
    this.name = "DomainError";
  }
}

export function securityEqual(left: CouchSecurity, right: CouchSecurity): boolean {
  return JSON.stringify(canonical(sortedAcl(left))) === JSON.stringify(canonical(sortedAcl(right)));
}

function sortedAcl(value: CouchSecurity): CouchSecurity {
  return {
    ...value,
    admins: {
      ...value.admins,
      names: [...value.admins.names].sort(),
      roles: [...value.admins.roles].sort(),
    },
    members: {
      ...value.members,
      names: [...value.members.names].sort(),
      roles: [...value.members.roles].sort(),
    },
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function revokeAccess(
  security: CouchSecurity,
  username: string,
  userRoles: string[],
): CouchSecurity {
  if (security.members.names.length === 0 && security.members.roles.length === 0) {
    throw new DomainError("unrestricted_access_cannot_be_revoked");
  }
  if (userRoles.includes("_admin")) throw new DomainError("global_admin_access");
  const grants = [...security.admins.roles, ...security.members.roles];
  if (userRoles.some((role) => grants.includes(role))) {
    throw new DomainError("role_access_cannot_be_revoked");
  }
  const result = structuredClone(security);
  result.admins.names = result.admins.names.filter((name) => name !== username);
  result.members.names = result.members.names.filter((name) => name !== username);
  result.members.roles = [...new Set([...result.members.roles, "_admin"])];
  return result;
}

export function grantAccess(security: CouchSecurity, username: string): CouchSecurity {
  const result = structuredClone(security);
  result.members.names = [...new Set([...result.members.names, username])];
  result.members.roles = [...new Set([...result.members.roles, "_admin"])];
  return result;
}

export function validateRecoveryCode(code: string): void {
  if (!/^sls-id-v1:[0-9a-f]{64}$/.test(code)) throw new DomainError("invalid_recovery_code", 400);
}

export function newRecoveryCode(): string {
  return `sls-id-v1:${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

export function validateDatabaseName(name: string): void {
  if (!/^[a-z][a-z0-9_$()+/-]{0,127}$/.test(name)) {
    throw new DomainError("invalid_database_name", 400);
  }
}

export function validateUsername(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,127}$/.test(name)) {
    throw new DomainError("invalid_username", 400);
  }
}

export function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 1024) {
    throw new DomainError("invalid_password", 400);
  }
}
