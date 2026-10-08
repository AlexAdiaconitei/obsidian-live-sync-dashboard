import { test } from "node:test";
import { assertEquals, assertMatch, assertThrows } from "./assert.ts";
import { restrictedSecurity } from "../src/couchdb/client.ts";
import {
  grantAccess,
  newRecoveryCode,
  revokeAccess,
  securityEqual,
  validateDatabaseName,
  validateRecoveryCode,
} from "../src/domain/security.ts";

test("removing last member retains admin restriction", () => {
  const security = grantAccess(restrictedSecurity(), "alice");
  const revoked = revokeAccess(security, "alice", []);
  assertEquals(revoked.members, { names: [], roles: ["_admin"] });
  assertEquals(security.members.names, ["alice"]);
});

test("ACL changes retain nested metadata and never mutate the original", () => {
  const original = {
    admins: { names: ["operator"], roles: [] },
    members: { names: ["alice"], roles: ["_admin"], custom: { policy: "retained" } },
  };
  const granted = grantAccess(original, "bob");
  const revoked = revokeAccess(original, "alice", []);
  assertEquals(granted.members.custom, { policy: "retained" });
  assertEquals(revoked.members.custom, { policy: "retained" });
  assertEquals(original.members.names, ["alice"]);
});

test("unrestricted access cannot be revoked without changing implicit grants", () => {
  const open = { admins: { names: [], roles: [] }, members: { names: [], roles: [] } };
  assertThrows(
    () => revokeAccess(open, "alice", []),
    Error,
    "unrestricted_access_cannot_be_revoked",
  );
  assertEquals(open.members, { names: [], roles: [] });
});

test("revocation preserves unrelated grants and metadata", () => {
  const security = {
    admins: { names: ["alice", "operator"], roles: [] },
    members: { names: ["alice", "monitor"], roles: ["readers"] },
    custom: { value: true },
  };
  const revoked = revokeAccess(security, "alice", []);
  assertEquals(revoked.admins.names, ["operator"]);
  assertEquals(revoked.members.names, ["monitor"]);
  assertEquals(revoked.members.roles, ["readers", "_admin"]);
  assertEquals(revoked.custom, { value: true });
  assertThrows(
    () => revokeAccess(security, "alice", ["readers"]),
    Error,
    "role_access_cannot_be_revoked",
  );
  assertThrows(() => revokeAccess(security, "alice", ["_admin"]), Error, "global_admin_access");
});

test("security comparison ignores object keys and ACL order", () => {
  const first = {
    admins: { names: ["a", "b"], roles: [] },
    members: { names: [], roles: ["_admin"] },
  };
  const second = {
    members: { roles: ["_admin"], names: [] },
    admins: { roles: [], names: ["b", "a"] },
  };
  assertEquals(securityEqual(first, second), true);
  assertEquals(
    securityEqual(
      { ...first, custom: ["first", "second"] },
      {
        ...second,
        custom: ["second", "first"],
      },
    ),
    false,
  );
  assertEquals(
    securityEqual(first, { ...second, members: { names: ["outside"], roles: ["_admin"] } }),
    false,
  );
});

test("recovery identity follows pinned LiveSync format", () => {
  const first = newRecoveryCode();
  const second = newRecoveryCode();
  assertMatch(first, /^sls-id-v1:[0-9a-f]{64}$/);
  assertEquals(first === second, false);
  validateRecoveryCode(first);
  assertThrows(() => validateRecoveryCode("sls-id-v1:bad"));
  assertThrows(() => validateDatabaseName("_users"));
  assertThrows(() => validateDatabaseName("../../_users"));
});
