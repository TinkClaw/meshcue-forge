/**
 * MHDL Validation — Design Rule Checks
 *
 * Every build runs this pipeline before generating artifacts.
 * Nothing ships without passing DRC.
 */

import type {
  MHDLDocument,
  ValidationResult,
  ValidationIssue,
  MedicalStats,
} from "./mhdl.js";

// ─── Known current draws (mA) ────────────────────────────────

const CURRENT_ESTIMATES: Record<string, number> = {
  led: 20,
  oled: 30,
  lcd: 40,
  buzzer: 30,
  button: 0,
  resistor: 0,
  capacitor: 0,
  sensor: 15,
  motor: 200,
  relay: 70,
  antenna: 0,
  crystal: 0,
  transistor: 5,
  diode: 0,
  connector: 0,
  custom: 0,
};

const MCU_CURRENT: Record<string, number> = {
  esp32: 240,
  "esp32-s3": 310,
  "esp32-c3": 160,
  "arduino-uno": 50,
  "arduino-nano": 45,
  "arduino-mega": 70,
  rp2040: 100,
  stm32: 80,
  attiny85: 10,
};

// ─── GPIO voltage by MCU family ──────────────────────────────

const GPIO_VOLTAGE: Record<string, number> = {
  esp32: 3.3,
  "esp32-s3": 3.3,
  "esp32-c3": 3.3,
  "arduino-uno": 5,
  "arduino-nano": 5,
  "arduino-mega": 5,
  rp2040: 3.3,
  stm32: 3.3,
  attiny85: 5,
};

// ─── Components that typically need 5V logic ─────────────────

const TYPICALLY_5V_COMPONENTS = new Set(["relay", "motor", "stepper"]);

// ─── Components that are typically 3.3V only ─────────────────

const TYPICALLY_3V3_COMPONENTS = new Set(["oled"]);

// ─── Default I2C addresses for common component models ───────

const DEFAULT_I2C_ADDRESSES: Record<string, string> = {
  "SSD1306": "0x3C",
  "SH1106": "0x3C",
  "BMP280": "0x76",
  "BME280": "0x76",
  "BME680": "0x76",
  "AHT20": "0x38",
  "MPU6050": "0x68",
  "DS3231": "0x68",
  "PCF8574": "0x20",
  "PCA9685": "0x40",
};

// ─── Validators ──────────────────────────────────────────────

function checkPinConflicts(doc: MHDLDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Collect all GPIO usage from components (NOT the MCU — MCU pins mirror component pins)
  // Only flag conflicts when two non-MCU components share the same GPIO
  const componentGpioUsage = new Map<number, string[]>();
  for (const comp of doc.board.components) {
    for (const pin of comp.pins) {
      if (pin.gpio !== undefined) {
        const users = componentGpioUsage.get(pin.gpio) || [];
        users.push(`${comp.id}.${pin.id}`);
        componentGpioUsage.set(pin.gpio, users);
      }
    }
  }

  // Flag conflicts only between distinct components
  for (const [gpio, users] of componentGpioUsage) {
    if (users.length > 1) {
      issues.push({
        severity: "error",
        code: "PIN_CONFLICT",
        message: `GPIO ${gpio} is used by multiple components: ${users.join(", ")}`,
        path: `board.connections`,
        fix: `Reassign one of the components to a different GPIO pin`,
      });
    }
  }

  return issues;
}

function checkI2CAddresses(doc: MHDLDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const addresses = new Map<string, string>();

  for (const comp of doc.board.components) {
    // Use explicit i2cAddress, or fall back to known defaults by model
    let addr = comp.properties?.["i2cAddress"] as string | undefined;
    if (!addr && comp.model) {
      addr = DEFAULT_I2C_ADDRESSES[comp.model];
    }
    if (addr) {
      if (addresses.has(addr)) {
        issues.push({
          severity: "error",
          code: "I2C_COLLISION",
          message: `I2C address ${addr} collision: ${addresses.get(addr)} and ${comp.id}`,
          path: `board.components.${comp.id}`,
          fix: `Change the I2C address on one device (check datasheet for address select pins)`,
        });
      } else {
        addresses.set(addr, comp.id);
      }
    }
  }

  return issues;
}

