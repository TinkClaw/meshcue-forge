/**
 * MeshCue Connect — Auth, Rate Limiting & Audit Tests
 *
 * Tests API key generation/validation, token-bucket rate limiting,
 * cross-clinic isolation, audit logging, and backward compatibility.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ClinicAuth,
  RateLimiter,
  AuditLogger,
  authenticateToolCall,
  type AuditEntry,
} from "../connect/auth.js";

// ═══════════════════════════════════════════════════════════════
// ClinicAuth
// ═══════════════════════════════════════════════════════════════

describe("ClinicAuth", () => {
  let auth: ClinicAuth;

  beforeEach(() => {
    auth = new ClinicAuth();
  });

  it("generates API keys with mq_live_ prefix", () => {
    const key = auth.generateApiKey("clinic_001");
    assert.ok(key.startsWith("mq_live_"), `Key should start with mq_live_, got: ${key}`);
    assert.ok(key.length > 20, "Key should be long enough to be secure");
  });

  it("validates a freshly-generated key", () => {
    const key = auth.generateApiKey("clinic_001");
    const result = auth.validateApiKey(key);
    assert.equal(result.valid, true);
    assert.equal(result.clinicId, "clinic_001");
  });

  it("rejects an invalid key", () => {
    const result = auth.validateApiKey("mq_live_invalid_key_that_doesnt_exist");
    assert.equal(result.valid, false);
    assert.equal(result.clinicId, undefined);
  });

  it("rejects keys without the mq_live_ prefix", () => {
    const result = auth.validateApiKey("some_random_key");
    assert.equal(result.valid, false);
  });

  it("rejects empty string", () => {
    const result = auth.validateApiKey("");
    assert.equal(result.valid, false);
  });

  it("hashApiKey produces consistent SHA-256 hex", () => {
    const hash1 = auth.hashApiKey("test_key");
    const hash2 = auth.hashApiKey("test_key");
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64); // SHA-256 hex is 64 chars
  });

  it("hashApiKey produces different hashes for different inputs", () => {
    const h1 = auth.hashApiKey("key_a");
    const h2 = auth.hashApiKey("key_b");
    assert.notEqual(h1, h2);
  });

  it("generateApiKey revokes old key on re-generation", () => {
    const key1 = auth.generateApiKey("clinic_001");
    const key2 = auth.generateApiKey("clinic_001");

    // Old key should be invalid
    assert.equal(auth.validateApiKey(key1).valid, false);
    // New key should be valid
    assert.equal(auth.validateApiKey(key2).valid, true);
    assert.equal(auth.validateApiKey(key2).clinicId, "clinic_001");
  });

  it("clinicHasKey returns true when key exists", () => {
    auth.generateApiKey("clinic_001");
    assert.equal(auth.clinicHasKey("clinic_001"), true);
    assert.equal(auth.clinicHasKey("clinic_002"), false);
  });

  it("revokeKey removes the key", () => {
    const key = auth.generateApiKey("clinic_001");
    assert.equal(auth.revokeKey("clinic_001"), true);
    assert.equal(auth.validateApiKey(key).valid, false);
    assert.equal(auth.clinicHasKey("clinic_001"), false);
  });

  it("revokeKey returns false for non-existent clinic", () => {
    assert.equal(auth.revokeKey("clinic_nonexistent"), false);
  });

  // Cross-clinic isolation
  it("clinic A key cannot authenticate as clinic B", () => {
    const keyA = auth.generateApiKey("clinic_A");
    auth.generateApiKey("clinic_B");

    const result = auth.validateApiKey(keyA);
    assert.equal(result.valid, true);
    assert.equal(result.clinicId, "clinic_A");
    // The key maps to clinic_A, not clinic_B
    assert.notEqual(result.clinicId, "clinic_B");
  });

  it("each clinic gets a unique key", () => {
    const keyA = auth.generateApiKey("clinic_A");
    const keyB = auth.generateApiKey("clinic_B");
    assert.notEqual(keyA, keyB);
  });
});

// ═══════════════════════════════════════════════════════════════
// authenticateToolCall
// ═══════════════════════════════════════════════════════════════

describe("authenticateToolCall", () => {
  let auth: ClinicAuth;

  beforeEach(() => {
    auth = new ClinicAuth();
  });

  it("allows unauthenticated access when clinic has no key (dev mode)", () => {
    const result = authenticateToolCall(auth, "clinic_001");
    assert.notEqual(typeof result, "string");
    if (typeof result !== "string") {
      assert.equal(result.clinicId, "clinic_001");
      assert.equal(result.authenticated, false);
      assert.equal(result.warning, undefined);
    }
  });

  it("allows authenticated access with valid key", () => {
    const key = auth.generateApiKey("clinic_001");
    const result = authenticateToolCall(auth, "clinic_001", key);
    assert.notEqual(typeof result, "string");
    if (typeof result !== "string") {
      assert.equal(result.authenticated, true);
    }
  });

  it("rejects invalid key", () => {
    auth.generateApiKey("clinic_001");
    const result = authenticateToolCall(auth, "clinic_001", "mq_live_wrong");
    assert.equal(typeof result, "string"); // error message
  });

  it("rejects key from different clinic", () => {
    const keyA = auth.generateApiKey("clinic_A");
    auth.generateApiKey("clinic_B");
    const result = authenticateToolCall(auth, "clinic_B", keyA);
    assert.equal(typeof result, "string");
    assert.ok((result as string).includes("does not match"));
  });

  it("warns when clinic has key but none provided (backward compat)", () => {
    auth.generateApiKey("clinic_001");
    const result = authenticateToolCall(auth, "clinic_001");
    assert.notEqual(typeof result, "string");
    if (typeof result !== "string") {
      assert.equal(result.authenticated, false);
      assert.ok(result.warning, "Should have a warning about missing key");
      assert.ok(result.warning!.includes("No API key provided"));
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// RateLimiter
// ═══════════════════════════════════════════════════════════════

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  it("allows requests within the free tier limit", () => {
    for (let i = 0; i < 10; i++) {
      const result = limiter.checkLimit("clinic_001", "api", "free");
      assert.equal(result.allowed, true, `Request ${i + 1} should be allowed`);
      limiter.recordUsage("clinic_001", "api");
    }
  });

  it("blocks requests exceeding the free tier API limit", () => {
    // Free tier: 10 req/min
    // Drain the bucket
    for (let i = 0; i < 10; i++) {
      limiter.checkLimit("clinic_001", "api", "free");
      limiter.recordUsage("clinic_001", "api");
    }

    const result = limiter.checkLimit("clinic_001", "api", "free");
    assert.equal(result.allowed, false);
    assert.ok(
      result.retryAfterMs !== undefined && result.retryAfterMs > 0,
      "Should provide retryAfterMs"
    );
  });

  it("allows higher burst for professional tier", () => {
    // Professional: 200 req/min
    for (let i = 0; i < 50; i++) {
      const result = limiter.checkLimit("clinic_pro", "api", "professional");
      assert.equal(result.allowed, true, `Request ${i + 1} should be allowed`);
      limiter.recordUsage("clinic_pro", "api");
    }
  });

  it("enterprise tier allows 1000 req/min", () => {
    // Just check it starts with a large bucket
    const result = limiter.checkLimit("clinic_ent", "api", "enterprise");
    assert.equal(result.allowed, true);
  });

  it("daily message limit blocks at threshold for free tier", () => {
    // Free: 500 msg/day
    for (let i = 0; i < 500; i++) {
      const result = limiter.checkLimit("clinic_001", "message", "free");
      assert.equal(result.allowed, true);
      limiter.recordUsage("clinic_001", "message");
    }

    const result = limiter.checkLimit("clinic_001", "message", "free");
    assert.equal(result.allowed, false);
  });

  it("enterprise tier has unlimited daily messages", () => {
    // Record a bunch and it should still be allowed
    for (let i = 0; i < 100; i++) {
      limiter.recordUsage("clinic_ent", "message");
    }
    const result = limiter.checkLimit("clinic_ent", "message", "enterprise");
    assert.equal(result.allowed, true);
  });

  it("rate limits are per-clinic (isolation)", () => {
    // Drain clinic_A
    for (let i = 0; i < 10; i++) {
      limiter.checkLimit("clinic_A", "api", "free");
      limiter.recordUsage("clinic_A", "api");
    }
    const blockedA = limiter.checkLimit("clinic_A", "api", "free");
    assert.equal(blockedA.allowed, false);

    // clinic_B should still be fine
    const okB = limiter.checkLimit("clinic_B", "api", "free");
    assert.equal(okB.allowed, true);
  });

  it("defaults to free tier when unknown tier is provided", () => {
    // Should work like free tier (10 req/min)
    for (let i = 0; i < 10; i++) {
      limiter.checkLimit("clinic_x", "api", "unknown_tier");
      limiter.recordUsage("clinic_x", "api");
    }
    const result = limiter.checkLimit("clinic_x", "api", "unknown_tier");
    assert.equal(result.allowed, false);
  });
});

// ═══════════════════════════════════════════════════════════════
// AuditLogger
// ═══════════════════════════════════════════════════════════════

describe("AuditLogger", () => {
  let logger: AuditLogger;

  function makeEntry(
    clinicId: string,
    overrides?: Partial<AuditEntry>
  ): AuditEntry {
    return {
      id: `entry_${Math.random().toString(36).slice(2)}`,
      timestamp: new Date().toISOString(),
      clinicId,
      action: "tool_call",
      tool: "meshcue-clinic-dashboard",
      success: true,
      apiKeyUsed: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    logger = new AuditLogger(100); // small buffer for testing
  });

  it("logs and retrieves entries for a clinic", () => {
    logger.log(makeEntry("clinic_001"));
    logger.log(makeEntry("clinic_001"));
    logger.log(makeEntry("clinic_002"));

    const entries = logger.getAuditLog("clinic_001");
    assert.equal(entries.length, 2);
  });

  it("returns entries newest-first", () => {
    const e1 = makeEntry("clinic_001", {
      timestamp: "2026-03-26T10:00:00Z",
    });
    const e2 = makeEntry("clinic_001", {
      timestamp: "2026-03-26T11:00:00Z",
    });
    logger.log(e1);
    logger.log(e2);

    const entries = logger.getAuditLog("clinic_001");
    assert.equal(entries.length, 2);
    // Newest first
    assert.ok(
      new Date(entries[0].timestamp).getTime() >=
        new Date(entries[1].timestamp).getTime()
    );
  });

  it("respects limit parameter", () => {
    for (let i = 0; i < 20; i++) {
      logger.log(makeEntry("clinic_001"));
    }

    const entries = logger.getAuditLog("clinic_001", { limit: 5 });
    assert.equal(entries.length, 5);
  });

  it("filters by since parameter", () => {
    logger.log(
      makeEntry("clinic_001", { timestamp: "2026-03-25T10:00:00Z" })
    );
    logger.log(
      makeEntry("clinic_001", { timestamp: "2026-03-26T10:00:00Z" })
    );
    logger.log(
      makeEntry("clinic_001", { timestamp: "2026-03-27T10:00:00Z" })
    );

    const entries = logger.getAuditLog("clinic_001", {
      since: "2026-03-26T00:00:00Z",
    });
    assert.equal(entries.length, 2);
  });

  it("ring buffer evicts old entries when full", () => {
    const smallLogger = new AuditLogger(5);

    for (let i = 0; i < 10; i++) {
      smallLogger.log(
        makeEntry("clinic_001", { action: `action_${i}` })
      );
    }

    assert.equal(smallLogger.size, 5);
    const entries = smallLogger.getAuditLog("clinic_001");
    // Should have the last 5 entries
    assert.equal(entries.length, 5);
  });

  it("isolates audit logs between clinics", () => {
    logger.log(
      makeEntry("clinic_A", { action: "action_A" })
    );
    logger.log(
      makeEntry("clinic_B", { action: "action_B" })
    );

    const entriesA = logger.getAuditLog("clinic_A");
    assert.equal(entriesA.length, 1);
    assert.equal(entriesA[0].action, "action_A");

    const entriesB = logger.getAuditLog("clinic_B");
    assert.equal(entriesB.length, 1);
    assert.equal(entriesB[0].action, "action_B");
  });

  it("tracks apiKeyUsed field", () => {
    logger.log(makeEntry("clinic_001", { apiKeyUsed: true }));
    logger.log(makeEntry("clinic_001", { apiKeyUsed: false }));

    const entries = logger.getAuditLog("clinic_001");
    const withKey = entries.filter((e) => e.apiKeyUsed);
    const withoutKey = entries.filter((e) => !e.apiKeyUsed);
    assert.equal(withKey.length, 1);
    assert.equal(withoutKey.length, 1);
  });

  it("returns empty array for unknown clinic", () => {
    const entries = logger.getAuditLog("nonexistent");
    assert.equal(entries.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Backward Compatibility
// ═══════════════════════════════════════════════════════════════

describe("Backward Compatibility", () => {
  it("tools work without apiKey when clinic has no key (dev mode)", () => {
    const auth = new ClinicAuth();
    // No key generated for clinic_001
    const result = authenticateToolCall(auth, "clinic_001");
    assert.notEqual(typeof result, "string");
    if (typeof result !== "string") {
      assert.equal(result.clinicId, "clinic_001");
      assert.equal(result.authenticated, false);
      assert.equal(result.warning, undefined); // no warning in dev mode
    }
  });

  it("tools warn but allow when clinic has key and none provided", () => {
    const auth = new ClinicAuth();
    auth.generateApiKey("clinic_001");

    const result = authenticateToolCall(auth, "clinic_001");
    assert.notEqual(typeof result, "string"); // not an error
    if (typeof result !== "string") {
      assert.equal(result.authenticated, false);
      assert.ok(result.warning);
    }
  });

  it("rate limiter allows first request without prior setup", () => {
    const limiter = new RateLimiter();
    const result = limiter.checkLimit("brand_new_clinic", "api", "free");
    assert.equal(result.allowed, true);
  });
});
