/**
 * Tests for the meshforge-describe tool.
 *
 * Verifies that natural language descriptions produce valid MHDL documents
 * with correct MCU selection, component resolution, and archetype matching.
 */

import { describe as suite, it } from "node:test";
import assert from "node:assert/strict";
import { describe as describeHardware } from "../tools/describe.js";
import type { MHDLDocument, ComponentType, MCUFamily } from "../schema/mhdl.js";

// ─── Helpers ────────────────────────────────────────────────

function assertValidMHDL(doc: MHDLDocument): void {
  assert.ok(doc.meta, "Document must have meta");
  assert.equal(doc.meta.schemaVersion, "0.1.0");
  assert.ok(doc.meta.name, "Document must have a name");
  assert.ok(doc.meta.description, "Document must have a description");
  assert.ok(doc.board, "Document must have a board");
  assert.ok(doc.board.mcu, "Board must have an MCU");
  assert.equal(doc.board.mcu.type, "mcu");
  assert.ok(doc.board.mcu.family, "MCU must have a family");
  assert.ok(doc.board.mcu.pins.length > 0, "MCU must have pins");
  assert.ok(doc.firmware, "Document must have firmware config");
  assert.ok(doc.enclosure, "Document must have enclosure config");
  assert.ok(doc.board.power, "Board must have power config");
  assert.ok(doc.board.connections.length > 0, "Board must have connections");
}

function hasComponentType(doc: MHDLDocument, type: ComponentType): boolean {
  return doc.board.components.some((c) => c.type === type);
}

// ─── Tests ──────────────────────────────────────────────────

suite("describe tool", () => {
  it("generates valid MHDL from 'ESP32 with 2 LEDs and a button'", () => {
    const doc = describeHardware("ESP32 with 2 LEDs and a button");
    assertValidMHDL(doc);

    // Should pick ESP32 MCU
    assert.equal(doc.board.mcu.family, "esp32");

    // Should have 2 LEDs and 1 button
    const leds = doc.board.components.filter((c) => c.type === "led");
    const buttons = doc.board.components.filter((c) => c.type === "button");
    assert.equal(leds.length, 2, "Should have exactly 2 LEDs");
    assert.ok(buttons.length >= 1, "Should have at least 1 button");

    // Each LED should have GPIO assigned
    for (const led of leds) {
      const anode = led.pins.find((p) => p.mode === "digital-out");
      assert.ok(anode, "LED must have a digital-out pin");
      assert.ok(anode.gpio !== undefined, "LED pin must have GPIO assigned");
    }
  });

  it("resolves 'talking mouse' archetype to speaker + microphone", () => {
    const doc = describeHardware("talking mouse");
    assertValidMHDL(doc);

    assert.ok(
      hasComponentType(doc, "speaker"),
      "Talking mouse should include a speaker",
    );
    assert.ok(
      hasComponentType(doc, "microphone"),
      "Talking mouse should include a microphone",
    );
    // Talking toy archetypes use esp32-s3 for audio capabilities
    assert.equal(
      doc.board.mcu.family,
      "esp32-s3",
      "Talking mouse archetype should use ESP32-S3",
    );
  });

  it("unknown descriptions still produce valid MHDL structure", () => {
    const doc = describeHardware("quantum flux capacitor with a time display");

    // Core structure must exist even for unknown descriptions
    assert.ok(doc.meta, "Document must have meta");
    assert.equal(doc.meta.schemaVersion, "0.1.0");
    assert.ok(doc.meta.name, "Document must have a name");
    assert.ok(doc.board, "Document must have a board");
    assert.ok(doc.board.mcu, "Board must have an MCU");
    assert.ok(doc.board.mcu.family, "MCU must have a family");
    assert.ok(doc.firmware, "Document must have firmware config");
    assert.ok(doc.enclosure, "Document must have enclosure config");
    assert.ok(doc.board.power, "Board must have power config");
  });

  it("detects MCU family from keywords", () => {
    const esp32Doc = describeHardware("ESP32 LED blinker");
    assert.equal(esp32Doc.board.mcu.family, "esp32");

    const arduinoDoc = describeHardware("Arduino LED blinker");
    assert.equal(arduinoDoc.board.mcu.family, "arduino-uno");

    const picoDoc = describeHardware("Pico LED blinker");
    assert.equal(picoDoc.board.mcu.family, "rp2040");

    const nanoDoc = describeHardware("Arduino Nano temperature logger");
    assert.equal(nanoDoc.board.mcu.family, "arduino-nano");

    const s3Doc = describeHardware("ESP32-S3 audio player");
    assert.equal(s3Doc.board.mcu.family, "esp32-s3");
  });

  it("generates connections for all signal pins", () => {
    const doc = describeHardware("ESP32 with 1 LED and 1 button");
    assertValidMHDL(doc);

    // Every component signal pin should have a corresponding connection
    for (const comp of doc.board.components) {
      for (const pin of comp.pins) {
        if (pin.mode !== "ground" && pin.mode !== "power") {
          const connected = doc.board.connections.some(
            (c) =>
              c.from === `${comp.id}.${pin.id}` ||
              c.to === `${comp.id}.${pin.id}`,
          );
          assert.ok(
            connected,
            `Pin ${comp.id}.${pin.id} (${pin.mode}) should be connected`,
          );
        }
      }
    }
  });

  it("generates enclosure cutouts matching components", () => {
    const doc = describeHardware("ESP32 with OLED display and 2 LEDs");
    assertValidMHDL(doc);

    // OLED should have a window cutout
    if (hasComponentType(doc, "oled")) {
      const oledCutout = doc.enclosure.cutouts.find(
        (c) => c.type === "oled-window",
      );
      assert.ok(oledCutout, "OLED should have an oled-window cutout");
    }

    // LEDs should have led-hole cutouts
    const ledCutouts = doc.enclosure.cutouts.filter(
      (c) => c.type === "led-hole",
    );
    const ledCount = doc.board.components.filter(
      (c) => c.type === "led",
    ).length;
    assert.equal(
      ledCutouts.length,
      ledCount,
      "Each LED should have a cutout",
    );
  });
});
