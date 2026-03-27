/**
 * MeshCue Connect — Delivery Manager with Channel Fallback Chain
 *
 * Tries to deliver messages through channels in priority order,
 * falling back to the next channel when one fails. Tracks every
 * delivery attempt and supports exponential-backoff retries for
 * messages that fail on all channels.
 */

import type {
  Channel,
  ChannelProvider,
  ConnectConfig,
  ConnectMessage,
} from "./types.js";

// ─── Public Types ────────────────────────────────────────────

export interface DeliveryAttempt {
  channel: Channel;
  status: "success" | "failed";
  error?: string;
  timestamp: string;
  durationMs: number;
}

export interface DeliveryResult {
  messageId: string;
  to: string; // recipient phone/address
  status: "delivered" | "queued" | "failed";
  channel: Channel; // which channel succeeded (or last attempted)
  attempts: DeliveryAttempt[];
  nextRetry?: string; // ISO date if queued
}

export interface DeliveryStats {
  pending: number;
  delivered: number;
  failed: number;
  retrying: number;
}

// ─── Constants ───────────────────────────────────────────────

const DEFAULT_CHANNEL_ORDER: Channel[] = ["sms", "whatsapp", "voice", "ussd"];
const RETRY_BACKOFF_MS = [
  1 * 60_000,       // 1 min
  5 * 60_000,       // 5 min
  30 * 60_000,      // 30 min
  2 * 60 * 60_000,  // 2 hr
  12 * 60 * 60_000, // 12 hr
];
const MAX_RETRIES = 5;

// ─── Internal Queue Entry ────────────────────────────────────

interface QueueEntry {
  message: ConnectMessage;
  config: ConnectConfig;
  retryCount: number;
  nextRetryAt: string; // ISO date
  result: DeliveryResult;
}

// ─── DeliveryManager ─────────────────────────────────────────

export class DeliveryManager {
  private providers: Map<Channel, ChannelProvider> = new Map();
  private results: Map<string, DeliveryResult> = new Map();
  private retryQueue: Map<string, QueueEntry> = new Map();

  /**
   * Register a channel provider the manager can use for delivery.
   */
  registerProvider(provider: ChannelProvider): void {
    this.providers.set(provider.channel, provider);
  }

  /**
   * Check whether a channel has a registered provider with credentials.
   * Providers that throw on construction when credentials are missing
   * will never appear in the map, so presence implies configured.
   */
  private isChannelConfigured(channel: Channel): boolean {
    return this.providers.has(channel);
  }

  /**
   * Resolve the ordered list of channels to attempt.
   */
  private resolveChannelOrder(config: ConnectConfig): Channel[] {
    return config.channelPriority ?? DEFAULT_CHANNEL_ORDER;
  }

  /**
   * Send a message, trying channels in priority order.
   * For critical messages, immediately escalate through the entire chain
   * without delay between attempts.
   */
  async send(
    message: ConnectMessage,
    config: ConnectConfig,
  ): Promise<DeliveryResult> {
    const channelOrder = this.resolveChannelOrder(config);
    const attempts: DeliveryAttempt[] = [];
    let successChannel: Channel | undefined;

    for (const channel of channelOrder) {
      if (!this.isChannelConfigured(channel)) {
        continue;
      }

      const provider = this.providers.get(channel)!;
      const start = Date.now();

      try {
        // Render body if missing
        const body = message.body ?? `Alert for patient ${message.patientId ?? "unknown"}`;

        await provider.send(message.to, body);

        const attempt: DeliveryAttempt = {
          channel,
          status: "success",
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - start,
        };
        attempts.push(attempt);
        successChannel = channel;
        break;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const attempt: DeliveryAttempt = {
          channel,
          status: "failed",
          error: errorMsg,
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - start,
        };
        attempts.push(attempt);
        // Continue to next channel
      }
    }

    if (successChannel) {
      const result: DeliveryResult = {
        messageId: message.id,
        to: message.to,
        status: "delivered",
        channel: successChannel,
        attempts,
      };
      this.results.set(message.id, result);
      return result;
    }

    // All channels failed — queue for retry
    const lastChannel = attempts.length > 0
      ? attempts[attempts.length - 1].channel
      : channelOrder[0] ?? "sms";

    const retryCount = 0;
    const nextRetryAt = this.computeNextRetry(retryCount);

    const result: DeliveryResult = {
      messageId: message.id,
      to: message.to,
      status: "queued",
      channel: lastChannel,
      attempts,
      nextRetry: nextRetryAt,
    };

    this.results.set(message.id, result);
    this.retryQueue.set(message.id, {
      message,
      config,
      retryCount,
      nextRetryAt,
      result,
    });

    return result;
  }

