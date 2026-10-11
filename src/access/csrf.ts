const encoder = new TextEncoder();
export class Csrf {
  private key: Promise<CryptoKey>;
  constructor(
    secret: string,
    private readonly maxAgeMs: number,
  ) {
    this.key = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }
  async issue(actor: string, surface: string): Promise<string> {
    const payload = `${Date.now()}.${crypto.randomUUID()}`;
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await this.key,
        encoder.encode(`${surface}\n${actor}\n${payload}`),
      ),
    );
    return `${payload}.${Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    )}`;
  }
  async verify(token: string, actor: string, surface: string): Promise<boolean> {
    const parts = token.split(".");
    if (parts.length !== 3 || !/^\d+$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[2])) {
      return false;
    }
    const age = Date.now() - Number(parts[0]);
    if (age < 0 || age > this.maxAgeMs) return false;
    const signature = new Uint8Array(parts[2].match(/../g)!.map((part) => parseInt(part, 16)));
    return await crypto.subtle.verify(
      "HMAC",
      await this.key,
      signature,
      encoder.encode(`${surface}\n${actor}\n${parts[0]}.${parts[1]}`),
    );
  }
}
