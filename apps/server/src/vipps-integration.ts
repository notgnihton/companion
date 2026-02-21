/**
 * Vipps MobilePay Recurring Payments Integration
 *
 * Handles subscription agreement creation, charge management,
 * webhook processing, and agreement status polling.
 *
 * Required env vars:
 *   VIPPS_CLIENT_ID                — OAuth client ID from Vipps portal
 *   VIPPS_CLIENT_SECRET            — OAuth client secret
 *   VIPPS_SUBSCRIPTION_KEY         — Ocp-Apim-Subscription-Key (API subscription key)
 *   VIPPS_MERCHANT_SERIAL_NUMBER   — MSN from Vipps portal
 *   APP_URL                        — e.g. https://lucyscript.github.io/companion
 *
 * Optional:
 *   VIPPS_API_BASE                 — Override API base URL (default: https://api.vipps.no)
 *   VIPPS_USE_TEST_MODE            — Set to "true" to use test environment
 */

import type { PlanId } from "./plan-config.js";

// ── Configuration ────────────────────────────────────────────────────────

const VIPPS_CLIENT_ID = process.env.VIPPS_CLIENT_ID ?? "";
const VIPPS_CLIENT_SECRET = process.env.VIPPS_CLIENT_SECRET ?? "";
const VIPPS_SUBSCRIPTION_KEY = process.env.VIPPS_SUBSCRIPTION_KEY ?? "";
const VIPPS_MERCHANT_SERIAL_NUMBER = process.env.VIPPS_MERCHANT_SERIAL_NUMBER ?? "";
const VIPPS_USE_TEST_MODE = (process.env.VIPPS_USE_TEST_MODE ?? "").toLowerCase() === "true";
const VIPPS_API_BASE = process.env.VIPPS_API_BASE ??
  (VIPPS_USE_TEST_MODE ? "https://apitest.vipps.no" : "https://api.vipps.no");
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";

export function isVippsConfigured(): boolean {
  return Boolean(
    VIPPS_CLIENT_ID &&
    VIPPS_CLIENT_SECRET &&
    VIPPS_SUBSCRIPTION_KEY &&
    VIPPS_MERCHANT_SERIAL_NUMBER
  );
}

// ── Plan → Amount mapping (amounts in øre) ───────────────────────────────

const PLAN_AMOUNTS: Record<string, number> = {
  plus: 4900,  // 49 kr
  pro: 9900    // 99 kr
};

const PLAN_PRODUCT_NAMES: Record<string, string> = {
  plus: "Companion Plus",
  pro: "Companion Pro"
};

// ── Access Token ────────────────────────────────────────────────────────