  /**
   * Look up the delivery result for a message.
   */
  getDeliveryStatus(messageId: string): DeliveryResult | undefined {
    return this.results.get(messageId);
  }

  /**
   * Retry all queued messages whose nextRetryAt has passed.
   * Returns the number of messages retried.
   */
  async retryFailed(): Promise<number> {
    const now = Date.now();
    let retriedCount = 0;

    const entries = Array.from(this.retryQueue.entries());

    for (const [messageId, entry] of entries) {
      const retryTime = new Date(entry.nextRetryAt).getTime();
      if (retryTime > now) {
        continue;
      }

      // Remove from retry queue before attempting
      this.retryQueue.delete(messageId);

      const channelOrder = this.resolveChannelOrder(entry.config);
      const attempts: DeliveryAttempt[] = [];
      let successChannel: Channel | undefined;

      for (const channel of channelOrder) {
        if (!this.isChannelConfigured(channel)) {
          continue;
        }

        const provider = this.providers.get(channel)!;
        const start = Date.now();

        try {
          const body = entry.message.body ?? `Alert for patient ${entry.message.patientId ?? "unknown"}`;
          await provider.send(entry.message.to, body);

          attempts.push({
            channel,
            status: "success",
            timestamp: new Date().toISOString(),
            durationMs: Date.now() - start,
          });
          successChannel = channel;
          break;
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          attempts.push({
            channel,
            status: "failed",
            error: errorMsg,
            timestamp: new Date().toISOString(),
            durationMs: Date.now() - start,
          });
        }
      }

      const existingResult = this.results.get(messageId)!;
      existingResult.attempts.push(...attempts);

      if (successChannel) {
        existingResult.status = "delivered";
        existingResult.channel = successChannel;
        delete existingResult.nextRetry;
      } else {
        const newRetryCount = entry.retryCount + 1;

        if (newRetryCount >= MAX_RETRIES) {
          existingResult.status = "failed";
          delete existingResult.nextRetry;
        } else {
          const nextRetryAt = this.computeNextRetry(newRetryCount);
          existingResult.status = "queued";
          existingResult.nextRetry = nextRetryAt;

          this.retryQueue.set(messageId, {
            ...entry,
            retryCount: newRetryCount,
            nextRetryAt,
            result: existingResult,
          });
        }
      }

      retriedCount++;
    }

    return retriedCount;
  }

  /**
   * Aggregate stats across all tracked deliveries.
   */
  getStats(): DeliveryStats {
    let pending = 0;
    let delivered = 0;
    let failed = 0;
    let retrying = 0;

    for (const result of this.results.values()) {
      switch (result.status) {
        case "delivered":
          delivered++;
          break;
        case "queued":
          retrying++;
          break;
        case "failed":
          failed++;
          break;
      }
    }

    // pending = messages in retry queue that haven't reached their retry time yet
    const now = Date.now();
    for (const entry of this.retryQueue.values()) {
      if (new Date(entry.nextRetryAt).getTime() > now) {
        pending++;
      }
    }

    return { pending, delivered, failed, retrying };
  }

  // ─── Helpers ──────────────────────────────────────────────

  private computeNextRetry(retryCount: number): string {
    const delayMs = RETRY_BACKOFF_MS[Math.min(retryCount, RETRY_BACKOFF_MS.length - 1)];
    return new Date(Date.now() + delayMs).toISOString();
  }
}
