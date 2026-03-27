#!/usr/bin/env npx tsx

/**
 * MeshCue Node — Built with MeshCue Forge
 *
 * This is the flagship demo: a complete mesh networking node
 * generated entirely from MHDL using the MeshCue Forge pipeline.
 *
 * Run: npx tsx examples/meshcue-node/build.ts
 */

import { describe } from "../../src/tools/describe.js";
import { build } from "../../src/tools/build.js";
import { validate } from "../../src/schema/validate.js";
import type { MHDLDocument } from "../../src/schema/mhdl.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_DIR = join(import.meta.dirname, "output");

// ─── Step 1: Generate base MHDL from description ────────────

console.log("MeshCue Node — Building with MeshCue Forge\n");
console.log("Step 1: Generating MHDL from description...");

const base = describe(
  "ESP32-S3 board with OLED display, 3 status LEDs (green, yellow, red), " +
    "2 buttons for pair and reset, and a buzzer for audio alerts — " +
    "building a mesh networking node called MeshCue Node"
);

// ─── Step 2: Customize the MHDL for MeshCue specifics ───────

console.log("Step 2: Customizing for MeshCue...\n");

const doc: MHDLDocument = {
  ...base,
  meta: {
    ...base.meta,
    name: "MeshCue Node",
    description:
      "Dedicated hardware node for the MeshCue decentralized mesh network. " +
      "Runs 24/7, relays signals, participates in consensus, and displays " +
      "live mesh status. Designed to be 3D printed and assembled at home.",
    version: "1.0.0",
    license: "MIT",
    author: "TinkClaw",
    url: "https://github.com/tinkclaw/meshforge",
    tags: ["mesh", "p2p", "iot", "esp32", "trading-signals"],
  },
  board: {
    ...base.board,
    power: {
      source: "usb",
      voltageIn: 5,
      regulatorOut: 3.3,
      maxCurrentMa: 1000, // USB-C can deliver more
    },
    dimensions: {
      widthMm: 70,
      heightMm: 45,
      depthMm: 25,
    },
    mountingHoles: {
      diameterMm: 3,
      positions: [
        { x: 4, y: 4 },
        { x: 66, y: 4 },
        { x: 4, y: 41 },
        { x: 66, y: 41 },
      ],
    },
  },
  firmware: {
    ...base.firmware,
    features: [
      "wifi-mesh",
      "udp-multicast-discovery",
      "tcp-tls-mesh-protocol",
      "x25519-key-exchange",
      "aes256-gcm-encryption",
      "signal-display",
      "peer-status",
      "ota-updates",
    ],
    libraries: [
      { name: "Adafruit_SSD1306", source: "arduino" },
      { name: "Adafruit_GFX", source: "arduino" },
      { name: "WiFi", source: "arduino" },
      { name: "WiFiClientSecure", source: "arduino" },
      { name: "ArduinoJson", version: "7.0.0", source: "arduino" },
      { name: "Crypto", source: "arduino" },
    ],
  },
  enclosure: {
    ...base.enclosure,
    type: "snap-fit",
    wallThicknessMm: 2.5,
    cornerRadiusMm: 3,
    ventilation: true,
    labelEmboss: "MeshCue",
    material: "petg",
    printOrientation: "upright",
    mounts: "m3-inserts",
  },
  docs: {
    generatePinout: true,
    generateAssembly: true,
    generateBOM: true,
    generatePrintGuide: true,
    readme: true,
  },
};

// Update OLED startup text
const oled = doc.board.components.find((c) => c.id === "oled");
if (oled?.properties) {
  oled.properties["startupText"] = "MeshCue v1.0";
}

// ─── Step 3: Validate ────────────────────────────────────────

console.log("Step 3: Validating...");
const validation = validate(doc);

console.log(`  Valid: ${validation.valid}`);
for (const issue of validation.issues) {
  const icon = issue.severity === "error" ? "✗" : issue.severity === "warning" ? "⚠" : "ℹ";
  console.log(`  ${icon} [${issue.code}] ${issue.message}`);
}
console.log(`  Components: ${validation.stats.componentCount}`);
console.log(`  Connections: ${validation.stats.connectionCount}`);
console.log(`  Est. current: ${validation.stats.estimatedCurrentMa}mA / ${doc.board.power.maxCurrentMa}mA`);
console.log();

if (!validation.valid) {
  console.error("Validation failed — fix errors before building.");
  process.exit(1);
}

// ─── Step 4: Build all artifacts ─────────────────────────────

console.log("Step 4: Building all artifacts...");
const result = build(doc);

if (!result.success) {
  console.error("Build failed.");
  process.exit(1);
}

console.log(`  Build time: ${result.buildTime}ms`);
console.log(`  Artifacts: ${result.artifacts.length}`);
console.log();

// ─── Step 5: Write output files ──────────────────────────────

console.log("Step 5: Writing output files...");
mkdirSync(OUTPUT_DIR, { recursive: true });

// Write MHDL spec
writeFileSync(
  join(OUTPUT_DIR, "meshcue-node.mhdl.json"),
  JSON.stringify(doc, null, 2)
);
console.log(`  ✓ meshcue-node.mhdl.json`);

// Write all artifacts
for (const artifact of result.artifacts) {
  writeFileSync(join(OUTPUT_DIR, artifact.filename), artifact.content);
  console.log(`  ✓ ${artifact.filename} (${artifact.content.length} bytes)`);
}

console.log();
console.log("Done! All files written to examples/meshcue-node/output/");
console.log();
console.log("Next steps:");
console.log("  1. Open diagram.json in Wokwi to simulate the circuit");
console.log("  2. Open main.ino in Arduino IDE or PlatformIO to compile firmware");
console.log("  3. Open enclosure.scad in OpenSCAD to render and export STL");
console.log("  4. Check PRINT_GUIDE.md for 3D print settings");
console.log("  5. Check ASSEMBLY.md for build instructions");
