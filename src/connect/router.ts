/**
 * MeshCue Connect — Message Router & Triage Engine
 *
 * Routes device alerts to the appropriate recipients via SMS, WhatsApp,
 * voice, or mesh relay. Handles incoming patient messages with keyword
 * detection and automatic triage.
 *
 * Exports both:
 * - `MessageRouter` class (full-featured, stateful, with providers)
 * - Standalone functions (`triageAlert`, `routeAlert`, `handleIncoming`)
 *   for simpler usage and testing
 */

import type {
  ConnectConfig,
  ConnectMessage,
  DeviceAlert,
  PatientContact,
  TriageResult,
  TriageAction,
  Channel,
  Priority,
  ChannelProvider,
  Direction,
  Clinic,
  ClinicChannelConfig,
} from "./types.js";
import { renderTemplate } from "./templates.js";
import { ConsentManager } from "./consent.js";
import type { ConnectStore } from "./store.js";
import { DeliveryManager } from "./delivery.js";
import type { DeliveryResult } from "./delivery.js";

// ─── Keyword Patterns ────────────────────────────────────────

interface KeywordRule {
  keywords: string[];
  category: "symptom" | "emergency" | "appointment" | "result" | "optout";
  priority: Priority;
  template: string;
  routeTo: string;
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    keywords: ["FEVER", "HOT", "HOMA", "FIÈVRE", "FEBRE", "FIEBRE", "حمى", "জ্বর", "बुखार", "发烧"],
    category: "symptom",
    priority: "urgent",
    template: "symptom_received",
    routeTo: "nurse",
  },
  {
    keywords: ["HELP", "EMERGENCY", "DHARURA", "AIDE", "URGENCE", "AJUDA", "AYUDA", "طوارئ", "সাহায্য", "मदद", "救命"],
    category: "emergency",
    priority: "critical",
    template: "symptom_received",
    routeTo: "nurse",
  },
  {
    keywords: ["APPT", "APPOINTMENT", "MIADI", "RENDEZ-VOUS", "CONSULTA", "CITA", "موعد", "অ্যাপয়েন্টমেন্ট", "अपॉइंटमेंट", "预约"],
    category: "appointment",
    priority: "routine",
    template: "appointment_ack",
    routeTo: "nurse",
  },
  {
    keywords: ["RESULT", "MATOKEO", "RÉSULTAT", "RESULTADO", "نتيجة", "ফলাফল", "परिणाम", "结果"],
    category: "result",
    priority: "routine",
    template: "result_ready",
    routeTo: "self",
  },
  {
    keywords: ["STOP", "ACHA", "ARRÊTER", "PARAR", "DETENER", "إيقاف", "বন্ধ", "रोकें", "停止"],
    category: "optout",
    priority: "info",
    template: "opt_out_confirm",
    routeTo: "self",
  },
];

// ─── Standalone Functions ────────────────────────────────────

/**
 * Standalone triage: determines priority and actions from a device alert.
 */
export async function triageAlert(alert: DeviceAlert): Promise<TriageResult> {
  return triageAlertSync(alert);
}

/**
 * Standalone route: builds ConnectMessage[] from a triaged alert.
 * Handles consent gating and recipient selection.
 */
export async function routeAlert(
  alert: DeviceAlert,
  triage: TriageResult,
  patient: PatientContact,
  nursePhone: string
): Promise<ConnectMessage[]> {
  const messages: ConnectMessage[] = [];
  const consent = new ConsentManager();

  for (const action of triage.actions) {
    const msgs = buildMessagesForAction(
      alert,
      triage.priority,
      patient,
      action,
      nursePhone,
      consent
    );
    messages.push(...msgs);
  }

  return messages;
}

/**
 * Standalone incoming message handler with keyword detection.
 */
export interface IncomingResult {
  detected: boolean;
  category?: string;
  priority: Priority;
  escalate: boolean;
  optOut: boolean;
  template?: string;
}

