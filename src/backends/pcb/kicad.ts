/**
 * KiCad 9 PCB Backend
 *
 * Converts MHDL board spec into a KiCad PCB file (.kicad_pcb),
 * runs DRC checks and autorouting via kicad-cli, and exports
 * Gerber files for manufacturing. Falls back gracefully when
 * kicad-cli is not available on the system.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, isAbsolute, basename } from "node:path";
import { writeFile, readFile, mkdir, readdir, access } from "node:fs/promises";

import type {
  MHDLDocument,
  BuildArtifact,
  ForgeConfig,
  PCBConfig,
} from "../../schema/mhdl.js";
import { generateSKiDLScript } from "./skidl.js";
import { runPython } from "../../python/bridge.js";

const execFileAsync = promisify(execFile);

// ─── Footprint Map ──────────────────────────────────────────

/** Maps MHDL component types/models to standard KiCad library footprints. */
const FOOTPRINT_MAP: Record<string, string> = {
  // MCU modules
  "esp32": "RF_Module:ESP32-WROOM-32",
  "esp32-s3": "RF_Module:ESP32-S3-WROOM-1",
  "esp32-c3": "RF_Module:ESP32-C3-MINI-1",
  "esp32-wroom": "RF_Module:ESP32-WROOM-32",
  "arduino-nano": "Module:Arduino_Nano",
  "arduino-uno": "Module:Arduino_UNO_R3",
  "arduino-mega": "Module:Arduino_Mega2560",
  "rp2040": "Package_DFN_QFN:QFN-56-1EP_7x7mm_P0.4mm_EP3.2x3.2mm",

  // Passive components
  "resistor": "Resistor_SMD:R_0805_2012Metric",
  "capacitor": "Capacitor_SMD:C_0805_2012Metric",
  "inductor": "Inductor_SMD:L_0805_2012Metric",

  // LEDs and optoelectronics
  "led": "LED_SMD:LED_0805_2012Metric",
  "neopixel": "LED_SMD:LED_WS2812B_PLCC4_5.0x5.0mm_P3.2mm",

  // Buttons and switches
  "button": "Button_Switch_SMD:SW_Push_1P1T_NO_6x6mm_H9.5mm",

  // Displays
  "oled": "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical",
  "lcd": "Connector_PinHeader_2.54mm:PinHeader_1x16_P2.54mm_Vertical",

  // Sensors — medical
  "max30102": "Package_SO:SOIC-14_3.9x8.7mm_P1.27mm",
  "pulse_oximeter": "Package_SO:SOIC-14_3.9x8.7mm_P1.27mm",
  "ad8232": "Package_SO:SOIC-20W_7.5x12.8mm_P1.27mm",
  "ecg": "Package_SO:SOIC-20W_7.5x12.8mm_P1.27mm",
  "blood_pressure": "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical",
  "load_cell": "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical",
  "color_sensor": "Package_DFN_QFN:DFN-6-1EP_3x3mm_P1mm_EP1.3x1.5mm",
  "temperature_sensor": "Package_TO_SOT_THT:TO-92_Inline",

  // Sensors — environmental
  "dht22": "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical",
  "sensor": "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical",
  "pir": "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical",
  "ultrasonic": "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical",
  "moisture": "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical",
  "gas_sensor": "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical",
  "ldr": "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical",
  "potentiometer": "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical",

  // Motor / mechanical
  "motor": "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical",
  "servo": "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical",
  "stepper": "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical",
  "relay": "Relay_THT:Relay_SPDT_Finder_32.21-x000",
  "buzzer": "Buzzer_Beeper:Buzzer_12x9.5RM7.6",

  // Communication modules
  "gps": "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical",
  "rfid": "Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical",

  // Misc
  "encoder": "Connector_PinHeader_2.54mm:PinHeader_1x05_P2.54mm_Vertical",
  "joystick": "Connector_PinHeader_2.54mm:PinHeader_1x05_P2.54mm_Vertical",
  "connector": "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical",
  "crystal": "Crystal:Crystal_SMD_3215-2Pin_3.2x1.5mm",
  "transistor": "Package_TO_SOT_SMD:SOT-23",
  "diode": "Diode_SMD:D_SOD-123",
  "voltage-regulator": "Package_TO_SOT_SMD:SOT-223-3_TabPin2",
  "antenna": "Connector_Coaxial:SMA_Amphenol_132289_EdgeMount",

  // Default fallback
  "custom": "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical",
};

/**
 * Resolve the KiCad footprint for a component.
 * Priority: component.footprint > model match > type match > default
 */
function resolveFootprint(comp: { type: string; model?: string; footprint?: string }): string {
  if (comp.footprint) return comp.footprint;
  if (comp.model) {
    const modelKey = comp.model.toLowerCase().replace(/[\s_-]+/g, "-");
    if (FOOTPRINT_MAP[modelKey]) return FOOTPRINT_MAP[modelKey];
  }
  return FOOTPRINT_MAP[comp.type] || FOOTPRINT_MAP["custom"];
}

// ─── Helpers ────────────────────────────────────────────────

