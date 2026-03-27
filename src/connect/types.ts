/**
 * MeshCue Connect — Core Type Definitions
 *
 * Message routing engine for clinic→patient, patient→clinic,
 * patient→family, and CHW→supervisor communication.
 */

// Message channels
export type Channel = "sms" | "ussd" | "whatsapp" | "voice" | "mesh" | "push";

// Message priority
export type Priority = "critical" | "urgent" | "routine" | "info";

// Message direction
export type Direction =
  | "clinic_to_patient"
  | "patient_to_clinic"
  | "patient_to_family"
  | "chw_to_supervisor"
  | "system_alert";

// Consent status
export type ConsentStatus = "opted_in" | "opted_out" | "pending" | "expired";

// Patient contact
export interface PatientContact {
  id: string;
  name: string;
  phone: string;
  language: "en" | "fr" | "pt" | "es" | "sw" | "ar" | "bn" | "hi" | "zh";
  preferredChannel: Channel;
  consentStatus: ConsentStatus;
  consentDate?: string;
  emergencyContacts: EmergencyContact[];
  clinicId: string;
  chwId?: string; // assigned community health worker
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
  language?: string;
  notifyOnCritical: boolean;
  notifyOnRoutine: boolean;
}

// Message
export interface ConnectMessage {
  id: string;
  clinicId: string;
  direction: Direction;
  channel: Channel;
  priority: Priority;
  from: string; // phone or device ID
  to: string; // phone or device ID
  patientId?: string;
  template: string; // template name
  templateData: Record<string, string | number>;
  language: string;
  body?: string; // rendered message body
  status: "queued" | "sent" | "delivered" | "failed" | "read";
  createdAt: string;
  sentAt?: string;
  deliveredAt?: string;
  failReason?: string;
  retryCount: number;
  maxRetries: number;
}

// Alert from device (Forge/Mesh integration)
export interface DeviceAlert {
  deviceId: string;
  patientId: string;
  clinicId: string;
  reading: string; // e.g., "SpO2"
  value: number;
  unit: string;
  threshold: number;
  severity: "critical" | "warning" | "info";
  timestamp: string;
}

// Triage result
export interface TriageResult {
  priority: Priority;
  actions: TriageAction[];
  escalate: boolean;
  escalateTo?: string; // nurse/doctor/supervisor phone
}

export interface TriageAction {
  channel: Channel;
  recipient: string; // "patient" | "family" | "nurse" | "chw" | "supervisor"
  template: string;
  delay?: number; // delay in seconds before sending
}

// USSD session
export interface USSDSession {
  sessionId: string;
  phone: string;
  currentMenu: string;
  data: Record<string, string>;
  startedAt: string;
  lastActivityAt: string;
}

// Channel provider interface
export interface ChannelProvider {
  name: string;
  channel: Channel;
  send(
    to: string,
    body: string,
    options?: Record<string, unknown>
  ): Promise<{ messageId: string; status: string }>;
  getStatus(messageId: string): Promise<string>;
}

// Connect configuration
export interface ConnectConfig {
  // Africa's Talking
  atApiKey?: string;
  atUsername?: string;
  atShortCode?: string;

  // WhatsApp Business
  whatsappToken?: string;
  whatsappPhoneId?: string;

  // Voice/IVR
  voiceProvider?: "africastalking" | "twilio";
  twilioSid?: string;
  twilioToken?: string;
  twilioPhone?: string;

  // Defaults
  defaultChannel: Channel;
  defaultLanguage: string;
  maxRetries: number;
  retryDelayMs: number;
  criticalEscalationPhone?: string; // fallback for critical alerts
  channelPriority?: Channel[]; // fallback order for delivery attempts
}

// Consent log entry (for audit trail)
export interface ConsentEntry {
  patientId: string;
  phone: string;
  action: "requested" | "granted" | "revoked" | "expired" | "renewed";
  channel: Channel;
  timestamp: string;
  details?: string;
}

// ─── Multi-Tenant Clinic Model ──────────────────────────────────

// Clinic — the tenant that owns communication channels
export interface Clinic {
  id: string;
  name: string;
  location: string;
  country: string;
  language: "en" | "fr" | "pt" | "es" | "sw" | "ar" | "bn" | "hi" | "zh";
  timezone: string;

  // Clinic-owned communication credentials
  channels: ClinicChannelConfig;

  // Clinic admin
  adminPhone: string;
  adminName: string;

  // Operational
  operatingHours?: { start: string; end: string }; // "08:00" - "17:00"
  emergencyPhone?: string; // after-hours emergency

  // Subscription
  tier: "free" | "basic" | "professional" | "enterprise";
  createdAt: string;
  active: boolean;
}

export interface ClinicChannelConfig {
  sms?: {
    provider: "africastalking" | "twilio" | "vonage";
    apiKey: string;
    apiSecret?: string; // for Twilio SID
    username?: string; // for Africa's Talking
    shortCode?: string;
    senderId?: string;
  };
  whatsapp?: {
    token: string;
    phoneId: string;
    businessName?: string;
  };
  voice?: {
    provider: "africastalking" | "twilio";
    apiKey?: string;
    sid?: string;
    token?: string;
    phone?: string;
  };
  ussd?: {
    serviceCode: string; // e.g., *384*123#
    provider: "africastalking";
    apiKey: string;
    username?: string;
  };
}

// Subscription tiers
export interface SubscriptionTier {
  name: string;
  maxPatients: number;
  maxDevices: number;
  maxMessagesPerMonth: number;
  channels: Channel[];
  features: string[];
  priceUsd: number; // 0 for free tier
}
