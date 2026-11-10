import { describe, it, expect, beforeEach } from "vitest";
import { signMfaJwt, verifyMfaJwt } from "@/lib/jwt";
import {
  generateAndSendEmailOtpServer,
  verifyEmailOtpServer,
  getOrRegisterUserTotpSecret,
  verifyUserTotpServer,
  computeTotp,
  _getOtpStoreForTest,
  _getUserTotpStoreForTest,
  handleRemoveBankCard,
} from "@/lib/mfa-server";
import { handleCreateLinkToken, handleExchangePublicToken } from "@/lib/plaid-api";

describe("MFA Security Audit & Hardening", () => {
  const testUser = "user_test_9824";
  const testEmail = "testuser@example.com";

  beforeEach(() => {
    // Clear stores before each test
    _getOtpStoreForTest().clear();
    _getUserTotpStoreForTest().clear();
  });

  // ==========================================================================
  // 1. Proof that create-link-token fails without a valid MFA token
  // ==========================================================================
  describe("createLinkToken MFA Enforcement", () => {
    it("fails when called with no arguments or undefined token", async () => {
      const result = await handleCreateLinkToken(undefined);
      expect(result).toHaveProperty("error");
      expect(result.error).toMatch(/Multi-Factor Authentication|MFA/i);
    });

    it("fails when called with empty object or empty token string", async () => {
      const result = await handleCreateLinkToken({ mfaToken: "" });
      expect(result).toHaveProperty("error");
      expect(result.error).toMatch(/Multi-Factor Authentication|MFA/i);
    });

    it("fails when called with a forged / tampered token", async () => {
      const result = await handleCreateLinkToken({
        mfaToken: "fake.header.fakesignature",
      });
      expect(result).toHaveProperty("error");
      expect(result.error).toMatch(/invalid|token/i);
    });

    it("fails when called with an expired HMAC JWT", async () => {
      // Sign token with negative TTL (already expired)
      const expiredToken = signMfaJwt({
        userId: testUser,
        email: testEmail,
        method: "email_otp",
        ttlSeconds: -10,
      });

      const result = await handleCreateLinkToken({
        mfaToken: expiredToken,
      });
      expect(result).toHaveProperty("error");
      expect(result.error).toMatch(/expired|limit exceeded/i);
    });

    it("passes the MFA guard when called with a valid 10-minute HMAC JWT", async () => {
      const validToken = signMfaJwt({
        userId: testUser,
        email: testEmail,
        method: "email_otp",
        ttlSeconds: 600,
      });

      // The MFA verification passes; any subsequent network failure is due to Plaid credentials/env
      const result = await handleCreateLinkToken({
        mfaToken: validToken,
        userId: testUser,
      });
      // Ensure the error is NOT an MFA rejection
      if (result.error) {
        expect(result.error).not.toMatch(/Multi-Factor Authentication \(MFA\) required/i);
        expect(result.error).not.toMatch(/MFA token is missing/i);
      }
    });
  });

  // ==========================================================================
  // 2. Proof that exchangePublicToken fails without valid MFA token
  // ==========================================================================
  describe("exchangePublicToken MFA Enforcement", () => {
    it("fails when called without an MFA token", async () => {
      const result = await handleExchangePublicToken({
        public_token: "public-sandbox-1234",
        institution_name: "Test Bank",
        mfaToken: undefined,
      });
      expect(result).toHaveProperty("error");
      expect(result.error).toMatch(/Multi-Factor Authentication|MFA/i);
    });

    it("fails when called with an invalid MFA token", async () => {
      const result = await handleExchangePublicToken({
        public_token: "public-sandbox-1234",
        institution_name: "Test Bank",
        mfaToken: "bad.jwt.signature",
      });
      expect(result).toHaveProperty("error");
      expect(result.error).toMatch(/invalid|signature/i);
    });
  });

  // ==========================================================================
  // 3. Proof that bank removal requires valid MFA token
  // ==========================================================================
  describe("removeBankCard MFA Enforcement", () => {
    it("fails to remove card without MFA token", async () => {
      const result = await handleRemoveBankCard({
        cardId: "card-9988",
        mfaToken: "",
      });
      expect(result).toHaveProperty("error");
      expect(result.error).toMatch(/MFA token is missing/i);
    });

    it("fails to remove card with forged MFA token", async () => {
      const result = await handleRemoveBankCard({
        cardId: "card-9988",
        mfaToken: "fake.tampered.token",
      });
      expect(result).toHaveProperty("error");
      expect(result.error).toMatch(/invalid|token/i);
    });

    it("successfully authorizes card removal with valid signed MFA JWT", async () => {
      const validToken = signMfaJwt({
        userId: testUser,
        email: testEmail,
        method: "email_otp",
        purpose: "mfa_sensitive_action",
      });

      const result = await handleRemoveBankCard({
        cardId: "card-9988",
        mfaToken: validToken,
        userId: testUser,
      });

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("cardId", "card-9988");
    });
  });

  // ==========================================================================
  // 4. HMAC-SHA256 JWT Security Properties
  // ==========================================================================
  describe("HMAC-SHA256 JWT Verification", () => {
    it("rejects token with modified payload", () => {
      const token = signMfaJwt({
        userId: testUser,
        email: testEmail,
        method: "email_otp",
      });
      const parts = token.split(".");
      // Modify payload to impersonate another user
      const tamperedPayload = Buffer.from(
        JSON.stringify({ sub: "attacker_user", email: "attacker@test.com", exp: Date.now() + 10000 }),
      ).toString("base64url");

      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
      const check = verifyMfaJwt(tamperedToken);
      expect(check.valid).toBe(false);
      expect(check.error).toMatch(/signature/i);
    });

    it("rejects token with modified signature", () => {
      const token = signMfaJwt({
        userId: testUser,
        email: testEmail,
        method: "email_otp",
      });
      const parts = token.split(".");
      const badSig = parts[2].slice(0, -4) + "AAAA";
      const tamperedToken = `${parts[0]}.${parts[1]}.${badSig}`;

      const check = verifyMfaJwt(tamperedToken);
      expect(check.valid).toBe(false);
      expect(check.error).toMatch(/signature/i);
    });

    it("rejects token when bound userId does not match", () => {
      const token = signMfaJwt({
        userId: "legit_user_1",
        email: "legit@example.com",
        method: "email_otp",
      });

      const check = verifyMfaJwt(token, { expectedUserId: "different_user_2" });
      expect(check.valid).toBe(false);
      expect(check.error).toMatch(/user ID does not match/i);
    });
  });

  // ==========================================================================
  // 5. Server-Side Hashed OTP Generation, Rate Limiting & Verification
  // ==========================================================================
  describe("Server-Side Email OTP Hardening", () => {
    it("hashes OTP on the server and does not expose plain OTP in store", async () => {
      await generateAndSendEmailOtpServer(testEmail, testUser);

      const store = _getOtpStoreForTest();
      const record = store.get(testEmail);
      expect(record).toBeDefined();
      // Record must have salt and a 64-character SHA-256 hex string
      expect(record?.salt).toBeDefined();
      expect(record?.hashedOtp).toHaveLength(64);
      // Plain text OTP must NOT exist on the record
      expect((record as any).otp).toBeUndefined();
    });

    it("rate limits rapid resend attempts within 10 seconds", async () => {
      const first = await generateAndSendEmailOtpServer(testEmail, testUser);
      expect(first.success).toBe(true);

      const second = await generateAndSendEmailOtpServer(testEmail, testUser);
      expect(second.success).toBe(false);
      expect(second.error).toMatch(/Please wait.*second/i);
    });

    it("fails verification on incorrect code and decrements remaining attempts", async () => {
      await generateAndSendEmailOtpServer(testEmail, testUser);

      const wrong = verifyEmailOtpServer(testEmail, "000000", testUser);
      expect(wrong.success).toBe(false);
      expect(wrong.error).toMatch(/4 attempt\(s\) remaining/i);
    });

    it("locks out and destroys OTP record after exceeding 5 attempts", async () => {
      await generateAndSendEmailOtpServer(testEmail, testUser);

      for (let i = 0; i < 5; i++) {
        verifyEmailOtpServer(testEmail, `11111${i}`, testUser);
      }

      // 6th attempt should lock out and invalidate
      const lockout = verifyEmailOtpServer(testEmail, "999999", testUser);
      expect(lockout.success).toBe(false);
      expect(lockout.error).toMatch(/Too many failed attempts|invalidated/i);

      // Record must be completely removed from server store
      expect(_getOtpStoreForTest().get(testEmail)).toBeUndefined();
    });

    it("enforces single-use: invalidates OTP immediately upon successful verification", async () => {
      const validCode = "482915";
      await generateAndSendEmailOtpServer(testEmail, testUser, validCode);

      const record = _getOtpStoreForTest().get(testEmail);
      expect(record).toBeDefined();

      // 1st attempt with correct code succeeds and returns JWT
      const firstVerify = verifyEmailOtpServer(testEmail, validCode, testUser);
      expect(firstVerify.success).toBe(true);
      expect(firstVerify.token).toBeDefined();

      // Verify the returned token is a valid HMAC-SHA256 JWT
      const tokenCheck = verifyMfaJwt(firstVerify.token);
      expect(tokenCheck.valid).toBe(true);
      expect(tokenCheck.payload?.sub).toBe(testUser);

      // 2nd attempt with same code MUST FAIL (single-use proof)
      const secondVerify = verifyEmailOtpServer(testEmail, validCode, testUser);
      expect(secondVerify.success).toBe(false);
      expect(secondVerify.error).toMatch(/No active verification code found/i);
    });
  });

  // ==========================================================================
  // 6. Server-Side Encrypted TOTP (RFC 6238)
  // ==========================================================================
  describe("Server-Side TOTP Hardening", () => {
    it("generates and stores encrypted secret on the server", () => {
      const setup = getOrRegisterUserTotpSecret(testUser, testEmail);
      expect(setup.secret).toBeDefined();
      expect(setup.uri).toMatch(/otpauth:\/\/totp\/Paidly/);

      const record = _getUserTotpStoreForTest().get(testUser);
      expect(record).toBeDefined();
      expect(record?.ciphertext).toBeDefined();
      expect(record?.iv).toBeDefined();
      expect(record?.authTag).toBeDefined();
      // Raw secret must NOT be stored in plain text
      expect((record as any).secret).toBeUndefined();
    });

    it("verifies valid RFC 6238 code and issues signed HMAC JWT", () => {
      const setup = getOrRegisterUserTotpSecret(testUser, testEmail);
      const currentCode = computeTotp(setup.secret, 0);

      const verify = verifyUserTotpServer(testUser, currentCode);
      expect(verify.success).toBe(true);
      expect(verify.token).toBeDefined();

      const jwtCheck = verifyMfaJwt(verify.token);
      expect(jwtCheck.valid).toBe(true);
      expect(jwtCheck.payload?.method).toBe("totp");
      expect(jwtCheck.payload?.sub).toBe(testUser);
    });

    it("rejects invalid TOTP codes", () => {
      getOrRegisterUserTotpSecret(testUser, testEmail);

      const verify = verifyUserTotpServer(testUser, "000000");
      expect(verify.success).toBe(false);
      expect(verify.error).toMatch(/Invalid authenticator code/i);
    });
  });
});
