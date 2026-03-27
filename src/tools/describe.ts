/**
 * meshforge-describe
 *
 * Takes a natural language description of a hardware project
 * and generates a complete MHDL document.
 *
 * This is the "magic" tool — describe what you want, get a buildable spec.
 */

import type {
  MHDLDocument,
  MCU,
  Component,
  Connection,
  Pin,
  MCUFamily,
  ComponentType,
  PinMode,
  EnclosureType,
  CutoutType,
} from "../schema/mhdl.js";

// ─── Component Templates ────────────────────────────────────

interface ComponentTemplate {
  type: ComponentType;
  defaultPins: Pin[];
  defaultProperties?: Record<string, string | number | boolean>;
  cutoutType?: CutoutType;
  cutoutWall?: "front" | "back" | "left" | "right";
  currentMa: number;
}

const TEMPLATES: Record<string, ComponentTemplate> = {
  led: {
    type: "led",
    defaultPins: [
      { id: "anode", mode: "digital-out" },
      { id: "cathode", mode: "ground" },
    ],
    defaultProperties: { color: "green" },
    cutoutType: "led-hole",
    cutoutWall: "front",
    currentMa: 20,
  },
  button: {
    type: "button",
    defaultPins: [
      { id: "sig", mode: "digital-in" },
      { id: "gnd", mode: "ground" },
    ],
    cutoutType: "button-cap",
    cutoutWall: "front",
    currentMa: 0,
  },
  oled: {
    type: "oled",
    defaultPins: [
      { id: "sda", mode: "i2c-sda" },
      { id: "scl", mode: "i2c-scl" },
      { id: "vcc", mode: "power" },
      { id: "gnd", mode: "ground" },
    ],
    defaultProperties: { i2cAddress: "0x3C", width: 128, height: 64, startupText: "MeshCue Forge" },
    cutoutType: "oled-window",
    cutoutWall: "front",
    currentMa: 30,
  },
  buzzer: {
    type: "buzzer",
    defaultPins: [
      { id: "sig", mode: "pwm" },
      { id: "gnd", mode: "ground" },
    ],
    currentMa: 30,
  },
  sensor: {
    type: "sensor",
    defaultPins: [
      { id: "data", mode: "digital-in" },
      { id: "vcc", mode: "power" },
      { id: "gnd", mode: "ground" },
    ],
    currentMa: 15,
  },
};

// ─── MCU Templates ───────────────────────────────────────────

const MCU_TEMPLATES: Record<MCUFamily, Partial<MCU>> = {
  esp32: {
    family: "esp32",
    model: "ESP32-DevKitC-V4",
    clockMhz: 240,
    flashKb: 4096,
    ramKb: 520,
    wireless: ["wifi", "bluetooth"],
  },
  "esp32-s3": {
    family: "esp32-s3",
    model: "ESP32-S3-DevKitC-1",
    clockMhz: 240,
    flashKb: 8192,
    ramKb: 512,
    wireless: ["wifi", "ble"],
  },
  "esp32-c3": {
    family: "esp32-c3",
    model: "ESP32-C3-DevKitM-1",
    clockMhz: 160,
    flashKb: 4096,
    ramKb: 400,
    wireless: ["wifi", "ble"],
  },
  "arduino-uno": {
    family: "arduino-uno",
    model: "Arduino Uno R3",
    clockMhz: 16,
    flashKb: 32,
    ramKb: 2,
    wireless: [],
  },
  "arduino-nano": {
    family: "arduino-nano",
    model: "Arduino Nano",
    clockMhz: 16,
    flashKb: 32,
    ramKb: 2,
    wireless: [],
  },
  "arduino-mega": {
    family: "arduino-mega",
    model: "Arduino Mega 2560",
    clockMhz: 16,
    flashKb: 256,
    ramKb: 8,
    wireless: [],
  },
  rp2040: {
    family: "rp2040",
    model: "Raspberry Pi Pico",
    clockMhz: 133,
    flashKb: 2048,
    ramKb: 264,
    wireless: [],
  },
  stm32: {
    family: "stm32",
    model: "STM32F103C8T6",
    clockMhz: 72,
    flashKb: 64,
    ramKb: 20,
    wireless: [],
  },
  attiny85: {
    family: "attiny85",
    model: "ATtiny85",
    clockMhz: 8,
    flashKb: 8,
    ramKb: 0.5,
    wireless: [],
  },
};

// ─── GPIO Allocator ──────────────────────────────────────────