/** Sanitize an MHDL id into a safe filename fragment. */
function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Build a temporary working directory for the KiCad pipeline. */
async function makeTempDir(projectName: string): Promise<string> {
  const dir = join(tmpdir(), `meshforge-kicad-${safeId(projectName)}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// ─── KiCad 8 Schematic Generation ───────────────────────────

/**
 * Generate a complete .kicad_sch file in KiCad 8 format.
 *
 * Places symbols for each component with net connections,
 * power symbols (VCC/GND), and proper grid alignment.
 */
function generateKiCadSchematic(doc: MHDLDocument): string {
  const lines: string[] = [];
  const gridStep = 2.54; // Standard 100mil grid

  // File header
  lines.push(`(kicad_sch (version 20231120) (generator "meshforge") (generator_version "1.0")`);
  lines.push(`  (uuid "${generateUUID()}")`);
  lines.push(`  (paper "A3")`);
  lines.push(``);

  // Library symbols section (declare symbols we reference)
  lines.push(`  (lib_symbols`);

  // Power symbols
  lines.push(`    (symbol "power:VCC" (power) (pin_names (offset 0)) (in_bom yes) (on_board yes)`);
  lines.push(`      (property "Reference" "#PWR" (at 0 1.27 0) (effects (font (size 1.27 1.27)) hide))`);
  lines.push(`      (property "Value" "VCC" (at 0 3.81 0) (effects (font (size 1.27 1.27))))`);
  lines.push(`      (symbol "VCC_0_1" (polyline (pts (xy 0 0) (xy 0 1.27)) (stroke (width 0) (type default)) (fill (type none))))`);
  lines.push(`      (symbol "VCC_1_1" (pin power_in line (at 0 0 90) (length 0) (name "VCC" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27))))))`);
  lines.push(`    )`);

  lines.push(`    (symbol "power:GND" (power) (pin_names (offset 0)) (in_bom yes) (on_board yes)`);
  lines.push(`      (property "Reference" "#PWR" (at 0 -2.54 0) (effects (font (size 1.27 1.27)) hide))`);
  lines.push(`      (property "Value" "GND" (at 0 -3.81 0) (effects (font (size 1.27 1.27))))`);
  lines.push(`      (symbol "GND_0_1" (polyline (pts (xy 0 0) (xy 0 -1.27) (xy -1.27 -1.27) (xy 0 -2.54) (xy 1.27 -1.27) (xy 0 -1.27)) (stroke (width 0) (type default)) (fill (type none))))`);
  lines.push(`      (symbol "GND_1_1" (pin power_in line (at 0 0 270) (length 0) (name "GND" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27))))))`);
  lines.push(`    )`);

  // Declare a generic symbol for each component type used
  const declaredTypes = new Set<string>();
  const allComponents = [doc.board.mcu, ...doc.board.components];

  for (const comp of allComponents) {
    const typeKey = comp.type === "mcu" ? (doc.board.mcu.family || "mcu") : comp.type;
    if (declaredTypes.has(typeKey)) continue;
    declaredTypes.add(typeKey);

    const pinCount = comp.pins.length;
    lines.push(`    (symbol "meshforge:${typeKey}" (in_bom yes) (on_board yes)`);
    lines.push(`      (property "Reference" "U" (at 0 ${(pinCount + 1) * gridStep / 2} 0) (effects (font (size 1.27 1.27))))`);
    lines.push(`      (property "Value" "${typeKey}" (at 0 ${-(pinCount + 1) * gridStep / 2} 0) (effects (font (size 1.27 1.27))))`);
    lines.push(`      (property "Footprint" "${resolveFootprint(comp)}" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))`);

    // Draw box
    const boxH = Math.max(pinCount, 2) * gridStep;
    lines.push(`      (symbol "${typeKey}_0_1"`);
    lines.push(`        (rectangle (start -7.62 ${boxH / 2}) (end 7.62 ${-boxH / 2}) (stroke (width 0.254) (type default)) (fill (type background)))`);

    // Place pins
    comp.pins.forEach((pin, idx) => {
      const y = boxH / 2 - (idx + 0.5) * (boxH / pinCount);
      const isLeftSide = idx % 2 === 0;
      const x = isLeftSide ? -7.62 : 7.62;
      const dir = isLeftSide ? 0 : 180;
      const pinType = pin.mode === "power" ? "power_in" : pin.mode === "ground" ? "power_in" : "passive";
      lines.push(`        (pin ${pinType} line (at ${x - (isLeftSide ? 5.08 : -5.08)} ${y.toFixed(2)} ${dir}) (length 5.08) (name "${pin.id}" (effects (font (size 1.016 1.016)))) (number "${idx + 1}" (effects (font (size 1.016 1.016)))))`);
    });

    lines.push(`      )`);
    lines.push(`    )`);
  }

  lines.push(`  )`); // end lib_symbols
  lines.push(``);

  // Place symbol instances on the sheet
  let pwrIdx = 1;
  const compPositions: Map<string, { x: number; y: number }> = new Map();

  // Place MCU at center-left
  const mcuX = 50;
  const mcuY = 80;
  compPositions.set(doc.board.mcu.id, { x: mcuX, y: mcuY });

  const mcuTypeKey = doc.board.mcu.family || "mcu";
  lines.push(`  (symbol (lib_id "meshforge:${mcuTypeKey}") (at ${mcuX} ${mcuY} 0) (unit 1)`);
  lines.push(`    (in_bom yes) (on_board yes) (dnp no)`);
  lines.push(`    (uuid "${generateUUID()}")`);
  lines.push(`    (property "Reference" "U1" (at ${mcuX} ${mcuY - 5} 0) (effects (font (size 1.27 1.27))))`);
  lines.push(`    (property "Value" "${doc.board.mcu.model || mcuTypeKey}" (at ${mcuX} ${mcuY + 5} 0) (effects (font (size 1.27 1.27))))`);
  lines.push(`    (property "Footprint" "${resolveFootprint(doc.board.mcu)}" (at ${mcuX} ${mcuY} 0) (effects (font (size 1.27 1.27)) hide))`);
  lines.push(`  )`);
  lines.push(``);

  // Place other components in a grid to the right of MCU
  const compStartX = 120;
  const compStartY = 30;
  const compSpacingY = 25;

  doc.board.components.forEach((comp, idx) => {
    const cx = compStartX;
    const cy = compStartY + idx * compSpacingY;
    compPositions.set(comp.id, { x: cx, y: cy });

    const typeKey = comp.type;
    const refDes = getRefDesPrefix(comp.type) + (idx + 2);

    lines.push(`  (symbol (lib_id "meshforge:${typeKey}") (at ${cx} ${cy} 0) (unit 1)`);
    lines.push(`    (in_bom yes) (on_board yes) (dnp no)`);
    lines.push(`    (uuid "${generateUUID()}")`);
    lines.push(`    (property "Reference" "${refDes}" (at ${cx} ${cy - 5} 0) (effects (font (size 1.27 1.27))))`);
    lines.push(`    (property "Value" "${comp.model || comp.value || comp.type}" (at ${cx} ${cy + 5} 0) (effects (font (size 1.27 1.27))))`);
    lines.push(`    (property "Footprint" "${resolveFootprint(comp)}" (at ${cx} ${cy} 0) (effects (font (size 1.27 1.27)) hide))`);
    lines.push(`  )`);
    lines.push(``);

    // Place VCC symbol above components with power pins
    const hasPower = comp.pins.some(p => p.mode === "power");
    if (hasPower) {
      lines.push(`  (symbol (lib_id "power:VCC") (at ${cx} ${cy - 15} 0) (unit 1)`);
      lines.push(`    (in_bom no) (on_board yes) (dnp no)`);
      lines.push(`    (uuid "${generateUUID()}")`);
      lines.push(`    (property "Reference" "#PWR0${pwrIdx++}" (at ${cx} ${cy - 16} 0) (effects (font (size 1.27 1.27)) hide))`);
      lines.push(`    (property "Value" "VCC" (at ${cx} ${cy - 13} 0) (effects (font (size 1.27 1.27))))`);
      lines.push(`  )`);
    }

    // Place GND symbol below components with ground pins
    const hasGnd = comp.pins.some(p => p.mode === "ground");
    if (hasGnd) {
      lines.push(`  (symbol (lib_id "power:GND") (at ${cx} ${cy + 15} 0) (unit 1)`);
      lines.push(`    (in_bom no) (on_board yes) (dnp no)`);
      lines.push(`    (uuid "${generateUUID()}")`);
      lines.push(`    (property "Reference" "#PWR0${pwrIdx++}" (at ${cx} ${cy + 16} 0) (effects (font (size 1.27 1.27)) hide))`);
      lines.push(`    (property "Value" "GND" (at ${cx} ${cy + 17} 0) (effects (font (size 1.27 1.27))))`);
      lines.push(`  )`);
    }
  });

  // Place VCC and GND for MCU
  lines.push(`  (symbol (lib_id "power:VCC") (at ${mcuX} ${mcuY - 25} 0) (unit 1)`);
  lines.push(`    (in_bom no) (on_board yes) (dnp no)`);
  lines.push(`    (uuid "${generateUUID()}")`);
  lines.push(`    (property "Reference" "#PWR0${pwrIdx++}" (at ${mcuX} ${mcuY - 26} 0) (effects (font (size 1.27 1.27)) hide))`);
  lines.push(`    (property "Value" "VCC" (at ${mcuX} ${mcuY - 23} 0) (effects (font (size 1.27 1.27))))`);
  lines.push(`  )`);

  lines.push(`  (symbol (lib_id "power:GND") (at ${mcuX} ${mcuY + 25} 0) (unit 1)`);
  lines.push(`    (in_bom no) (on_board yes) (dnp no)`);
  lines.push(`    (uuid "${generateUUID()}")`);
  lines.push(`    (property "Reference" "#PWR0${pwrIdx++}" (at ${mcuX} ${mcuY + 26} 0) (effects (font (size 1.27 1.27)) hide))`);
  lines.push(`    (property "Value" "GND" (at ${mcuX} ${mcuY + 27} 0) (effects (font (size 1.27 1.27))))`);
  lines.push(`  )`);
  lines.push(``);

  // Wires for connections
  for (const conn of doc.board.connections) {
    const [fromCompId, fromPinId] = conn.from.split(".");
    const [toCompId, toPinId] = conn.to.split(".");
    const fromPos = compPositions.get(fromCompId);
    const toPos = compPositions.get(toCompId);
    if (fromPos && toPos) {
      // Draw wire between components
      lines.push(`  (wire (pts (xy ${fromPos.x + 7.62} ${fromPos.y}) (xy ${toPos.x - 7.62} ${toPos.y}))`);
      lines.push(`    (stroke (width 0) (type default))`);
      lines.push(`    (uuid "${generateUUID()}")`);
      lines.push(`  )`);

      // Net label on wire
      const netName = conn.net || `${fromPinId}_${toPinId}`;
      const midX = (fromPos.x + toPos.x) / 2;
      const midY = (fromPos.y + toPos.y) / 2;
      lines.push(`  (label "${netName}" (at ${midX} ${midY - 2} 0) (effects (font (size 1.27 1.27))))`);
    }
  }
  lines.push(``);

  lines.push(`)`); // end kicad_sch
  return lines.join("\n");
}

/** Simple UUID generator for schematic elements. */
let _uuidCounter = 0;
function generateUUID(): string {
  _uuidCounter++;
  const ts = Date.now().toString(16).padStart(12, "0");
  const cnt = _uuidCounter.toString(16).padStart(4, "0");
  return `${ts.slice(0, 8)}-${ts.slice(8, 12)}-4${cnt.slice(0, 3)}-8${cnt.slice(3)}-${ts}${cnt}`.slice(0, 36);
}

/** Map component type to standard KiCad reference designator prefix. */
function getRefDesPrefix(type: string): string {
  const map: Record<string, string> = {
    mcu: "U", led: "D", button: "SW", resistor: "R", capacitor: "C",
    oled: "U", lcd: "U", buzzer: "BZ", sensor: "U", motor: "M",
    relay: "K", connector: "J", antenna: "AE", crystal: "Y",
    transistor: "Q", diode: "D", voltage_regulator: "U", servo: "M",
    neopixel: "D", stepper: "M", encoder: "SW", temperature_sensor: "U",
    thermocouple: "U", pulse_oximeter: "U", ecg: "U", blood_pressure: "U",
    load_cell: "U", color_sensor: "U", speaker: "LS", microphone: "MK",
    gps: "U", rfid: "U", pir: "U", ultrasonic: "U", moisture: "U",
    gas_sensor: "U", potentiometer: "RV", ldr: "R", joystick: "J",
    ir_receiver: "U", ir_emitter: "D", custom: "U",
  };
  return map[type] || "U";
}

// ─── Fabrication Output Generation ──────────────────────────

/**
 * Generate BOM (Bill of Materials) as CSV.
 */
function generateBOMCSV(doc: MHDLDocument): string {
  const rows: string[] = ["Component,Value,Footprint,Quantity"];
  const allComps = [doc.board.mcu, ...doc.board.components];

  // Group by type+model+value for quantity counting
  const groups = new Map<string, { comp: typeof allComps[0]; qty: number }>();
  for (const comp of allComps) {
    const key = `${comp.type}|${comp.model || ""}|${comp.value || ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.qty++;
    } else {
      groups.set(key, { comp, qty: 1 });
    }
  }

  for (const { comp, qty } of groups.values()) {
    const value = comp.value || comp.model || comp.type;
    const fp = resolveFootprint(comp);
    rows.push(`"${comp.type}","${value}","${fp}",${qty}`);
  }

  return rows.join("\n");
}

