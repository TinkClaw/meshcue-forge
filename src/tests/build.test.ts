/**
 * Tests for the meshforge-build pipeline.
 *
 * Verifies that valid docs produce artifacts for all stages,
 * invalid docs fail gracefully, and backend selection logic
 * respects config overrides and fallbacks.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { build } from "../tools/build.js";
import type { ForgeConfig } from "../schema/mhdl.js";
import { createTestDoc, createInvalidDoc } from "./fixtures.js";

describe("build pipeline", () => {
  it("builds all stages from a valid doc", async () => {
    const doc = createTestDoc();
    const result = await build(doc, ["all"], {
      defaultEnclosureBackend: "openscad",
      defaultPCBBackend: "skidl",
    });

    assert.equal(result.success, true, "Build should succeed");
    assert.ok(result.artifacts.length > 0, "Should produce artifacts");
    assert.ok(result.buildTime >= 0, "Build time should be non-negative");
    assert.equal(result.validation.valid, true, "Validation should pass");
  });

  it("returns artifacts for each core stage", async () => {
    const doc = createTestDoc();
    const result = await build(doc, ["all"], {
      defaultEnclosureBackend: "openscad",
      defaultPCBBackend: "skidl",
    });

    const stages = new Set(result.artifacts.map((a) => a.stage));

    assert.ok(stages.has("circuit"), "Should have circuit artifact");
    assert.ok(stages.has("firmware"), "Should have firmware artifact");
    assert.ok(stages.has("enclosure"), "Should have enclosure artifact");
    assert.ok(stages.has("pcb"), "Should have PCB artifact");
    assert.ok(stages.has("bom"), "Should have BOM artifact");
    assert.ok(stages.has("docs"), "Should have docs artifacts");
  });

  it("fails gracefully on invalid docs", async () => {
    const doc = createInvalidDoc();
    const result = await build(doc, ["all"], {
      defaultEnclosureBackend: "openscad",
      defaultPCBBackend: "skidl",
    });

    assert.equal(result.success, false, "Build should fail for invalid doc");
    assert.equal(
      result.artifacts.length,
      0,
      "Should produce no artifacts on failure",
    );
    assert.equal(result.validation.valid, false, "Validation should fail");
    assert.ok(
      result.validation.issues.some((i) => i.severity === "error"),
      "Should have validation errors",
    );
  });

  it("builds only requested stages", async () => {
    const doc = createTestDoc();

    const circuitOnly = await build(doc, ["circuit"], {
      defaultEnclosureBackend: "openscad",
      defaultPCBBackend: "skidl",
    });
    assert.ok(circuitOnly.success);
    assert.ok(
      circuitOnly.artifacts.every((a) => a.stage === "circuit"),
      "Should only have circuit artifacts",
    );

    const firmwareOnly = await build(doc, ["firmware"], {
      defaultEnclosureBackend: "openscad",
      defaultPCBBackend: "skidl",
    });
    assert.ok(firmwareOnly.success);
    assert.ok(
      firmwareOnly.artifacts.every((a) => a.stage === "firmware"),
      "Should only have firmware artifacts",
    );
  });

  it("config override selects cadquery enclosure backend", async () => {
    const doc = createTestDoc();
    const config: ForgeConfig = {
      defaultEnclosureBackend: "cadquery",
      defaultPCBBackend: "skidl",
      pythonPath: "python3",
    };

    const result = await build(doc, ["enclosure"], config);
    assert.ok(result.success);

    const enclosureArtifacts = result.artifacts.filter(
      (a) => a.stage === "enclosure",
    );
    assert.ok(enclosureArtifacts.length > 0, "Should have enclosure artifacts");
    // CadQuery backend produces Python files
    assert.ok(
      enclosureArtifacts.some((a) => a.format === "python"),
      "CadQuery should produce Python format artifacts",
    );
  });

  it("falls back to openscad when configured backend unavailable", async () => {
    const doc = createTestDoc();
    // zoo-cad requires API key, which we don't set
    const config: ForgeConfig = {
      defaultEnclosureBackend: "zoo-cad",
      defaultPCBBackend: "skidl",
      // No zooCadApiKey set -> zoo-cad unavailable
    };

    const result = await build(doc, ["enclosure"], config);
    assert.ok(result.success);

    const enclosureArtifacts = result.artifacts.filter(
      (a) => a.stage === "enclosure",
    );
    assert.ok(enclosureArtifacts.length > 0, "Should have enclosure artifacts");
    // Should fall back to cadquery (available) or openscad
    assert.ok(
      enclosureArtifacts.some(
        (a) => a.format === "openscad" || a.format === "python",
      ),
      "Should fall back to an available local backend",
    );
  });

  it("skidl is always available as PCB backend fallback", async () => {
    const doc = createTestDoc();
    const config: ForgeConfig = {
      defaultPCBBackend: "kicad",
      // No kicadPath -> kicad unavailable, but skidl script generation always works
    };

    const result = await build(doc, ["pcb"], config);
    assert.ok(result.success);

    const pcbArtifacts = result.artifacts.filter((a) => a.stage === "pcb");
    assert.ok(pcbArtifacts.length > 0, "Should have PCB artifacts");
  });

  it("generates docs artifacts when docs config is set", async () => {
    const doc = createTestDoc();
    const result = await build(doc, ["docs"], {
      defaultEnclosureBackend: "openscad",
      defaultPCBBackend: "skidl",
    });

    assert.ok(result.success);
    const docArtifacts = result.artifacts.filter((a) => a.stage === "docs");
    assert.ok(docArtifacts.length >= 3, "Should have pinout, assembly, and print guide docs");

    const filenames = docArtifacts.map((a) => a.filename);
    assert.ok(filenames.includes("PINOUT.md"), "Should include pinout doc");
    assert.ok(filenames.includes("ASSEMBLY.md"), "Should include assembly doc");
    assert.ok(filenames.includes("PRINT_GUIDE.md"), "Should include print guide");
  });

  it("includes BOM artifact with CSV format", async () => {
    const doc = createTestDoc();
    const result = await build(doc, ["bom"], {
      defaultEnclosureBackend: "openscad",
      defaultPCBBackend: "skidl",
    });

    assert.ok(result.success);
    const bomArtifact = result.artifacts.find((a) => a.stage === "bom");
    assert.ok(bomArtifact, "Should have BOM artifact");
    assert.equal(bomArtifact!.format, "csv");
    assert.ok(
      bomArtifact!.content.includes("Component,Type"),
      "BOM should have CSV header",
    );
  });
});
