import React, { useEffect, useState } from "react";
import {
  ShieldCheck,
  Mail,
  KeyRound,
  Fingerprint,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Building2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  MfaMethod,
  generateEmailOtp,
  getPendingEmailOtp,
  verifyEmailOtp,
  verifyTotp,
  verifyPasskey,
  getTotpSecret,
  isPasskeySupported,
} from "@/lib/mfa";
import { getStoredProfile } from "@/lib/cards-store";

export interface MfaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (mfaToken: string) => void;
  actionType?: "login" | "connect_bank" | "remove_bank";
  title?: string;
  description?: string;
  targetEmail?: string;
}

export function MfaModal({
  isOpen,
  onClose,
  onSuccess,
  actionType = "login",
  title,
  description,
  targetEmail,
}: MfaModalProps) {
  const [activeTab, setActiveTab] = useState<MfaMethod>("email_otp");
  const [otpCode, setOtpCode] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successAnim, setSuccessAnim] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(30);
  const [demoCodeHint, setDemoCodeHint] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(true);

  // Email to target
  const profile = getStoredProfile();
  const emailToUse = targetEmail || profile.email || "user@example.com";

  // Check WebAuthn support
  useEffect(() => {
    isPasskeySupported().then(setPasskeySupported);
  }, []);

  // Initialize or retrieve pending OTP when modal opens or email tab is selected
  useEffect(() => {
    if (!isOpen) {
      setOtpCode("");
      setTotpCode("");
      setErrorMsg(null);
      setSuccessAnim(false);
      return;
    }

    if (activeTab === "email_otp") {
      let pending = getPendingEmailOtp();
      if (!pending) {
        const newCode = generateEmailOtp(emailToUse);
        setDemoCodeHint(newCode);
      } else {
        setDemoCodeHint(pending.code);
      }
    }
  }, [isOpen, activeTab, emailToUse]);

  // Resend countdown timer
  useEffect(() => {
    if (!isOpen || resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen, resendCooldown]);

  if (!isOpen) return null;

  // Handle Resend Email Code
  const handleResend = () => {
    if (resendCooldown > 0) return;
    setErrorMsg(null);
    const newCode = generateEmailOtp(emailToUse);
    setDemoCodeHint(newCode);
    setResendCooldown(30);
    setOtpCode("");
  };

  // Handle Email OTP verification
  const handleVerifyEmail = async (codeToVerify?: string) => {
    const code = codeToVerify || otpCode;
    if (code.length !== 6) {
      setErrorMsg("Please enter the complete 6-digit code.");
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    // Brief simulation delay for realistic verification
    await new Promise((r) => setTimeout(r, 450));

    const res = verifyEmailOtp(code);
    setIsLoading(false);

    if (!res.success || !res.token) {
      setErrorMsg(res.error || "Incorrect code. Try again or use 123456.");
      return;
    }

    // Success
    setSuccessAnim(true);
    setTimeout(() => {
      onSuccess(res.token!);
    }, 500);
  };

  // Handle Authenticator TOTP verification
  const handleVerifyTotp = async (codeToVerify?: string) => {
    const code = codeToVerify || totpCode;
    if (code.length !== 6) {
      setErrorMsg("Please enter the 6-digit authenticator code.");
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    await new Promise((r) => setTimeout(r, 450));

    const res = verifyTotp(code);
    setIsLoading(false);

    if (!res.success || !res.token) {
      setErrorMsg(res.error || "Invalid code. Enter 6 digits or use 123456.");
      return;
    }

    setSuccessAnim(true);
    setTimeout(() => {
      onSuccess(res.token!);
    }, 500);
  };

  // Handle Biometric / Passkey verification
  const handleVerifyPasskey = async () => {
    setIsLoading(true);
    setErrorMsg(null);

    const res = await verifyPasskey();
    setIsLoading(false);

    if (!res.success || !res.token) {
      setErrorMsg(res.error || "Biometric verification failed.");
      return;
    }

    setSuccessAnim(true);
    setTimeout(() => {
      onSuccess(res.token!);
    }, 500);
  };

  // Dynamic Header content based on actionType
  const getHeaderIcon = () => {
    if (actionType === "connect_bank") {
      return (
        <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-2">
          <Building2 className="w-6 h-6 stroke-[2.2]" />
        </div>
      );
    }
    if (actionType === "remove_bank") {
      return (
        <div className="w-12 h-12 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center mb-2">
          <Trash2 className="w-6 h-6 stroke-[2.2]" />
        </div>
      );
    }
    return (
      <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-2">
        <ShieldCheck className="w-6 h-6 stroke-[2.2]" />
      </div>
    );
  };

  const modalTitle =
    title ||
    (actionType === "connect_bank"
      ? "Authorize Bank Connection"
      : actionType === "remove_bank"
        ? "Authorize Account Removal"
        : "Two-Factor Verification");

  const modalDesc =
    description ||
    (actionType === "connect_bank"
      ? "Complete MFA to open Plaid and securely connect your financial institution."
      : actionType === "remove_bank"
        ? "MFA verification is required to remove this payment card or bank account."
        : `Choose a second factor to verify your session for ${emailToUse}`);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-[3px] transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Swipe-up Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mfa-title"
        className="relative z-50 w-full max-w-[480px] mx-auto bg-background rounded-t-[28px] shadow-2xl flex flex-col max-h-[90dvh] overflow-hidden border-t border-border animate-in slide-in-from-bottom duration-300"
      >
        {/* Top bar with drag handle and close */}
        <div className="px-5 pt-3 pb-2 flex items-center justify-between">
          <div className="w-10 h-1 bg-muted-foreground/25 rounded-full mx-auto -mr-2" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 -mr-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Header */}
        <div className="flex flex-col items-center px-6 pt-1 pb-3 text-center">
          {getHeaderIcon()}
          <h2 id="mfa-title" className="text-xl font-bold tracking-tight text-foreground">
            {modalTitle}
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-[320px] leading-relaxed">
            {modalDesc}
          </p>
        </div>

        {/* Factor Selector Tabs */}
        <div className="px-6 mb-3">
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-muted/60 border border-border/40">
            <button
              type="button"
              onClick={() => {
                setActiveTab("email_otp");
                setErrorMsg(null);
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-1 rounded-lg text-xs font-medium transition-all ${
                activeTab === "email_otp"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Mail className="w-3.5 h-3.5" />
              <span>Email Code</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("totp");
                setErrorMsg(null);
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-1 rounded-lg text-xs font-medium transition-all ${
                activeTab === "totp"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Authenticator</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("passkey");
                setErrorMsg(null);
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-1 rounded-lg text-xs font-medium transition-all ${
                activeTab === "passkey"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Fingerprint className="w-3.5 h-3.5" />
              <span>Face ID</span>
            </button>
          </div>
        </div>

        {/* Tab Body */}
        <div className="px-6 pb-6 overflow-y-auto">
          {/* TAB 1: EMAIL OTP */}
          {activeTab === "email_otp" && (
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="bg-muted/40 rounded-xl px-4 py-2.5 text-xs text-muted-foreground border border-border/40 max-w-[340px]">
                Enter the 6-digit code sent to{" "}
                <span className="font-semibold text-foreground">{emailToUse}</span>
              </div>

              {/* Demo Hint Badge */}
              {demoCodeHint && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs">
                  <span>Code:</span>
                  <span className="font-mono font-bold tracking-wider">{demoCodeHint}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setOtpCode(demoCodeHint);
                      handleVerifyEmail(demoCodeHint);
                    }}
                    className="underline text-[11px] font-medium ml-1 cursor-pointer hover:opacity-80"
                  >
                    Quick fill
                  </button>
                </div>
              )}

              {/* OTP Input Component */}
              <div className="py-2 flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={otpCode}
                  onChange={(val) => {
                    setOtpCode(val);
                    setErrorMsg(null);
                    if (val.length === 6) {
                      handleVerifyEmail(val);
                    }
                  }}
                  disabled={isLoading || successAnim}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} className="w-11 h-12 text-lg font-bold" />
                    <InputOTPSlot index={1} className="w-11 h-12 text-lg font-bold" />
                    <InputOTPSlot index={2} className="w-11 h-12 text-lg font-bold" />
                    <InputOTPSlot index={3} className="w-11 h-12 text-lg font-bold" />
                    <InputOTPSlot index={4} className="w-11 h-12 text-lg font-bold" />
                    <InputOTPSlot index={5} className="w-11 h-12 text-lg font-bold" />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              {/* Resend Action */}
              <div className="flex items-center justify-center text-xs text-muted-foreground">
                <span>Didn't receive the email?&nbsp;</span>
                {resendCooldown > 0 ? (
                  <span className="text-muted-foreground/60">Resend in {resendCooldown}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    className="text-foreground font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity cursor-pointer"
                  >
                    Resend code
                  </button>
                )}
              </div>

              {/* Submit Button */}
              <Button
                type="button"
                onClick={() => handleVerifyEmail()}
                disabled={isLoading || otpCode.length !== 6 || successAnim}
                className="w-full h-11 rounded-xl font-semibold"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : successAnim ? (
                  <span className="flex items-center gap-1.5 text-emerald-500">
                    <CheckCircle2 className="w-4 h-4" /> Verified
                  </span>
                ) : (
                  "Verify & Continue"
                )}
              </Button>
            </div>
          )}

          {/* TAB 2: AUTHENTICATOR APP (TOTP) */}
          {activeTab === "totp" && (
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="bg-muted/40 rounded-xl p-3 text-xs text-muted-foreground border border-border/40 max-w-[340px] text-left">
                <p className="font-semibold text-foreground mb-1">Google Authenticator / 1Password / Authy</p>
                <p>Enter the 6-digit rolling security code from your authenticator app.</p>

                <div className="mt-2.5 pt-2 border-t border-border/50 flex items-center justify-between">
                  <span className="font-mono text-[11px] text-muted-foreground">Secret: {getTotpSecret()}</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(getTotpSecret());
                      setCopiedSecret(true);
                      setTimeout(() => setCopiedSecret(false), 2000);
                    }}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                    title="Copy Secret"
                  >
                    {copiedSecret ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* TOTP Input Slots */}
              <div className="py-2 flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={totpCode}
                  onChange={(val) => {
                    setTotpCode(val);
                    setErrorMsg(null);
                    if (val.length === 6) {
                      handleVerifyTotp(val);
                    }
                  }}
                  disabled={isLoading || successAnim}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} className="w-11 h-12 text-lg font-bold" />
                    <InputOTPSlot index={1} className="w-11 h-12 text-lg font-bold" />
                    <InputOTPSlot index={2} className="w-11 h-12 text-lg font-bold" />
                    <InputOTPSlot index={3} className="w-11 h-12 text-lg font-bold" />
                    <InputOTPSlot index={4} className="w-11 h-12 text-lg font-bold" />
                    <InputOTPSlot index={5} className="w-11 h-12 text-lg font-bold" />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Tip: Enter any 6-digit code or <span className="font-mono font-semibold text-foreground">123456</span> to test.
              </p>

              <Button
                type="button"
                onClick={() => handleVerifyTotp()}
                disabled={isLoading || totpCode.length !== 6 || successAnim}
                className="w-full h-11 rounded-xl font-semibold"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : successAnim ? (
                  <span className="flex items-center gap-1.5 text-emerald-500">
                    <CheckCircle2 className="w-4 h-4" /> Verified
                  </span>
                ) : (
                  "Verify Authenticator Code"
                )}
              </Button>
            </div>
          )}

          {/* TAB 3: FACE ID / PASSKEY */}
          {activeTab === "passkey" && (
            <div className="flex flex-col items-center text-center space-y-4 py-2">
              <div className="w-20 h-20 rounded-full bg-primary/10 text-primary flex items-center justify-center my-2 animate-pulse">
                <Fingerprint className="w-10 h-10 stroke-[1.8]" />
              </div>

              <div className="max-w-[300px]">
                <h3 className="text-sm font-semibold text-foreground">
                  Biometric Verification
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Authenticate securely using Apple Face ID, Touch ID, or Android Biometric Passkey.
                </p>
              </div>

              <Button
                type="button"
                onClick={handleVerifyPasskey}
                disabled={isLoading || successAnim}
                className="w-full h-12 rounded-xl font-semibold flex items-center justify-center gap-2 mt-2"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : successAnim ? (
                  <span className="flex items-center gap-1.5 text-emerald-500">
                    <CheckCircle2 className="w-4 h-4" /> Biometric Confirmed
                  </span>
                ) : (
                  <>
                    <Fingerprint className="w-4 h-4" />
                    <span>Scan Face ID / Use Passkey</span>
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div className="mt-3 p-2.5 rounded-lg bg-destructive/10 text-destructive text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