function checkPowerBudget(doc: MHDLDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  let totalMa = MCU_CURRENT[doc.board.mcu.family] || 100;

  for (const comp of doc.board.components) {
    totalMa += CURRENT_ESTIMATES[comp.type] || 10;
  }

  const maxMa = doc.board.power.maxCurrentMa;

  if (totalMa > maxMa) {
    issues.push({
      severity: "error",
      code: "POWER_EXCEEDED",
      message: `Estimated current draw ${totalMa}mA exceeds power budget ${maxMa}mA`,
      path: "board.power",
      fix: `Increase maxCurrentMa to at least ${totalMa} or reduce components`,
    });
  } else if (totalMa > maxMa * 0.8) {
    issues.push({
      severity: "warning",
      code: "POWER_MARGIN_LOW",
      message: `Current draw ${totalMa}mA is ${Math.round((totalMa / maxMa) * 100)}% of budget — low margin`,
      path: "board.power",
      fix: `Consider a higher-rated power supply for reliability`,
    });
  }

  return issues;
}

function checkConnectionIntegrity(doc: MHDLDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const allPins = new Set<string>();

  // Build pin registry
  const allComponents = [doc.board.mcu, ...doc.board.components];
  for (const comp of allComponents) {
    for (const pin of comp.pins) {
      allPins.add(`${comp.id}.${pin.id}`);
    }
  }

  // Check all connections reference valid pins
  for (const conn of doc.board.connections) {
    if (!allPins.has(conn.from)) {
      issues.push({
        severity: "error",
        code: "INVALID_PIN_REF",
        message: `Connection references non-existent pin: ${conn.from}`,
        path: "board.connections",
        fix: `Check component and pin IDs — available pins: ${[...allPins].join(", ")}`,
      });
    }
    if (!allPins.has(conn.to)) {
      issues.push({
        severity: "error",
        code: "INVALID_PIN_REF",
        message: `Connection references non-existent pin: ${conn.to}`,
        path: "board.connections",
        fix: `Check component and pin IDs — available pins: ${[...allPins].join(", ")}`,
      });
    }
  }

  // Check for unconnected component pins (warning only)
  const connectedPins = new Set<string>();
  for (const conn of doc.board.connections) {
    connectedPins.add(conn.from);
    connectedPins.add(conn.to);
  }

  for (const comp of doc.board.components) {
    for (const pin of comp.pins) {
      const pinRef = `${comp.id}.${pin.id}`;
      if (!connectedPins.has(pinRef) && pin.mode !== "ground" && pin.mode !== "power") {
        issues.push({
          severity: "warning",
          code: "UNCONNECTED_PIN",
          message: `Pin ${pinRef} is not connected to anything`,
          path: `board.components.${comp.id}`,
          fix: `Add a connection for this pin or remove it from the component definition`,
        });
      }
    }
  }

  return issues;
}

function checkEnclosureFit(doc: MHDLDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!doc.board.dimensions) {
    issues.push({
      severity: "warning",
      code: "NO_BOARD_DIMENSIONS",
      message: "Board dimensions not specified — enclosure will use defaults",
      path: "board.dimensions",
      fix: "Add dimensions (widthMm, heightMm) for accurate enclosure generation",
    });
    return issues;
  }

  // Check cutouts reference valid components
  for (const cutout of doc.enclosure.cutouts) {
    if (cutout.componentRef) {
      const exists = doc.board.components.some((c) => c.id === cutout.componentRef) ||
        doc.board.mcu.id === cutout.componentRef;
      if (!exists) {
        issues.push({
          severity: "error",
          code: "CUTOUT_INVALID_REF",
          message: `Cutout references non-existent component: ${cutout.componentRef}`,
          path: "enclosure.cutouts",
          fix: `Check component ID — valid IDs: ${[doc.board.mcu.id, ...doc.board.components.map((c) => c.id)].join(", ")}`,
        });
      }
    }
  }

  return issues;
}

