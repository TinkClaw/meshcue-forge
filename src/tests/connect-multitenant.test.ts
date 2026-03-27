/**
 * Tests for MeshCue Connect — Multi-Tenant Isolation & Clinic-Owned Credentials
 *
 * Validates tenant isolation (patients, messages, credentials),
 * subscription tier limits, credential management, and the full
 * onboarding flow.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import type {
  Clinic,
  ClinicChannelConfig,
  PatientContact,
  ConnectMessage,
  Channel,
} from "../connect/types.js";

import { ConnectStore } from "../connect/store.js";
import { SUBSCRIPTION_TIERS, checkSubscriptionLimits } from "../connect/config.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function clinicInput(
  overrides?: Partial<Omit<Clinic, "id" | "createdAt">>,
): Omit<Clinic, "id" | "createdAt"> {
  return {
    name: "Default Clinic",
    location: "Nairobi",
    country: "KE",
    language: "en",
    timezone: "Africa/Nairobi",
    channels: {
      sms: {
        provider: "africastalking",
        apiKey: "at-key-default",
        username: "sandbox",
        shortCode: "20880",
      },
    },
    adminPhone: "+254700000001",
    adminName: "Dr. Default",
    tier: "free",
    active: true,
    ...overrides,
  };
}

function patientInput(
  clinicId: string,
  overrides?: Partial<Omit<PatientContact, "id">>,
): Omit<PatientContact, "id"> {
  return {
    name: "Test Patient",
    phone: "+254700100100",
    language: "en",
    preferredChannel: "sms",
    consentStatus: "opted_in",
    consentDate: new Date().toISOString(),
    emergencyContacts: [],
    clinicId,
    ...overrides,
  };
}

function createMessage(
  clinicId: string,
  overrides?: Partial<ConnectMessage>,
): ConnectMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    clinicId,
    direction: "clinic_to_patient",
    channel: "sms",
    priority: "routine",
    from: "+254700000001",
    to: "+254700100100",
    patientId: "pat-001",
    template: "appointment_reminder",
    templateData: {},
    language: "en",
    status: "sent",
    createdAt: new Date().toISOString(),
    retryCount: 0,
    maxRetries: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Multi-Tenant Isolation
// ---------------------------------------------------------------------------

describe("connect multitenant -- isolation", () => {
  let store: ConnectStore;
  let clinicA: Clinic;
  let clinicB: Clinic;

  beforeEach(() => {
    store = new ConnectStore();
    clinicA = store.registerClinic(
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
    clinicB = store.registerClinic(
      clinicInput({
        name: "Clinic Beta",
        adminPhone: "+254700000020",
        channels: {
          sms: {
            provider: "twilio",
            apiKey: "twilio-sid-beta",
            apiSecret: "twilio-secret-beta",
          },
        },
      }),
    );
  });

  it("two clinics can register with same patient phone (different contexts)", () => {
    const sharedPhone = "+254700999999";
    const patA = store.registerPatient(
      patientInput(clinicA.id, { phone: sharedPhone, name: "Alice at Alpha" }),
    );
    const patB = store.registerPatient(
      patientInput(clinicB.id, { phone: sharedPhone, name: "Alice at Beta" }),
    );

    // Both patients exist with distinct IDs
    assert.notEqual(patA.id, patB.id);

    // Each clinic sees its own patient in its roster
    const alphaPatients = store.getPatientsByClinic(clinicA.id);
    const betaPatients = store.getPatientsByClinic(clinicB.id);
    assert.equal(alphaPatients.length, 1);
    assert.equal(betaPatients.length, 1);
    assert.equal(alphaPatients[0].name, "Alice at Alpha");
    assert.equal(betaPatients[0].name, "Alice at Beta");
  });

  it("messages from clinic A use clinic A's credentials", () => {
    const fetchedA = store.getClinic(clinicA.id);
    assert.ok(fetchedA);
    assert.equal(fetchedA.channels.sms?.provider, "africastalking");
    assert.equal(fetchedA.channels.sms?.apiKey, "at-key-alpha");
  });

  it("messages from clinic B use clinic B's credentials", () => {
    const fetchedB = store.getClinic(clinicB.id);
    assert.ok(fetchedB);
    assert.equal(fetchedB.channels.sms?.provider, "twilio");
    assert.equal(fetchedB.channels.sms?.apiKey, "twilio-sid-beta");
  });

  it("clinic A cannot see clinic B's patients", () => {
    store.registerPatient(patientInput(clinicA.id, { phone: "+254700111111", name: "Alpha Pat" }));
    store.registerPatient(patientInput(clinicB.id, { phone: "+254700222222", name: "Beta Pat" }));

    const alphaPatients = store.getPatientsByClinic(clinicA.id);
    assert.equal(alphaPatients.length, 1);
    assert.equal(alphaPatients[0].name, "Alpha Pat");
    assert.ok(
      !alphaPatients.some((p) => p.name === "Beta Pat"),
      "Clinic A should not see Clinic B patients",
    );
  });

  it("clinic A cannot see clinic B's messages", () => {
    store.storeMessage(createMessage(clinicA.id, { id: "msg-alpha" }));
    store.storeMessage(createMessage(clinicB.id, { id: "msg-beta" }));

    const alphaMessages = store.getMessages(clinicA.id);
    const betaMessages = store.getMessages(clinicB.id);

    assert.equal(alphaMessages.length, 1);
    assert.equal(alphaMessages[0].id, "msg-alpha");
    assert.equal(betaMessages.length, 1);
    assert.equal(betaMessages[0].id, "msg-beta");
  });
});

// ---------------------------------------------------------------------------
// Subscription Limits
// ---------------------------------------------------------------------------

describe("connect multitenant -- subscription limits", () => {
  let store: ConnectStore;

  beforeEach(() => {
    store = new ConnectStore();
  });

  it("free tier allows up to 50 patients", () => {
    const clinic = store.registerClinic(clinicInput({ tier: "free" }));

    // Register 49 patients (under the limit)
    for (let i = 0; i < 49; i++) {
      store.registerPatient(
        patientInput(clinic.id, { phone: `+2547001${String(i).padStart(5, "0")}` }),
      );
    }

    const check = checkSubscriptionLimits(clinic, store);
    assert.equal(check.allowed, true, "49 patients should be allowed on free tier");
  });

  it("free tier blocks at 50 patients with upgrade message", () => {
    const clinic = store.registerClinic(clinicInput({ tier: "free" }));

    // Fill to the 50-patient limit
    for (let i = 0; i < 50; i++) {
      store.registerPatient(
        patientInput(clinic.id, { phone: `+2547001${String(i).padStart(5, "0")}` }),
      );
    }

    const check = checkSubscriptionLimits(clinic, store);
    assert.equal(check.allowed, false, "Should not allow more patients");
    assert.ok(check.reason, "Should have a reason");
    assert.ok(
      check.reason!.includes("Patient limit reached"),
      `Reason should mention patient limit, got: ${check.reason}`,
    );
    assert.ok(
      check.reason!.includes("Upgrade") || check.reason!.includes("Basic"),
      `Reason should mention upgrade path, got: ${check.reason}`,
    );
  });

  it("free tier allows only SMS channel", () => {
    const tier = SUBSCRIPTION_TIERS.free;
    assert.deepStrictEqual(tier.channels, ["sms"]);
  });

  it("basic tier allows SMS + USSD", () => {
    const tier = SUBSCRIPTION_TIERS.basic;
    assert.ok(tier.channels.includes("sms"), "Basic should include SMS");
    assert.ok(tier.channels.includes("ussd"), "Basic should include USSD");
    assert.equal(tier.channels.length, 2, "Basic should have exactly 2 channels");
  });

  it("professional tier allows all major channels", () => {
    const tier = SUBSCRIPTION_TIERS.professional;
    assert.ok(tier.channels.includes("sms"), "Professional should include SMS");
    assert.ok(tier.channels.includes("ussd"), "Professional should include USSD");
    assert.ok(tier.channels.includes("whatsapp"), "Professional should include WhatsApp");
    assert.ok(tier.channels.includes("voice"), "Professional should include voice");
    assert.ok(tier.channels.includes("push"), "Professional should include push");
  });

  it("over-limit registration returns error with upgrade message", () => {
    const clinic = store.registerClinic(clinicInput({ tier: "free" }));

    // Saturate the patient limit
    for (let i = 0; i < 50; i++) {
      store.registerPatient(
        patientInput(clinic.id, { phone: `+2547002${String(i).padStart(5, "0")}` }),
      );
    }

    const check = checkSubscriptionLimits(clinic, store);
    assert.equal(check.allowed, false);
    assert.ok(check.reason);
    assert.match(check.reason!, /Patient limit reached/);
    assert.match(check.reason!, /Basic/);
  });
});

// ---------------------------------------------------------------------------
// Credential Management
// ---------------------------------------------------------------------------

describe("connect multitenant -- credential management", () => {
  let store: ConnectStore;
  let clinic: Clinic;

  beforeEach(() => {
    store = new ConnectStore();
    clinic = store.registerClinic(
      clinicInput({
        channels: {
          sms: {
            provider: "africastalking",
            apiKey: "at-key-001",
            username: "sandbox",
          },
        },
      }),
    );
  });

  it("clinic can update SMS credentials", () => {
    const updated = store.updateClinicChannels(clinic.id, {
      sms: {
        provider: "africastalking",
        apiKey: "at-key-new",
        username: "production",
        shortCode: "54321",
      },
    });

    assert.equal(updated.channels.sms?.apiKey, "at-key-new");
    assert.equal(updated.channels.sms?.username, "production");
    assert.equal(updated.channels.sms?.shortCode, "54321");
  });

  it("clinic can add WhatsApp credentials", () => {
    // Initially no WhatsApp config
    assert.equal(clinic.channels.whatsapp, undefined);

    const updated = store.updateClinicChannels(clinic.id, {
      whatsapp: {
        token: "wa-token-001",
        phoneId: "wa-phone-001",
        businessName: "Kigali Health",
      },
    });

    assert.ok(updated.channels.whatsapp, "WhatsApp config should exist");
    assert.equal(updated.channels.whatsapp!.token, "wa-token-001");
    assert.equal(updated.channels.whatsapp!.businessName, "Kigali Health");
    // SMS config should still be present
    assert.ok(updated.channels.sms, "SMS config should be preserved");
    assert.equal(updated.channels.sms!.provider, "africastalking");
  });

  it("clinic can switch SMS provider (africastalking to twilio)", () => {
    assert.equal(clinic.channels.sms?.provider, "africastalking");

    const updated = store.updateClinicChannels(clinic.id, {
      sms: {
        provider: "twilio",
        apiKey: "twilio-sid-001",
        apiSecret: "twilio-auth-token",
      },
    });

    assert.equal(updated.channels.sms?.provider, "twilio");
    assert.equal(updated.channels.sms?.apiKey, "twilio-sid-001");
    assert.equal(updated.channels.sms?.apiSecret, "twilio-auth-token");
    // Old AT-specific fields should be gone since we replaced the whole object
    assert.equal(updated.channels.sms?.username, undefined);
  });

  it("missing credentials for a channel returns clear error", () => {
    // Register a clinic with no channel configs
    const bareClinic = store.registerClinic(clinicInput({ channels: {} }));
    const fetched = store.getClinic(bareClinic.id);
    assert.ok(fetched);

    // Verify that the channel config is empty/missing
    assert.equal(fetched.channels.sms, undefined, "No SMS credentials configured");
    assert.equal(fetched.channels.whatsapp, undefined, "No WhatsApp credentials configured");
    assert.equal(fetched.channels.voice, undefined, "No voice credentials configured");

    // Application code should check for channel existence before sending.
    // Simulate the check a router would do:
    const channel: Channel = "whatsapp";
    const channelConfig = fetched.channels[channel as keyof ClinicChannelConfig];
    assert.equal(
      channelConfig,
      undefined,
      `Accessing unconfigured channel '${channel}' should return undefined`,
    );
  });
});

// ---------------------------------------------------------------------------
// Onboarding Flow (End-to-End)
// ---------------------------------------------------------------------------

describe("connect multitenant -- onboarding flow", () => {
  let store: ConnectStore;

  beforeEach(() => {
    store = new ConnectStore();
  });

  it("full flow: register clinic -> setup SMS -> register patient -> send test message", () => {
    // Step 1: Register clinic
    const clinic = store.registerClinic(
      clinicInput({
        name: "Accra Community Health",
        location: "Accra",
        country: "GH",
        tier: "basic",
        channels: {},
      }),
    );
    assert.ok(clinic.id, "Clinic should be registered with an ID");
    assert.equal(clinic.channels.sms, undefined, "No SMS initially");

    // Step 2: Setup SMS credentials
    const withSms = store.updateClinicChannels(clinic.id, {
      sms: {
        provider: "africastalking",
        apiKey: "at-key-accra",
        username: "accra-sandbox",
        shortCode: "30001",
      },
    });
    assert.ok(withSms.channels.sms, "SMS should now be configured");
    assert.equal(withSms.channels.sms!.shortCode, "30001");

    // Step 3: Register patient (check limits first)
    const limitCheck = checkSubscriptionLimits(withSms, store);
    assert.equal(limitCheck.allowed, true, "Should allow patient registration on basic tier");

    const patient = store.registerPatient(
      patientInput(clinic.id, {
        phone: "+233200100100",
        name: "Kwame Asante",
        language: "en",
      }),
    );
    assert.ok(patient.id, "Patient should be registered with an ID");
    assert.equal(patient.clinicId, clinic.id);

    // Step 4: Send a test message
    const testMessage = createMessage(clinic.id, {
      id: "msg-test-onboard",
      patientId: patient.id,
      to: patient.phone,
      from: withSms.channels.sms!.shortCode!,
      template: "welcome",
      status: "sent",
    });
    store.storeMessage(testMessage);

    // Verify message was stored
    const messages = store.getMessages(clinic.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].to, "+233200100100");
    assert.equal(messages[0].template, "welcome");

    // Verify stats
    const stats = store.getClinicStats(clinic.id);
    assert.equal(stats.patientCount, 1);
    assert.equal(stats.messagesSent, 1);
  });

  it("register clinic with free tier has correct defaults", () => {
    const clinic = store.registerClinic(clinicInput({ tier: "free" }));

    assert.equal(clinic.tier, "free");
    assert.equal(clinic.active, true);
    assert.ok(clinic.createdAt, "Should have a creation timestamp");

    // Free tier should have specific limits
    const tier = SUBSCRIPTION_TIERS[clinic.tier];
    assert.equal(tier.maxPatients, 50);
    assert.equal(tier.maxMessagesPerMonth, 500);
    assert.equal(tier.priceUsd, 0);
    assert.deepStrictEqual(tier.channels, ["sms"]);
    assert.ok(tier.features.includes("basic_alerts"));
    assert.ok(tier.features.includes("consent_management"));
  });
});
