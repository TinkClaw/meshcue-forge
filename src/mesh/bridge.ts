/**
 * MeshBridge — Forge to Mesh Network Integration
 *
 * Connects to the MeshCue peer-to-peer network via WebSocket to discover
 * nodes with specific capabilities and offload build jobs.
 *
 * Graceful degradation: if the mesh network is unavailable, all methods
 * return sensible defaults so local-only builds work unchanged.
 */

import type { MHDLDocument } from "../schema/mhdl.js";
import type {
  MeshNode,
  MeshCapability,
  BuildJob,
  JobStatus,
  JobStatusResponse,
  BuildArtifacts,
  ProgressCallback,
  ProgressEvent,
  MeshMessage,
} from "./types.js";

// ─── Helpers ────────────────────────────────────────────────

let msgCounter = 0;
function nextId(): string {
  return `forge-${Date.now()}-${++msgCounter}`;
}

// ─── MeshBridge ─────────────────────────────────────────────

export class MeshBridge {
  private endpoint: string;
  private ws: WebSocket | null = null;
  private connected = false;
  private pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private progressListeners = new Map<string, ProgressCallback>();
  private connectTimeout: number;

  constructor(meshEndpoint?: string, connectTimeout = 5_000) {
    this.endpoint = meshEndpoint || process.env.MESH_ENDPOINT || "ws://localhost:9871";
    this.connectTimeout = connectTimeout;
  }

  // ─── Connection Management ──────────────────────────────

  /**
   * Check if the mesh network is reachable.
   * Attempts a WebSocket connection with a short timeout.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.ensureConnection();
      // Send a ping and wait for pong
      const response = await this.sendAndWait("ping", {}, 3_000);
      return response !== null;
    } catch {
      return false;
    }
  }

  private async ensureConnection(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.cleanup();
        reject(new Error(`Mesh connection timeout after ${this.connectTimeout}ms`));
      }, this.connectTimeout);

      try {
        this.ws = new WebSocket(this.endpoint);
      } catch (err) {
        clearTimeout(timer);
        reject(new Error(`Failed to create WebSocket: ${err}`));
        return;
      }

      this.ws.onopen = () => {
        clearTimeout(timer);
        this.connected = true;
        resolve();
      };

      this.ws.onerror = (event) => {
        clearTimeout(timer);
        this.connected = false;
        reject(new Error(`WebSocket error: ${String(event)}`));
      };

      this.ws.onclose = () => {
        this.connected = false;
        // Reject all pending requests
        for (const [, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(new Error("WebSocket connection closed"));
        }
        this.pendingRequests.clear();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data as string);
      };
    });
  }

  private handleMessage(raw: string): void {
    let msg: MeshMessage;
    try {
      msg = JSON.parse(raw) as MeshMessage;
    } catch {
      return; // Ignore malformed messages
    }

    // Handle progress events (broadcast, not request-response)
    if (msg.type === "build_progress") {
      const progress = msg.payload as ProgressEvent;
      const listener = this.progressListeners.get(progress.jobId);
      if (listener) {
        listener(progress);
      }
      return;
    }

    // Handle request-response correlation
    const pending = this.pendingRequests.get(msg.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(msg.id);

      if (msg.type === "error") {
        pending.reject(new Error(String((msg.payload as { message?: string })?.message || "Mesh error")));
      } else {
        pending.resolve(msg.payload);
      }
    }
  }

  private sendAndWait(type: string, payload: unknown, timeout = 30_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      const id = nextId();
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Mesh request '${type}' timed out after ${timeout}ms`));
      }, timeout);

      this.pendingRequests.set(id, { resolve, reject, timer });

      const msg: MeshMessage = { type: type as MeshMessage["type"], id, payload };
      this.ws.send(JSON.stringify(msg));
    });
  }

  private cleanup(): void {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.connected = false;
  }

  // ─── Discovery ──────────────────────────────────────────

  /**
   * Discover mesh nodes that have the specified capability.
   * Returns an empty array if mesh is unavailable.
   */
  async discoverNodes(capability: MeshCapability): Promise<MeshNode[]> {
    try {
      await this.ensureConnection();
      const response = await this.sendAndWait("discover", { capability }, 10_000);
      const nodes = (response as { nodes?: MeshNode[] })?.nodes;
      return Array.isArray(nodes) ? nodes : [];
    } catch {
      return [];
    }
  }

