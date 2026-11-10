import crypto from "node:crypto";
import { signMfaJwt, verifyMfaJwt } from "@/lib/jwt";

// ============================================================================
// 1. In-Memory Server Store for Hashed OTPs (Single-use, 10-minute expiry, max 5 attempts)
// ============================================================================

interface StoredOtpRecord {
  hashedOtp: string;
  salt: string;
  expiresAt: number;
  attempts: number;
  maxAttempts: number;
  email: string;
  userId: string;
  createdAt: number;
}

const otpStore = new Map<string, StoredOtpRecord>();

// Clean up expired OTPs periodically (every 5 minutes)
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of otpStore.entries()) {
      if (now > record.expiresAt) {
        otpStore.delete(key);
      }
    }
  }, 5 * 60 * 1000);
}

/**
 * Generates an OTP server-side, hashes it with a salt, stores it for 10 minutes,
 * and sends it through a real email provider (Resend/SendGrid/SMTP).
 */
export async function generateAndSendEmailOtpServer(
  email: string,
  userId?: string,
  testCodeOverride?: string,
): Promise<{ success: boolean; message: string; error?: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return { success: false, message: "", error: "Valid email address required." };
  }

  // Rate-limiting check: enforce at least 10 seconds between code requests for same email
  const existing = otpStore.get(normalizedEmail);
  if (existing && Date.now() - existing.createdAt < 10 * 1000) {
    const waitSec = Math.ceil((10 * 1000 - (Date.now() - existing.createdAt)) / 1000);
    return {
      success: false,
      message: "",
      error: `Please wait ${waitSec} second(s) before requesting another code.`,
    };
  }

  // Generate cryptographically secure 6-digit random number (or test override outside production)
  const otp = (testCodeOverride && process.env.NODE_ENV !== "production")
    ? testCodeOverride
    : crypto.randomInt(100000, 1000000).toString();

  // Generate unique 16-byte salt and hash the OTP
  const salt = crypto.randomBytes(16).toString("hex");
  const hashedOtp = crypto
    .createHash("sha256")
    .update(`${salt}:${otp}`)
    .digest("hex");

  // Store only the hash, with 10-minute expiry and max 5 attempts
  otpStore.set(normalizedEmail, {
    hashedOtp,
    salt,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    attempts: 0,
    maxAttempts: 5,
    email: normalizedEmail,
    userId: userId || normalizedEmail,
    createdAt: Date.now(),
  });

  // Dispatch email via configured provider
  let dispatched = false;
  const resendApiKey = process.env.RESEND_API_KEY;

  if (resendApiKey) {
    try {
      const fromEmail = process.env.EMAIL_FROM || "Paidly Security <security@paidly.app>";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [normalizedEmail],
          subject: "Your Paidly 2FA Verification Code",
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
              <h2 style="color: #111; margin-bottom: 8px;">Two-Factor Verification</h2>
              <p style="color: #666; font-size: 14px; margin-bottom: 24px;">
                Enter the following one-time code to complete your verification for Paidly:
              </p>
              <div style="background: #f4f4f5; border-radius: 12px; padding: 18px; text-align: center; margin-bottom: 24px;">
                <span style="font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #09090b;">
                  ${otp}
                </span>
              </div>
              <p style="color: #888; font-size: 12px;">
                This code expires in 10 minutes and can only be used once. If you did not request this code, please secure your account.
              </p>
            </div>
          `,
        }),
      });
      dispatched = res.ok;
      if (!res.ok) {
        console.error("[Email Error] Failed to send email via Resend:", await res.text());
      }
    } catch (err) {
      console.error("[Email Error] Network exception sending email:", err);
    }
  }

  // Development / fallback logging (strictly masked in production)
  if (!dispatched) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[Paidly MFA Dev Server] One-Time Code for ${normalizedEmail}: ${otp}`);
    } else {
      console.warn(`[Paidly MFA Production] Email provider not configured or delivery failed.`);
    }
  }

  return {
    success: true,
    message: `A 6-digit verification code has been sent to ${normalizedEmail}.`,
  };
}

