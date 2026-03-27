/**
 * meshforge-build
 *
 * Takes an MHDL document and generates all build artifacts:
 * circuit, firmware, enclosure, PCB, visualization, BOM, and docs.
 *
 * Uses the backend registry to select the best available backend
 * for each stage based on user preferences and detected capabilities.
 */

import type {
  MHDLDocument,
  BuildArtifact,
  BuildResult,
  BuildStageType,
  FailedStage,
  ForgeConfig,
  EnclosureBackend,
  PCBBackend,
  VisualizationBackend,
} from "../schema/mhdl.js";
import { validate } from "../schema/validate.js";
import { loadConfig, detectCapabilities, type BackendRegistry } from "../config.js";

// Circuit + Firmware (always available)
import { generateWokwiCircuit } from "../backends/circuit/wokwi.js";
import { generateArduinoFirmware } from "../backends/firmware/arduino.js";
import { generateMicroPythonFirmware } from "../backends/firmware/micropython.js";

// Enclosure backends
import { generateOpenSCADEnclosure } from "../backends/enclosure/openscad.js";
import { generateCadQueryEnclosure } from "../backends/enclosure/cadquery.js";
import { generateZooCadEnclosure } from "../backends/enclosure/zoo-cad.js";
import { generateLlamaMeshEnclosure } from "../backends/enclosure/llama-mesh.js";

// PCB backends
import { generateSKiDLScript } from "../backends/pcb/skidl.js";
import { generateKiCadPCB } from "../backends/pcb/kicad.js";

// Visualization backends
import { generateHunyuan3DModel } from "../backends/visualization/hunyuan3d.js";
import { generateCosmosVideo } from "../backends/visualization/cosmos.js";

// Medical regulatory docs
import {
  generateWHOChecklist,
  generateIEC62304Doc,
  generateFMEATemplate,
  generateCEGuidance,
  generateBatteryLifeEstimate,
} from "../backends/docs/medical.js";

// ─── Stage Types ─────────────────────────────────────────────

export type BuildStage =
  | "circuit"
  | "firmware"
  | "enclosure"
  | "pcb"
  | "bom"
  | "docs"
  | "visualization"
  | "all";

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

  // ── Medical Device Print Considerations ──────────
  if (doc.meta.medical) {
    lines.push(``);
    lines.push(`## Medical Device Print Considerations`);
    lines.push(``);
    lines.push(`> This enclosure is flagged as a medical device${doc.meta.deviceClass ? " (Class " + doc.meta.deviceClass + ")" : ""}.`);
    lines.push(`> Follow all applicable regulatory requirements for your jurisdiction.`);
    if (doc.meta.intendedUse) {
      lines.push(`> Intended use: ${doc.meta.intendedUse}`);
    }
    lines.push(``);

    // Material selection based on sterilization
    lines.push(`### Material Selection`);
    lines.push(``);
    if (enc.sterilization === "autoclave") {
      lines.push(`- **Sterilization method: Autoclave (134°C)**`);
      lines.push(`  - Use **PEEK**, **PP (polypropylene)**, or **Nylon** only`);
      lines.push(`  - PLA and PETG will deform at autoclave temperatures`);
      lines.push(`  - ABS may warp; not recommended for repeated autoclaving`);
    } else if (enc.sterilization === "chemical") {
      lines.push(`- **Sterilization method: Chemical (IPA / quaternary ammonium)**`);
      lines.push(`  - **PETG** or **PP** recommended — good chemical resistance`);
      lines.push(`  - PLA may degrade with repeated chemical exposure`);
      lines.push(`  - ABS is acceptable but may yellow over time`);
    } else if (enc.sterilization === "uv") {
      lines.push(`- **Sterilization method: UV-C**`);
      lines.push(`  - Most materials acceptable`);
      lines.push(`  - **PETG** or **PC (polycarbonate)** recommended for UV stability`);
      lines.push(`  - Ensure UV-C can reach all surfaces — consider adding a UV indicator window`);
    } else {
      lines.push(`- No sterilization method specified`);
      lines.push(`  - **PETG** recommended as a general-purpose medical-grade material`);
    }

    if (enc.biocompatible) {
      lines.push(`- **Biocompatible (patient contact)**: Use **PETG**, **PP**, or **medical-grade silicone**`);
      if (enc.material === "pla") {
        lines.push(`  - WARNING: Current material (PLA) is NOT biocompatible for patient contact`);
      }
    }
    lines.push(``);

    // Print parameters for medical
    lines.push(`### Print Parameters (Medical)`);
    lines.push(``);
    lines.push(`| Setting | Value | Reason |`);
    lines.push(`|---------|-------|--------|`);
    lines.push(`| Layer Height | **0.1mm** | Smooth surfaces for patient contact & easier cleaning |`);
    lines.push(`| Infill | **100%** | Structural integrity required for medical devices |`);
    lines.push(`| Perimeters | 4+ | Maximize shell strength |`);
    lines.push(`| Top/Bottom layers | 6+ | Fully sealed top and bottom |`);
    lines.push(``);

    // Post-processing for medical
    lines.push(`### Post-Processing (Medical)`);
    lines.push(``);
    lines.push(`- Sand ALL external surfaces to **400 grit minimum** for smooth finish`);
    lines.push(`- Remove all layer lines from patient-contact surfaces`);
    lines.push(`- Inspect for gaps, voids, or incomplete layers — reject if found`);
    lines.push(`- Consider vapor smoothing (ABS) or annealing (PETG) for improved surface quality`);
    lines.push(``);

    // IP rating section
    if (enc.ipRating) {
      const grooveDepth = enc.gasketGrooveMm || 1.2;
      lines.push(`### IP Rating: ${enc.ipRating}`);
      lines.push(``);

      const ipNum = parseInt(enc.ipRating.replace("IP", ""), 10);
      if (ipNum >= 54) {
        lines.push(`- **Gasket/O-ring required** for ${enc.ipRating} sealing`);
        lines.push(`  - Groove width: 1.5mm`);
        lines.push(`  - Groove depth: ${grooveDepth}mm`);
        lines.push(`  - Use **2mm silicone O-ring** (durometer 40A-50A)`);
        lines.push(`  - O-ring inner perimeter should match groove path length`);
      }
      if (ipNum >= 65) {
        lines.push(`- Ensure all cable entries use **waterproof cable glands** (PG7/PG9/PG11)`);
        lines.push(`- Test with water spray / submersion per IEC 60529 requirements`);
      }
      if (enc.cableGland) {
        let pgSize = "PG7";
        if (enc.cableGland.diameterMm > 12) pgSize = "PG11";
        else if (enc.cableGland.diameterMm > 7) pgSize = "PG9";
        lines.push(`- Cable glands: ${enc.cableGland.count}x ${pgSize} (${enc.cableGland.diameterMm}mm diameter)`);
      }
      lines.push(``);
    }
  }

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

