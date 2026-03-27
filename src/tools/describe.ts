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
  speaker: {
    type: "speaker" as ComponentType,
    defaultPins: [
      { id: "sig", mode: "pwm" as PinMode },
      { id: "gnd", mode: "ground" as PinMode },
    ],
    cutoutType: "speaker-grille" as CutoutType,
    cutoutWall: "front",
    currentMa: 100,
  },
  microphone: {
    type: "microphone" as ComponentType,
    defaultPins: [
      { id: "data", mode: "analog-in" as PinMode },
      { id: "vcc", mode: "power" as PinMode },
      { id: "gnd", mode: "ground" as PinMode },
    ],
    cutoutType: "mic-hole" as CutoutType,
    cutoutWall: "front",
    currentMa: 5,
  },
  servo: {
    type: "servo" as ComponentType,
    defaultPins: [
      { id: "sig", mode: "pwm" as PinMode },
      { id: "vcc", mode: "power" as PinMode },
      { id: "gnd", mode: "ground" as PinMode },
    ],
    currentMa: 200,
  },
  motor: {
    type: "motor" as ComponentType,
    defaultPins: [
      { id: "in1", mode: "digital-out" as PinMode },
      { id: "in2", mode: "digital-out" as PinMode },
      { id: "gnd", mode: "ground" as PinMode },
    ],
    currentMa: 300,
  },
  relay: {
    type: "relay" as ComponentType,
    defaultPins: [
      { id: "sig", mode: "digital-out" as PinMode },
      { id: "vcc", mode: "power" as PinMode },
      { id: "gnd", mode: "ground" as PinMode },
    ],
    currentMa: 70,
  },
  ir_receiver: {
    type: "ir_receiver" as ComponentType,
    defaultPins: [
      { id: "data", mode: "digital-in" as PinMode },
      { id: "vcc", mode: "power" as PinMode },
      { id: "gnd", mode: "ground" as PinMode },
    ],
    currentMa: 5,
  },
  ir_emitter: {
    type: "ir_emitter" as ComponentType,
    defaultPins: [
      { id: "sig", mode: "digital-out" as PinMode },
      { id: "gnd", mode: "ground" as PinMode },
    ],
    currentMa: 20,
  },
  neopixel: {
    type: "neopixel" as ComponentType,
    defaultPins: [
      { id: "data", mode: "digital-out" as PinMode },
      { id: "vcc", mode: "power" as PinMode },
      { id: "gnd", mode: "ground" as PinMode },
    ],
    currentMa: 60,
  },
  ultrasonic: {
    type: "ultrasonic" as ComponentType,
    defaultPins: [
      { id: "trig", mode: "digital-out" as PinMode },
      { id: "echo", mode: "digital-in" as PinMode },
      { id: "vcc", mode: "power" as PinMode },
      { id: "gnd", mode: "ground" as PinMode },
    ],
    currentMa: 15,
  },
  pir: {
    type: "pir" as ComponentType,
    defaultPins: [
      { id: "data", mode: "digital-in" as PinMode },
      { id: "vcc", mode: "power" as PinMode },
      { id: "gnd", mode: "ground" as PinMode },
    ],
    currentMa: 10,
  },
  ldr: {
    type: "ldr" as ComponentType,
    defaultPins: [
      { id: "data", mode: "analog-in" as PinMode },
      { id: "gnd", mode: "ground" as PinMode },
    ],
    currentMa: 1,
  },
  gps: {
    type: "gps" as ComponentType,
    defaultPins: [
      { id: "tx", mode: "uart-tx" as PinMode },
      { id: "rx", mode: "uart-rx" as PinMode },
      { id: "vcc", mode: "power" as PinMode },
      { id: "gnd", mode: "ground" as PinMode },
    ],
    currentMa: 50,
  },
  rfid: {
    type: "rfid" as ComponentType,
    defaultPins: [
      { id: "sda", mode: "i2c-sda" as PinMode },
      { id: "scl", mode: "i2c-scl" as PinMode },
      { id: "vcc", mode: "power" as PinMode },
      { id: "gnd", mode: "ground" as PinMode },
    ],
    currentMa: 30,
  },
  potentiometer: {
    type: "potentiometer" as ComponentType,
    defaultPins: [
      { id: "wiper", mode: "analog-in" as PinMode },
      { id: "vcc", mode: "power" as PinMode },
      { id: "gnd", mode: "ground" as PinMode },
    ],
    currentMa: 1,
  },
  moisture: {
    type: "moisture" as ComponentType,
    defaultPins: [
      { id: "data", mode: "analog-in" as PinMode },
      { id: "vcc", mode: "power" as PinMode },
      { id: "gnd", mode: "ground" as PinMode },
    ],
    currentMa: 5,
  },
  gas_sensor: {
    type: "gas_sensor" as ComponentType,
    defaultPins: [
      { id: "data", mode: "analog-in" as PinMode },
      { id: "vcc", mode: "power" as PinMode },
      { id: "gnd", mode: "ground" as PinMode },
    ],
    currentMa: 150,
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

// ─── Product Archetypes ──────────────────────────────────────

interface ProductArchetype {
  mcu: MCUFamily;
  components: Array<{ id: string; type: string; color?: string }>;
  power?: string;
  enclosure?: string;
  keywords: string[];
}

const PRODUCT_ARCHETYPES: Record<string, ProductArchetype> = {
  "talking mouse": { mcu: "esp32-s3", components: [{ id: "speaker", type: "speaker" }, { id: "microphone", type: "microphone" }, { id: "btn_talk", type: "button" }, { id: "led_status", type: "led", color: "blue" }], power: "battery", keywords: ["talking", "mouse", "toy", "plush", "stuffed"] },
  "talking toy": { mcu: "esp32-s3", components: [{ id: "speaker", type: "speaker" }, { id: "microphone", type: "microphone" }, { id: "btn_talk", type: "button" }, { id: "led_status", type: "led", color: "blue" }], power: "battery", keywords: ["talking", "toy", "interactive", "voice"] },
  "robot car": { mcu: "esp32", components: [{ id: "motor_left", type: "motor" }, { id: "motor_right", type: "motor" }, { id: "ultrasonic", type: "ultrasonic" }, { id: "led_front", type: "led", color: "white" }, { id: "led_rear", type: "led", color: "red" }, { id: "buzzer", type: "buzzer" }, { id: "ir_receiver", type: "ir_receiver" }], power: "battery", keywords: ["robot", "car", "rover", "vehicle", "drive"] },
  "smart doorbell": { mcu: "esp32-s3", components: [{ id: "btn_ring", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "microphone", type: "microphone" }, { id: "speaker", type: "speaker" }, { id: "pir", type: "pir" }], power: "usb", keywords: ["doorbell", "door", "bell", "ring", "visitor"] },
  "smart light": { mcu: "esp32", components: [{ id: "neopixel_strip", type: "neopixel" }, { id: "ldr", type: "ldr" }, { id: "pir", type: "pir" }, { id: "btn_mode", type: "button" }], power: "usb", keywords: ["smart light", "lamp", "light strip", "mood light", "rgb light", "ambient"] },
  "thermostat": { mcu: "esp32", components: [{ id: "oled", type: "oled" }, { id: "temp_sensor", type: "sensor" }, { id: "relay", type: "relay" }, { id: "btn_up", type: "button" }, { id: "btn_down", type: "button" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["thermostat", "hvac", "heating", "cooling", "climate", "temperature control"] },
  "smart plug": { mcu: "esp32", components: [{ id: "relay", type: "relay" }, { id: "led_status", type: "led", color: "green" }, { id: "btn_toggle", type: "button" }, { id: "sensor_current", type: "sensor" }], power: "usb", keywords: ["smart plug", "outlet", "power", "switch"] },
  "smart lock": { mcu: "esp32-s3", components: [{ id: "servo", type: "servo" }, { id: "rfid", type: "rfid" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "btn_open", type: "button" }], power: "battery", keywords: ["smart lock", "door lock", "keyless", "access", "entry"] },
  "alarm system": { mcu: "esp32-s3", components: [{ id: "pir", type: "pir" }, { id: "buzzer", type: "buzzer" }, { id: "oled", type: "oled" }, { id: "led_alarm", type: "led", color: "red" }, { id: "led_armed", type: "led", color: "green" }, { id: "btn_arm", type: "button" }, { id: "btn_disarm", type: "button" }], power: "usb", keywords: ["alarm", "security", "intrusion", "motion detect", "burglar"] },
  "smoke detector": { mcu: "esp32", components: [{ id: "gas_sensor", type: "gas_sensor" }, { id: "buzzer", type: "buzzer" }, { id: "led_alarm", type: "led", color: "red" }, { id: "led_ok", type: "led", color: "green" }], power: "battery", keywords: ["smoke", "fire", "detector", "gas", "co2"] },
  "baby monitor": { mcu: "esp32-s3", components: [{ id: "microphone", type: "microphone" }, { id: "speaker", type: "speaker" }, { id: "oled", type: "oled" }, { id: "temp_sensor", type: "sensor" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["baby monitor", "nursery", "infant", "child"] },
  "plant monitor": { mcu: "esp32", components: [{ id: "moisture", type: "moisture" }, { id: "temp_sensor", type: "sensor" }, { id: "oled", type: "oled" }, { id: "led_dry", type: "led", color: "red" }, { id: "led_ok", type: "led", color: "green" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["plant", "garden", "soil", "moisture", "water", "grow"] },
  "weather station": { mcu: "esp32", components: [{ id: "temp_sensor", type: "sensor" }, { id: "oled", type: "oled" }, { id: "ldr", type: "ldr" }, { id: "led_status", type: "led", color: "blue" }], power: "usb", keywords: ["weather", "station", "climate", "rain", "forecast", "barometer"] },
  "irrigation controller": { mcu: "esp32", components: [{ id: "moisture", type: "moisture" }, { id: "relay", type: "relay" }, { id: "oled", type: "oled" }, { id: "btn_manual", type: "button" }, { id: "led_pump", type: "led", color: "blue" }], power: "usb", keywords: ["irrigation", "sprinkler", "watering", "drip"] },
  "pet feeder": { mcu: "esp32", components: [{ id: "servo", type: "servo" }, { id: "oled", type: "oled" }, { id: "btn_feed", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "led_status", type: "led", color: "green" }, { id: "ultrasonic", type: "ultrasonic" }], power: "usb", keywords: ["pet", "feeder", "cat", "dog", "food", "treat", "dispenser"] },
  "pet tracker": { mcu: "esp32-s3", components: [{ id: "gps", type: "gps" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["pet tracker", "collar", "tracking", "find my"] },
  "fitness tracker": { mcu: "esp32-s3", components: [{ id: "oled", type: "oled" }, { id: "sensor_imu", type: "sensor" }, { id: "buzzer", type: "buzzer" }, { id: "btn_mode", type: "button" }], power: "battery", keywords: ["fitness", "tracker", "step", "pedometer", "health", "wristband", "watch"] },
  "music box": { mcu: "esp32-s3", components: [{ id: "speaker", type: "speaker" }, { id: "btn_play", type: "button" }, { id: "btn_next", type: "button" }, { id: "potentiometer", type: "potentiometer" }], power: "battery", keywords: ["music box", "jukebox", "mp3", "audio player", "sound"] },
  "guitar tuner": { mcu: "esp32", components: [{ id: "microphone", type: "microphone" }, { id: "oled", type: "oled" }, { id: "led_flat", type: "led", color: "red" }, { id: "led_tune", type: "led", color: "green" }, { id: "led_sharp", type: "led", color: "yellow" }, { id: "btn_mode", type: "button" }], power: "battery", keywords: ["guitar", "tuner", "instrument", "pitch", "tune"] },
  "simon game": { mcu: "arduino-uno", components: [{ id: "led_red", type: "led", color: "red" }, { id: "led_green", type: "led", color: "green" }, { id: "led_blue", type: "led", color: "blue" }, { id: "led_yellow", type: "led", color: "yellow" }, { id: "btn_red", type: "button" }, { id: "btn_green", type: "button" }, { id: "btn_blue", type: "button" }, { id: "btn_yellow", type: "button" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["simon", "game", "memory", "pattern"] },
  "reaction timer": { mcu: "arduino-uno", components: [{ id: "led_go", type: "led", color: "green" }, { id: "led_wait", type: "led", color: "red" }, { id: "btn_player1", type: "button" }, { id: "btn_player2", type: "button" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["reaction", "timer", "reflex", "speed", "game"] },
  "dice roller": { mcu: "arduino-nano", components: [{ id: "oled", type: "oled" }, { id: "btn_roll", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "led_status", type: "led", color: "blue" }], power: "battery", keywords: ["dice", "roller", "random", "d20", "tabletop", "board game"] },
  "mesh node": { mcu: "esp32-s3", components: [{ id: "oled", type: "oled" }, { id: "led_status", type: "led", color: "green" }, { id: "led_rx", type: "led", color: "blue" }, { id: "led_tx", type: "led", color: "yellow" }, { id: "btn_pair", type: "button" }, { id: "btn_reset", type: "button" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["mesh", "node", "network", "p2p", "swarm", "iot hub"] },
  "remote control": { mcu: "esp32", components: [{ id: "ir_emitter", type: "ir_emitter" }, { id: "oled", type: "oled" }, { id: "btn_power", type: "button" }, { id: "btn_up", type: "button" }, { id: "btn_down", type: "button" }, { id: "btn_ok", type: "button" }, { id: "led_tx", type: "led", color: "blue" }], power: "battery", keywords: ["remote", "control", "ir", "tv", "universal"] },
  "timer": { mcu: "arduino-nano", components: [{ id: "oled", type: "oled" }, { id: "btn_start", type: "button" }, { id: "btn_reset", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "led_running", type: "led", color: "green" }, { id: "led_done", type: "led", color: "red" }], power: "battery", keywords: ["timer", "countdown", "stopwatch", "clock", "pomodoro"] },
  "night light": { mcu: "arduino-nano", components: [{ id: "neopixel_ring", type: "neopixel" }, { id: "ldr", type: "ldr" }, { id: "potentiometer", type: "potentiometer" }, { id: "btn_mode", type: "button" }], power: "usb", keywords: ["night light", "nightlight", "bedside", "glow", "ambient light"] },
  "parking sensor": { mcu: "arduino-uno", components: [{ id: "ultrasonic", type: "ultrasonic" }, { id: "led_far", type: "led", color: "green" }, { id: "led_mid", type: "led", color: "yellow" }, { id: "led_close", type: "led", color: "red" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["parking", "sensor", "distance", "proximity", "backup"] },
  "scale": { mcu: "arduino-uno", components: [{ id: "sensor_load", type: "sensor" }, { id: "oled", type: "oled" }, { id: "btn_tare", type: "button" }, { id: "led_status", type: "led", color: "green" }], power: "usb", keywords: ["scale", "weight", "load cell", "measure", "kitchen scale"] },
};

function resolveArchetype(description: string): ProductArchetype | null {
  const desc = description.toLowerCase();

  // Direct name match first
  for (const [name, arch] of Object.entries(PRODUCT_ARCHETYPES)) {
    if (desc.includes(name)) return arch;
  }

  // Keyword match — score each archetype
  let best: ProductArchetype | null = null;
  let bestScore = 0;
  for (const arch of Object.values(PRODUCT_ARCHETYPES)) {
    let score = 0;
    for (const kw of arch.keywords) {
      if (desc.includes(kw)) score += kw.split(" ").length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = arch;
    }
  }
  return bestScore >= 1 ? best : null;
}

// ─── Parser Helpers ──────────────────────────────────────────

interface ParsedComponent {
  name: string;
  type: string;
  color?: string;
  quantity: number;
  model?: string;
}

function parseComponents(description: string, archetype: ProductArchetype | null): ParsedComponent[] {
  const components: ParsedComponent[] = [];
  const desc = description.toLowerCase();

  // Start with archetype components if matched
  if (archetype) {
    for (const comp of archetype.components) {
      components.push({
        name: comp.id,
        type: comp.type,
        color: comp.color,
        quantity: 1,
      });
    }
  }

  const existingTypes = new Set(components.map((c) => c.type));

  // LED patterns
  const ledColors = ["red", "green", "blue", "yellow", "white", "orange", "purple"];
  const ledMatch = desc.match(/(\d+)\s*(?:x\s*)?(?:status\s+)?leds?/i);
  const colorMatches = desc.match(
    new RegExp(`(${ledColors.join("|")})\\s+leds?`, "gi")
  );

  if (colorMatches) {
    for (const match of colorMatches) {
      const color = match.split(/\s+/)[0];
      if (!components.find((c) => c.name === `led_${color}`))
        components.push({ name: `led_${color}`, type: "led", color, quantity: 1 });
    }
  } else if (ledMatch) {
    const count = parseInt(ledMatch[1], 10);
    const defaultColors = ["green", "yellow", "red", "blue", "white"];
    for (let i = 0; i < count; i++) {
      const color = defaultColors[i % defaultColors.length];
      if (!components.find((c) => c.name === `led_${color}`))
        components.push({ name: `led_${color}`, type: "led", color, quantity: 1 });
    }
  } else if (desc.includes("led") && !existingTypes.has("led") && !existingTypes.has("neopixel")) {
    components.push({ name: "led_green", type: "led", color: "green", quantity: 1 });
  }

  if (desc.includes("oled") && !existingTypes.has("oled"))
    components.push({ name: "oled", type: "oled", quantity: 1 });
  if (desc.includes("lcd") && !existingTypes.has("oled"))
    components.push({ name: "lcd", type: "oled", quantity: 1, model: "LCD1602" });

  const buttonMatch = desc.match(/(\d+)\s*(?:x\s*)?(?:push\s*)?buttons?/i);
  if (buttonMatch) {
    const count = parseInt(buttonMatch[1], 10);
    const buttonNames = ["pair", "reset", "mode", "select", "up", "down"];
    for (let i = 0; i < count; i++) {
      const name = `btn_${buttonNames[i % buttonNames.length]}`;
      if (!components.find((c) => c.name === name))
        components.push({ name, type: "button", quantity: 1 });
    }
  } else if (desc.includes("button") && !existingTypes.has("button")) {
    components.push({ name: "btn_main", type: "button", quantity: 1 });
  }

  if (desc.includes("buzzer") && !existingTypes.has("buzzer"))
    components.push({ name: "buzzer", type: "buzzer", quantity: 1 });
  if (desc.includes("speaker") && !existingTypes.has("speaker"))
    components.push({ name: "speaker", type: "speaker", quantity: 1 });
  if ((desc.includes("microphone") || desc.includes("mic")) && !existingTypes.has("microphone"))
    components.push({ name: "microphone", type: "microphone", quantity: 1 });
  if (desc.includes("servo") && !existingTypes.has("servo"))
    components.push({ name: "servo", type: "servo", quantity: 1 });
  if (desc.includes("motor") && !existingTypes.has("motor"))
    components.push({ name: "motor", type: "motor", quantity: 1 });
  if (desc.includes("relay") && !existingTypes.has("relay"))
    components.push({ name: "relay", type: "relay", quantity: 1 });
  if ((desc.includes("neopixel") || desc.includes("rgb led") || desc.includes("ws2812")) && !existingTypes.has("neopixel"))
    components.push({ name: "neopixel", type: "neopixel", quantity: 1 });
  if ((desc.includes("ultrasonic") || desc.includes("distance sensor")) && !existingTypes.has("ultrasonic"))
    components.push({ name: "ultrasonic", type: "ultrasonic", quantity: 1 });
  if ((desc.includes("pir") || desc.includes("motion sensor") || desc.includes("motion detect")) && !existingTypes.has("pir"))
    components.push({ name: "pir", type: "pir", quantity: 1 });
  if ((desc.includes("light sensor") || desc.includes("ldr") || desc.includes("photoresistor")) && !existingTypes.has("ldr"))
    components.push({ name: "ldr", type: "ldr", quantity: 1 });
  if ((desc.includes("gps") || desc.includes("location")) && !existingTypes.has("gps"))
    components.push({ name: "gps", type: "gps", quantity: 1 });
  if ((desc.includes("rfid") || desc.includes("nfc")) && !existingTypes.has("rfid"))
    components.push({ name: "rfid", type: "rfid", quantity: 1 });
  if ((desc.includes("potentiometer") || desc.includes("knob") || desc.includes("dial")) && !existingTypes.has("potentiometer"))
    components.push({ name: "potentiometer", type: "potentiometer", quantity: 1 });
  if ((desc.includes("moisture") || desc.includes("soil")) && !existingTypes.has("moisture"))
    components.push({ name: "moisture", type: "moisture", quantity: 1 });
  if ((desc.includes("gas") || desc.includes("smoke") || desc.includes("air quality")) && !existingTypes.has("gas_sensor"))
    components.push({ name: "gas_sensor", type: "gas_sensor", quantity: 1 });
  if ((desc.includes("temperature") || desc.includes("humidity") || desc.includes("dht")) && !existingTypes.has("sensor"))
    components.push({ name: "temp_sensor", type: "sensor", quantity: 1, model: "DHT22" });

  return components;
}

function parseMCU(description: string, archetype: ProductArchetype | null): MCUFamily {
  const desc = description.toLowerCase();

  // Explicit MCU always wins
  if (desc.includes("esp32-s3")) return "esp32-s3";
  if (desc.includes("esp32-c3")) return "esp32-c3";
  if (desc.includes("esp32")) return "esp32";
  if (desc.includes("arduino mega")) return "arduino-mega";
  if (desc.includes("arduino nano")) return "arduino-nano";
  if (desc.includes("arduino")) return "arduino-uno";
  if (desc.includes("pico") || desc.includes("rp2040")) return "rp2040";
  if (desc.includes("stm32")) return "stm32";
  if (desc.includes("attiny")) return "attiny85";

  // Archetype suggestion
  if (archetype?.mcu) return archetype.mcu;

  // Capability-based heuristics
  if (desc.includes("wifi") || desc.includes("mesh") || desc.includes("wireless") || desc.includes("iot") || desc.includes("bluetooth") || desc.includes("ble"))
    return "esp32-s3";
  if (desc.includes("audio") || desc.includes("voice") || desc.includes("speak") || desc.includes("talk") || desc.includes("music") || desc.includes("sound"))
    return "esp32-s3";
  if (desc.includes("gps") || desc.includes("track") || desc.includes("camera"))
    return "esp32-s3";

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
  const archetype = resolveArchetype(naturalLanguage);
  const mcuFamily = parseMCU(naturalLanguage, archetype);
  const mcuTemplate = MCU_TEMPLATES[mcuFamily];
  const parsedComponents = parseComponents(naturalLanguage, archetype);
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
