/**
 * Forge Configuration
 *
 * Reads configuration from environment variables and provides
 * capability detection for available backends.
 */

import type { ForgeConfig, EnclosureBackend, PCBBackend, VisualizationBackend } from "./schema/mhdl.js";

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

export function detectCapabilities(config: ForgeConfig): BackendRegistry {
  return {
    enclosure: {
      openscad: { name: "OpenSCAD", available: true, online: true },
      cadquery: {
        name: "CadQuery",
        available: true, // Script generation always works; execution requires Python
        online: !!config.pythonPath,
        reason: config.pythonPath ? undefined : "Python not configured",
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
        online: true,
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
