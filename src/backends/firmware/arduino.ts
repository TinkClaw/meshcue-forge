/**
 * Arduino Firmware Backend
 *
 * Converts MHDL board + firmware spec → compilable Arduino sketch
 * with proper pin definitions, library includes, and setup/loop.
 */

import type { MHDLDocument, BuildArtifact, Component, Pin } from "../../schema/mhdl.js";

// ─── Code Generation Helpers ─────────────────────────────────

function pinDefine(comp: Component, pin: Pin): string {
  const name = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;
  return `#define ${name} ${pin.gpio}`;
}

function libraryInclude(lib: string): string {
  return `#include <${lib}>`;
}

// ─── Component-specific code generators ──────────────────────

interface CodeBlock {
  includes: string[];
  globals: string[];
  setup: string[];
  loop: string[];
  functions: string[];
}

function generateLEDCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-out");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;
  const color = comp.properties?.["color"] || "unknown";

  return {
    includes: [],
    globals: [],
    setup: [
      `  pinMode(${pinName}, OUTPUT); // ${comp.id} (${color} LED)`,
    ],
    loop: [],
    functions: [
      `void set_${comp.id}(bool on) {\n  digitalWrite(${pinName}, on ? HIGH : LOW);\n}`,
    ],
  };
}

function generateButtonCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-in");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;

  return {
    includes: [],
    globals: [
      `bool ${comp.id}_pressed = false;`,
      `bool ${comp.id}_last = false;`,
      `unsigned long ${comp.id}_debounce = 0;`,
    ],
    setup: [
      `  pinMode(${pinName}, INPUT_PULLUP); // ${comp.id}`,
    ],
    loop: [
      `  // ${comp.id} debounce`,
      `  bool ${comp.id}_read = !digitalRead(${pinName});`,
      `  if (${comp.id}_read != ${comp.id}_last) ${comp.id}_debounce = millis();`,
      `  if (millis() - ${comp.id}_debounce > 50) ${comp.id}_pressed = ${comp.id}_read;`,
      `  ${comp.id}_last = ${comp.id}_read;`,
    ],
    functions: [],
  };
}

function generateOLEDCode(comp: Component): CodeBlock {
  const sdaPin = comp.pins.find((p) => p.mode === "i2c-sda");
  const sclPin = comp.pins.find((p) => p.mode === "i2c-scl");
  const addr = comp.properties?.["i2cAddress"] || "0x3C";
  const width = comp.properties?.["width"] || 128;
  const height = comp.properties?.["height"] || 64;

  return {
    includes: [
      "Wire.h",
      "Adafruit_GFX.h",
      "Adafruit_SSD1306.h",
    ],
    globals: [
      `#define SCREEN_WIDTH ${width}`,
      `#define SCREEN_HEIGHT ${height}`,
      `Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);`,
    ],
    setup: [
      ...(sdaPin?.gpio !== undefined && sclPin?.gpio !== undefined
        ? [`  Wire.begin(${sdaPin.gpio}, ${sclPin.gpio});`]
        : [`  Wire.begin();`]),
      `  if (!display.begin(SSD1306_SWITCHCAPVCC, ${addr})) {`,
      `    Serial.println(F("SSD1306 allocation failed"));`,
      `    for (;;);`,
      `  }`,
      `  display.clearDisplay();`,
      `  display.setTextSize(1);`,
      `  display.setTextColor(SSD1306_WHITE);`,
      `  display.setCursor(0, 0);`,
      `  display.println(F("${comp.properties?.["startupText"] || "MeshCue Forge"}"));`,
      `  display.display();`,
    ],
    loop: [],
    functions: [
      `void display_text(const char* line1, const char* line2) {`,
      `  display.clearDisplay();`,
      `  display.setCursor(0, 0);`,
      `  display.setTextSize(1);`,
      `  display.println(line1);`,
      `  display.setCursor(0, 16);`,
      `  display.println(line2);`,
      `  display.display();`,
      `}`,
    ],
  };
}

function generateBuzzerCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "pwm" || p.mode === "digital-out");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;

  return {
    includes: [],
    globals: [],
    setup: [
      `  pinMode(${pinName}, OUTPUT); // ${comp.id} (buzzer)`,
    ],
    loop: [],
    functions: [
      `void beep(unsigned int frequency, unsigned long duration) {`,
      `  tone(${pinName}, frequency, duration);`,
      `}`,
      ``,
      `void beep_success() { beep(1000, 100); delay(50); beep(1500, 100); }`,
      `void beep_error() { beep(400, 300); }`,
      `void beep_alert() { beep(2000, 50); delay(50); beep(2000, 50); delay(50); beep(2000, 50); }`,
    ],
  };
}

function generateSensorCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-in" || p.mode === "analog-in");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;
  const model = (comp.model || "dht22").toLowerCase();

  if (model.includes("dht")) {
    return {
      includes: ["DHT.h"],
      globals: [
        `DHT ${comp.id}_sensor(${pinName}, DHT22);`,
        `float ${comp.id}_temp = 0;`,
        `float ${comp.id}_hum = 0;`,
      ],
      setup: [
        `  ${comp.id}_sensor.begin(); // ${comp.id}`,
      ],
      loop: [
        `  ${comp.id}_temp = ${comp.id}_sensor.readTemperature();`,
        `  ${comp.id}_hum = ${comp.id}_sensor.readHumidity();`,
      ],
      functions: [],
    };
  }

  return {
    includes: [],
    globals: [`int ${comp.id}_value = 0;`],
    setup: [`  pinMode(${pinName}, INPUT); // ${comp.id}`],
    loop: [`  ${comp.id}_value = analogRead(${pinName});`],
    functions: [],
  };
}