const GPIO_POOLS: Record<string, number[]> = {
  esp32: [2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33],
  "esp32-s3": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 35, 36, 37, 38],
  "esp32-c3": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 18, 19, 20, 21],
  "arduino-uno": [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  "arduino-nano": [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  "arduino-mega": [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 22, 23, 24, 25, 26, 27, 28, 29],
  rp2040: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
  stm32: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  attiny85: [0, 1, 2, 3, 4],
};

// I2C default pins
const I2C_PINS: Record<string, { sda: number; scl: number }> = {
  esp32: { sda: 21, scl: 22 },
  "esp32-s3": { sda: 8, scl: 9 },
  "esp32-c3": { sda: 8, scl: 9 },
  "arduino-uno": { sda: 18, scl: 19 }, // A4, A5
  "arduino-nano": { sda: 18, scl: 19 },
  "arduino-mega": { sda: 20, scl: 21 },
  rp2040: { sda: 4, scl: 5 },
  stm32: { sda: 7, scl: 6 },
  attiny85: { sda: 0, scl: 2 },
};

class GPIOAllocator {
  private available: number[];
  private family: string;

  constructor(family: MCUFamily) {
    this.family = family;
    this.available = [...(GPIO_POOLS[family] || GPIO_POOLS.esp32)];
    // Reserve I2C pins
    const i2c = I2C_PINS[family];
    if (i2c) {
      this.available = this.available.filter((p) => p !== i2c.sda && p !== i2c.scl);
    }
  }

  allocate(mode: PinMode): number | undefined {
    if (mode === "i2c-sda") return I2C_PINS[this.family]?.sda;
    if (mode === "i2c-scl") return I2C_PINS[this.family]?.scl;
    if (mode === "ground" || mode === "power") return undefined;
    return this.available.shift();
  }
}

// ─── Parser Helpers ──────────────────────────────────────────

interface ParsedComponent {
  name: string;
  type: string;
  color?: string;
  quantity: number;
  model?: string;
}

function parseComponents(description: string): ParsedComponent[] {
  const components: ParsedComponent[] = [];
  const desc = description.toLowerCase();

  // LED patterns
  const ledColors = ["red", "green", "blue", "yellow", "white", "orange", "purple"];
  const ledMatch = desc.match(/(\d+)\s*(?:x\s*)?(?:status\s+)?leds?/i);
  const colorMatches = desc.match(
    new RegExp(`(${ledColors.join("|")})\\s+leds?`, "gi")
  );

  if (colorMatches) {
    for (const match of colorMatches) {
      const color = match.split(/\s+/)[0];
      components.push({ name: `led_${color}`, type: "led", color, quantity: 1 });
    }
  } else if (ledMatch) {
    const count = parseInt(ledMatch[1], 10);
    const defaultColors = ["green", "yellow", "red", "blue", "white"];
    for (let i = 0; i < count; i++) {
      const color = defaultColors[i % defaultColors.length];
      components.push({ name: `led_${color}`, type: "led", color, quantity: 1 });
    }
  } else if (desc.includes("led")) {
    components.push({ name: "led_green", type: "led", color: "green", quantity: 1 });
  }

  // OLED / LCD
  if (desc.includes("oled")) {
    components.push({ name: "oled", type: "oled", quantity: 1 });
  }
  if (desc.includes("lcd")) {
    components.push({ name: "lcd", type: "oled", quantity: 1, model: "LCD1602" });
  }

  // Buttons
  const buttonMatch = desc.match(/(\d+)\s*(?:x\s*)?(?:push\s*)?buttons?/i);
  if (buttonMatch) {
    const count = parseInt(buttonMatch[1], 10);
    const buttonNames = ["pair", "reset", "mode", "select", "up", "down"];
    for (let i = 0; i < count; i++) {
      components.push({
        name: `btn_${buttonNames[i % buttonNames.length]}`,
        type: "button",
        quantity: 1,
      });
    }
  } else if (desc.includes("button")) {
    components.push({ name: "btn_main", type: "button", quantity: 1 });
  }

  // Buzzer
  if (desc.includes("buzzer") || desc.includes("speaker") || desc.includes("audio alert")) {
    components.push({ name: "buzzer", type: "buzzer", quantity: 1 });
  }

  // Sensors
  if (desc.includes("temperature") || desc.includes("humidity") || desc.includes("dht")) {
    components.push({ name: "temp_sensor", type: "sensor", quantity: 1, model: "DHT22" });
  }

  return components;
}

function parseMCU(description: string): MCUFamily {
  const desc = description.toLowerCase();
  if (desc.includes("esp32-s3")) return "esp32-s3";
  if (desc.includes("esp32-c3")) return "esp32-c3";
  if (desc.includes("esp32")) return "esp32";
  if (desc.includes("arduino mega")) return "arduino-mega";
  if (desc.includes("arduino nano")) return "arduino-nano";
  if (desc.includes("arduino")) return "arduino-uno";
  if (desc.includes("pico") || desc.includes("rp2040")) return "rp2040";
  if (desc.includes("stm32")) return "stm32";
  if (desc.includes("attiny")) return "attiny85";

  // Default: if needs wifi, use ESP32
  if (desc.includes("wifi") || desc.includes("mesh") || desc.includes("wireless") || desc.includes("iot")) {
    return "esp32-s3";
  }
  return "esp32";
}

function parseEnclosureType(description: string): EnclosureType {
  const desc = description.toLowerCase();
  if (desc.includes("screw")) return "screw-close";
  if (desc.includes("slide")) return "slide-on";
  if (desc.includes("open")) return "open-frame";
  return "snap-fit";
}

function parseName(description: string): string {
  // Try to extract a project name
  const nameMatch = description.match(
    /(?:called|named|for|build(?:ing)?)\s+(?:a\s+)?["']?([A-Z][A-Za-z0-9\-_ ]+)/
  );
  if (nameMatch) return nameMatch[1].trim();

  // Fallback: generate from description
  const words = description
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return words.join("-") || "MeshCue Forge-Board";
}

// ─── Main Describe Function ─────────────────────────────────

export function describe(naturalLanguage: string): MHDLDocument {
  const mcuFamily = parseMCU(naturalLanguage);
  const mcuTemplate = MCU_TEMPLATES[mcuFamily];
  const parsedComponents = parseComponents(naturalLanguage);
  const allocator = new GPIOAllocator(mcuFamily);
  const name = parseName(naturalLanguage);

  // Build MCU
  const mcu: MCU = {
    id: "mcu",
    type: "mcu",
    family: mcuFamily,
    model: mcuTemplate.model,
    clockMhz: mcuTemplate.clockMhz,
    flashKb: mcuTemplate.flashKb,
    ramKb: mcuTemplate.ramKb,
    wireless: mcuTemplate.wireless || [],
    pins: [],
  };

  // Build components and connections
  const components: Component[] = [];
  const connections: Connection[] = [];
  const cutouts: import("../schema/mhdl.js").Cutout[] = [];

  for (const parsed of parsedComponents) {
    const template = TEMPLATES[parsed.type];
    if (!template) continue;

    const comp: Component = {
      id: parsed.name,
      type: template.type,
      model: parsed.model,
      pins: template.defaultPins.map((p) => ({
        ...p,
        gpio: allocator.allocate(p.mode),
      })),
      properties: { ...template.defaultProperties },
    };

    if (parsed.color && comp.properties) {
      comp.properties["color"] = parsed.color;
    }

    components.push(comp);

    // Auto-connect pins to MCU
    for (const pin of comp.pins) {
      if (pin.gpio !== undefined && pin.mode !== "ground" && pin.mode !== "power") {
        // Create MCU pin
        const mcuPin: Pin = {
          id: `${parsed.name}_${pin.id}`,
          gpio: pin.gpio,
          mode: pin.mode,
          label: `→ ${parsed.name}`,
        };
        mcu.pins.push(mcuPin);

        connections.push({
          from: `mcu.${mcuPin.id}`,
          to: `${parsed.name}.${pin.id}`,
          type: "wire",
        });
      }
    }

    // Auto-generate cutout
    if (template.cutoutType) {
      cutouts.push({
        type: template.cutoutType,
        componentRef: parsed.name,
        wall: template.cutoutWall || "front",
      });
    }
  }

  // USB cutout for MCU
  cutouts.push({
    type: "usb-c",
    componentRef: "mcu",
    wall: "back",
  });

  // Estimate board size based on component count
  const compCount = components.length;
  const boardW = Math.max(50, 30 + compCount * 8);
  const boardH = Math.max(35, 25 + compCount * 5);

  const doc: MHDLDocument = {
    meta: {
      schemaVersion: "0.1.0",
      name,
      description: naturalLanguage,
      version: "1.0.0",
      license: "MIT",
      author: "MeshCue Forge",
    },
    board: {
      mcu,
      components,
      connections,
      power: {
        source: "usb",
        voltageIn: 5,
        regulatorOut: 3.3,
        maxCurrentMa: 500,
      },
      dimensions: {
        widthMm: boardW,
        heightMm: boardH,
        depthMm: 20,
      },
      mountingHoles: {
        diameterMm: 3,
        positions: [
          { x: 4, y: 4 },
          { x: boardW - 4, y: 4 },
          { x: 4, y: boardH - 4 },
          { x: boardW - 4, y: boardH - 4 },
        ],
      },
    },
    firmware: {
      framework: "arduino",
      entrypoint: "main.ino",
      libraries: [],
      boardId: undefined,
      features: [],
    },
    enclosure: {
      type: parseEnclosureType(naturalLanguage),
      wallThicknessMm: 2,
      cornerRadiusMm: 3,
      cutouts,
      mounts: "m3-inserts",
      ventilation: true,
      labelEmboss: name,
      material: "pla",
      printOrientation: "upright",
    },
    bom: {
      auto: true,
      preferredSuppliers: ["digikey", "mouser"],
    },
    docs: {
      generatePinout: true,
      generateAssembly: true,
      generateBOM: true,
      generatePrintGuide: true,
    },
  };

  // Add required libraries based on components
  const hasOLED = components.some((c) => c.type === "oled");
  const hasDHT = components.some((c) => c.model?.toLowerCase().includes("dht"));

  if (hasOLED) {
    doc.firmware.libraries.push(
      { name: "Adafruit_SSD1306", source: "arduino" },
      { name: "Adafruit_GFX", source: "arduino" }
    );
  }
  if (hasDHT) {
    doc.firmware.libraries.push({ name: "DHT", source: "arduino" });
  }

  return doc;
}
