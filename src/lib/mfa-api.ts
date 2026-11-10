import { createServerFn } from "@tanstack/react-start";
import {
  generateAndSendEmailOtpServer,
  verifyEmailOtpServer,
  getOrRegisterUserTotpSecret,
  verifyUserTotpServer,
  handleRemoveBankCard,
} from "@/lib/mfa-server";

/**
 * 1. Generate & Send Email OTP Server Function
 */
export const sendEmailOtpFn = createServerFn({ method: "POST" })
  .validator((data: { email: string; userId?: string }) => data)
  .handler(async ({ data }) => {
    return await generateAndSendEmailOtpServer(data.email, data.userId);
  });

/**
 * 2. Verify Email OTP Server Function (Single-use, 10-min expiry, max 5 attempts, returns HMAC JWT)
 */
export const verifyEmailOtpFn = createServerFn({ method: "POST" })
  .validator((data: { email: string; code: string; userId?: string }) => data)
  .handler(async ({ data }) => {
    return verifyEmailOtpServer(data.email, data.code, data.userId);
  });

/**
 * 3. Retrieve or Register User TOTP Setup (Encrypted on server)
 */
export const getTotpSetupFn = createServerFn({ method: "POST" })
  .validator((data: { userId: string; email: string }) => data)
  .handler(async ({ data }) => {
    return getOrRegisterUserTotpSecret(data.userId, data.email);
  });

/**
 * 4. Verify TOTP Code Server Function (Server-side decrypted & RFC 6238 verified, returns HMAC JWT)
 */
export const verifyTotpFn = createServerFn({ method: "POST" })
  .validator((data: { userId: string; code: string }) => data)
  .handler(async ({ data }) => {
    return verifyUserTotpServer(data.userId, data.code);
  });

/**
 * 5. Remove Bank Card Server Function (Server-side verified via MFA JWT)
 */
export const removeBankCardFn = createServerFn({ method: "POST" })
  .validator((data: { cardId: string; mfaToken: string; userId?: string }) => data)
  .handler(async ({ data }) => {
    return await handleRemoveBankCard(data);
  });