function checkMountingAlignment(doc: MHDLDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (doc.board.mountingHoles && doc.board.dimensions) {
    for (const pos of doc.board.mountingHoles.positions) {
      if (
        pos.x < 0 ||
        pos.y < 0 ||
        pos.x > doc.board.dimensions.widthMm ||
        pos.y > doc.board.dimensions.heightMm
      ) {
        issues.push({
          severity: "error",
          code: "MOUNT_OUT_OF_BOUNDS",
          message: `Mounting hole at (${pos.x}, ${pos.y}) is outside board dimensions`,
          path: "board.mountingHoles",
          fix: `Move hole inside board area (0-${doc.board.dimensions.widthMm}mm x 0-${doc.board.dimensions.heightMm}mm)`,
        });
      }
    }
  }

  return issues;
}

// ─── Advanced DRC Validators ─────────────────────────────────

function checkElectricalSafety(doc: MHDLDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const family = doc.board.mcu.family;
  const gpioV = GPIO_VOLTAGE[family] ?? 3.3;

  for (const comp of doc.board.components) {
    // 3.3V logic MCU driving typically-5V components
    if (gpioV <= 3.3 && TYPICALLY_5V_COMPONENTS.has(comp.type)) {
      issues.push({
        severity: "warning",
        code: "VOLTAGE_MISMATCH_5V",
        message: `${comp.id} (${comp.type}) typically needs 5V logic, but ${family} is ${gpioV}V — use a level shifter or logic-level variant`,
        path: `board.components.${comp.id}`,
        fix: `Add a level shifter between MCU and ${comp.id}, or choose a 3.3V-compatible module`,
      });
    }

    // 5V logic MCU driving typically-3.3V-only components
    if (gpioV >= 5 && TYPICALLY_3V3_COMPONENTS.has(comp.type)) {
      issues.push({
        severity: "warning",
        code: "VOLTAGE_MISMATCH_3V3",
        message: `${comp.id} (${comp.type}) is typically 3.3V only, but ${family} outputs ${gpioV}V — risk of damage`,
        path: `board.components.${comp.id}`,
        fix: `Add a level shifter or voltage divider, or use a 5V-tolerant variant`,
      });
    }

    // LED forward voltage check
    if (comp.type === "led") {
      const vf = comp.properties?.["forwardVoltage"] as number | undefined;
      if (vf !== undefined && vf > gpioV) {
        issues.push({
          severity: "error",
          code: "LED_VF_EXCEEDS_GPIO",
          message: `LED ${comp.id} forward voltage ${vf}V exceeds GPIO voltage ${gpioV}V — LED will not light`,
          path: `board.components.${comp.id}`,
          fix: `Use a lower-Vf LED or drive from a higher voltage rail with a transistor`,
        });
      }
    }
  }

  return issues;
}