export async function handleIncoming(
  patient: PatientContact,
  body: string
): Promise<IncomingResult> {
  const normalized = body.trim().toUpperCase();
  const matched = matchKeyword(normalized);

  if (!matched) {
    return {
      detected: false,
      priority: "routine",
      escalate: false,
      optOut: false,
      template: "follow_up",
    };
  }

  return {
    detected: true,
    category: matched.category,
    priority: matched.priority,
    escalate: matched.category === "emergency",
    optOut: matched.category === "optout",
    template: matched.template,
  };
}

// ─── Router Factory ──────────────────────────────────────────

export function createRouter(config: ConnectConfig, store?: ConnectStore): MessageRouter {
  return new MessageRouter(config, store);
}

// ─── Message Router Class ────────────────────────────────────

export class MessageRouter {
  private config: ConnectConfig;
  private store: ConnectStore | undefined;
  private providers: Map<Channel, ChannelProvider> = new Map();
  private clinicProviders: Map<string, Map<Channel, ChannelProvider>> = new Map();
  private offlineQueue: ConnectMessage[] = [];
  private consent: ConsentManager;
  private deliveryManager: DeliveryManager;

  constructor(config: ConnectConfig, store?: ConnectStore) {
    this.config = config;
    this.store = store;
    this.consent = new ConsentManager();
    this.consent.setSendFunction((msg) => this.send(msg));
    this.deliveryManager = new DeliveryManager();
  }

  /**
   * Register a global channel provider (fallback when clinic has no provider).
   * Also registers the provider with the delivery manager for fallback chain.
   */
  registerProvider(provider: ChannelProvider): void {
    this.providers.set(provider.channel, provider);
    this.deliveryManager.registerProvider(provider);
  }

  /**
   * Register a channel provider scoped to a specific clinic.
   */
  registerClinicProvider(clinicId: string, provider: ChannelProvider): void {
    let map = this.clinicProviders.get(clinicId);
    if (!map) {
      map = new Map();
      this.clinicProviders.set(clinicId, map);
    }
    map.set(provider.channel, provider);
  }

  /**
   * Get the consent manager instance.
   */
  getConsentManager(): ConsentManager {
    return this.consent;
  }

  /**
   * Get the underlying store, if any.
   */
  getStore(): ConnectStore | undefined {
    return this.store;
  }

  /**
   * Get the delivery manager for direct access to delivery tracking
   * and retry controls.
   */
  getDeliveryManager(): DeliveryManager {
    return this.deliveryManager;
  }

  // ─── Clinic Config Resolution ─────────────────────────────

  /**
   * Converts a clinic's ClinicChannelConfig into the legacy ConnectConfig
   * format that channel providers expect.
   */
  getClinicConfig(clinicId: string): ConnectConfig {
    const clinic = this.store?.getClinic(clinicId);
    if (!clinic) {
      // Fall back to global config if clinic not found
      return this.config;
    }

    const ch = clinic.channels;
    return {
      // SMS / Africa's Talking / Twilio
      atApiKey: ch.sms?.provider === "africastalking" ? ch.sms.apiKey : undefined,
      atUsername: ch.sms?.username,
      atShortCode: ch.sms?.shortCode,

      // WhatsApp Business
      whatsappToken: ch.whatsapp?.token,
      whatsappPhoneId: ch.whatsapp?.phoneId,

      // Voice/IVR
      voiceProvider: ch.voice?.provider,
      twilioSid: ch.voice?.sid ?? ch.sms?.apiSecret,
      twilioToken: ch.voice?.token,
      twilioPhone: ch.voice?.phone,

      // Defaults
      defaultChannel: this.config.defaultChannel,
      defaultLanguage: clinic.language,
      maxRetries: this.config.maxRetries,
      retryDelayMs: this.config.retryDelayMs,
      criticalEscalationPhone: clinic.emergencyPhone ?? clinic.adminPhone,
    };
  }

  // ─── Core Routing ────────────────────────────────────────

