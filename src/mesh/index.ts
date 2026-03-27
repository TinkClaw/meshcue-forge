/**
 * Mesh Bridge — Forge to MeshCue Network Integration
 *
 * Re-exports the MeshBridge class and all related types.
 */

export { MeshBridge, shouldUseMesh, type MeshDecision } from "./bridge.js";
export type {
  MeshNode,
  MeshCapability,
  BuildJob,
  JobStatus,
  JobStatusResponse,
  BuildArtifacts,
  ProgressEvent,
  ProgressCallback,
  MeshMessage,
  MeshMessageType,
} from "./types.js";
