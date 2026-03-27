/**
 * MeshCue Connect — Consent Manager
 *
 * Manages patient consent for health notifications with full audit trail.
 *
 * Rules:
 * - Consent required before ANY non-emergency message
 * - Emergency/critical alerts ALWAYS sent (duty of care override)
 * - Family notifications require explicit patient consent per contact
 * - Consent expires after 12 months, renewal SMS sent
 * - All consent actions logged with timestamp for audit
 */

import type {
  PatientContact,
  ConsentStatus,
  ConsentEntry,
  ConnectMessage,
  Channel,
  Priority,
} from "./types.js";
import { renderTemplate } from "./templates.js";

// 12 months in milliseconds
const CONSENT_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

// Keywords for consent parsing across supported languages
const YES_KEYWORDS = [
  "YES", "OUI", "SIM", "SÍ", "NDIYO", "نعم", "হ্যাঁ", "हाँ", "是",
  "Y", "1", "START", "ACCEPT",
];
const NO_KEYWORDS = [
  "NO", "NON", "NÃO", "HAPANA", "لا", "না", "नहीं", "否",
  "N", "0", "STOP", "ACHA", "DECLINE",
];

export class ConsentManager {
  private consentLog: Map<string, ConsentEntry[]> = new Map();
  private consentStore: Map<string, { status: ConsentStatus; date: string }> = new Map();
  private sendFn?: (msg: ConnectMessage) => Promise<ConnectMessage>;

  /**
   * Optionally inject a send function for dispatching consent messages.
   * This avoids circular dependency with the router.
   */
  setSendFunction(fn: (msg: ConnectMessage) => Promise<ConnectMessage>): void {
    this.sendFn = fn;
  }

  /**
   * Returns the current consent status for a patient.
   * Checks in-memory store first, then falls back to patient record.
   */
  async getStatus(patient: PatientContact): Promise<ConsentStatus> {
    const stored = this.consentStore.get(patient.phone);
    if (stored) {
      if (stored.status === "opted_in" && this.isDateExpired(stored.date)) {
        return "expired";
      }
      return stored.status;
    }
    return patient.consentStatus;
  }

  /**
   * Sends a consent request to the patient via their preferred channel.
   */
  async requestConsent(patient: PatientContact): Promise<ConnectMessage> {
    const body = renderTemplate(
      "consent_request",
      { name: patient.name },
      patient.language
    );

    const message: ConnectMessage = {
      id: generateId(),
      direction: "clinic_to_patient",
      channel: patient.preferredChannel,
      priority: "routine",
      from: patient.clinicId,
      to: patient.phone,
      patientId: patient.id,
      template: "consent_request",
      templateData: { name: patient.name },
      language: patient.language,
      body,
      status: "queued",
      createdAt: new Date().toISOString(),
      retryCount: 0,
      maxRetries: 3,
    };

    this.logConsentEntry(patient.id, patient.phone, "requested", patient.preferredChannel);

    // Update store to pending
    this.consentStore.set(patient.phone, {
      status: "pending",
      date: new Date().toISOString(),
    });

    if (this.sendFn) {
      return this.sendFn(message);
    }

    return message;
  }

  /**
   * Processes a patient's consent response (YES/NO/STOP) and returns
   * an updated copy of the patient with the new consent status.
   */
  async processResponse(
    patient: PatientContact,
    response: string
  ): Promise<PatientContact> {
    const normalized = response.trim().toUpperCase();
    const now = new Date().toISOString();
    let newStatus: ConsentStatus;

    if (YES_KEYWORDS.includes(normalized)) {
      newStatus = "opted_in";
      this.consentStore.set(patient.phone, { status: "opted_in", date: now });
      this.logConsentEntry(patient.id, patient.phone, "granted", "sms");
    } else if (NO_KEYWORDS.includes(normalized)) {
      newStatus = "opted_out";
      this.consentStore.set(patient.phone, { status: "opted_out", date: now });
      this.logConsentEntry(patient.id, patient.phone, "revoked", "sms");
    } else {
      // Unrecognized response — keep current status
      newStatus = patient.consentStatus;
    }

    return { ...patient, consentStatus: newStatus, consentDate: now };
  }

  /**
   * Low-level consent parsing (phone-based). Returns the new ConsentStatus.
   */
  processConsent(phone: string, response: string): ConsentStatus {
    const normalized = response.trim().toUpperCase();

    if (YES_KEYWORDS.includes(normalized)) {
      const now = new Date().toISOString();
      this.consentStore.set(phone, { status: "opted_in", date: now });
      this.logConsentEntry(
        this.findPatientIdByPhone(phone),
        phone,
        "granted",
        "sms"
      );
      return "opted_in";
    }

    if (NO_KEYWORDS.includes(normalized)) {
      this.consentStore.set(phone, { status: "opted_out", date: new Date().toISOString() });
      this.logConsentEntry(
        this.findPatientIdByPhone(phone),
        phone,
        "revoked",
        "sms"
      );
      return "opted_out";
    }

    const current = this.consentStore.get(phone);
    return current?.status ?? "pending";
  }

