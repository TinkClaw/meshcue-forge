/**
 * Tests for non-OpenSCAD enclosure backends.
 *
 * CadQuery is tested for script generation (always works locally).
 * Zoo-CAD and LLaMA-Mesh return placeholders when unconfigured.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateCadQueryEnclosure } from "../backends/enclosure/cadquery.js";
import { generateZooCadEnclosure } from "../backends/enclosure/zoo-cad.js";
import { generateLlamaMeshEnclosure } from "../backends/enclosure/llama-mesh.js";
import { createTestDoc } from "./fixtures.js";
import type { ForgeConfig, MHDLDocument } from "../schema/mhdl.js";

// ─── CadQuery Backend ────────────────────────────────────────

describe("CadQuery enclosure backend", () => {
  it("generates valid Python with correct imports", () => {
    const doc = createTestDoc();
    const artifacts = generateCadQueryEnclosure(doc);

    assert.ok(artifacts.length >= 1, "Should produce at least one artifact");
    const py = artifacts.find((a) => a.filename === "enclosure_cadquery.py");
    assert.ok(py, "Should produce enclosure_cadquery.py");

    assert.ok(
      py!.content.includes("import cadquery as cq"),
      "Should import cadquery",
    );
  });

  it("handles snap-fit enclosure type", () => {
    const doc = createTestDoc(); // Default fixture uses snap-fit
    assert.equal(doc.enclosure.type, "snap-fit", "Fixture should be snap-fit");

    const artifacts = generateCadQueryEnclosure(doc);
    const py = artifacts.find((a) => a.filename === "enclosure_cadquery.py")!;

    // CadQuery script should reference snap-fit closure mechanism
    assert.ok(
      py.content.includes("snap") || py.content.includes("clip"),
      "Snap-fit enclosure should reference snap/clip mechanism",
    );
  });

  it("handles screw-close enclosure type", () => {
    const doc = createTestDoc();
    doc.enclosure.type = "screw-close";

    const artifacts = generateCadQueryEnclosure(doc);
    const py = artifacts.find((a) => a.filename === "enclosure_cadquery.py")!;

    assert.ok(py.content.length > 0, "Should produce non-empty Python script");
    assert.ok(
      py.content.includes("import cadquery as cq"),
      "Should still have cadquery import",
    );
  });

  it("generates STEP/STL export code", () => {
    const doc = createTestDoc();
    const artifacts = generateCadQueryEnclosure(doc);
    const py = artifacts.find((a) => a.filename === "enclosure_cadquery.py")!;

    assert.ok(
      py.content.includes('cq.exporters.export(base, "enclosure_base.step")'),
      "Should export base as STEP",
    );
    assert.ok(
      py.content.includes('cq.exporters.export(lid, "enclosure_lid.stl")'),
      "Should export lid as STL",
    );
  });

  it("returns correct artifact stage and format", () => {
    const doc = createTestDoc();
    const artifacts = generateCadQueryEnclosure(doc);
    const py = artifacts.find((a) => a.filename === "enclosure_cadquery.py")!;

    assert.equal(py.stage, "enclosure");
    assert.equal(py.format, "python");
  });
});

// ─── Zoo-CAD Backend ─────────────────────────────────────────

describe("Zoo-CAD enclosure backend", () => {
  it("returns placeholder when no API key configured", async () => {
    const doc = createTestDoc();
    const config: ForgeConfig = {
      // No zooCadApiKey set
    };

    const artifacts = await generateZooCadEnclosure(doc, config);

    assert.equal(artifacts.length, 1, "Should produce exactly one artifact");
    const artifact = artifacts[0];

    assert.equal(artifact.stage, "enclosure");
    assert.equal(artifact.backend, "zoo-cad");
    assert.ok(
      artifact.content.includes("ZOO_CAD_API_KEY"),
      "Placeholder should mention the missing env var",
    );
    assert.ok(
      artifact.filename.includes("error"),
      "Filename should indicate error state",
    );
  });
});

// ─── LLaMA-Mesh Backend ─────────────────────────────────────

describe("LLaMA-Mesh enclosure backend", () => {
  it("returns placeholder when no endpoint configured", async () => {
    const doc = createTestDoc();
    const config: ForgeConfig = {
      // No llamaMeshEndpoint set
    };

    const artifacts = await generateLlamaMeshEnclosure(doc, config);

    assert.equal(artifacts.length, 1, "Should produce exactly one artifact");
    const artifact = artifacts[0];

    assert.equal(artifact.stage, "enclosure");
    assert.equal(artifact.backend, "llama-mesh");
    assert.ok(
      artifact.content.includes("LLAMA_MESH_ENDPOINT"),
      "Placeholder should mention the missing env var",
    );
    assert.ok(
      artifact.filename.includes("error"),
      "Filename should indicate error state",
    );
  });
});