  /**
   * Takes a device alert, triages it, and creates/sends messages
   * for all relevant recipients based on triage rules.
   * Uses the delivery manager for channel fallback and tracking.
   * Returns DeliveryResult[] with full attempt history.
   */
  async route(
    alert: DeviceAlert,
    patient: PatientContact
  ): Promise<DeliveryResult[]> {
    const triageResult = this.triage(alert);
    const deliveryResults: DeliveryResult[] = [];

    // Resolve config from clinic-owned credentials
    const clinicConfig = this.getClinicConfig(patient.clinicId);
    const nursePhone = clinicConfig.criticalEscalationPhone ?? patient.clinicId;

    for (const action of triageResult.actions) {
      const msgs = buildMessagesForAction(
        alert,
        triageResult.priority,
        patient,
        action,
        nursePhone,
        this.consent
      );

      for (const msg of msgs) {
        // Check consent (critical bypasses consent)
        if (
          triageResult.priority !== "critical" &&
          triageResult.priority !== "urgent"
        ) {
          if (!this.consent.canSendMessage(patient, triageResult.priority)) {
            continue;
          }
        }

        if (action.delay && action.delay > 0) {
          setTimeout(() => {
            this.deliveryManager.send(msg, clinicConfig).catch(() => this.queueMessage(msg));
          }, action.delay * 1000);
          msg.status = "queued";
          // Create a placeholder delivery result for delayed messages
          deliveryResults.push({
            messageId: msg.id,
            to: msg.to,
            status: "queued",
            channel: msg.channel,
            attempts: [],
          });
        } else {
          const result = await this.deliveryManager.send(msg, clinicConfig);
          // Persist to store on success
          if (result.status === "delivered") {
            msg.status = "delivered";
            msg.sentAt = new Date().toISOString();
            this.store?.storeMessage(msg);
          }
          deliveryResults.push(result);
        }
      }
    }

    return deliveryResults;
  }

  /**
   * Determines priority and actions based on reading type and severity.
   */
  triage(alert: DeviceAlert): TriageResult {
    return triageAlertSync(alert);
  }

  // ─── Send / Queue ────────────────────────────────────────

  /**
   * Sends a message via the appropriate channel provider.
   * Resolves provider from clinic-scoped providers first, then global fallback.
   */
  async send(message: ConnectMessage): Promise<ConnectMessage> {
    // Try clinic-scoped provider first, then global
    const clinicProviderMap = message.clinicId
      ? this.clinicProviders.get(message.clinicId)
      : undefined;

    const provider =
      clinicProviderMap?.get(message.channel) ??
      this.providers.get(message.channel) ??
      clinicProviderMap?.get(this.config.defaultChannel) ??
      this.providers.get(this.config.defaultChannel);

    if (!provider) {
      message.status = "failed";
      message.failReason = `No provider for channel: ${message.channel}`;
      this.queueMessage(message);
      return message;
    }

    try {
      if (!message.body) {
        message.body = renderTemplate(
          message.template,
          message.templateData,
          message.language
        );
      }

      const result = await provider.send(message.to, message.body);
      message.status = result.status === "sent" ? "sent" : "delivered";
      message.sentAt = new Date().toISOString();

      // Persist to store
      this.store?.storeMessage(message);

      return message;
    } catch (err: unknown) {
      message.retryCount++;
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (message.retryCount < message.maxRetries) {
        message.status = "queued";
        message.failReason = `Retry ${message.retryCount}/${message.maxRetries}: ${errorMsg}`;
        this.queueMessage(message);
      } else {
        message.status = "failed";
        message.failReason = `Max retries exceeded: ${errorMsg}`;
        this.store?.storeMessage(message);
      }

      return message;
    }
  }

  /**
   * Adds a message to the offline queue (and to the store queue if available).
   */
  queueMessage(message: ConnectMessage): void {
    message.status = "queued";
    this.offlineQueue.push(message);
    this.store?.enqueue(message);
  }

  /**
   * Flushes all queued messages, optionally filtered by clinic.
   * Called when connectivity is restored.
   */
  async flushQueue(clinicId?: string): Promise<ConnectMessage[]> {
    let queued: ConnectMessage[];
    if (clinicId) {
      queued = this.offlineQueue.filter((m) => m.clinicId === clinicId);
      this.offlineQueue = this.offlineQueue.filter((m) => m.clinicId !== clinicId);
    } else {
      queued = [...this.offlineQueue];
      this.offlineQueue = [];
    }

    const results: ConnectMessage[] = [];
    for (const message of queued) {
      try {
        const sent = await this.send(message);
        results.push(sent);
      } catch {
        this.queueMessage(message);
        results.push(message);
      }
    }

    return results;
  }

