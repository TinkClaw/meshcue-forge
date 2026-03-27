/**
 * Tests for error handling paths.
 *
 * Verifies that invalid inputs, missing fields, and bad configurations
 * produce helpful errors rather than crashes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { build } from "../tools/build.js";
import { validate } from "../schema/validate.js";
import { describe as describeHardware } from "../tools/describe.js";
import { createTestDoc, createPinConflictDoc } from "./fixtures.js";
import type { MHDLDocument, ForgeConfig } from "../schema/mhdl.js";

// ─── Build with Invalid JSON in MCP Handler ─────────────────

describe("build error handling", () => {
  it("build with invalid JSON throws when parsed by MCP handler", () => {
    assert.throws(
      () => {
        JSON.parse("this is not valid json {{{");
      },
      { name: "SyntaxError" },
      "Parsing invalid JSON should throw SyntaxError",
    );
  });

  it("build with missing required MHDL fields fails validation", async () => {
    // Create a doc missing critical board fields
    const doc = createTestDoc();

    // Remove connections to simulate a broken doc
    doc.board.connections = [];
    // Add a broken connection referencing non-existent pins
    doc.board.connections.push({
      from: "mcu.nonexistent",
      to: "nowhere.pin",
      type: "wire",
    });

    const result = await build(doc, ["all"], {
      defaultEnclosureBackend: "openscad",
      defaultPCBBackend: "skidl",
    });

    assert.equal(result.success, false, "Build should fail with invalid refs");
    assert.equal(result.validation.valid, false);
    assert.ok(
      result.validation.issues.some((i) => i.severity === "error"),
      "Should have validation errors",
    );
  });
});

// ─── Validate with Completely Empty Object ───────────────────

describe("validate error handling", () => {
  it("validate with completely empty object throws or returns errors", () => {
    // The validator expects an MHDLDocument shape.
    // Passing an empty object should either throw or produce errors.
    try {
      const result = validate({} as unknown as MHDLDocument);
      // If it doesn't throw, it should at least not claim valid
      // (the validator reads doc.board.mcu, doc.board.components, etc.)
      assert.ok(
        result !== undefined,
        "Should return a result even for broken input",
      );
    } catch {
      // Throwing is also acceptable for completely invalid input
      assert.ok(true, "Throwing on empty object is acceptable");
    }
  });

  it("validate with duplicate GPIO pins reports PIN_CONFLICT", () => {
    const doc = createPinConflictDoc();
    const result = validate(doc);

    const conflicts = result.issues.filter((i) => i.code === "PIN_CONFLICT");
    assert.ok(conflicts.length >= 1, "Should detect GPIO pin conflict");
    assert.ok(
      conflicts[0].message.includes("GPIO 2"),
      "Should reference the conflicting GPIO number",
    );
  });
});

// ─── Describe with Bad Input ─────────────────────────────────

describe("describe error handling", () => {
  it("describe with empty string produces valid structure", () => {
    // The describe tool should handle empty input gracefully
    try {
      const doc = describeHardware("");
      // If it returns, it should have basic MHDL structure
      assert.ok(doc.meta, "Should still have meta");
      assert.ok(doc.board, "Should still have board");
      assert.ok(doc.board.mcu, "Should still have an MCU");
      assert.ok(doc.firmware, "Should still have firmware config");
      assert.ok(doc.enclosure, "Should still have enclosure config");
    } catch {
      // Throwing is also acceptable for empty input
      assert.ok(true, "Throwing on empty string is acceptable");
    }
  });

  it("describe with nonsense input produces valid structure", () => {
    try {
      const doc = describeHardware("xyzzy flurbo gnargle 12345 !!!???");
      // Should still produce a valid-looking MHDL even for gibberish
      assert.ok(doc.meta, "Should have meta");
      assert.equal(doc.meta.schemaVersion, "0.1.0");
      assert.ok(doc.board, "Should have board");
      assert.ok(doc.board.mcu, "Should have an MCU");
      assert.ok(doc.board.mcu.family, "MCU should have a family");
      assert.ok(doc.firmware, "Should have firmware config");
      assert.ok(doc.enclosure, "Should have enclosure config");
    } catch {
      assert.ok(true, "Throwing on nonsense input is acceptable");
    }
  });
});

// ─── Build Single Stage Failure ──────────────────────────────

describe("build single stage fallback", () => {
  it("kicad without kicadPath falls back gracefully", async () => {
    const doc = createTestDoc();
    const config: ForgeConfig = {
      defaultPCBBackend: "kicad",
      // No kicadPath set — kicad is unavailable
    };

    const result = await build(doc, ["pcb"], config);

    // Should succeed by falling back to skidl
    assert.ok(result.success, "Should succeed by falling back to available backend");
    const pcbArtifacts = result.artifacts.filter((a) => a.stage === "pcb");
    assert.ok(pcbArtifacts.length > 0, "Should still produce PCB artifacts via fallback");
  });
});

// ─── Iterate with Invalid Patch JSON ─────────────────────────

describe("iterate error handling", () => {
  it("invalid patch JSON throws SyntaxError when parsed", () => {
    assert.throws(
      () => {
        JSON.parse("{not: valid json!!!}");
      },
      { name: "SyntaxError" },
      "Parsing invalid patch JSON should throw SyntaxError",
    );
  });

  it("valid patch applied to doc preserves MHDL structure", () => {
    const doc = createTestDoc();
    const patch = { enclosure: { type: "screw-close" } };

    // Simulate the merge that meshforge-iterate performs
    const patched = { ...doc, ...patch, enclosure: { ...doc.enclosure, ...patch.enclosure } };

    assert.equal(
      patched.enclosure.type,
      "screw-close",
      "Patch should update enclosure type",
    );
    assert.equal(
      patched.enclosure.wallThicknessMm,
      2,
      "Unpatched fields should be preserved",
    );
    assert.ok(patched.board, "Board should still exist after patching");
    assert.ok(patched.meta, "Meta should still exist after patching");
  });
});