// ─── Backend Selection ──────────────────────────────────────

function selectEnclosureBackend(
  doc: MHDLDocument,
  config: ForgeConfig,
  registry: BackendRegistry,
): EnclosureBackend {
  // Explicit choice in MHDL or config
  const preferred = doc.enclosure.backend || config.defaultEnclosureBackend || "openscad";
  if (registry.enclosure[preferred]?.available) return preferred;

  // Fallback chain: cadquery → openscad (always available)
  if (registry.enclosure.cadquery.available) return "cadquery";
  return "openscad";
}

function selectPCBBackend(
  doc: MHDLDocument,
  config: ForgeConfig,
  registry: BackendRegistry,
): PCBBackend {
  const preferred = doc.pcb?.backend || config.defaultPCBBackend || "skidl";
  if (registry.pcb[preferred]?.available) return preferred;
  return "skidl"; // always available (script generation)
}

function selectVizBackend(
  doc: MHDLDocument,
  config: ForgeConfig,
  _registry: BackendRegistry,
): VisualizationBackend {
  // All visualization backends are always available (they produce offline
  // placeholders when endpoints aren't configured), so just use the preferred one.
  return doc.visualization?.backend || config.defaultVisualizationBackend || "hunyuan3d";
}

// ─── Enclosure Dispatch ─────────────────────────────────────

async function buildEnclosure(
  doc: MHDLDocument,
  backend: EnclosureBackend,
  config: ForgeConfig,
): Promise<BuildArtifact[]> {
  switch (backend) {
    case "cadquery":
      return generateCadQueryEnclosure(doc);
    case "zoo-cad":
      return generateZooCadEnclosure(doc, config);
    case "llama-mesh":
      return generateLlamaMeshEnclosure(doc, config);
    case "openscad":
    default:
      return generateOpenSCADEnclosure(doc);
  }
}

// ─── PCB Dispatch ───────────────────────────────────────────

async function buildPCB(
  doc: MHDLDocument,
  backend: PCBBackend,
  config: ForgeConfig,
): Promise<BuildArtifact[]> {
  switch (backend) {
    case "kicad":
      return generateKiCadPCB(doc, config);
    case "skidl":
    default:
      return generateSKiDLScript(doc);
  }
}

// ─── Visualization Dispatch ─────────────────────────────────

async function buildVisualization(
  doc: MHDLDocument,
  backend: VisualizationBackend,
  config: ForgeConfig,
): Promise<BuildArtifact[]> {
  switch (backend) {
    case "cosmos":
      return generateCosmosVideo(doc, config);
    case "llama-mesh":
      return generateLlamaMeshEnclosure(doc, config);
    case "hunyuan3d":
    default:
      return generateHunyuan3DModel(doc, config);
  }
}

// ─── Progress Callback ──────────────────────────────────────

export interface BuildProgress {
  stage: BuildStageType | "validate";
  status: "starting" | "done" | "error";
  backend?: string;
  durationMs?: number;
  error?: string;
}

export type ProgressCallback = (progress: BuildProgress) => void;

// ─── Main Build Function ─────────────────────────────────────

