/**
 * meshforge-build
 *
 * Takes an MHDL document and generates all build artifacts:
 * circuit, firmware, enclosure, and docs.
 */

import type { MHDLDocument, BuildArtifact, BuildResult } from "../schema/mhdl.js";
import { validate } from "../schema/validate.js";
import { generateWokwiCircuit } from "../backends/circuit/wokwi.js";
import { generateArduinoFirmware } from "../backends/firmware/arduino.js";
import { generateOpenSCADEnclosure } from "../backends/enclosure/openscad.js";

// ─── Stage Types ─────────────────────────────────────────────

export type BuildStage = "circuit" | "firmware" | "enclosure" | "pcb" | "bom" | "docs" | "all";

// ─── Documentation Generator ────────────────────────────────

function generatePinoutDoc(doc: MHDLDocument): BuildArtifact {
  const lines: string[] = [];
  lines.push(`# ${doc.meta.name} — Pinout Reference`);
  lines.push(``);
  lines.push(`| GPIO | Component | Pin | Mode |`);
  lines.push(`|------|-----------|-----|------|`);

  const allComps = [doc.board.mcu, ...doc.board.components];
  for (const comp of allComps) {
    for (const pin of comp.pins) {
      if (pin.gpio !== undefined) {
        lines.push(`| ${pin.gpio} | ${comp.id} | ${pin.id} | ${pin.mode} |`);
      }
    }
  }

  lines.push(``);
  lines.push(`## Connections`);
  lines.push(``);
  lines.push(`| From | To | Type |`);
  lines.push(`|------|----|------|`);

  for (const conn of doc.board.connections) {
    lines.push(`| ${conn.from} | ${conn.to} | ${conn.type || "wire"} |`);
  }

  return {
    stage: "docs",
    filename: "PINOUT.md",
    content: lines.join("\n"),
    format: "markdown",
  };
}

function generateAssemblyDoc(doc: MHDLDocument): BuildArtifact {
  const lines: string[] = [];
  lines.push(`# ${doc.meta.name} — Assembly Instructions`);
  lines.push(``);
  lines.push(`## Components Needed`);
  lines.push(``);

  lines.push(`| # | Component | Type | Notes |`);
  lines.push(`|---|-----------|------|-------|`);
  lines.push(`| 1 | ${doc.board.mcu.model || doc.board.mcu.family} | MCU | Main controller |`);

  doc.board.components.forEach((comp, idx) => {
    const notes = comp.properties?.["color"]
      ? `${comp.properties["color"]}`
      : comp.model || "";
    lines.push(`| ${idx + 2} | ${comp.id} | ${comp.type} | ${notes} |`);
  });

  lines.push(``);
  lines.push(`## Wiring Steps`);
  lines.push(``);

  doc.board.connections.forEach((conn, idx) => {
    lines.push(`${idx + 1}. Connect **${conn.from}** → **${conn.to}**`);
  });

  lines.push(``);
  lines.push(`## Enclosure`);
  lines.push(``);
  lines.push(`- Type: ${doc.enclosure.type}`);
  lines.push(`- Material: ${doc.enclosure.material?.toUpperCase() || "PLA"}`);
  lines.push(`- Wall thickness: ${doc.enclosure.wallThicknessMm}mm`);
  lines.push(`- Print the base first, then the lid`);
  lines.push(`- Use ${doc.enclosure.mounts} for mounting the PCB`);

  if (doc.enclosure.cutouts.length > 0) {
    lines.push(``);
    lines.push(`### Cutouts`);
    for (const cutout of doc.enclosure.cutouts) {
      lines.push(`- **${cutout.type}** on ${cutout.wall} wall${cutout.componentRef ? ` (for ${cutout.componentRef})` : ""}`);
    }
  }

  return {
    stage: "docs",
    filename: "ASSEMBLY.md",
    content: lines.join("\n"),
    format: "markdown",
  };
}

