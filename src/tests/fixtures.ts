/**
 * Test Fixtures — Reusable MHDL documents for unit tests.
 */

import type { MHDLDocument } from "../schema/mhdl.js";

/**
 * Creates a minimal but complete MHDLDocument for testing.
 * ESP32 with 2 LEDs, 1 button, 1 OLED, proper connections,
 * enclosure config, and all required fields populated.
 */
export function createTestDoc(
  overrides?: Partial<MHDLDocument>,
): MHDLDocument {
  const base: MHDLDocument = {
    meta: {
      schemaVersion: "0.1.0",
      name: "Test Device",
      description: "A test device with LEDs, a button, and an OLED",
      version: "1.0.0",
      author: "Test",
      tags: ["test"],
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
        wireless: ["wifi", "bluetooth"],
        pins: [
          { id: "gpio2", gpio: 2, mode: "digital-out", label: "LED1" },
          { id: "gpio4", gpio: 4, mode: "digital-out", label: "LED2" },
          { id: "gpio5", gpio: 5, mode: "digital-in", label: "BTN" },
          { id: "gpio21", gpio: 21, mode: "i2c-sda", label: "SDA" },
          { id: "gpio22", gpio: 22, mode: "i2c-scl", label: "SCL" },
          { id: "3v3", mode: "power", label: "3V3" },
          { id: "gnd", mode: "ground", label: "GND" },
        ],
      },
      components: [
        {
          id: "led1",
          type: "led",
          pins: [
            { id: "anode", gpio: 2, mode: "digital-out" },
            { id: "cathode", mode: "ground" },
          ],
          properties: { color: "green" },
        },
        {
          id: "led2",
          type: "led",
          pins: [
            { id: "anode", gpio: 4, mode: "digital-out" },
            { id: "cathode", mode: "ground" },
          ],
          properties: { color: "red" },
        },
        {
          id: "btn1",
          type: "button",
          pins: [
            { id: "sig", gpio: 5, mode: "digital-in" },
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
          properties: { i2cAddress: "0x3C", width: 128, height: 64 },
        },
      ],
      connections: [
        { from: "mcu.gpio2", to: "led1.anode", type: "wire" },
        { from: "mcu.gpio4", to: "led2.anode", type: "wire" },
        { from: "mcu.gpio5", to: "btn1.sig", type: "wire" },
        { from: "mcu.gpio21", to: "oled1.sda", type: "wire" },
        { from: "mcu.gpio22", to: "oled1.scl", type: "wire" },
      ],
      power: {
        source: "usb",
        voltageIn: 5,
        regulatorOut: 3.3,
        maxCurrentMa: 500,
      },
      dimensions: {
        widthMm: 60,
        heightMm: 40,
        depthMm: 20,
      },
      mountingHoles: {
        diameterMm: 3,
        positions: [
          { x: 4, y: 4 },
          { x: 56, y: 4 },
          { x: 4, y: 36 },
          { x: 56, y: 36 },
        ],
      },
    },
    firmware: {
      framework: "arduino",
      entrypoint: "main.ino",
      libraries: [
        { name: "Adafruit_SSD1306", version: "2.5.7", source: "arduino" },
        { name: "Adafruit_GFX", source: "arduino" },
      ],
      boardId: "esp32dev",
    },
    enclosure: {
      type: "snap-fit",
      wallThicknessMm: 2,
      cornerRadiusMm: 3,
      cutouts: [
        { type: "usb-c", wall: "back", componentRef: "mcu" },
        { type: "oled-window", wall: "front", componentRef: "oled1" },
        { type: "led-hole", wall: "front", componentRef: "led1", diameter: 5 },
        { type: "led-hole", wall: "front", componentRef: "led2", diameter: 5 },
        { type: "button-cap", wall: "front", componentRef: "btn1" },
      ],
      mounts: "m3-inserts",
      ventilation: true,
      labelEmboss: "Test Device",
      material: "pla",
      printOrientation: "upright",
    },
    pcb: {
      backend: "skidl",
      layers: 2,
      widthMm: 60,
      heightMm: 40,
    },
    docs: {
      generatePinout: true,
      generateAssembly: true,
      generateBOM: true,
      generatePrintGuide: true,
    },
  };

  if (overrides) {
    return { ...base, ...overrides };
  }
  return base;
}

/**
 * Creates an invalid MHDL document with a broken connection reference.
 */
export function createInvalidDoc(): MHDLDocument {
  const doc = createTestDoc();
  // Add a connection referencing a non-existent pin
  doc.board.connections.push({
    from: "mcu.gpio99",
    to: "nonexistent.pin",
    type: "wire",
  });
  return doc;
}

/**
 * Creates a doc with a GPIO pin conflict (two components on same GPIO).
 */
export function createPinConflictDoc(): MHDLDocument {
  const doc = createTestDoc();
  // Add a second component using GPIO 2 (already used by led1)
  doc.board.components.push({
    id: "buzzer1",
    type: "buzzer",
    pins: [
      { id: "sig", gpio: 2, mode: "pwm" },
      { id: "gnd", mode: "ground" },
    ],
  });
  return doc;
}