/**
 * Generate Pick-and-Place CSV for automated assembly.
 */
function generatePickAndPlaceCSV(doc: MHDLDocument): string {
  const rows: string[] = ["Component,Value,Footprint,X_mm,Y_mm,Rotation,Side"];
  const allComps = [doc.board.mcu, ...doc.board.components];
  const widthMm = doc.pcb?.widthMm ?? doc.board.dimensions?.widthMm ?? 50;
  const heightMm = doc.pcb?.heightMm ?? doc.board.dimensions?.heightMm ?? 50;

  // Auto-layout components in a grid
  const margin = 5;
  const spacing = 10;
  const cols = Math.floor((widthMm - 2 * margin) / spacing) || 3;

  allComps.forEach((comp, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = (margin + col * spacing + spacing / 2).toFixed(2);
    const y = (margin + row * spacing + spacing / 2).toFixed(2);
    const value = comp.value || comp.model || comp.type;
    const fp = resolveFootprint(comp);
    const refDes = (comp.type === "mcu" ? "U1" : getRefDesPrefix(comp.type) + (idx + 1));
    rows.push(`"${refDes}","${value}","${fp}",${x},${y},0,top`);
  });

  return rows.join("\n");
}

/**
 * Generate Gerber file stubs for each required layer.
 * These are placeholder files indicating the expected fabrication outputs.
 */
