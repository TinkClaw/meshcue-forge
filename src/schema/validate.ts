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

// ─── Validators ──────────────────────────────────────────────

function checkPinConflicts(doc: MHDLDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const gpioUsage = new Map<number, string[]>();

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
    const addr = comp.properties?.["i2cAddress"] as string | undefined;
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

// ─── Main Validator ──────────────────────────────────────────

export function validate(doc: MHDLDocument): ValidationResult {
  const issues: ValidationIssue[] = [
    ...checkPinConflicts(doc),
    ...checkI2CAddresses(doc),
    ...checkPowerBudget(doc),
    ...checkConnectionIntegrity(doc),
    ...checkEnclosureFit(doc),
    ...checkMountingAlignment(doc),
  ];

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

  return {
    valid: !issues.some((i) => i.severity === "error"),
    issues,
    stats: {
      componentCount: doc.board.components.length + 1,
      connectionCount: doc.board.connections.length,
      pinUsage: totalPins > 0 ? Math.round((connectedPins.size / totalPins) * 100) : 0,
      estimatedCurrentMa,
      enclosureVolumeMm3,
    },
  };
}