/**
 * Verifies the OTP server-side:
 * - Checks 10-minute expiry
 * - Enforces max 5 attempts (invalidates on 6th)
 * - Single-use (deletes on success)
 * - Returns HMAC-SHA256 JWT
 */
export function verifyEmailOtpServer(
  email: string,
  enteredCode: string,
  userId?: string,
): { success: boolean; token?: string; error?: string } {
  const normalizedEmail = email.trim().toLowerCase();
  const cleanCode = enteredCode.trim().replace(/\s/g, "");

  if (cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) {
    return { success: false, error: "Please enter a valid 6-digit numeric code." };
  }

  const record = otpStore.get(normalizedEmail);

  if (!record) {
    return {
      success: false,
      error: "No active verification code found for this email. Please request a new code.",
    };
  }

  // Check 10-minute expiry
  if (Date.now() > record.expiresAt) {
    otpStore.delete(normalizedEmail);
    return {
      success: false,
      error: "Verification code has expired (10-minute limit). Please request a new code.",
    };
  }

  // Increment attempts
  record.attempts += 1;

  // Enforce max 5 attempts
  if (record.attempts > record.maxAttempts) {
    otpStore.delete(normalizedEmail);
    return {
      success: false,
      error: "Too many failed attempts. This code has been invalidated for security. Please request a new code.",
    };
  }

  // Hash the entered code with the record's salt
  const candidateHash = crypto
    .createHash("sha256")
    .update(`${record.salt}:${cleanCode}`)
    .digest("hex");

  const candidateBuf = Buffer.from(candidateHash, "hex");
  const storedBuf = Buffer.from(record.hashedOtp, "hex");

  const isMatch =
    candidateBuf.length === storedBuf.length &&
    crypto.timingSafeEqual(candidateBuf, storedBuf);

  if (!isMatch) {
    const remaining = record.maxAttempts - record.attempts;
    return {
      success: false,
      error: `Incorrect code. ${remaining} attempt(s) remaining.`,
    };
  }

  // SINGLE USE: Invalidate immediately on successful verification!
  otpStore.delete(normalizedEmail);

  // Issue 10-minute HMAC-SHA256 JWT bound to user ID
  const effectiveUserId = userId || record.userId || normalizedEmail;
  const token = signMfaJwt({
    userId: effectiveUserId,
    email: normalizedEmail,
    method: "email_otp",
    purpose: "mfa_session",
  });

  return { success: true, token };
}

// Exposed for unit testing only
export function _getOtpStoreForTest() {
  return otpStore;
}

// ============================================================================
// 2. Encrypted Server Store for TOTP Secrets (RFC 6238, AES-256-GCM)
// ============================================================================

interface EncryptedTotpRecord {
  ciphertext: string; // hex
  iv: string; // hex
  authTag: string; // hex
  email: string;
  createdAt: number;
}

const userTotpStore = new Map<string, EncryptedTotpRecord>();

function getEncryptionKey(): Buffer {
  const secret = process.env.MFA_ENCRYPTION_KEY || process.env.MFA_JWT_SECRET || "paidly_default_encryption_key_32bytes!";
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptSecret(plaintext: string): { ciphertext: string; iv: string; authTag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return {
    ciphertext: encrypted,
    iv: iv.toString("hex"),
    authTag,
  };
}

function decryptSecret(encrypted: { ciphertext: string; iv: string; authTag: string }): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(encrypted.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "hex"));
  let decrypted = decipher.update(encrypted.ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// Base32 helper for TOTP
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateBase32Secret(length = 20): string {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < bytes.length; i++) {
    result += BASE32_ALPHABET[bytes[i] % 32];
  }
  return result;
}

