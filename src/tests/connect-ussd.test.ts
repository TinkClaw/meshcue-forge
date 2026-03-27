/**
 * Tests for MeshCue Connect — USSD Menu Handler
 *
 * Validates the USSD navigation tree: main menu, symptom reporting,
 * appointment booking, emergency escalation, language selection,
 * invalid input handling, and session state tracking.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  USSDHandler,
  createUSSDHandler,
} from "../connect/channels/ussd.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const testPhone = "+254700100100";
let sessionCounter = 0;

function nextSessionId(): string {
  return `sess-${++sessionCounter}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Main menu
// ---------------------------------------------------------------------------

describe("connect USSD — main menu", () => {
  it("empty text returns main menu", async () => {
    const handler = createUSSDHandler();
    const sessionId = nextSessionId();
    const response = await handler.handleRequest(sessionId, testPhone, "");

    assert.ok(response.response.length > 0, "Should return menu text");
    // Main menu should present numbered options
    assert.ok(
      response.response.includes("1") && response.response.includes("2"),
      "Main menu should contain numbered options",
    );
    // Should be a CON (continue) response, not END
    assert.equal(response.endSession, false, "Main menu should keep session open");
  });
});

// ---------------------------------------------------------------------------
// Symptom reporting
// ---------------------------------------------------------------------------

describe("connect USSD — symptom menu", () => {
  it("1 returns symptom menu", async () => {
    const handler = createUSSDHandler();
    const sessionId = nextSessionId();
    // First call to initialize session
    await handler.handleRequest(sessionId, testPhone, "");
    // Navigate to symptom menu
    const response = await handler.handleRequest(sessionId, testPhone, "1");

    assert.ok(response.response.length > 0, "Should return symptom menu text");
    // Should list symptom options (fever, etc.)
    assert.ok(
      response.response.includes("1") ||
        response.response.toLowerCase().includes("fever") ||
        response.response.toLowerCase().includes("symptom"),
      "Symptom menu should list symptom options",
    );
    assert.equal(response.endSession, false, "Symptom menu should keep session open");
  });

  it("1*1 (fever) returns confirmation", async () => {
    const handler = createUSSDHandler();
    const sessionId = nextSessionId();
    const response = await handler.handleRequest(sessionId, testPhone, "1*1");

    assert.ok(response.response.length > 0, "Should return confirmation text");
    // Should confirm the symptom was reported
    assert.ok(
      response.response.toLowerCase().includes("sent") ||
        response.response.toLowerCase().includes("received") ||
        response.response.toLowerCase().includes("report") ||
        response.response.toLowerCase().includes("contact"),
      "Should confirm the symptom report was sent",
    );
    assert.equal(response.endSession, true, "Symptom confirmation should end session");
  });
});

// ---------------------------------------------------------------------------
// Appointment
// ---------------------------------------------------------------------------

describe("connect USSD — appointment", () => {
  it("2 returns appointment form", async () => {
    const handler = createUSSDHandler();
    const sessionId = nextSessionId();
    const response = await handler.handleRequest(sessionId, testPhone, "2");

    assert.ok(response.response.length > 0, "Should return appointment text");
    // Should ask for name or present appointment info
    assert.ok(
      response.response.toLowerCase().includes("name") ||
        response.response.toLowerCase().includes("appointment") ||
        response.response.toLowerCase().includes("patient"),
      "Should present appointment-related content",
    );
  });
});

// ---------------------------------------------------------------------------
// Emergency
// ---------------------------------------------------------------------------

describe("connect USSD — emergency", () => {
  it("4 (emergency) sends alert and returns confirmation", async () => {
    const handler = createUSSDHandler();
    const sessionId = nextSessionId();
    const response = await handler.handleRequest(sessionId, testPhone, "4");

    assert.ok(response.response.length > 0, "Should return emergency confirmation");
    assert.ok(
      response.response.toLowerCase().includes("emergency") ||
        response.response.toLowerCase().includes("alert") ||
        response.response.toLowerCase().includes("help") ||
        response.response.toLowerCase().includes("sent") ||
        response.response.toLowerCase().includes("way"),
      "Should confirm emergency alert was sent",
    );
    // Emergency confirmation should end the session
    assert.equal(
      response.endSession,
      true,
      "Emergency confirmation should end the USSD session",
    );
  });
});

// ---------------------------------------------------------------------------
// Language selection
// ---------------------------------------------------------------------------

describe("connect USSD — language", () => {
  it("5*1 returns language selection", async () => {
    const handler = createUSSDHandler();
    const sessionId = nextSessionId();
    const response = await handler.handleRequest(sessionId, testPhone, "5*1");

    assert.ok(response.response.length > 0, "Should return language options");
    // Should list language choices
    assert.ok(
      response.response.toLowerCase().includes("english") ||
        response.response.toLowerCase().includes("swahili") ||
        response.response.toLowerCase().includes("fran") ||
        response.response.includes("1"),
      "Should list available languages",
    );
    assert.equal(
      response.endSession,
      false,
      "Language selection menu should keep session open",
    );
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("connect USSD — error handling", () => {
  it("invalid input returns error message", async () => {
    const handler = createUSSDHandler();
    const sessionId = nextSessionId();
    const response = await handler.handleRequest(sessionId, testPhone, "99");

    assert.ok(response.response.length > 0, "Should return an error/help message");
    assert.ok(
      response.response.toLowerCase().includes("invalid") ||
        response.response.toLowerCase().includes("try again") ||
        response.response.toLowerCase().includes("error") ||
        response.response.toLowerCase().includes("option"),
      "Should indicate the input was not valid",
    );
    assert.equal(
      response.endSession,
      true,
      "Invalid input should end the session",
    );
  });
});

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

describe("connect USSD — session tracking", () => {
  it("session tracks state correctly across navigations", async () => {
    const handler = createUSSDHandler();
    const sessionId = nextSessionId();

    // First request: main menu
    const resp0 = await handler.handleRequest(sessionId, testPhone, "");
    assert.equal(resp0.endSession, false, "Main menu should keep session open");
    assert.ok(resp0.response.includes("1"), "Main menu should list options");

    // Navigate into symptom menu
    const resp1 = await handler.handleRequest(sessionId, testPhone, "1");
    assert.ok(resp1.response.length > 0, "Symptom menu response should be non-empty");
    assert.equal(resp1.endSession, false, "Symptom sub-menu should keep session open");

    // Select fever (1*1)
    const resp2 = await handler.handleRequest(sessionId, testPhone, "1*1");
    assert.ok(resp2.response.length > 0, "Fever confirmation should be non-empty");
    assert.equal(resp2.endSession, true, "Symptom report should end session");
  });
});
