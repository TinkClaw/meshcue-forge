/**
 * MeshCue Connect — Channel Factory
 *
 * Routes channel creation to the appropriate provider based on
 * the requested channel type. Validates that required config
 * fields are present before instantiation.
 */

import type { Channel, ChannelProvider, ConnectConfig } from "../types.js";
import { createSMSProvider } from "./sms.js";
import { createWhatsAppProvider } from "./whatsapp.js";
import { createVoiceProvider } from "./voice.js";

/**
 * Create a channel provider for the given channel type.
 *
 * Throws if the channel requires configuration that is not set
 * (e.g., WhatsApp without a token).
 *
 * Note: USSD is handled separately via `createUSSDHandler()` because
 * it follows a request/response callback model rather than the
 * `ChannelProvider` send-and-track pattern.
 */
export function createChannelProvider(
  channel: Channel,
  config: ConnectConfig,
): ChannelProvider {
  switch (channel) {
    case "sms":
      requireFields(config, ["atApiKey", "atUsername"], "SMS");
      return createSMSProvider(config);

    case "whatsapp":
      requireFields(config, ["whatsappToken", "whatsappPhoneId"], "WhatsApp");
      return createWhatsAppProvider(config);

    case "voice":
      requireFields(config, ["atApiKey", "atUsername"], "Voice");
      return createVoiceProvider(config);

    case "ussd":
      throw new Error(
        'USSD does not use the ChannelProvider interface. ' +
          'Use createUSSDHandler() from "./ussd.js" instead.',
      );

    case "mesh":
      throw new Error(
        "Mesh channel provider is part of the MeshCue Forge runtime " +
          "and is not available through Connect. Route mesh messages " +
          "through the MeshNode relay instead.",
      );

    case "push":
      throw new Error(
        "Push notification channel is not yet implemented. " +
          "Contributions welcome — see the Connect roadmap.",
      );

    default: {
      const _exhaustive: never = channel;
      throw new Error(`Unknown channel: ${_exhaustive}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that all required config fields are present and non-empty.
 */
function requireFields(
  config: ConnectConfig,
  fields: (keyof ConnectConfig)[],
  channelName: string,
): void {
  const missing = fields.filter((f) => {
    const val = config[f];
    return val === undefined || val === null || val === "";
  });

  if (missing.length > 0) {
    throw new Error(
      `${channelName} channel requires the following config fields: ${missing.join(", ")}`,
    );
  }
}

// Re-export individual providers for direct use
export { createSMSProvider } from "./sms.js";
export { createWhatsAppProvider } from "./whatsapp.js";
export { createVoiceProvider, buildSayResponse } from "./voice.js";
export { createUSSDHandler, USSDHandler } from "./ussd.js";
export type { USSDResponse } from "./ussd.js";
