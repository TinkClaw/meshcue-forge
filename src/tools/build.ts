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
  generateFieldTestChecklist,
} from "../backends/docs/medical.js";

// i18n
import { t as getStrings, type MedicalLanguage } from "../i18n/medical.js";

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

function generatePinoutDoc(doc: MHDLDocument, lang?: MedicalLanguage): BuildArtifact {
  const s = getStrings(lang);
  const lines: string[] = [];
  lines.push(`# ${doc.meta.name} — ${s.pinoutTitle}`);
  lines.push(``);
  lines.push(`| ${s.gpio} | ${s.component} | ${s.pin} | ${s.mode} |`);
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
  lines.push(`## ${s.connections}`);
  lines.push(``);
  lines.push(`| ${s.from} | ${s.to} | ${s.type} |`);
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

function generateAssemblyDoc(doc: MHDLDocument, lang?: MedicalLanguage): BuildArtifact {
  const s = getStrings(lang);
  const lines: string[] = [];

  // Medical device disclaimer
  if (doc.meta?.medical) {
    lines.push(`> **${s.warning}:** ${s.disclaimer}`);
    lines.push(``);
  }

  lines.push(`# ${doc.meta.name} — ${s.assemblyTitle}`);
  lines.push(``);
  lines.push(`## ${s.componentsNeeded}`);
  lines.push(``);

  lines.push(`| # | ${s.component} | ${s.type} | ${s.notes} |`);
  lines.push(`|---|-----------|------|-------|`);
  lines.push(`| 1 | ${doc.board.mcu.model || doc.board.mcu.family} | MCU | ${s.mainController} |`);

  doc.board.components.forEach((comp, idx) => {
    const notes = comp.properties?.["color"]
      ? `${comp.properties["color"]}`
      : comp.model || "";
    lines.push(`| ${idx + 2} | ${comp.id} | ${comp.type} | ${notes} |`);
  });

  lines.push(``);
  lines.push(`## ${s.wiringSteps}`);
  lines.push(``);

  doc.board.connections.forEach((conn, idx) => {
    lines.push(`${idx + 1}. ${s.step} ${idx + 1}: **${conn.from}** → **${conn.to}**`);
  });

  lines.push(``);
  lines.push(`## ${s.enclosure}`);
  lines.push(``);
  lines.push(`- ${s.type}: ${doc.enclosure.type}`);
  lines.push(`- ${s.material}: ${doc.enclosure.material?.toUpperCase() || "PLA"}`);
  lines.push(`- Wall thickness: ${doc.enclosure.wallThicknessMm}mm`);
  lines.push(`- ${doc.enclosure.mounts}`);

  if (doc.enclosure.cutouts.length > 0) {
    lines.push(``);
    for (const cutout of doc.enclosure.cutouts) {
      lines.push(`- **${cutout.type}** — ${cutout.wall}${cutout.componentRef ? ` (${cutout.componentRef})` : ""}`);
    }
  }

  // ── Medical Calibration Procedure ──────────────────────────
  if (doc.meta?.medical) {
    const medCalibTypes = new Set(
      doc.board.components
        .map((c) => c.type)
        .filter((ct) =>
          ["pulse_oximeter", "ecg", "temperature_sensor", "blood_pressure", "load_cell", "color_sensor"].includes(ct),
        ),
    );

    if (medCalibTypes.size > 0) {
      lines.push(``);
      lines.push(`## Calibration Procedure`);
      lines.push(``);
      lines.push(`> **Important:** Medical sensors must be calibrated before clinical use.`);
      lines.push(`> Calibration should be repeated **monthly** for clinical applications,`);
      lines.push(`> or whenever the device is serviced, dropped, or relocated.`);
      lines.push(``);
      lines.push(`### Entering Calibration Mode`);
      lines.push(``);
      lines.push(`1. Power on the device and wait for the "Ready" message`);
      lines.push(`2. **Hold the primary button for 5 seconds** until the display shows "CALIBRATION Starting..."`);
      lines.push(`3. The device will guide you through each sensor calibration step via the OLED display`);
      lines.push(`4. Follow the on-screen prompts for each sensor`);
      lines.push(`5. Calibration data is stored in EEPROM and persists across power cycles`);
      lines.push(``);

      if (medCalibTypes.has("pulse_oximeter")) {
        lines.push(`### SpO2 / Pulse Oximeter (MAX30102)`);
        lines.push(``);
        lines.push(`**Required reference equipment:** Commercial FDA-cleared pulse oximeter`);
        lines.push(``);
        lines.push(`1. Place your finger on both the reference pulse oximeter and the device sensor simultaneously`);
        lines.push(`2. Note the SpO2 reading from the commercial device`);
        lines.push(`3. When prompted, the device will read raw IR/Red values for **30 seconds**`);
        lines.push(`4. The calibration offset is computed from the difference between the reference and measured SpO2`);
        lines.push(`5. Stored coefficients: SpO2 lookup table offset and gain factor`);
        lines.push(``);
      }

      if (medCalibTypes.has("ecg")) {
        lines.push(`### ECG (AD8232)`);
        lines.push(``);
        lines.push(`**Required reference equipment:** 1mV calibration signal generator (optional), commercial ECG for baseline comparison`);
        lines.push(``);
        lines.push(`1. **Baseline calibration:** Remain still with electrodes attached for 10 seconds`);
        lines.push(`2. The device records the resting baseline ADC value`);
        lines.push(`3. **Gain calibration (optional):** Apply a known 1mV signal to the input`);
        lines.push(`4. The device measures the ADC response and computes the gain factor`);
        lines.push(`5. If no calibration signal is detected, gain defaults to 1.0`);
        lines.push(`6. Stored coefficients: gain factor and baseline offset`);
        lines.push(``);
      }

      if (medCalibTypes.has("temperature_sensor")) {
        lines.push(`### Temperature Sensor (DS18B20 / DHT22 / MLX90614)`);
        lines.push(``);
        lines.push(`**Required reference equipment:** Ice-water bath, mercury/digital reference thermometer`);
        lines.push(``);
        lines.push(`1. **Ice-point calibration:** Submerge or place the sensor in an ice-water bath (0.0C)`);
        lines.push(`2. Wait for the prompt, then the device reads for 10 seconds`);
        lines.push(`3. **Body-temperature calibration:** Place the sensor at a known temperature (e.g., 37.0C from a reference thermometer)`);
        lines.push(`4. The device reads for 10 seconds`);
        lines.push(`5. Two-point linear correction is computed: \`corrected = raw * gain + offset\``);
        lines.push(`6. Stored coefficients: gain and offset`);
        lines.push(``);
      }

      if (medCalibTypes.has("blood_pressure")) {
        lines.push(`### Blood Pressure Sensor`);
        lines.push(``);
        lines.push(`**Required reference equipment:** Mercury sphygmomanometer (for reference calibration)`);
        lines.push(``);
        lines.push(`1. **Zero-point calibration:** Ensure the cuff is fully deflated and sensor is open to atmospheric pressure`);
        lines.push(`2. The device reads the zero offset for 5 seconds`);
        lines.push(`3. **Reference calibration (optional):** Inflate to a known pressure using a mercury sphygmomanometer`);
        lines.push(`4. Compare the device reading against the mercury column`);
        lines.push(`5. Stored coefficients: zero offset`);
        lines.push(``);
      }

      if (medCalibTypes.has("load_cell")) {
        lines.push(`### Weight / Load Cell (HX711)`);
        lines.push(``);
        lines.push(`**Required reference equipment:** Certified calibration weights (e.g., 1000g)`);
        lines.push(``);
        lines.push(`1. **Tare:** Remove all weight from the scale platform`);
        lines.push(`2. The device reads the zero-load value for 5 seconds`);
        lines.push(`3. **Span calibration:** Place a known weight (e.g., 1000g) on the platform`);
        lines.push(`4. The device computes the scale factor from the known weight`);
        lines.push(`5. Stored coefficients: tare value and scale factor`);
        lines.push(``);
      }

      if (medCalibTypes.has("color_sensor")) {
        lines.push(`### Color Sensor (TCS34725) — Urine Analyzer`);
        lines.push(``);
        lines.push(`**Required reference equipment:** Calibrated white reference card (e.g., X-Rite ColorChecker White)`);
        lines.push(``);
        lines.push(`1. **White balance:** Place the reference white card under the sensor`);
        lines.push(`2. The device reads RGB values for 5 seconds`);
        lines.push(`3. Correction factors are computed to normalize RGB channels against the known white`);
        lines.push(`4. Stored coefficients: R, G, B correction factors`);
        lines.push(``);
      }

      lines.push(`### Calibration Frequency`);
      lines.push(``);
      lines.push(`| Use Case | Recommended Frequency |`);
      lines.push(`|----------|----------------------|`);
      lines.push(`| Clinical / patient care | Monthly |`);
      lines.push(`| Research / laboratory | Quarterly |`);
      lines.push(`| Personal wellness | Every 6 months |`);
      lines.push(`| After device service/drop | Immediately |`);
    }
  }

  return {
    stage: "docs",
    filename: "ASSEMBLY.md",
    content: lines.join("\n"),
    format: "markdown",
  };
}

function generatePrintGuide(doc: MHDLDocument, lang?: MedicalLanguage): BuildArtifact {
  const s = getStrings(lang);
  const enc = doc.enclosure;
  const dims = doc.board.dimensions;
  const wallT = enc.wallThicknessMm;

  const caseW = (dims?.widthMm || 60) + wallT * 2;
  const caseH = (dims?.heightMm || 40) + wallT * 2;
  const caseD = (dims?.depthMm || 20) + wallT * 2;

  const lines: string[] = [];

  // Medical device disclaimer
  if (doc.meta?.medical) {
    lines.push(`> **${s.warning}:** ${s.disclaimer}`);
    lines.push(``);
  }

  lines.push(`# ${doc.meta.name} — ${s.printGuideTitle}`);
  lines.push(``);
  lines.push(`## ${s.enclosureDimensions}`);
  lines.push(`- Width: ${caseW}mm`);
  lines.push(`- Height: ${caseH}mm`);
  lines.push(`- Depth: ${caseD}mm`);
  lines.push(`- Wall: ${wallT}mm`);
  lines.push(``);
  lines.push(`## ${s.recommendedPrintSettings}`);
  lines.push(``);
  lines.push(`| ${s.setting} | ${s.value} |`);
  lines.push(`|---------|-------|`);
  lines.push(`| ${s.material} | ${enc.material?.toUpperCase() || "PLA"} |`);
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
  lines.push(`## ${s.printOrder}`);
  lines.push(`1. Print **base** (enclosure.scad with \`base()\` uncommented)`);
  lines.push(`2. Print **lid** (uncomment \`lid()\`, comment out \`base()\`)`);
  lines.push(`3. Insert M3 threaded inserts into mounting posts (soldering iron, 220°C)`);
  lines.push(`4. Mount PCB onto posts with M3x6mm screws`);
  lines.push(`5. Snap/screw lid onto base`);
  lines.push(``);
  lines.push(`## ${s.postProcessing}`);
  lines.push(`- Sand mating surfaces lightly if snap-fit is too tight`);
  lines.push(`- Adjust \`tolerance\` parameter in .scad file (default 0.3mm)`);

  // ── Medical Device Print Considerations ──────────
  if (doc.meta.medical) {
    lines.push(``);
    lines.push(`## ${s.medicalDevicePrintConsiderations}`);
    lines.push(``);
    lines.push(`> This enclosure is flagged as a medical device${doc.meta.deviceClass ? " (Class " + doc.meta.deviceClass + ")" : ""}.`);
    lines.push(`> Follow all applicable regulatory requirements for your jurisdiction.`);
    if (doc.meta.intendedUse) {
      lines.push(`> Intended use: ${doc.meta.intendedUse}`);
    }
    lines.push(``);

    // Material selection based on sterilization
    lines.push(`### ${s.materialSelection}`);
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
    lines.push(`### ${s.printParametersMedical}`);
    lines.push(``);
    lines.push(`| ${s.setting} | ${s.value} | ${s.reason} |`);
    lines.push(`|---------|-------|--------|`);
    lines.push(`| Layer Height | **0.1mm** | Smooth surfaces for patient contact & easier cleaning |`);
    lines.push(`| Infill | **100%** | Structural integrity required for medical devices |`);
    lines.push(`| Perimeters | 4+ | Maximize shell strength |`);
    lines.push(`| Top/Bottom layers | 6+ | Fully sealed top and bottom |`);
    lines.push(``);

    // Post-processing for medical
    lines.push(`### ${s.postProcessingMedical}`);
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

// ─── Medical Component Substitution Map ─────────────────────

const MEDICAL_SUBSTITUTIONS: Record<string, { alt: string; notes: string }[]> = {
  // Sensors
  "MAX30102": [
    { alt: "MAX30100", notes: "Older version, same I2C address, lower accuracy" },
    { alt: "AFE4404", notes: "TI alternative, better accuracy, higher cost" },
  ],
  "AD8232": [
    { alt: "ADS1292R", notes: "TI 2-channel, SPI, higher resolution" },
    { alt: "MAX86150", notes: "Maxim ECG+PPG combo, I2C" },
  ],
  "DS18B20": [
    { alt: "DHT22", notes: "Also reads humidity, lower accuracy (±0.5°C)" },
    { alt: "TMP36", notes: "Analog output, no library needed" },
  ],
  "DHT22": [
    { alt: "DHT11", notes: "Cheaper, lower accuracy (±2°C), 0-50°C range" },
    { alt: "SHT30", notes: "I2C, higher accuracy, more expensive" },
  ],
  "MLX90614": [
    { alt: "GY-906", notes: "Same sensor on breakout board" },
    { alt: "AMG8833", notes: "8x8 thermal array, more expensive" },
  ],
  "TCS34725": [
    { alt: "APDS-9960", notes: "Also has proximity/gesture, I2C" },
    { alt: "AS7341", notes: "11-channel spectral sensor, higher accuracy" },
  ],
  // Displays
  "SSD1306": [
    { alt: "SH1106", notes: "Same size/interface, different driver, check library" },
    { alt: "ST7789", notes: "Color TFT, SPI, higher power draw" },
  ],
  // MCUs
  "ESP32": [
    { alt: "ESP32-S3", notes: "Newer, USB-OTG, more GPIO, same price" },
    { alt: "ESP32-C3", notes: "RISC-V, cheaper, fewer GPIO, single-core" },
  ],
  "ESP32-S3": [
    { alt: "ESP32", notes: "Older but widely available, same WiFi/BLE" },
    { alt: "RP2040-W", notes: "Pico W, cheaper, WiFi only (no BLE)" },
  ],
  // Common modules
  "MFRC522": [
    { alt: "PN532", notes: "NXP, I2C/SPI/UART, wider protocol support" },
  ],
  "HC-SR04": [
    { alt: "JSN-SR04T", notes: "Waterproof version, same interface" },
  ],
};

function lookupSubstitutions(
  model: string,
): { alt1: string; alt2: string } {
  const key = model.toUpperCase();
  for (const [part, alts] of Object.entries(MEDICAL_SUBSTITUTIONS)) {
    if (key.includes(part.toUpperCase())) {
      return {
        alt1: alts[0] ? `${alts[0].alt} (${alts[0].notes})` : "",
        alt2: alts[1] ? `${alts[1].alt} (${alts[1].notes})` : "",
      };
    }
  }
  return { alt1: "", alt2: "" };
}

function generateBOM(doc: MHDLDocument, lang?: MedicalLanguage): BuildArtifact {
  const s = getStrings(lang);
  const isMedical = !!doc.meta?.medical;
  const lines: string[] = [];

  if (isMedical) {
    lines.push(`${s.component},${s.type},${s.model},${s.quantity},${s.notes},Alternative 1,Alternative 2`);
  } else {
    lines.push(`${s.component},${s.type},${s.model},${s.quantity},${s.notes}`);
  }

  // MCU row
  const mcuModel = doc.board.mcu.model || doc.board.mcu.family;
  if (isMedical) {
    const mcuAlts = lookupSubstitutions(mcuModel);
    lines.push(`${mcuModel},MCU,${doc.board.mcu.family},1,${s.mainController},${mcuAlts.alt1},${mcuAlts.alt2}`);
  } else {
    lines.push(`${mcuModel},MCU,${doc.board.mcu.family},1,${s.mainController}`);
  }

  // Component rows
  for (const comp of doc.board.components) {
    const notes = comp.properties?.["color"] ? String(comp.properties["color"]) : "";
    if (isMedical) {
      const alts = lookupSubstitutions(comp.model || comp.id);
      lines.push(`${comp.id},${comp.type},${comp.model || ""},1,${notes},${alts.alt1},${alts.alt2}`);
    } else {
      lines.push(`${comp.id},${comp.type},${comp.model || ""},1,${notes}`);
    }
  }

  // Add hardware
  if (doc.board.mountingHoles) {
    const count = doc.board.mountingHoles.positions.length;
    if (isMedical) {
      lines.push(`M3 threaded insert,hardware,,${count},${s.forMounting},,`);
      lines.push(`M3x6mm screw,hardware,,${count},${s.forMounting},,`);
    } else {
      lines.push(`M3 threaded insert,hardware,,${count},${s.forMounting}`);
      lines.push(`M3x6mm screw,hardware,,${count},${s.forMounting}`);
    }
  }

  // Global supplier links for developing countries (medical builds)
  if (isMedical) {
    lines.push(``);
    lines.push(`# Suppliers: LCSC (lcsc.com), AliExpress (aliexpress.com), Mouser (mouser.com), DigiKey (digikey.com)`);
    lines.push(`⚠️ NOTICE,This BOM is for prototyping only,Components must meet IEC 60601-1 for clinical use,1,Verify supplier certifications`);
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
    const docLang = (doc.docs?.language || "en") as MedicalLanguage;
    artifacts.push(generateBOM(doc, docLang));
    emit({ stage: "bom", status: "done", durationMs: Date.now() - t });
  }

  // Docs
  if (buildAll || stages.includes("docs")) {
    emit({ stage: "docs", status: "starting" });
    const t = Date.now();
    const docLang = (doc.docs?.language || "en") as MedicalLanguage;
    if (doc.docs?.generatePinout) artifacts.push(generatePinoutDoc(doc, docLang));
    if (doc.docs?.generateAssembly) artifacts.push(generateAssemblyDoc(doc, docLang));
    if (doc.docs?.generatePrintGuide) artifacts.push(generatePrintGuide(doc, docLang));

    // Medical regulatory docs — auto-generate when meta.medical is true
    if (doc.meta?.medical || doc.docs?.generateMedicalDocs) {
      artifacts.push(generateWHOChecklist(doc, docLang));
      artifacts.push(generateIEC62304Doc(doc, docLang));
      artifacts.push(generateFMEATemplate(doc, docLang));
      artifacts.push(generateCEGuidance(doc, docLang));
      artifacts.push(generateBatteryLifeEstimate(doc, docLang));
      artifacts.push(generateFieldTestChecklist(doc, docLang));
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