  /**
   * Returns the current offline queue length, optionally filtered by clinic.
   */
  getQueueLength(clinicId?: string): number {
    if (clinicId) {
      return this.offlineQueue.filter((m) => m.clinicId === clinicId).length;
    }
    return this.offlineQueue.length;
  }

  // ─── Incoming Message Handling ───────────────────────────

  /**
   * Processes an incoming patient message. Detects keywords and
   * routes to the appropriate handler. Resolves clinic from patient lookup.
   */
  async handleIncoming(
    channel: Channel,
    from: string,
    body: string,
    clinicId?: string
  ): Promise<ConnectMessage> {
    // Resolve clinic config for this incoming message
    const resolvedClinicId = clinicId ?? this.resolveClinicFromPhone(from);
    const effectiveConfig = resolvedClinicId
      ? this.getClinicConfig(resolvedClinicId)
      : this.config;

    const normalized = body.trim().toUpperCase();
    const matchedRule = matchKeyword(normalized);

    if (!matchedRule) {
      return this.buildIncomingResponse(channel, from, "routine", "follow_up", {}, effectiveConfig, resolvedClinicId);
    }

    if (matchedRule.category === "optout") {
      this.consent.revokeConsent(from);
      return this.buildIncomingResponse(channel, from, "info", "opt_out_confirm", {}, effectiveConfig, resolvedClinicId);
    }

    if (matchedRule.category === "emergency") {
      const escalationMsg = this.buildIncomingResponse(
        channel,
        from,
        "critical",
        matchedRule.template,
        {},
        effectiveConfig,
        resolvedClinicId
      );

      if (effectiveConfig.criticalEscalationPhone) {
        const nurseAlert: ConnectMessage = {
          id: generateId(),
          clinicId: resolvedClinicId ?? "",
          direction: "patient_to_clinic",
          channel: "sms",
          priority: "critical",
          from,
          to: effectiveConfig.criticalEscalationPhone,
          template: "spo2_critical",
          templateData: { name: from, value: "HELP", clinic: "nearest clinic" },
          language: effectiveConfig.defaultLanguage,
          body: `EMERGENCY from ${from}: "${body}"`,
          status: "queued",
          createdAt: new Date().toISOString(),
          retryCount: 0,
          maxRetries: effectiveConfig.maxRetries,
        };
        this.send(nurseAlert).catch(() => this.queueMessage(nurseAlert));
      }

      return escalationMsg;
    }

    return this.buildIncomingResponse(
      channel,
      from,
      matchedRule.priority,
      matchedRule.template,
      {},
      effectiveConfig,
      resolvedClinicId
    );
  }

  // ─── Private Helpers ─────────────────────────────────────

  /**
   * Attempts to resolve a clinic ID from a patient's phone number via the store.
   */
  private resolveClinicFromPhone(phone: string): string | undefined {
    const patient = this.store?.getPatientByPhone(phone);
    return patient?.clinicId;
  }

  private buildIncomingResponse(
    channel: Channel,
    from: string,
    priority: Priority,
    template: string,
    extraData: Record<string, string | number>,
    effectiveConfig: ConnectConfig,
    clinicId?: string
  ): ConnectMessage {
    const templateData: Record<string, string | number> = {
      name: from,
      ...extraData,
    };

    let body: string;
    try {
      body = renderTemplate(template, templateData, effectiveConfig.defaultLanguage);
    } catch {
      body = `Message received from ${from}. A health worker will respond.`;
    }

    const msg: ConnectMessage = {
      id: generateId(),
      clinicId: clinicId ?? "",
      direction: "clinic_to_patient",
      channel,
      priority,
      from: effectiveConfig.atShortCode ?? "MESHCUE",
      to: from,
      template,
      templateData,
      language: effectiveConfig.defaultLanguage,
      body,
      status: "queued",
      createdAt: new Date().toISOString(),
      retryCount: 0,
      maxRetries: effectiveConfig.maxRetries,
    };

    this.store?.storeMessage(msg);
    return msg;
  }
}