// ─── Generator Map ───────────────────────────────────────────

const GENERATORS: Record<string, (comp: Component) => CodeBlock> = {
  led: generateLEDCode,
  button: generateButtonCode,
  oled: generateOLEDCode,
  buzzer: generateBuzzerCode,
  sensor: generateSensorCode,
};

// ─── Main Generator ──────────────────────────────────────────

export function generateArduinoFirmware(doc: MHDLDocument): BuildArtifact[] {
  const artifacts: BuildArtifact[] = [];

  // Collect code blocks from all components
  const blocks: CodeBlock[] = [];
  for (const comp of doc.board.components) {
    const gen = GENERATORS[comp.type];
    if (gen) {
      blocks.push(gen(comp));
    }
  }

  // Merge all includes
  const allIncludes = new Set<string>();
  allIncludes.add("Arduino.h");
  for (const block of blocks) {
    for (const inc of block.includes) {
      allIncludes.add(inc);
    }
  }

  // Build the sketch
  const lines: string[] = [];

  // Header
  lines.push(`/**`);
  lines.push(` * ${doc.meta.name} — Firmware`);
  lines.push(` * ${doc.meta.description}`);
  lines.push(` * Generated by MeshCue Forge v${doc.meta.schemaVersion}`);
  lines.push(` */`);
  lines.push(``);

  // Includes
  for (const inc of allIncludes) {
    lines.push(libraryInclude(inc));
  }
  lines.push(``);

  // Pin definitions
  lines.push(`// ─── Pin Definitions ───────────────────────────`);
  const allComponents = [doc.board.mcu, ...doc.board.components];
  for (const comp of allComponents) {
    for (const pin of comp.pins) {
      if (pin.gpio !== undefined) {
        lines.push(pinDefine(comp, pin));
      }
    }
  }
  lines.push(``);

  // Globals
  lines.push(`// ─── Globals ──────────────────────────────────`);
  lines.push(`unsigned long lastUpdate = 0;`);
  lines.push(`const unsigned long UPDATE_INTERVAL = 1000;`);
  for (const block of blocks) {
    for (const g of block.globals) {
      lines.push(g);
    }
  }
  lines.push(``);

  // Setup
  lines.push(`void setup() {`);
  lines.push(`  Serial.begin(115200);`);
  lines.push(`  Serial.println(F("${doc.meta.name} starting..."));`);
  lines.push(``);
  for (const block of blocks) {
    for (const s of block.setup) {
      lines.push(s);
    }
    if (block.setup.length > 0) lines.push(``);
  }
  lines.push(`  Serial.println(F("Ready."));`);
  lines.push(`}`);
  lines.push(``);

  // Loop
  lines.push(`void loop() {`);
  for (const block of blocks) {
    for (const l of block.loop) {
      lines.push(l);
    }
  }
  lines.push(``);
  lines.push(`  // Periodic update`);
  lines.push(`  if (millis() - lastUpdate >= UPDATE_INTERVAL) {`);
  lines.push(`    lastUpdate = millis();`);
  lines.push(`    // TODO: Add your periodic logic here`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  delay(10);`);
  lines.push(`}`);
  lines.push(``);

  // Helper functions
  lines.push(`// ─── Functions ────────────────────────────────`);
  for (const block of blocks) {
    for (const f of block.functions) {
      lines.push(f);
    }
    if (block.functions.length > 0) lines.push(``);
  }

  artifacts.push({
    stage: "firmware",
    filename: doc.firmware.entrypoint,
    content: lines.join("\n"),
    format: "arduino",
  });

  // Generate platformio.ini if using platformio
  if (doc.firmware.framework === "arduino" || doc.firmware.framework === "platformio") {
    const boardMap: Record<string, string> = {
      "esp32": "esp32dev",
      "esp32-s3": "esp32-s3-devkitc-1",
      "esp32-c3": "esp32-c3-devkitm-1",
      "arduino-uno": "uno",
      "arduino-nano": "nanoatmega328",
      "arduino-mega": "megaatmega2560",
      "rp2040": "pico",
    };

    const iniLines: string[] = [
      `; ${doc.meta.name} — PlatformIO Configuration`,
      `; Generated by MeshCue Forge`,
      ``,
      `[env:default]`,
      `platform = ${doc.board.mcu.family.startsWith("esp32") ? "espressif32" : doc.board.mcu.family.startsWith("arduino") ? "atmelavr" : "raspberrypi"}`,
      `board = ${doc.firmware.boardId || boardMap[doc.board.mcu.family] || "esp32dev"}`,
      `framework = arduino`,
      `monitor_speed = 115200`,
    ];

    if (doc.firmware.libraries.length > 0) {
      iniLines.push(`lib_deps =`);
      for (const lib of doc.firmware.libraries) {
        iniLines.push(`  ${lib.name}${lib.version ? `@${lib.version}` : ""}`);
      }
    }

    if (doc.firmware.buildFlags && doc.firmware.buildFlags.length > 0) {
      iniLines.push(`build_flags =`);
      for (const flag of doc.firmware.buildFlags) {
        iniLines.push(`  ${flag}`);
      }
    }

    artifacts.push({
      stage: "firmware",
      filename: "platformio.ini",
      content: iniLines.join("\n"),
      format: "ini",
    });
  }

  return artifacts;
}