function generateGerberStubs(projectName: string, doc: MHDLDocument): Array<{ filename: string; content: string }> {
  const layers = [
    { name: "F_Cu", ext: "gtl", desc: "Front Copper" },
    { name: "B_Cu", ext: "gbl", desc: "Back Copper" },
    { name: "F_SilkS", ext: "gto", desc: "Front Silkscreen" },
    { name: "B_SilkS", ext: "gbo", desc: "Back Silkscreen" },
    { name: "F_Mask", ext: "gts", desc: "Front Soldermask" },
    { name: "B_Mask", ext: "gbs", desc: "Back Soldermask" },
    { name: "Edge_Cuts", ext: "gm1", desc: "Board Outline (Edge Cuts)" },
  ];

  const drillFile = {
    filename: `fabrication/${projectName}.drl`,
    content: [
      `; MeshForge Drill File Stub`,
      `; Generated by MeshCue Forge`,
      `; Format: Excellon`,
      `; Units: mm`,
      `M48`,
      `; Drill definitions`,
      ...(doc.board.mountingHoles?.positions.map((pos, i) =>
        `T${i + 1}C${doc.board.mountingHoles!.diameterMm.toFixed(3)}`
      ) || []),
      `%`,
      ...(doc.board.mountingHoles?.positions.map((pos, i) =>
        `T${i + 1}\nX${(pos.x * 1000).toFixed(0)}Y${(pos.y * 1000).toFixed(0)}`
      ) || []),
      `M30`,
    ].join("\n"),
  };

  const gerbers = layers.map(layer => ({
    filename: `fabrication/${projectName}-${layer.name}.${layer.ext}`,
    content: [
      `G04 ${layer.desc} — MeshForge Gerber Stub*`,
      `G04 Project: ${projectName}*`,
      `G04 Generated by MeshCue Forge*`,
      `G04 Layer: ${layer.name}*`,
      `%FSLAX46Y46*%`,
      `%MOMM*%`,
      `%ADD10C,0.100000*%`,
      `D10*`,
      ...(layer.name === "Edge_Cuts" ? [
        `G01*`,
        `X0Y0D02*`,
        `X${((doc.pcb?.widthMm ?? 50) * 1000000).toFixed(0)}Y0D01*`,
        `X${((doc.pcb?.widthMm ?? 50) * 1000000).toFixed(0)}Y${((doc.pcb?.heightMm ?? 50) * 1000000).toFixed(0)}D01*`,
        `X0Y${((doc.pcb?.heightMm ?? 50) * 1000000).toFixed(0)}D01*`,
        `X0Y0D01*`,
      ] : [
        `G04 Component placement layer — populate via KiCad or autorouter*`,
      ]),
      `M02*`,
    ].join("\n"),
  }));

  return [...gerbers, drillFile];
}

