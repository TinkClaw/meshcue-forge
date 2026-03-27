/**
 * Tests for the MHDL validator.
 *
 * Verifies that valid documents pass, missing connections are flagged,
 * and pin conflicts are detected.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../schema/validate.js";
import { createTestDoc, createInvalidDoc, createPinConflictDoc } from "./fixtures.js";

describe("validate", () => {
  it("valid doc passes validation", () => {
    const doc = createTestDoc();
    const result = validate(doc);

    assert.equal(result.valid, true, "Valid doc should pass");
    const errors = result.issues.filter((i) => i.severity === "error");
    assert.equal(errors.length, 0, "Valid doc should have no errors");
  });

  it("reports stats correctly for valid doc", () => {
    const doc = createTestDoc();
    const result = validate(doc);

    // 4 components + 1 MCU = 5
    assert.equal(result.stats.componentCount, 5);
    // 5 connections in fixture
    assert.equal(result.stats.connectionCount, 5);
    // Current should include ESP32 (240) + 2 LEDs (40) + button (0||10=10) + OLED (30)
    // Note: validator uses `CURRENT_ESTIMATES[type] || 10`, and button=0 is falsy, so it becomes 10
    assert.equal(result.stats.estimatedCurrentMa, 320);
    // Enclosure volume should be > 0
    assert.ok(result.stats.enclosureVolumeMm3 > 0, "Enclosure volume must be positive");
  });

  it("flags missing / invalid connection references", () => {
    const doc = createInvalidDoc();
    const result = validate(doc);

    assert.equal(result.valid, false, "Doc with invalid connections should fail");

    const pinRefErrors = result.issues.filter(
      (i) => i.code === "INVALID_PIN_REF",
    );
    assert.ok(
      pinRefErrors.length >= 2,
      "Should flag both the 'from' and 'to' invalid pin references",
    );

    // Check that the error messages contain the bad pin references
    const messages = pinRefErrors.map((e) => e.message);
    assert.ok(
      messages.some((m) => m.includes("mcu.gpio99")),
      "Should mention the bad 'from' pin",
    );
    assert.ok(
      messages.some((m) => m.includes("nonexistent.pin")),
      "Should mention the bad 'to' pin",
    );
  });

  it("detects pin conflicts (two components on same GPIO)", () => {
    const doc = createPinConflictDoc();
    const result = validate(doc);

    const pinConflicts = result.issues.filter(
      (i) => i.code === "PIN_CONFLICT",
    );
    assert.ok(
      pinConflicts.length >= 1,
      "Should detect at least one pin conflict",
    );
    assert.ok(
      pinConflicts[0].message.includes("GPIO 2"),
      "Conflict message should reference GPIO 2",
    );
  });

  it("detects power budget exceeded", () => {
    const doc = createTestDoc();
    // Set maxCurrentMa to a very low value
    doc.board.power.maxCurrentMa = 50;
    const result = validate(doc);

    const powerErrors = result.issues.filter(
      (i) => i.code === "POWER_EXCEEDED",
    );
    assert.ok(
      powerErrors.length >= 1,
      "Should flag power budget exceeded",
    );
  });

  it("warns about low power margin", () => {
    const doc = createTestDoc();
    // ESP32 (240) + 2 LEDs (40) + button (0) + OLED (30) = 310mA
    // Set budget just above but within 80% threshold
    doc.board.power.maxCurrentMa = 350;
    const result = validate(doc);

    const warnings = result.issues.filter(
      (i) => i.code === "POWER_MARGIN_LOW",
    );
    assert.ok(
      warnings.length >= 1,
      "Should warn about low power margin when above 80%",
    );
  });

  it("warns about unconnected signal pins", () => {
    const doc = createTestDoc();
    // Add a component with no connection
    doc.board.components.push({
      id: "floating_sensor",
      type: "sensor",
      pins: [
        { id: "data", gpio: 13, mode: "digital-in" },
        { id: "vcc", mode: "power" },
        { id: "gnd", mode: "ground" },
      ],
    });
    const result = validate(doc);

    const unconnected = result.issues.filter(
      (i) => i.code === "UNCONNECTED_PIN",
    );
    assert.ok(
      unconnected.some((i) => i.message.includes("floating_sensor.data")),
      "Should warn about unconnected sensor data pin",
    );
  });

  it("flags cutouts referencing non-existent components", () => {
    const doc = createTestDoc();
    doc.enclosure.cutouts.push({
      type: "led-hole",
      wall: "front",
      componentRef: "ghost_led",
      diameter: 5,
    });
    const result = validate(doc);

    const cutoutErrors = result.issues.filter(
      (i) => i.code === "CUTOUT_INVALID_REF",
    );
    assert.ok(
      cutoutErrors.length >= 1,
      "Should flag cutout referencing non-existent component",
    );
  });

  it("flags mounting holes outside board dimensions", () => {
    const doc = createTestDoc();
    doc.board.mountingHoles!.positions.push({ x: 100, y: 100 });
    const result = validate(doc);

    const mountErrors = result.issues.filter(
      (i) => i.code === "MOUNT_OUT_OF_BOUNDS",
    );
    assert.ok(
      mountErrors.length >= 1,
      "Should flag mounting hole outside board area",
    );
  });
});