  // ─── Build Jobs ─────────────────────────────────────────

  /**
   * Submit a build job to the mesh network.
   * A capable node will be selected automatically, or you can hint
   * preferences with options.
   */
  async submitBuild(
    spec: MHDLDocument,
    options?: { preferGpu?: boolean; timeout?: number },
  ): Promise<BuildJob> {
    await this.ensureConnection();
    const timeout = options?.timeout || 120_000;

    const response = await this.sendAndWait(
      "submit_build",
      {
        spec,
        preferGpu: options?.preferGpu ?? false,
      },
      timeout,
    );

    const job = response as BuildJob;
    if (!job?.jobId) {
      throw new Error("Invalid build job response from mesh");
    }
    return job;
  }

  /**
   * Check the status of a previously submitted build job.
   */
  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    await this.ensureConnection();
    const response = await this.sendAndWait("job_status", { jobId }, 10_000);
    return response as JobStatusResponse;
  }

  /**
   * Retrieve completed build artifacts from a mesh node.
   */
  async fetchArtifacts(jobId: string): Promise<BuildArtifacts> {
    await this.ensureConnection();
    const response = await this.sendAndWait("fetch_artifacts", { jobId }, 60_000);
    return response as BuildArtifacts;
  }

  /**
   * Subscribe to real-time build progress events for a job.
   * Call the returned function to unsubscribe.
   */
  onProgress(jobId: string, callback: ProgressCallback): () => void {
    this.progressListeners.set(jobId, callback);
    return () => {
      this.progressListeners.delete(jobId);
    };
  }

  /**
   * Disconnect from the mesh network.
   */
  disconnect(): void {
    this.cleanup();
    this.progressListeners.clear();
  }
}

// ─── Convenience: Should We Use Mesh? ─────────────────────

export interface MeshDecision {
  useMesh: boolean;
  reason: string;
  node?: MeshNode;
}

/**
 * Decide whether a build should be offloaded to the mesh network.
 *
 * Criteria:
 *  - Spec requires GPU (3D visualization) and local has no GPU
 *  - Local Python is missing but mesh node has it
 *  - User explicitly enabled mesh builds
 */
export async function shouldUseMesh(
  bridge: MeshBridge,
  spec: MHDLDocument,
  options: {
    localHasGpu: boolean;
    localHasPython: boolean;
    meshEnabled: boolean;
  },
): Promise<MeshDecision> {
  if (!options.meshEnabled) {
    return { useMesh: false, reason: "Mesh builds disabled in config" };
  }

  const available = await bridge.isAvailable();
  if (!available) {
    return { useMesh: false, reason: "Mesh network unavailable — building locally" };
  }

  // Check if spec needs GPU for visualization
  const needsGpu =
    (spec.visualization?.generate3DModel || spec.visualization?.generateVideo) &&
    !options.localHasGpu;

  if (needsGpu) {
    const gpuNodes = await bridge.discoverNodes("gpu");
    if (gpuNodes.length > 0) {
      return {
        useMesh: true,
        reason: "Offloading to mesh — GPU required for 3D visualization, local GPU not available",
        node: gpuNodes[0],
      };
    }
  }

  // Check if spec needs Python backends but local Python is missing
  const needsPython =
    (spec.enclosure?.backend === "cadquery" || spec.pcb?.backend === "skidl") &&
    !options.localHasPython;

  if (needsPython) {
    const pythonNodes = await bridge.discoverNodes("python");
    if (pythonNodes.length > 0) {
      return {
        useMesh: true,
        reason: "Offloading to mesh — Python required for CadQuery/SKiDL, not installed locally",
        node: pythonNodes[0],
      };
    }
  }

  return { useMesh: false, reason: "Local build preferred — all requirements met locally" };
}