// ─── KiCad PCB Template Generation ──────────────────────────

interface LayerDef {
  index: number;
  name: string;
  type: string;
}

function buildLayerStack(layerCount: 2 | 4): LayerDef[] {
  const layers: LayerDef[] = [
    { index: 0, name: "F.Cu", type: "signal" },
    { index: 31, name: "B.Cu", type: "signal" },
    { index: 32, name: "B.Adhes", type: "user" },
    { index: 33, name: "F.Adhes", type: "user" },
    { index: 34, name: "B.Paste", type: "user" },
    { index: 35, name: "F.Paste", type: "user" },
    { index: 36, name: "B.SilkS", type: "user" },
    { index: 37, name: "F.SilkS", type: "user" },
    { index: 38, name: "B.Mask", type: "user" },
    { index: 39, name: "F.Mask", type: "user" },
    { index: 44, name: "Edge.Cuts", type: "user" },
    { index: 45, name: "Margin", type: "user" },
    { index: 46, name: "B.CrtYd", type: "user" },
    { index: 47, name: "F.CrtYd", type: "user" },
    { index: 48, name: "B.Fab", type: "user" },
    { index: 49, name: "F.Fab", type: "user" },
  ];

  if (layerCount === 4) {
    layers.splice(1, 0,
      { index: 1, name: "In1.Cu", type: "signal" },
      { index: 2, name: "In2.Cu", type: "signal" },
    );
  }

  return layers;
}

function generateLayerSection(layers: LayerDef[]): string {
  const entries = layers.map(l => `    (${l.index} "${l.name}" ${l.type})`);
  return `  (layers\n${entries.join("\n")}\n  )`;
}

interface DesignRules {
  clearanceMm: number;
  traceWidthMm: number;
  viaDiameterMm: number;
  viaDrillMm: number;
  powerTraceWidthMm: number;
  powerClearanceMm: number;
}

function defaultDesignRules(): DesignRules {
  return {
    clearanceMm: 0.2,
    traceWidthMm: 0.25,
    viaDiameterMm: 0.8,
    viaDrillMm: 0.4,
    powerTraceWidthMm: 0.5,
    powerClearanceMm: 0.3,
  };
}

function generateSetupSection(rules: DesignRules, gridMm: number): string {
  return `  (setup
    (pad_to_mask_clearance 0.05)
    (grid_origin 0 0)
    (pcbplotparams
      (layerselection 0x010fc_ffffffff)
      (plot_on_all_layers_selection 0x0000000_00000000)
      (disableapertmacros false)
      (usegerberextensions true)
      (usegerberattributes true)
      (usegerberadvancedattributes true)
      (creategerberjobfile true)
      (excludeedgelayer true)
      (linewidth 0.1)
      (plotframeref false)
      (viasonmask false)
      (mode 1)
      (useauxorigin false)
      (hpglpennumber 1)
      (hpglpenspeed 20)
      (hpglpendiameter 15.000000)
      (pdf_front_fp_property_popups true)
      (pdf_back_fp_property_popups true)
      (dxfpolygonmode true)
      (dxfimperialunits true)
      (dxfusepcbnewfont true)
      (psnegative false)
      (psa4output false)
      (plotreference true)
      (plotvalue true)
      (plotfptext true)
      (plotinvisibletext false)
      (sketchpadsonfab false)
      (subtractmaskfromsilk true)
      (outputformat 1)
      (mirror false)
      (drillshape 1)
      (scaleselection 1)
      (outputdirectory "gerbers/")
    )
  )`;
}

function generateNetClassSection(rules: DesignRules): string {
  return `  (net_class "Default" ""
    (clearance ${rules.clearanceMm})
    (trace_width ${rules.traceWidthMm})
    (via_dia ${rules.viaDiameterMm})
    (via_drill ${rules.viaDrillMm})
    (uvia_dia 0.3)
    (uvia_drill 0.1)
  )
  (net_class "Power" ""
    (clearance ${rules.powerClearanceMm})
    (trace_width ${rules.powerTraceWidthMm})
    (via_dia 1.0)
    (via_drill 0.5)
    (uvia_dia 0.3)
    (uvia_drill 0.1)
  )`;
}

function generateBoardOutline(widthMm: number, heightMm: number): string {
  const x0 = 0;
  const y0 = 0;
  const x1 = widthMm;
  const y1 = heightMm;

  return `  (gr_rect (start ${x0} ${y0}) (end ${x1} ${y1})
    (stroke (width 0.05) (type default))
    (fill none)
    (layer "Edge.Cuts")
  )`;
}

/**
 * Generate a complete .kicad_pcb file template.
 *
 * This creates a valid KiCad 9 PCB file with board outline,
 * layer setup, and design rules. Actual component placement
 * and routing is handled by kicad-cli or freerouting.
 */
