/**
 * Mesh Bridge Tests
 *
 * Tests the MeshBridge class for availability checking, node discovery,
 * build submission, and graceful fallback when mesh is unavailable.
 */

import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MeshBridge, shouldUseMesh } from "../mesh/bridge.js";
import type { MHDLDocument } from "../schema/mhdl.js";

// ─── Minimal MHDL fixture for testing ───────────────────────

const minimalDoc: MHDLDocument = {
  meta: {
    name: "Test Device",
    version: "0.1.0",
    medical: false,
  },
  board: {
    mcu: {
      id: "mcu",
      type: "mcu",
      family: "esp32",
      pins: [],
    },
    components: [],
    connections: [],
    dimensions: { widthMm: 60, heightMm: 40, depthMm: 20 },
  },
  enclosure: {
    type: "snap-fit",
    wallThicknessMm: 2.5,
    cutouts: [],
    mounts: "m3-insert",
  },
  firmware: {
    framework: "arduino",
    libraries: [],
  },
} as unknown as MHDLDocument;

const gpuDoc: MHDLDocument = {
  ...minimalDoc,
  visualization: {
    generate3DModel: true,
    generateVideo: false,
    backend: "hunyuan3d",
  },
} as unknown as MHDLDocument;

const pythonDoc: MHDLDocument = {
  ...minimalDoc,
  enclosure: {
    ...minimalDoc.enclosure,
    backend: "cadquery",
  },
} as unknown as MHDLDocument;

// ─── Tests ──────────────────────────────────────────────────

describe("MeshBridge", () => {
  describe("isAvailable()", () => {
    it("returns false when mesh endpoint is unreachable", async () => {
      // Use a port that nothing listens on
      const bridge = new MeshBridge("ws://127.0.0.1:19999", 1_000);
      const available = await bridge.isAvailable();
      assert.equal(available, false);
      bridge.disconnect();
    });

    it("returns false with invalid endpoint", async () => {
      const bridge = new MeshBridge("ws://invalid-host-that-does-not-exist:9871", 1_000);
      const available = await bridge.isAvailable();
      assert.equal(available, false);
      bridge.disconnect();
    });
  });

  describe("discoverNodes()", () => {
    it("returns empty array when mesh is unavailable", async () => {
      const bridge = new MeshBridge("ws://127.0.0.1:19999", 1_000);
      const nodes = await bridge.discoverNodes("gpu");
      assert.deepEqual(nodes, []);
      bridge.disconnect();
    });

    it("returns empty array for all capability types when offline", async () => {
      const bridge = new MeshBridge("ws://127.0.0.1:19999", 1_000);
      const gpuNodes = await bridge.discoverNodes("gpu");
      const computeNodes = await bridge.discoverNodes("compute");
      const storageNodes = await bridge.discoverNodes("storage");
      assert.deepEqual(gpuNodes, []);
      assert.deepEqual(computeNodes, []);
      assert.deepEqual(storageNodes, []);
      bridge.disconnect();
    });
  });

  describe("submitBuild()", () => {
    it("throws when mesh is unavailable", async () => {
      const bridge = new MeshBridge("ws://127.0.0.1:19999", 1_000);
      await assert.rejects(
        () => bridge.submitBuild(minimalDoc),
        { message: /WebSocket|timeout|connect/i },
      );
      bridge.disconnect();
    });
  });

  describe("disconnect()", () => {
    it("can be called safely even when not connected", () => {
      const bridge = new MeshBridge("ws://127.0.0.1:19999", 1_000);
      // Should not throw
      bridge.disconnect();
      bridge.disconnect();
    });
  });

  describe("onProgress()", () => {
    it("returns an unsubscribe function", () => {
      const bridge = new MeshBridge("ws://127.0.0.1:19999", 1_000);
      const unsub = bridge.onProgress("test-job", () => {});
      assert.equal(typeof unsub, "function");
      unsub(); // Should not throw
      bridge.disconnect();
    });
  });
});

describe("shouldUseMesh()", () => {
  it("returns useMesh=false when mesh is disabled", async () => {
    const bridge = new MeshBridge("ws://127.0.0.1:19999", 1_000);
    const decision = await shouldUseMesh(bridge, minimalDoc, {
      localHasGpu: false,
      localHasPython: true,
      meshEnabled: false,
    });
    assert.equal(decision.useMesh, false);
    assert.match(decision.reason, /disabled/i);
    bridge.disconnect();
  });

  it("returns useMesh=false when mesh is enabled but unavailable", async () => {
    const bridge = new MeshBridge("ws://127.0.0.1:19999", 1_000);
    const decision = await shouldUseMesh(bridge, gpuDoc, {
      localHasGpu: false,
      localHasPython: true,
      meshEnabled: true,
    });
    assert.equal(decision.useMesh, false);
    assert.match(decision.reason, /unavailable/i);
    bridge.disconnect();
  });

  it("returns useMesh=false when local has all requirements", async () => {
    // Even if mesh were available, if local has GPU and Python, prefer local
    const bridge = new MeshBridge("ws://127.0.0.1:19999", 1_000);
    const decision = await shouldUseMesh(bridge, minimalDoc, {
      localHasGpu: true,
      localHasPython: true,
      meshEnabled: true,
    });
    // Will be false because mesh is unavailable AND local meets all reqs
    assert.equal(decision.useMesh, false);
    bridge.disconnect();
  });
});

describe("Fallback behavior", () => {
  it("build pipeline works without mesh (graceful degradation)", async () => {
    // This test verifies that the MeshBridge class can be instantiated
    // and queried without affecting normal operation when mesh is offline
    const bridge = new MeshBridge("ws://127.0.0.1:19999", 500);

    const available = await bridge.isAvailable();
    assert.equal(available, false, "Mesh should be unavailable in test env");

    const nodes = await bridge.discoverNodes("compute");
    assert.deepEqual(nodes, [], "Should return empty nodes when offline");

    bridge.disconnect();
  });

  it("handles timeout correctly", async () => {
    const bridge = new MeshBridge("ws://127.0.0.1:19999", 500);
    const start = Date.now();
    await bridge.isAvailable();
    const elapsed = Date.now() - start;
    // Should not take much longer than the timeout
    assert.ok(elapsed < 5_000, `Timeout took too long: ${elapsed}ms`);
    bridge.disconnect();
  });
});
