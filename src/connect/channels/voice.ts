/**
 * MeshCue Connect — Voice / IVR Provider (Africa's Talking)
 *
 * Used ONLY for critical/emergency alerts where SMS alone is
 * insufficient. If the voice call fails, an SMS is sent as fallback.
 */

import type { ChannelProvider, ConnectConfig } from "../types.js";
import { fetchWithRetry } from "../../utils/fetch-retry.js";
import { createSMSProvider } from "./sms.js";

function atVoiceBaseUrl(username: string): string {
  return username === "sandbox"
    ? "https://voice.sandbox.africastalking.com"
    : "https://voice.africastalking.com";
}

/**
 * Create a voice channel provider backed by Africa's Talking Voice API.
 *
 * On failure, the provider automatically falls back to SMS so that
 * critical alerts are never silently lost.
 */
export function createVoiceProvider(config: ConnectConfig): ChannelProvider {
  const { atApiKey, atUsername, atShortCode } = config;

  if (!atApiKey || !atUsername) {
    throw new Error(
      "Voice provider requires atApiKey and atUsername in ConnectConfig",
    );
  }

  const baseUrl = atVoiceBaseUrl(atUsername);

  // Lazy-init SMS fallback only when needed
  let smsFallback: ChannelProvider | null = null;
  function getSMSFallback(): ChannelProvider {
    if (!smsFallback) {
      smsFallback = createSMSProvider(config);
    }
    return smsFallback;
  }

  return {
    name: "africastalking-voice",
    channel: "voice",

    async send(to, body, options) {
      const callUrl = `${baseUrl}/call`;

      const params = new URLSearchParams();
      params.set("username", atUsername);
      params.set("to", to);
      if (atShortCode) {
        params.set("from", atShortCode);
      }

      // If a callbackUrl is provided, AT will POST call events there.
      // Otherwise, callers should set up a global callback in the AT dashboard.
      if (options?.callbackUrl) {
        params.set("callbackUrl", String(options.callbackUrl));
      }

      try {
        const response = await fetchWithRetry(
          callUrl,
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
            maxRetries: 1, // Voice is expensive; limit retries
            baseDelayMs: config.retryDelayMs ?? 1_000,
          },
        );

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          throw new Error(
            `Africa's Talking Voice API error (HTTP ${response.status}): ${errText}`,
          );
        }

        const json = (await response.json()) as {
          entries?: Array<{
            phoneNumber: string;
            status: string;
            sessionId: string;
          }>;
          errorMessage?: string;
        };

        const entry = json.entries?.[0];
        if (!entry || entry.status === "InvalidPhoneNumber") {
          throw new Error(
            `Voice call failed: ${entry?.status ?? json.errorMessage ?? "no entry returned"}`,
          );
        }

        // The sessionId serves as our messageId for the voice channel.
        // The TTS content (`body`) is spoken when AT triggers the callback
        // and the server responds with the <Say> action XML:
        //
        //   <Response>
        //     <Say voice="en-US-Standard-A">${body}</Say>
        //   </Response>
        //
        // The callback handler is responsible for returning this XML.
        // We store the body in options so upstream can persist it for
        // the callback.

        return {
          messageId: entry.sessionId,
          status: entry.status === "Queued" ? "queued" : entry.status,
        };
      } catch (err: unknown) {
        // --- SMS Fallback ---
        // Voice failed; send critical message via SMS instead.
        console.error(
          `[MeshCue Connect] Voice call to ${to} failed, falling back to SMS:`,
          err instanceof Error ? err.message : err,
        );

        try {
          const sms = getSMSFallback();
          const result = await sms.send(
            to,
            `[URGENT] ${body}`,
            options,
          );
          return {
            messageId: result.messageId,
            status: `sms_fallback:${result.status}`,
          };
        } catch (smsErr: unknown) {
          // Both voice and SMS failed
          throw new Error(
            `Voice call and SMS fallback both failed for ${to}. ` +
              `Voice: ${err instanceof Error ? err.message : String(err)}. ` +
              `SMS: ${smsErr instanceof Error ? smsErr.message : String(smsErr)}`,
          );
        }
      }
    },

    async getStatus(messageId) {
      // Query AT voice call status using the session/call ID
      const url = `${baseUrl}/callStatus`;

      const params = new URLSearchParams();
      params.set("username", atUsername);
      params.set("sessionId", messageId);

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
        { maxRetries: 1 },
      );

      if (!response.ok) {
        return "unknown";
      }

      try {
        const json = (await response.json()) as {
          entries?: Array<{
            status: string;
            isActive: string;
          }>;
        };

        const entry = json.entries?.[0];
        if (!entry) return "unknown";

        return entry.status ?? "unknown";
      } catch {
        return "unknown";
      }
    },
  };
}

/**
 * Generate the Africa's Talking Voice XML response for a TTS message.
 *
 * Use this in your callback endpoint when AT POSTs to your callbackUrl:
 *
 * ```ts
 * app.post("/voice/callback", (req, res) => {
 *   const message = lookupMessageForSession(req.body.sessionId);
 *   res.set("Content-Type", "application/xml");
 *   res.send(buildSayResponse(message.body));
 * });
 * ```
 */
export function buildSayResponse(
  text: string,
  voice = "en-US-Standard-A",
): string {
  // Escape XML special characters
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">${escaped}</Say>
</Response>`;
}