function checkMechanicalSpacing(doc: MHDLDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const dims = doc.board.dimensions;

  if (!dims) return issues;

  // Check that mounting holes are not too close to board edges (< 3mm)
  if (doc.board.mountingHoles) {
    const minEdge = 3;
    for (const pos of doc.board.mountingHoles.positions) {
      const distLeft = pos.x;
      const distRight = dims.widthMm - pos.x;
      const distBottom = pos.y;
      const distTop = dims.heightMm - pos.y;
      const closest = Math.min(distLeft, distRight, distBottom, distTop);

      if (closest > 0 && closest < minEdge) {
        issues.push({
          severity: "warning",
          code: "MOUNT_HOLE_NEAR_EDGE",
          message: `Mounting hole at (${pos.x}, ${pos.y}) is only ${closest.toFixed(1)}mm from board edge — minimum recommended is ${minEdge}mm`,
          path: "board.mountingHoles",
          fix: `Move mounting hole at least ${minEdge}mm from all edges to prevent cracking`,
        });
      }
    }
  }

  // Check that cutouts on the same wall do not overlap
  const cutoutsByWall = new Map<string, Array<{ idx: number; x: number; w: number; label: string }>>();

  for (let i = 0; i < doc.enclosure.cutouts.length; i++) {
    const cutout = doc.enclosure.cutouts[i];
    if (cutout.position && cutout.size) {
      const entries = cutoutsByWall.get(cutout.wall) || [];
      entries.push({
        idx: i,
        x: cutout.position.x,
        w: cutout.size.width,
        label: cutout.componentRef || cutout.type,
      });
      cutoutsByWall.set(cutout.wall, entries);
    }
  }

  for (const [wall, entries] of cutoutsByWall) {
    // Sort by x position
    const sorted = entries.sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (a.x + a.w > b.x) {
        issues.push({
          severity: "warning",
          code: "CUTOUT_OVERLAP",
          message: `Cutouts "${a.label}" and "${b.label}" overlap on ${wall} wall`,
          path: "enclosure.cutouts",
          fix: `Reposition cutouts on the ${wall} wall to avoid overlap or move one to a different wall`,
        });
      }
    }
  }

  // Check board size is large enough for components (simple heuristic)
  const compArea = doc.board.components.length * 100; // ~10x10mm per component
  const boardArea = dims.widthMm * dims.heightMm;
  if (compArea > boardArea * 0.9) {
    issues.push({
      severity: "warning",
      code: "BOARD_TOO_CROWDED",
      message: `${doc.board.components.length} components may not fit on a ${dims.widthMm}x${dims.heightMm}mm board`,
      path: "board.dimensions",
      fix: `Increase board dimensions or reduce component count`,
    });
  }

  return issues;
}

function checkThermalDesign(doc: MHDLDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const family = doc.board.mcu.family;

  // Estimate total current
  let totalMa = MCU_CURRENT[family] || 100;

  // If ESP32 with both WiFi and BLE active, add 200mA overhead
  const wireless = doc.board.mcu.wireless || [];
  const hasWifi = wireless.includes("wifi");
  const hasBle = wireless.includes("ble") || wireless.includes("bluetooth");
  if ((family === "esp32" || family === "esp32-s3" || family === "esp32-c3") && hasWifi && hasBle) {
    totalMa += 200;
    issues.push({
      severity: "info",
      code: "WIFI_BLE_CURRENT",
      message: `${family} with WiFi + BLE active adds ~200mA — estimated MCU draw now ${(MCU_CURRENT[family] || 100) + 200}mA`,
      path: "board.mcu",
    });
  }

  for (const comp of doc.board.components) {
    totalMa += CURRENT_ESTIMATES[comp.type] || 10;
  }

  // High current draw warning
  if (totalMa > 500) {
    issues.push({
      severity: "warning",
      code: "HEAT_MANAGEMENT",
      message: `Total estimated draw is ${totalMa}mA — consider heat dissipation (heatsink, ventilation, copper pour)`,
      path: "board.power",
      fix: `Add ventilation to enclosure, use a heatsink on the regulator, or add a ground plane for heat spreading`,
    });
  }

  // Motor/relay without flyback diode
  const hasMotorOrRelay = doc.board.components.some(
    (c) => c.type === "motor" || c.type === "relay" || c.type === "stepper" || c.type === "servo"
  );
  const hasFlybackDiode = doc.board.components.some(
    (c) => c.type === "diode" && (c.properties?.["flyback"] === true || c.id.includes("flyback"))
  );

  if (hasMotorOrRelay && !hasFlybackDiode) {
    issues.push({
      severity: "warning",
      code: "MISSING_FLYBACK_DIODE",
      message: "Inductive load (motor/relay) present without a flyback diode — back-EMF can damage the MCU",
      path: "board.components",
      fix: `Add a flyback diode (e.g. 1N4007) across each inductive load`,
    });
  }

  return issues;
}

