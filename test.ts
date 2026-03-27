/**
 * MeshCue Forge — End-to-end pipeline test
 */

import { describe } from "./src/tools/describe.js";
import { build } from "./src/tools/build.js";
import { validate } from "./src/schema/validate.js";

console.log("═══ MeshCue Forge Pipeline Test ═══\n");

// Step 1: Describe
console.log("1. Describing hardware...");
const doc = describe(
  "ESP32-S3 board with OLED display, 3 status LEDs (green, yellow, red), " +
    "2 buttons for pair and reset, and a buzzer for audio alerts — " +
    "building a mesh networking node called MeshCue Node"
);
console.log(`   ✓ Generated MHDL: "${doc.meta.name}"`);
console.log(`   MCU: ${doc.board.mcu.family} (${doc.board.mcu.model})`);
console.log(`   Components: ${doc.board.components.length}`);
console.log(`   Connections: ${doc.board.connections.length}`);
console.log();

// Step 2: Validate
console.log("2. Validating...");
const validation = validate(doc);
console.log(`   Valid: ${validation.valid}`);
console.log(`   Issues: ${validation.issues.length}`);
for (const issue of validation.issues) {
  console.log(`   ${issue.severity === "error" ? "✗" : "⚠"} [${issue.code}] ${issue.message}`);
}
console.log(`   Stats:`);
console.log(`     Components: ${validation.stats.componentCount}`);
console.log(`     Connections: ${validation.stats.connectionCount}`);
console.log(`     Pin usage: ${validation.stats.pinUsage}%`);
console.log(`     Est. current: ${validation.stats.estimatedCurrentMa}mA`);
console.log(`     Enclosure volume: ${validation.stats.enclosureVolumeMm3}mm³`);
console.log();

// Step 3: Build
console.log("3. Building all artifacts...");
const result = build(doc);
console.log(`   Success: ${result.success}`);
console.log(`   Build time: ${result.buildTime}ms`);
console.log(`   Artifacts:`);
for (const artifact of result.artifacts) {
  console.log(`     ${artifact.stage.padEnd(10)} → ${artifact.filename} (${artifact.content.length} bytes, ${artifact.format})`);
}
console.log();

// Show MHDL
console.log("4. MHDL Spec (first 40 lines):");
const mhdlJson = JSON.stringify(doc, null, 2).split("\n").slice(0, 40).join("\n");
console.log(mhdlJson);
console.log("   ...\n");

// Show firmware preview
const firmware = result.artifacts.find((a) => a.filename === "main.ino");
if (firmware) {
  console.log("5. Firmware preview (first 30 lines):");
  console.log(firmware.content.split("\n").slice(0, 30).join("\n"));
  console.log("   ...\n");
}

// Show enclosure preview
const enclosure = result.artifacts.find((a) => a.filename === "enclosure.scad");
if (enclosure) {
  console.log("6. Enclosure preview (first 20 lines):");
  console.log(enclosure.content.split("\n").slice(0, 20).join("\n"));
  console.log("   ...\n");
}

console.log("═══ Pipeline test complete ═══");
