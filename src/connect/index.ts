/**
 * MeshCue Connect — Module Exports
 *
 * Patient messaging engine: alerts, templates, consent, multi-channel delivery.
 */

export { loadConnectConfig, SUBSCRIPTION_TIERS, checkSubscriptionLimits } from "./config.js";
export { registerConnectTools } from "./mcp.js";
export { renderTemplate, getTemplateNames, getSupportedLanguages } from "./templates.js";
export { ConsentManager } from "./consent.js";
export { ConnectStore } from "./store.js";
export { MessageRouter, createRouter, triageAlert, routeAlert, handleIncoming } from "./router.js";
export type { IncomingResult } from "./router.js";
export type {
  Channel,
  Priority,
  Direction,
  ConsentStatus,
  Clinic,
  ClinicChannelConfig,
  SubscriptionTier,
  PatientContact,
  EmergencyContact,
  ConnectMessage,
  DeviceAlert,
  TriageResult,
  TriageAction,
  USSDSession,
  ChannelProvider,
  ConnectConfig,
  ConsentEntry,
} from "./types.js";
