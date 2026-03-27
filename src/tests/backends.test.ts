/**
 * Tests for individual backend code generators.
 *
 * Each backend is tested for correct output format, valid content,
 * and correct artifact stage/format metadata.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateWokwiCircuit } from "../backends/circuit/wokwi.js";
import { generateArduinoFirmware } from "../backends/firmware/arduino.js";
import { generateOpenSCADEnclosure } from "../backends/enclosure/openscad.js";
import { generateCadQueryEnclosure } from "../backends/enclosure/cadquery.js";
import { generateSKiDLScript } from "../backends/pcb/skidl.js";
import { createTestDoc } from "./fixtures.js";

// ─── Wokwi Circuit Backend ──────────────────────────────────

describe("Wokwi circuit backend", () => {
  it("generates valid JSON", () => {
    const doc = createTestDoc();
    const artifact = generateWokwiCircuit(doc);

    // Should not throw
    const diagram = JSON.parse(artifact.content);

    assert.equal(diagram.version, 1, "Wokwi diagram version should be 1");
    assert.equal(diagram.author, "MeshCue Forge");
    assert.ok(Array.isArray(diagram.parts), "Should have parts array");
    assert.ok(Array.isArray(diagram.connections), "Should have connections array");
  });

  it("includes MCU and all components as parts", () => {
    const doc = createTestDoc();
    const artifact = generateWokwiCircuit(doc);
    const diagram = JSON.parse(artifact.content);

    const partIds = diagram.parts.map((p: { id: string }) => p.id);
    assert.ok(partIds.includes("mcu"), "Should include MCU");
    assert.ok(partIds.includes("led1"), "Should include led1");
    assert.ok(partIds.includes("led2"), "Should include led2");
    assert.ok(partIds.includes("btn1"), "Should include btn1");
    assert.ok(partIds.includes("oled1"), "Should include oled1");
  });

  it("maps ESP32 to correct Wokwi part type", () => {
    const doc = createTestDoc();
    const artifact = generateWokwiCircuit(doc);
    const diagram = JSON.parse(artifact.content);

    const mcuPart = diagram.parts.find(
      (p: { id: string }) => p.id === "mcu",
    );
    assert.equal(
      mcuPart.type,
      "board-esp32-devkit-c-v4",
      "ESP32 should map to devkit-c-v4",
    );
  });

  it("converts connection dot notation to colon notation", () => {
    const doc = createTestDoc();
    const artifact = generateWokwiCircuit(doc);
    const diagram = JSON.parse(artifact.content);

    for (const conn of diagram.connections) {
      assert.ok(
        conn.from.includes(":"),
        `Connection 'from' should use colon notation: ${conn.from}`,
      );
      assert.ok(
        conn.to.includes(":"),
        `Connection 'to' should use colon notation: ${conn.to}`,
      );
      assert.ok(
        !conn.from.includes("."),
        `Connection 'from' should not have dots: ${conn.from}`,
      );
    }
  });

  it("returns correct artifact stage and format", () => {
    const doc = createTestDoc();
    const artifact = generateWokwiCircuit(doc);

    assert.equal(artifact.stage, "circuit");
    assert.equal(artifact.format, "wokwi-json");
    assert.equal(artifact.filename, "diagram.json");
  });
});

// ─── Arduino Firmware Backend ───────────────────────────────

describe("Arduino firmware backend", () => {
  it("generates compilable .ino with required sections", () => {
    const doc = createTestDoc();
    const artifacts = generateArduinoFirmware(doc);

    const ino = artifacts.find((a) => a.filename === "main.ino");
    assert.ok(ino, "Should produce main.ino");

    const content = ino!.content;

    // Must have Arduino include
    assert.ok(
      content.includes("#include <Arduino.h>"),
      "Should include Arduino.h",
    );

    // Must have setup() and loop()
    assert.ok(content.includes("void setup()"), "Should have setup()");
    assert.ok(content.includes("void loop()"), "Should have loop()");

    // Must have Serial.begin
    assert.ok(
      content.includes("Serial.begin(115200)"),
      "Should initialize serial",
    );
  });

  it("generates pin definitions for all GPIO pins", () => {
    const doc = createTestDoc();
    const artifacts = generateArduinoFirmware(doc);
    const ino = artifacts.find((a) => a.filename === "main.ino")!;

    // Should have #define for led1 and led2 anode pins
    assert.ok(
      ino.content.includes("#define PIN_LED1_ANODE 2"),
      "Should define LED1 anode pin",
    );
    assert.ok(
      ino.content.includes("#define PIN_LED2_ANODE 4"),
      "Should define LED2 anode pin",
    );
    assert.ok(
      ino.content.includes("#define PIN_BTN1_SIG 5"),
      "Should define button signal pin",
    );
  });

  it("includes OLED library headers", () => {
    const doc = createTestDoc();
    const artifacts = generateArduinoFirmware(doc);
    const ino = artifacts.find((a) => a.filename === "main.ino")!;

    assert.ok(
      ino.content.includes("#include <Adafruit_SSD1306.h>"),
      "Should include SSD1306 library",
    );
    assert.ok(
      ino.content.includes("#include <Adafruit_GFX.h>"),
      "Should include GFX library",
    );
    assert.ok(
      ino.content.includes("#include <Wire.h>"),
      "Should include Wire library for I2C",
    );
  });

  it("generates platformio.ini for arduino framework", () => {
    const doc = createTestDoc();
    const artifacts = generateArduinoFirmware(doc);

    const ini = artifacts.find((a) => a.filename === "platformio.ini");
    assert.ok(ini, "Should produce platformio.ini");
    assert.ok(
      ini!.content.includes("board = esp32dev"),
      "Should target esp32dev board",
    );
    assert.ok(
      ini!.content.includes("framework = arduino"),
      "Should use arduino framework",
    );
  });

  it("returns correct artifact stage and format", () => {
    const doc = createTestDoc();
    const artifacts = generateArduinoFirmware(doc);

    const ino = artifacts.find((a) => a.filename === "main.ino")!;
    assert.equal(ino.stage, "firmware");
    assert.equal(ino.format, "arduino");
  });

  it("generates button debounce code", () => {
    const doc = createTestDoc();
    const artifacts = generateArduinoFirmware(doc);
    const ino = artifacts.find((a) => a.filename === "main.ino")!;

    assert.ok(
      ino.content.includes("btn1_debounce"),
      "Should generate debounce variable for button",
    );
    assert.ok(
      ino.content.includes("INPUT_PULLUP"),
      "Should configure button as INPUT_PULLUP",
    );
  });
});

// ─── OpenSCAD Enclosure Backend ─────────────────────────────

describe("OpenSCAD enclosure backend", () => {
  it("generates valid SCAD with correct dimensions", () => {
    const doc = createTestDoc();
    const artifacts = generateOpenSCADEnclosure(doc);

    assert.ok(artifacts.length >= 1, "Should produce at least one artifact");
    const scad = artifacts.find((a) => a.filename === "enclosure.scad");
    assert.ok(scad, "Should produce enclosure.scad");

    const content = scad!.content;

    // Board is 60x40x20, wall is 2mm, so case should be 64x44x24
    assert.ok(
      content.includes("case_width = 64"),
      "Case width should be board + 2 * wall",
    );
    assert.ok(
      content.includes("case_height = 44"),
      "Case height should be board + 2 * wall",
    );
    assert.ok(
      content.includes("case_depth = 24"),
      "Case depth should be board + 2 * wall",
    );
    assert.ok(
      content.includes("wall = 2"),
      "Wall thickness should match config",
    );
    assert.ok(
      content.includes("corner_r = 3"),
      "Corner radius should match config",
    );
  });

  it("includes snap-fit clip modules", () => {
    const doc = createTestDoc();
    const artifacts = generateOpenSCADEnclosure(doc);
    const scad = artifacts.find((a) => a.filename === "enclosure.scad")!;

    // Test fixture has snap-fit enclosure type
    assert.ok(
      scad.content.includes("module clip()"),
      "Should have clip module for snap-fit",
    );
    assert.ok(
      scad.content.includes("clips_base()"),
      "Should reference clips_base in assembly",
    );
  });

  it("includes cutout definitions for each component", () => {
    const doc = createTestDoc();
    const artifacts = generateOpenSCADEnclosure(doc);
    const scad = artifacts.find((a) => a.filename === "enclosure.scad")!;

    assert.ok(
      scad.content.includes("usb-c"),
      "Should have USB-C cutout",
    );
    assert.ok(
      scad.content.includes("oled-window"),
      "Should have OLED window cutout",
    );
    assert.ok(
      scad.content.includes("led-hole"),
      "Should have LED hole cutout",
    );
  });

  it("generates ventilation slots when enabled", () => {
    const doc = createTestDoc();
    const artifacts = generateOpenSCADEnclosure(doc);
    const scad = artifacts.find((a) => a.filename === "enclosure.scad")!;

    assert.ok(
      scad.content.includes("module vents()"),
      "Should have vents module when ventilation enabled",
    );
  });

  it("generates embossed label", () => {
    const doc = createTestDoc();
    const artifacts = generateOpenSCADEnclosure(doc);
    const scad = artifacts.find((a) => a.filename === "enclosure.scad")!;

    assert.ok(
      scad.content.includes('text("Test Device"'),
      "Should emboss the label text",
    );
  });

  it("generates mounting posts", () => {
    const doc = createTestDoc();
    const artifacts = generateOpenSCADEnclosure(doc);
    const scad = artifacts.find((a) => a.filename === "enclosure.scad")!;

    assert.ok(
      scad.content.includes("module mount_posts()"),
      "Should have mounting posts module",
    );
  });

  it("returns correct artifact stage and format", () => {
    const doc = createTestDoc();
    const artifacts = generateOpenSCADEnclosure(doc);
    const scad = artifacts.find((a) => a.filename === "enclosure.scad")!;

    assert.equal(scad.stage, "enclosure");
    assert.equal(scad.format, "openscad");
  });
});

// ─── CadQuery Enclosure Backend ─────────────────────────────

describe("CadQuery enclosure backend", () => {
  it("generates Python with cadquery import", () => {
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

  it("generates correct case dimensions as Python variables", () => {
    const doc = createTestDoc();
    const artifacts = generateCadQueryEnclosure(doc);
    const py = artifacts.find((a) => a.filename === "enclosure_cadquery.py")!;

    // 60 + 2*2 = 64, 40 + 2*2 = 44, 20 + 2*2 = 24
    assert.ok(py.content.includes("CASE_W = 64"), "Width should be 64");
    assert.ok(py.content.includes("CASE_H = 44"), "Height should be 44");
    assert.ok(py.content.includes("CASE_D = 24"), "Depth should be 24");
  });

  it("generates shell with fillet operations", () => {
    const doc = createTestDoc();
    const artifacts = generateCadQueryEnclosure(doc);
    const py = artifacts.find((a) => a.filename === "enclosure_cadquery.py")!;

    assert.ok(
      py.content.includes(".fillet(CORNER_R)"),
      "Should fillet outer edges",
    );
    assert.ok(
      py.content.includes("outer.cut(inner)"),
      "Should cut inner from outer to make shell",
    );
  });

  it("generates base/lid split", () => {
    const doc = createTestDoc();
    const artifacts = generateCadQueryEnclosure(doc);
    const py = artifacts.find((a) => a.filename === "enclosure_cadquery.py")!;

    assert.ok(
      py.content.includes("base = shell.intersect(split_box_bot)"),
      "Should split base",
    );
    assert.ok(
      py.content.includes("lid  = shell.intersect(split_box_top)"),
      "Should split lid",
    );
  });

  it("generates STEP/STL export commands", () => {
    const doc = createTestDoc();
    const artifacts = generateCadQueryEnclosure(doc);
    const py = artifacts.find((a) => a.filename === "enclosure_cadquery.py")!;

    assert.ok(
      py.content.includes('cq.exporters.export(base, "enclosure_base.step")'),
      "Should export base STEP",
    );
    assert.ok(
      py.content.includes('cq.exporters.export(lid, "enclosure_lid.stl")'),
      "Should export lid STL",
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

// ─── SKiDL PCB Backend ──────────────────────────────────────

describe("SKiDL PCB backend", () => {
  it("generates Python with skidl import", () => {
    const doc = createTestDoc();
    const artifacts = generateSKiDLScript(doc);

    const py = artifacts.find((a) => a.filename === "circuit.py");
    assert.ok(py, "Should produce circuit.py");
    assert.ok(
      py!.content.includes("from skidl import *"),
      "Should import skidl",
    );
  });

  it("declares MCU part with correct library and footprint", () => {
    const doc = createTestDoc();
    const artifacts = generateSKiDLScript(doc);
    const py = artifacts.find((a) => a.filename === "circuit.py")!;

    assert.ok(
      py.content.includes('"RF_Module"'),
      "ESP32 should use RF_Module library",
    );
    assert.ok(
      py.content.includes('"ESP32-WROOM-32"'),
      "Should use ESP32-WROOM-32 part name",
    );
  });

  it("declares all components as SKiDL parts", () => {
    const doc = createTestDoc();
    const artifacts = generateSKiDLScript(doc);
    const py = artifacts.find((a) => a.filename === "circuit.py")!;

    // Should have parts for led1, led2, btn1, oled1
    assert.ok(py.content.includes("led1 = Part("), "Should declare led1");
    assert.ok(py.content.includes("led2 = Part("), "Should declare led2");
    assert.ok(py.content.includes("btn1 = Part("), "Should declare btn1");
    assert.ok(py.content.includes("oled1 = Part("), "Should declare oled1");
  });

  it("generates current-limiting resistors for LEDs", () => {
    const doc = createTestDoc();
    const artifacts = generateSKiDLScript(doc);
    const py = artifacts.find((a) => a.filename === "circuit.py")!;

    assert.ok(
      py.content.includes("r_led1 = Part("),
      "Should auto-generate resistor for led1",
    );
    assert.ok(
      py.content.includes("r_led2 = Part("),
      "Should auto-generate resistor for led2",
    );
  });

  it("generates power rails (VCC and GND nets)", () => {
    const doc = createTestDoc();
    const artifacts = generateSKiDLScript(doc);
    const py = artifacts.find((a) => a.filename === "circuit.py")!;

    assert.ok(
      py.content.includes('vcc_net = Net("VCC")'),
      "Should declare VCC net",
    );
    assert.ok(
      py.content.includes('gnd_net = Net("GND")'),
      "Should declare GND net",
    );
  });

  it("generates decoupling capacitors", () => {
    const doc = createTestDoc();
    const artifacts = generateSKiDLScript(doc);
    const py = artifacts.find((a) => a.filename === "circuit.py")!;

    assert.ok(
      py.content.includes('value="100nF"'),
      "Should have 100nF decoupling cap",
    );
    assert.ok(
      py.content.includes('value="10uF"'),
      "Should have 10uF bulk cap",
    );
  });

  it("generates KiCad project stub", () => {
    const doc = createTestDoc();
    const artifacts = generateSKiDLScript(doc);

    const kicadPro = artifacts.find((a) => a.format === "kicad-project");
    assert.ok(kicadPro, "Should produce KiCad project file");

    const project = JSON.parse(kicadPro!.content);
    assert.equal(project.project.name, "Test Device");
    assert.equal(project.board.design_settings.layers, 2);
  });

  it("calls generate_netlist() at the end", () => {
    const doc = createTestDoc();
    const artifacts = generateSKiDLScript(doc);
    const py = artifacts.find((a) => a.filename === "circuit.py")!;

    assert.ok(
      py.content.includes("generate_netlist()"),
      "Should call generate_netlist()",
    );
  });

  it("returns correct artifact stage and format", () => {
    const doc = createTestDoc();
    const artifacts = generateSKiDLScript(doc);

    const py = artifacts.find((a) => a.filename === "circuit.py")!;
    assert.equal(py.stage, "pcb");
    assert.equal(py.format, "python");
    assert.equal(py.backend, "skidl");
  });
});
