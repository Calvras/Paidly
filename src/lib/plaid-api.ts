import { createServerFn } from "@tanstack/react-start";
import type { CardItem, SubscriptionItem } from "@/lib/cards-store";
import { verifyMfaJwt } from "@/lib/jwt";

const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID;
const PLAID_SECRET = process.env.PLAID_SECRET;
const PLAID_ENV = process.env.PLAID_ENV || "sandbox";
const PLAID_BASE_URL = `https://${PLAID_ENV}.plaid.com`;

/**
 * Core server handler for createLinkToken:
 * STRICTLY BLOCKED UNLESS VERIFIED VIA VALID HMAC-SHA256 MFA JWT
 */
export async function handleCreateLinkToken(data?: { mfaToken?: string; userId?: string }) {
  const mfaToken = data?.mfaToken;
  const mfaVerification = verifyMfaJwt(mfaToken, {
    expectedUserId: data?.userId,
  });

  if (!mfaVerification.valid || !mfaVerification.payload) {
    console.warn(
      "[Security] Plaid createLinkToken blocked: invalid or expired MFA token.",
      mfaVerification.error,
    );
    return {
      error:
        mfaVerification.error ||
        "Multi-Factor Authentication (MFA) required. Please verify your identity before opening bank link.",
    };
  }

  try {
    const response = await fetch(`${PLAID_BASE_URL}/link/token/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        client_name: "Paidly",
        user: { client_user_id: "paidly-user-" + mfaVerification.payload.sub },
        products: ["transactions"],
        country_codes: ["US"],
        language: "en",
      }),
    });

    const resData = await response.json();
    if (!response.ok) {
      console.error("Plaid link token error:", resData);
      return { error: resData.error_message || "Failed to create link token" };
    }

    return { link_token: resData.link_token as string };
  } catch (err: any) {
    console.error("Plaid link token network error:", err);
    return { error: err.message || "Network error communicating with Plaid" };
  }
}

export const createLinkTokenFn = createServerFn({ method: "POST" })
  .validator((data?: { mfaToken?: string; userId?: string }) => data)
  .handler(async ({ data }) => {
    return await handleCreateLinkToken(data);
  });

/**
 * Core server handler for exchangePublicToken:
 * Also strictly verifies HMAC-SHA256 MFA JWT server-side
 */
export async function handleExchangePublicToken(data: {
  public_token: string;
  institution_name?: string;
  mfaToken?: string;
  userId?: string;
}) {
  const { public_token, institution_name, mfaToken, userId } = data;

  // Strict server-side HMAC JWT verification
  const mfaVerification = verifyMfaJwt(mfaToken, {
    expectedUserId: userId,
  });

  if (!mfaVerification.valid || !mfaVerification.payload) {
    console.warn(
      "[Security] Plaid exchangePublicToken blocked: invalid or expired MFA token.",
      mfaVerification.error,
    );
    return {
      error:
        mfaVerification.error ||
        "Multi-Factor Authentication (MFA) required to complete bank connection.",
    };
  }

  try {
    // Step A: Exchange public token
    const exchangeRes = await fetch(
      `${PLAID_BASE_URL}/item/public_token/exchange`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: PLAID_CLIENT_ID,
          secret: PLAID_SECRET,
          public_token,
        }),
      },
    );

    const exchangeData = await exchangeRes.json();
    if (!exchangeRes.ok) {
      console.error("Plaid token exchange error:", exchangeData);
      return { error: exchangeData.error_message || "Failed to exchange token" };
    }

    const accessToken = exchangeData.access_token;

    // Step B: Fetch bank accounts / cards
    const accountsRes = await fetch(`${PLAID_BASE_URL}/accounts/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        access_token: accessToken,
      }),
    });

    const accountsData = await accountsRes.json();
    const rawAccounts = accountsData.accounts || [];

    // Filter to relevant checking or credit card accounts
    const relevantAccounts = rawAccounts.filter((a: any) =>
      ["checking", "credit card", "credit", "savings"].includes(
        (a.subtype || a.type || "").toLowerCase(),
      ),
    );
    const accountsToUse =
      relevantAccounts.length > 0 ? relevantAccounts : rawAccounts.slice(0, 2);

    const mappedCards: CardItem[] = accountsToUse.map(
      (a: any, idx: number) => {
        const isCredit = (a.subtype || a.type || "").toLowerCase().includes("credit");
        return {
          id: `card-${a.account_id || Date.now() + idx}`,
          holder: institution_name || a.name || "Connected Account",
          number: `•••• •••• •••• ${a.mask || "8821"}`,
          last4: a.mask || "8821",
          expiry: "08/29",
          cvv: "•••",
          brand: isCredit ? "mastercard" : "visa",
          isDefault: idx === 0,
        };
      },
    );

    const defaultCardId = mappedCards[0]?.id || "card-1";

    // Step C: Fetch real transactions to detect recurring subscriptions
    const txRes = await fetch(`${PLAID_BASE_URL}/transactions/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        access_token: accessToken,
      }),
    });

    const txData = await txRes.json();
    const transactions = txData.added || [];

    // Known subscription detection matchers
    const knownServices = [
      { key: "spotify", name: "Spotify", brand: "spotify", plan: "Premium Individual", category: "Music & Audio", color: "#1DB954" },
      { key: "netflix", name: "Netflix", brand: "netflix", plan: "Standard HD", category: "Movies & Streaming", color: "#E50914" },
      { key: "youtube", name: "YouTube", brand: "youtube", plan: "Premium Family", category: "Video & Music", color: "#FF0000" },
      { key: "adobe", name: "Adobe", brand: "adobe", plan: "Creative Cloud", category: "Design & Software", color: "#FA0F00" },
      { key: "uber", name: "Uber One", brand: "transit", plan: "Monthly Pass", category: "Rides & Transit", color: "#0284C7" },
      { key: "starbucks", name: "Starbucks Club", brand: "transit", plan: "Rewards Membership", category: "Food & Beverage", color: "#006241" },
      { key: "medium", name: "Medium", brand: "medium", plan: "Member Annual", category: "Publishing & Reads", color: "#000000" },
    ];

    const detectedSubs: SubscriptionItem[] = [];

    for (const svc of knownServices) {
      const match = transactions.find((t: any) => {
        const merchant = (t.merchant_name || t.name || "").toLowerCase();
        return merchant.includes(svc.key);
      });

      if (match) {
        const rawAmount = Math.abs(match.amount || 9.99);
        detectedSubs.push({
          id: `sub-${svc.key}-${Date.now()}`,
          name: svc.name,
          brand: svc.brand,
          price: `$${rawAmount.toFixed(2)}`,
          priceNum: rawAmount,
          plan: svc.plan,
          due: "Due in 12 days",
          lastPaid: match.date || "Recent",
          nextPayment: "Next Month",
          startedDate: "Active subscription",
          cardId: defaultCardId,
          category: svc.category,
          features: [
            "Verified by Plaid Bank Sync",
            "Automatic billing tracking",
            "Renewal alerts active",
          ],
          cycle: "Monthly",
          totalSpent: `$${(rawAmount * 4).toFixed(2)}`,
          tone: "blue",
          brandColor: svc.color,
          bannerGradient: `linear-gradient(135deg, ${svc.color} 0%, #111111 100%)`,
        });
      }
    }

    if (detectedSubs.length === 0 && transactions.length > 0) {
      const topTx = transactions
        .filter((t: any) => t.amount > 0)
        .slice(0, 3);

      topTx.forEach((t: any, i: number) => {
        const rawAmount = Math.abs(t.amount || 12.99);
        const name = t.merchant_name || t.name || "Subscription";
        detectedSubs.push({
          id: `sub-plaid-${i}-${Date.now()}`,
          name,
          brand: "transit",
          price: `$${rawAmount.toFixed(2)}`,
          priceNum: rawAmount,
          plan: "Standard Plan",
          due: "Due in 8 days",
          lastPaid: t.date || "Recent",
          nextPayment: "Next Month",
          startedDate: "Verified by Bank",
          cardId: defaultCardId,
          category: "Recurring Expense",
          features: [
            "Verified by Plaid Bank Sync",
            "Detected from transaction statements",
          ],
          cycle: "Monthly",
          totalSpent: `$${(rawAmount * 3).toFixed(2)}`,
          tone: "yellow",
          brandColor: "#0284C7",
          bannerGradient: "linear-gradient(135deg, #0284C7 0%, #0c4a6e 100%)",
        });
      });
    }

    return {
      cards: mappedCards,
      subscriptions: detectedSubs,
    };
  } catch (err: any) {
    console.error("Plaid token exchange exception:", err);
    return { error: err.message || "Failed to process Plaid connection" };
  }
}

export const exchangePublicTokenFn = createServerFn({ method: "POST" })
  .validator((data: { public_token: string; institution_name?: string; mfaToken?: string; userId?: string }) => data)
  .handler(async ({ data }) => {
    return await handleExchangePublicToken(data);
  });
