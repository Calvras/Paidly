import crypto from "node:crypto";

export interface MfaJwtPayload {
  sub: string;
  email: string;
  method: "email_otp" | "totp";
  purpose: "mfa_session" | "mfa_sensitive_action";
  iat: number;
  exp: number;
}

const DEFAULT_DEV_SECRET = "paidly_mfa_dev_secret_key_minimum_32_bytes_2026!";

export function getMfaJwtSecret(): string {
  const secret = process.env.MFA_JWT_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[Security] MFA_JWT_SECRET environment variable must be set in production.",
      );
    }
    return DEFAULT_DEV_SECRET;
  }
  return secret;
}

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(input: string): string {
  let str = input.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4 !== 0) {
    str += "=";
  }
  return Buffer.from(str, "base64").toString("utf-8");
}

/**
 * Signs an HMAC-SHA256 JWT with strict 10-minute expiry bound to the user id.
 */
export function signMfaJwt(params: {
  userId: string;
  email: string;
  method: "email_otp" | "totp";
  purpose?: "mfa_session" | "mfa_sensitive_action";
  customSecret?: string;
  ttlSeconds?: number;
}): string {
  const secret = params.customSecret || getMfaJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const ttl = params.ttlSeconds || 10 * 60; // strictly 10 minutes default

  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const payload: MfaJwtPayload = {
    sub: params.userId,
    email: params.email,
    method: params.method,
    purpose: params.purpose || "mfa_session",
    iat: now,
    exp: now + ttl,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac("sha256", secret)
    .update(unsignedToken)
    .digest();

  const encodedSignature = base64UrlEncode(signature);
  return `${unsignedToken}.${encodedSignature}`;
}

/**
 * Verifies an HMAC-SHA256 JWT: checks format, signature, expiration, and optional user binding.
 */
export function verifyMfaJwt(
  token?: string | null,
  options?: {
    expectedUserId?: string;
    customSecret?: string;
  },
): {
  valid: boolean;
  payload?: MfaJwtPayload;
  error?: string;
} {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "MFA token is missing or empty." };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "Invalid JWT format." };
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  try {
    const headerStr = base64UrlDecode(encodedHeader);
    const header = JSON.parse(headerStr);
    if (header.alg !== "HS256" || header.typ !== "JWT") {
      return { valid: false, error: "Unsupported algorithm or token type." };
    }

    const payloadStr = base64UrlDecode(encodedPayload);
    const payload: MfaJwtPayload = JSON.parse(payloadStr);

    // Verify HMAC-SHA256 signature using timing-safe comparison
    const secret = options?.customSecret || getMfaJwtSecret();
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(unsignedToken)
      .digest();

    let providedSignatureBuf: Buffer;
    try {
      let b64 = encodedSignature.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4 !== 0) b64 += "=";
      providedSignatureBuf = Buffer.from(b64, "base64");
    } catch {
      return { valid: false, error: "Malformed token signature." };
    }

    if (
      providedSignatureBuf.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(providedSignatureBuf, expectedSignature)
    ) {
      return { valid: false, error: "Invalid token signature." };
    }

    // Check expiration (exp in seconds)
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      return { valid: false, error: "MFA token has expired (10-minute limit exceeded)." };
    }

    // Check not before / issued in future
    if (payload.iat > now + 60) {
      return { valid: false, error: "Token issued in the future." };
    }

    // Check bound user ID if expected
    if (options?.expectedUserId && payload.sub !== options.expectedUserId) {
      return { valid: false, error: "Token user ID does not match expected session." };
    }

    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: "Invalid token format or parsing error." };
  }
}