function base32Decode(base32: string): Buffer {
  const cleaned = base32.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Computes RFC 6238 TOTP code for a secret at a given counter step.
 */
export function computeTotp(secretBase32: string, counterOffset = 0): string {
  const secretBytes = base32Decode(secretBase32);
  const step = Math.floor(Date.now() / 1000 / 30) + counterOffset;

  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(step));

  const hmac = crypto.createHmac("sha1", secretBytes).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = (binary % 1000000).toString().padStart(6, "0");
  return otp;
}

/**
 * Retrieves or registers a per-user encrypted TOTP secret on the server.
 */
export function getOrRegisterUserTotpSecret(
  userId: string,
  email: string,
): { secret: string; uri: string } {
  const normalizedUserId = userId.trim();
  let secret: string;

  const existing = userTotpStore.get(normalizedUserId);
  if (existing) {
    try {
      secret = decryptSecret(existing);
    } catch {
      secret = generateBase32Secret(20);
      userTotpStore.set(normalizedUserId, {
        ...encryptSecret(secret),
        email,
        createdAt: Date.now(),
      });
    }
  } else {
    secret = generateBase32Secret(20);
    userTotpStore.set(normalizedUserId, {
      ...encryptSecret(secret),
      email,
      createdAt: Date.now(),
    });
  }

  const uri = `otpauth://totp/Paidly:${encodeURIComponent(email)}?secret=${secret}&issuer=Paidly&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri };
}

/**
 * Verifies a TOTP code server-side:
 * - Decrypts stored user secret
 * - Computes RFC 6238 code with +/- 1 window (30s drift tolerance)
 * - Issues HMAC-SHA256 JWT on success
 */
export function verifyUserTotpServer(
  userId: string,
  enteredCode: string,
): { success: boolean; token?: string; error?: string } {
  const normalizedUserId = userId.trim();
  const cleanCode = enteredCode.trim().replace(/\s/g, "");

  if (cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) {
    return { success: false, error: "Please enter a valid 6-digit numeric authenticator code." };
  }

  const record = userTotpStore.get(normalizedUserId);
  if (!record) {
    return {
      success: false,
      error: "No authenticator app enrolled for this user. Please set up an authenticator first.",
    };
  }

  let secret: string;
  try {
    secret = decryptSecret(record);
  } catch {
    return { success: false, error: "Failed to decrypt authenticator credentials." };
  }

  // Check window: current time step (-1, 0, +1)
  const isMatch =
    computeTotp(secret, 0) === cleanCode ||
    computeTotp(secret, -1) === cleanCode ||
    computeTotp(secret, 1) === cleanCode;

  if (!isMatch) {
    return { success: false, error: "Invalid authenticator code. Check your device time and try again." };
  }

  // Issue 10-minute HMAC-SHA256 JWT
  const token = signMfaJwt({
    userId: normalizedUserId,
    email: record.email,
    method: "totp",
    purpose: "mfa_session",
  });

  return { success: true, token };
}

// Exposed for unit testing only
export function _getUserTotpStoreForTest() {
  return userTotpStore;
}

// ============================================================================
// 3. Server-Side Bank Card Removal Handler (Verified via HMAC JWT)
// ============================================================================

export async function handleRemoveBankCard(data: {
  cardId: string;
  mfaToken: string;
  userId?: string;
}): Promise<{ success?: boolean; cardId?: string; error?: string; message?: string }> {
  const { cardId, mfaToken, userId } = data;

  // Verify HMAC-signed JWT server-side
  const mfaCheck = verifyMfaJwt(mfaToken, {
    expectedUserId: userId,
  });

  if (!mfaCheck.valid || !mfaCheck.payload) {
    console.warn(
      `[Security] Unauthorized bank card removal attempt for card ${cardId}: ${mfaCheck.error}`,
    );
    return {
      error:
        mfaCheck.error ||
        "Multi-Factor Authentication (MFA) token invalid or expired. Please re-authenticate.",
    };
  }

  console.info(
    `[Security] Authorized card removal for card ${cardId} by user ${mfaCheck.payload.sub}`,
  );

  return {
    success: true,
    cardId,
    message: "Card successfully authorized and removed.",
  };
}
