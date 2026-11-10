import React, { useEffect, useState } from "react";
import {
  ShieldCheck,
  Mail,
  KeyRound,
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
  requestServerEmailOtp,
  verifyServerEmailOtp,
  getServerTotpSetup,
  verifyServerTotp,
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
  userId?: string;
}

export function MfaModal({
  isOpen,
  onClose,
  onSuccess,
  actionType = "login",
  title,
  description,
  targetEmail,
  userId,
}: MfaModalProps) {
  const [activeTab, setActiveTab] = useState<MfaMethod>("email_otp");
  const [otpCode, setOtpCode] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpSecret, setTotpSecret] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [successAnim, setSuccessAnim] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(30);
  const [copiedSecret, setCopiedSecret] = useState(false);

  // Target user details
  const profile = getStoredProfile();
  const emailToUse = (targetEmail || profile.email || "user@example.com").trim().toLowerCase();
  const effectiveUserId = (userId || emailToUse).trim().toLowerCase();

  // Send Email OTP or load TOTP setup on modal open
  useEffect(() => {
    if (!isOpen) {
      setOtpCode("");
      setTotpCode("");
      setErrorMsg(null);
      setInfoMsg(null);
      setSuccessAnim(false);
      return;
    }

    if (activeTab === "email_otp") {
      setIsSendingEmail(true);
      setErrorMsg(null);
      requestServerEmailOtp(emailToUse, effectiveUserId)
        .then((res) => {
          setIsSendingEmail(false);
          if (res.success) {
            setInfoMsg(res.message);
            setResendCooldown(30);
          } else {
            setErrorMsg(res.error || "Failed to dispatch email code.");
          }
        })
        .catch(() => {
          setIsSendingEmail(false);
          setErrorMsg("Failed to contact authentication server.");
        });
    } else if (activeTab === "totp") {
      getServerTotpSetup(effectiveUserId, emailToUse)
        .then((setup) => {
          setTotpSecret(setup.secret);
        })
        .catch((err) => {
          setErrorMsg(err?.message || "Failed to load authenticator credentials.");
        });
    }
  }, [isOpen, activeTab, emailToUse, effectiveUserId]);

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
  const handleResend = async () => {
    if (resendCooldown > 0 || isSendingEmail) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setIsSendingEmail(true);

    const res = await requestServerEmailOtp(emailToUse, effectiveUserId);
    setIsSendingEmail(false);

    if (res.success) {
      setInfoMsg(res.message);
      setResendCooldown(30);
      setOtpCode("");
    } else {
      setErrorMsg(res.error || "Failed to resend code.");
    }
  };

  // Handle Email OTP verification strictly on server
  const handleVerifyEmail = async (codeToVerify?: string) => {
    const code = (codeToVerify || otpCode).trim();
    if (code.length !== 6) {
      setErrorMsg("Please enter the complete 6-digit code.");
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setInfoMsg(null);

    const res = await verifyServerEmailOtp(emailToUse, code, effectiveUserId);
    setIsLoading(false);

    if (!res.success || !res.token) {
      setErrorMsg(res.error || "Verification failed. Please check the code.");
      return;
    }

    setSuccessAnim(true);
    setTimeout(() => {
      onSuccess(res.token!);
    }, 400);
  };

  // Handle Authenticator TOTP verification strictly on server
  const handleVerifyTotp = async (codeToVerify?: string) => {
    const code = (codeToVerify || totpCode).trim();
    if (code.length !== 6) {
      setErrorMsg("Please enter the 6-digit authenticator code.");
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setInfoMsg(null);

    const res = await verifyServerTotp(effectiveUserId, code);
    setIsLoading(false);

    if (!res.success || !res.token) {
      setErrorMsg(res.error || "Invalid authenticator code.");
      return;
    }

    setSuccessAnim(true);
    setTimeout(() => {
      onSuccess(res.token!);
    }, 400);
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
      ? "Complete server-verified MFA to authorize opening Plaid Link."
      : actionType === "remove_bank"
        ? "Server-verified MFA is required to remove this payment card or bank account."
        : `Second factor verification required for ${emailToUse}`);

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

        {/* Factor Selector Tabs (Email OTP vs Authenticator TOTP) */}
        <div className="px-6 mb-3">
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-muted/60 border border-border/40">
            <button
              type="button"
              onClick={() => {
                setActiveTab("email_otp");
                setErrorMsg(null);
                setInfoMsg(null);
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
                setInfoMsg(null);
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-1 rounded-lg text-xs font-medium transition-all ${
                activeTab === "totp"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Authenticator App</span>
            </button>
          </div>
        </div>

        {/* Tab Body */}
        <div className="px-6 pb-6 overflow-y-auto">
          {/* TAB 1: EMAIL OTP */}
          {activeTab === "email_otp" && (
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="bg-muted/40 rounded-xl px-4 py-2.5 text-xs text-muted-foreground border border-border/40 max-w-[340px]">
                {isSendingEmail ? (
                  <span className="flex items-center justify-center gap-2 text-foreground font-medium">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Dispatching code to {emailToUse}...
                  </span>
                ) : (
                  <>
                    Enter the 6-digit code sent to{" "}
                    <span className="font-semibold text-foreground">{emailToUse}</span>
                  </>
                )}
              </div>

              {infoMsg && !errorMsg && (
                <div className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-lg border border-emerald-500/20 max-w-[340px]">
                  {infoMsg}
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
                  disabled={isLoading || isSendingEmail || successAnim}
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
                    disabled={isSendingEmail}
                    className="text-foreground font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity cursor-pointer disabled:opacity-50"
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
                <p>Enter the 6-digit rolling code generated for your Paidly account.</p>

                {totpSecret && (
                  <div className="mt-2.5 pt-2 border-t border-border/50 flex items-center justify-between">
                    <span className="font-mono text-[11px] text-muted-foreground">Key: {totpSecret}</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(totpSecret);
                        setCopiedSecret(true);
                        setTimeout(() => setCopiedSecret(false), 2000);
                      }}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      title="Copy Secret"
                    >
                      {copiedSecret ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                )}
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

          {/* Error Message */}
          {errorMsg && (
            <div className="mt-3 p-2.5 rounded-lg bg-destructive/10 text-destructive text-xs flex items-center gap-2 text-left">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
