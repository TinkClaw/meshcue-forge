/**
 * MeshCue Connect — WhatsApp Business Cloud API Provider
 *
 * Uses the Meta Cloud API (v21.0) to send text and template messages
 * via WhatsApp Business.
 */

import type { ChannelProvider, ConnectConfig } from "../types.js";
import { fetchWithRetry } from "../../utils/fetch-retry.js";

/** Known WhatsApp Cloud API error codes. */
const WA_ERRORS: Record<number, string> = {
  131030: "rate_limit",
  131047: "re_engagement_required",
  131051: "unsupported_message_type",
};

/**
 * Create a WhatsApp channel provider backed by the Meta Cloud API.
 */
export function createWhatsAppProvider(config: ConnectConfig): ChannelProvider {
  const { whatsappToken, whatsappPhoneId } = config;

  if (!whatsappToken || !whatsappPhoneId) {
    throw new Error(
      "WhatsApp provider requires whatsappToken and whatsappPhoneId in ConnectConfig",
    );
  }

  const baseUrl = `https://graph.facebook.com/v21.0/${whatsappPhoneId}/messages`;

  return {
    name: "whatsapp-cloud",
    channel: "whatsapp",

    async send(to, body, options) {
      // Determine whether to send a template or free-form text message.
      // WhatsApp requires an approved template for first-contact (24-hour
      // window). Callers pass `template` and `templateComponents` in options
      // to trigger template mode.
      const isTemplate =
        options?.template && typeof options.template === "string";

      const payload = isTemplate
        ? {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
              name: options!.template as string,
              language: {
                code: (options?.language as string) ?? config.defaultLanguage ?? "en",
              },
              components: options?.templateComponents ?? [],
            },
          }
        : {
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body },
          };

      const response = await fetchWithRetry(
        baseUrl,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${whatsappToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
        {
          maxRetries: config.maxRetries ?? 2,
          baseDelayMs: config.retryDelayMs ?? 1_000,
        },
      );

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({})) as {
          error?: { code?: number; message?: string };
        };
        const code = errBody.error?.code;
        const label = code && WA_ERRORS[code] ? WA_ERRORS[code] : "error";
        throw new Error(
          `WhatsApp API error (${label}, HTTP ${response.status}): ${errBody.error?.message ?? "unknown"}`,
        );
      }

      const json = (await response.json()) as {
        messages?: Array<{ id: string }>;
      };

      const messageId = json.messages?.[0]?.id;
      if (!messageId) {
        throw new Error("WhatsApp API: no message ID in response");
      }

      // Status is always "sent" at dispatch time; real delivery status
      // arrives asynchronously via webhook.
      return { messageId, status: "sent" };
    },

    async getStatus(_messageId) {
      // WhatsApp delivery statuses arrive via webhook, not via polling.
      // Return "sent" as a sensible default; the webhook handler should
      // update the message record in the database.
      return "sent";
    },
  };
}
