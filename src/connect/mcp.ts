/**
 * MeshCue Connect — MCP Tool Definitions
 *
 * Registers Connect tools on an McpServer so AI agents can
 * send messages, manage patients, and handle alerts.
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
} from "./types.js";
import { loadConnectConfig } from "./config.js";

// ─── In-memory stores (replace with DB in production) ─────────
const patients = new Map<string, PatientContact>();
const messageQueue: ConnectMessage[] = [];

// ─── Helpers ──────────────────────────────────────────────────

function nowISO(): string {
  return new Date().toISOString();
}

function triageAlert(
  severity: "critical" | "warning" | "info",
  reading: string,
  value: number,
  threshold: number
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
  const config = loadConnectConfig();
  const patient = patients.get(alert.patientId);
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
    messageQueue.push(msg);
  }

  return messages;
}

function renderTemplateBody(
  template: string,
  data: Record<string, unknown>,
  language: string
): string {
  // Simple placeholder renderer — production would use i18n + template engine
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

  // Keywords suggesting distress
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

  // Default: forward to clinic inbox
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
  // ── meshcue-connect-alert ───────────────────────────────────
  server.tool(
    "meshcue-connect-alert",
    "Process a device alert and generate appropriate messages to patient, " +
      "family, and clinical staff based on severity. Critical alerts trigger " +
      "voice callbacks and CHW dispatch.",
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
        const alert = { deviceId, patientId, clinicId, reading, value, unit, threshold, severity };
        const triage = triageAlert(severity, reading, value, threshold);
        const messages = buildAlertMessages(alert, triage);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ messages, triage }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Alert processing error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── meshcue-connect-send ────────────────────────────────────
  server.tool(
    "meshcue-connect-send",
    "Send a message to a patient or contact using a named template. " +
      "Supports SMS, WhatsApp, and voice channels with automatic language selection.",
    {
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
    async ({ to, template, data, channel, language }) => {
      try {
        const config = loadConnectConfig();
        const parsedData: Record<string, unknown> = JSON.parse(data);
        const lang = language || config.defaultLanguage;
        const ch = channel || config.defaultChannel;
        const body = renderTemplateBody(template, parsedData, lang);

        const msg: ConnectMessage = {
          id: randomUUID(),
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
        messageQueue.push(msg);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { messageId: msg.id, status: msg.status, body: msg.body },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Send error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── meshcue-connect-register ────────────────────────────────
  server.tool(
    "meshcue-connect-register",
    "Register a patient for MeshCue Connect messaging. Sets up consent, " +
      "preferred language, and emergency contacts.",
    {
      name: z.string().describe("Patient full name"),
      phone: z.string().describe("Patient phone number in E.164 format"),
      language: z
        .string()
        .optional()
        .describe("Preferred language code. Default: configured default"),
      clinicId: z.string().describe("Clinic ID to register the patient under"),
      emergencyContacts: z
        .string()
        .optional()
        .describe(
          "JSON array of emergency contacts: [{name, phone, relationship}]"
        ),
    },
    async ({ name, phone, language, clinicId, emergencyContacts }) => {
      try {
        const config = loadConnectConfig();
        const patientId = randomUUID();
        const lang = language || config.defaultLanguage;

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

        patients.set(patientId, patient);

        // Queue a welcome message
        const welcomeBody = renderTemplateBody(
          "welcome",
          { clinic: clinicId },
          lang
        );
        const welcomeMsg: ConnectMessage = {
          id: randomUUID(),
          direction: "clinic_to_patient",
          channel: config.defaultChannel,
          priority: "routine",
          from: config.atShortCode || "MESHCUE",
          to: phone,
          patientId,
          template: "welcome",
          templateData: { clinic: clinicId },
          language: lang,
          body: welcomeBody,
          status: "queued",
          createdAt: nowISO(),
          retryCount: 0,
          maxRetries: config.maxRetries,
        };
        messageQueue.push(welcomeMsg);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { patientId, consentStatus: "pending" },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Registration error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── meshcue-connect-inbox ───────────────────────────────────
  server.tool(
    "meshcue-connect-inbox",
    "Process an incoming patient message. Classifies intent, handles " +
      "opt-in/out, appointment confirmations, and urgent keyword escalation.",
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

        // Handle opt-in/out side effects
        for (const [, patient] of patients) {
          if (patient.phone === from) {
            if (result.actions.includes("opt_out")) {
              patient.consentStatus = "opted_out";
            } else if (result.actions.includes("opt_in")) {
              patient.consentStatus = "opted_in";
              patient.consentDate = nowISO();
            }
          }
        }

        // Log the inbound message
        const inbound: ConnectMessage = {
          id: randomUUID(),
          direction: "patient_to_clinic",
          channel: channel as Channel,
          priority: result.priority,
          from,
          to: "CLINIC",
          template: "inbound_raw",
          templateData: { body },
          language: "auto",
          body,
          status: "delivered",
          createdAt: nowISO(),
          retryCount: 0,
          maxRetries: 0,
        };
        messageQueue.push(inbound);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  response: result.response,
                  triaged: result.triaged,
                  priority: result.priority,
                  actions: result.actions,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Inbox error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── meshcue-connect-status ──────────────────────────────────
  server.tool(
    "meshcue-connect-status",
    "Check MeshCue Connect system status: available channels, message queue size, " +
      "and last message timestamp.",
    {},
    async () => {
      try {
        const config = loadConnectConfig();

        const smsAvailable = !!(config.atApiKey && config.atUsername);
        const whatsappAvailable = !!(config.whatsappToken && config.whatsappPhoneId);
        const voiceAvailable = !!(
          (config.voiceProvider === "africastalking" && config.atApiKey) ||
          (config.voiceProvider === "twilio" && config.twilioSid && config.twilioToken)
        );

        const lastMsg =
          messageQueue.length > 0
            ? messageQueue[messageQueue.length - 1].createdAt
            : "none";

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  channels: {
                    sms: smsAvailable,
                    whatsapp: whatsappAvailable,
                    voice: voiceAvailable,
                  },
                  queueSize: messageQueue.filter((m) => m.status === "queued").length,
                  lastSent: lastMsg,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Status error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
