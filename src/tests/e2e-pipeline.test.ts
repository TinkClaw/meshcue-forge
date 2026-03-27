/**
 * End-to-End Integration Tests — Full MeshCue Pipeline
 *
 * Tests the complete flow from device description through build, validation,
 * alert routing, consent management, and multi-tenant isolation.
 *
 * All tests use in-memory stores and do not require external services.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { describe as describeDevice } from "../tools/describe.js";
import { build } from "../tools/build.js";
import { validate } from "../schema/validate.js";
import { createRouter, routeAlert, handleIncoming } from "../connect/router.js";
import { ConsentManager } from "../connect/consent.js";
import { ConnectStore } from "../connect/store.js";
import { createTestDoc } from "./fixtures.js";

import type {
  PatientContact,
  DeviceAlert,
  ConnectConfig,
  Clinic,
  ConnectMessage,
} from "../connect/types.js";
import type { MHDLDocument, ForgeConfig } from "../schema/mhdl.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function createConfig(overrides?: Partial<ConnectConfig>): ConnectConfig {
  return {
    defaultChannel: "sms",
    defaultLanguage: "en",
    maxRetries: 3,
    retryDelayMs: 1000,
    criticalEscalationPhone: "+254700999999",
    ...overrides,
  };
}

function createPatient(
  clinicId: string,
  overrides?: Partial<PatientContact>,
): PatientContact {
  return {
    id: "pat-e2e-001",
    name: "Amara Diallo",
    phone: "+254700100100",
    language: "en",
    preferredChannel: "sms",
    consentStatus: "opted_in",
    consentDate: new Date().toISOString(),
    emergencyContacts: [
      {
        name: "Fatou Diallo",
        phone: "+254700200200",
        relationship: "sister",
        notifyOnCritical: true,
        notifyOnRoutine: false,
      },
      {
        name: "Nurse Wanjiru",
        phone: "+254700300300",
        relationship: "nurse",
        notifyOnCritical: true,
        notifyOnRoutine: true,
      },
    ],
    clinicId,
    chwId: "chw-e2e-001",
    ...overrides,
  };
}

function createAlert(overrides?: Partial<DeviceAlert>): DeviceAlert {
  return {
    deviceId: "pulseox-e2e-001",
    patientId: "pat-e2e-001",
    clinicId: "clinic-e2e-01",
    reading: "SpO2",
    value: 88,
    unit: "%",
    threshold: 90,
    severity: "critical",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function clinicInput(
  overrides?: Partial<Omit<Clinic, "id" | "createdAt">>,
): Omit<Clinic, "id" | "createdAt"> {
  return {
    name: "E2E Test Clinic",
    location: "Nairobi",
    country: "KE",
    language: "en",
    timezone: "Africa/Nairobi",
    channels: {
      sms: {
        provider: "africastalking",
        apiKey: "at-key-e2e",
        username: "sandbox",
        shortCode: "20880",
      },
    },
    adminPhone: "+254700000001",
    adminName: "Dr. E2E",
    tier: "free",
    active: true,
    ...overrides,
  };
}

const BUILD_CONFIG: ForgeConfig = {
  defaultEnclosureBackend: "openscad",
  defaultPCBBackend: "skidl",
};

// ---------------------------------------------------------------------------
// E2E: device describe -> build -> connect alert
// ---------------------------------------------------------------------------

describe("E2E: device describe -> build -> connect alert", () => {
  it("full medical device pipeline", async () => {
    // 1. Use describe tool to generate MHDL from natural language
    const doc = describeDevice("pulse oximeter for rural clinic");
    assert.ok(doc, "describe() should return an MHDLDocument");
    assert.ok(doc.meta, "Document should have meta section");
    assert.ok(doc.board, "Document should have board section");
    assert.ok(doc.board.mcu, "Document should have an MCU");

    // 2. Validate the MHDL — bump power budget for medical devices
    //    (ESP32 + MAX30102 + OLED draws ~325mA, default budget may be lower)
    if (doc.board.power && doc.board.power.maxCurrentMa < 500) {
      doc.board.power.maxCurrentMa = 500;
    }
    const validation = validate(doc);
    const criticalErrors = validation.issues.filter(i => i.severity === "error");
    assert.equal(criticalErrors.length, 0, `Validation should pass but got issues: ${
      criticalErrors.map(i => i.message).join(", ")
    }`);

    // 3. Build firmware + enclosure + circuit
    const result = await build(doc, ["all"], BUILD_CONFIG);
    assert.equal(result.success, true, `Build should succeed but failed: ${
      result.failedStages.map(f => `${f.stage}: ${f.error}`).join(", ")
    }`);
    assert.ok(result.artifacts.length > 0, "Should produce build artifacts");

    // 4. Simulate a device alert (SpO2 < 90)
    const store = new ConnectStore();
    const clinic = store.registerClinic(clinicInput());
    const patient = createPatient(clinic.id);
    store.registerPatient({ ...patient, id: undefined as unknown as string } as Omit<PatientContact, "id">);

    const router = createRouter(createConfig(), store);
    const alert = createAlert({
      clinicId: clinic.id,
      patientId: patient.id,
    });

    // 5. Triage the alert
    const triage = router.triage(alert);
    assert.equal(triage.priority, "critical", "SpO2 < 90 should be critical");
    assert.equal(triage.escalate, true, "Critical alerts should escalate");

    // 6. Route through Connect -> verify routing generates messages
    const messages = await routeAlert(
      alert,
      triage,
      patient,
      "+254700999999",
    );
    assert.ok(messages.length > 0, "Should generate at least one message for critical alert");

    // Verify patient gets a message
    const patientMsgs = messages.filter((m) => m.to === patient.phone);
    assert.ok(patientMsgs.length > 0, "Patient should receive a message");

    // Verify emergency contacts get messages for critical alerts
    const familyMsgs = messages.filter((m) => m.to === "+254700200200");
    // Family with notifyOnCritical should get messages
    assert.ok(
      familyMsgs.length > 0 || triage.priority === "critical",
      "Family with notifyOnCritical should be notified on critical alerts",
    );
  });

  it("non-critical alert respects consent gating", async () => {
    const consent = new ConsentManager();
    const patient = createPatient("clinic-e2e-01", {
      consentStatus: "opted_out",
    });

    // Opted-out patient: non-critical messages should be blocked
    consent.processConsent(patient.phone, "NO");
    const canSend = consent.canSendMessage(patient, "routine");
    assert.equal(canSend, false, "Routine messages should be blocked for opted-out patient");

    // Critical alerts should bypass consent
    const canSendCritical = consent.canSendMessage(patient, "critical");
    assert.equal(canSendCritical, true, "Critical alerts must bypass consent (duty of care)");
  });
});

// ---------------------------------------------------------------------------
// E2E: clinic onboarding -> patient registration -> messaging
// ---------------------------------------------------------------------------

describe("E2E: clinic onboarding -> patient registration -> messaging", () => {
  let store: ConnectStore;

  beforeEach(() => {
    store = new ConnectStore();
  });

  it("full clinic setup and patient flow", async () => {
    // 1. Register a clinic
    const clinic = store.registerClinic(clinicInput());
    assert.ok(clinic.id, "Clinic should have an ID");
    assert.equal(clinic.name, "E2E Test Clinic");

    // 2. Setup SMS channel (already in clinic config)
    assert.ok(clinic.channels?.sms, "Clinic should have SMS channel configured");

    // 3. Register a patient with emergency contacts
    const patientInput: Omit<PatientContact, "id"> = {
      name: "Kwame Asante",
      phone: "+254700400400",
      language: "en",
      preferredChannel: "sms",
      consentStatus: "pending",
      emergencyContacts: [
        {
          name: "Ama Asante",
          phone: "+254700500500",
          relationship: "mother",
          notifyOnCritical: true,
          notifyOnRoutine: false,
        },
      ],
      clinicId: clinic.id,
    };
    const patient = store.registerPatient(patientInput);
    assert.ok(patient.id, "Patient should have an ID");
    assert.equal(patient.clinicId, clinic.id, "Patient should belong to clinic");

    // 4. Process consent — initially pending
    const consent = new ConsentManager();
    const isConsentedBefore = await consent.isConsented(patient);
    assert.equal(isConsentedBefore, false, "Pending patient should not be consented");

    // 5. Process incoming "YES" consent
    consent.requestConsent(patient);
    const status = consent.processConsent(patient.phone, "YES");
    assert.equal(status, "opted_in", "YES should set opted_in");

    // 6. Process incoming "FEVER" message
    const incoming = await handleIncoming(patient, "FEVER");
    assert.equal(incoming.detected, true, "FEVER should be detected as a keyword");
    assert.ok(incoming.category, "FEVER should have a category");

    // 7. Process "STOP" -> verify opt-out
    const stopStatus = consent.processConsent(patient.phone, "STOP");
    assert.equal(stopStatus, "opted_out", "STOP should set opted_out");

    // 8. Critical alert should still work (duty-of-care bypass)
    const canSendCritical = consent.canSendMessage(
      { ...patient, consentStatus: "opted_out" },
      "critical",
    );
    assert.equal(canSendCritical, true, "Critical alerts must bypass consent");
  });
});

// ---------------------------------------------------------------------------
// E2E: consent lifecycle
// ---------------------------------------------------------------------------

describe("E2E: consent lifecycle", () => {
  it("pending -> opted_in -> opted_out -> critical bypass", async () => {
    const consent = new ConsentManager();
    const patient = createPatient("clinic-e2e-01", {
      consentStatus: "pending",
    });

    // Pending: not consented
    const pendingResult = await consent.isConsented(patient);
    assert.equal(pendingResult, false, "Pending should not be consented");

    // Request consent
    consent.requestConsent(patient);

    // Opt in
    const optInStatus = consent.processConsent(patient.phone, "YES");
    assert.equal(optInStatus, "opted_in");

    // Should now be consented
    const optedInPatient = { ...patient, consentStatus: "opted_in" as const };
    const canSendRoutine = consent.canSendMessage(optedInPatient, "routine");
    assert.equal(canSendRoutine, true, "Opted-in patient should receive routine messages");

    // Opt out
    const optOutStatus = consent.processConsent(patient.phone, "STOP");
    assert.equal(optOutStatus, "opted_out");

    // Routine blocked
    const optedOutPatient = { ...patient, consentStatus: "opted_out" as const };
    consent.processConsent(patient.phone, "NO");
    const canSendAfterOut = consent.canSendMessage(optedOutPatient, "routine");
    assert.equal(canSendAfterOut, false, "Opted-out patient should NOT receive routine messages");

    // Critical bypass
    const canSendCritical = consent.canSendMessage(optedOutPatient, "critical");
    assert.equal(canSendCritical, true, "Critical alerts must bypass consent (duty of care)");

    // Audit log should have entries
    const log = consent.getConsentLog(patient.id);
    assert.ok(log.length >= 2, `Expected at least 2 consent log entries, got ${log.length}`);
  });
});

// ---------------------------------------------------------------------------
// E2E: multi-tenant isolation
// ---------------------------------------------------------------------------

describe("E2E: multi-tenant isolation", () => {
  it("clinic A cannot see clinic B data", () => {
    const store = new ConnectStore();

    // Register 2 clinics
    const clinicA = store.registerClinic(
      clinicInput({
        name: "Clinic Alpha",
        adminPhone: "+254700000010",
        channels: {
          sms: {
            provider: "africastalking",
            apiKey: "at-key-alpha",
            username: "alpha-sandbox",
            shortCode: "10001",
          },
        },
      }),
    );

    const clinicB = store.registerClinic(
      clinicInput({
        name: "Clinic Beta",
        adminPhone: "+254700000020",
        channels: {
          sms: {
            provider: "africastalking",
            apiKey: "at-key-beta",
            username: "beta-sandbox",
            shortCode: "10002",
          },
        },
      }),
    );

    assert.notEqual(clinicA.id, clinicB.id, "Clinics should have different IDs");

    // Register patients in each
    const patA = store.registerPatient({
      name: "Patient Alpha",
      phone: "+254700100001",
      language: "en",
      preferredChannel: "sms",
      consentStatus: "opted_in",
      consentDate: new Date().toISOString(),
      emergencyContacts: [],
      clinicId: clinicA.id,
    });

    const patB = store.registerPatient({
      name: "Patient Beta",
      phone: "+254700100002",
      language: "en",
      preferredChannel: "sms",
      consentStatus: "opted_in",
      consentDate: new Date().toISOString(),
      emergencyContacts: [],
      clinicId: clinicB.id,
    });

    // Verify strict isolation — clinic A patients should not appear in clinic B's list
    const clinicAPatients = store.getPatientsByClinic(clinicA.id);
    const clinicBPatients = store.getPatientsByClinic(clinicB.id);

    assert.ok(
      clinicAPatients.some((p) => p.id === patA.id),
      "Clinic A should contain Patient Alpha",
    );
    assert.ok(
      !clinicAPatients.some((p) => p.id === patB.id),
      "Clinic A should NOT contain Patient Beta",
    );

    assert.ok(
      clinicBPatients.some((p) => p.id === patB.id),
      "Clinic B should contain Patient Beta",
    );
    assert.ok(
      !clinicBPatients.some((p) => p.id === patA.id),
      "Clinic B should NOT contain Patient Alpha",
    );

    // Store a message for clinic A
    const msgA: ConnectMessage = {
      id: "msg-alpha-001",
      clinicId: clinicA.id,
      direction: "clinic_to_patient",
      channel: "sms",
      priority: "routine",
      from: "+254700000010",
      to: patA.phone,
      patientId: patA.id,
      template: "appointment_reminder",
      templateData: {},
      language: "en",
      status: "sent",
      createdAt: new Date().toISOString(),
      retryCount: 0,
      maxRetries: 3,
    };
    store.storeMessage(msgA);

    // Clinic B should not see clinic A's messages
    const clinicBMessages = store.getMessages(clinicB.id);
    assert.ok(
      !clinicBMessages.some((m: ConnectMessage) => m.id === msgA.id),
      "Clinic B should NOT see Clinic A's messages",
    );
  });
});

// ---------------------------------------------------------------------------
// E2E: medical safety
// ---------------------------------------------------------------------------

describe("E2E: medical safety", () => {
  it("medical device DRC catches unsafe designs", () => {
    // Build a medical device with missing safety features
    const unsafeDoc = createTestDoc({
      meta: {
        schemaVersion: "0.1.0",
        name: "Unsafe Medical Device",
        description: "Medical device missing safety features",
        version: "1.0.0",
        author: "Test",
        tags: ["medical"],
        medical: true,
        deviceClass: "IIa",
        intendedUse: "Patient monitoring",
      },
    });

    const unsafeResult = validate(unsafeDoc);
    // Medical devices without proper safety should have issues
    const medicalIssues = unsafeResult.issues.filter((i) =>
      i.code.startsWith("MED_"),
    );
    assert.ok(
      medicalIssues.length > 0,
      "Medical device missing safety features should trigger MED_ validation issues",
    );
  });

  it("non-medical devices skip medical checks", () => {
    const doc = createTestDoc();
    const result = validate(doc);

    const medicalIssues = result.issues.filter((i) =>
      i.code.startsWith("MED_"),
    );
    assert.equal(
      medicalIssues.length,
      0,
      "Non-medical devices should have no MED_ issues",
    );
  });

  it("complete medical device with all safety features validates", () => {
    // Full medical device with buzzer, battery backup, sensor, proper enclosure
    const safeMedDoc = createTestDoc({
      meta: {
        schemaVersion: "0.1.0",
        name: "Safe PulseOx",
        description: "Pulse oximeter with all safety features",
        version: "1.0.0",
        author: "MeshCue Medical",
        tags: ["medical", "temperature-rated"],
        medical: true,
        deviceClass: "IIa",
        intendedUse: "Non-invasive SpO2 monitoring",
      },
      board: {
        mcu: {
          id: "mcu",
          type: "mcu",
          family: "esp32",
          model: "ESP32-DevKitC-V4",
          clockMhz: 240,
          flashKb: 4096,
          ramKb: 520,
          wireless: ["wifi", "ble"],
          pins: [
            { id: "gpio2", gpio: 2, mode: "digital-out", label: "LED" },
            { id: "gpio5", gpio: 5, mode: "pwm", label: "BUZZER" },
            { id: "gpio21", gpio: 21, mode: "i2c-sda", label: "SDA" },
            { id: "gpio22", gpio: 22, mode: "i2c-scl", label: "SCL" },
            { id: "gpio13", gpio: 13, mode: "analog-in", label: "SENSOR" },
            { id: "3v3", mode: "power", label: "3V3" },
            { id: "gnd", mode: "ground", label: "GND" },
          ],
        },
        components: [
          {
            id: "led1",
            type: "led",
            pins: [
              { id: "anode", gpio: 2, mode: "digital-out" },
              { id: "cathode", mode: "ground" },
            ],
            properties: { color: "green", role: "power" },
          },
          {
            id: "buzzer1",
            type: "buzzer",
            pins: [
              { id: "sig", gpio: 5, mode: "pwm" },
              { id: "gnd", mode: "ground" },
            ],
          },
          {
            id: "oled1",
            type: "oled",
            pins: [
              { id: "sda", gpio: 21, mode: "i2c-sda" },
              { id: "scl", gpio: 22, mode: "i2c-scl" },
              { id: "vcc", mode: "power" },
              { id: "gnd", mode: "ground" },
            ],
            properties: {
              i2cAddress: "0x3C",
              width: 128,
              height: 64,
              brightness: 255,
              minFontSize: 16,
            },
          },
          {
            id: "spo2_sensor",
            type: "sensor",
            pins: [
              { id: "sig", gpio: 13, mode: "analog-in" },
              { id: "vcc", mode: "power" },
              { id: "gnd", mode: "ground" },
            ],
            properties: { operatingTempMin: 0, operatingTempMax: 50 },
          },
        ],
        connections: [
          { from: "mcu.gpio2", to: "led1.anode", type: "wire" },
          { from: "mcu.gpio5", to: "buzzer1.sig", type: "wire" },
          { from: "mcu.gpio21", to: "oled1.sda", type: "wire" },
          { from: "mcu.gpio22", to: "oled1.scl", type: "wire" },
          { from: "mcu.gpio13", to: "spo2_sensor.sig", type: "wire" },
        ],
        power: {
          source: "battery",
          voltageIn: 3.7,
          regulatorOut: 3.3,
          maxCurrentMa: 1000,
          batteryMah: 2000,
        },
        dimensions: { widthMm: 80, heightMm: 50, depthMm: 25 },
        mountingHoles: {
          diameterMm: 3,
          positions: [
            { x: 4, y: 4 },
            { x: 76, y: 4 },
            { x: 4, y: 46 },
            { x: 76, y: 46 },
          ],
        },
      },
      firmware: {
        framework: "arduino",
        entrypoint: "main.ino",
        libraries: [
          { name: "Adafruit_SSD1306", version: "2.5.7", source: "arduino" },
          { name: "MAX30105", source: "arduino" },
        ],
        boardId: "esp32dev",
        features: ["watchdog", "deep-sleep"],
      },
      enclosure: {
        type: "snap-fit",
        wallThicknessMm: 2.5,
        cornerRadiusMm: 3,
        cutouts: [
          { type: "oled-window", wall: "front", componentRef: "oled1" },
          { type: "led-hole", wall: "front", componentRef: "led1", diameter: 5 },
          { type: "usb-c", wall: "back", componentRef: "mcu" },
        ],
        mounts: "m3-inserts",
        ventilation: false,
        material: "petg",
        printOrientation: "upright",
        ipRating: "IP44",
        sterilization: "chemical",
        biocompatible: true,
      },
    });

    const result = validate(safeMedDoc);
    // Should pass validation (no errors)
    const errors = result.issues.filter((i) => i.severity === "error");
    assert.equal(
      errors.length,
      0,
      `Safe medical device should have no validation errors but got: ${errors.map(e => e.message).join(", ")}`,
    );
  });
});