function checkComponentCompatibility(doc: MHDLDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // SPI devices without CS pins
  const spiDevices = doc.board.components.filter((c) =>
    c.pins.some((p) => p.mode === "spi-mosi" || p.mode === "spi-miso" || p.mode === "spi-sck")
  );

  for (const spiDev of spiDevices) {
    const hasCS = spiDev.pins.some((p) => p.mode === "spi-cs");
    if (!hasCS) {
      issues.push({
        severity: "warning",
        code: "SPI_MISSING_CS",
        message: `SPI device ${spiDev.id} has no chip-select (CS) pin — it cannot share the SPI bus`,
        path: `board.components.${spiDev.id}`,
        fix: `Add a spi-cs pin to ${spiDev.id} and connect it to a GPIO`,
      });
    }
  }

  // UART devices sharing the same peripheral (same TX/RX GPIO pairs)
  const uartDevices: Array<{ id: string; txGpio?: number; rxGpio?: number }> = [];
  for (const comp of doc.board.components) {
    const txPin = comp.pins.find((p) => p.mode === "uart-tx");
    const rxPin = comp.pins.find((p) => p.mode === "uart-rx");
    if (txPin || rxPin) {
      uartDevices.push({ id: comp.id, txGpio: txPin?.gpio, rxGpio: rxPin?.gpio });
    }
  }

  for (let i = 0; i < uartDevices.length; i++) {
    for (let j = i + 1; j < uartDevices.length; j++) {
      const a = uartDevices[i];
      const b = uartDevices[j];
      // If they share the same TX or RX GPIO, they conflict
      if (
        (a.txGpio !== undefined && a.txGpio === b.txGpio) ||
        (a.rxGpio !== undefined && a.rxGpio === b.rxGpio)
      ) {
        issues.push({
          severity: "warning",
          code: "UART_PERIPHERAL_CONFLICT",
          message: `UART devices ${a.id} and ${b.id} share the same UART peripheral pins — only one can communicate at a time`,
          path: "board.components",
          fix: `Use a different UART peripheral (different GPIO pair) for ${b.id}, or multiplex with a UART switch`,
        });
      }
    }
  }

  return issues;
}

function checkPCBConstraints(doc: MHDLDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pcb = doc.pcb;

  if (!pcb) return issues;

  // Trace width check
  if (pcb.traceWidthMm !== undefined && pcb.traceWidthMm < 0.15) {
    issues.push({
      severity: "warning",
      code: "PCB_TRACE_TOO_THIN",
      message: `Trace width ${pcb.traceWidthMm}mm is below manufacturing minimum (0.15mm) — most fabs will reject this`,
      path: "pcb.traceWidthMm",
      fix: `Increase trace width to at least 0.15mm (0.25mm recommended for signal traces)`,
    });
  }

  // Via size check
  if (pcb.viaSizeMm !== undefined && pcb.viaSizeMm < 0.3) {
    issues.push({
      severity: "warning",
      code: "PCB_VIA_TOO_SMALL",
      message: `Via size ${pcb.viaSizeMm}mm is below manufacturing minimum (0.3mm) — most fabs require >= 0.3mm`,
      path: "pcb.viaSizeMm",
      fix: `Increase via size to at least 0.3mm`,
    });
  }

  // Board size check — too small for mounting
  const w = pcb.widthMm ?? doc.board.dimensions?.widthMm;
  const h = pcb.heightMm ?? doc.board.dimensions?.heightMm;
  if (w !== undefined && h !== undefined && w < 10 && h < 10) {
    issues.push({
      severity: "warning",
      code: "PCB_TOO_SMALL",
      message: `PCB size ${w}x${h}mm is too small for mounting holes — consider increasing board size`,
      path: "pcb",
      fix: `Increase board dimensions to at least 10x10mm if mounting holes are needed`,
    });
  }

  return issues;
}

// ─── Medical Device Safety Checks ────────────────────────────

/** IP rating numeric value for comparison */
const IP_RATING_VALUE: Record<string, number> = {
  IP20: 20,
  IP44: 44,
  IP54: 54,
  IP65: 65,
  IP67: 67,
  IP68: 68,
};

