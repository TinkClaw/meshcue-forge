/**
 * MeshCue Connect — Configuration Loader
 *
 * Reads Connect settings from environment variables with sensible defaults.
 * Defines subscription tiers and limit-checking for multi-tenant clinics.
 */

import type { ConnectConfig, Channel, Clinic, SubscriptionTier } from "./types.js";
import type { ConnectStore } from "./store.js";

// ─── Subscription Tiers ─────────────────────────────────────────

export const SUBSCRIPTION_TIERS: Record<Clinic["tier"], SubscriptionTier> = {
  free: {
    name: "Free",
    maxPatients: 50,
    maxDevices: 5,
    maxMessagesPerMonth: 500,
    channels: ["sms"] as Channel[],
    features: ["basic_alerts", "consent_management"],
    priceUsd: 0,
  },
  basic: {
    name: "Basic",
    maxPatients: 500,
    maxDevices: 50,
    maxMessagesPerMonth: 5000,
    channels: ["sms", "ussd"] as Channel[],
    features: ["basic_alerts", "consent_management", "ussd_menus", "message_history"],
    priceUsd: 29,
  },
  professional: {
    name: "Professional",
    maxPatients: 2000,
    maxDevices: 200,
    maxMessagesPerMonth: 20000,
    channels: ["sms", "ussd", "whatsapp", "voice", "push"] as Channel[],
    features: [
      "basic_alerts",
      "consent_management",
      "ussd_menus",
      "message_history",
      "whatsapp_integration",
      "voice_ivr",
      "analytics_dashboard",
    ],
    priceUsd: 99,
  },
  enterprise: {
    name: "Enterprise",
    maxPatients: Infinity,
    maxDevices: Infinity,
    maxMessagesPerMonth: Infinity,
    channels: ["sms", "ussd", "whatsapp", "voice", "mesh", "push"] as Channel[],
    features: [
      "basic_alerts",
      "consent_management",
      "ussd_menus",
      "message_history",
      "whatsapp_integration",
      "voice_ivr",
      "analytics_dashboard",
      "custom_integrations",
      "dedicated_support",
      "mesh_relay",
    ],
    priceUsd: 299,
  },
};

// ─── Subscription Limit Checks ──────────────────────────────────

export function checkSubscriptionLimits(
  clinic: Clinic,
  store: ConnectStore
): { allowed: boolean; reason?: string } {
  const tier = SUBSCRIPTION_TIERS[clinic.tier];
  if (!tier) {
    return { allowed: false, reason: `Unknown subscription tier: ${clinic.tier}` };
  }

  // Check patient count
  const patients = store.getPatientsByClinic(clinic.id);
  if (patients.length >= tier.maxPatients) {
    return {
      allowed: false,
      reason: `Patient limit reached (${patients.length}/${tier.maxPatients}). Upgrade to ${getNextTier(clinic.tier)} for more.`,
    };
  }

  // Check monthly message count
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthMessages = store.getMessages(clinic.id, { since: monthStart.toISOString() });
  if (monthMessages.length >= tier.maxMessagesPerMonth) {
    return {
      allowed: false,
      reason: `Monthly message limit reached (${monthMessages.length}/${tier.maxMessagesPerMonth}). Upgrade to ${getNextTier(clinic.tier)} for more.`,
    };
  }

  return { allowed: true };
}

function getNextTier(current: Clinic["tier"]): string {
  const order: Clinic["tier"][] = ["free", "basic", "professional", "enterprise"];
  const idx = order.indexOf(current);
  return idx < order.length - 1 ? SUBSCRIPTION_TIERS[order[idx + 1]].name : "Enterprise";
}

// ─── Legacy Config Loader ───────────────────────────────────────

/**
 * Loads a global ConnectConfig from environment variables.
 * In multi-tenant mode, prefer using clinic-owned credentials via
 * MessageRouter.getClinicConfig() instead.
 */
export function loadConnectConfig(): ConnectConfig {
  return {
    // Africa's Talking
    atApiKey: process.env.MESHCUE_AT_API_KEY,
    atUsername: process.env.MESHCUE_AT_USERNAME,
    atShortCode: process.env.MESHCUE_AT_SHORTCODE,

    // WhatsApp Business
    whatsappToken: process.env.MESHCUE_WA_TOKEN,
    whatsappPhoneId: process.env.MESHCUE_WA_PHONE_ID,

    // Voice/IVR
    voiceProvider: parseVoiceProvider(process.env.MESHCUE_VOICE_PROVIDER),
    twilioSid: process.env.MESHCUE_TWILIO_SID,
    twilioToken: process.env.MESHCUE_TWILIO_TOKEN,
    twilioPhone: process.env.MESHCUE_TWILIO_PHONE,

    // Defaults
    defaultChannel: (process.env.MESHCUE_DEFAULT_CHANNEL as ConnectConfig["defaultChannel"]) || "sms",
    defaultLanguage: process.env.MESHCUE_DEFAULT_LANGUAGE || "en",
    maxRetries: parseInt(process.env.MESHCUE_MAX_RETRIES || "3", 10),
    retryDelayMs: 5000,
    criticalEscalationPhone: process.env.MESHCUE_ESCALATION_PHONE,
  };
}

function parseVoiceProvider(
  value: string | undefined
): "africastalking" | "twilio" | undefined {
  if (value === "africastalking" || value === "twilio") return value;
  return undefined;
}
