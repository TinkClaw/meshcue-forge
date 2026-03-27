/**
 * Wokwi Circuit Backend
 *
 * Converts MHDL board spec → Wokwi diagram.json format
 * for browser-based simulation.
 */

import type { MHDLDocument, BuildArtifact, Component, MCU } from "../../schema/mhdl.js";

// ─── Wokwi Component Mapping ────────────────────────────────

const WOKWI_PARTS: Record<string, string> = {
  "esp32": "board-esp32-devkit-c-v4",
  "esp32-s3": "board-esp32-s3-devkitc-1",
  "esp32-c3": "board-esp32-c3-devkitm-1",
  "arduino-uno": "wokwi-arduino-uno",
  "arduino-nano": "wokwi-arduino-nano",
  "arduino-mega": "wokwi-arduino-mega",
  "rp2040": "board-pi-pico",
  "led": "wokwi-led",
  "button": "wokwi-pushbutton",
  "resistor": "wokwi-resistor",
  "capacitor": "wokwi-capacitor",
  "buzzer": "wokwi-buzzer",
  "oled": "board-ssd1306",
  "lcd": "wokwi-lcd1602",
  "sensor": "wokwi-dht22",
  "motor": "wokwi-servo",
  "relay": "wokwi-relay-module",
  "diode": "wokwi-diode",
  "transistor": "wokwi-npn-transistor",
};

// ─── Layout Engine ───────────────────────────────────────────

interface WokwiPart {
  type: string;
  id: string;
  top: number;
  left: number;
  attrs?: Record<string, string>;
}

interface WokwiConnection {
  from: string;
  to: string;
  color: string;
}

interface WokwiDiagram {
  version: 1;
  author: string;
  editor: string;
  parts: WokwiPart[];
  connections: WokwiConnection[];
}

function layoutPosition(index: number): { top: number; left: number } {
  const col = Math.floor(index / 6);
  const row = index % 6;
  return {
    top: 100 + row * 80,
    left: 50 + col * 250,
  };
}

function mapComponentAttrs(comp: Component): Record<string, string> {
  const attrs: Record<string, string> = {};

  if (comp.type === "led" && comp.properties?.["color"]) {
    attrs["color"] = String(comp.properties["color"]);
  }
  if (comp.type === "resistor" && comp.value) {
    attrs["resistance"] = comp.value;
  }
  if (comp.type === "capacitor" && comp.value) {
    attrs["capacitance"] = comp.value;
  }

  return attrs;
}

// ─── Pin Mapping ─────────────────────────────────────────────

function resolveWokwiPin(componentId: string, pinId: string, componentType: string): string {
  // Map our pin IDs to Wokwi pin format
  return `${componentId}:${pinId}`;
}

const WIRE_COLORS: Record<string, string> = {
  power: "red",
  ground: "black",
  "i2c-sda": "blue",
  "i2c-scl": "purple",
  "spi-mosi": "orange",
  "spi-miso": "yellow",
  "spi-sck": "green",
  "digital-out": "green",
  "digital-in": "cyan",
  "analog-in": "gold",
  pwm: "orange",
  "uart-tx": "white",
  "uart-rx": "gray",
};

// ─── Generator ───────────────────────────────────────────────

export function generateWokwiCircuit(doc: MHDLDocument): BuildArtifact {
  const parts: WokwiPart[] = [];
  const connections: WokwiConnection[] = [];

  // Place MCU
  const mcuType = WOKWI_PARTS[doc.board.mcu.family] || "board-esp32-devkit-c-v4";
  parts.push({
    type: mcuType,
    id: doc.board.mcu.id,
    top: 0,
    left: 0,
  });

  // Place components
  doc.board.components.forEach((comp, idx) => {
    const partType = WOKWI_PARTS[comp.type];
    if (!partType) return;

    const pos = layoutPosition(idx);
    const attrs = mapComponentAttrs(comp);

    parts.push({
      type: partType,
      id: comp.id,
      top: pos.top,
      left: pos.left,
      ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    });
  });

  // Map connections
  for (const conn of doc.board.connections) {
    // Determine wire color from pin mode
    const [fromCompId, fromPinId] = conn.from.split(".");
    const allComps = [doc.board.mcu, ...doc.board.components];
    const fromComp = allComps.find((c) => c.id === fromCompId);
    const fromPin = fromComp?.pins.find((p) => p.id === fromPinId);

    const color = conn.color || WIRE_COLORS[fromPin?.mode || "digital-out"] || "green";

    connections.push({
      from: conn.from.replace(".", ":"),
      to: conn.to.replace(".", ":"),
      color,
    });
  }

  const diagram: WokwiDiagram = {
    version: 1,
    author: "MeshCue Forge",
    editor: "meshforge",
    parts,
    connections,
  };

  return {
    stage: "circuit",
    filename: "diagram.json",
    content: JSON.stringify(diagram, null, 2),
    format: "wokwi-json",
  };
}
