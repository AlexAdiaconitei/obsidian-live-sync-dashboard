import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { open, stat } from "node:fs/promises";
import type { Readable } from "node:stream";
import { ServiceError } from "../contracts.ts";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_FOLDER = "obsidian-livesync-backups";
export interface DriveFolder {
  id: string;
  name: string;
}
export interface DrivePickerSession {
  accessToken: string;
  apiKey: string;
  appId: string;
}
export interface DriveConfig {
  clientId: string;
  clientSecret: string;
  tokenKey: string;
  redirectUri: string;
  workDir: string;
  picker?: { apiKey: string; appId: string };
}

export class TokenCipher {
  private key: Buffer;
  constructor(key: string) {
    this.key = Buffer.from(key, "base64");
    if (this.key.length !== 32) throw new Error("Invalid Google token encryption key");
  }
  seal(value: string, owner: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(owner));
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
  }
  open(value: string, owner: string): string {
    const data = Buffer.from(value, "base64");
    const cipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, 12));
    cipher.setAAD(Buffer.from(owner));
    cipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8");
  }
}

export class GoogleDrive {
  constructor(
    private config: DriveConfig,
    private fetcher: typeof fetch = fetch,
  ) {}

  authorization(state: string, verifier: string): string {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: DRIVE_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    return url.href;
  }

  private async json(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const response = await this.fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ServiceError("drive_request_failed", 503);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  private async token(fields: Record<string, string>) {
    return this.json("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        ...fields,
      }),
    });
  }
  async exchange(code: string, verifier: string): Promise<string> {
    const token = await this.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: verifier,
    });
    if (
      typeof token.refresh_token !== "string" ||
      typeof token.scope !== "string" ||
      !token.scope.split(" ").includes(DRIVE_SCOPE)
    ) {
      throw new ServiceError("drive_consent_required", 400);
    }
    return token.refresh_token;
  }
  async access(refreshToken: string): Promise<string> {
    const token = await this.token({ grant_type: "refresh_token", refresh_token: refreshToken });
    if (typeof token.access_token !== "string") throw new ServiceError("drive_request_failed", 503);
    return token.access_token;
  }
  async revoke(token: string): Promise<void> {
    const response = await this.fetcher("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      body: new URLSearchParams({ token }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel();
    if (!response.ok && response.status !== 400)
      throw new ServiceError("drive_request_failed", 503);
  }
  private headers(token: string) {
    return { authorization: `Bearer ${token}`, "content-type": "application/json" };
  }
  async folder(token: string): Promise<string> {
    const result = await this.json("https://www.googleapis.com/drive/v3/files?fields=id", {
      method: "POST",
      headers: this.headers(token),
      body: JSON.stringify({
        name: DRIVE_FOLDER,
        mimeType: "application/vnd.google-apps.folder",
        appProperties: { application: "obsidian-livesync-dashboard" },
      }),
    });
    if (typeof result.id !== "string" || !/^[\w-]+$/.test(result.id))
      throw new ServiceError("drive_request_failed", 503);
    return result.id;
  }
  async folderInfo(token: string, id: string): Promise<DriveFolder> {
    if (!/^[\w-]{1,256}$/.test(id)) throw new ServiceError("invalid_drive_folder", 400);
    const result = await this.json(
      `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,trashed,ownedByMe,capabilities(canAddChildren)`,
      {
        headers: this.headers(token),
      },
    );
    const capabilities = result.capabilities as Record<string, unknown> | undefined;
    if (
      result.id !== id ||
      typeof result.name !== "string" ||
      !result.name ||
      result.mimeType !== "application/vnd.google-apps.folder" ||
      result.trashed !== false ||
      result.ownedByMe !== true ||
      capabilities?.canAddChildren !== true
    ) {
      throw new ServiceError("invalid_drive_folder", 400);
    }
    return { id, name: result.name };
  }
  async upload(
    token: string,
    folder: string,
    owner: string,
    filename: string,
    path: string,
  ): Promise<void> {
    const size = (await stat(path)).size;
    const response = await this.fetcher(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
      {
        method: "POST",
        headers: {
          ...this.headers(token),
          "x-upload-content-type": "application/octet-stream",
          "x-upload-content-length": String(size),
        },
        body: JSON.stringify({
          name: filename,
          parents: [folder],
          appProperties: {
            application: "obsidian-livesync-dashboard",
            owner,
            format: "personal-v1",
          },
        }),
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      },
    );
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!response.ok || !location) throw new ServiceError("drive_upload_failed", 503);
    const target = new URL(location);
    if (
      target.origin !== "https://www.googleapis.com" ||
      !target.pathname.startsWith("/upload/drive/")
    )
      throw new ServiceError("drive_upload_failed", 503);
    const file = await open(path, "r");
    try {
      for (let offset = 0; offset < size;) {
        const chunk = Buffer.alloc(Math.min(8 * 1024 * 1024, size - offset));
        const { bytesRead } = await file.read(chunk, 0, chunk.length, offset);
        if (bytesRead !== chunk.length) throw new ServiceError("drive_upload_failed", 503);
        const end = offset + bytesRead;
        const uploaded = await this.fetcher(target, {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/octet-stream",
            "content-range": `bytes ${offset}-${end - 1}/${size}`,
          },
          body: chunk,
          redirect: "error",
          signal: AbortSignal.timeout(120_000),
        });
        await uploaded.body?.cancel();
        if (
          end < size
            ? uploaded.status !== 308 || uploaded.headers.get("range") !== `bytes=0-${end - 1}`
            : !uploaded.ok
        ) {
          throw new ServiceError("drive_upload_failed", 503);
        }
        offset = end;
      }
    } finally {
      await file.close();
    }
  }
  async retention(token: string, folder: string, owner: string, days: number): Promise<void> {
    const before = new Date(Date.now() - days * 86400_000).toISOString();
    let pageToken = "";
    do {
      const q = `'${folder}' in parents and trashed = false and createdTime < '${before}' and appProperties has { key='application' and value='obsidian-livesync-dashboard' } and appProperties has { key='owner' and value='${owner}' } and appProperties has { key='format' and value='personal-v1' }`;
      const query = new URLSearchParams({
        q,
        fields: "nextPageToken,files(id)",
        pageSize: "100",
        pageToken,
      });
      const result = await this.json(`https://www.googleapis.com/drive/v3/files?${query}`, {
        headers: this.headers(token),
      });
      if (!Array.isArray(result.files)) throw new ServiceError("drive_retention_failed", 503);
      for (const file of result.files) {
        if (!file || typeof file.id !== "string" || !/^[\w-]+$/.test(file.id))
          throw new ServiceError("drive_retention_failed", 503);
        await this.json(`https://www.googleapis.com/drive/v3/files/${file.id}?fields=id`, {
          method: "PATCH",
          headers: this.headers(token),
          body: JSON.stringify({ trashed: true }),
        });
      }
      pageToken = typeof result.nextPageToken === "string" ? result.nextPageToken : "";
    } while (pageToken);
  }
}

export type ArchiveWriter = (source: Readable, recipient: string, path: string) => Promise<void>;
