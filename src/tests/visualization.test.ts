/**
 * Tests for visualization backends (Hunyuan3D + Cosmos).
 *
 * Both backends are tested in offline mode (no API endpoints configured),
 * which generates placeholder artifacts deterministically.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateHunyuan3DModel } from "../backends/visualization/hunyuan3d.js";
import { generateCosmosVideo } from "../backends/visualization/cosmos.js";
import { createTestDoc } from "./fixtures.js";
import type { ForgeConfig, MHDLDocument } from "../schema/mhdl.js";

// ─── Helpers ──────────────────────────────────────────────────

/** Config with no API endpoints — forces offline mode. */
const offlineConfig: ForgeConfig = {};

/** Creates a minimal doc with no components. */
function createEmptyComponentsDoc(): MHDLDocument {
  const doc = createTestDoc();
  doc.board.components = [];
  doc.board.connections = [];
  return doc;
}

/** Creates a minimal doc with bare-bones fields. */
function createMinimalDoc(): MHDLDocument {
  return createTestDoc({
    meta: {
      schemaVersion: "0.1.0",
      name: "Tiny",
      description: "Minimal device",
      version: "0.0.1",
    },
  });
}

// ─── Hunyuan3D Offline Mode ──────────────────────────────────

describe("Hunyuan3D visualization backend (offline)", () => {
  it("generates OBJ with correct vertices and faces", async () => {
    const doc = createTestDoc();
    const artifacts = await generateHunyuan3DModel(doc, offlineConfig);

    assert.equal(artifacts.length, 1, "Should produce exactly one artifact");
    const obj = artifacts[0];
    const content = obj.content;

    // Count vertices (lines starting with "v ")
    const vertices = content.split("\n").filter((l) => l.startsWith("v "));
    assert.equal(vertices.length, 8, "Box mesh should have 8 vertices");

    // Count faces (lines starting with "f ")
    const faces = content.split("\n").filter((l) => l.startsWith("f "));
    assert.equal(faces.length, 12, "Box mesh should have 12 triangular faces (6 sides x 2)");
  });

  it("artifact has format 'obj' and backend 'hunyuan3d-offline'", async () => {
    const doc = createTestDoc();
    const artifacts = await generateHunyuan3DModel(doc, offlineConfig);
    const obj = artifacts[0];

    assert.equal(obj.format, "obj");
    assert.equal(obj.backend, "hunyuan3d-offline");
    assert.equal(obj.stage, "visualization");
    assert.equal(obj.filename, "model.obj");
    assert.equal(obj.contentType, "text");
  });

  it("handles empty component lists", async () => {
    const doc = createEmptyComponentsDoc();
    const artifacts = await generateHunyuan3DModel(doc, offlineConfig);

    assert.equal(artifacts.length, 1);
    const content = artifacts[0].content;

    // Should still produce a valid box mesh
    const vertices = content.split("\n").filter((l) => l.startsWith("v "));
    assert.equal(vertices.length, 8, "Should still have 8 vertices with no components");
  });

  it("handles minimal MHDL docs", async () => {
    const doc = createMinimalDoc();
    const artifacts = await generateHunyuan3DModel(doc, offlineConfig);

    assert.equal(artifacts.length, 1);
    assert.ok(
      artifacts[0].content.includes("Tiny"),
      "OBJ should reference the product name",
    );
  });
});

// ─── Cosmos Offline Mode ─────────────────────────────────────

describe("Cosmos visualization backend (offline)", () => {
  it("generates markdown storyboard", async () => {
    const doc = createTestDoc();
    const artifacts = await generateCosmosVideo(doc, offlineConfig);

    assert.equal(artifacts.length, 1, "Should produce exactly one artifact");
    const sb = artifacts[0];

    assert.equal(sb.format, "markdown");
    assert.equal(sb.backend, "cosmos-offline");
    assert.equal(sb.stage, "visualization");
    assert.equal(sb.filename, "product-video-storyboard.md");
  });

  it("storyboard mentions enclosure dimensions and components", async () => {
    const doc = createTestDoc();
    const artifacts = await generateCosmosVideo(doc, offlineConfig);
    const content = artifacts[0].content;

    // Dimensions: board is 60x40x20, wall is 2mm, so case is 64x44x24
    assert.ok(content.includes("64"), "Should mention case width (64mm)");
    assert.ok(content.includes("44"), "Should mention case height (44mm)");
    assert.ok(content.includes("24"), "Should mention case depth (24mm)");

    // Components
    assert.ok(content.includes("LED"), "Should mention LEDs");
    assert.ok(content.includes("OLED"), "Should mention OLED display");
    assert.ok(content.includes("button"), "Should mention button");
  });

  it("handles empty component lists", async () => {
    const doc = createEmptyComponentsDoc();
    const artifacts = await generateCosmosVideo(doc, offlineConfig);

    assert.equal(artifacts.length, 1);
    const content = artifacts[0].content;

    // Should still produce a valid storyboard
    assert.ok(content.includes("# Product Showcase Video Storyboard"), "Should have storyboard header");
    assert.ok(content.includes("Frames"), "Should have frame descriptions");
  });

  it("handles minimal MHDL docs", async () => {
    const doc = createMinimalDoc();
    const artifacts = await generateCosmosVideo(doc, offlineConfig);

    assert.equal(artifacts.length, 1);
    assert.ok(
      artifacts[0].content.includes("Tiny"),
      "Storyboard should reference the product name",
    );
  });
});
