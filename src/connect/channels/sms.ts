/**
 * MeshCue Connect — Africa's Talking SMS Provider
 *
 * Sends SMS via AT REST API with retry, error classification,
 * and sandbox support.
 */

import type { ChannelProvider, ConnectConfig } from "../types.js";
import { fetchWithRetry } from "../../utils/fetch-retry.js";

/** Africa's Talking status codes */
const AT_STATUS: Record<number, string> = {
  100: "processed",
  101: "sent",
  102: "queued",
  401: "risk_hold",
  403: "invalid_request",
  405: "internal_error",
  406: "insufficient_balance",
  407: "invalid_phone",
  500: "internal_error",
  501: "gateway_error",
  502: "rejected",
};

function atBaseUrl(username: string): string {
  return username === "sandbox"
    ? "https://api.sandbox.africastalking.com"
    : "https://api.africastalking.com";
}

/**
 * Create an SMS channel provider backed by Africa's Talking.
 *
 * When `config.atUsername` is `"sandbox"`, requests are routed to
 * the AT sandbox environment automatically.
 */
export function createSMSProvider(config: ConnectConfig): ChannelProvider {
  const { atApiKey, atUsername, atShortCode } = config;

  if (!atApiKey || !atUsername) {
    throw new Error(
      "SMS provider requires atApiKey and atUsername in ConnectConfig",
    );
  }

  const baseUrl = atBaseUrl(atUsername);

  return {
    name: "africastalking-sms",
    channel: "sms",

    async send(to, body, options) {
      const url = `${baseUrl}/version1/messaging`;

      const params = new URLSearchParams();
      params.set("username", atUsername);
      params.set("to", to);
      params.set("message", body);
      if (atShortCode) {
        params.set("from", atShortCode);
      }
      // Allow callers to pass extra AT parameters (e.g., bulkSMSMode, enqueue)
      if (options) {
        for (const [key, val] of Object.entries(options)) {
          if (val !== undefined && val !== null) {
            params.set(key, String(val));
          }
        }
      }

      const response = await fetchWithRetry(
        url,
        {
          method: "POST",
          headers: {
            apiKey: atApiKey,
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        },
        {
          maxRetries: config.maxRetries ?? 2,
          baseDelayMs: config.retryDelayMs ?? 1_000,
        },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `Africa's Talking SMS API error (HTTP ${response.status}): ${text}`,
        );
      }

      const json = (await response.json()) as {
        SMSMessageData?: {
          Recipients?: Array<{
            messageId: string;
            statusCode: number;
            status: string;
            number: string;
            cost: string;
          }>;
          Message?: string;
        };
      };

      const recipient = json.SMSMessageData?.Recipients?.[0];
      if (!recipient) {
        throw new Error(
          `Africa's Talking SMS: unexpected response — ${json.SMSMessageData?.Message ?? "no recipients"}`,
        );
      }

      const statusCode = recipient.statusCode;
      const mappedStatus = AT_STATUS[statusCode] ?? "unknown";

      if (statusCode >= 400) {
        throw new Error(
          `Africa's Talking SMS failed for ${to}: ${mappedStatus} (code ${statusCode})`,
        );
      }

      return {
        messageId: recipient.messageId,
        status: mappedStatus,
      };
    },

    async getStatus(messageId) {
      // AT does not have a simple GET-by-messageId endpoint; delivery reports
      // come via callback. We query the delivery report API with the messageId.
      const url = `${baseUrl}/version1/messaging?username=${encodeURIComponent(atUsername)}&messageId=${encodeURIComponent(messageId)}`;

      const response = await fetchWithRetry(
        url,
        {
          method: "GET",
          headers: {
            apiKey: atApiKey,
            Accept: "application/json",
          },
        },
        { maxRetries: 1 },
      );

      if (!response.ok) {
        return "unknown";
      }

      try {
        const json = (await response.json()) as {
          SMSMessageData?: {
            Recipients?: Array<{
              statusCode: number;
              status: string;
            }>;
          };
        };

        const recipient = json.SMSMessageData?.Recipients?.[0];
        if (!recipient) return "unknown";

        return AT_STATUS[recipient.statusCode] ?? recipient.status ?? "unknown";
      } catch {
        return "unknown";
      }
    },
  };
}
