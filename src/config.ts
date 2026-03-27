/**
 * Forge Configuration
 *
 * Reads configuration from environment variables and provides
 * capability detection for available backends.
 */

import type { ForgeConfig, EnclosureBackend, PCBBackend, VisualizationBackend } from "./schema/mhdl.js";
import { checkPythonPackage } from "./python/bridge.js";

// ─── Endpoint Health Check ──────────────────────────────────

export interface EndpointStatus {
  endpoint: string;
  status: "ok" | "unreachable" | "error";
  message?: string;
}

/**
 * Validate reachability of all configured API endpoints.
 * Performs a HEAD request with a 5-second timeout against each.
 * Does not run automatically — exported for use by the MCP capabilities tool.
 */
export async function validateEndpoints(config: ForgeConfig): Promise<EndpointStatus[]> {
  const endpoints: { name: string; url: string | undefined }[] = [
    { name: "zoo-cad", url: config.zooCadEndpoint },
    { name: "llama-mesh", url: config.llamaMeshEndpoint },
    { name: "hunyuan3d", url: config.hunyuan3dEndpoint },
    { name: "cosmos", url: config.cosmosEndpoint },
  ];

  const results: EndpointStatus[] = [];

  for (const ep of endpoints) {
    if (!ep.url) {
      results.push({ endpoint: ep.name, status: "unreachable", message: "Not configured" });
      continue;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

    try {
      const res = await fetch(ep.url, {
        method: "HEAD",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok || res.status === 405 || res.status === 404) {
        // 405/404 means server is reachable but doesn't support HEAD on that path
        results.push({ endpoint: ep.name, status: "ok" });
      } else {
        results.push({
          endpoint: ep.name,
          status: "error",
          message: `HTTP ${res.status}`,
        });
      }
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === "AbortError") {
        results.push({ endpoint: ep.name, status: "unreachable", message: "Timed out (5s)" });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ endpoint: ep.name, status: "unreachable", message: msg });
      }
    }
  }

  return results;
}

// ─── Load Config from Environment ───────────────────────────

export function loadConfig(): ForgeConfig {
  return {
    // API endpoints
    zooCadApiKey: process.env.ZOO_CAD_API_KEY,
    zooCadEndpoint: process.env.ZOO_CAD_ENDPOINT || "https://api.zoo.dev",
    llamaMeshEndpoint: process.env.LLAMA_MESH_ENDPOINT,
    hunyuan3dEndpoint: process.env.HUNYUAN3D_ENDPOINT,
    cosmosEndpoint: process.env.COSMOS_ENDPOINT,

    // Local tools
    pythonPath: process.env.PYTHON_PATH || "python3",
    kicadPath: process.env.KICAD_PATH,
    openscadPath: process.env.OPENSCAD_PATH,

    // Preferences
    defaultEnclosureBackend: (process.env.FORGE_ENCLOSURE_BACKEND as EnclosureBackend) || "openscad",
    defaultPCBBackend: (process.env.FORGE_PCB_BACKEND as PCBBackend) || "skidl",
    defaultVisualizationBackend: (process.env.FORGE_VIZ_BACKEND as VisualizationBackend) || "hunyuan3d",
    enableGpuBackends: process.env.FORGE_ENABLE_GPU === "true",
  };
}

// ─── Backend Registry ───────────────────────────────────────

export interface BackendCapability {
  name: string;
  available: boolean;
  online: boolean;
  reason?: string;
}

export interface BackendRegistry {
  enclosure: Record<EnclosureBackend, BackendCapability>;
  pcb: Record<PCBBackend, BackendCapability>;
  visualization: Record<VisualizationBackend, BackendCapability>;
}

export async function detectCapabilities(config: ForgeConfig): Promise<BackendRegistry> {
  // Check Python packages in parallel — these indicate whether generated
  // scripts can be *executed* locally, but script generation always works.
  const [cadqueryInstalled, skidlInstalled] = await Promise.all([
    checkPythonPackage("cadquery", config.pythonPath),
    checkPythonPackage("skidl", config.pythonPath),
  ]);

  return {
    enclosure: {
      openscad: { name: "OpenSCAD", available: true, online: true },
      cadquery: {
        name: "CadQuery",
        available: true, // Script generation always works
        online: cadqueryInstalled, // Execution requires package
        reason: !cadqueryInstalled
          ? "cadquery package not installed — script generation works, execution requires: pip install cadquery"
          : undefined,
      },
      "zoo-cad": {
        name: "Zoo Text-to-CAD",
        available: !!config.zooCadApiKey,
        online: !!config.zooCadApiKey,
        reason: config.zooCadApiKey ? undefined : "ZOO_CAD_API_KEY not set",
      },
      "llama-mesh": {
        name: "LLaMA-Mesh",
        available: !!config.llamaMeshEndpoint,
        online: !!config.llamaMeshEndpoint,
        reason: config.llamaMeshEndpoint ? undefined : "LLAMA_MESH_ENDPOINT not set",
      },
    },
    pcb: {
      skidl: {
        name: "SKiDL",
        available: true, // Script generation always works
        online: skidlInstalled, // Execution requires package
        reason: !skidlInstalled
          ? "skidl package not installed — script generation works, execution requires: pip install skidl"
          : undefined,
      },
      kicad: {
        name: "KiCad 9",
        available: !!config.kicadPath,
        online: !!config.kicadPath,
        reason: config.kicadPath ? undefined : "KICAD_PATH not set",
      },
    },
    visualization: {
      hunyuan3d: {
        name: "Hunyuan3D 2.1",
        available: true,
        online: !!config.hunyuan3dEndpoint,
        reason: config.hunyuan3dEndpoint ? undefined : "offline mode — generates placeholder",
      },
      "llama-mesh": {
        name: "LLaMA-Mesh 3D",
        available: true,
        online: !!config.llamaMeshEndpoint,
        reason: config.llamaMeshEndpoint ? undefined : "offline mode — generates placeholder",
      },
      cosmos: {
        name: "Cosmos Transfer 2.5",
        available: true,
        online: !!config.cosmosEndpoint,
        reason: config.cosmosEndpoint ? undefined : "offline mode — generates placeholder",
      },
    },
  };
}