function generateKiCadPCBContent(doc: MHDLDocument): string {
  const pcb: PCBConfig = doc.pcb ?? {};
  const layerCount = pcb.layers ?? 2;
  const widthMm = pcb.widthMm ?? doc.board.dimensions?.widthMm ?? 50;
  const heightMm = pcb.heightMm ?? doc.board.dimensions?.heightMm ?? 50;

  // Apply design rules from PCBConfig if specified
  const rules = defaultDesignRules();
  if (pcb.traceWidthMm) {
    rules.traceWidthMm = pcb.traceWidthMm;
    rules.powerTraceWidthMm = Math.max(pcb.traceWidthMm * 2, rules.powerTraceWidthMm);
  }
  if (pcb.viaSizeMm) {
    rules.viaDiameterMm = pcb.viaSizeMm;
    rules.viaDrillMm = pcb.viaSizeMm * 0.5;
  }

  const gridMm = 1.27; // Standard 50mil grid
  const layers = buildLayerStack(layerCount);

  const sections: string[] = [];

  sections.push(`(kicad_pcb (version 20231014) (generator "meshforge") (generator_version "1.0")`);
  sections.push(`  (general`);
  sections.push(`    (thickness 1.6)`);
  sections.push(`    (legacy_teardrops no)`);
  sections.push(`  )`);
  sections.push(``);
  sections.push(generateLayerSection(layers));
  sections.push(``);
  sections.push(generateSetupSection(rules, gridMm));
  sections.push(``);

  // Net declarations
  sections.push(`  (net 0 "")`);
  sections.push(`  (net 1 "VCC")`);
  sections.push(`  (net 2 "GND")`);

  // Build net map for connections
  const netMap = new Map<string, number>();
  netMap.set("VCC", 1);
  netMap.set("GND", 2);

  let netIdx = 3;
  for (const conn of doc.board.connections) {
    const netName = conn.net || `N${String(netIdx - 3).padStart(3, "0")}`;
    sections.push(`  (net ${netIdx} "${netName}")`);
    netMap.set(netName, netIdx);
    // Also map by "from.to" for lookups
    netMap.set(`${conn.from}->${conn.to}`, netIdx);
    netIdx++;
  }
  sections.push(``);

  // Net classes
  sections.push(generateNetClassSection(rules));
  sections.push(``);

  // Board outline on Edge.Cuts layer
  sections.push(generateBoardOutline(widthMm, heightMm));
  sections.push(``);

  // ── Footprint Placement ──
  // Auto-layout components on the PCB with grid-aligned positions
  const allComponents = [doc.board.mcu, ...doc.board.components];
  const margin = 5; // mm from board edge
  const spacing = 12; // mm between component centers
  const usableW = widthMm - 2 * margin;
  const cols = Math.max(Math.floor(usableW / spacing), 1);

  allComponents.forEach((comp, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = snapToGrid(margin + col * spacing + spacing / 2, gridMm);
    const y = snapToGrid(margin + row * spacing + spacing / 2, gridMm);
    const footprint = resolveFootprint(comp);
    const refDes = comp.type === "mcu" ? "U1" : `${getRefDesPrefix(comp.type)}${idx + 1}`;
    const value = comp.value || comp.model || comp.type;

    sections.push(`  (footprint "${footprint}" (layer "F.Cu")`);
    sections.push(`    (at ${x} ${y})`);
    sections.push(`    (property "Reference" "${refDes}" (at 0 -2.5) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))`);
    sections.push(`    (property "Value" "${value}" (at 0 2.5) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))`);

    // Generate pads for each pin
    comp.pins.forEach((pin, pinIdx) => {
      const padNum = pinIdx + 1;
      const padX = (pinIdx - comp.pins.length / 2) * 1.27;
      const padType = (pin.mode === "power" || pin.mode === "ground") ? "smd" : "smd";
      const netName = pin.mode === "power" ? "VCC" : pin.mode === "ground" ? "GND" : "";
      const netId = netName ? (netMap.get(netName) || 0) : 0;
      const netStr = netId > 0 ? ` (net ${netId} "${netName}")` : "";
      sections.push(`    (pad "${padNum}" ${padType} rect (at ${padX.toFixed(2)} 0) (size 1.2 1.4) (layers "F.Cu" "F.Paste" "F.Mask")${netStr})`);
    });

    sections.push(`  )`);
  });
  sections.push(``);

  // Mounting holes if defined
  if (doc.board.mountingHoles) {
    const holeDia = doc.board.mountingHoles.diameterMm;
    for (const pos of doc.board.mountingHoles.positions) {
      sections.push(`  (footprint "MountingHole:MountingHole_${holeDia}mm_M${holeDia}" (layer "F.Cu")`);
      sections.push(`    (at ${pos.x} ${pos.y})`);
      sections.push(`    (pad "" thru_hole circle (at 0 0) (size ${holeDia + 1} ${holeDia + 1}) (drill ${holeDia}) (layers "*.Cu" "*.Mask"))`);
      sections.push(`  )`);
    }
    sections.push(``);
  }

  // ── GND Copper Pour Zone ──
  sections.push(`  (zone (net 2) (net_name "GND") (layer "F.Cu") (hatch edge 0.5)`);
  sections.push(`    (connect_pads (clearance ${rules.clearanceMm}))`);
  sections.push(`    (min_thickness 0.25)`);
  sections.push(`    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))`);
  sections.push(`    (polygon (pts`);
  sections.push(`      (xy 0 0) (xy ${widthMm} 0) (xy ${widthMm} ${heightMm}) (xy 0 ${heightMm})`);
  sections.push(`    ))`);
  sections.push(`  )`);
  sections.push(``);

  // Back copper GND pour as well
  sections.push(`  (zone (net 2) (net_name "GND") (layer "B.Cu") (hatch edge 0.5)`);
  sections.push(`    (connect_pads (clearance ${rules.clearanceMm}))`);
  sections.push(`    (min_thickness 0.25)`);
  sections.push(`    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))`);
  sections.push(`    (polygon (pts`);
  sections.push(`      (xy 0 0) (xy ${widthMm} 0) (xy ${widthMm} ${heightMm}) (xy 0 ${heightMm})`);
  sections.push(`    ))`);
  sections.push(`  )`);
  sections.push(``);

  sections.push(`)`);

  return sections.join("\n");
}

/** Snap a coordinate to the nearest grid point. */
function snapToGrid(value: number, gridMm: number): number {
  return Math.round(value / gridMm) * gridMm;
}

