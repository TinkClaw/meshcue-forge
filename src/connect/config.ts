/**
 * MeshCue Connect — Configuration Loader
 *
 * Reads Connect settings from environment variables with sensible defaults.
 */

import type { ConnectConfig } from "./types.js";

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
