/**
 * Tests for medical device safety validation checks.
 *
 * Verifies that medical-specific DRC checks fire correctly
 * and do not interfere with non-medical device validation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../schema/validate.js";
import { createTestDoc } from "./fixtures.js";
import type { MHDLDocument } from "../schema/mhdl.js";

/**
 * Creates a minimal medical device document for testing.
 * Pulse oximeter with sensor, OLED display, buzzer, battery backup.
 */
function createMedicalDoc(
  overrides?: Partial<MHDLDocument>,
): MHDLDocument {
  const base = createTestDoc({
    meta: {
      schemaVersion: "0.1.0",
      name: "PulseOx Monitor",
      description: "A pulse oximeter for clinical use",
      version: "1.0.0",
      author: "MeshCue Medical",
      tags: ["medical", "temperature-rated"],
      medical: true,
      deviceClass: "IIa",
      intendedUse: "Non-invasive SpO2 monitoring",
    },
    board: {
      mcu: {
        id: "mcu",
        type: "mcu",
        family: "esp32",
        model: "ESP32-DevKitC-V4",
        clockMhz: 240,
        flashKb: 4096,
        ramKb: 520,
        wireless: ["wifi", "ble"],
        pins: [
          { id: "gpio2", gpio: 2, mode: "digital-out", label: "POWER_LED" },
          { id: "gpio4", gpio: 4, mode: "digital-out", label: "BATT_LED" },
          { id: "gpio5", gpio: 5, mode: "pwm", label: "BUZZER" },
          { id: "gpio21", gpio: 21, mode: "i2c-sda", label: "SDA" },
          { id: "gpio22", gpio: 22, mode: "i2c-scl", label: "SCL" },
          { id: "gpio13", gpio: 13, mode: "analog-in", label: "SENSOR" },
          { id: "3v3", mode: "power", label: "3V3" },
          { id: "gnd", mode: "ground", label: "GND" },
        ],
      },
      components: [
        {
          id: "power_led",
          type: "led",
          pins: [
            { id: "anode", gpio: 2, mode: "digital-out" },
            { id: "cathode", mode: "ground" },
          ],
          properties: { color: "green", role: "power" },
        },
        {
          id: "battery_led",
          type: "led",
          pins: [
            { id: "anode", gpio: 4, mode: "digital-out" },
            { id: "cathode", mode: "ground" },
          ],
          properties: { color: "red", role: "battery" },
        },
        {
          id: "buzzer1",
          type: "buzzer",
          pins: [
            { id: "sig", gpio: 5, mode: "pwm" },
            { id: "gnd", mode: "ground" },
          ],
        },
        {
          id: "oled1",
          type: "oled",
          pins: [
            { id: "sda", gpio: 21, mode: "i2c-sda" },
            { id: "scl", gpio: 22, mode: "i2c-scl" },
            { id: "vcc", mode: "power" },
            { id: "gnd", mode: "ground" },
          ],
          properties: { i2cAddress: "0x3C", width: 128, height: 64, brightness: 255, minFontSize: 16 },
        },
        {
          id: "spo2_sensor",
          type: "sensor",
          pins: [
            { id: "sig", gpio: 13, mode: "analog-in" },
            { id: "vcc", mode: "power" },
            { id: "gnd", mode: "ground" },
          ],
          properties: { operatingTempMin: 0, operatingTempMax: 50 },
        },
      ],
      connections: [
        { from: "mcu.gpio2", to: "power_led.anode", type: "wire" },
        { from: "mcu.gpio4", to: "battery_led.anode", type: "wire" },
        { from: "mcu.gpio5", to: "buzzer1.sig", type: "wire" },
        { from: "mcu.gpio21", to: "oled1.sda", type: "wire" },
        { from: "mcu.gpio22", to: "oled1.scl", type: "wire" },
        { from: "mcu.gpio13", to: "spo2_sensor.sig", type: "wire" },
      ],
      power: {
        source: "battery",
        voltageIn: 3.7,
        regulatorOut: 3.3,
        maxCurrentMa: 1000,
        batteryMah: 2000,
      },
      dimensions: {
        widthMm: 80,
        heightMm: 50,
        depthMm: 25,
      },
      mountingHoles: {
        diameterMm: 3,
        positions: [
          { x: 4, y: 4 },
          { x: 76, y: 4 },
          { x: 4, y: 46 },
          { x: 76, y: 46 },
        ],
      },
    },
    firmware: {
      framework: "arduino",
      entrypoint: "main.ino",
      libraries: [
        { name: "Adafruit_SSD1306", version: "2.5.7", source: "arduino" },
        { name: "MAX30105", source: "arduino" },
      ],
      boardId: "esp32dev",
      features: ["watchdog", "deep-sleep"],
    },
    enclosure: {
      type: "snap-fit",
      wallThicknessMm: 2.5,
      cornerRadiusMm: 3,
      cutouts: [
        { type: "oled-window", wall: "front", componentRef: "oled1" },
        { type: "led-hole", wall: "front", componentRef: "power_led", diameter: 5 },
        { type: "led-hole", wall: "front", componentRef: "battery_led", diameter: 5 },
        { type: "usb-c", wall: "back", componentRef: "mcu" },
      ],
      mounts: "m3-inserts",
      ventilation: false,
      material: "petg",
      printOrientation: "upright",
      ipRating: "IP44",
      sterilization: "chemical",
      biocompatible: true,
    },
  });

  if (overrides) {
    return { ...base, ...overrides };
  }
  return base;
}