  /**
   * Checks whether a patient has active (non-expired) consent.
   */
  async isConsented(patient: PatientContact): Promise<boolean> {
    // Check in-memory store first
    const stored = this.consentStore.get(patient.phone);
    if (stored) {
      if (stored.status !== "opted_in") return false;
      return !this.isDateExpired(stored.date);
    }

    // Fall back to patient record
    if (patient.consentStatus !== "opted_in") return false;
    if (!patient.consentDate) return false;
    return !this.isDateExpired(patient.consentDate);
  }

  /**
   * Synchronous consent check for internal use by the router.
   */
  isConsentedSync(patient: PatientContact): boolean {
    const stored = this.consentStore.get(patient.phone);
    if (stored) {
      if (stored.status !== "opted_in") return false;
      return !this.isDateExpired(stored.date);
    }
    if (patient.consentStatus !== "opted_in") return false;
    if (!patient.consentDate) return false;
    return !this.isDateExpired(patient.consentDate);
  }

  /**
   * Checks whether any family emergency contacts can be notified.
   * Without a contactIndex, checks if the patient has consent and
   * at least one family contact flagged for notifications.
   */
  async canNotifyFamily(patient: PatientContact, contactIndex?: number): Promise<boolean> {
    const consented = await this.isConsented(patient);
    if (!consented) return false;

    if (contactIndex !== undefined) {
      const contact = patient.emergencyContacts[contactIndex];
      if (!contact) return false;
      return contact.notifyOnRoutine || contact.notifyOnCritical;
    }

    // Check if ANY family contact is flagged for notifications
    return patient.emergencyContacts.some(
      (c) => c.notifyOnRoutine || c.notifyOnCritical
    );
  }

  /**
   * Checks whether a family contact can be notified for critical alerts.
   * Critical alerts use the notifyOnCritical flag, which can be true
   * even if the patient has no general consent (duty of care).
   */
  canNotifyFamilyCritical(patient: PatientContact, contactIndex: number): boolean {
    const contact = patient.emergencyContacts[contactIndex];
    if (!contact) return false;
    return contact.notifyOnCritical;
  }

  /**
   * Checks whether a message can be sent given consent + priority rules.
   * Emergency/critical messages bypass consent (duty of care).
   */
  async canSend(patient: PatientContact, priority: Priority): Promise<boolean> {
    // Duty of care override: critical always goes through
    if (priority === "critical") {
      return true;
    }
    // Urgent also goes through (time-sensitive medical)
    if (priority === "urgent") {
      return true;
    }
    return this.isConsented(patient);
  }

  /**
   * Synchronous version of canSend for internal router use.
   */
  canSendMessage(patient: PatientContact, priority: Priority): boolean {
    if (priority === "critical" || priority === "urgent") {
      return true;
    }
    return this.isConsentedSync(patient);
  }

  /**
   * Revokes consent for a phone number.
   */
  revokeConsent(phone: string): void {
    this.consentStore.set(phone, {
      status: "opted_out",
      date: new Date().toISOString(),
    });
    this.logConsentEntry(
      this.findPatientIdByPhone(phone),
      phone,
      "revoked",
      "sms"
    );
  }

  /**
   * Returns the full consent audit log for a patient.
   * Aliased as both getConsentLog and getLog for compatibility.
   */
  getConsentLog(patientId: string): ConsentEntry[] {
    return this.consentLog.get(patientId) ?? [];
  }

  async getLog(patientId: string): Promise<ConsentEntry[]> {
    return this.consentLog.get(patientId) ?? [];
  }

  /**
   * Checks if a consent date has expired (older than 12 months).
   */
  isDateExpired(consentDate: string): boolean {
    const granted = new Date(consentDate).getTime();
    const now = Date.now();
    return now - granted > CONSENT_EXPIRY_MS;
  }

  // ─── Private Helpers ───────────────────────────────────────

  private logConsentEntry(
    patientId: string,
    phone: string,
    action: ConsentEntry["action"],
    channel: Channel,
    details?: string
  ): void {
    const entry: ConsentEntry = {
      patientId,
      phone,
      action,
      channel,
      timestamp: new Date().toISOString(),
      details,
    };

    const log = this.consentLog.get(patientId) ?? [];
    log.push(entry);
    this.consentLog.set(patientId, log);
  }

  /**
   * Reverse-lookup patient ID from phone. Returns phone as fallback.
   */
  private findPatientIdByPhone(phone: string): string {
    for (const [patientId, entries] of this.consentLog.entries()) {
      if (entries.some((e) => e.phone === phone)) {
        return patientId;
      }
    }
    return phone;
  }
}

// ─── Utilities ─────────────────────────────────────────────────

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