function checkMedicalSafety(doc: MHDLDocument, issues: ValidationIssue[]): number {
  let checksRun = 0;

  // (a) Patient isolation — mains/high-voltage without isolation
  checksRun++;
  const hasMainsPower = doc.board.power.source === "dc-jack" || doc.board.power.voltageIn > 48;
  const hasIsolation = doc.board.components.some(
    (c) =>
      c.id.toLowerCase().includes("isolat") ||
      c.type === "custom" && c.properties?.["isolation"] === true
  );
  if (hasMainsPower && !hasIsolation) {
    issues.push({
      severity: "error",
      code: "MED_PATIENT_ISOLATION",
      message:
        "Medical device has mains/high-voltage power without patient isolation — patient-applied parts must be isolated from mains per IEC 60601-1",
      path: "board.power",
      fix: "Add galvanic isolation (optocouplers, isolated DC-DC converter) between mains and patient-applied circuits",
    });
  }

  // (b) Alarm requirements — no buzzer or speaker
  checksRun++;
  const hasBuzzerOrSpeaker = doc.board.components.some(
    (c) => c.type === "buzzer" || c.type === "speaker"
  );
  if (!hasBuzzerOrSpeaker) {
    issues.push({
      severity: "warning",
      code: "MED_NO_ALARM",
      message:
        "No buzzer or speaker component present — medical monitoring devices should have audible alarms per IEC 60601-1-8",
      path: "board.components",
      fix: "Add a buzzer or speaker component for audible alarm capability",
    });
  }

  // (c) Battery backup — mains-powered without battery
  checksRun++;
  const isMainsPowered = doc.board.power.source === "dc-jack" || doc.board.power.source === "usb";
  const hasBatteryBackup =
    doc.board.power.source === "battery" ||
    doc.board.power.batteryMah !== undefined ||
    doc.board.components.some((c) => c.id.toLowerCase().includes("battery") || c.id.toLowerCase().includes("ups"));
  if (isMainsPowered && !hasBatteryBackup) {
    issues.push({
      severity: "warning",
      code: "MED_NO_BATTERY_BACKUP",
      message:
        "Device is mains-powered without battery backup — critical medical devices need UPS/battery continuity",
      path: "board.power",
      fix: "Add a battery backup (LiPo + charging circuit) for power continuity during outages",
    });
  }

  // (d) Biocompatibility — PLA not suitable for patient contact
  checksRun++;
  if (doc.enclosure.biocompatible === true && doc.enclosure.material === "pla") {
    issues.push({
      severity: "warning",
      code: "MED_PLA_BIOCOMPAT",
      message:
        "Enclosure marked biocompatible but material is PLA — PLA is not suitable for patient contact. Recommend PETG, PP, or medical-grade materials",
      path: "enclosure.material",
      fix: "Change enclosure material to PETG, PP, PC, PEEK, or medical-grade silicone",
    });
  }

  // (e) Sterilization compatibility — PLA/PETG cannot survive autoclave
  checksRun++;
  if (doc.enclosure.sterilization === "autoclave") {
    const mat = doc.enclosure.material;
    if (mat === "pla" || mat === "petg") {
      issues.push({
        severity: "error",
        code: "MED_AUTOCLAVE_MATERIAL",
        message: `Enclosure material "${mat}" cannot withstand autoclave temperatures (121-134°C) — will deform. Must use PEEK, PP, or Nylon`,
        path: "enclosure.material",
        fix: "Change material to PEEK, PP, or Nylon for autoclave sterilization compatibility",
      });
    }
  }

  // (f) Display readability — OLED/LCD without brightness consideration
  checksRun++;
  const hasDisplay = doc.board.components.some(
    (c) => c.type === "oled" || c.type === "lcd"
  );
  if (hasDisplay) {
    const hasBacklightConfig = doc.board.components.some(
      (c) =>
        (c.type === "oled" || c.type === "lcd") &&
        (c.properties?.["backlight"] !== undefined ||
          c.properties?.["brightness"] !== undefined ||
          c.properties?.["minFontSize"] !== undefined)
    );
    if (!hasBacklightConfig) {
      issues.push({
        severity: "warning",
        code: "MED_DISPLAY_READABILITY",
        message:
          "OLED/LCD display present without backlight/brightness configuration — clinical environments require high-visibility displays. Recommend specifying minimum font size",
        path: "board.components",
        fix: "Add brightness/backlight and minFontSize properties to the display component for clinical readability",
      });
    }
  }

  // (g) Data logging — monitoring device without data export
  checksRun++;
  const hasSensors = doc.board.components.some((c) => c.type === "sensor" || c.type === "temperature_sensor" || c.type === "thermocouple" || c.type === "gas_sensor");
  const hasDataExport = doc.board.components.some(
    (c) =>
      c.id.toLowerCase().includes("sd") ||
      c.type === "custom" && c.properties?.["sdCard"] === true
  );
  const hasWirelessExport = doc.board.mcu.wireless && doc.board.mcu.wireless.length > 0;
  const hasSDCutout = doc.enclosure.cutouts.some((c) => c.type === "sd-card");
  if (hasSensors && !hasDataExport && !hasWirelessExport && !hasSDCutout) {
    issues.push({
      severity: "warning",
      code: "MED_NO_DATA_LOGGING",
      message:
        "Monitoring device (has sensors) but no SD card or wireless data export — clinical data should be recorded",
      path: "board.components",
      fix: "Add an SD card module or enable wireless (WiFi/BLE) for clinical data logging",
    });
  }

  // (h) Watchdog timer — firmware without watchdog
  checksRun++;
  const hasWatchdog =
    doc.firmware.features?.some((f) => f.toLowerCase().includes("watchdog")) ||
    doc.firmware.buildFlags?.some((f) => f.toLowerCase().includes("watchdog"));
  if (!hasWatchdog) {
    issues.push({
      severity: "warning",
      code: "MED_NO_WATCHDOG",
      message:
        "Firmware config does not mention watchdog — medical firmware should use a hardware watchdog timer for crash recovery",
      path: "firmware",
      fix: "Add 'watchdog' to firmware features or enable hardware watchdog in build flags",
    });
  }

  // (i) Power indicator — no LED designated as power indicator
  checksRun++;
  const hasPowerLed = doc.board.components.some(
    (c) =>
      c.type === "led" &&
      (c.id.toLowerCase().includes("power") ||
        c.properties?.["role"] === "power" ||
        c.properties?.["color"] === "green" && c.id.toLowerCase().includes("pwr"))
  );
  if (!hasPowerLed) {
    issues.push({
      severity: "warning",
      code: "MED_NO_POWER_INDICATOR",
      message:
        "No LED designated as power indicator — users must know device is on",
      path: "board.components",
      fix: "Add an LED component with id containing 'power' or set properties.role to 'power'",
    });
  }

  // (j) Low battery warning — battery-powered without low battery indication
  checksRun++;
  const isBatteryPowered =
    doc.board.power.source === "battery" || doc.board.power.batteryMah !== undefined;
  if (isBatteryPowered) {
    const hasBatteryIndicator = doc.board.components.some(
      (c) =>
        (c.type === "led" || c.type === "buzzer") &&
        (c.id.toLowerCase().includes("batt") || c.properties?.["role"] === "battery")
    );
    if (!hasBatteryIndicator) {
      issues.push({
        severity: "warning",
        code: "MED_NO_LOW_BATTERY",
        message:
          "Battery-powered device without low battery indication (no LED or buzzer for battery state)",
        path: "board.components",
        fix: "Add an LED or buzzer designated for low battery warning (id containing 'battery' or properties.role = 'battery')",
      });
    }
  }

  // (k) EMC consideration — always an info note for medical devices
  checksRun++;
  issues.push({
    severity: "info",
    code: "MED_EMC_NOTE",
    message:
      "Medical devices require EMC testing per IEC 60601-1-2. Consider shielding for sensitive analog inputs (ECG, SpO2).",
    path: "board",
  });

  // (l) Enclosure IP rating — should be at least IP44
  checksRun++;
  const ipRating = doc.enclosure.ipRating;
  if (!ipRating || IP_RATING_VALUE[ipRating] < IP_RATING_VALUE["IP44"]) {
    issues.push({
      severity: "warning",
      code: "MED_LOW_IP_RATING",
      message: `Medical device enclosure ${ipRating ? `has IP rating ${ipRating}` : "has no IP rating set"} — minimum IP44 (splash-protected) recommended for medical devices`,
      path: "enclosure.ipRating",
      fix: "Set enclosure ipRating to at least IP44 for splash protection",
    });
  }

  // (m) Tropical climate — operating temperature range
  checksRun++;
  const hasTemperatureRange = doc.board.components.some(
    (c) =>
      c.properties?.["operatingTempMin"] !== undefined ||
      c.properties?.["operatingTempMax"] !== undefined
  );
  const metaHasTemp = doc.meta.tags?.some((t) => t.toLowerCase().includes("temperature-rated"));
  if (!hasTemperatureRange && !metaHasTemp) {
    issues.push({
      severity: "warning",
      code: "MED_NO_TEMP_RANGE",
      message:
        "Operating temperature range not specified — developing country deployments face 0-50°C ambient",
      path: "board.components",
      fix: "Specify operatingTempMin and operatingTempMax properties on critical components, or add 'temperature-rated' tag",
    });
  }

  return checksRun;
}