// ─── Shared Internal Functions ─────────────────────────────────

/**
 * Core triage logic, shared by both the class and standalone function.
 */
function triageAlertSync(alert: DeviceAlert): TriageResult {
  const reading = alert.reading.toLowerCase();

  // ── SpO2 Rules ───────────────────────────────────────
  if (reading === "spo2") {
    if (alert.value < 90) {
      return {
        priority: "critical",
        escalate: true,
        escalateTo: undefined,
        actions: [
          { channel: "sms", recipient: "patient", template: "spo2_critical" },
          { channel: "sms", recipient: "family", template: "family_emergency" },
          { channel: "sms", recipient: "nurse", template: "spo2_critical" },
          { channel: "voice", recipient: "nurse", template: "spo2_critical" },
        ],
      };
    }
    if (alert.value < 95) {
      return {
        priority: "urgent",
        escalate: false,
        actions: [
          { channel: "sms", recipient: "patient", template: "spo2_warning" },
          { channel: "sms", recipient: "nurse", template: "spo2_warning", delay: 900 },
        ],
      };
    }
    return { priority: "info", escalate: false, actions: [] };
  }

  // ── Temperature Rules ────────────────────────────────
  if (reading === "temperature" || reading === "temp") {
    if (alert.value > 40) {
      return {
        priority: "critical",
        escalate: true,
        escalateTo: undefined,
        actions: [
          { channel: "sms", recipient: "patient", template: "temp_critical" },
          { channel: "sms", recipient: "family", template: "family_emergency" },
          { channel: "sms", recipient: "nurse", template: "temp_critical" },
          { channel: "voice", recipient: "nurse", template: "temp_critical" },
        ],
      };
    }
    if (alert.value > 39) {
      return {
        priority: "urgent",
        escalate: false,
        actions: [
          { channel: "sms", recipient: "patient", template: "temp_warning" },
          { channel: "sms", recipient: "nurse", template: "temp_warning" },
        ],
      };
    }
    // 38-39 range: moderate fever, still warrants attention
    if (alert.value > 38) {
      return {
        priority: "routine",
        escalate: false,
        actions: [
          { channel: "sms", recipient: "patient", template: "temp_warning" },
          { channel: "sms", recipient: "nurse", template: "temp_warning" },
        ],
      };
    }
    return { priority: "info", escalate: false, actions: [] };
  }

  // ── Heart Rate Rules ─────────────────────────────────
  if (reading === "heartrate" || reading === "heart_rate" || reading === "hr" || reading === "pulse") {
    if (alert.value > 120 || alert.value < 50) {
      return {
        priority: "critical",
        escalate: true,
        escalateTo: undefined,
        actions: [
          { channel: "sms", recipient: "patient", template: "hr_critical" },
          { channel: "sms", recipient: "family", template: "family_emergency" },
          { channel: "sms", recipient: "nurse", template: "hr_critical" },
          { channel: "voice", recipient: "nurse", template: "hr_critical" },
        ],
      };
    }
    return { priority: "info", escalate: false, actions: [] };
  }

  // ── Blood Pressure Rules ─────────────────────────────
  if (reading === "bp" || reading === "blood_pressure" || reading === "systolic" || reading === "bloodpressure") {
    if (alert.value > 180 || alert.value < 90) {
      return {
        priority: "critical",
        escalate: true,
        escalateTo: undefined,
        actions: [
          { channel: "sms", recipient: "patient", template: "bp_critical" },
          { channel: "sms", recipient: "family", template: "family_emergency" },
          { channel: "sms", recipient: "nurse", template: "bp_critical" },
          { channel: "voice", recipient: "nurse", template: "bp_critical" },
        ],
      };
    }
    return { priority: "info", escalate: false, actions: [] };
  }

  // ── Generic Device Severity Fallback ─────────────────
  if (alert.severity === "critical") {
    return {
      priority: "critical",
      escalate: true,
      escalateTo: undefined,
      actions: [
        { channel: "sms", recipient: "patient", template: "spo2_critical" },
        { channel: "sms", recipient: "family", template: "family_emergency" },
        { channel: "voice", recipient: "nurse", template: "spo2_critical" },
      ],
    };
  }

  if (alert.severity === "warning") {
    return {
      priority: "urgent",
      escalate: false,
      actions: [
        { channel: "sms", recipient: "patient", template: "spo2_warning" },
        { channel: "sms", recipient: "nurse", template: "spo2_warning" },
      ],
    };
  }

  return { priority: "info", escalate: false, actions: [] };
}

