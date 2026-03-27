/**
 * Tests for configuration loading and capability detection.
 *
 * Verifies that loadConfig() reads env vars correctly
 * and detectCapabilities() returns the expected structure.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, detectCapabilities } from "../config.js";

// ─── Env var management ──────────────────────────────────────

const ENV_KEYS = [
  "ZOO_CAD_API_KEY",
  "ZOO_CAD_ENDPOINT",
  "LLAMA_MESH_ENDPOINT",
  "HUNYUAN3D_ENDPOINT",
  "COSMOS_ENDPOINT",
  "PYTHON_PATH",
  "KICAD_PATH",
  "OPENSCAD_PATH",
  "FORGE_ENCLOSURE_BACKEND",
  "FORGE_PCB_BACKEND",
  "FORGE_VIZ_BACKEND",
  "FORGE_ENABLE_GPU",
] as const;

/** Saved env values for cleanup. */
let savedEnv: Record<string, string | undefined> = {};

function saveAndClearEnv(): void {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }
}

// ─── loadConfig ──────────────────────────────────────────────

describe("loadConfig", () => {
  beforeEach(() => {
    saveAndClearEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  it("returns defaults when no env vars set", () => {
    const config = loadConfig();

    // API keys / endpoints should be undefined
    assert.equal(config.zooCadApiKey, undefined);
    assert.equal(config.llamaMeshEndpoint, undefined);
    assert.equal(config.hunyuan3dEndpoint, undefined);
    assert.equal(config.cosmosEndpoint, undefined);

    // Defaults
    assert.equal(config.zooCadEndpoint, "https://api.zoo.dev");
    assert.equal(config.pythonPath, "python3");
    assert.equal(config.kicadPath, undefined);
    assert.equal(config.openscadPath, undefined);
    assert.equal(config.defaultEnclosureBackend, "openscad");
    assert.equal(config.defaultPCBBackend, "skidl");
    assert.equal(config.defaultVisualizationBackend, "hunyuan3d");
    assert.equal(config.enableGpuBackends, false);
  });

  it("reads all env vars correctly", () => {
    process.env.ZOO_CAD_API_KEY = "test-api-key-123";
    process.env.ZOO_CAD_ENDPOINT = "https://custom-zoo.example.com";
    process.env.LLAMA_MESH_ENDPOINT = "http://localhost:8080/mesh";
    process.env.HUNYUAN3D_ENDPOINT = "http://localhost:8081/hunyuan";
    process.env.COSMOS_ENDPOINT = "http://localhost:8082/cosmos";
    process.env.PYTHON_PATH = "/usr/local/bin/python3.11";
    process.env.KICAD_PATH = "/Applications/KiCad/kicad-cli";
    process.env.OPENSCAD_PATH = "/usr/bin/openscad";
    process.env.FORGE_ENCLOSURE_BACKEND = "cadquery";
    process.env.FORGE_PCB_BACKEND = "kicad";
    process.env.FORGE_VIZ_BACKEND = "cosmos";
    process.env.FORGE_ENABLE_GPU = "true";

    const config = loadConfig();

    assert.equal(config.zooCadApiKey, "test-api-key-123");
    assert.equal(config.zooCadEndpoint, "https://custom-zoo.example.com");
    assert.equal(config.llamaMeshEndpoint, "http://localhost:8080/mesh");
    assert.equal(config.hunyuan3dEndpoint, "http://localhost:8081/hunyuan");
    assert.equal(config.cosmosEndpoint, "http://localhost:8082/cosmos");
    assert.equal(config.pythonPath, "/usr/local/bin/python3.11");
    assert.equal(config.kicadPath, "/Applications/KiCad/kicad-cli");
    assert.equal(config.openscadPath, "/usr/bin/openscad");
    assert.equal(config.defaultEnclosureBackend, "cadquery");
    assert.equal(config.defaultPCBBackend, "kicad");
    assert.equal(config.defaultVisualizationBackend, "cosmos");
    assert.equal(config.enableGpuBackends, true);
  });
});

// ─── detectCapabilities ──────────────────────────────────────

describe("detectCapabilities", () => {
  it("marks openscad always available", async () => {
    const config = loadConfig();
    const caps = await detectCapabilities(config);

    assert.equal(caps.enclosure.openscad.available, true);
    assert.equal(caps.enclosure.openscad.online, true);
    assert.equal(caps.enclosure.openscad.name, "OpenSCAD");
  });

  it("returns correct structure with all expected backends", async () => {
    const config = loadConfig();
    const caps = await detectCapabilities(config);

    // Enclosure backends
    assert.ok("openscad" in caps.enclosure, "Should have openscad key");
    assert.ok("cadquery" in caps.enclosure, "Should have cadquery key");
    assert.ok("zoo-cad" in caps.enclosure, "Should have zoo-cad key");
    assert.ok("llama-mesh" in caps.enclosure, "Should have llama-mesh key");

    // PCB backends
    assert.ok("skidl" in caps.pcb, "Should have skidl key");
    assert.ok("kicad" in caps.pcb, "Should have kicad key");

    // Visualization backends
    assert.ok("hunyuan3d" in caps.visualization, "Should have hunyuan3d key");
    assert.ok("cosmos" in caps.visualization, "Should have cosmos key");
    assert.ok("llama-mesh" in caps.visualization, "Should have llama-mesh viz key");

    // Each entry should have required fields
    for (const [_name, cap] of Object.entries(caps.enclosure) as [string, { name: string; available: boolean; online: boolean }][]) {
      assert.ok(typeof cap.name === "string", "name should be a string");
      assert.ok(typeof cap.available === "boolean", "available should be a boolean");
      assert.ok(typeof cap.online === "boolean", "online should be a boolean");
    }

    // SKiDL script generation should always be available
    assert.equal(caps.pcb.skidl.available, true);
    // online depends on whether skidl package is installed — don't assert
  });

  it("marks zoo-cad unavailable without API key", async () => {
    const config = loadConfig(); // No env vars set
    const caps = await detectCapabilities(config);

    assert.equal(caps.enclosure["zoo-cad"].available, false);
    assert.ok(
      caps.enclosure["zoo-cad"].reason?.includes("ZOO_CAD_API_KEY"),
      "Should explain why zoo-cad is unavailable",
    );
  });

  it("marks kicad unavailable without kicadPath", async () => {
    const config = loadConfig();
    const caps = await detectCapabilities(config);

    assert.equal(caps.pcb.kicad.available, false);
    assert.ok(
      caps.pcb.kicad.reason?.includes("KICAD_PATH"),
      "Should explain why kicad is unavailable",
    );
  });

  it("marks visualization backends available in offline mode", async () => {
    const config = loadConfig();
    const caps = await detectCapabilities(config);

    // Visualization backends are always "available" (they generate placeholders offline)
    assert.equal(caps.visualization.hunyuan3d.available, true);
    assert.equal(caps.visualization.cosmos.available, true);
    assert.equal(caps.visualization["llama-mesh"].available, true);

    // But they should be offline
    assert.equal(caps.visualization.hunyuan3d.online, false);
    assert.equal(caps.visualization.cosmos.online, false);
    assert.equal(caps.visualization["llama-mesh"].online, false);
  });
});