// ─── Main Validator ──────────────────────────────────────────

export function validate(doc: MHDLDocument): ValidationResult {
  const issues: ValidationIssue[] = [
    // Core checks
    ...checkPinConflicts(doc),
    ...checkI2CAddresses(doc),
    ...checkPowerBudget(doc),
    ...checkConnectionIntegrity(doc),
    ...checkEnclosureFit(doc),
    ...checkMountingAlignment(doc),
    // Advanced DRC
    ...checkElectricalSafety(doc),
    ...checkMechanicalSpacing(doc),
    ...checkThermalDesign(doc),
    ...checkComponentCompatibility(doc),
    ...checkPCBConstraints(doc),
  ];

  // Medical safety checks — only run when medical flag is set
  let medicalChecksRun = 0;
  if (doc.meta?.medical === true) {
    medicalChecksRun = checkMedicalSafety(doc, issues);
  }

  // Calculate stats
  let estimatedCurrentMa = MCU_CURRENT[doc.board.mcu.family] || 100;
  for (const comp of doc.board.components) {
    estimatedCurrentMa += CURRENT_ESTIMATES[comp.type] || 10;
  }

  const dims = doc.board.dimensions;
  const wall = doc.enclosure.wallThicknessMm;
  const enclosureVolumeMm3 = dims
    ? (dims.widthMm + wall * 2) *
      (dims.heightMm + wall * 2) *
      ((dims.depthMm || 25) + wall * 2)
    : 0;

  const connectedPins = new Set<string>();
  for (const conn of doc.board.connections) {
    connectedPins.add(conn.from);
    connectedPins.add(conn.to);
  }

  const totalPins = [doc.board.mcu, ...doc.board.components].reduce(
    (sum, c) => sum + c.pins.length,
    0
  );

  // Medical stats
  let medicalStats: MedicalStats | undefined;
  if (doc.meta?.medical === true) {
    const medicalWarnings = issues.filter(
      (i) => i.code.startsWith("MED_") && (i.severity === "warning" || i.severity === "error")
    ).length;

    // Rough battery hours estimate: common battery sizes / total current
    let estimatedBatteryHours: number | undefined;
    const batteryMah = doc.board.power.batteryMah;
    if (batteryMah && estimatedCurrentMa > 0) {
      estimatedBatteryHours = Math.round((batteryMah / estimatedCurrentMa) * 10) / 10;
    }

    medicalStats = {
      medicalClass: doc.meta.deviceClass,
      medicalChecks: medicalChecksRun,
      medicalWarnings,
      estimatedBatteryHours,
    };
  }

  return {
    valid: !issues.some((i) => i.severity === "error"),
    issues,
    stats: {
      componentCount: doc.board.components.length + 1,
      connectionCount: doc.board.connections.length,
      pinUsage: totalPins > 0 ? Math.round((connectedPins.size / totalPins) * 100) : 0,
      estimatedCurrentMa,
      enclosureVolumeMm3,
      ...(medicalStats ? { medical: medicalStats } : {}),
    },
  };
}
