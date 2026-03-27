/**
 * Mesh Bridge Types
 *
 * Types for communicating with the MeshCue peer-to-peer network
 * to offload build jobs to capable mesh nodes.
 */

export interface MeshNode {
  /** Unique node identifier */
  id: string;
  /** Human-readable node name */
  name: string;
  /** Node capabilities */
  capabilities: MeshCapability[];
  /** Whether the node is currently accepting jobs */
  available: boolean;
  /** Node latency in milliseconds (from discovery ping) */
  latencyMs: number;
  /** Free resources on this node */
  resources: {
    cpuFree: number;      // percentage 0-100
    memoryFreeMb: number;
    gpuAvailable: boolean;
    pythonAvailable: boolean;
    openscadAvailable: boolean;
  };
}

export type MeshCapability = "gpu" | "compute" | "storage" | "python" | "openscad";

export interface BuildJob {
  /** Unique job identifier assigned by the mesh */
  jobId: string;
  /** Node that accepted the job */
  nodeId: string;
  /** Current status */
  status: JobStatus;
  /** Timestamp when job was submitted */
  submittedAt: number;
  /** Timestamp when job completed (if done) */
  completedAt?: number;
}

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timeout";

export interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  progress: number; // 0-100
  stage?: string;   // current build stage name
  error?: string;
}

export interface BuildArtifacts {
  jobId: string;
  artifacts: Array<{
    filename: string;
    content: string;
    format: string;
    stage: string;
  }>;
  buildTimeMs: number;
}

export interface ProgressEvent {
  jobId: string;
  stage: string;
  status: "starting" | "done" | "error";
  progress: number;
  message?: string;
}

export type ProgressCallback = (event: ProgressEvent) => void;

// ─── WebSocket Message Protocol ─────────────────────────────

export type MeshMessageType =
  | "ping"
  | "pong"
  | "discover"
  | "discover_response"
  | "submit_build"
  | "build_accepted"
  | "build_progress"
  | "build_complete"
  | "build_failed"
  | "fetch_artifacts"
  | "artifacts_response"
  | "job_status"
  | "job_status_response"
  | "error";

export interface MeshMessage {
  type: MeshMessageType;
  id: string;          // message correlation ID
  payload: unknown;
}