export async function build(
  doc: MHDLDocument,
  stages: BuildStage[] = ["all"],
  configOverride?: ForgeConfig,
  onProgress?: ProgressCallback,
): Promise<BuildResult> {
  const startTime = Date.now();
  const artifacts: BuildArtifact[] = [];
  const failedStages: FailedStage[] = [];
  const emit = onProgress ?? (() => {});

  // Load config and detect capabilities
  const config = configOverride ?? loadConfig();
  const registry = await detectCapabilities(config);

  // Always validate first
  emit({ stage: "validate", status: "starting" });
  const vStart = Date.now();
  const validation = validate(doc);
  emit({ stage: "validate", status: "done", durationMs: Date.now() - vStart });

  if (!validation.valid) {
    return {
      success: false,
      artifacts: [],
      validation,
      buildTime: Date.now() - startTime,
      failedStages: [],
    };
  }

  const buildAll = stages.includes("all");

  // Circuit (Wokwi — always available)
  if (buildAll || stages.includes("circuit")) {
    emit({ stage: "circuit", status: "starting", backend: "wokwi" });
    const t = Date.now();
    artifacts.push(generateWokwiCircuit(doc));
    emit({ stage: "circuit", status: "done", backend: "wokwi", durationMs: Date.now() - t });
  }

  // Firmware (Arduino or MicroPython)
  if (buildAll || stages.includes("firmware")) {
    const fwBackend = doc.firmware.framework === "micropython" ? "micropython" : "arduino";
    emit({ stage: "firmware", status: "starting", backend: fwBackend });
    const t = Date.now();
    if (fwBackend === "micropython") {
      artifacts.push(...generateMicroPythonFirmware(doc));
    } else {
      artifacts.push(...generateArduinoFirmware(doc));
    }
    emit({ stage: "firmware", status: "done", backend: fwBackend, durationMs: Date.now() - t });
  }

  // Enclosure (multi-backend)
  if (buildAll || stages.includes("enclosure")) {
    const backend = selectEnclosureBackend(doc, config, registry);
    emit({ stage: "enclosure", status: "starting", backend });
    const t = Date.now();
    try {
      artifacts.push(...await buildEnclosure(doc, backend, config));
      emit({ stage: "enclosure", status: "done", backend, durationMs: Date.now() - t });
    } catch (err) {
      failedStages.push({ stage: "enclosure", error: String(err) });
      emit({ stage: "enclosure", status: "error", backend, error: String(err) });
    }
  }

  // PCB (multi-backend)
  if (buildAll || stages.includes("pcb")) {
    const backend = selectPCBBackend(doc, config, registry);
    emit({ stage: "pcb", status: "starting", backend });
    const t = Date.now();
    try {
      artifacts.push(...await buildPCB(doc, backend, config));
      emit({ stage: "pcb", status: "done", backend, durationMs: Date.now() - t });
    } catch (err) {
      failedStages.push({ stage: "pcb", error: String(err) });
      emit({ stage: "pcb", status: "error", backend, error: String(err) });
    }
  }

  // Visualization (multi-backend)
  if (
    stages.includes("visualization") ||
    (buildAll && (doc.visualization?.generate3DModel || doc.visualization?.generateVideo))
  ) {
    const backend = selectVizBackend(doc, config, registry);
    emit({ stage: "visualization", status: "starting", backend });
    const t = Date.now();
    try {
      artifacts.push(...await buildVisualization(doc, backend, config));
      emit({ stage: "visualization", status: "done", backend, durationMs: Date.now() - t });
    } catch (err) {
      failedStages.push({ stage: "visualization", error: String(err) });
      emit({ stage: "visualization", status: "error", backend, error: String(err) });
    }
  }

  // BOM
  if (buildAll || stages.includes("bom")) {
    emit({ stage: "bom", status: "starting" });
    const t = Date.now();
    artifacts.push(generateBOM(doc));
    emit({ stage: "bom", status: "done", durationMs: Date.now() - t });
  }

  // Docs
  if (buildAll || stages.includes("docs")) {
    emit({ stage: "docs", status: "starting" });
    const t = Date.now();
    if (doc.docs?.generatePinout) artifacts.push(generatePinoutDoc(doc));
    if (doc.docs?.generateAssembly) artifacts.push(generateAssemblyDoc(doc));
    if (doc.docs?.generatePrintGuide) artifacts.push(generatePrintGuide(doc));

    // Medical regulatory docs — auto-generate when meta.medical is true
    if (doc.meta?.medical || doc.docs?.generateMedicalDocs) {
      artifacts.push(generateWHOChecklist(doc));
      artifacts.push(generateIEC62304Doc(doc));
      artifacts.push(generateFMEATemplate(doc));
      artifacts.push(generateCEGuidance(doc));
      artifacts.push(generateBatteryLifeEstimate(doc));
    }

    emit({ stage: "docs", status: "done", durationMs: Date.now() - t });
  }

  return {
    success: failedStages.length === 0,
    artifacts,
    validation,
    buildTime: Date.now() - startTime,
    failedStages,
  };
}
