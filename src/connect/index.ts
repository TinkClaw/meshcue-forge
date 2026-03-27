/**
 * MeshCue Connect — Module Exports
 *
 * Patient messaging engine: alerts, templates, consent, multi-channel delivery.
 */

export { loadConnectConfig } from "./config.js";
export { registerConnectTools } from "./mcp.js";
export { renderTemplate, getTemplateNames, getSupportedLanguages } from "./templates.js";
export { ConsentManager } from "./consent.js";
export { MessageRouter, createRouter, triageAlert, routeAlert, handleIncoming } from "./router.js";
export type { IncomingResult } from "./router.js";
export type {
  Channel,
  Priority,
  Direction,
  ConsentStatus,
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