// ─── KiCad Path Validation ───────────────────────────────────

/** Shell metacharacters that must not appear in executable paths. */
const SHELL_META = /[;|&$`\\!(){}<>'"*?#~\n\r]/;

/** Path traversal sequences. */
const PATH_TRAVERSAL = /(?:^|\/)\.\.(?:\/|$)/;

/**
 * Validate a KiCad CLI path before execution.
 *
 * Ensures the path:
 *   - Contains no shell metacharacters
 *   - Does not use path traversal (../)
 *   - Is either an absolute path (that exists on disk) or a simple command name
 */
async function validateKicadPath(kicadPath: string): Promise<void> {
  if (SHELL_META.test(kicadPath)) {
    throw new Error(
      `Invalid KiCad path: contains shell metacharacters — "${kicadPath}"`,
    );
  }

  if (PATH_TRAVERSAL.test(kicadPath)) {
    throw new Error(
      `Invalid KiCad path: contains path traversal — "${kicadPath}"`,
    );
  }

  if (isAbsolute(kicadPath)) {
    // Absolute path — verify the directory exists on disk
    try {
      await access(kicadPath);
    } catch {
      throw new Error(
        `Invalid KiCad path: directory does not exist — "${kicadPath}"`,
      );
    }
  } else {
    // Must be a simple directory or command name (no slashes except trailing)
    const cleaned = kicadPath.replace(/\/+$/, "");
    if (cleaned !== basename(cleaned)) {
      throw new Error(
        `Invalid KiCad path: relative paths with directories are not allowed — "${kicadPath}". Use an absolute path or a simple command name.`,
      );
    }
  }
}

// ─── KiCad CLI Wrappers ─────────────────────────────────────

async function runKiCadCli(
  kicadPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  await validateKicadPath(kicadPath);
  const cliPath = join(kicadPath, "kicad-cli");
  try {
    const { stdout, stderr } = await execFileAsync(cliPath, args, {
      timeout: 120_000,
    });
    return { stdout, stderr };
  } catch (err: unknown) {
    const error = err as Error & { stdout?: string; stderr?: string };
    throw new Error(
      `kicad-cli failed: ${error.message}\nstdout: ${error.stdout ?? ""}\nstderr: ${error.stderr ?? ""}`,
    );
  }
}

async function runDRC(
  kicadPath: string,
  pcbFilePath: string,
  outputPath: string,
): Promise<string> {
  const { stdout, stderr } = await runKiCadCli(kicadPath, [
    "pcb", "drc",
    "--output", outputPath,
    "--format", "json",
    "--severity-all",
    pcbFilePath,
  ]);
  return stdout + stderr;
}

async function runAutoRoute(
  kicadPath: string,
  pcbFilePath: string,
): Promise<string> {
  // KiCad 9 introduced `kicad-cli pcb autoroute` as an experimental feature.
  // Fall back to freerouting if the command is not available.
  try {
    const { stdout, stderr } = await runKiCadCli(kicadPath, [
      "pcb", "autoroute",
      pcbFilePath,
    ]);
    return stdout + stderr;
  } catch {
    // Attempt freerouting as a fallback
    try {
      const { stdout, stderr } = await execFileAsync("freerouting", [
        "-de", pcbFilePath,
      ], { timeout: 300_000 });
      return `[freerouting fallback] ${stdout}${stderr}`;
    } catch (frErr: unknown) {
      const error = frErr as Error;
      return `Autorouting unavailable: kicad-cli pcb autoroute failed and freerouting not found. ${error.message}`;
    }
  }
}

async function exportGerbers(
  kicadPath: string,
  pcbFilePath: string,
  outputDir: string,
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const { stdout, stderr } = await runKiCadCli(kicadPath, [
    "pcb", "export", "gerbers",
    "--output", outputDir + "/",
    pcbFilePath,
  ]);
  return stdout + stderr;
}

// ─── Main Export ────────────────────────────────────────────

/**
 * Generate KiCad PCB artifacts from an MHDL document.
 *
 * Pipeline:
 *   1. Generate SKiDL Python script (netlist)
 *   2. Run SKiDL via Python bridge to produce circuit.net
 *   3. Generate .kicad_pcb template with board outline + design rules
 *   4. If kicad-cli is available: run DRC, autoroute, and Gerber export
 *   5. Return all artifacts
 */
export async function generateKiCadPCB(
  doc: MHDLDocument,
  config: ForgeConfig,
): Promise<BuildArtifact[]> {
  const artifacts: BuildArtifact[] = [];
  const projectName = safeId(doc.meta.name);
  const notes: string[] = [];

  // ── Step 1: Generate SKiDL netlist script ──
  const skidlArtifacts = generateSKiDLScript(doc);
  const scriptArtifact = skidlArtifacts.find(a => a.filename === "circuit.py");

  if (!scriptArtifact) {
    throw new Error("SKiDL backend did not produce circuit.py");
  }

  artifacts.push(...skidlArtifacts);

  // ── Step 2: Run SKiDL to produce the netlist ──
  let netlistContent: string | undefined;

  try {
    const workDir = await makeTempDir(projectName);
    const scriptPath = join(workDir, "circuit.py");
    await writeFile(scriptPath, scriptArtifact.content, "utf-8");

    const result = await runPython(
      scriptArtifact.content,
      config.pythonPath,
    );

    if (result.exitCode === 0) {
      // SKiDL writes circuit.net in the current directory; try to read it
      try {
        netlistContent = await readFile(join(workDir, "circuit.net"), "utf-8");
      } catch {
        // SKiDL may write to cwd instead of workDir
        notes.push("SKiDL executed successfully but circuit.net was not found in the work directory. The netlist may have been written to the current working directory.");
      }

      if (netlistContent) {
        artifacts.push({
          stage: "pcb",
          filename: "circuit.net",
          content: netlistContent,
          format: "kicad-netlist",
          backend: "kicad",
        });
      }
    } else {
      notes.push(
        `SKiDL execution failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500)}. ` +
        `Continuing with PCB template generation.`,
      );
    }
  } catch (err: unknown) {
    const error = err as Error;
    notes.push(
      `Python bridge error: ${error.message}. ` +
      `SKiDL/Python may not be installed. Continuing with PCB template generation.`,
    );
  }

  // ── Step 3a: Generate .kicad_sch schematic ──
  const schContent = generateKiCadSchematic(doc);
  const schFilename = `${projectName}.kicad_sch`;

  artifacts.push({
    stage: "pcb",
    filename: schFilename,
    content: schContent,
    format: "kicad-sch",
    backend: "kicad",
  });

  // ── Step 3b: Generate .kicad_pcb template ──
  const pcbContent = generateKiCadPCBContent(doc);
  const pcbFilename = `${projectName}.kicad_pcb`;

  artifacts.push({
    stage: "pcb",
    filename: pcbFilename,
    content: pcbContent,
    format: "kicad-pcb",
    backend: "kicad",
  });

  // ── Step 3c: Generate fabrication outputs ──
  // BOM CSV
  const bomCsv = generateBOMCSV(doc);
  artifacts.push({
    stage: "pcb",
    filename: "fabrication/bom.csv",
    content: bomCsv,
    format: "csv",
    backend: "kicad",
  });

  // Pick-and-Place CSV
  const pnpCsv = generatePickAndPlaceCSV(doc);
  artifacts.push({
    stage: "pcb",
    filename: "fabrication/pick-and-place.csv",
    content: pnpCsv,
    format: "csv",
    backend: "kicad",
  });

  // Gerber file stubs
  const gerberStubs = generateGerberStubs(projectName, doc);
  for (const stub of gerberStubs) {
    artifacts.push({
      stage: "pcb",
      filename: stub.filename,
      content: stub.content,
      format: "gerber",
      backend: "kicad",
    });
  }

  // ── Steps 4-7: KiCad CLI operations (require kicadPath) ──
  if (config.kicadPath) {
    const workDir = await makeTempDir(projectName + "-cli");
    const pcbFilePath = join(workDir, pcbFilename);
    await writeFile(pcbFilePath, pcbContent, "utf-8");

    // ── Step 5: DRC check ──
    try {
      const drcOutputPath = join(workDir, "drc-report.json");
      await runDRC(config.kicadPath, pcbFilePath, drcOutputPath);

      let drcContent: string;
      try {
        drcContent = await readFile(drcOutputPath, "utf-8");
      } catch {
        drcContent = JSON.stringify({ note: "DRC ran but report file was not produced." });
      }

      artifacts.push({
        stage: "pcb",
        filename: "drc-report.json",
        content: drcContent,
        format: "json",
        backend: "kicad",
      });
    } catch (err: unknown) {
      const error = err as Error;
      notes.push(`DRC check failed: ${error.message}`);
    }

    // ── Step 6: Autorouting ──
    if (doc.pcb?.autoRoute) {
      try {
        const routeLog = await runAutoRoute(config.kicadPath, pcbFilePath);

        // Re-read the PCB file after autorouting (it modifies in place)
        try {
          const routedPcb = await readFile(pcbFilePath, "utf-8");
          // Replace the template artifact with the routed version
          const pcbIdx = artifacts.findIndex(
            a => a.filename === pcbFilename && a.backend === "kicad" && a.format === "kicad-pcb",
          );
          if (pcbIdx !== -1) {
            artifacts[pcbIdx] = {
              stage: "pcb",
              filename: pcbFilename,
              content: routedPcb,
              format: "kicad-pcb",
              backend: "kicad",
            };
          }
        } catch {
          // PCB file unchanged, keep the template
        }

        artifacts.push({
          stage: "pcb",
          filename: "autoroute.log",
          content: routeLog,
          format: "text",
          backend: "kicad",
        });
      } catch (err: unknown) {
        const error = err as Error;
        notes.push(`Autorouting failed: ${error.message}`);
      }
    }

    // ── Step 7: Gerber export ──
    try {
      const gerberDir = join(workDir, "gerbers");
      await exportGerbers(config.kicadPath, pcbFilePath, gerberDir);

      // Read all generated Gerber files
      let gerberFiles: string[];
      try {
        gerberFiles = await readdir(gerberDir);
      } catch {
        gerberFiles = [];
      }

      for (const gf of gerberFiles) {
        const gerberContent = await readFile(join(gerberDir, gf), "utf-8");
        artifacts.push({
          stage: "pcb",
          filename: `gerbers/${gf}`,
          content: gerberContent,
          format: "gerber",
          backend: "kicad",
        });
      }

      if (gerberFiles.length === 0) {
        notes.push("Gerber export ran but produced no files.");
      }
    } catch (err: unknown) {
      const error = err as Error;
      notes.push(`Gerber export failed: ${error.message}`);
    }
  } else {
    // No kicad-cli available
    notes.push(
      "KiCad CLI (kicad-cli) is not configured. Set KICAD_PATH to enable " +
      "DRC checks, autorouting, and Gerber export. The .kicad_pcb template " +
      "has been generated and can be opened manually in KiCad 9.",
    );
  }

  // ── Attach notes to the build ──
  if (notes.length > 0) {
    artifacts.push({
      stage: "pcb",
      filename: "kicad-backend.log",
      content: notes.join("\n\n"),
      format: "text",
      backend: "kicad",
    });
  }

  return artifacts;
}
