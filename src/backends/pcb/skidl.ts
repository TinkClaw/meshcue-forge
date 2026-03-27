/**
 * SKiDL PCB Backend
 *
 * Converts MHDL board spec → Python SKiDL script that generates
 * a KiCad netlist for PCB layout. SKiDL is a Python package that
 * lets you describe circuits programmatically and output industry-
 * standard netlists.
 */

import type { MHDLDocument, BuildArtifact, Component, MCU, MCUFamily, ComponentType } from "../../schema/mhdl.js";

// ─── SKiDL Part Mapping ─────────────────────────────────────

interface SKiDLPartDef {
  lib: string;
  name: string;
  footprint: string;
  pinCount?: number;
}

/** Maps MCU families to KiCad library parts and footprints. */
const MCU_PARTS: Record<MCUFamily, SKiDLPartDef> = {
  "esp32":        { lib: "RF_Module", name: "ESP32-WROOM-32",   footprint: "RF_Module:ESP32-WROOM-32" },
  "esp32-s3":     { lib: "RF_Module", name: "ESP32-S3-WROOM-1", footprint: "RF_Module:ESP32-S3-WROOM-1" },
  "esp32-c3":     { lib: "RF_Module", name: "ESP32-C3-WROOM-02",footprint: "RF_Module:ESP32-C3-WROOM-02" },
  "arduino-uno":  { lib: "MCU_Module", name: "Arduino_UNO_R3",  footprint: "Module:Arduino_UNO_R3" },
  "arduino-nano": { lib: "MCU_Module", name: "Arduino_Nano_v3.x", footprint: "Module:Arduino_Nano" },
  "arduino-mega": { lib: "MCU_Module", name: "Arduino_Mega2560",footprint: "Module:Arduino_Mega2560" },
  "rp2040":       { lib: "MCU_RaspberryPi", name: "RP2040",     footprint: "Package_QFN:QFN-56-1EP_7x7mm_P0.4mm_EP3.2x3.2mm" },
  "stm32":        { lib: "MCU_ST_STM32F1", name: "STM32F103C8Tx", footprint: "Package_QFP:LQFP-48_7x7mm_P0.5mm" },
  "attiny85":     { lib: "MCU_Microchip_ATtiny", name: "ATtiny85-20PU", footprint: "Package_DIP:DIP-8_W7.62mm" },
};

/** Maps MHDL component types to KiCad library parts and footprints. */
const COMPONENT_PARTS: Partial<Record<ComponentType, SKiDLPartDef>> = {
  "led":              { lib: "Device", name: "LED",              footprint: "LED_SMD:LED_0805_2012Metric" },
  "button":           { lib: "Switch", name: "SW_Push",          footprint: "Button_Switch_SMD:SW_SPST_CK_RS282G05A3" },
  "resistor":         { lib: "Device", name: "R",                footprint: "Resistor_SMD:R_0805_2012Metric" },
  "capacitor":        { lib: "Device", name: "C",                footprint: "Capacitor_SMD:C_0805_2012Metric" },
  "oled":             { lib: "Display_Graphic", name: "SSD1306", footprint: "Display:OLED_0.96in_I2C" },
  "lcd":              { lib: "Display_Character", name: "LCD1602",footprint: "Display:LCD_1602_DIP" },
  "buzzer":           { lib: "Device", name: "Buzzer",           footprint: "Buzzer_Beeper:Buzzer_12x9.5RM7.6" },
  "sensor":           { lib: "Sensor", name: "Sensor_Generic",   footprint: "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical" },
  "motor":            { lib: "Motor", name: "Motor_DC",          footprint: "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical" },
  "relay":            { lib: "Relay", name: "Relay_SPDT",        footprint: "Relay_THT:Relay_SPDT_Finder_36.11" },
  "diode":            { lib: "Device", name: "D",                footprint: "Diode_SMD:D_0805_2012Metric" },
  "transistor":       { lib: "Device", name: "Q_NPN_BEC",        footprint: "Package_TO_SOT_SMD:SOT-23" },
  "voltage-regulator":{ lib: "Regulator_Linear", name: "AMS1117-3.3", footprint: "Package_TO_SOT_SMD:SOT-223-3_TabPin2" },
  "connector":        { lib: "Connector_Generic", name: "Conn_01x04", footprint: "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical" },
  "crystal":          { lib: "Device", name: "Crystal",          footprint: "Crystal:Crystal_SMD_HC49-SD" },
  "antenna":          { lib: "Device", name: "Antenna",          footprint: "Connector_Coaxial:SMA_Amphenol_132289_EdgeMount" },
  "speaker":          { lib: "Device", name: "Speaker",          footprint: "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical" },
  "microphone":       { lib: "Device", name: "Microphone",       footprint: "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical" },
  "servo":            { lib: "Motor", name: "Motor_Servo",       footprint: "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical" },
  "ir_receiver":      { lib: "Sensor", name: "TSOP38238",        footprint: "OptoDevice:Vishay_MINICAST-3Pin" },
  "ir_emitter":       { lib: "Device", name: "LED_IR",           footprint: "LED_THT:LED_D5.0mm_IRBlack" },
  "neopixel":         { lib: "LED", name: "WS2812B",             footprint: "LED_SMD:LED_WS2812B_PLCC4_5.0x5.0mm_P3.2mm" },
  "ultrasonic":       { lib: "Sensor", name: "HC-SR04",          footprint: "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical" },
  "pir":              { lib: "Sensor", name: "HC-SR501",          footprint: "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical" },
  "ldr":              { lib: "Device", name: "R_Photo",          footprint: "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical" },
  "gps":              { lib: "RF_GPS", name: "NEO-6M",           footprint: "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical" },
  "rfid":             { lib: "RF", name: "MFRC522",              footprint: "Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical" },
  "potentiometer":    { lib: "Device", name: "R_Potentiometer",  footprint: "Potentiometer_THT:Potentiometer_Alps_RK09K_Single_Vertical" },
  "moisture":         { lib: "Sensor", name: "Moisture_Sensor",  footprint: "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical" },
  "gas_sensor":       { lib: "Sensor", name: "MQ-2",             footprint: "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical" },
};

