/**
 * MeshCue Connect — Authentication, Authorization & Rate Limiting
 *
 * Provides API key management, token-bucket rate limiting, and audit logging
 * for multi-tenant clinic operations. Designed for backward compatibility:
 * tools still work without apiKey when the clinic has no key set (dev mode).
 */

import { createHash, randomBytes } from "node:crypto";

// ─── Types ─────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  timestamp: string;
  clinicId: string;
  action: string;
  tool: string;
  success: boolean;
  apiKeyUsed: boolean;
  metadata?: Record<string, unknown>;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

export interface ApiKeyValidation {
  valid: boolean;
  clinicId?: string;
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

interface DailyCounter {
  count: number;
  resetAt: number; // epoch ms of next midnight
}

// Rate limits per tier: [requests per minute, messages per day]
// -1 means unlimited
const RATE_LIMITS: Record<string, { reqPerMin: number; msgPerDay: number }> = {
  free:         { reqPerMin: 10,   msgPerDay: 500 },
  basic:        { reqPerMin: 60,   msgPerDay: 5000 },
  professional: { reqPerMin: 200,  msgPerDay: 20000 },
  enterprise:   { reqPerMin: 1000, msgPerDay: -1 },
};

// ─── ClinicAuth ────────────────────────────────────────────────

export class ClinicAuth {
  // Map of hashed API key -> clinicId
  private keyIndex: Map<string, string> = new Map();
  // Map of clinicId -> hashed API key (for rotation/revocation)
  private clinicKeys: Map<string, string> = new Map();

  /**
   * Generate a new API key for a clinic. Returns the raw key (only shown once).
   * The hashed version is stored internally.
   */
  generateApiKey(clinicId: string): string {
    // Revoke any existing key first
    const existingHash = this.clinicKeys.get(clinicId);
    if (existingHash) {
      this.keyIndex.delete(existingHash);
    }

    // Generate a random key with mq_live_ prefix
    const rawBytes = randomBytes(32).toString("hex");
    const apiKey = `mq_live_${rawBytes}`;

    // Store the hash
    const hash = this.hashApiKey(apiKey);
    this.keyIndex.set(hash, clinicId);
    this.clinicKeys.set(clinicId, hash);

    return apiKey;
  }

  /**
   * Validate an API key and return the associated clinic ID.
   */
  validateApiKey(apiKey: string): ApiKeyValidation {
    if (!apiKey || !apiKey.startsWith("mq_live_")) {
      return { valid: false };
    }

    const hash = this.hashApiKey(apiKey);
    const clinicId = this.keyIndex.get(hash);

    if (!clinicId) {
      return { valid: false };
    }

    return { valid: true, clinicId };
  }

  /**
   * One-way SHA-256 hash for API key storage.
   */
  hashApiKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  /**
   * Check whether a clinic has an API key set (used for enforcement decisions).
   */
  clinicHasKey(clinicId: string): boolean {
    return this.clinicKeys.has(clinicId);
  }

  /**
   * Revoke a clinic's API key.
   */
  revokeKey(clinicId: string): boolean {
    const hash = this.clinicKeys.get(clinicId);
    if (!hash) return false;
    this.keyIndex.delete(hash);
    this.clinicKeys.delete(clinicId);
    return true;
  }
}

// ─── RateLimiter ───────────────────────────────────────────────

export class RateLimiter {
  // Token buckets for API rate limiting (per clinic)
  private apiBuckets: Map<string, TokenBucket> = new Map();
  // Daily message counters (per clinic)
  private dailyCounters: Map<string, DailyCounter> = new Map();

  /**
   * Check if a clinic is within its rate limits for the given action.
   */
  checkLimit(
    clinicId: string,
    action: "api" | "message",
    tier: string = "free"
  ): RateLimitResult {
    const limits = RATE_LIMITS[tier] || RATE_LIMITS.free;

    if (action === "api") {
      return this.checkApiBucket(clinicId, limits.reqPerMin);
    } else {
      return this.checkDailyMessage(clinicId, limits.msgPerDay);
    }
  }

  /**
   * Record usage after a successful operation.
   */
  recordUsage(clinicId: string, action: "api" | "message"): void {
    if (action === "api") {
      const bucket = this.apiBuckets.get(clinicId);
      if (bucket && bucket.tokens > 0) {
        bucket.tokens--;
      }
    } else {
      const counter = this.getOrCreateDailyCounter(clinicId);
      counter.count++;
    }
  }

