/**
 * Tests for MeshCue Connect — ConnectStore (In-Memory Data Store)
 *
 * Validates clinic CRUD, patient management, message storage,
 * queue operations, and stats aggregation.
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function clinicInput(
  overrides?: Partial<Omit<Clinic, "id" | "createdAt">>,
): Omit<Clinic, "id" | "createdAt"> {
  return {
    name: "Kigali Central Clinic",
    location: "Kigali",
    country: "RW",
    language: "en",
    timezone: "Africa/Kigali",
    channels: {
      sms: {
        provider: "africastalking",
        apiKey: "at-key-001",
        username: "sandbox",
        shortCode: "12345",
      },
    },
    adminPhone: "+250788000001",
    adminName: "Dr. Mugisha",
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
    name: "Amara Diallo",
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
    from: "+250788000001",
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
// Clinic Management
// ---------------------------------------------------------------------------

describe("connect store -- clinic management", () => {
  let store: ConnectStore;

  beforeEach(() => {
    store = new ConnectStore();
  });

  it("registerClinic returns valid ID and timestamps", () => {
    const clinic = store.registerClinic(clinicInput());
    assert.ok(clinic.id, "Clinic should have an ID");
    assert.ok(clinic.id.length > 0, "ID should be non-empty");
    assert.ok(clinic.createdAt, "Clinic should have a createdAt timestamp");
    const parsed = new Date(clinic.createdAt);
    assert.ok(!isNaN(parsed.getTime()), "createdAt should be a valid date");
  });

  it("getClinic by ID returns correct clinic", () => {
    const registered = store.registerClinic(clinicInput());
    const fetched = store.getClinic(registered.id);
    assert.ok(fetched, "Should find the clinic");
    assert.equal(fetched.id, registered.id);
    assert.equal(fetched.name, "Kigali Central Clinic");
    assert.equal(fetched.adminPhone, "+250788000001");
  });

  it("updateClinic preserves unchanged fields", () => {
    const clinic = store.registerClinic(clinicInput());
    const updated = store.updateClinic(clinic.id, { name: "Nairobi Hub" });
    assert.equal(updated.name, "Nairobi Hub");
    assert.equal(updated.location, "Kigali", "Location should remain unchanged");
    assert.equal(updated.adminPhone, "+250788000001", "Admin phone should remain unchanged");
    assert.equal(updated.id, clinic.id, "ID must not change");
    assert.equal(updated.createdAt, clinic.createdAt, "createdAt must not change");
  });

  it("updateClinicChannels adds SMS config", () => {
    const clinic = store.registerClinic(clinicInput({ channels: {} }));
    assert.equal(clinic.channels.sms, undefined, "Initially no SMS config");

    const smsConfig: ClinicChannelConfig["sms"] = {
      provider: "twilio",
      apiKey: "twilio-sid-001",
      apiSecret: "twilio-secret-001",
    };
    const updated = store.updateClinicChannels(clinic.id, { sms: smsConfig });
    assert.deepStrictEqual(updated.channels.sms, smsConfig);
  });

  it("listClinics returns all registered clinics", () => {
    store.registerClinic(clinicInput({ name: "Clinic A" }));
    store.registerClinic(clinicInput({ name: "Clinic B" }));
    store.registerClinic(clinicInput({ name: "Clinic C" }));

    const all = store.listClinics();
    assert.equal(all.length, 3);
    const names = all.map((c) => c.name).sort();
    assert.deepStrictEqual(names, ["Clinic A", "Clinic B", "Clinic C"]);
  });

  it("getClinic for non-existent ID returns undefined", () => {
    const result = store.getClinic("does-not-exist");
    assert.equal(result, undefined);
  });
});

// ---------------------------------------------------------------------------
// Patient Management
// ---------------------------------------------------------------------------

describe("connect store -- patient management", () => {
  let store: ConnectStore;
  let clinicA: Clinic;
  let clinicB: Clinic;

  beforeEach(() => {
    store = new ConnectStore();
    clinicA = store.registerClinic(clinicInput({ name: "Clinic A" }));
    clinicB = store.registerClinic(clinicInput({ name: "Clinic B" }));
  });

  it("registerPatient returns valid ID", () => {
    const patient = store.registerPatient(patientInput(clinicA.id));
    assert.ok(patient.id, "Patient should have an ID");
    assert.ok(patient.id.length > 0, "ID should be non-empty");
  });

  it("registerPatient links to clinic", () => {
    const patient = store.registerPatient(patientInput(clinicA.id));
    assert.equal(patient.clinicId, clinicA.id);

    const clinicPatients = store.getPatientsByClinic(clinicA.id);
    assert.equal(clinicPatients.length, 1);
    assert.equal(clinicPatients[0].id, patient.id);
  });

  it("getPatientByPhone returns correct patient", () => {
    const phone = "+254700111111";
    store.registerPatient(patientInput(clinicA.id, { phone }));

    const found = store.getPatientByPhone(phone);
    assert.ok(found, "Should find patient by phone");
    assert.equal(found.phone, phone);
    assert.equal(found.name, "Amara Diallo");
  });

  it("getPatientsByClinic returns only that clinic's patients", () => {
    store.registerPatient(patientInput(clinicA.id, { phone: "+254700111111", name: "Alice" }));
    store.registerPatient(patientInput(clinicA.id, { phone: "+254700222222", name: "Bob" }));
    store.registerPatient(patientInput(clinicB.id, { phone: "+254700333333", name: "Charlie" }));

    const aPatients = store.getPatientsByClinic(clinicA.id);
    const bPatients = store.getPatientsByClinic(clinicB.id);

    assert.equal(aPatients.length, 2);
    assert.equal(bPatients.length, 1);
    assert.equal(bPatients[0].name, "Charlie");
  });

  it("updatePatient preserves unchanged fields", () => {
    const patient = store.registerPatient(
      patientInput(clinicA.id, { phone: "+254700111111", name: "Alice" }),
    );
    const updated = store.updatePatient(patient.id, { name: "Alice Updated" });

    assert.equal(updated.name, "Alice Updated");
    assert.equal(updated.phone, "+254700111111", "Phone should remain unchanged");
    assert.equal(updated.clinicId, clinicA.id, "Clinic should remain unchanged");
    assert.equal(updated.id, patient.id, "ID must not change");
  });

  it("patient from clinic A not visible to clinic B query", () => {
    store.registerPatient(
      patientInput(clinicA.id, { phone: "+254700111111", name: "Alice" }),
    );

    const bPatients = store.getPatientsByClinic(clinicB.id);
    assert.equal(bPatients.length, 0, "Clinic B should see no patients");
  });
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

describe("connect store -- messages", () => {
  let store: ConnectStore;
  let clinic: Clinic;

  beforeEach(() => {
    store = new ConnectStore();
    clinic = store.registerClinic(clinicInput());
  });

  it("store message and retrieve by clinic", () => {
    const msg = createMessage(clinic.id);
    store.storeMessage(msg);

    const retrieved = store.getMessages(clinic.id);
    assert.equal(retrieved.length, 1);
    assert.equal(retrieved[0].id, msg.id);
    assert.equal(retrieved[0].clinicId, clinic.id);
  });

  it("store message and retrieve by patient", () => {
    const patientId = "pat-test-001";
    const msg = createMessage(clinic.id, { patientId });
    store.storeMessage(msg);

    const retrieved = store.getMessagesByPatient(patientId);
    assert.equal(retrieved.length, 1);
    assert.equal(retrieved[0].patientId, patientId);
  });

  it("messages ordered by creation time", () => {
    const earlier = createMessage(clinic.id, {
      id: "msg-earlier",
      createdAt: "2025-01-01T10:00:00.000Z",
    });
    const later = createMessage(clinic.id, {
      id: "msg-later",
      createdAt: "2025-01-01T11:00:00.000Z",
    });
    // Store in chronological order (store preserves insertion order)
    store.storeMessage(earlier);
    store.storeMessage(later);

    const messages = store.getMessages(clinic.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].id, "msg-earlier");
    assert.equal(messages[1].id, "msg-later");
  });

  it("getMessages with limit returns correct count", () => {
    for (let i = 0; i < 10; i++) {
      store.storeMessage(
        createMessage(clinic.id, {
          id: `msg-${i}`,
          createdAt: new Date(Date.now() + i * 1000).toISOString(),
        }),
      );
    }

    const limited = store.getMessages(clinic.id, { limit: 3 });
    assert.equal(limited.length, 3, "Should return exactly 3 messages");
    // limit returns the LAST N (most recent), per the slice(-limit) implementation
    assert.equal(limited[0].id, "msg-7");
    assert.equal(limited[2].id, "msg-9");
  });
});

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

describe("connect store -- queue", () => {
  let store: ConnectStore;
  let clinicA: Clinic;
  let clinicB: Clinic;

  beforeEach(() => {
    store = new ConnectStore();
    clinicA = store.registerClinic(clinicInput({ name: "Clinic A" }));
    clinicB = store.registerClinic(clinicInput({ name: "Clinic B" }));
  });

  it("enqueue adds to queue", () => {
    const msg = createMessage(clinicA.id);
    store.enqueue(msg);

    assert.equal(store.getQueueSize(), 1);
    assert.equal(msg.status, "queued", "enqueue should set status to queued");
  });

  it("dequeueAll returns all queued messages and empties queue", () => {
    store.enqueue(createMessage(clinicA.id, { id: "msg-1" }));
    store.enqueue(createMessage(clinicA.id, { id: "msg-2" }));
    store.enqueue(createMessage(clinicB.id, { id: "msg-3" }));

    const dequeued = store.dequeueAll();
    assert.equal(dequeued.length, 3);
    assert.equal(store.getQueueSize(), 0, "Queue should be empty after dequeueAll");
  });

  it("dequeueAll by clinic returns only that clinic's messages", () => {
    store.enqueue(createMessage(clinicA.id, { id: "msg-a1" }));
    store.enqueue(createMessage(clinicA.id, { id: "msg-a2" }));
    store.enqueue(createMessage(clinicB.id, { id: "msg-b1" }));

    const dequeuedA = store.dequeueAll(clinicA.id);
    assert.equal(dequeuedA.length, 2, "Should dequeue 2 messages for clinic A");

    const remaining = store.getQueueSize();
    assert.equal(remaining, 1, "Clinic B message should remain in queue");

    const dequeuedB = store.dequeueAll(clinicB.id);
    assert.equal(dequeuedB.length, 1);
    assert.equal(dequeuedB[0].id, "msg-b1");
  });

  it("queue size reports correctly", () => {
    assert.equal(store.getQueueSize(), 0, "Empty queue should be size 0");

    store.enqueue(createMessage(clinicA.id));
    store.enqueue(createMessage(clinicA.id));
    store.enqueue(createMessage(clinicB.id));

    assert.equal(store.getQueueSize(), 3, "Total queue size should be 3");
    assert.equal(store.getQueueSize(clinicA.id), 2, "Clinic A queue size should be 2");
    assert.equal(store.getQueueSize(clinicB.id), 1, "Clinic B queue size should be 1");
  });
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

describe("connect store -- stats", () => {
  let store: ConnectStore;
  let clinic: Clinic;

  beforeEach(() => {
    store = new ConnectStore();
    clinic = store.registerClinic(clinicInput());
  });

  it("clinic stats count patients correctly", () => {
    store.registerPatient(patientInput(clinic.id, { phone: "+254700111111" }));
    store.registerPatient(patientInput(clinic.id, { phone: "+254700222222" }));
    store.registerPatient(patientInput(clinic.id, { phone: "+254700333333" }));

    const stats = store.getClinicStats(clinic.id);
    assert.equal(stats.patientCount, 3);
  });

  it("clinic stats count messages by status", () => {
    store.storeMessage(createMessage(clinic.id, { id: "m1", status: "sent" }));
    store.storeMessage(createMessage(clinic.id, { id: "m2", status: "sent" }));
    store.storeMessage(createMessage(clinic.id, { id: "m3", status: "delivered" }));
    store.storeMessage(createMessage(clinic.id, { id: "m4", status: "failed" }));
    store.storeMessage(
      createMessage(clinic.id, { id: "m5", direction: "system_alert", status: "sent" }),
    );

    const stats = store.getClinicStats(clinic.id);
    assert.equal(stats.messagesSent, 3, "3 messages with status sent");
    assert.equal(stats.messagesDelivered, 1, "1 message delivered");
    assert.equal(stats.messagesFailed, 1, "1 message failed");
    assert.equal(stats.alertsTriggered, 1, "1 system alert");
  });

  it("empty clinic returns zero stats", () => {
    const stats = store.getClinicStats(clinic.id);
    assert.equal(stats.patientCount, 0);
    assert.equal(stats.messagesSent, 0);
    assert.equal(stats.messagesDelivered, 0);
    assert.equal(stats.messagesFailed, 0);
    assert.equal(stats.alertsTriggered, 0);
    assert.equal(stats.lastActivity, null);
  });

  it("stats lastActivity reflects most recent message", () => {
    const timestamp = "2025-06-15T14:30:00.000Z";
    store.storeMessage(
      createMessage(clinic.id, { id: "m1", createdAt: "2025-06-15T10:00:00.000Z" }),
    );
    store.storeMessage(
      createMessage(clinic.id, { id: "m2", createdAt: timestamp }),
    );

    const stats = store.getClinicStats(clinic.id);
    assert.equal(stats.lastActivity, timestamp);
  });
});