// ─── Helpers ────────────────────────────────────────────────

/** Escape a string for safe interpolation into a Python triple-quoted string. */
function escapePythonString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"""/g, '\\"\\"\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/** Sanitize an MHDL id into a valid Python identifier. */
function pyId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Calculate current-limiting resistor for an LED at the given supply voltage. */
function ledResistorOhms(supplyVoltage: number, ledForwardV = 2.0, currentMa = 20): number {
  const value = Math.ceil((supplyVoltage - ledForwardV) / (currentMa / 1000));
  // Round up to nearest standard E24 value
  const e24 = [10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91, 100];
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const closest = e24.find(v => v >= normalized * 10) ?? 100;
  return (closest / 10) * magnitude;
}

/** Determine supply voltage from MCU family. */
function supplyVoltage(family: MCUFamily): number {
  switch (family) {
    case "esp32":
    case "esp32-s3":
    case "esp32-c3":
    case "rp2040":
      return 3.3;
    case "arduino-uno":
    case "arduino-nano":
    case "arduino-mega":
      return 5.0;
    case "stm32":
    case "attiny85":
      return 3.3;
    default:
      return 3.3;
  }
}

// ─── Script Generator ───────────────────────────────────────

export function generateSKiDLScript(doc: MHDLDocument): BuildArtifact[] {
  const { board, meta } = doc;
  const mcu = board.mcu;
  const vcc = supplyVoltage(mcu.family);
  const mcuPart = MCU_PARTS[mcu.family];
  const lines: string[] = [];

  // ── Header ──
  const safeName = escapePythonString(meta.name);
  const safeDescription = escapePythonString(meta.description);

  lines.push(`#!/usr/bin/env python3`);

  // Medical device disclaimer (if applicable)
  if (doc.meta?.medical) {
    lines.push(`# ⚠️ MEDICAL DEVICE: This PCB design requires professional review.`);
    lines.push(`# Verify trace widths for current capacity, add isolation barriers for`);
    lines.push(`# patient-applied parts, and test EMC per IEC 60601-1-2 before clinical use.`);
    lines.push(``);
  }

  lines.push(`"""`);
  lines.push(`SKiDL PCB Netlist Generator — ${safeName}`);
  lines.push(`${safeDescription}`);
  lines.push(``);
  lines.push(`Auto-generated by MeshCue Forge from MHDL v${meta.schemaVersion}.`);
  lines.push(`Supply voltage: ${vcc}V`);
  lines.push(`"""`);
  lines.push(``);

  // ── Imports ──
  lines.push(`# ─── Imports ─────────────────────────────────────────────────`);
  lines.push(`from skidl import *`);
  lines.push(``);

  // ── MCU Part ──
  lines.push(`# ─── MCU: ${mcu.family} ─────────────────────────────────────`);
  lines.push(`# ${mcu.model || mcu.family} — the main microcontroller`);
  lines.push(`${pyId(mcu.id)} = Part("${mcuPart.lib}", "${mcuPart.name}",`);
  lines.push(`    footprint="${mcuPart.footprint}")`);
  lines.push(``);

  // ── Decoupling Capacitors ──
  lines.push(`# ─── Decoupling Capacitors for MCU ─────────────────────────`);
  lines.push(`# 100nF ceramic close to each VCC pin for high-frequency noise`);
  lines.push(`decap_100n = Part("Device", "C", value="100nF",`);
  lines.push(`    footprint="Capacitor_SMD:C_0805_2012Metric")`);
  lines.push(`# 10uF bulk capacitor for low-frequency stability`);
  lines.push(`decap_10u = Part("Device", "C", value="10uF",`);
  lines.push(`    footprint="Capacitor_SMD:C_0805_2012Metric")`);
  lines.push(``);

  // ── Power Rails ──
  lines.push(`# ─── Power Rails ─────────────────────────────────────────────`);
  lines.push(`# VCC and GND nets that all components share`);
  lines.push(`vcc_net = Net("VCC")`);
  lines.push(`gnd_net = Net("GND")`);
  lines.push(``);

  // ── Components ──
  lines.push(`# ─── Components ──────────────────────────────────────────────`);

  // Track which LEDs need resistors
  const ledIds: string[] = [];

  for (const comp of board.components) {
    const partDef = COMPONENT_PARTS[comp.type];
    if (!partDef && comp.type !== "custom") {
      lines.push(`# WARNING: No SKiDL mapping for component type "${comp.type}" (${comp.id})`);
      lines.push(`# Using a generic connector placeholder`);
      lines.push(`${pyId(comp.id)} = Part("Connector_Generic", "Conn_01x04",`);
      lines.push(`    footprint="Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical")`);
      lines.push(``);
      continue;
    }

    if (comp.type === "custom") {
      const fp = comp.footprint || "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical";
      const model = comp.model || "Conn_01x04";
      lines.push(`# Custom component: ${comp.id}`);
      lines.push(`${pyId(comp.id)} = Part("Connector_Generic", "${model}",`);
      lines.push(`    footprint="${fp}")`);
      lines.push(``);
      continue;
    }

    const pd = partDef!;
    const valueStr = comp.value ? `, value="${comp.value}"` : "";
    lines.push(`# ${comp.type}: ${comp.id}${comp.model ? ` (${comp.model})` : ""}`);
    lines.push(`${pyId(comp.id)} = Part("${pd.lib}", "${pd.name}"${valueStr},`);
    lines.push(`    footprint="${comp.footprint || pd.footprint}")`);
    lines.push(``);

    // Track LEDs for auto-resistor insertion
    if (comp.type === "led") {
      ledIds.push(comp.id);
    }
  }

  // ── Auto-generated current-limiting resistors for LEDs ──
  if (ledIds.length > 0) {
    const rValue = ledResistorOhms(vcc);
    lines.push(`# ─── Current-Limiting Resistors for LEDs ─────────────────────`);
    lines.push(`# Auto-calculated for ${vcc}V supply, ~2V forward drop, 20mA:`);
    lines.push(`# R = (${vcc}V - 2.0V) / 0.020A = ${Math.round((vcc - 2.0) / 0.020)}Ω → ${rValue}Ω (nearest E24)`);
    for (const ledId of ledIds) {
      const rId = `r_${pyId(ledId)}`;
      lines.push(`${rId} = Part("Device", "R", value="${rValue}",`);
      lines.push(`    footprint="Resistor_SMD:R_0805_2012Metric")`);
    }
    lines.push(``);
  }

  // ── Nets from Connections ──
  lines.push(`# ─── Signal Nets (from MHDL connections) ───────────────────`);

  // Group connections by net name or generate auto-names
  let netIndex = 0;
  for (const conn of board.connections) {
    const [fromComp, fromPin] = conn.from.split(".");
    const [toComp, toPin] = conn.to.split(".");

    const netName = conn.net || `N${String(netIndex).padStart(3, "0")}_${pyId(fromComp)}_${pyId(fromPin)}`;
    netIndex++;

    // Determine if this is a power/ground connection
    const allComps = [board.mcu as Component, ...board.components];
    const fromComponent = allComps.find(c => c.id === fromComp);
    const fromPinDef = fromComponent?.pins.find(p => p.id === fromPin);
    const toComponent = allComps.find(c => c.id === toComp);
    const toPinDef = toComponent?.pins.find(p => p.id === toPin);

    if (fromPinDef?.mode === "power" || toPinDef?.mode === "power") {
      lines.push(`# Power connection: ${conn.from} → ${conn.to}`);
      lines.push(`vcc_net += ${pyId(fromComp)}["${fromPin}"], ${pyId(toComp)}["${toPin}"]`);
    } else if (fromPinDef?.mode === "ground" || toPinDef?.mode === "ground") {
      lines.push(`# Ground connection: ${conn.from} → ${conn.to}`);
      lines.push(`gnd_net += ${pyId(fromComp)}["${fromPin}"], ${pyId(toComp)}["${toPin}"]`);
    } else {
      lines.push(`# Signal: ${conn.from} → ${conn.to}`);
      lines.push(`net_${pyId(netName)} = Net("${netName}")`);
      lines.push(`net_${pyId(netName)} += ${pyId(fromComp)}["${fromPin}"], ${pyId(toComp)}["${toPin}"]`);
    }
  }
  lines.push(``);

  // ── Connect decoupling caps to power rails ──
  lines.push(`# ─── Decoupling Capacitor Connections ──────────────────────`);
  lines.push(`# Tie decoupling caps between VCC and GND, close to the MCU`);
  lines.push(`vcc_net += decap_100n[1], decap_10u[1]`);
  lines.push(`gnd_net += decap_100n[2], decap_10u[2]`);
  lines.push(``);

  // ── Connect MCU power pins to rails ──
  lines.push(`# ─── MCU Power Connections ─────────────────────────────────`);
  lines.push(`# Connect MCU VCC and GND pins to the power rails`);

  const mcuVccPins = mcu.pins.filter(p => p.mode === "power");
  const mcuGndPins = mcu.pins.filter(p => p.mode === "ground");

  if (mcuVccPins.length > 0) {
    const vccPinList = mcuVccPins.map(p => `${pyId(mcu.id)}["${p.id}"]`).join(", ");
    lines.push(`vcc_net += ${vccPinList}`);
  } else {
    lines.push(`# Note: No explicit VCC pins defined on MCU — connect manually`);
    lines.push(`# vcc_net += ${pyId(mcu.id)}["VCC"]`);
  }

  if (mcuGndPins.length > 0) {
    const gndPinList = mcuGndPins.map(p => `${pyId(mcu.id)}["${p.id}"]`).join(", ");
    lines.push(`gnd_net += ${gndPinList}`);
  } else {
    lines.push(`# Note: No explicit GND pins defined on MCU — connect manually`);
    lines.push(`# gnd_net += ${pyId(mcu.id)}["GND"]`);
  }
  lines.push(``);

  // ── LED resistor wiring ──
  if (ledIds.length > 0) {
    lines.push(`# ─── LED Resistor Wiring ─────────────────────────────────`);
    lines.push(`# Each LED anode connects through its resistor to the signal net.`);
    lines.push(`# The resistor is inserted in series — reconnect as needed for`);
    lines.push(`# your specific pin assignments.`);
    for (const ledId of ledIds) {
      const rId = `r_${pyId(ledId)}`;
      lines.push(`# ${ledId}: signal → R → LED anode; LED cathode → GND`);
      lines.push(`${rId}[1] += ${pyId(ledId)}[1]  # Resistor pad 1 to LED anode`);
      lines.push(`gnd_net += ${pyId(ledId)}[2]     # LED cathode to GND`);
    }
    lines.push(``);
  }

  // ── Generate Netlist ──
  lines.push(`# ─── Output ──────────────────────────────────────────────────`);
  lines.push(`# Generate KiCad-compatible netlist for PCB layout`);
  lines.push(`generate_netlist()`);
  lines.push(``);
  lines.push(`print("Netlist generated successfully: circuit.net")`);
  lines.push(`print("Open in KiCad Pcbnew to import and route the PCB.")`);

  const scriptContent = lines.join("\n");

  // ── KiCad project stub ──
  const kicadPro = {
    meta: {
      filename: `${pyId(meta.name)}.kicad_pro`,
      version: 1,
    },
    project: {
      name: meta.name,
      description: meta.description,
      created: new Date().toISOString(),
      generator: "MeshCue Forge SKiDL Backend",
    },
    board: {
      design_settings: {
        layers: doc.pcb?.layers ?? 2,
        copper_weight: doc.pcb?.copperWeight ?? "1oz",
        surface_finish: doc.pcb?.surfaceFinish ?? "hasl",
        board_width_mm: doc.pcb?.widthMm ?? board.dimensions?.widthMm ?? 50,
        board_height_mm: doc.pcb?.heightMm ?? board.dimensions?.heightMm ?? 50,
      },
      auto_route: doc.pcb?.autoRoute ?? false,
    },
    net_classes: {
      Default: {
        clearance: 0.2,
        track_width: 0.25,
        via_diameter: 0.8,
        via_drill: 0.4,
      },
      Power: {
        clearance: 0.3,
        track_width: 0.5,
        via_diameter: 1.0,
        via_drill: 0.5,
      },
    },
  };

  return [
    {
      stage: "pcb",
      filename: "circuit.py",
      content: scriptContent,
      format: "python",
      backend: "skidl",
    },
    {
      stage: "pcb",
      filename: `${pyId(meta.name)}.kicad_pro`,
      content: JSON.stringify(kicadPro, null, 2),
      format: "kicad-project",
      backend: "skidl",
    },
  ];
}