describe("medical safety checks", () => {
  it("medical checks do not run on non-medical devices", () => {
    const doc = createTestDoc();
    const result = validate(doc);

    const medicalIssues = result.issues.filter((i) => i.code.startsWith("MED_"));
    assert.equal(medicalIssues.length, 0, "Non-medical devices should have no medical issues");
    assert.equal(result.stats.medical, undefined, "Non-medical devices should have no medical stats");
  });

  it("missing buzzer triggers alarm warning", () => {
    const doc = createMedicalDoc();
    // Remove buzzer
    doc.board.components = doc.board.components.filter((c) => c.type !== "buzzer");
    const result = validate(doc);

    const alarmIssues = result.issues.filter((i) => i.code === "MED_NO_ALARM");
    assert.ok(alarmIssues.length >= 1, "Should warn about missing audible alarm");
    assert.equal(alarmIssues[0].severity, "warning");
  });

  it("PLA + autoclave triggers sterilization error", () => {
    const doc = createMedicalDoc();
    doc.enclosure.material = "pla";
    doc.enclosure.sterilization = "autoclave";
    const result = validate(doc);

    const sterilErrors = result.issues.filter((i) => i.code === "MED_AUTOCLAVE_MATERIAL");
    assert.ok(sterilErrors.length >= 1, "Should flag PLA + autoclave incompatibility");
    assert.equal(sterilErrors[0].severity, "error");
  });

  it("PLA + biocompatible triggers material warning", () => {
    const doc = createMedicalDoc();
    doc.enclosure.material = "pla";
    doc.enclosure.biocompatible = true;
    const result = validate(doc);

    const bioIssues = result.issues.filter((i) => i.code === "MED_PLA_BIOCOMPAT");
    assert.ok(bioIssues.length >= 1, "Should warn about PLA not suitable for patient contact");
    assert.equal(bioIssues[0].severity, "warning");
  });

  it("medical device without IP rating triggers warning", () => {
    const doc = createMedicalDoc();
    doc.enclosure.ipRating = undefined;
    const result = validate(doc);

    const ipIssues = result.issues.filter((i) => i.code === "MED_LOW_IP_RATING");
    assert.ok(ipIssues.length >= 1, "Should warn about missing IP rating");
    assert.equal(ipIssues[0].severity, "warning");
  });

  it("monitoring device without data logging triggers warning", () => {
    const doc = createMedicalDoc();
    // Remove wireless capability so data export is absent
    doc.board.mcu.wireless = [];
    // Ensure no SD card cutout
    doc.enclosure.cutouts = doc.enclosure.cutouts.filter((c) => c.type !== "sd-card");
    const result = validate(doc);

    const dataIssues = result.issues.filter((i) => i.code === "MED_NO_DATA_LOGGING");
    assert.ok(dataIssues.length >= 1, "Should warn about missing data logging");
    assert.equal(dataIssues[0].severity, "warning");
  });

  it("all medical checks pass on well-configured medical device", () => {
    const doc = createMedicalDoc();
    const result = validate(doc);

    // Should have no medical errors
    const medicalErrors = result.issues.filter(
      (i) => i.code.startsWith("MED_") && i.severity === "error"
    );
    assert.equal(medicalErrors.length, 0, `Medical errors found: ${medicalErrors.map((e) => e.code).join(", ")}`);

    // The only medical issues should be info notes (EMC) and possibly the
    // power indicator warning (since our LED id is 'power_led' which contains 'power')
    const medicalWarnings = result.issues.filter(
      (i) => i.code.startsWith("MED_") && i.severity === "warning"
    );
    // Well-configured doc may still have display readability note — that is acceptable
    // but should have zero hard warnings for safety-critical items
    const criticalWarnings = medicalWarnings.filter(
      (i) =>
        i.code === "MED_NO_ALARM" ||
        i.code === "MED_NO_BATTERY_BACKUP" ||
        i.code === "MED_LOW_IP_RATING" ||
        i.code === "MED_NO_WATCHDOG" ||
        i.code === "MED_NO_POWER_INDICATOR"
    );
    assert.equal(
      criticalWarnings.length,
      0,
      `Critical medical warnings found: ${criticalWarnings.map((w) => w.code).join(", ")}`
    );

    // Check medical stats are present
    assert.ok(result.stats.medical, "Medical stats should be present");
    assert.equal(result.stats.medical!.medicalClass, "IIa");
    assert.ok(result.stats.medical!.medicalChecks >= 13, "Should run at least 13 medical checks");
    assert.ok(
      result.stats.medical!.estimatedBatteryHours !== undefined && result.stats.medical!.estimatedBatteryHours > 0,
      "Should estimate battery hours for battery-powered device"
    );
  });

  it("PETG + autoclave triggers sterilization error", () => {
    const doc = createMedicalDoc();
    doc.enclosure.material = "petg";
    doc.enclosure.sterilization = "autoclave";
    const result = validate(doc);

    const sterilErrors = result.issues.filter((i) => i.code === "MED_AUTOCLAVE_MATERIAL");
    assert.ok(sterilErrors.length >= 1, "Should flag PETG + autoclave incompatibility");
    assert.equal(sterilErrors[0].severity, "error");
  });

  it("EMC info note is always present for medical devices", () => {
    const doc = createMedicalDoc();
    const result = validate(doc);

    const emcNotes = result.issues.filter((i) => i.code === "MED_EMC_NOTE");
    assert.equal(emcNotes.length, 1, "Should have exactly one EMC info note");
    assert.equal(emcNotes[0].severity, "info");
  });

  it("medical stats include correct battery estimate", () => {
    const doc = createMedicalDoc();
    const result = validate(doc);

    assert.ok(result.stats.medical, "Medical stats should exist");
    // 2000mAh battery, estimated current ~335mA => ~6 hours
    assert.ok(
      result.stats.medical!.estimatedBatteryHours! > 0,
      "Battery hours estimate should be positive"
    );
  });

  it("no watchdog in firmware triggers warning", () => {
    const doc = createMedicalDoc();
    doc.firmware.features = [];
    doc.firmware.buildFlags = [];
    const result = validate(doc);

    const wdIssues = result.issues.filter((i) => i.code === "MED_NO_WATCHDOG");
    assert.ok(wdIssues.length >= 1, "Should warn about missing watchdog");
  });
});
