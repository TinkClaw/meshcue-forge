/**
 * MeshCue Connect — MCP Tool Definitions
 *
 * Registers Connect tools on an McpServer so AI agents can
 * send messages, manage patients, handle alerts, and administer clinics.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type {
  ConnectMessage,
  TriageResult,
  TriageAction,
  Priority,
  Channel,
  PatientContact,
  ConnectConfig,
} from "./types.js";
import { loadConnectConfig } from "./config.js";

// ─── Clinic Types ────────────────────────────────────────────

interface ClinicSmsConfig {
  provider: "africastalking" | "twilio" | "vonage";
  apiKey: string;
  apiSecret?: string;
  username?: string;
  shortCode?: string;
  senderId?: string;
}

interface ClinicWhatsAppConfig {
  token: string;
  phoneId: string;
  businessName?: string;
}

interface ClinicVoiceConfig {
  provider: "africastalking" | "twilio";
  apiKey?: string;
  sid?: string;
  token?: string;
  phone?: string;
}

interface Clinic {
  id: string;
  name: string;
  location: string;
  country: string;
  language: string;
  adminName: string;
  adminPhone: string;
  tier: "free" | "basic" | "professional" | "enterprise";
  createdAt: string;
  channels: {
    sms?: ClinicSmsConfig;
    whatsapp?: ClinicWhatsAppConfig;
    voice?: ClinicVoiceConfig;
  };
  stats: {
    patients: number;
    devices: number;
    messagesSent: number;
    alertsTriggered: number;
    lastActivity?: string;
  };
}

interface ClinicAlert {
  id: string;
  clinicId: string;
  type: string;
  severity: "critical" | "warning" | "info";
  message: string;
  createdAt: string;
}

// ─── Tier Limits ─────────────────────────────────────────────

const TIER_LIMITS: Record<string, { patients: number; messagesPerMonth: number; devices: number; channels: number }> = {
  free:         { patients: 50,    messagesPerMonth: 500,    devices: 10,    channels: 1 },
  basic:        { patients: 500,   messagesPerMonth: 5000,   devices: 100,   channels: 2 },
  professional: { patients: 5000,  messagesPerMonth: 50000,  devices: 1000,  channels: 3 },
  enterprise:   { patients: -1,    messagesPerMonth: -1,     devices: -1,    channels: 3 },
};

// ─── Shared In-Memory Store ──────────────────────────────────

class ConnectStore {
  readonly clinics = new Map<string, Clinic>();
  readonly patients = new Map<string, PatientContact>();
  readonly messages: ConnectMessage[] = [];
  readonly alerts: ClinicAlert[] = [];

  getClinic(clinicId: string): Clinic | undefined {
    return this.clinics.get(clinicId);
  }

  requireClinic(clinicId: string): Clinic {
    const clinic = this.clinics.get(clinicId);
    if (!clinic) {
      throw new Error(`Clinic not found: ${clinicId}`);
    }
    return clinic;
  }

  getPatientsForClinic(clinicId: string): PatientContact[] {
    const result: PatientContact[] = [];
    for (const [, p] of this.patients) {
      if (p.clinicId === clinicId) result.push(p);
    }
    return result;
  }

  getMessagesForClinic(clinicId: string, patientId?: string): ConnectMessage[] {
    const clinicPatientIds = new Set<string>();
    for (const [, p] of this.patients) {
      if (p.clinicId === clinicId) clinicPatientIds.add(p.id);
    }
    return this.messages.filter((m) => {
      if (patientId) return m.patientId === patientId;
      return m.patientId ? clinicPatientIds.has(m.patientId) : false;
    });
  }

  getAlertsForClinic(clinicId: string): ClinicAlert[] {
    return this.alerts.filter((a) => a.clinicId === clinicId);
  }

  findPatientByPhone(phone: string): PatientContact | undefined {
    for (const [, p] of this.patients) {
      if (p.phone === phone) return p;
    }
    return undefined;
  }

  /** Build ConnectConfig for a specific clinic, falling back to env-level config. */
  configForClinic(clinicId: string): ConnectConfig {
    const base = loadConnectConfig();
    const clinic = this.clinics.get(clinicId);
    if (!clinic) return base;

    const cfg: ConnectConfig = { ...base };

    if (clinic.channels.sms) {
      const sms = clinic.channels.sms;
      cfg.atApiKey = sms.apiKey;
      cfg.atUsername = sms.username;
      cfg.atShortCode = sms.shortCode || sms.senderId;
      if (sms.provider === "twilio") {
        cfg.twilioSid = sms.apiSecret;
        cfg.twilioToken = sms.apiKey;
      }
    }

    if (clinic.channels.whatsapp) {
      cfg.whatsappToken = clinic.channels.whatsapp.token;
      cfg.whatsappPhoneId = clinic.channels.whatsapp.phoneId;
    }

    if (clinic.channels.voice) {
      const v = clinic.channels.voice;
      cfg.voiceProvider = v.provider;
      if (v.provider === "twilio") {
        cfg.twilioSid = v.sid;
        cfg.twilioToken = v.token;
        cfg.twilioPhone = v.phone;
      } else {
        cfg.atApiKey = v.apiKey;
      }
    }

    cfg.defaultLanguage = clinic.language || base.defaultLanguage;
    return cfg;
  }

  recordActivity(clinicId: string): void {
    const clinic = this.clinics.get(clinicId);
    if (clinic) {
      clinic.stats.lastActivity = nowISO();
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function nowISO(): string {
  return new Date().toISOString();
}

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function err(msg: string) {
  return {
    content: [{ type: "text" as const, text: msg }],
    isError: true,
  };
}

function triageAlert(
  severity: "critical" | "warning" | "info",
  reading: string,
  _value: number,
  _threshold: number
): TriageResult {
  const actions: TriageAction[] = [];
  let priority: Priority;
  let escalate = false;

  switch (severity) {
    case "critical":
      priority = "critical";
      escalate = true;
      actions.push(
        { channel: "sms", recipient: "patient", template: "alert_critical" },
        { channel: "sms", recipient: "family", template: "alert_family_critical" },
        { channel: "voice", recipient: "nurse", template: "alert_nurse_call", delay: 30 },
        { channel: "sms", recipient: "chw", template: "alert_chw_critical" }
      );
      break;
    case "warning":
      priority = "urgent";
      actions.push(
        { channel: "sms", recipient: "patient", template: "alert_warning" },
        { channel: "sms", recipient: "nurse", template: "alert_nurse_warning", delay: 60 }
      );
      break;
    default:
      priority = "info";
      actions.push(
        { channel: "sms", recipient: "patient", template: "alert_info" }
      );
  }

  const config = loadConnectConfig();

  return {
    priority,
    actions,
    escalate,
    escalateTo: escalate ? config.criticalEscalationPhone : undefined,
  };
}

function buildAlertMessages(
  store: ConnectStore,
  alert: {
    deviceId: string;
    patientId: string;
    clinicId: string;
    reading: string;
    value: number;
    unit: string;
    threshold: number;
    severity: "critical" | "warning" | "info";
  },
  triage: TriageResult
): ConnectMessage[] {
  const config = store.configForClinic(alert.clinicId);
  const patient = store.patients.get(alert.patientId);
  const messages: ConnectMessage[] = [];

  for (const action of triage.actions) {
    let toPhone = "";
    if (action.recipient === "patient" && patient) {
      toPhone = patient.phone;
    } else if (action.recipient === "family" && patient?.emergencyContacts[0]) {
      toPhone = patient.emergencyContacts[0].phone;
    } else if (action.recipient === "nurse" || action.recipient === "chw" || action.recipient === "supervisor") {
      toPhone = config.criticalEscalationPhone || "";
    }

    const msg: ConnectMessage = {
      id: randomUUID(),
      clinicId: alert.clinicId,
      direction: "system_alert",
      channel: action.channel as Channel,
      priority: triage.priority,
      from: config.atShortCode || "MESHCUE",
      to: toPhone,
      patientId: alert.patientId,
      template: action.template,
      templateData: {
        reading: alert.reading,
        value: alert.value,
        unit: alert.unit,
        threshold: alert.threshold,
        deviceId: alert.deviceId,
      },
      language: patient?.language || config.defaultLanguage,
      body: `[${alert.severity.toUpperCase()}] ${alert.reading}: ${alert.value}${alert.unit} (threshold: ${alert.threshold}${alert.unit}). Device: ${alert.deviceId}`,
      status: "queued",
      createdAt: nowISO(),
      retryCount: 0,
      maxRetries: config.maxRetries,
    };
    messages.push(msg);
    store.messages.push(msg);
  }

  return messages;
}

function renderTemplateBody(
  template: string,
  data: Record<string, unknown>,
  _language: string
): string {
  const templates: Record<string, string> = {
    alert_critical:
      "URGENT: Your {reading} reading is {value}{unit}, which is outside the safe range ({threshold}{unit}). Please seek care immediately or call your clinic.",
    alert_warning:
      "Notice: Your {reading} reading is {value}{unit}. Safe threshold is {threshold}{unit}. Please monitor and contact your clinic if symptoms worsen.",
    alert_info:
      "Info: Your {reading} reading is {value}{unit} (threshold: {threshold}{unit}). No action needed.",
    alert_family_critical:
      "ALERT: Your family member's {reading} is {value}{unit} (critical threshold: {threshold}{unit}). Please check on them or call the clinic.",
    alert_nurse_call:
      "CRITICAL PATIENT ALERT: {reading} at {value}{unit} (threshold: {threshold}{unit}). Device: {deviceId}. Immediate follow-up required.",
    alert_nurse_warning:
      "Patient alert: {reading} at {value}{unit} (threshold: {threshold}{unit}). Device: {deviceId}. Review at next opportunity.",
    alert_chw_critical:
      "URGENT: Patient device {deviceId} flagged critical {reading}: {value}{unit}. Please visit patient immediately.",
    appointment_reminder:
      "Reminder: You have an appointment on {date} at {time}. Reply YES to confirm or NO to reschedule.",
    welcome:
      "Welcome to MeshCue Connect! You are now registered at {clinic}. Reply HELP for assistance.",
    clinic_sms_test:
      "MeshCue Connect: SMS channel configured successfully for {clinic}. This is a test message.",
    clinic_channel_test:
      "MeshCue Connect: {channel} channel test for {clinic}. If you receive this, the channel is working.",
  };

  let body = templates[template] || `[${template}] ${JSON.stringify(data)}`;
  for (const [key, val] of Object.entries(data)) {
    body = body.replace(new RegExp(`\\{${key}\\}`, "g"), String(val));
  }
  return body;
}

function classifyIncoming(body: string): {
  response: string;
  triaged: boolean;
  priority: Priority;
  actions: string[];
} {
  const lower = body.trim().toLowerCase();

  if (lower === "stop" || lower === "opt out" || lower === "unsubscribe") {
    return {
      response:
        "You have been unsubscribed from MeshCue Connect messages. Reply START to re-subscribe.",
      triaged: false,
      priority: "info",
      actions: ["opt_out"],
    };
  }

  if (lower === "start" || lower === "opt in" || lower === "subscribe") {
    return {
      response:
        "Welcome back! You have been re-subscribed to MeshCue Connect messages.",
      triaged: false,
      priority: "info",
      actions: ["opt_in"],
    };
  }

  if (lower === "help" || lower === "?") {
    return {
      response:
        "MeshCue Connect: Reply STOP to unsubscribe. Reply YES/NO to respond to appointment reminders. For emergencies, call your clinic directly.",
      triaged: false,
      priority: "info",
      actions: ["help_shown"],
    };
  }

  const urgentKeywords = [
    "emergency",
    "help me",
    "cant breathe",
    "can't breathe",
    "pain",
    "bleeding",
    "fallen",
    "unconscious",
    "chest pain",
  ];
  if (urgentKeywords.some((kw) => lower.includes(kw))) {
    return {
      response:
        "Your message has been flagged as urgent and forwarded to your clinic nurse. If this is a life-threatening emergency, call emergency services immediately.",
      triaged: true,
      priority: "critical",
      actions: ["escalate_nurse", "log_urgent"],
    };
  }

  if (lower === "yes" || lower === "no") {
    return {
      response:
        lower === "yes"
          ? "Thank you for confirming. See you at your appointment!"
          : "Your appointment will be rescheduled. Your clinic will contact you with a new time.",
      triaged: false,
      priority: "routine",
      actions: [
        lower === "yes" ? "appointment_confirmed" : "appointment_reschedule",
      ],
    };
  }

  return {
    response:
      "Thank you for your message. It has been forwarded to your clinic team. They will respond shortly.",
    triaged: true,
    priority: "routine",
    actions: ["forward_clinic"],
  };
}

// ─── Tool Registration ────────────────────────────────────────

export function registerConnectTools(server: McpServer): void {
  const store = new ConnectStore();

  // ═══════════════════════════════════════════════════════════════
  // CLINIC ADMINISTRATION TOOLS
  // ═══════════════════════════════════════════════════════════════

  // ── meshcue-clinic-register ─────────────────────────────────
  server.tool(
    "meshcue-clinic-register",
    "Register a new clinic on the MeshCue Connect platform. Returns a unique " +
      "clinic ID for use with all other clinic-* tools.",
    {
      name: z.string().describe("Clinic name, e.g. 'Kibera Community Health Center'"),
      location: z.string().describe("Clinic location, e.g. 'Nairobi, Kenya'"),
      country: z.string().length(2).describe("ISO 3166-1 alpha-2 country code, e.g. 'KE'"),
      language: z
        .string()
        .optional()
        .describe("Default language code, e.g. 'sw', 'en', 'fr'. Default: 'en'"),
      adminName: z.string().describe("Clinic admin full name, e.g. 'Dr. Amina Osei'"),
      adminPhone: z.string().describe("Admin phone number in E.164 format, e.g. '+254700123456'"),
      tier: z
        .enum(["free", "basic", "professional", "enterprise"])
        .optional()
        .describe("Subscription tier. Default: 'free'"),
    },
    async ({ name, location, country, language, adminName, adminPhone, tier }) => {
      try {
        const clinicId = `clinic_${randomUUID().slice(0, 12)}`;
        const selectedTier = tier || "free";
        const lang = language || "en";

        const clinic: Clinic = {
          id: clinicId,
          name,
          location,
          country: country.toUpperCase(),
          language: lang,
          adminName,
          adminPhone,
          tier: selectedTier,
          createdAt: nowISO(),
          channels: {},
          stats: {
            patients: 0,
            devices: 0,
            messagesSent: 0,
            alertsTriggered: 0,
          },
        };

        store.clinics.set(clinicId, clinic);

        return ok({
          clinicId,
          name,
          tier: selectedTier,
          message: `Clinic '${name}' registered successfully. Use the clinicId '${clinicId}' to configure channels and manage patients.`,
        });
      } catch (e) {
        return err(`Clinic registration error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  // ── meshcue-clinic-setup-sms ────────────────────────────────
  server.tool(
    "meshcue-clinic-setup-sms",
    "Configure SMS channel for a clinic. Supports Africa's Talking, Twilio, " +
      "and Vonage providers. Sends a test SMS to the admin phone on success.",
    {
      clinicId: z.string().describe("Clinic ID returned from meshcue-clinic-register"),
      provider: z
        .enum(["africastalking", "twilio", "vonage"])
        .describe("SMS provider"),
      apiKey: z.string().describe("Provider API key (or Twilio Auth Token)"),
      apiSecret: z
        .string()
        .optional()
        .describe("Twilio Account SID, or Vonage API secret"),
      username: z
        .string()
        .optional()
        .describe("Africa's Talking username (required for AT)"),
      shortCode: z
        .string()
        .optional()
        .describe("SMS short code for the clinic"),
      senderId: z
        .string()
        .optional()
        .describe("Alphanumeric sender ID, e.g. 'MyClinic'"),
    },
    async ({ clinicId, provider, apiKey, apiSecret, username, shortCode, senderId }) => {
      try {
        const clinic = store.requireClinic(clinicId);

        if (provider === "africastalking" && !username) {
          return err("Africa's Talking requires a 'username' parameter.");
        }

        const smsConfig: ClinicSmsConfig = {
          provider,
          apiKey,
          apiSecret,
          username,
          shortCode,
          senderId,
        };

        clinic.channels.sms = smsConfig;
        store.recordActivity(clinicId);

        // Queue a test SMS to the admin phone
        const testBody = renderTemplateBody(
          "clinic_sms_test",
          { clinic: clinic.name },
          clinic.language
        );
        const testMsg: ConnectMessage = {
          id: randomUUID(),
          clinicId: clinic.id,
          direction: "system_alert",
          channel: "sms",
          priority: "info",
          from: shortCode || senderId || "MESHCUE",
          to: clinic.adminPhone,
          template: "clinic_sms_test",
          templateData: { clinic: clinic.name },
          language: clinic.language,
          body: testBody,
          status: "queued",
          createdAt: nowISO(),
          retryCount: 0,
          maxRetries: 1,
        };
        store.messages.push(testMsg);

        return ok({
          success: true,
          channel: "sms",
          provider,
          testMessage: `Test SMS queued to ${clinic.adminPhone}: "${testBody}"`,
        });
      } catch (e) {
        return err(`SMS setup error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  // ── meshcue-clinic-setup-whatsapp ───────────────────────────
  server.tool(
    "meshcue-clinic-setup-whatsapp",
    "Configure WhatsApp Business API channel for a clinic using Meta Cloud API credentials.",
    {
      clinicId: z.string().describe("Clinic ID"),
      token: z.string().describe("WhatsApp Business API permanent token"),
      phoneId: z.string().describe("WhatsApp phone number ID from Meta Business Manager"),
      businessName: z
        .string()
        .optional()
        .describe("WhatsApp Business display name"),
    },
    async ({ clinicId, token, phoneId, businessName }) => {
      try {
        const clinic = store.requireClinic(clinicId);

        clinic.channels.whatsapp = {
          token,
          phoneId,
          businessName,
        };

        store.recordActivity(clinicId);

        return ok({
          success: true,
          channel: "whatsapp",
        });
      } catch (e) {
        return err(`WhatsApp setup error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  // ── meshcue-clinic-setup-voice ──────────────────────────────
  server.tool(
    "meshcue-clinic-setup-voice",
    "Configure voice/IVR channel for a clinic. Supports Africa's Talking and Twilio voice APIs.",
    {
      clinicId: z.string().describe("Clinic ID"),
      provider: z
        .enum(["africastalking", "twilio"])
        .describe("Voice provider"),
      apiKey: z
        .string()
        .optional()
        .describe("Africa's Talking API key (required for AT provider)"),
      sid: z
        .string()
        .optional()
        .describe("Twilio Account SID (required for Twilio provider)"),
      token: z
        .string()
        .optional()
        .describe("Twilio Auth Token (required for Twilio provider)"),
      phone: z
        .string()
        .optional()
        .describe("Voice-enabled phone number in E.164 format"),
    },
    async ({ clinicId, provider, apiKey, sid, token, phone }) => {
      try {
        const clinic = store.requireClinic(clinicId);

        if (provider === "africastalking" && !apiKey) {
          return err("Africa's Talking voice requires an 'apiKey' parameter.");
        }
        if (provider === "twilio" && (!sid || !token)) {
          return err("Twilio voice requires both 'sid' and 'token' parameters.");
        }

        clinic.channels.voice = {
          provider,
          apiKey,
          sid,
          token,
          phone,
        };

        store.recordActivity(clinicId);

        return ok({
          success: true,
          channel: "voice",
        });
      } catch (e) {
        return err(`Voice setup error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  // ── meshcue-clinic-dashboard ────────────────────────────────
  server.tool(
    "meshcue-clinic-dashboard",
    "Get a clinic overview dashboard with stats, subscription usage, " +
      "configured channels, and recent alerts.",
    {
      clinicId: z.string().describe("Clinic ID"),
    },
    async ({ clinicId }) => {
      try {
        const clinic = store.requireClinic(clinicId);
        const limits = TIER_LIMITS[clinic.tier] || TIER_LIMITS.free;

        const configuredChannels: string[] = [];
        if (clinic.channels.sms) configuredChannels.push("sms");
        if (clinic.channels.whatsapp) configuredChannels.push("whatsapp");
        if (clinic.channels.voice) configuredChannels.push("voice");

        const recentAlerts = store
          .getAlertsForClinic(clinicId)
          .slice(-10)
          .reverse();

        const patientsUsage =
          limits.patients === -1
            ? 0
            : Math.round((clinic.stats.patients / limits.patients) * 100);
        const messagesUsage =
          limits.messagesPerMonth === -1
            ? 0
            : Math.round((clinic.stats.messagesSent / limits.messagesPerMonth) * 100);
        const devicesUsage =
          limits.devices === -1
            ? 0
            : Math.round((clinic.stats.devices / limits.devices) * 100);

        return ok({
          clinic: {
            name: clinic.name,
            location: clinic.location,
            tier: clinic.tier,
            channelsConfigured: configuredChannels,
          },
          stats: {
            patients: clinic.stats.patients,
            devices: clinic.stats.devices,
            messagesSent: clinic.stats.messagesSent,
            alertsTriggered: clinic.stats.alertsTriggered,
            lastActivity: clinic.stats.lastActivity || "never",
          },
          subscription: {
            tier: clinic.tier,
            limits: {
              patients: limits.patients === -1 ? "unlimited" : limits.patients,
              messagesPerMonth: limits.messagesPerMonth === -1 ? "unlimited" : limits.messagesPerMonth,
              devices: limits.devices === -1 ? "unlimited" : limits.devices,
              channels: limits.channels,
            },
            usage: {
              patientsPercent: patientsUsage,
              messagesPercent: messagesUsage,
              devicesPercent: devicesUsage,
            },
          },
          recentAlerts,
        });
      } catch (e) {
        return err(`Dashboard error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  // ── meshcue-clinic-patients ─────────────────────────────────
  server.tool(
    "meshcue-clinic-patients",
    "List patients registered under a specific clinic.",
    {
      clinicId: z.string().describe("Clinic ID"),
      limit: z
        .number()
        .optional()
        .describe("Max number of patients to return. Default: 50"),
    },
    async ({ clinicId, limit }) => {
      try {
        store.requireClinic(clinicId);
        const all = store.getPatientsForClinic(clinicId);
        const cap = limit ?? 50;
        const sliced = all.slice(0, cap);

        return ok({
          patients: sliced,
          total: all.length,
        });
      } catch (e) {
        return err(`Patients list error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  // ── meshcue-clinic-messages ─────────────────────────────────
  server.tool(
    "meshcue-clinic-messages",
    "View message history for a clinic, optionally filtered by patient.",
    {
      clinicId: z.string().describe("Clinic ID"),
      patientId: z
        .string()
        .optional()
        .describe("Filter messages for a specific patient ID"),
      limit: z
        .number()
        .optional()
        .describe("Max number of messages to return. Default: 50"),
    },
    async ({ clinicId, patientId, limit }) => {
      try {
        store.requireClinic(clinicId);
        const all = store.getMessagesForClinic(clinicId, patientId);
        const cap = limit ?? 50;
        const sliced = all.slice(-cap).reverse();

        return ok({
          messages: sliced,
          total: all.length,
        });
      } catch (e) {
        return err(`Messages error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  // ── meshcue-clinic-test-channel ─────────────────────────────
  server.tool(
    "meshcue-clinic-test-channel",
    "Send a test message through a configured channel to verify it works.",
    {
      clinicId: z.string().describe("Clinic ID"),
      channel: z
        .enum(["sms", "whatsapp", "voice"])
        .describe("Channel to test"),
      testPhone: z
        .string()
        .optional()
        .describe("Phone to send the test to. Default: clinic admin phone"),
    },
    async ({ clinicId, channel, testPhone }) => {
      try {
        const clinic = store.requireClinic(clinicId);

        // Check channel is configured
        if (channel === "sms" && !clinic.channels.sms) {
          return ok({ success: false, error: "SMS channel not configured. Use meshcue-clinic-setup-sms first." });
        }
        if (channel === "whatsapp" && !clinic.channels.whatsapp) {
          return ok({ success: false, error: "WhatsApp channel not configured. Use meshcue-clinic-setup-whatsapp first." });
        }
        if (channel === "voice" && !clinic.channels.voice) {
          return ok({ success: false, error: "Voice channel not configured. Use meshcue-clinic-setup-voice first." });
        }

        const recipient = testPhone || clinic.adminPhone;
        const testBody = renderTemplateBody(
          "clinic_channel_test",
          { channel, clinic: clinic.name },
          clinic.language
        );

        const testMsg: ConnectMessage = {
          id: randomUUID(),
          clinicId: clinic.id,
          direction: "system_alert",
          channel: channel as Channel,
          priority: "info",
          from: clinic.channels.sms?.shortCode || clinic.channels.sms?.senderId || "MESHCUE",
          to: recipient,
          template: "clinic_channel_test",
          templateData: { channel, clinic: clinic.name },
          language: clinic.language,
          body: testBody,
          status: "queued",
          createdAt: nowISO(),
          retryCount: 0,
          maxRetries: 1,
        };
        store.messages.push(testMsg);
        store.recordActivity(clinicId);

        return ok({
          success: true,
          messageId: testMsg.id,
        });
      } catch (e) {
        return err(`Channel test error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // EXISTING CONNECT TOOLS (now clinic-aware)
  // ═══════════════════════════════════════════════════════════════

  // ── meshcue-connect-alert ───────────────────────────────────
  server.tool(
    "meshcue-connect-alert",
    "Process a device alert and generate appropriate messages to patient, " +
      "family, and clinical staff based on severity. Uses the clinic's own " +
      "channel credentials. Critical alerts trigger voice callbacks and CHW dispatch.",
    {
      deviceId: z.string().describe("Device ID that generated the alert"),
      patientId: z.string().describe("Patient ID linked to the device"),
      clinicId: z.string().describe("Clinic ID where the patient is registered"),
      reading: z.string().describe("Vital sign name, e.g. 'SpO2', 'HR', 'Temp'"),
      value: z.number().describe("The measured value"),
      unit: z.string().describe("Unit of measurement, e.g. '%', 'bpm', 'C'"),
      threshold: z.number().describe("The threshold that was breached"),
      severity: z
        .enum(["critical", "warning", "info"])
        .describe("Alert severity level"),
    },
    async ({ deviceId, patientId, clinicId, reading, value, unit, threshold, severity }) => {
      try {
        const clinic = store.getClinic(clinicId);
        const alert = { deviceId, patientId, clinicId, reading, value, unit, threshold, severity };
        const triage = triageAlert(severity, reading, value, threshold);
        const messages = buildAlertMessages(store, alert, triage);

        // Update clinic stats
        if (clinic) {
          clinic.stats.alertsTriggered++;
          clinic.stats.messagesSent += messages.length;
          store.recordActivity(clinicId);
        }

        // Record alert
        store.alerts.push({
          id: randomUUID(),
          clinicId,
          type: reading,
          severity,
          message: `${reading}: ${value}${unit} (threshold: ${threshold}${unit})`,
          createdAt: nowISO(),
        });

        return ok({ messages, triage });
      } catch (e) {
        return err(`Alert processing error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  // ── meshcue-connect-send ────────────────────────────────────
  server.tool(
    "meshcue-connect-send",
    "Send a message to a patient or contact using a named template. " +
      "Supports SMS, WhatsApp, and voice channels with automatic language selection. " +
      "Uses the clinic's own channel credentials when clinicId is provided.",
    {
      clinicId: z
        .string()
        .optional()
        .describe("Clinic ID to use for credentials and sender ID"),
      to: z.string().describe("Recipient phone number in E.164 format"),
      template: z.string().describe("Template name, e.g. 'appointment_reminder', 'welcome'"),
      data: z
        .string()
        .describe("JSON string of template variables, e.g. '{\"date\":\"2026-04-01\",\"time\":\"10:00\"}'"),
      channel: z
        .enum(["sms", "whatsapp", "voice"])
        .optional()
        .describe("Delivery channel. Default: configured default (usually sms)"),
      language: z
        .string()
        .optional()
        .describe("Language code, e.g. 'en', 'fr', 'sw'. Default: configured default"),
    },
    async ({ clinicId, to, template, data, channel, language }) => {
      try {
        const config = clinicId
          ? store.configForClinic(clinicId)
          : loadConnectConfig();
        const parsedData: Record<string, unknown> = JSON.parse(data);
        const lang = language || config.defaultLanguage;
        const ch = channel || config.defaultChannel;
        const body = renderTemplateBody(template, parsedData, lang);

        const msg: ConnectMessage = {
          id: randomUUID(),
          clinicId: clinicId || "",
          direction: "clinic_to_patient",
          channel: ch as Channel,
          priority: "routine",
          from: config.atShortCode || "MESHCUE",
          to,
          template,
          templateData: parsedData as Record<string, string | number>,
          language: lang,
          body,
          status: "queued",
          createdAt: nowISO(),
          retryCount: 0,
          maxRetries: config.maxRetries,
        };
        store.messages.push(msg);

        // Update clinic stats
        if (clinicId) {
          const clinic = store.getClinic(clinicId);
          if (clinic) {
            clinic.stats.messagesSent++;
            store.recordActivity(clinicId);
          }
        }

        return ok({ messageId: msg.id, status: msg.status, body: msg.body });
      } catch (e) {
        return err(`Send error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  // ── meshcue-connect-register ────────────────────────────────
  server.tool(
    "meshcue-connect-register",
    "Register a patient for MeshCue Connect messaging under a specific clinic. " +
      "Sets up consent, preferred language, and emergency contacts.",
    {
      clinicId: z.string().describe("Clinic ID to register the patient under (required)"),
      name: z.string().describe("Patient full name"),
      phone: z.string().describe("Patient phone number in E.164 format"),
      language: z
        .string()
        .optional()
        .describe("Preferred language code. Default: clinic's default language"),
      emergencyContacts: z
        .string()
        .optional()
        .describe(
          "JSON array of emergency contacts: [{name, phone, relationship}]"
        ),
    },
    async ({ clinicId, name, phone, language, emergencyContacts }) => {
      try {
        const clinic = store.requireClinic(clinicId);
        const config = store.configForClinic(clinicId);
        const patientId = randomUUID();
        const lang = language || clinic.language || config.defaultLanguage;

        let contacts: Array<{ name: string; phone: string; relationship: string }> = [];
        if (emergencyContacts) {
          contacts = JSON.parse(emergencyContacts);
        }

        const patient: PatientContact = {
          id: patientId,
          name,
          phone,
          language: lang as PatientContact["language"],
          preferredChannel: config.defaultChannel,
          consentStatus: "pending",
          emergencyContacts: contacts.map((c) => ({
            name: c.name,
            phone: c.phone,
            relationship: c.relationship,
            notifyOnCritical: true,
            notifyOnRoutine: false,
          })),
          clinicId,
        };

        store.patients.set(patientId, patient);

        // Update clinic stats
        clinic.stats.patients++;
        store.recordActivity(clinicId);

        // Queue a welcome message
        const welcomeBody = renderTemplateBody(
          "welcome",
          { clinic: clinic.name },
          lang
        );
        const welcomeMsg: ConnectMessage = {
          id: randomUUID(),
          clinicId: clinicId || "",
          direction: "clinic_to_patient",
          channel: config.defaultChannel,
          priority: "routine",
          from: config.atShortCode || "MESHCUE",
          to: phone,
          patientId,
          template: "welcome",
          templateData: { clinic: clinic.name },
          language: lang,
          body: welcomeBody,
          status: "queued",
          createdAt: nowISO(),
          retryCount: 0,
          maxRetries: config.maxRetries,
        };
        store.messages.push(welcomeMsg);
        clinic.stats.messagesSent++;

        return ok({ patientId, clinicId, consentStatus: "pending" });
      } catch (e) {
        return err(`Registration error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  // ── meshcue-connect-inbox ───────────────────────────────────
  server.tool(
    "meshcue-connect-inbox",
    "Process an incoming patient message. Classifies intent, handles " +
      "opt-in/out, appointment confirmations, and urgent keyword escalation. " +
      "Looks up the patient's clinic from their phone number.",
    {
      from: z.string().describe("Sender phone number in E.164 format"),
      body: z.string().describe("Message text content"),
      channel: z
        .enum(["sms", "whatsapp", "ussd"])
        .describe("Channel the message arrived on"),
    },
    async ({ from, body, channel }) => {
      try {
        const result = classifyIncoming(body);

        // Find patient and their clinic by phone
        const patient = store.findPatientByPhone(from);
        const clinicId = patient?.clinicId;

        // Handle opt-in/out side effects
        if (patient) {
          if (result.actions.includes("opt_out")) {
            patient.consentStatus = "opted_out";
          } else if (result.actions.includes("opt_in")) {
            patient.consentStatus = "opted_in";
            patient.consentDate = nowISO();
          }
        }

        // Log the inbound message
        const inbound: ConnectMessage = {
          id: randomUUID(),
          clinicId: clinicId || "",
          direction: "patient_to_clinic",
          channel: channel as Channel,
          priority: result.priority,
          from,
          to: "CLINIC",
          patientId: patient?.id,
          template: "inbound_raw",
          templateData: { body },
          language: patient?.language || "auto",
          body,
          status: "delivered",
          createdAt: nowISO(),
          retryCount: 0,
          maxRetries: 0,
        };
        store.messages.push(inbound);

        if (clinicId) {
          store.recordActivity(clinicId);
        }

        return ok({
          response: result.response,
          triaged: result.triaged,
          priority: result.priority,
          actions: result.actions,
          clinicId: clinicId || null,
          patientId: patient?.id || null,
        });
      } catch (e) {
        return err(`Inbox error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  // ── meshcue-connect-status ──────────────────────────────────
  server.tool(
    "meshcue-connect-status",
    "Check MeshCue Connect system status: available channels, message queue size, " +
      "and last message timestamp. Optionally scoped to a specific clinic.",
    {
      clinicId: z
        .string()
        .optional()
        .describe("Optional clinic ID to show per-clinic status"),
    },
    async ({ clinicId }) => {
      try {
        if (clinicId) {
          // Per-clinic status
          const clinic = store.requireClinic(clinicId);

          const smsAvailable = !!clinic.channels.sms;
          const whatsappAvailable = !!clinic.channels.whatsapp;
          const voiceAvailable = !!clinic.channels.voice;

          const clinicMessages = store.getMessagesForClinic(clinicId);
          const lastMsg =
            clinicMessages.length > 0
              ? clinicMessages[clinicMessages.length - 1].createdAt
              : "none";

          return ok({
            clinicId,
            clinicName: clinic.name,
            channels: {
              sms: smsAvailable
                ? { available: true, provider: clinic.channels.sms!.provider }
                : { available: false },
              whatsapp: whatsappAvailable
                ? { available: true }
                : { available: false },
              voice: voiceAvailable
                ? { available: true, provider: clinic.channels.voice!.provider }
                : { available: false },
            },
            queueSize: clinicMessages.filter((m) => m.status === "queued").length,
            totalMessages: clinicMessages.length,
            lastSent: lastMsg,
            patients: clinic.stats.patients,
          });
        }

        // Global status
        const config = loadConnectConfig();

        const smsAvailable = !!(config.atApiKey && config.atUsername);
        const whatsappAvailable = !!(config.whatsappToken && config.whatsappPhoneId);
        const voiceAvailable = !!(
          (config.voiceProvider === "africastalking" && config.atApiKey) ||
          (config.voiceProvider === "twilio" && config.twilioSid && config.twilioToken)
        );

        const lastMsg =
          store.messages.length > 0
            ? store.messages[store.messages.length - 1].createdAt
            : "none";

        return ok({
          channels: {
            sms: smsAvailable,
            whatsapp: whatsappAvailable,
            voice: voiceAvailable,
          },
          clinicsRegistered: store.clinics.size,
          totalPatients: store.patients.size,
          queueSize: store.messages.filter((m) => m.status === "queued").length,
          lastSent: lastMsg,
        });
      } catch (e) {
        return err(`Status error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );
}
