/**
 * Tests for MeshCue Connect — Consent Manager
 *
 * Verifies consent lifecycle (pending -> opted_in -> opted_out -> revoked),
 * duty-of-care bypass for critical alerts, family notification gating,
 * and audit logging of all consent changes.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import type {
  PatientContact,
  ConsentEntry,
} from "../connect/types.js";

import { ConsentManager } from "../connect/consent.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createPatient(overrides?: Partial<PatientContact>): PatientContact {
  return {
    id: "pat-001",
    name: "Amara Diallo",
    phone: "+254700100100",
    language: "en",
    preferredChannel: "sms",
    consentStatus: "pending",
    emergencyContacts: [
      {
        name: "Fatou Diallo",
        phone: "+254700200200",
        relationship: "sister",
        notifyOnCritical: true,
        notifyOnRoutine: false,
      },
    ],
    clinicId: "clinic-nairobi-01",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Consent lifecycle
// ---------------------------------------------------------------------------

describe("connect consent — lifecycle", () => {
  let manager: ConsentManager;

  beforeEach(() => {
    manager = new ConsentManager();
  });

  it("new patient starts with pending consent", async () => {
    const patient = createPatient();
    assert.equal(patient.consentStatus, "pending");
    // isConsented should return false for pending
    const consented = await manager.isConsented(patient);
    assert.equal(consented, false, "Pending consent should not be considered consented");
  });

  it("YES response sets opted_in", () => {
    const patient = createPatient();
    // First request consent so the manager knows about this patient
    manager.requestConsent(patient);
    const status = manager.processConsent(patient.phone, "YES");
    assert.equal(status, "opted_in");
  });

  it("NO response sets opted_out", () => {
    const patient = createPatient();
    manager.requestConsent(patient);
    const status = manager.processConsent(patient.phone, "NO");
    assert.equal(status, "opted_out");
  });

  it("STOP revokes consent", () => {
    const patient = createPatient({ consentStatus: "opted_in" });
    manager.requestConsent(patient);
    // First opt in
    manager.processConsent(patient.phone, "YES");
    // Then send STOP
    const status = manager.processConsent(patient.phone, "STOP");
    assert.equal(status, "opted_out");
  });
});

// ---------------------------------------------------------------------------
// isConsented checks
// ---------------------------------------------------------------------------

describe("connect consent — isConsented", () => {
  let manager: ConsentManager;

  beforeEach(() => {
    manager = new ConsentManager();
  });

  it("isConsented returns true for opted_in", async () => {
    const patient = createPatient({ consentStatus: "opted_in" });
    // Store consent in manager
    manager.processConsent(patient.phone, "YES");
    const result = await manager.isConsented(patient);
    assert.equal(result, true);
  });

  it("isConsented returns false for opted_out", async () => {
    const patient = createPatient({ consentStatus: "opted_out" });
    manager.processConsent(patient.phone, "NO");
    const result = await manager.isConsented(patient);
    assert.equal(result, false);
  });

  it("isConsented returns false for pending", async () => {
    const patient = createPatient({ consentStatus: "pending" });
    const result = await manager.isConsented(patient);
    assert.equal(result, false);
  });
});

// ---------------------------------------------------------------------------
// Special rules
// ---------------------------------------------------------------------------

describe("connect consent — special rules", () => {
  let manager: ConsentManager;

  beforeEach(() => {
    manager = new ConsentManager();
  });

  it("critical alerts do not require consent check", () => {
    const patient = createPatient({ consentStatus: "opted_out" });
    manager.processConsent(patient.phone, "NO");
    const allowed = manager.canSendMessage(patient, "critical");
    assert.equal(
      allowed,
      true,
      "Critical alerts must be allowed regardless of consent (duty of care)",
    );
  });

  it("family notification requires explicit consent", async () => {
    const patient = createPatient({ consentStatus: "pending" });
    // Family notification for contact at index 0 should be blocked without consent
    const allowed = await manager.canNotifyFamily(patient, 0);
    assert.equal(
      allowed,
      false,
      "Family notifications should require explicit opt-in consent",
    );
  });

  it("family notification allowed after opt-in with notifyOnCritical", async () => {
    const patient = createPatient({
      consentStatus: "opted_in",
      consentDate: new Date().toISOString(),
    });
    // Store consent in manager
    manager.processConsent(patient.phone, "YES");
    const allowed = await manager.canNotifyFamily(patient, 0);
    assert.equal(
      allowed,
      true,
      "Family notifications should be allowed after opt-in when contact has notification flags",
    );
  });
});

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

describe("connect consent — audit log", () => {
  let manager: ConsentManager;

  beforeEach(() => {
    manager = new ConsentManager();
  });

  it("consent log records all changes with timestamps", () => {
    const patient = createPatient();

    // Request consent (logs "requested")
    manager.requestConsent(patient);

    // Grant consent (logs "granted")
    manager.processConsent(patient.phone, "YES");

    // Revoke consent (logs "revoked")
    manager.processConsent(patient.phone, "STOP");

    const log: ConsentEntry[] = manager.getConsentLog(patient.id);

    assert.ok(
      log.length >= 2,
      `Expected at least 2 log entries, got ${log.length}`,
    );

    // Each entry should have a timestamp and patient ID
    for (const entry of log) {
      assert.ok(entry.timestamp, "Each log entry should have a timestamp");
      assert.ok(entry.patientId, "Each log entry should have a patientId");
      assert.ok(entry.action, "Each log entry should have an action");
    }

    // Check that grant and revoke actions are present
    const actions = log.map((e) => e.action);
    assert.ok(
      actions.includes("granted"),
      `Log should contain a "granted" action, got: ${actions.join(", ")}`,
    );
    assert.ok(
      actions.includes("revoked"),
      `Log should contain a "revoked" action, got: ${actions.join(", ")}`,
    );
  });
});
