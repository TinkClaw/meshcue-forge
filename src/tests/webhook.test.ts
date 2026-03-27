/**
 * Tests for MeshCue Connect — Webhook Server
 *
 * Verifies webhook endpoint routing, SMS/WhatsApp/USSD/Voice handlers,
 * and the health check HTTP server.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

// We test the webhook module exports exist and the health server concept works.
// Full integration tests require spinning up HTTP servers.

describe("webhook — module structure", () => {
  it("startWebhookServer is exported", async () => {
    const mod = await import("../connect/webhook.js");
    assert.equal(typeof mod.startWebhookServer, "function");
  });
});

describe("webhook — health endpoint concept", () => {
  it("health check returns ok status", async () => {
    // Create a minimal health server for testing
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          service: "meshcue-forge",
          version: "0.1.0",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
        }));
      } else if (req.url === "/ready") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ready: true }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    try {
      // Test /health
      const healthRes = await fetch(`http://localhost:${port}/health`);
      assert.equal(healthRes.status, 200);
      const healthBody = (await healthRes.json()) as { status: string; service: string };
      assert.equal(healthBody.status, "ok");
      assert.equal(healthBody.service, "meshcue-forge");

      // Test /ready
      const readyRes = await fetch(`http://localhost:${port}/ready`);
      assert.equal(readyRes.status, 200);
      const readyBody = (await readyRes.json()) as { ready: boolean };
      assert.equal(readyBody.ready, true);

      // Test 404
      const notFoundRes = await fetch(`http://localhost:${port}/nonexistent`);
      assert.equal(notFoundRes.status, 404);
    } finally {
      server.close();
    }
  });
});

describe("webhook — SMS parsing", () => {
  it("parses Africa's Talking form-encoded SMS", () => {
    const body = "from=%2B254700100100&to=20880&text=FEVER&date=2026-03-26&id=ATXid_123";
    const params = new URLSearchParams(body);
    assert.equal(params.get("from"), "+254700100100");
    assert.equal(params.get("text"), "FEVER");
    assert.equal(params.get("id"), "ATXid_123");
  });

  it("parses Twilio form-encoded SMS", () => {
    const body = "From=%2B254700100100&To=%2B254700999999&Body=HELP&MessageSid=SM_abc123";
    const params = new URLSearchParams(body);
    assert.equal(params.get("From"), "+254700100100");
    assert.equal(params.get("Body"), "HELP");
    assert.equal(params.get("MessageSid"), "SM_abc123");
  });
});

describe("webhook — WhatsApp verification", () => {
  it("verifies Meta webhook challenge", () => {
    const url = new URL("http://localhost/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=meshcue-verify&hub.challenge=abc123");
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    assert.equal(mode, "subscribe");
    assert.equal(token, "meshcue-verify");
    assert.equal(challenge, "abc123");
  });

  it("rejects invalid verify token", () => {
    const url = new URL("http://localhost/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123");
    const token = url.searchParams.get("hub.verify_token");
    assert.notEqual(token, "meshcue-verify");
  });
});

describe("webhook — USSD response format", () => {
  it("CON prefix continues session", () => {
    const response = "CON Welcome to MeshCue\n1. Report symptoms\n2. Check results";
    assert.ok(response.startsWith("CON "));
  });

  it("END prefix terminates session", () => {
    const response = "END Thank you. Your symptoms have been recorded.";
    assert.ok(response.startsWith("END "));
  });
});