/**
 * Matches incoming message text against keyword rules.
 */
function matchKeyword(text: string): KeywordRule | undefined {
  for (const rule of KEYWORD_RULES) {
    for (const keyword of rule.keywords) {
      if (text.includes(keyword)) {
        return rule;
      }
    }
  }
  return undefined;
}

/**
 * Builds ConnectMessage(s) for a single triage action.
 * Handles recipient resolution (patient, family, nurse, etc.).
 */
function buildMessagesForAction(
  alert: DeviceAlert,
  priority: Priority,
  patient: PatientContact,
  action: TriageAction,
  nursePhone: string,
  consent: ConsentManager
): ConnectMessage[] {
  const messages: ConnectMessage[] = [];

  const templateData: Record<string, string | number> = {
    name: patient.name,
    value: alert.value,
    clinic: alert.clinicId,
    phone: nursePhone,
    status: priority,
  };

  switch (action.recipient) {
    case "patient": {
      // For non-critical: check consent
      if (priority !== "critical" && priority !== "urgent") {
        if (!consent.canSendMessage(patient, priority)) break;
      }
      messages.push(createMsg(
        alert.clinicId,
        "clinic_to_patient",
        action.channel,
        priority,
        alert.clinicId,
        patient.phone,
        patient.id,
        action.template,
        templateData,
        patient.language
      ));
      break;
    }

    case "family": {
      for (let i = 0; i < patient.emergencyContacts.length; i++) {
        const contact = patient.emergencyContacts[i];
        if (priority === "critical") {
          if (!consent.canNotifyFamilyCritical(patient, i)) continue;
        } else {
          // For non-critical family msgs: need patient consent + contact flag
          if (!consent.canSendMessage(patient, priority)) continue;
          if (!contact.notifyOnRoutine) continue;
        }
        messages.push(createMsg(
          alert.clinicId,
          "patient_to_family",
          action.channel,
          priority,
          alert.clinicId,
          contact.phone,
          patient.id,
          action.template,
          { ...templateData, name: patient.name },
          contact.language ?? patient.language
        ));
      }
      break;
    }

    case "nurse":
    case "supervisor": {
      messages.push(createMsg(
        alert.clinicId,
        "system_alert",
        action.channel,
        priority,
        alert.clinicId,
        nursePhone,
        patient.id,
        action.template,
        templateData,
        "en"
      ));
      break;
    }

    case "chw": {
      const chwPhone = patient.chwId ?? nursePhone;
      messages.push(createMsg(
        alert.clinicId,
        "chw_to_supervisor",
        action.channel,
        priority,
        alert.clinicId,
        chwPhone,
        patient.id,
        action.template,
        templateData,
        "en"
      ));
      break;
    }

    default: {
      messages.push(createMsg(
        alert.clinicId,
        "clinic_to_patient",
        action.channel,
        priority,
        alert.clinicId,
        patient.phone,
        patient.id,
        action.template,
        templateData,
        patient.language
      ));
    }
  }

  return messages;
}

/**
 * Creates a ConnectMessage with standard defaults.
 */
function createMsg(
  clinicId: string,
  direction: Direction,
  channel: Channel,
  priority: Priority,
  from: string,
  to: string,
  patientId: string,
  template: string,
  templateData: Record<string, string | number>,
  language: string
): ConnectMessage {
  let body: string;
  try {
    body = renderTemplate(template, templateData, language);
  } catch {
    body = `Alert for patient ${patientId}`;
  }

  return {
    id: generateId(),
    clinicId,
    direction,
    channel,
    priority,
    from,
    to,
    patientId,
    template,
    templateData,
    language,
    body,
    status: "queued",
    createdAt: new Date().toISOString(),
    retryCount: 0,
    maxRetries: 3,
  };
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
