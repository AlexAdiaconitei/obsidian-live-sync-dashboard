export const en = {
  vaultArchiveDownloading:
    "Downloading recovery data… Keep this page open until the download is ready.",
  vaultArchiveReady:
    "Recovery ZIP ready. Save it and check it opens without errors before deleting.",
  vaultArchiveFailed:
    "The recovery ZIP could not be downloaded completely. Check your session and connection, then try again. Do not delete without a verified recovery copy.",

  deleteVault: "Delete vault",
  deleteVaultPermanently: "Permanently delete vault",
  cancel: "Cancel",
  vaultDeleteWarning:
    "This permanently deletes the remote database and ALL its notes, attachments and revisions. This action cannot be undone. A previously generated setup link will stop working for this vault.",
  vaultDeleteLocal:
    "Stop synchronization on every device first. Local copies are not deleted by this action. Your account and other vaults remain available. Separate existing backups are not removed.",
  vaultDownloadFirst: "Download a recovery copy first",
  downloadVaultZip: "Download vault recovery ZIP",
  vaultArchiveHelp:
    "The ZIP contains only this vault’s remote CouchDB data, its recovery identity and restoration instructions. LiveSync data keeps its existing encryption. This is a recovery archive, not a folder of decrypted Markdown files. Recovery needs your original vault encryption passphrase. Downloads are limited to 1 GiB.",
  vaultArchiveCheck:
    "Stop synchronization before exporting for a stable copy. Wait for the download to finish and check the ZIP opens without errors before deleting. The archive adds no encryption of its own: keep it private.",
  vaultDeleteConfirmTitle: "Confirm permanent deletion",
  vaultDeleteConfirmHelp:
    "Type the vault name exactly as shown above and enter your account password. The server checks both before deleting anything.",
  vaultBackupDecision: "Your recovery copy",
  vaultBackupDownloaded: "I downloaded and checked the recovery ZIP.",
  vaultBackupSkip: "I choose to delete without downloading a recovery copy.",
  vaultConfirmLabel: "Type the vault name to confirm",
  vaultDeleteAcknowledge:
    "I understand that all remote data in this vault will be permanently deleted and this cannot be undone.",
  vaultDeleteFinalWarning:
    "Permanently delete this vault and all its remote data? You cannot undo this action.",
  vaultDeleteConfirmationError:
    "Deletion was refused. Type the exact vault name, choose a backup option and confirm that deletion is irreversible.",
  vaultSharedDelete:
    "This database has access granted to other accounts or roles. An administrator must review it before it can be deleted.",
  vaultExportBusy:
    "A recovery download is in progress. Finish or cancel it before deleting or downloading again.",
  vaultExportTooLarge:
    "The recovery export exceeds 1 GiB. Ask an administrator for a server backup before deleting.",

  fieldHelp: "More information",
  showPassword: "Show password",
  hidePassword: "Hide password",
  setupIntro:
    "Configure Obsidian on this device. Your account password, vault encryption passphrase and setup-link password each serve a different purpose.",
  setupConnection: "1. Connect to your account",
  setupConnectionIntro:
    "These connection details are filled in for this vault. Use your account password below.",
  setupServer: "Sync server",
  setupServerHelp:
    "The HTTPS address Obsidian uses to synchronize. It must be reachable through Tailscale on every device.",
  setupUsernameHelp:
    "Your CouchDB account username. It is the same username you use to sign in to this portal.",
  setupDatabaseHelp:
    "The remote database dedicated to this vault. It is created automatically when you add a vault. Do not replace it with a local folder name.",
  setupSyncPassword: "Account / sync password",
  setupPasswordHelp:
    "The password you chose when activating your account. Obsidian uses it to access CouchDB. This form checks it; it does not change it.",
  setupNewEncryptionHelp:
    "This new vault has a generated encryption passphrase. Keep it in the downloaded setup file and use the same one on every device. The server cannot recover it.",
  setupEncryptionHelp:
    "Encrypts your notes and attachments before they leave Obsidian. For an existing vault, enter the exact passphrase from a configured device or your saved setup file. Changing it here does not change or recover existing data.",
  setupConfirmHelp:
    "Enter the vault encryption passphrase again to catch typing mistakes. Generating a new passphrase fills both fields.",
  setupLink: "3. Create a setup link",
  setupLinkIntro:
    "The link imports these settings into the LiveSync plugin. Its password protects the link itself.",
  setupModeHelp:
    "A temporary link can be imported for a limited time. A persistent link can be reused. Expiry does not disconnect devices already configured.",
  setupUriPasswordHelp:
    "Only unlocks the setup link when you import it into Obsidian. It is separate from your account password and the passphrase that encrypts your notes. Leave it empty to generate it automatically.",
  setupUriHelp:
    "The complete encrypted obsidian:// link. Copy it into LiveSync’s setup-URI import, or open it on the device with Obsidian installed.",
  setupReady: "Your setup is ready",
  setupImportTitle: "Import into Obsidian",
  setupImportOpen:
    "Open the local vault you want to synchronize in Obsidian and enable Self-hosted LiveSync. Import the full setup URI from this page.",
  setupImportPassword:
    "When Obsidian asks to unlock the setup URI, enter the setup URI password shown above.",
  setupImportSync:
    "Follow the instruction above. Every device of this vault uses the same account password and the same vault encryption passphrase; only the setup URI password changes per link.",
  setupTroubleshooting:
    "If synchronization fails, keep the exact HTTP status and error text from LiveSync. Check that Tailscale is connected and the sync server is reachable. Do not rebuild or delete a remote vault to test a connection.",
  ownerVaultCreationHelp:
    "Each new vault creates its own remote CouchDB database. Choose a label; the database name is assigned automatically. Reusing a label opens your existing vault.",
  adminVaultCreationHelp:
    "This creates a new remote database with the name you choose. To connect an existing database, use the inventory adoption action instead.",
  setupEncryptionSection: "2. Protect your vault",

  personalBackups: "Your backups",
  personalDriveFolder: "Backup folder",
  personalDriveChooseFolder: "Choose a Google Drive folder",
  personalDriveDefaultFolder: "Use the default folder",
  personalDriveFolderChange:
    "Changing the destination affects future backups. Existing copies stay in their current folder; retention runs only in the selected destination.",
  personalDrivePickerHelp:
    "Choose a folder you own in the connected Google account. Google will grant this application access to that folder. The server checks that it is writable before saving the destination.",
  personalDrivePickerUnavailable:
    "The folder selector is not configured on this server. You can use the default folder.",
  personalDrivePickerLoading: "Opening Google Drive…",
  personalDrivePickerFailed:
    "Could not select the folder. Try again or return to your backups. The saved destination has not changed.",
  personalDrivePickerCancelled: "Selection cancelled. The saved destination has not changed.",
  personalDriveInvalidFolder:
    "Choose a writable folder that you own in the connected Google account. The folder must not be in the trash.",
  personalBackupUnavailable: "Personal Google Drive backups are not configured on this server.",
  personalBackupHelp:
    "Connect your own Google Drive. Backups go to obsidian-livesync-backups in your My Drive, or to a folder you choose, and contain only your vaults. Existing backups are kept when you disconnect.",
  personalBackupPrivacy:
    "Backups are encrypted with your recovery key. The setup generated by this panel also enables LiveSync end-to-end encryption: notes reach CouchDB already encrypted, using a passphrase kept on your devices. Database access alone does not decrypt those notes. Check encryption separately for existing or adopted vaults.",
  personalDriveConnect: "Connect my Google Drive",
  personalDriveNotConnected: "Connect your Google Drive to keep encrypted copies of your vaults.",
  personalDrivePickerShort:
    "Pick a folder you own. The server checks it is writable before saving.",
  personalDriveContinue: "Continue to Google",
  personalDriveConnected: "Your Google Drive is connected.",
  personalDriveDisconnect: "Disconnect Google Drive",
  personalBackupSettings: "Backup settings",
  personalBackupDaily: "Back up automatically every 24 hours",
  personalBackupSave: "Save backup settings",
  backupRecipient: "Your public age key",
  backupRecipientHelp:
    "Backups are encrypted with a recovery key that only you keep. Press Create recovery key: this browser generates it, downloads the file and fills in its public part. The file never reaches the server. Keep it in a password manager or on a USB drive: without it nobody, including you and the administrator, can open your backups. If you already have an age key, paste its age1… public key instead. Changing the key does not re-encrypt older backups.",
  personalBackupFailure: "The last backup failed. Daily backups try again within an hour.",
  personalBackupStale: "The last successful backup is more than a day old.",
  personalBackupQueued:
    "Another owner's backup is running. Yours starts within a minute after it finishes.",
  personalErrorExport: "Your vaults could not be read from the server. Try again later.",
  personalErrorTooLarge:
    "The encrypted backup is larger than 1 GiB, the limit for Drive backups. Ask an administrator for a server backup.",
  personalErrorUpload:
    "The upload to Google Drive failed. Check the folder and reconnect Google if access was revoked.",
  personalErrorRetention: "The backup was uploaded, but older backups could not be removed.",
  personalErrorInterrupted: "The backup stopped when the panel restarted.",
  personalErrorRevoke:
    "Google access could not be revoked. Remove this app in your Google account settings.",
  personalBackupRecovery:
    "To recover your notes you need the backup file, your recovery key file and each vault's LiveSync encryption passphrase.",
  personalRestoreTitle: "Recover your vaults",
  personalRestoreKey:
    "Download the encrypted file from your Drive. For a copy of your notes, use the recovery page instead: these steps rebuild the server databases. To decrypt the file without that page, run age with your recovery key.",
  personalRestoreImport:
    "Use an isolated CouchDB of the same version. The first NDJSON line is the vault manifest. Write each vault's local record to _local/obsidian_livesync_sync_parameters in its fresh database first: it holds the salt that end-to-end encryption needs. Then import each document record using _bulk_docs with new_edits=false, preserving revisions and attachments. Check every returned error.",
  personalRestoreIdentity:
    "Recreate user access and adopt each restored vault using the manifest's idRecoveryCode. Accounts, passwords and server settings are not included in this backup.",
  personalRestoreVerify:
    "Connect a disposable Obsidian client with your original LiveSync passphrase. Verify notes, attachments and synchronization before using restored data in production. Remove temporary plaintext afterward.",
  personalRecoveryKeyCreate: "Create recovery key",
  personalRecoveryKeySaved: "I have saved the recovery key file somewhere safe",
  personalRestoreAdvanced: "Restore into CouchDB (advanced)",
  personalRestoreLocal:
    "Open a backup in this browser and download your notes as a ZIP you can open as an Obsidian vault. Nothing you choose or type here is uploaded: the backup, the recovery key and the passphrases stay on this device.",
  personalRestoreFile: "Backup file (.age)",
  personalRestoreKeyFile: "Recovery key file",
  personalRestoreKeyText: "Or paste the key (AGE-SECRET-KEY-…)",
  personalRestoreOpen: "Open backup",
  personalRestoreNotes: "Download notes (.zip)",
  personalRestoreRaw: "Download decrypted data for CouchDB",
  recoveryKeyFileTitle: "LiveSync backup recovery key. Keep this file private and safe.",
  recoveryKeyCreated:
    "Recovery key downloaded as livesync-recovery-key.txt and its public key filled in. Store the file somewhere safe, confirm below and save the settings.",
  recoveryKeyFailed:
    "This browser could not create a key. Update it, or create one with age-keygen and paste its public key.",
  restoreNoFile: "Choose the backup file first.",
  restoreNoKey: "This backup is encrypted. Choose your recovery key file or paste the key.",
  restoreReading: "Decrypting the backup in this browser…",
  restoreOpened:
    "Backup opened. Enter each vault's LiveSync encryption passphrase, then download your notes.",
  restoreEmpty: "This backup contains no vaults.",
  restorePassphrase: "LiveSync encryption passphrase",
  restoreNotEncrypted: "Not encrypted: no passphrase needed",
  restoreChecking: "Checking the passphrases…",
  restoreBuilding: "Rebuilding your notes… Keep this page open.",
  restoreDone: "Download ready. Unzip it and open each folder as a vault in Obsidian.",
  restoreRawDone:
    "Decrypted data downloaded. It is not encrypted: keep it private and delete it after restoring.",
  restoreWrongKey:
    "This recovery key does not open this backup. Use the key that was configured when the backup was made.",
  restoreWrongPassphrase:
    "The highlighted passphrase is wrong. It is the one you entered in LiveSync when setting up Obsidian.",
  restoreMissingSalt:
    "This backup was made by an older panel version and lacks the data needed to decrypt notes. Run a new backup and open that one.",
  restoreUnsupported:
    "This vault uses an older LiveSync encryption scheme that this page cannot open. Restore it into CouchDB instead.",
  restoreMissingChunk: "Part of a note is missing from the backup. Run a new backup and try again.",
  restoreInvalid: "This file is not a backup from this panel, or it is damaged.",
  personalBackupInvalid:
    "Enter a valid public age recipient and retention between 1 and 3650 days.",
  personalBackupBusy: "A backup is running. Try again after it finishes.",
  personalDriveError:
    "Google authorization or upload failed. Return to your backups and try again.",
  quotaReconciliation:
    "Quotas require reconciliation. Sync writes are blocked. See https://alexadiaconitei.github.io/obsidian-live-sync-dashboard/docs/guides/quotas/#interrupted-writes for recovery steps.",
  quotaUnavailable: "Unavailable",
  quotaInstance: "Instance storage quota",
  quotaPersonal: "Your storage quota",
  quotaUser: "User storage quota",
  quotaUsed: "Used",
  quotaLimit: "Limit",
  quotaRemaining: "Available",
  quotaUnlimited: "Unlimited",
  quotaDefaultUser: "Default quota for new users",
  quotaUnassigned: "Usage in databases outside managed vaults",
  quotaStartupHelp:
    "The deployment configuration sets this instance limit. Change it and restart the panel to update it.",
  quotaMeasurementHelp:
    "Quota counts synced document JSON, attachments and live conflicts across managed vaults. CouchDB history, indexes and backups need additional disk space.",
  quotaInput: "Storage quota in GiB",
  quotaInputHelp:
    "1 GiB = 1,073,741,824 bytes. Decimal values are rounded to the nearest byte. Leave empty or use 0 for unlimited. The instance limit still applies.",
  quotaInstanceCapacityHelp: "Available space is also limited by the instance capacity.",
  quotaSave: "Save quota",
  quotaExceeded:
    "The storage limit has been reached. New data that increases usage is blocked. An administrator can review the quota limits.",
  quotaInvalid:
    "Enter a non-negative decimal quota in GiB. A positive quota must be at least one byte.",
  quotaAllocationExceeded:
    "The user quota cannot exceed the instance limit. Reduce it or increase the instance limit in the deployment configuration.",
  backupAuditUnavailable:
    "The backup request is queued, but its audit entry could not be written. Follow the request ID below. Do not submit it again.",
  pending: "Pending",
  backupStale: "The last successful backup is older than the configured age limit.",
  backupMissing: "No successful backup has been reported.",
  backupUnreadable: "Backup status is unavailable. Check the worker and its status mount.",
  backupFailure: "The last backup attempt failed. Previous successful backups remain available.",
  schedule: "Schedule",
  timezone: "Time zone",
  retention: "Retention",
  days: "days",
  size: "Size",
  error: "Error",
  upload: "Upload",
  notifications: "Notifications",
  restoreManual: "Manual recovery guide",
  restoreIntro: "Restore only into an isolated environment. This dashboard does not run restores.",
  restoreStep1:
    "Download and decrypt an archive on an isolated machine using your offline age private key. Inspect its paths before extraction.",
  restoreStep2:
    "Stop a disposable CouchDB instance of the same version. Extract into its empty data volume and restore the separate CouchDB configuration.",
  restoreStep3:
    "Start only CouchDB. Verify users, document counts, attachments, database permissions, registry and persisted vault identities.",
  restoreStep4:
    "Connect an isolated panel and disposable Obsidian client. Check decryption and sync without rebuilding the remote. Record results before enabling production writes.",
  archiveFailed: "Archive creation failed.",
  uploadFailed: "Encrypted archive upload failed.",
  retentionFailed: "Backup retention failed.",
  interrupted: "The backup was interrupted.",
  workerFailed: "The worker failed.",
  passwordWrong:
    "The current sync password is incorrect. Enter it again or ask an administrator to start recovery.",
  securityDrift:
    "Database permissions changed outside this dashboard. Ask an administrator to reconcile them before retrying.",
  roleAccess:
    "This account has access through database roles or global admin rights. Remove those grants explicitly before disabling managed access.",
  useAdoption:
    "This account or database already exists. Register it through adoption instead of creating it.",
  alreadyRegistered:
    "This identity or database is already registered. Review the existing person or vault.",
  confirmDisable: "Disable this person? Their devices stop syncing until you enable them again.",
  confirmReset:
    "Reset this person's password? Their devices stop syncing until they choose a new one.",
  confirmDisconnect:
    "Disconnect Google Drive? Daily backups stop. Existing backups stay in your Drive.",
  invalidText: "Names need 1 to 160 characters and no line breaks.",
  missingField: "Fill in every field. Each value can have up to 1024 characters.",
  notFound: "This page or item does not exist.",
  operationInProgress: "Another change to this person is still running. Try again in a moment.",
  adoptionValidation:
    "This database has its own validate_doc_update function, which the gateway's administrator writes would bypass. It cannot be adopted.",
  adoptionMissing: "CouchDB has no account or database with that name. Check both names.",
  vaultExists: "You already had a vault with this name, so it opened instead of a new one.",
  vaultLimit: "You have reached the limit of 20 vaults. Ask an administrator for another vault.",
  accountNoAccess:
    "This account has no access to the selected database. Review the database permissions before adoption.",
  invalidRecovery:
    "Use an existing recovery code in the format sls-id-v1 followed by a colon and 64 lowercase hexadecimal characters.",
  missingSnapshot:
    "The saved access permissions are missing. Ask an administrator to reconcile this vault before restoring access.",
  retryForm: "Check the state and reload the original form before retrying.",
  roles: "Roles",
  warnings: "Access warnings",
  unrestrictedDatabase: "Database access is unrestricted for CouchDB users.",
  memberRoles: "Member roles",
  adminRoles: "Admin roles",
  accountMissing:
    "This CouchDB account could not be found. Review the inventory and account configuration.",
  invalidDatabase:
    "Use a database name beginning with a lowercase letter and containing only lowercase letters, numbers or CouchDB-supported punctuation.",
  invalidUsername:
    "Use a CouchDB username containing letters, numbers, dots, underscores, @ or hyphens.",
  invalidLogin: "Enter the exact Tailscale login without spaces.",
  reconcile: "Reconcile database ownership",
  confirmDatabase: "Type the exact database name",
  reconcileHelp:
    "Check that this empty database was created by this dashboard operation. Confirm its ownership by entering its exact name. Do not confirm an unrelated database.",
  ownershipUnknown:
    "The dashboard cannot prove database ownership after an interrupted operation. Review the person's vaults and reconcile ownership only after checking the empty database belongs to that operation.",
  unrestrictedAccess:
    "This database permits unrestricted access. Individual access cannot be revoked without closing access for other users. Review its permissions explicitly before retrying.",
  remoteVersionMissing:
    "The existing remote has no LiveSync version information. Inspect its configuration from an already configured device before adding a device.",
  remoteIncompatible:
    "The remote LiveSync version is incompatible with this dashboard. Check the installed plugin versions and dashboard compatibility before configuring another device.",
  remoteMigration:
    "The remote requires a LiveSync migration. Complete it from an existing configured device, then try again.",
  overview: "Overview",
  people: "People",
  inventory: "Adopt existing vaults",
  backups: "Backups",
  events: "Activity",
  owner: "Your vaults",
  admin: "Administration",
  settings: "Preferences",
  language: "Language",
  theme: "Theme",
  system: "System",
  light: "Light",
  dark: "Dark",
  signIn: "Your Tailscale identity could not be authorized.",
  forbidden: "Access denied",
  requestFailed: "The request could not be completed. Check the service status and try again.",
  errorTitle: "Something went wrong",
  invalid: "Check the fields and try again.",
  csrf: "This form expired. Reload the page and try again.",
  name: "Display name",
  username: "Username",
  database: "Database",
  label: "Vault name",
  createPerson: "Create account",
  loginOwner: "Sign in",
  logoutOwner: "Sign out",
  version: "Version",
  confirmTitle: "Are you sure?",
  confirmAction: "Continue",
  changesSaved: "Changes saved.",
  vaultDeletedNotice: "Vault deleted.",
  setupLeave:
    "You have not downloaded the setup file. The URI and passwords disappear when you leave this page.",
  leavePage: "Leave without downloading",
  setupAgain: "Configure another device",
  setupQrShow: "Show QR code",
  setupQrHide: "Hide QR code",
  setupQrExpand: "Enlarge",
  setupQrClose: "Close",
  setupQrDistance:
    "Hold the phone 20 to 40 cm from the screen and raise the screen brightness if the camera does not react.",
  setupQrTitle: "Scan it on your phone",
  setupQrHelp:
    "Point the phone camera at the code to open the setup URI in Obsidian, then enter the setup URI password. Keep the code private, like the URI.",
  setupQrTooLong:
    "This setup URI is too long for a QR code. Copy it or use the downloaded .txt instead.",
  setupRestartConfirm:
    "Start over? The current setup URI and its password disappear from this page. Devices that already imported it keep working.",
  setupResultIntro: "Import this URI into Obsidian, then follow the instruction below.",
  loginHelp:
    "Use your username and sync password. If you have not activated your account or need a password reset, ask the administrator for an invitation.",
  activateOwner: "Activate account",
  activationHelp:
    "Open your invitation link, then choose your password. Use this password to sign in and sync. After activation, create your own vaults.",
  inviteOwner: "Create invitation",
  invitationHelp:
    "Send this private link to the account owner. It expires in 24 hours, works once and replaces previous invitations. The owner chooses their password.",
  invitationLink: "Invitation link",
  invitationMeta: "Expires in 24 hours · single use",
  invitationCode: "Invitation code",
  invitationInvalid:
    "This invitation expired or was already used. Ask the administrator for a new one.",
  generateSecret: "Generate",
  exportSetup: "Download setup .txt",
  exportAccount: "Download account .txt",
  accountExportHelp:
    "Save your username and password before activation. The .txt contains your password in plain text. Keep it private.",
  exportWarning:
    "Download the .txt before leaving. It contains your passwords in plain text. Keep it private. The dashboard cannot recover it after you close this page.",
  syncPasswordHelp:
    "Use your existing account password. Changing it on the password page affects all your devices.",
  existingEncryptionHelp:
    "Reuse the encryption passphrase from your saved setup or an existing device. A different one cannot read your notes.",
  createVault: "Add vault",
  save: "Save",
  status: "Status",
  empty: "No records yet.",
  active: "Active",
  disabled: "Disabled",
  pending_credentials: "Password required",
  credential_reset: "Password reset required",
  disable: "Disable access",
  enable: "Restore access",
  reset: "Require password reset",
  details: "Manage",
  vaults: "Vaults",
  password: "Sync password",
  currentPassword: "Current sync password",
  newPassword: "New sync password",
  confirmPassword: "Confirm password",
  passwordHelp: "Choose your account password. After changing it, update Obsidian on every device.",
  changePassword: "Change sync password",
  passwordsDiffer: "Passwords do not match.",
  passwordMin: "Use a password with at least 12 characters.",
  setup: "Configure device",
  setupTitle: "Configure a device",
  setupHelp:
    "For a new vault, the encryption passphrase is ready. Enter your sync password and generate the setup. For an existing vault, reuse its encryption passphrase.",
  e2e: "Vault encryption passphrase",
  uriPassphrase: "Setup URI password",
  generate: "Generate Setup URI",
  copy: "Copy",
  setupExpiry: "Expiry limits importing this URI. It does not revoke access on configured devices.",
  recovery: "Existing recovery code",
  recoveryMissing:
    "This vault has no recovery code, so the dashboard cannot generate Setup URIs for it. Existing devices keep syncing. Paste the recovery code from a device that already syncs this vault.",
  recoverySave: "Save recovery code",
  recoveryAdd: "Add recovery code",
  recoveryConflict:
    "This vault already has a different recovery code. The dashboard never replaces a stored vault identity.",
  adoptionHelp:
    "Register existing resources without changing names, passwords or access memberships. Adoption installs a write guard. Switch sync clients to the quota gateway before adopting; direct CouchDB writes will be rejected.",
  preview: "Preview registration",
  adopt: "Register existing vault",
  technical: "Technical accounts",
  accounts: "Accounts",
  security: "Database permissions",
  healthy: "Connected",
  unhealthy: "Unavailable",
  couchdb: "CouchDB",
  registry: "Dashboard registry",
  unavailable: "Not configured",
  requestBackup: "Request backup",
  backupHelp: "The independent worker handles requests. A request is not a completed backup.",
  lastSuccess: "Last success",
  lastAttempt: "Last attempt",
  operation: "Operation",
  actor: "Actor",
  date: "Date",
  result: "Result",
  next: "Next page",
  back: "Back",
  requestId: "Request ID",
  readiness: "Service readiness",
  loading: "Working…",
  welcome: "Keep your vaults in sync.",
  ownerIntro:
    "Set your sync password and configure each device using your own encrypted vault settings.",
  inventoryIntro: "Inspect existing accounts and database access before registration.",
  ok: "Saved",
  copied: "Copied",
  setupUri: "Setup URI",
  setupWorking: "Generating on this device…",
  setupMismatch: "The encryption passphrases must match.",
  setupCredentials:
    "Incorrect sync password. Use the password you set for your account, or change it on the password page.",
  setupSession: "Your session expired. Sign in again and reopen this vault.",
  setupTooMany: "Too many attempts. Wait a minute and try again.",
  setupExportTitle: "LiveSync setup. Private file containing passwords in plain text.",
  setupEncryption: "Vault encryption passphrase",
  setupExpires: "Usable until",
  setupPersistent: "Persistent URI. Imported credentials remain valid until access is revoked.",
  setupGenerated: "Setup ready. Download the .txt before leaving this page.",
  setupNewDevice:
    "The panel has already prepared this empty remote. On this first device, LiveSync can either fetch from the remote or rebuild it with this device's notes; both work. Notes already on the device upload either way.",
  setupAdditionalDevice:
    "This vault already has data. Reuse the vault encryption passphrase of your other devices, accept the remote's settings and fetch from the remote. Never rebuild or overwrite the remote.",
  accountExportTitle: "LiveSync account. Private file containing a password in plain text.",
  setupError: "Could not generate the URI. Check your inputs and try again.",
  managed: "Managed access",
  unknownRecovery:
    "Recovery code is missing. Obtain it from an already configured device before generating a URI.",
  sensitive: "The dashboard never stores the passwords entered here.",
  expiry: "Expires",
  initial: "Initial setup",
  e2eConfirm: "Confirm vault encryption passphrase",
  uriMode: "Setup URI type",
  ephemeral: "Temporary URI",
  persistent: "Persistent URI",
  generatedPassword: "Setup URI password",
  uriModeHelp:
    "Temporary URIs expire. Persistent URIs remain importable until their credentials are changed.",
  running: "Running",
  success: "Success",
  failure: "Failed",
  provisioning: "Provisioning",
  documents: "Documents",
  storage: "Storage",
  methodDenied: "This action is not supported.",
  tooMany: "Too many requests. Wait a minute and try again.",
  tooLarge: "The form is too large.",
  unsupported: "This form format is not supported.",
};
export type MessageKey = keyof typeof en;
export const es: Record<MessageKey, string> = {
  vaultArchiveDownloading:
    "Descargando los datos de recuperación… Mantén abierta esta página hasta que termine.",
  vaultArchiveReady:
    "ZIP de recuperación listo. Guárdalo y comprueba que se abre sin errores antes de eliminar.",
  vaultArchiveFailed:
    "No se pudo descargar el ZIP completo. Revisa tu sesión y la conexión y vuelve a intentarlo. No elimines sin una copia de recuperación comprobada.",

  deleteVault: "Eliminar bóveda",
  deleteVaultPermanently: "Eliminar bóveda definitivamente",
  cancel: "Cancelar",
  vaultDeleteWarning:
    "Se eliminará definitivamente la base de datos remota y TODAS sus notas, adjuntos y revisiones. No se puede deshacer. Los enlaces de configuración anteriores dejarán de funcionar para esta bóveda.",
  vaultDeleteLocal:
    "Detén primero la sincronización en todos los dispositivos. Esta acción no borra las copias locales. Tu cuenta y las demás bóvedas seguirán disponibles. Las copias de seguridad anteriores se conservan.",
  vaultDownloadFirst: "Descarga primero una copia de recuperación",
  downloadVaultZip: "Descargar ZIP de recuperación",
  vaultArchiveHelp:
    "El ZIP incluye solo los datos remotos de CouchDB de esta bóveda, su identidad de recuperación e instrucciones para restaurarla. Los datos mantienen el cifrado de LiveSync. Es una copia de recuperación, no una carpeta de archivos Markdown descifrados. Necesitarás la clave de cifrado original. El límite de descarga es 1 GiB.",
  vaultArchiveCheck:
    "Detén la sincronización antes de exportar para obtener una copia estable. Espera a que termine la descarga y comprueba que el ZIP se abre sin errores antes de eliminar. El archivo no añade cifrado propio: guárdalo en privado.",
  vaultDeleteConfirmTitle: "Confirma el borrado definitivo",
  vaultDeleteConfirmHelp:
    "Escribe exactamente el nombre de la bóveda que aparece arriba e introduce la contraseña de tu cuenta. El servidor comprobará ambos antes de borrar nada.",
  vaultBackupDecision: "Tu copia de recuperación",
  vaultBackupDownloaded: "He descargado y comprobado el ZIP de recuperación.",
  vaultBackupSkip: "Elijo eliminar sin descargar una copia de recuperación.",
  vaultConfirmLabel: "Escribe el nombre de la bóveda para confirmar",
  vaultDeleteAcknowledge:
    "Entiendo que se eliminarán todos los datos remotos de esta bóveda de forma definitiva y que no se puede deshacer.",
  vaultDeleteFinalWarning:
    "¿Eliminar definitivamente esta bóveda y todos sus datos remotos? No se puede deshacer.",
  vaultDeleteConfirmationError:
    "No se ha borrado nada. Escribe el nombre exacto de la bóveda, elige una opción de copia y confirma que el borrado es irreversible.",
  vaultSharedDelete:
    "Esta base da acceso a otras cuentas o roles. Un administrador debe revisarla antes de poder eliminarla.",
  vaultExportBusy:
    "Hay una descarga de recuperación en curso. Termínala o cancélala antes de eliminar o descargar otra copia.",
  vaultExportTooLarge:
    "La exportación supera 1 GiB. Pide una copia del servidor al administrador antes de eliminar.",

  fieldHelp: "Más información",
  showPassword: "Mostrar contraseña",
  hidePassword: "Ocultar contraseña",
  setupIntro:
    "Configura Obsidian en este dispositivo. La contraseña de tu cuenta, la clave de cifrado de la bóveda y la contraseña del enlace tienen funciones distintas.",
  setupConnection: "1. Conecta con tu cuenta",
  setupConnectionIntro:
    "La conexión ya está preparada para esta bóveda. Introduce debajo la contraseña de tu cuenta.",
  setupServer: "Servidor de sincronización",
  setupServerHelp:
    "Dirección HTTPS que usa Obsidian para sincronizar. Todos tus dispositivos deben poder acceder a ella mediante Tailscale.",
  setupUsernameHelp:
    "Tu nombre de usuario de CouchDB. Es el mismo que utilizas para iniciar sesión en este portal.",
  setupDatabaseHelp:
    "Base de datos remota dedicada a esta bóveda. Se crea automáticamente al añadirla. No la sustituyas por el nombre de una carpeta local.",
  setupSyncPassword: "Contraseña de la cuenta / sincronización",
  setupPasswordHelp:
    "La contraseña que elegiste al activar tu cuenta. Obsidian la utiliza para acceder a CouchDB. Aquí se comprueba; no se cambia.",
  setupNewEncryptionHelp:
    "Esta bóveda nueva tiene una clave de cifrado generada. Guárdala en el archivo de configuración descargado y utiliza la misma en todos tus dispositivos. El servidor no puede recuperarla.",
  setupEncryptionHelp:
    "Cifra las notas y los adjuntos antes de salir de Obsidian. En una bóveda existente, introduce la clave exacta de un dispositivo configurado o del archivo de configuración guardado. Cambiarla aquí no modifica ni recupera los datos existentes.",
  setupConfirmHelp:
    "Repite la clave de cifrado de la bóveda para detectar errores al escribir. Al generar una clave nueva se rellenan ambos campos.",
  setupLink: "3. Crea un enlace de configuración",
  setupLinkIntro:
    "El enlace importa estos ajustes en el plugin LiveSync. Su contraseña protege el propio enlace.",
  setupModeHelp:
    "Un enlace temporal solo se puede importar durante un tiempo limitado. Uno persistente se puede reutilizar. La caducidad no desconecta dispositivos ya configurados.",
  setupUriPasswordHelp:
    "Solo desbloquea el enlace de configuración al importarlo en Obsidian. Es independiente de la contraseña de tu cuenta y de la clave que cifra tus notas. Déjala vacía para generarla automáticamente.",
  setupUriHelp:
    "Enlace obsidian:// completo y cifrado. Cópialo en la opción de importar Setup URI de LiveSync o ábrelo en el dispositivo donde tengas Obsidian instalado.",
  setupReady: "Tu configuración está lista",
  setupImportTitle: "Importar en Obsidian",
  setupImportOpen:
    "Abre en Obsidian la bóveda local que quieres sincronizar y activa Self-hosted LiveSync. Importa la URI completa de esta página.",
  setupImportPassword:
    "Cuando Obsidian pida desbloquear la Setup URI, introduce la contraseña de la Setup URI que aparece arriba.",
  setupImportSync:
    "Sigue la indicación anterior. Todos los dispositivos de esta bóveda usan la misma contraseña de cuenta y la misma clave de cifrado; solo la contraseña de la Setup URI cambia en cada enlace.",
  setupTroubleshooting:
    "Si falla la sincronización, conserva el código HTTP y el mensaje exacto de LiveSync. Comprueba la conexión a Tailscale y el acceso al servidor. No reconstruyas ni borres una bóveda remota para probar la conexión.",
  ownerVaultCreationHelp:
    "Cada bóveda nueva crea su propia base de datos remota en CouchDB. Elige un nombre visible; el nombre de la base se asigna automáticamente. Si repites el nombre, se abre tu bóveda existente.",
  adminVaultCreationHelp:
    "Se crea una base de datos remota nueva con el nombre que elijas. Para conectar una base existente, utiliza la opción de registrarla desde el inventario.",
  setupEncryptionSection: "2. Protege tu bóveda",

  personalDriveFolder: "Carpeta de backups",
  personalDriveChooseFolder: "Elegir carpeta de Google Drive",
  personalDriveDefaultFolder: "Usar la carpeta predeterminada",
  personalDriveFolderChange:
    "Cambiar el destino afecta a las copias futuras. Las anteriores permanecen en su carpeta; la retención solo se aplica al destino seleccionado.",
  personalDrivePickerHelp:
    "Elige una carpeta propia de la cuenta Google conectada. Google dará acceso a esa carpeta a la aplicación. El servidor comprueba que permite escribir antes de guardar el destino.",
  personalDrivePickerUnavailable:
    "El selector de carpetas no está configurado en este servidor. Puedes usar la carpeta predeterminada.",
  personalDrivePickerLoading: "Abriendo Google Drive…",
  personalDrivePickerFailed:
    "No se pudo seleccionar la carpeta. Vuelve a intentarlo o regresa a tus backups. El destino guardado no ha cambiado.",
  personalDrivePickerCancelled: "Selección cancelada. El destino guardado no ha cambiado.",
  personalDriveInvalidFolder:
    "Elige una carpeta propia que permita escribir en la cuenta Google conectada. No debe estar en la papelera.",
  personalBackups: "Tus backups",
  personalBackupUnavailable:
    "Los backups personales en Google Drive no están configurados en este servidor.",
  personalBackupHelp:
    "Conecta tu propio Google Drive. Las copias se guardan en obsidian-livesync-backups, dentro de Mi unidad, o en la carpeta que elijas, y solo contienen tus vaults. Desconectar conserva las copias existentes.",
  personalBackupPrivacy:
    "Los backups se cifran con tu clave de recuperación. La configuración que genera este panel también activa el cifrado de extremo a extremo de LiveSync: las notas llegan cifradas a CouchDB con una contraseña que conservan tus dispositivos. Acceder a la base de datos no basta para descifrarlas. Comprueba el cifrado por separado en vaults existentes o adoptados.",
  personalDriveConnect: "Conectar mi Google Drive",
  personalDriveNotConnected: "Conecta tu Google Drive para guardar copias cifradas de tus vaults.",
  personalDrivePickerShort:
    "Elige una carpeta propia. El servidor comprueba que permite escribir antes de guardarla.",
  personalDriveContinue: "Continuar a Google",
  personalDriveConnected: "Tu Google Drive está conectado.",
  personalDriveDisconnect: "Desconectar Google Drive",
  personalBackupSettings: "Configuración de backups",
  personalBackupDaily: "Crear una copia automáticamente cada 24 horas",
  personalBackupSave: "Guardar configuración",
  backupRecipient: "Tu clave pública age",
  backupRecipientHelp:
    "Los backups se cifran con una clave de recuperación que solo guardas tú. Pulsa Crear clave de recuperación: este navegador la genera, descarga el archivo y rellena su parte pública. El archivo no llega nunca al servidor. Guárdalo en un gestor de contraseñas o en un USB: sin él nadie, ni tú ni el administrador, puede abrir tus backups. Si ya tienes una clave age, pega aquí su clave pública age1…. Cambiar la clave no vuelve a cifrar los backups anteriores.",
  personalBackupFailure:
    "El último backup falló. Los backups diarios lo vuelven a intentar en menos de una hora.",
  personalBackupStale: "El último backup correcto tiene más de un día.",
  personalBackupQueued:
    "Hay en curso un backup de otra persona. El tuyo empieza en menos de un minuto cuando termine.",
  personalErrorExport: "No se pudieron leer tus vaults del servidor. Inténtalo más tarde.",
  personalErrorTooLarge:
    "El backup cifrado supera 1 GiB, el límite de los backups en Drive. Pide a un administrador una copia del servidor.",
  personalErrorUpload:
    "Falló la subida a Google Drive. Revisa la carpeta y vuelve a conectar Google si se revocó el acceso.",
  personalErrorRetention: "El backup se subió, pero no se pudieron borrar los antiguos.",
  personalErrorInterrupted: "El backup se detuvo al reiniciarse el panel.",
  personalErrorRevoke:
    "No se pudo revocar el acceso a Google. Quita esta app en la configuración de tu cuenta de Google.",
  personalBackupRecovery:
    "Para recuperar tus notas necesitas el archivo del backup, el archivo de tu clave de recuperación y la contraseña de cifrado de LiveSync de cada vault.",
  personalRestoreTitle: "Recuperar tus vaults",
  personalRestoreKey:
    "Descarga el archivo cifrado de tu Drive. Para obtener una copia de tus notas usa la página de recuperación: estos pasos reconstruyen las bases de datos del servidor. Para descifrar el archivo sin esa página, usa age con tu clave de recuperación.",
  personalRestoreImport:
    "Usa un CouchDB aislado de la misma versión. La primera línea NDJSON es el manifiesto de vaults. Escribe primero el registro local de cada vault en _local/obsidian_livesync_sync_parameters de su base nueva: guarda el salt que necesita el cifrado de extremo a extremo. Después importa cada registro de documento mediante _bulk_docs con new_edits=false, conservando revisiones y adjuntos. Comprueba todos los errores devueltos.",
  personalRestoreIdentity:
    "Recrea el acceso del usuario y adopta cada vault restaurado con el idRecoveryCode del manifiesto. La copia no incluye cuentas, contraseñas ni configuración del servidor.",
  personalRestoreVerify:
    "Conecta un Obsidian desechable con tu contraseña original de cifrado de LiveSync. Comprueba notas, adjuntos y sincronización antes de usar los datos en producción. Elimina después los archivos temporales descifrados.",
  personalRecoveryKeyCreate: "Crear clave de recuperación",
  personalRecoveryKeySaved: "He guardado el archivo de la clave de recuperación en un lugar seguro",
  personalRestoreAdvanced: "Restaurar en CouchDB (avanzado)",
  personalRestoreLocal:
    "Abre un backup en este navegador y descarga tus notas en un ZIP que puedes abrir como vault de Obsidian. No se sube nada de lo que elijas o escribas aquí: el backup, la clave de recuperación y las contraseñas se quedan en este dispositivo.",
  personalRestoreFile: "Archivo del backup (.age)",
  personalRestoreKeyFile: "Archivo de la clave de recuperación",
  personalRestoreKeyText: "O pega la clave (AGE-SECRET-KEY-…)",
  personalRestoreOpen: "Abrir backup",
  personalRestoreNotes: "Descargar notas (.zip)",
  personalRestoreRaw: "Descargar datos descifrados para CouchDB",
  recoveryKeyFileTitle:
    "Clave de recuperación de backups de LiveSync. Guarda este archivo en privado y en un lugar seguro.",
  recoveryKeyCreated:
    "Clave de recuperación descargada como livesync-recovery-key.txt y clave pública rellenada. Guarda el archivo en un lugar seguro, confírmalo abajo y guarda la configuración.",
  recoveryKeyFailed:
    "Este navegador no pudo crear la clave. Actualízalo, o crea una con age-keygen y pega su clave pública.",
  restoreNoFile: "Elige primero el archivo del backup.",
  restoreNoKey:
    "Este backup está cifrado. Elige el archivo de tu clave de recuperación o pega la clave.",
  restoreReading: "Descifrando el backup en este navegador…",
  restoreOpened:
    "Backup abierto. Escribe la contraseña de cifrado de LiveSync de cada vault y descarga tus notas.",
  restoreEmpty: "Este backup no contiene vaults.",
  restorePassphrase: "Contraseña de cifrado de LiveSync",
  restoreNotEncrypted: "Sin cifrar: no hace falta contraseña",
  restoreChecking: "Comprobando las contraseñas…",
  restoreBuilding: "Reconstruyendo tus notas… No cierres esta página.",
  restoreDone: "Descarga lista. Descomprímela y abre cada carpeta como vault en Obsidian.",
  restoreRawDone:
    "Datos descifrados descargados. No están cifrados: guárdalos en privado y bórralos después de restaurar.",
  restoreWrongKey:
    "Esta clave de recuperación no abre este backup. Usa la clave que estaba configurada cuando se hizo.",
  restoreWrongPassphrase:
    "La contraseña marcada no es correcta. Es la que pusiste en LiveSync al configurar Obsidian.",
  restoreMissingSalt:
    "Este backup lo hizo una versión anterior del panel y le faltan los datos para descifrar las notas. Haz un backup nuevo y abre ese.",
  restoreUnsupported:
    "Este vault usa un cifrado antiguo de LiveSync que esta página no puede abrir. Restáuralo en CouchDB.",
  restoreMissingChunk:
    "Al backup le falta parte de una nota. Haz un backup nuevo y vuelve a intentarlo.",
  restoreInvalid: "Este archivo no es un backup de este panel o está dañado.",
  personalBackupInvalid:
    "Introduce un destinatario público age válido y una retención de entre 1 y 3650 días.",
  personalBackupBusy: "Hay un backup en curso. Vuelve a intentarlo cuando termine.",
  personalDriveError:
    "Falló la autorización o la subida a Google. Vuelve a tus backups e inténtalo de nuevo.",
  quotaReconciliation:
    "Las cuotas requieren reconciliación. Las escrituras de sincronización están bloqueadas. Consulta https://alexadiaconitei.github.io/obsidian-live-sync-dashboard/docs/guides/quotas/#interrupted-writes para recuperarlas.",
  quotaUnavailable: "No disponible",
  quotaInstance: "Cuota de espacio de la instancia",
  quotaPersonal: "Tu cuota de espacio",
  quotaUser: "Cuota de espacio del usuario",
  quotaUsed: "Usado",
  quotaLimit: "Límite",
  quotaRemaining: "Disponible",
  quotaUnlimited: "Sin límite",
  quotaDefaultUser: "Cuota predeterminada para nuevos usuarios",
  quotaUnassigned: "Uso en bases de datos fuera de los vaults gestionados",
  quotaStartupHelp:
    "La configuración de despliegue fija este límite. Modifícala y reinicia el panel para actualizarlo.",
  quotaMeasurementHelp:
    "La cuota cuenta el JSON de documentos sincronizados, sus adjuntos y conflictos activos en los vaults gestionados. El historial de CouchDB, índices y backups necesitan espacio adicional en disco.",
  quotaInput: "Cuota de espacio en GiB",
  quotaInputHelp:
    "1 GiB = 1.073.741.824 bytes. Los decimales se redondean al byte más cercano. Vacío o 0 significa sin límite. El límite de la instancia sigue aplicándose.",
  quotaInstanceCapacityHelp:
    "El espacio disponible también depende de la capacidad de la instancia.",
  quotaSave: "Guardar cuota",
  quotaExceeded:
    "Se ha alcanzado el límite de espacio. Se bloquean los datos nuevos que aumenten el uso. Un administrador puede revisar los límites de cuota.",
  quotaInvalid:
    "Introduce una cuota decimal en GiB mayor o igual a cero. Una cuota positiva debe ser de al menos un byte.",
  quotaAllocationExceeded:
    "La cuota del usuario no puede superar el límite de la instancia. Redúcela o amplía ese límite en la configuración de despliegue.",
  backupAuditUnavailable:
    "La solicitud de backup está en cola, pero no se pudo escribir su auditoría. Sigue el ID de solicitud que aparece abajo. No vuelvas a enviarla.",
  pending: "Pendiente",
  backupStale: "El último backup correcto supera la antigüedad máxima configurada.",
  backupMissing: "No se ha comunicado ningún backup correcto.",
  backupUnreadable:
    "El estado de backups no está disponible. Revisa el worker y el montaje de estado.",
  backupFailure: "El último intento falló. Los backups anteriores correctos siguen disponibles.",
  schedule: "Programación",
  timezone: "Zona horaria",
  retention: "Retención",
  days: "días",
  size: "Tamaño",
  error: "Error",
  upload: "Subida",
  notifications: "Notificaciones",
  restoreManual: "Guía de recuperación manual",
  restoreIntro:
    "Restaura únicamente en un entorno aislado. Este dashboard no ejecuta restauraciones.",
  restoreStep1:
    "Descarga y descifra un archivo en una máquina aislada con tu clave privada age offline. Revisa sus rutas antes de extraerlo.",
  restoreStep2:
    "Detén una instancia desechable de CouchDB de la misma versión. Extrae los datos en su volumen vacío y restaura la configuración CouchDB independiente.",
  restoreStep3:
    "Arranca solo CouchDB. Verifica usuarios, documentos, adjuntos, permisos, registro e identidades persistidas de los vaults.",
  restoreStep4:
    "Conecta un panel aislado y un cliente Obsidian desechable. Comprueba descifrado y sincronización sin reconstruir el remoto. Registra resultados antes de activar escrituras en producción.",
  archiveFailed: "Falló la creación del archivo.",
  uploadFailed: "Falló la subida del archivo cifrado.",
  retentionFailed: "Falló la retención de backups.",
  interrupted: "El backup se interrumpió.",
  workerFailed: "El worker falló.",
  passwordWrong:
    "La contraseña actual de sincronización es incorrecta. Inténtalo otra vez o pide a un administrador que inicie la recuperación.",
  securityDrift:
    "Los permisos de la base cambiaron fuera del dashboard. Pide a un administrador que los reconcilie antes de reintentar.",
  roleAccess:
    "La cuenta accede mediante roles de la base o permisos de administrador global. Retira esos permisos explícitamente antes de desactivar el acceso gestionado.",
  useAdoption: "La cuenta o base ya existe. Regístrala mediante adopción en lugar de crearla.",
  alreadyRegistered: "La identidad o base ya está registrada. Revisa la persona o vault existente.",
  confirmDisable:
    "¿Desactivar a esta persona? Sus dispositivos dejan de sincronizar hasta que la vuelvas a activar.",
  confirmReset:
    "¿Restablecer la contraseña de esta persona? Sus dispositivos dejan de sincronizar hasta que elija una nueva.",
  confirmDisconnect:
    "¿Desconectar Google Drive? Los backups diarios se detienen. Los existentes siguen en tu Drive.",
  invalidText: "Los nombres necesitan de 1 a 160 caracteres y ningún salto de línea.",
  missingField: "Rellena todos los campos. Cada valor admite hasta 1024 caracteres.",
  notFound: "Esta página o elemento no existe.",
  operationInProgress:
    "Otro cambio de esta persona sigue en curso. Vuelve a intentarlo en un momento.",
  adoptionValidation:
    "Esta base tiene su propia función validate_doc_update, que las escrituras de administrador del gateway saltarían. No se puede adoptar.",
  adoptionMissing: "CouchDB no tiene ninguna cuenta o base con ese nombre. Revisa ambos nombres.",
  vaultExists: "Ya tenías un vault con este nombre, así que se ha abierto en lugar de crear otro.",
  vaultLimit: "Has llegado al límite de 20 vaults. Pide otro vault a un administrador.",
  accountNoAccess:
    "La cuenta no tiene acceso a la base seleccionada. Revisa los permisos antes de adoptarla.",
  invalidRecovery:
    "Usa el recovery code existente con formato sls-id-v1 seguido de dos puntos y 64 caracteres hexadecimales en minúsculas.",
  missingSnapshot:
    "Falta la copia de permisos de acceso. Pide a un administrador que reconcilie el vault antes de restaurar el acceso.",
  retryForm: "Revisa el estado y recarga el formulario original antes de reintentar.",
  roles: "Roles",
  warnings: "Avisos de acceso",
  unrestrictedDatabase: "La base permite acceso sin restricciones a usuarios CouchDB.",
  memberRoles: "Roles de miembros",
  adminRoles: "Roles de administradores",
  accountMissing:
    "No se encontró esta cuenta CouchDB. Revisa el inventario y la configuración de cuentas.",
  invalidDatabase:
    "Usa un nombre de base que empiece por una letra minúscula y contenga solo minúsculas, números o signos admitidos por CouchDB.",
  invalidUsername:
    "Usa un usuario CouchDB con letras, números, puntos, guiones bajos, @ o guiones.",
  invalidLogin: "Introduce el login Tailscale exacto sin espacios.",
  reconcile: "Reconciliar propiedad de la base",
  confirmDatabase: "Escribe el nombre exacto de la base",
  reconcileHelp:
    "Comprueba que esta base vacía fue creada por esta operación del dashboard. Confirma su propiedad escribiendo el nombre exacto. No confirmes una base ajena a la operación.",
  ownershipUnknown:
    "El dashboard no puede demostrar la propiedad de la base tras una operación interrumpida. Revisa los vaults de la persona y reconcilia solo tras comprobar que la base vacía pertenece a esa operación.",
  unrestrictedAccess:
    "Esta base permite acceso sin restricciones. No se puede revocar acceso individual sin cerrar acceso a otros usuarios. Revisa sus permisos explícitamente antes de reintentar.",
  remoteVersionMissing:
    "El remoto existente no tiene información de versión LiveSync. Revisa su configuración desde un dispositivo ya configurado antes de añadir otro.",
  remoteIncompatible:
    "La versión LiveSync remota es incompatible con el dashboard. Revisa las versiones del plugin instalado y la compatibilidad del panel antes de configurar otro dispositivo.",
  remoteMigration:
    "El remoto requiere una migración LiveSync. Complétala desde un dispositivo ya configurado e inténtalo otra vez.",
  overview: "Resumen",
  people: "Personas",
  inventory: "Adoptar vaults existentes",
  backups: "Backups",
  events: "Actividad",
  owner: "Tus vaults",
  admin: "Administración",
  settings: "Preferencias",
  language: "Idioma",
  theme: "Tema",
  system: "Sistema",
  light: "Claro",
  dark: "Oscuro",
  signIn: "Tu identidad Tailscale no tiene acceso autorizado.",
  forbidden: "Acceso denegado",
  requestFailed:
    "No se pudo completar la solicitud. Comprueba el estado del servicio y vuelve a intentarlo.",
  errorTitle: "Algo ha fallado",
  invalid: "Revisa los campos e inténtalo otra vez.",
  csrf: "Este formulario ha caducado. Recarga la página e inténtalo otra vez.",
  name: "Nombre visible",
  username: "Usuario",
  database: "Base de datos",
  label: "Nombre del vault",
  createPerson: "Crear cuenta",
  loginOwner: "Iniciar sesión",
  logoutOwner: "Cerrar sesión",
  version: "Versión",
  confirmTitle: "¿Seguro?",
  confirmAction: "Continuar",
  changesSaved: "Cambios guardados.",
  vaultDeletedNotice: "Bóveda eliminada.",
  setupLeave:
    "No has descargado el archivo de configuración. La URI y las contraseñas desaparecen al salir de esta página.",
  leavePage: "Salir sin descargar",
  setupAgain: "Configurar otro dispositivo",
  setupQrShow: "Mostrar código QR",
  setupQrHide: "Ocultar código QR",
  setupQrExpand: "Ampliar",
  setupQrClose: "Cerrar",
  setupQrDistance:
    "Sitúa el móvil a 20-40 cm de la pantalla y sube el brillo si la cámara no reacciona.",
  setupQrTitle: "Escanéalo con el móvil",
  setupQrHelp:
    "Apunta la cámara del móvil al código para abrir la Setup URI en Obsidian y después introduce la contraseña de la Setup URI. Mantén el código privado, igual que la URI.",
  setupQrTooLong:
    "Esta Setup URI es demasiado larga para un código QR. Cópiala o usa el .txt descargado.",
  setupRestartConfirm:
    "¿Empezar de nuevo? La Setup URI actual y su contraseña desaparecen de esta página. Los dispositivos que ya la importaron siguen funcionando.",
  setupResultIntro: "Importa esta URI en Obsidian y sigue la indicación de abajo.",
  loginHelp:
    "Usa tu usuario y tu contraseña de sincronización. Si aún no has activado tu cuenta o necesitas recuperar acceso, pide una invitación al administrador.",
  activateOwner: "Activar cuenta",
  activationHelp:
    "Abre tu invitación y elige una contraseña. La usarás para entrar y sincronizar. Después podrás crear tus vaults.",
  inviteOwner: "Crear invitación",
  invitationHelp:
    "Envía este enlace privado al titular de la cuenta. Caduca en 24 horas, funciona una vez y sustituye las invitaciones anteriores. El usuario elige su contraseña.",
  invitationLink: "Enlace de invitación",
  invitationMeta: "Caduca en 24 horas · un solo uso",
  invitationCode: "Código de invitación",
  invitationInvalid: "La invitación caducó o ya se usó. Pide otra al administrador.",
  generateSecret: "Generar",
  exportSetup: "Descargar configuración .txt",
  exportAccount: "Descargar cuenta .txt",
  accountExportHelp:
    "Guarda tu usuario y contraseña antes de activar la cuenta. El .txt contiene tu contraseña en texto plano. Guárdalo en privado.",
  exportWarning:
    "Descarga el .txt antes de salir. Contiene tus contraseñas en texto plano. Guárdalo en privado. El panel no puede recuperarlo cuando cierres esta página.",
  syncPasswordHelp:
    "Usa la contraseña de tu cuenta. Cambiarla en la página de contraseña afecta a todos tus dispositivos.",
  existingEncryptionHelp:
    "Reutiliza la passphrase de tu configuración guardada o de un dispositivo existente. Otra no permitirá leer tus notas.",
  createVault: "Añadir vault",
  save: "Guardar",
  status: "Estado",
  empty: "Todavía no hay registros.",
  active: "Activa",
  disabled: "Desactivada",
  pending_credentials: "Contraseña pendiente",
  credential_reset: "Restablecimiento pendiente",
  disable: "Desactivar acceso",
  enable: "Restaurar acceso",
  reset: "Solicitar cambio de contraseña",
  details: "Gestionar",
  vaults: "Vaults",
  password: "Contraseña de sincronización",
  currentPassword: "Contraseña actual de sincronización",
  newPassword: "Nueva contraseña de sincronización",
  confirmPassword: "Confirmar contraseña",
  passwordHelp:
    "Elige la contraseña de tu cuenta. Si la cambias, actualízala en Obsidian en todos tus dispositivos.",
  changePassword: "Cambiar contraseña",
  passwordsDiffer: "Las contraseñas no coinciden.",
  passwordMin: "Usa una contraseña de al menos 12 caracteres.",
  setup: "Configurar dispositivo",
  setupTitle: "Configurar un dispositivo",
  setupHelp:
    "En un vault nuevo, la passphrase de cifrado ya está lista. Introduce tu contraseña de sincronización y genera la configuración. Para un vault existente, reutiliza su passphrase.",
  e2e: "Passphrase de cifrado del vault",
  uriPassphrase: "Contraseña de la Setup URI",
  generate: "Generar Setup URI",
  copy: "Copiar",
  setupExpiry:
    "La caducidad limita la importación de esta URI. No revoca acceso en dispositivos configurados.",
  recovery: "Recovery code existente",
  recoveryMissing:
    "Este vault no tiene recovery code, así que el panel no puede generar URIs de configuración. Los dispositivos existentes siguen sincronizando. Pega el recovery code de un dispositivo que ya sincroniza este vault.",
  recoverySave: "Guardar recovery code",
  recoveryAdd: "Añadir recovery code",
  recoveryConflict:
    "Este vault ya tiene un recovery code distinto. El panel nunca reemplaza una identidad de vault guardada.",
  adoptionHelp:
    "Registra recursos existentes sin cambiar nombres, contraseñas ni miembros autorizados. La adopción instala un control de escritura. Cambia los clientes al gateway de cuotas antes de adoptar; las escrituras directas a CouchDB se rechazarán.",
  preview: "Previsualizar registro",
  adopt: "Registrar vault existente",
  technical: "Cuentas técnicas",
  accounts: "Cuentas",
  security: "Permisos de las bases",
  healthy: "Conectado",
  unhealthy: "No disponible",
  couchdb: "CouchDB",
  registry: "Registro del dashboard",
  unavailable: "Sin configurar",
  requestBackup: "Solicitar backup",
  backupHelp:
    "El worker independiente ejecuta las solicitudes. Una solicitud no es un backup completado.",
  lastSuccess: "Último éxito",
  lastAttempt: "Último intento",
  operation: "Operación",
  actor: "Actor",
  date: "Fecha",
  result: "Resultado",
  next: "Página siguiente",
  back: "Volver",
  requestId: "ID de solicitud",
  readiness: "Disponibilidad del servicio",
  loading: "Procesando…",
  welcome: "Tus vaults sincronizados.",
  ownerIntro:
    "Establece tu contraseña y configura cada dispositivo con los ajustes cifrados de tus vaults.",
  inventoryIntro: "Revisa las cuentas existentes y sus accesos antes de registrarlas.",
  ok: "Guardado",
  copied: "Copiado",
  setupUri: "Setup URI",
  setupWorking: "Generando en este dispositivo…",
  setupMismatch: "Las passphrases de cifrado deben coincidir.",
  setupCredentials:
    "Contraseña de sincronización incorrecta. Usa la que elegiste para tu cuenta o cámbiala en la página de contraseña.",
  setupSession: "Tu sesión caducó. Inicia sesión otra vez y vuelve a abrir este vault.",
  setupTooMany: "Demasiados intentos. Espera un minuto y vuelve a intentarlo.",
  setupExportTitle: "Configuración LiveSync. Archivo privado con contraseñas en texto plano.",
  setupEncryption: "Passphrase de cifrado del vault",
  setupExpires: "Utilizable hasta",
  setupPersistent:
    "URI persistente. Las credenciales importadas siguen válidas hasta revocar el acceso.",
  setupGenerated: "Configuración lista. Descarga el .txt antes de salir de esta página.",
  setupNewDevice:
    "El panel ya ha preparado este remoto vacío. En este primer dispositivo, LiveSync puede descargar desde el remoto (fetch) o reconstruirlo con las notas de este dispositivo (rebuild); ambas opciones funcionan. Las notas que ya tenga el dispositivo se suben en los dos casos.",
  setupAdditionalDevice:
    "Esta bóveda ya tiene datos. Reutiliza la clave de cifrado de tus otros dispositivos, acepta los ajustes del remoto y descarga desde el remoto (fetch). Nunca reconstruyas ni sobrescribas el remoto.",
  accountExportTitle: "Cuenta LiveSync. Archivo privado con contraseña en texto plano.",
  setupError: "No se pudo generar la URI. Revisa los campos y vuelve a intentarlo.",
  managed: "Acceso gestionado",
  unknownRecovery:
    "Falta el recovery code. Obtenlo desde un dispositivo ya configurado antes de generar una URI.",
  sensitive: "El dashboard no almacena las contraseñas introducidas aquí.",
  expiry: "Caduca",
  initial: "Configuración inicial",
  e2eConfirm: "Confirmar passphrase de cifrado del vault",
  uriMode: "Tipo de Setup URI",
  ephemeral: "URI temporal",
  persistent: "URI persistente",
  generatedPassword: "Contraseña de la Setup URI",
  uriModeHelp:
    "Las URIs temporales caducan. Las persistentes permiten importar mientras sus credenciales sigan vigentes.",
  running: "En ejecución",
  success: "Éxito",
  failure: "Fallo",
  provisioning: "Preparando",
  documents: "Documentos",
  storage: "Almacenamiento",
  methodDenied: "Esta acción no está permitida.",
  tooMany: "Demasiadas solicitudes. Espera un minuto e inténtalo otra vez.",
  tooLarge: "El formulario es demasiado grande.",
  unsupported: "Este formato de formulario no está permitido.",
};
export type Locale = "en" | "es";
// Messages the browser scripts need. Pages embed them as JSON for the current locale.
export const clientMessages = [
  "copied",
  "vaultArchiveDownloading",
  "vaultArchiveReady",
  "vaultArchiveFailed",
  "showPassword",
  "hidePassword",
  "setupError",
  "setupWorking",
  "setupMismatch",
  "setupCredentials",
  "setupSession",
  "setupTooMany",
  "setupExportTitle",
  "setupEncryption",
  "setupExpires",
  "setupPersistent",
  "setupGenerated",
  "setupNewDevice",
  "setupAdditionalDevice",
  "accountExportTitle",
  "confirmAction",
  "setupLeave",
  "leavePage",
  "setupRestartConfirm",
  "recoveryKeyFileTitle",
  "recoveryKeyCreated",
  "recoveryKeyFailed",
  "restoreNoFile",
  "restoreNoKey",
  "restoreReading",
  "restoreOpened",
  "restoreEmpty",
  "restorePassphrase",
  "restoreNotEncrypted",
  "restoreChecking",
  "restoreBuilding",
  "restoreDone",
  "restoreRawDone",
  "restoreWrongKey",
  "restoreWrongPassphrase",
  "restoreMissingSalt",
  "restoreUnsupported",
  "restoreMissingChunk",
  "restoreInvalid",
] as const satisfies readonly MessageKey[];
export type ClientMessage = (typeof clientMessages)[number];
export function translate(locale: Locale, key: MessageKey): string {
  return (locale === "es" ? es : en)[key];
}
export function resolveLocale(cookie: string | undefined): Locale {
  return cookie === "es" ? "es" : "en";
}
