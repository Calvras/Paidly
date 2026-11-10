import {
  sendEmailOtpFn,
  verifyEmailOtpFn,
  getTotpSetupFn,
  verifyTotpFn,
} from "@/lib/mfa-api";

export type MfaMethod = "email_otp" | "totp";

export interface MfaSessionData {
  isVerified: boolean;
  token: string | null;
  method: MfaMethod | null;
  verifiedAt: number | null;
}

const STORAGE_KEY_TOKEN = "paidly_mfa_jwt_token";
const STORAGE_KEY_METHOD = "paidly_mfa_method";
const STORAGE_KEY_TIMESTAMP = "paidly_mfa_timestamp";

// ============================================================================
// Client-side Token & Session Management
// ============================================================================

export function getMfaSession(): MfaSessionData {
  if (typeof window === "undefined") {
    return { isVerified: false, token: null, method: null, verifiedAt: null };
  }
  try {
    const token = localStorage.getItem(STORAGE_KEY_TOKEN);
    const method = localStorage.getItem(STORAGE_KEY_METHOD) as MfaMethod | null;
    const rawTs = localStorage.getItem(STORAGE_KEY_TIMESTAMP);
    const verifiedAt = rawTs ? parseInt(rawTs, 10) : null;

    if (!token || !verifiedAt) {
      return { isVerified: false, token: null, method: null, verifiedAt: null };
    }

    // 10-minute client-side expiry check
    if (Date.now() - verifiedAt > 10 * 60 * 1000) {
      clearMfaSession();
      return { isVerified: false, token: null, method: null, verifiedAt: null };
    }

    return { isVerified: true, token, method, verifiedAt };
  } catch {
    return { isVerified: false, token: null, method: null, verifiedAt: null };
  }
}

export function isMfaVerified(maxAgeMs = 10 * 60 * 1000): boolean {
  const session = getMfaSession();
  if (!session.isVerified || !session.verifiedAt) return false;
  return Date.now() - session.verifiedAt <= maxAgeMs;
}

export function setMfaSession(token: string, method: MfaMethod): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_TOKEN, token);
    localStorage.setItem(STORAGE_KEY_METHOD, method);
    localStorage.setItem(STORAGE_KEY_TIMESTAMP, Date.now().toString());
  } catch {}
}

export function clearMfaSession(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY_TOKEN);
    localStorage.removeItem(STORAGE_KEY_METHOD);
    localStorage.removeItem(STORAGE_KEY_TIMESTAMP);
  } catch {}
}

// ============================================================================
// Client-side Helpers triggering Server Functions (Zero client-side bypass)
// ============================================================================

/**
 * Triggers server-side OTP generation and email dispatch.
 */
export async function requestServerEmailOtp(
  email: string,
  userId?: string,
): Promise<{ success: boolean; message: string; error?: string }> {
  try {
    const res = await sendEmailOtpFn({
      data: { email, userId },
    });
    return res;
  } catch (err: any) {
    return {
      success: false,
      message: "",
      error: err?.message || "Failed to contact MFA server.",
    };
  }
}

/**
 * Verifies OTP strictly on the server; returns server-issued HMAC JWT.
 */
export async function verifyServerEmailOtp(
  email: string,
  code: string,
  userId?: string,
): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const res = await verifyEmailOtpFn({
      data: { email, code, userId },
    });
    if (res.success && res.token) {
      setMfaSession(res.token, "email_otp");
    }
    return res;
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "Failed to verify code on server.",
    };
  }
}

/**
 * Retrieves per-user encrypted TOTP setup from the server.
 */
export async function getServerTotpSetup(
  userId: string,
  email: string,
): Promise<{ secret: string; uri: string }> {
  return await getTotpSetupFn({
    data: { userId, email },
  });
}

/**
 * Verifies user TOTP code strictly on the server; returns server-issued HMAC JWT.
 */
export async function verifyServerTotp(
  userId: string,
  code: string,
): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const res = await verifyTotpFn({
      data: { userId, code },
    });
    if (res.success && res.token) {
      setMfaSession(res.token, "totp");
    }
    return res;
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "Failed to verify authenticator code on server.",
    };
  }
}