function generatePrintGuide(doc: MHDLDocument): BuildArtifact {
  const enc = doc.enclosure;
  const dims = doc.board.dimensions;
  const wallT = enc.wallThicknessMm;

  const caseW = (dims?.widthMm || 60) + wallT * 2;
  const caseH = (dims?.heightMm || 40) + wallT * 2;
  const caseD = (dims?.depthMm || 20) + wallT * 2;

  const lines: string[] = [];
  lines.push(`# ${doc.meta.name} — 3D Print Guide`);
  lines.push(``);
  lines.push(`## Enclosure Dimensions`);
  lines.push(`- Width: ${caseW}mm`);
  lines.push(`- Height: ${caseH}mm`);
  lines.push(`- Depth: ${caseD}mm`);
  lines.push(`- Wall: ${wallT}mm`);
  lines.push(``);
  lines.push(`## Recommended Print Settings`);
  lines.push(``);
  lines.push(`| Setting | Value |`);
  lines.push(`|---------|-------|`);
  lines.push(`| Material | ${enc.material?.toUpperCase() || "PLA"} |`);
  lines.push(`| Nozzle | 0.4mm |`);
  lines.push(`| Layer Height | 0.2mm |`);
  lines.push(`| Infill | 20% |`);
  lines.push(`| Perimeters | 3 |`);
  lines.push(`| Top/Bottom layers | 4 |`);
  lines.push(`| Supports | ${enc.type === "snap-fit" ? "Yes (for snap clips)" : "No"} |`);
  lines.push(`| Orientation | ${enc.printOrientation || "upright"} |`);
  lines.push(`| Estimated time | ~${Math.round((caseW * caseH * caseD) / 50000 * 45)}min per piece |`);
  lines.push(`| Estimated filament | ~${Math.round((caseW * caseH * caseD) / 50000 * 15)}g per piece |`);
  lines.push(``);
  lines.push(`## Print Order`);
  lines.push(`1. Print **base** (enclosure.scad with \`base()\` uncommented)`);
  lines.push(`2. Print **lid** (uncomment \`lid()\`, comment out \`base()\`)`);
  lines.push(`3. Insert M3 threaded inserts into mounting posts (soldering iron, 220°C)`);
  lines.push(`4. Mount PCB onto posts with M3x6mm screws`);
  lines.push(`5. Snap/screw lid onto base`);
  lines.push(``);
  lines.push(`## Post-Processing`);
  lines.push(`- Sand mating surfaces lightly if snap-fit is too tight`);
  lines.push(`- Adjust \`tolerance\` parameter in .scad file (default 0.3mm)`);

  return {
    stage: "docs",
    filename: "PRINT_GUIDE.md",
    content: lines.join("\n"),
    format: "markdown",
  };
}

function generateBOM(doc: MHDLDocument): BuildArtifact {
  const lines: string[] = [];
  lines.push(`Component,Type,Model,Quantity,Notes`);
  lines.push(`${doc.board.mcu.model || doc.board.mcu.family},MCU,${doc.board.mcu.family},1,Main controller`);

  for (const comp of doc.board.components) {
    const notes = comp.properties?.["color"] ? String(comp.properties["color"]) : "";
    lines.push(`${comp.id},${comp.type},${comp.model || ""},1,${notes}`);
  }

  // Add hardware
  if (doc.board.mountingHoles) {
    const count = doc.board.mountingHoles.positions.length;
    lines.push(`M3 threaded insert,hardware,,${count},For mounting`);
    lines.push(`M3x6mm screw,hardware,,${count},For mounting`);
  }

  return {
    stage: "bom",
    filename: "bom.csv",
    content: lines.join("\n"),
    format: "csv",
  };
}

// ─── Main Build Function ─────────────────────────────────────

export function build(
  doc: MHDLDocument,
  stages: BuildStage[] = ["all"]
): BuildResult {
  const startTime = Date.now();
  const artifacts: BuildArtifact[] = [];

  // Always validate first
  const validation = validate(doc);

  // If there are errors, return early
  if (!validation.valid) {
    return {
      success: false,
      artifacts: [],
      validation,
      buildTime: Date.now() - startTime,
    };
  }

  const buildAll = stages.includes("all");

  // Circuit
  if (buildAll || stages.includes("circuit")) {
    artifacts.push(generateWokwiCircuit(doc));
  }

  // Firmware
  if (buildAll || stages.includes("firmware")) {
    artifacts.push(...generateArduinoFirmware(doc));
  }

  // Enclosure
  if (buildAll || stages.includes("enclosure")) {
    artifacts.push(...generateOpenSCADEnclosure(doc));
  }

  // BOM
  if (buildAll || stages.includes("bom")) {
    artifacts.push(generateBOM(doc));
  }

  // Docs
  if (buildAll || stages.includes("docs")) {
    if (doc.docs?.generatePinout) artifacts.push(generatePinoutDoc(doc));
    if (doc.docs?.generateAssembly) artifacts.push(generateAssemblyDoc(doc));
    if (doc.docs?.generatePrintGuide) artifacts.push(generatePrintGuide(doc));
  }

  return {
    success: true,
    artifacts,
    validation,
    buildTime: Date.now() - startTime,
  };
}
