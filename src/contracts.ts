export type PersonStatus = "pending_credentials" | "active" | "disabled" | "provisioning";

export interface Person {
  id: string;
  couchUser: string;
  displayName: string;
  tailscaleLogin: string;
  status: PersonStatus;
  createdAt: string;
  quotaBytes?: number | null;
}

export interface Vault {
  id: string;
  personId: string;
  db: string;
  label: string;
  idRecoveryCode: string | null;
  adopted: boolean;
  createdAt: string;
  uriIssuedAt?: string | null;
  provisioning?: boolean;
}

export interface Page<T> {
  items: T[];
  bookmark?: string;
}

export interface PageQuery {
  limit?: number;
  bookmark?: string;
}

export interface CreatePersonInput {
  couchUser: string;
  displayName: string;
  tailscaleLogin: string;
  vaultLabel?: string;
  vaultSlug?: string;
  quotaBytes?: number | null;
}

export interface AdoptVaultInput {
  db: string;
  couchUser: string;
  displayName: string;
  tailscaleLogin: string;
  label: string;
  personId?: string;
  idRecoveryCode?: string;
}

export interface Inventory {
  databases: Array<{
    name: string;
    members: string[];
    admins: string[];
    managed: boolean;
    membersRoles?: string[];
    adminsRoles?: string[];
    warnings?: string[];
  }>;
  users: Array<{ name: string; roles: string[]; managed: boolean }>;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  result: "success" | "failure";
}

export interface CouchHealth {
  up: boolean;
  version: string | null;
}

export interface VaultStats {
  vaultId: string;
  db: string;
  docCount: number;
  sizeFile: number;
  sizeActive: number;
}

export interface SetupMetadata {
  vaultId: string;
  label: string;
  hostname: string;
  database: string;
  username: string;
  idRecoveryCode: string;
  instruction: "new" | "additional";
  encryptionSetup?: "new" | "existing";
}

export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number = 400,
  ) {
    super(code);
    this.name = "ServiceError";
  }
}

export interface DashboardService {
  getOwnedVault(login: string, vaultId: string): Promise<Vault>;
  exportOwnedVault(login: string, vaultId: string): AsyncIterable<string>;
  deleteOwnedVault(
    login: string,
    vaultId: string,
    confirmation: {
      label: string;
      password: string;
      acknowledged: boolean;
      backup: "downloaded" | "skip";
    },
  ): Promise<void>;
  loginOwner(username: string, password: string): Promise<OwnerSession>;
  ownerSession(personId: string, version: string): Promise<Person | null>;
  revokeOwnerSessions(login: string): Promise<void>;
  issueInvitation(actor: string, personId: string): Promise<string>;
  acceptInvitation(token: string, password: string): Promise<OwnerSession>;
  createOwnedVault(login: string, label: string): Promise<Vault>;
  verifySetupCredentials(login: string, vaultId: string, password: string): Promise<void>;
  quotaSummary(): Promise<QuotaSummary>;
  personQuota(login: string): Promise<PersonQuota>;
  setPersonQuota(actor: string, personId: string, limitBytes: number | null): Promise<void>;
  recordBackupRequested(actor: string, requestId: string): Promise<void>;
  reconcileVaultOwnership(
    actor: string,
    vaultId: string,
    confirmedDatabase: string,
  ): Promise<Vault>;
  initialize(): Promise<void>;
  health(): Promise<CouchHealth>;
  listPeople(query?: PageQuery): Promise<Page<Person>>;
  getPerson(id: string): Promise<Person>;
  findPersonByLogin(login: string): Promise<Person | null>;
  listVaults(personId: string, query?: PageQuery): Promise<Page<Vault>>;
  createPerson(actor: string, input: CreatePersonInput): Promise<Person>;
  createVault(
    actor: string,
    personId: string,
    input: { label: string; slug: string },
  ): Promise<Vault>;
  inventory(): Promise<Inventory>;
  adoptVault(actor: string, input: AdoptVaultInput): Promise<Vault>;
  setInitialPassword(login: string, password: string): Promise<void>;
  changePassword(login: string, currentPassword: string, newPassword: string): Promise<void>;
  resetPassword(actor: string, personId: string): Promise<void>;
  setPersonEnabled(actor: string, personId: string, enabled: boolean): Promise<void>;
  getSetupMetadata(login: string, vaultId: string): Promise<SetupMetadata>;
  recordUriIssued(login: string, vaultId: string): Promise<void>;
  registerRecoveryCode(
    actor: string,
    vaultId: string,
    code: string,
    options?: { asOwner?: boolean },
  ): Promise<void>;
  listEvents(query?: PageQuery): Promise<Page<AuditEvent>>;
  stats(): Promise<VaultStats[]>;
}

export interface OwnerSession {
  person: Person;
  version: string;
}

export interface QuotaUsage {
  limitBytes: number | null;
  usedBytes: number;
  remainingBytes: number | null;
  exceeded: boolean;
}

export interface PersonQuota extends QuotaUsage {
  personId: string;
}

export interface InstanceQuota extends QuotaUsage {
  defaultUserLimitBytes: number | null;
  assignedLimitBytes?: number;
  unassignedBytes?: number;
}

export interface QuotaSummary {
  instance: InstanceQuota;
  people: PersonQuota[];
}

export interface BackupRun {
  requestId: string;
  actor: string;
  trigger: "cron" | "manual";
  startedAt: string;
  endedAt: string | null;
  outcome: "running" | "success" | "failure";
  file: string | null;
  sizeBytes: number | null;
  error: string | null;
  uploadOk: boolean;
  retentionOk: boolean;
  notificationOk: boolean;
}

export interface BackupStatus {
  schemaVersion: 1;
  running: BackupRun | null;
  lastAttempt: BackupRun | null;
  lastSuccess: BackupRun | null;
  history: BackupRun[];
  schedule: string;
  timezone: string;
  retentionDays: number;
}

export interface BackupGateway {
  status(): Promise<BackupStatus | null>;
  request(actor: string): Promise<{ requestId: string }>;
}