  private checkApiBucket(clinicId: string, maxPerMin: number): RateLimitResult {
    const now = Date.now();
    let bucket = this.apiBuckets.get(clinicId);

    if (!bucket) {
      bucket = { tokens: maxPerMin, lastRefill: now };
      this.apiBuckets.set(clinicId, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const refillRate = maxPerMin / 60000; // tokens per ms
    const tokensToAdd = elapsed * refillRate;
    bucket.tokens = Math.min(maxPerMin, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      // Calculate how long until one token is available
      const msUntilToken = (1 - bucket.tokens) / refillRate;
      return { allowed: false, retryAfterMs: Math.ceil(msUntilToken) };
    }

    return { allowed: true };
  }

  private checkDailyMessage(clinicId: string, maxPerDay: number): RateLimitResult {
    if (maxPerDay === -1) {
      return { allowed: true }; // unlimited
    }

    const counter = this.getOrCreateDailyCounter(clinicId);
    const now = Date.now();

    // Reset if we've passed midnight
    if (now >= counter.resetAt) {
      counter.count = 0;
      counter.resetAt = this.nextMidnight();
    }

    if (counter.count >= maxPerDay) {
      return {
        allowed: false,
        retryAfterMs: counter.resetAt - now,
      };
    }

    return { allowed: true };
  }

  private getOrCreateDailyCounter(clinicId: string): DailyCounter {
    let counter = this.dailyCounters.get(clinicId);
    if (!counter) {
      counter = { count: 0, resetAt: this.nextMidnight() };
      this.dailyCounters.set(clinicId, counter);
    }
    return counter;
  }

  private nextMidnight(): number {
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  /**
   * Expose bucket state for testing.
   */
  _getBucket(clinicId: string): TokenBucket | undefined {
    return this.apiBuckets.get(clinicId);
  }

  /**
   * Expose daily counter for testing.
   */
  _getDailyCounter(clinicId: string): DailyCounter | undefined {
    return this.dailyCounters.get(clinicId);
  }
}

// ─── AuditLogger ───────────────────────────────────────────────

export class AuditLogger {
  private buffer: AuditEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries: number = 10000) {
    this.maxEntries = maxEntries;
  }

  /**
   * Log an audit entry. Old entries are evicted when the buffer is full.
   */
  log(entry: AuditEntry): void {
    if (this.buffer.length >= this.maxEntries) {
      // Ring buffer: drop oldest entries
      this.buffer = this.buffer.slice(this.buffer.length - this.maxEntries + 1);
    }
    this.buffer.push(entry);
  }

  /**
   * Retrieve audit log entries for a clinic, optionally filtered.
   */
  getAuditLog(
    clinicId: string,
    options?: { limit?: number; since?: string }
  ): AuditEntry[] {
    let entries = this.buffer.filter((e) => e.clinicId === clinicId);

    if (options?.since) {
      const sinceTime = new Date(options.since).getTime();
      entries = entries.filter(
        (e) => new Date(e.timestamp).getTime() >= sinceTime
      );
    }

    // Return newest first
    entries = entries.reverse();

    if (options?.limit && options.limit > 0) {
      entries = entries.slice(0, options.limit);
    }

    return entries;
  }

  /**
   * Get total entry count (for testing).
   */
  get size(): number {
    return this.buffer.length;
  }
}

// ─── Auth Middleware Helper ────────────────────────────────────

export interface AuthContext {
  clinicId: string;
  authenticated: boolean;
  warning?: string;
}

/**
 * Validates an API key for a tool call. Returns an AuthContext or an error string.
 *
 * Rules:
 * - If the clinic has an API key set and apiKey is provided: validate and match clinicId
 * - If the clinic has an API key set and apiKey is NOT provided: warn but allow (backward compat)
 * - If the clinic has no API key: allow without auth (dev mode)
 */
export function authenticateToolCall(
  auth: ClinicAuth,
  clinicId: string,
  apiKey?: string
): AuthContext | string {
  const hasKey = auth.clinicHasKey(clinicId);

  if (apiKey) {
    // API key provided — validate it
    const validation = auth.validateApiKey(apiKey);
    if (!validation.valid) {
      return "Invalid API key.";
    }
    if (validation.clinicId !== clinicId) {
      return "API key does not match the requested clinic.";
    }
    return { clinicId, authenticated: true };
  }

  if (hasKey) {
    // Clinic has a key but none was provided — backward compat warning
    return {
      clinicId,
      authenticated: false,
      warning:
        "No API key provided. This clinic has an API key configured. " +
        "In production, all requests must include an apiKey.",
    };
  }

  // No key set on clinic — dev mode, allow freely
  return { clinicId, authenticated: false };
}