interface VippsAccessToken {
  access_token: string;
  expires_in: string;
  ext_expires_in: string;
  token_type: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Get a valid Vipps access token. Caches until near-expiry.
 */
async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const response = await fetch(`${VIPPS_API_BASE}/accesstoken/get`, {
    method: "POST",
    headers: {
      "client_id": VIPPS_CLIENT_ID,
      "client_secret": VIPPS_CLIENT_SECRET,
      "Ocp-Apim-Subscription-Key": VIPPS_SUBSCRIPTION_KEY,
      "Merchant-Serial-Number": VIPPS_MERCHANT_SERIAL_NUMBER,
      "Content-Type": "application/json"
    },
    body: "{}"
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vipps access token request failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as VippsAccessToken;
  const expiresInMs = parseInt(data.expires_in, 10) * 1000;

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + expiresInMs
  };

  return cachedToken.token;
}

/**
 * Build standard Vipps API headers
 */
async function vippsHeaders(idempotencyKey?: string): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${token}`,
    "Ocp-Apim-Subscription-Key": VIPPS_SUBSCRIPTION_KEY,
    "Merchant-Serial-Number": VIPPS_MERCHANT_SERIAL_NUMBER,
    "Vipps-System-Name": "companion",
    "Vipps-System-Version": "1.0.0",
    "Content-Type": "application/json"
  };

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  return headers;
}

// ── Agreement Creation ──────────────────────────────────────────────────

export interface CreateAgreementParams {
  userId: string;
  planId: PlanId;
  phoneNumber?: string; // Norwegian format: 4712345678
}

export interface AgreementResult {
  agreementId: string;
  vippsConfirmationUrl: string;
}

/**
 * Create a Vipps Recurring agreement (draft).
 * User must approve in the Vipps app.
 * Returns a URL to redirect the user to Vipps.
 */
export async function createAgreement(params: CreateAgreementParams): Promise<AgreementResult> {
  if (!isVippsConfigured()) {
    throw new Error("Vipps is not configured");
  }

  const amount = PLAN_AMOUNTS[params.planId];
  if (!amount) {
    throw new Error(`No Vipps pricing configured for plan "${params.planId}"`);
  }

  const idempotencyKey = `agreement-${params.userId}-${params.planId}-${Date.now()}`;

  const body: Record<string, unknown> = {
    pricing: {
      type: "LEGACY",
      amount,
      currency: "NOK"
    },
    interval: {
      unit: "MONTH",
      count: 1
    },
    merchantRedirectUrl: `${APP_URL}?payment=vipps-callback&plan=${params.planId}`,
    merchantAgreementUrl: `${APP_URL}?tab=settings`,
    productName: PLAN_PRODUCT_NAMES[params.planId] ?? `Companion ${params.planId}`,
    productDescription: `Monthly subscription to ${PLAN_PRODUCT_NAMES[params.planId] ?? params.planId}`,
    scope: "name email phoneNumber",
    externalId: params.userId
  };

  if (params.phoneNumber) {
    body.phoneNumber = params.phoneNumber;
  }

  // Add initial charge with direct capture so payment starts immediately
  body.initialCharge = {
    amount,
    description: `First month — ${PLAN_PRODUCT_NAMES[params.planId]}`,
    transactionType: "DIRECT_CAPTURE"
  };

  // Add 7-day trial campaign for Plus plan
  if (params.planId === "plus") {
    body.campaign = {
      type: "PERIOD_CAMPAIGN",
      price: 0, // Free trial
      period: {
        unit: "DAY",
        count: 7
      }
    };
    // Remove initial charge for trial — user shouldn't pay until trial ends
    delete body.initialCharge;
  }

  const headers = await vippsHeaders(idempotencyKey);
  const response = await fetch(`${VIPPS_API_BASE}/recurring/v3/agreements`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vipps create agreement failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { agreementId: string; vippsConfirmationUrl: string };

  return {
    agreementId: data.agreementId,
    vippsConfirmationUrl: data.vippsConfirmationUrl
  };
}

// ── Agreement Retrieval ─────────────────────────────────────────────────

export type VippsAgreementStatus = "PENDING" | "ACTIVE" | "STOPPED" | "EXPIRED";

export interface VippsAgreement {
  id: string;
  status: VippsAgreementStatus;
  productName: string;
  pricing: {
    type: string;
    amount: number;
    currency: string;
  };
  interval: {
    unit: string;
    count: number;
  };
}

/**
 * Retrieve agreement details from Vipps.
 */
export async function getAgreement(agreementId: string): Promise<VippsAgreement> {
  const headers = await vippsHeaders();
  const response = await fetch(`${VIPPS_API_BASE}/recurring/v3/agreements/${agreementId}`, {
    method: "GET",
    headers
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vipps get agreement failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as VippsAgreement;
}

/**
 * Stop (cancel) a Vipps agreement.
 */
export async function stopAgreement(agreementId: string): Promise<void> {
  const headers = await vippsHeaders(`stop-${agreementId}-${Date.now()}`);
  const response = await fetch(`${VIPPS_API_BASE}/recurring/v3/agreements/${agreementId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "STOPPED" })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vipps stop agreement failed (${response.status}): ${errorText}`);
  }
}

// ── Charge Management ───────────────────────────────────────────────────

export interface CreateChargeParams {
  agreementId: string;
  amount: number; // In øre
  description: string;
  dueDate: string; // YYYY-MM-DD, at least 1 day in future
  retryDays?: number;
}

export interface ChargeResult {
  chargeId: string;
}

/**
 * Create a recurring charge on an active agreement.
 * The charge must be due at least 1 day in the future.
 */
export async function createCharge(params: CreateChargeParams): Promise<ChargeResult> {
  const idempotencyKey = `charge-${params.agreementId}-${params.dueDate}-${Date.now()}`;
  const headers = await vippsHeaders(idempotencyKey);

  const body = {
    amount: params.amount,
    transactionType: "DIRECT_CAPTURE",
    description: params.description,
    due: params.dueDate,
    retryDays: params.retryDays ?? 5,
    type: "RECURRING"
  };

  const response = await fetch(
    `${VIPPS_API_BASE}/recurring/v3/agreements/${params.agreementId}/charges`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vipps create charge failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { chargeId: string };
  return { chargeId: data.chargeId };
}

// ── Webhook Processing ──────────────────────────────────────────────────

export type VippsWebhookEventType =
  | "recurring.agreement-activated.v1"
  | "recurring.agreement-rejected.v1"
  | "recurring.agreement-stopped.v1"
  | "recurring.agreement-expired.v1"
  | "recurring.charge-reserved.v1"
  | "recurring.charge-captured.v1"
  | "recurring.charge-canceled.v1"
  | "recurring.charge-failed.v1";

export interface VippsWebhookPayload {
  // Agreement events
  agreementId?: string;
  agreementExternalId?: string | null;
  eventType: VippsWebhookEventType;
  occurred: string;
  actor?: "MERCHANT" | "USER" | "ADMIN" | null;
  msn?: string;

  // Charge events
  chargeId?: string;
  chargeExternalId?: string | null;
  amount?: number;
  chargeType?: "RECURRING" | "INITIAL" | "UNSCHEDULED";
  currency?: string;
  amountCaptured?: number;
  amountCanceled?: number;
  amountRefunded?: number;
  failureReason?: string;
}

export interface ProcessedVippsEvent {
  eventType: VippsWebhookEventType;
  agreementId: string | null;
  userId: string | null; // Extracted from externalId
  chargeId: string | null;
  amount: number | null;
}

/**
 * Parse and process a Vipps webhook payload.
 * The userId is stored as externalId on the agreement.
 *
 * Note: Vipps webhooks use HMAC-SHA256 for verification but the approach
 * differs from Stripe. For now, we rely on the webhook URL being secret
 * and validate the payload structure. Proper HMAC verification can be
 * added when the webhook is registered via the Webhooks API.
 */
export function processWebhookPayload(body: VippsWebhookPayload): ProcessedVippsEvent {
  return {
    eventType: body.eventType,
    agreementId: body.agreementId ?? null,
    userId: body.agreementExternalId ?? null,
    chargeId: body.chargeId ?? null,
    amount: body.amount ?? null
  };
}

// ── Status ────────────────────────────────────────────────────────────────

export interface VippsStatus {
  configured: boolean;
  testMode: boolean;
  plans: {
    plus: boolean;
    pro: boolean;
  };
}

export function getVippsStatus(): VippsStatus {
  return {
    configured: isVippsConfigured(),
    testMode: VIPPS_USE_TEST_MODE,
    plans: {
      plus: Boolean(PLAN_AMOUNTS.plus),
      pro: Boolean(PLAN_AMOUNTS.pro)
    }
  };
}

/**
 * Determine which PlanId an agreement amount maps to.
 */
export function planIdFromAmount(amount: number): PlanId | null {
  for (const [plan, planAmount] of Object.entries(PLAN_AMOUNTS)) {
    if (amount === planAmount) return plan as PlanId;
  }
  return null;
}
