const encoder = new TextEncoder();

export interface ResponseIdPayload {
  keyId: string;
  expiresAt: number;
  nonce: string;
}

export class ResponseIdError extends Error {
  constructor(readonly code: "malformed" | "expired" | "bad_signature" | "unknown_key") {
    super(code);
    this.name = "ResponseIdError";
  }
}

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function signingInput(keyId: string, expiresAt: number, nonce: string): string {
  return [keyId, String(expiresAt), nonce].join(".");
}

export async function createResponseId(options: {
  secret: string;
  keyId?: string;
  ttlSeconds: number;
  now?: number;
}): Promise<string> {
  const keyId = options.keyId ?? "v1";
  const now = options.now ?? Date.now();
  const expiresAt = Math.floor(now / 1000) + options.ttlSeconds;
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const key = await importKey(options.secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signingInput(keyId, expiresAt, nonce)),
  );
  return ["resp", keyId, String(expiresAt), nonce, base64Url(signature)].join(".");
}

export async function verifyResponseId(options: {
  id: string;
  secrets: Record<string, string>;
  now?: number;
}): Promise<ResponseIdPayload> {
  const parts = options.id.split(".");
  if (parts.length !== 5 || parts[0] !== "resp") throw new ResponseIdError("malformed");
  const [, keyId, expiresAtRaw, nonce, signatureRaw] = parts;
  if (!keyId || !expiresAtRaw || !nonce || !signatureRaw) throw new ResponseIdError("malformed");
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isInteger(expiresAt) || expiresAt <= 0) throw new ResponseIdError("malformed");
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  if (expiresAt < nowSeconds) throw new ResponseIdError("expired");
  const secret = options.secrets[keyId];
  if (!secret) throw new ResponseIdError("unknown_key");
  const key = await importKey(secret);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    decodeBase64Url(signatureRaw),
    encoder.encode(signingInput(keyId, expiresAt, nonce)),
  );
  if (!ok) throw new ResponseIdError("bad_signature");
  return { keyId, expiresAt, nonce };
}
