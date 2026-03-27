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
  // ── Toys & Games ──────────────────────────────
  "talking mouse": { mcu: "esp32-s3", components: [{ id: "speaker", type: "speaker" }, { id: "microphone", type: "microphone" }, { id: "btn_talk", type: "button" }, { id: "led_status", type: "led", color: "blue" }], power: "battery", keywords: ["talking", "mouse", "toy", "plush", "stuffed"] },
  "talking toy": { mcu: "esp32-s3", components: [{ id: "speaker", type: "speaker" }, { id: "microphone", type: "microphone" }, { id: "btn_talk", type: "button" }, { id: "led_status", type: "led", color: "blue" }], power: "battery", keywords: ["talking", "toy", "interactive", "voice"] },
  "simon game": { mcu: "arduino-uno", components: [{ id: "led_red", type: "led", color: "red" }, { id: "led_green", type: "led", color: "green" }, { id: "led_blue", type: "led", color: "blue" }, { id: "led_yellow", type: "led", color: "yellow" }, { id: "btn_red", type: "button" }, { id: "btn_green", type: "button" }, { id: "btn_blue", type: "button" }, { id: "btn_yellow", type: "button" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["simon", "game", "memory", "pattern"] },
  "reaction timer": { mcu: "arduino-uno", components: [{ id: "led_go", type: "led", color: "green" }, { id: "led_wait", type: "led", color: "red" }, { id: "btn_player1", type: "button" }, { id: "btn_player2", type: "button" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["reaction", "timer", "reflex", "speed game"] },
  "dice roller": { mcu: "arduino-nano", components: [{ id: "oled", type: "oled" }, { id: "btn_roll", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "led_status", type: "led", color: "blue" }], power: "battery", keywords: ["dice", "roller", "random", "d20", "tabletop", "board game"] },
  "whack a mole": { mcu: "arduino-uno", components: [{ id: "neopixel", type: "neopixel" }, { id: "btn_1", type: "button" }, { id: "btn_2", type: "button" }, { id: "btn_3", type: "button" }, { id: "btn_4", type: "button" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["whack", "mole", "arcade", "hit"] },
  "magic 8 ball": { mcu: "arduino-nano", components: [{ id: "oled", type: "oled" }, { id: "btn_ask", type: "button" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["magic 8 ball", "fortune", "prediction", "oracle", "ask"] },
  "laser tag": { mcu: "esp32", components: [{ id: "ir_emitter", type: "ir_emitter" }, { id: "ir_receiver", type: "ir_receiver" }, { id: "buzzer", type: "buzzer" }, { id: "neopixel", type: "neopixel" }, { id: "btn_trigger", type: "button" }, { id: "sensor_imu", type: "sensor" }], power: "battery", keywords: ["laser tag", "shooter", "blaster", "phaser"] },
  "electronic drum pad": { mcu: "esp32-s3", components: [{ id: "btn_pad1", type: "button" }, { id: "btn_pad2", type: "button" }, { id: "btn_pad3", type: "button" }, { id: "btn_pad4", type: "button" }, { id: "speaker", type: "speaker" }, { id: "oled", type: "oled" }], power: "usb", keywords: ["drum pad", "drum machine", "beat pad", "finger drum"] },
  "spinning wheel": { mcu: "arduino-uno", components: [{ id: "servo", type: "servo" }, { id: "neopixel", type: "neopixel" }, { id: "btn_spin", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "oled", type: "oled" }], power: "usb", keywords: ["spinning wheel", "prize", "spin", "wheel of fortune", "raffle"] },
  "toy cash register": { mcu: "esp32-s3", components: [{ id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "btn_1", type: "button" }, { id: "btn_2", type: "button" }, { id: "btn_3", type: "button" }, { id: "led_status", type: "led", color: "green" }, { id: "speaker", type: "speaker" }], power: "battery", keywords: ["cash register", "till", "checkout", "play store"] },
  "trivia buzzer": { mcu: "arduino-uno", components: [{ id: "btn_p1", type: "button" }, { id: "btn_p2", type: "button" }, { id: "btn_p3", type: "button" }, { id: "btn_p4", type: "button" }, { id: "neopixel", type: "neopixel" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["trivia", "buzzer", "quiz", "game show", "jeopardy"] },

  // ── Smart Home & Automation ───────────────────
  "smart doorbell": { mcu: "esp32-s3", components: [{ id: "btn_ring", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "microphone", type: "microphone" }, { id: "speaker", type: "speaker" }, { id: "pir", type: "pir" }], power: "usb", keywords: ["doorbell", "door bell", "visitor", "front door"] },
  "smart light": { mcu: "esp32", components: [{ id: "neopixel_strip", type: "neopixel" }, { id: "ldr", type: "ldr" }, { id: "pir", type: "pir" }, { id: "btn_mode", type: "button" }], power: "usb", keywords: ["smart light", "lamp", "light strip", "mood light", "rgb light"] },
  "thermostat": { mcu: "esp32", components: [{ id: "oled", type: "oled" }, { id: "temp_sensor", type: "sensor" }, { id: "relay", type: "relay" }, { id: "btn_up", type: "button" }, { id: "btn_down", type: "button" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["thermostat", "hvac", "heating", "cooling", "climate", "temperature control"] },
  "smart plug": { mcu: "esp32", components: [{ id: "relay", type: "relay" }, { id: "led_status", type: "led", color: "green" }, { id: "btn_toggle", type: "button" }, { id: "sensor_current", type: "sensor" }], power: "usb", keywords: ["smart plug", "outlet", "power switch"] },
  "smart lock": { mcu: "esp32-s3", components: [{ id: "servo", type: "servo" }, { id: "rfid", type: "rfid" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "btn_open", type: "button" }], power: "battery", keywords: ["smart lock", "door lock", "keyless", "access control", "entry"] },
  "garage opener": { mcu: "esp32", components: [{ id: "relay", type: "relay" }, { id: "btn_open", type: "button" }, { id: "ultrasonic", type: "ultrasonic" }, { id: "led_status", type: "led", color: "green" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["garage", "opener", "gate controller"] },
  "smart curtain": { mcu: "esp32", components: [{ id: "motor", type: "motor" }, { id: "btn_open", type: "button" }, { id: "btn_close", type: "button" }, { id: "ldr", type: "ldr" }, { id: "led_status", type: "led", color: "green" }], power: "usb", keywords: ["curtain", "drape", "shade", "blind controller"] },
  "smart fan": { mcu: "esp32", components: [{ id: "motor", type: "motor" }, { id: "temp_sensor", type: "sensor" }, { id: "relay", type: "relay" }, { id: "btn_speed", type: "button" }, { id: "oled", type: "oled" }], power: "usb", keywords: ["smart fan", "fan controller", "ceiling fan"] },
  "water leak detector": { mcu: "esp32", components: [{ id: "moisture", type: "moisture" }, { id: "buzzer", type: "buzzer" }, { id: "led_alarm", type: "led", color: "red" }, { id: "led_ok", type: "led", color: "green" }, { id: "neopixel", type: "neopixel" }], power: "battery", keywords: ["leak", "water damage", "flood detect", "pipe burst"] },
  "smart mailbox": { mcu: "esp32", components: [{ id: "ultrasonic", type: "ultrasonic" }, { id: "buzzer", type: "buzzer" }, { id: "led_mail", type: "led", color: "blue" }, { id: "pir", type: "pir" }], power: "battery", keywords: ["mailbox", "mail alert", "package detect", "letterbox"] },
  "window blinds": { mcu: "esp32", components: [{ id: "servo", type: "servo" }, { id: "ldr", type: "ldr" }, { id: "btn_up", type: "button" }, { id: "btn_down", type: "button" }, { id: "oled", type: "oled" }], power: "usb", keywords: ["window blind", "roller shade", "window shade"] },
  "smart power strip": { mcu: "esp32", components: [{ id: "relay_1", type: "relay" }, { id: "relay_2", type: "relay" }, { id: "relay_3", type: "relay" }, { id: "btn_toggle", type: "button" }, { id: "oled", type: "oled" }, { id: "sensor_current", type: "sensor" }], power: "usb", keywords: ["power strip", "multi outlet", "surge protector"] },

  // ── Security & Safety ─────────────────────────
  "alarm system": { mcu: "esp32-s3", components: [{ id: "pir", type: "pir" }, { id: "buzzer", type: "buzzer" }, { id: "oled", type: "oled" }, { id: "led_alarm", type: "led", color: "red" }, { id: "led_armed", type: "led", color: "green" }, { id: "btn_arm", type: "button" }, { id: "btn_disarm", type: "button" }], power: "usb", keywords: ["alarm", "security system", "intrusion", "burglar"] },
  "smoke detector": { mcu: "esp32", components: [{ id: "gas_sensor", type: "gas_sensor" }, { id: "buzzer", type: "buzzer" }, { id: "led_alarm", type: "led", color: "red" }, { id: "led_ok", type: "led", color: "green" }], power: "battery", keywords: ["smoke detector", "fire alarm", "fire detect"] },
  "baby monitor": { mcu: "esp32-s3", components: [{ id: "microphone", type: "microphone" }, { id: "speaker", type: "speaker" }, { id: "oled", type: "oled" }, { id: "temp_sensor", type: "sensor" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["baby monitor", "nursery monitor", "infant monitor"] },
  "flood sensor": { mcu: "esp32", components: [{ id: "moisture", type: "moisture" }, { id: "buzzer", type: "buzzer" }, { id: "led_alarm", type: "led", color: "red" }, { id: "led_ok", type: "led", color: "green" }], power: "battery", keywords: ["flood sensor", "basement flood", "water alarm"] },
  "panic button": { mcu: "esp32-s3", components: [{ id: "btn_panic", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "neopixel", type: "neopixel" }, { id: "gps", type: "gps" }], power: "battery", keywords: ["panic button", "sos", "emergency button", "duress"] },
  "safe box": { mcu: "esp32-s3", components: [{ id: "rfid", type: "rfid" }, { id: "servo", type: "servo" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "led_locked", type: "led", color: "red" }, { id: "led_unlocked", type: "led", color: "green" }, { id: "btn_open", type: "button" }], power: "battery", keywords: ["safe", "lockbox", "vault", "strong box"] },
  "driveway alert": { mcu: "esp32", components: [{ id: "pir", type: "pir" }, { id: "buzzer", type: "buzzer" }, { id: "led_alert", type: "led", color: "red" }, { id: "neopixel", type: "neopixel" }], power: "usb", keywords: ["driveway alert", "driveway alarm", "approach sensor"] },
  "window alarm": { mcu: "arduino-nano", components: [{ id: "sensor_reed", type: "sensor" }, { id: "buzzer", type: "buzzer" }, { id: "led_armed", type: "led", color: "green" }, { id: "led_alarm", type: "led", color: "red" }, { id: "btn_arm", type: "button" }], power: "battery", keywords: ["window alarm", "window sensor", "door sensor", "reed switch"] },

  // ── Kitchen & Food ────────────────────────────
  "scale": { mcu: "arduino-uno", components: [{ id: "sensor_load", type: "sensor" }, { id: "oled", type: "oled" }, { id: "btn_tare", type: "button" }, { id: "led_status", type: "led", color: "green" }], power: "usb", keywords: ["scale", "weight", "load cell", "kitchen scale"] },
  "kitchen timer": { mcu: "arduino-nano", components: [{ id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "btn_start", type: "button" }, { id: "btn_set", type: "button" }, { id: "potentiometer", type: "potentiometer" }, { id: "led_running", type: "led", color: "green" }], power: "battery", keywords: ["kitchen timer", "egg timer", "cooking timer"] },
  "sous vide": { mcu: "esp32", components: [{ id: "temp_sensor", type: "sensor" }, { id: "relay", type: "relay" }, { id: "oled", type: "oled" }, { id: "btn_set", type: "button" }, { id: "btn_start", type: "button" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["sous vide", "immersion circulator", "precision cooker"] },
  "fridge monitor": { mcu: "esp32", components: [{ id: "temp_sensor", type: "sensor" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "led_ok", type: "led", color: "green" }, { id: "led_warm", type: "led", color: "red" }], power: "battery", keywords: ["fridge", "refrigerator", "freezer monitor", "cold chain"] },
  "coffee roaster": { mcu: "esp32", components: [{ id: "temp_sensor", type: "sensor" }, { id: "relay", type: "relay" }, { id: "oled", type: "oled" }, { id: "motor", type: "motor" }, { id: "btn_start", type: "button" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["coffee roaster", "roast", "bean roaster"] },
  "smart coaster": { mcu: "arduino-nano", components: [{ id: "temp_sensor", type: "sensor" }, { id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["smart coaster", "drink temperature", "cup warmer"] },
  "portion dispenser": { mcu: "arduino-uno", components: [{ id: "servo", type: "servo" }, { id: "btn_dispense", type: "button" }, { id: "ultrasonic", type: "ultrasonic" }, { id: "oled", type: "oled" }, { id: "led_status", type: "led", color: "green" }], power: "usb", keywords: ["portion", "dispenser", "cereal", "candy dispenser"] },
  "meat thermometer": { mcu: "esp32", components: [{ id: "temp_sensor", type: "sensor" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "led_rare", type: "led", color: "red" }, { id: "led_done", type: "led", color: "green" }], power: "battery", keywords: ["meat thermometer", "bbq thermometer", "grill", "probe thermometer", "smoker"] },

  // ── Garden & Agriculture ──────────────────────
  "plant monitor": { mcu: "esp32", components: [{ id: "moisture", type: "moisture" }, { id: "temp_sensor", type: "sensor" }, { id: "oled", type: "oled" }, { id: "led_dry", type: "led", color: "red" }, { id: "led_ok", type: "led", color: "green" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["plant", "garden", "soil", "moisture monitor", "water plant", "grow"] },
  "weather station": { mcu: "esp32", components: [{ id: "temp_sensor", type: "sensor" }, { id: "oled", type: "oled" }, { id: "ldr", type: "ldr" }, { id: "led_status", type: "led", color: "blue" }], power: "usb", keywords: ["weather station", "barometer", "forecast", "rain gauge"] },
  "irrigation controller": { mcu: "esp32", components: [{ id: "moisture", type: "moisture" }, { id: "relay", type: "relay" }, { id: "oled", type: "oled" }, { id: "btn_manual", type: "button" }, { id: "led_pump", type: "led", color: "blue" }], power: "usb", keywords: ["irrigation", "sprinkler", "watering system", "drip system"] },
  "greenhouse monitor": { mcu: "esp32", components: [{ id: "temp_sensor", type: "sensor" }, { id: "moisture", type: "moisture" }, { id: "ldr", type: "ldr" }, { id: "oled", type: "oled" }, { id: "relay", type: "relay" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["greenhouse", "polytunnel", "grow tent", "indoor grow"] },
  "compost monitor": { mcu: "esp32", components: [{ id: "temp_sensor", type: "sensor" }, { id: "moisture", type: "moisture" }, { id: "gas_sensor", type: "gas_sensor" }, { id: "oled", type: "oled" }, { id: "led_status", type: "led", color: "green" }], power: "battery", keywords: ["compost", "compost bin", "decomposition"] },
  "bird feeder cam": { mcu: "esp32", components: [{ id: "pir", type: "pir" }, { id: "servo", type: "servo" }, { id: "buzzer", type: "buzzer" }, { id: "led_status", type: "led", color: "green" }, { id: "ultrasonic", type: "ultrasonic" }], power: "battery", keywords: ["bird feeder", "bird watch", "bird cam"] },
  "frost alert": { mcu: "esp32", components: [{ id: "temp_sensor", type: "sensor" }, { id: "buzzer", type: "buzzer" }, { id: "led_alert", type: "led", color: "red" }, { id: "led_ok", type: "led", color: "green" }, { id: "neopixel", type: "neopixel" }], power: "battery", keywords: ["frost alert", "freeze warning", "crop protect"] },
  "hydroponic controller": { mcu: "esp32", components: [{ id: "moisture", type: "moisture" }, { id: "temp_sensor", type: "sensor" }, { id: "relay", type: "relay" }, { id: "oled", type: "oled" }, { id: "led_pump", type: "led", color: "blue" }, { id: "btn_manual", type: "button" }], power: "usb", keywords: ["hydroponic", "hydroponics", "nutrient", "dwc", "nft system"] },

  // ── Pet Care ──────────────────────────────────
  "pet feeder": { mcu: "esp32", components: [{ id: "servo", type: "servo" }, { id: "oled", type: "oled" }, { id: "btn_feed", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "led_status", type: "led", color: "green" }, { id: "ultrasonic", type: "ultrasonic" }], power: "usb", keywords: ["pet feeder", "cat feeder", "dog feeder", "food dispenser"] },
  "pet tracker": { mcu: "esp32-s3", components: [{ id: "gps", type: "gps" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["pet tracker", "collar tracker", "find my pet"] },
  "pet door": { mcu: "esp32", components: [{ id: "rfid", type: "rfid" }, { id: "servo", type: "servo" }, { id: "pir", type: "pir" }, { id: "led_locked", type: "led", color: "red" }, { id: "led_unlocked", type: "led", color: "green" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["pet door", "cat flap", "dog door", "microchip door"] },
  "bark detector": { mcu: "esp32-s3", components: [{ id: "microphone", type: "microphone" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "led_alert", type: "led", color: "red" }, { id: "neopixel", type: "neopixel" }], power: "usb", keywords: ["bark detector", "bark counter", "dog bark", "noise nuisance"] },
  "aquarium feeder": { mcu: "arduino-uno", components: [{ id: "servo", type: "servo" }, { id: "btn_feed", type: "button" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "led_status", type: "led", color: "green" }], power: "usb", keywords: ["aquarium feeder", "fish feeder", "fish food"] },
  "pet water fountain": { mcu: "arduino-uno", components: [{ id: "motor", type: "motor" }, { id: "ultrasonic", type: "ultrasonic" }, { id: "led_status", type: "led", color: "blue" }, { id: "btn_toggle", type: "button" }], power: "usb", keywords: ["pet fountain", "water fountain", "pet water", "drinking fountain"] },
  "pet activity monitor": { mcu: "esp32-s3", components: [{ id: "sensor_imu", type: "sensor" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "neopixel", type: "neopixel" }, { id: "btn_mode", type: "button" }], power: "battery", keywords: ["pet activity", "dog activity", "cat activity", "pet fitness"] },
  "reptile habitat": { mcu: "esp32", components: [{ id: "temp_sensor", type: "sensor" }, { id: "relay_heat", type: "relay" }, { id: "relay_mist", type: "relay" }, { id: "ldr", type: "ldr" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["reptile", "terrarium", "vivarium", "habitat controller", "gecko", "snake"] },

  // ── Health & Wearables ────────────────────────
  "fitness tracker": { mcu: "esp32-s3", components: [{ id: "oled", type: "oled" }, { id: "sensor_imu", type: "sensor" }, { id: "buzzer", type: "buzzer" }, { id: "btn_mode", type: "button" }], power: "battery", keywords: ["fitness tracker", "step counter", "pedometer", "wristband", "activity band"] },
  "pulse oximeter": { mcu: "esp32", components: [{ id: "oled", type: "oled" }, { id: "sensor_spo2", type: "sensor" }, { id: "led_status", type: "led", color: "red" }, { id: "buzzer", type: "buzzer" }, { id: "btn_start", type: "button" }], power: "battery", keywords: ["pulse oximeter", "spo2", "heart rate", "oxygen level"] },
  "posture alert": { mcu: "esp32-s3", components: [{ id: "sensor_imu", type: "sensor" }, { id: "buzzer", type: "buzzer" }, { id: "neopixel", type: "neopixel" }, { id: "btn_calibrate", type: "button" }], power: "battery", keywords: ["posture", "posture alert", "back posture", "slouch", "spine"] },
  "uv exposure meter": { mcu: "arduino-nano", components: [{ id: "ldr", type: "ldr" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "led_low", type: "led", color: "green" }, { id: "led_high", type: "led", color: "red" }], power: "battery", keywords: ["uv meter", "uv exposure", "sunburn", "sun exposure"] },
  "pill reminder": { mcu: "esp32", components: [{ id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "btn_taken", type: "button" }, { id: "neopixel", type: "neopixel" }, { id: "servo", type: "servo" }], power: "usb", keywords: ["pill reminder", "medication", "medicine", "pill dispenser", "pill box"] },
  "hand wash timer": { mcu: "arduino-nano", components: [{ id: "ultrasonic", type: "ultrasonic" }, { id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }, { id: "led_done", type: "led", color: "green" }], power: "usb", keywords: ["hand wash", "hygiene timer", "wash timer", "sanitize"] },
  "sleep monitor": { mcu: "esp32-s3", components: [{ id: "sensor_imu", type: "sensor" }, { id: "microphone", type: "microphone" }, { id: "oled", type: "oled" }, { id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["sleep monitor", "sleep tracker", "snore detect", "sleep quality"] },
  "meditation timer": { mcu: "arduino-nano", components: [{ id: "oled", type: "oled" }, { id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }, { id: "btn_start", type: "button" }, { id: "potentiometer", type: "potentiometer" }], power: "battery", keywords: ["meditation", "mindfulness", "breathing", "zen timer", "calm"] },

  // ── Audio & Music ─────────────────────────────
  "music box": { mcu: "esp32-s3", components: [{ id: "speaker", type: "speaker" }, { id: "btn_play", type: "button" }, { id: "btn_next", type: "button" }, { id: "potentiometer", type: "potentiometer" }], power: "battery", keywords: ["music box", "jukebox", "mp3 player", "audio player"] },
  "guitar tuner": { mcu: "esp32", components: [{ id: "microphone", type: "microphone" }, { id: "oled", type: "oled" }, { id: "led_flat", type: "led", color: "red" }, { id: "led_tune", type: "led", color: "green" }, { id: "led_sharp", type: "led", color: "yellow" }, { id: "btn_mode", type: "button" }], power: "battery", keywords: ["guitar tuner", "tuner", "instrument tuner", "pitch detect"] },
  "metronome": { mcu: "arduino-uno", components: [{ id: "speaker", type: "speaker" }, { id: "oled", type: "oled" }, { id: "btn_tap", type: "button" }, { id: "potentiometer", type: "potentiometer" }, { id: "led_beat", type: "led", color: "green" }], power: "battery", keywords: ["metronome", "tempo", "bpm", "beat keeper"] },
  "sound level meter": { mcu: "esp32", components: [{ id: "microphone", type: "microphone" }, { id: "oled", type: "oled" }, { id: "neopixel", type: "neopixel" }, { id: "led_loud", type: "led", color: "red" }], power: "battery", keywords: ["sound level", "decibel meter", "spl meter", "noise meter", "volume meter"] },
  "theremin": { mcu: "esp32-s3", components: [{ id: "ultrasonic", type: "ultrasonic" }, { id: "speaker", type: "speaker" }, { id: "led_status", type: "led", color: "green" }, { id: "potentiometer", type: "potentiometer" }], power: "usb", keywords: ["theremin", "electronic instrument", "hands free instrument"] },
  "doorbell chime": { mcu: "arduino-nano", components: [{ id: "speaker", type: "speaker" }, { id: "btn_ring", type: "button" }, { id: "potentiometer", type: "potentiometer" }, { id: "led_status", type: "led", color: "blue" }], power: "usb", keywords: ["doorbell chime", "door chime", "ding dong"] },
  "white noise machine": { mcu: "esp32-s3", components: [{ id: "speaker", type: "speaker" }, { id: "potentiometer", type: "potentiometer" }, { id: "btn_mode", type: "button" }, { id: "neopixel", type: "neopixel" }, { id: "oled", type: "oled" }], power: "usb", keywords: ["white noise", "pink noise", "brown noise", "ambient sound", "sleep sound"] },
  "karaoke machine": { mcu: "esp32-s3", components: [{ id: "microphone", type: "microphone" }, { id: "speaker", type: "speaker" }, { id: "oled", type: "oled" }, { id: "neopixel", type: "neopixel" }, { id: "btn_play", type: "button" }, { id: "potentiometer", type: "potentiometer" }], power: "usb", keywords: ["karaoke", "sing along", "vocal", "microphone speaker"] },

  // ── Education & STEM ──────────────────────────
  "binary counter": { mcu: "arduino-uno", components: [{ id: "led_b0", type: "led", color: "red" }, { id: "led_b1", type: "led", color: "red" }, { id: "led_b2", type: "led", color: "red" }, { id: "led_b3", type: "led", color: "red" }, { id: "btn_inc", type: "button" }, { id: "btn_reset", type: "button" }, { id: "oled", type: "oled" }], power: "usb", keywords: ["binary counter", "binary", "bit counter", "digital logic"] },
  "morse code trainer": { mcu: "arduino-nano", components: [{ id: "buzzer", type: "buzzer" }, { id: "btn_key", type: "button" }, { id: "oled", type: "oled" }, { id: "led_signal", type: "led", color: "green" }], power: "battery", keywords: ["morse code", "telegraph", "cw trainer", "dit dah"] },
  "logic gate trainer": { mcu: "arduino-uno", components: [{ id: "btn_a", type: "button" }, { id: "btn_b", type: "button" }, { id: "led_and", type: "led", color: "green" }, { id: "led_or", type: "led", color: "yellow" }, { id: "led_xor", type: "led", color: "blue" }, { id: "led_not", type: "led", color: "red" }, { id: "oled", type: "oled" }, { id: "btn_mode", type: "button" }], power: "usb", keywords: ["logic gate", "boolean", "truth table", "and or xor"] },
  "color mixer": { mcu: "arduino-uno", components: [{ id: "neopixel", type: "neopixel" }, { id: "pot_r", type: "potentiometer" }, { id: "pot_g", type: "potentiometer" }, { id: "pot_b", type: "potentiometer" }, { id: "oled", type: "oled" }], power: "usb", keywords: ["color mixer", "rgb mixer", "color theory", "color blend"] },
  "resistor calculator": { mcu: "arduino-nano", components: [{ id: "oled", type: "oled" }, { id: "btn_band1", type: "button" }, { id: "btn_band2", type: "button" }, { id: "btn_band3", type: "button" }, { id: "btn_band4", type: "button" }, { id: "led_status", type: "led", color: "green" }], power: "battery", keywords: ["resistor calculator", "resistor code", "color band", "ohm calculator"] },
  "sorting hat": { mcu: "esp32-s3", components: [{ id: "speaker", type: "speaker" }, { id: "sensor_imu", type: "sensor" }, { id: "neopixel", type: "neopixel" }, { id: "oled", type: "oled" }, { id: "btn_sort", type: "button" }], power: "battery", keywords: ["sorting hat", "harry potter", "house sort", "random sort"] },
  "traffic light": { mcu: "arduino-uno", components: [{ id: "led_red", type: "led", color: "red" }, { id: "led_yellow", type: "led", color: "yellow" }, { id: "led_green", type: "led", color: "green" }, { id: "btn_pedestrian", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "oled", type: "oled" }], power: "usb", keywords: ["traffic light", "stoplight", "pedestrian crossing", "traffic signal"] },
  "capacitor tester": { mcu: "arduino-uno", components: [{ id: "sensor_cap", type: "sensor" }, { id: "oled", type: "oled" }, { id: "btn_test", type: "button" }, { id: "led_status", type: "led", color: "green" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["capacitor tester", "capacitance meter", "esr tester"] },

  // ── Automotive & Vehicle ──────────────────────
  "parking sensor": { mcu: "arduino-uno", components: [{ id: "ultrasonic", type: "ultrasonic" }, { id: "led_far", type: "led", color: "green" }, { id: "led_mid", type: "led", color: "yellow" }, { id: "led_close", type: "led", color: "red" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["parking sensor", "backup sensor", "parking assist"] },
  "obd2 display": { mcu: "esp32", components: [{ id: "sensor_obd", type: "sensor" }, { id: "oled", type: "oled" }, { id: "btn_mode", type: "button" }, { id: "led_warn", type: "led", color: "red" }, { id: "led_ok", type: "led", color: "green" }], power: "usb", keywords: ["obd2", "obd", "car diagnostic", "engine monitor"] },
  "tire pressure": { mcu: "esp32", components: [{ id: "sensor_pressure", type: "sensor" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "led_low", type: "led", color: "red" }, { id: "led_ok", type: "led", color: "green" }], power: "battery", keywords: ["tire pressure", "tyre pressure", "tpms", "tire monitor"] },
  "car thermometer": { mcu: "arduino-nano", components: [{ id: "temp_sensor", type: "sensor" }, { id: "oled", type: "oled" }, { id: "led_status", type: "led", color: "blue" }], power: "usb", keywords: ["car thermometer", "car temperature", "auto temp"] },
  "bike speedometer": { mcu: "arduino-nano", components: [{ id: "sensor_hall", type: "sensor" }, { id: "oled", type: "oled" }, { id: "btn_mode", type: "button" }, { id: "led_status", type: "led", color: "green" }], power: "battery", keywords: ["bike speedometer", "bicycle speed", "bike computer", "cycle computer"] },
  "blind spot indicator": { mcu: "arduino-nano", components: [{ id: "ultrasonic", type: "ultrasonic" }, { id: "led_left", type: "led", color: "red" }, { id: "led_right", type: "led", color: "red" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["blind spot", "lane change", "side detect"] },
  "turn signal vest": { mcu: "esp32", components: [{ id: "neopixel", type: "neopixel" }, { id: "btn_left", type: "button" }, { id: "btn_right", type: "button" }, { id: "sensor_imu", type: "sensor" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["turn signal vest", "bike vest", "cyclist vest", "visibility vest"] },

  // ── Environmental Monitoring ──────────────────
  "air quality monitor": { mcu: "esp32", components: [{ id: "gas_sensor", type: "gas_sensor" }, { id: "oled", type: "oled" }, { id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }, { id: "led_status", type: "led", color: "green" }], power: "usb", keywords: ["air quality", "aqi", "pm2.5", "particulate", "indoor air"] },
  "noise monitor": { mcu: "esp32", components: [{ id: "microphone", type: "microphone" }, { id: "oled", type: "oled" }, { id: "neopixel", type: "neopixel" }, { id: "led_loud", type: "led", color: "red" }], power: "usb", keywords: ["noise pollution", "noise monitor", "noise level", "decibel monitor"] },
  "radiation monitor": { mcu: "arduino-uno", components: [{ id: "sensor_geiger", type: "sensor" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "led_alert", type: "led", color: "red" }], power: "battery", keywords: ["radiation", "geiger counter", "radioactivity", "nuclear"] },
  "water quality tester": { mcu: "arduino-uno", components: [{ id: "sensor_tds", type: "sensor" }, { id: "oled", type: "oled" }, { id: "led_safe", type: "led", color: "green" }, { id: "led_unsafe", type: "led", color: "red" }, { id: "btn_test", type: "button" }], power: "battery", keywords: ["water quality", "tds meter", "water tester", "ppm meter", "water purity"] },
  "co2 monitor": { mcu: "esp32", components: [{ id: "gas_sensor", type: "gas_sensor" }, { id: "oled", type: "oled" }, { id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }, { id: "led_vent", type: "led", color: "red" }], power: "usb", keywords: ["co2 monitor", "carbon dioxide", "ventilation", "co2 sensor"] },
  "uv index monitor": { mcu: "arduino-nano", components: [{ id: "ldr", type: "ldr" }, { id: "oled", type: "oled" }, { id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["uv index", "uv monitor", "ultraviolet", "sun index"] },
  "soil ph meter": { mcu: "arduino-uno", components: [{ id: "sensor_ph", type: "sensor" }, { id: "oled", type: "oled" }, { id: "led_acid", type: "led", color: "red" }, { id: "led_neutral", type: "led", color: "green" }, { id: "led_alkaline", type: "led", color: "blue" }], power: "battery", keywords: ["soil ph", "ph meter", "acidity", "alkalinity", "ph tester"] },

  // ── Industrial & Maker ────────────────────────
  "mesh node": { mcu: "esp32-s3", components: [{ id: "oled", type: "oled" }, { id: "led_status", type: "led", color: "green" }, { id: "led_rx", type: "led", color: "blue" }, { id: "led_tx", type: "led", color: "yellow" }, { id: "btn_pair", type: "button" }, { id: "btn_reset", type: "button" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["mesh node", "iot hub", "p2p node", "swarm node"] },
  "3d printer monitor": { mcu: "esp32", components: [{ id: "temp_sensor", type: "sensor" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "led_printing", type: "led", color: "green" }, { id: "led_error", type: "led", color: "red" }, { id: "btn_pause", type: "button" }], power: "usb", keywords: ["3d printer", "print monitor", "filament", "print farm"] },
  "solder fume extractor": { mcu: "arduino-uno", components: [{ id: "gas_sensor", type: "gas_sensor" }, { id: "motor", type: "motor" }, { id: "relay", type: "relay" }, { id: "led_status", type: "led", color: "green" }, { id: "btn_speed", type: "button" }], power: "usb", keywords: ["solder fume", "fume extractor", "soldering fan", "flux fume"] },
  "cable tester": { mcu: "arduino-nano", components: [{ id: "led_pass", type: "led", color: "green" }, { id: "led_fail", type: "led", color: "red" }, { id: "btn_test", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "oled", type: "oled" }], power: "battery", keywords: ["cable tester", "continuity", "wire tester", "network cable"] },
  "cnc pendant": { mcu: "esp32", components: [{ id: "potentiometer", type: "potentiometer" }, { id: "btn_x", type: "button" }, { id: "btn_y", type: "button" }, { id: "btn_z", type: "button" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["cnc pendant", "cnc jog", "cnc controller", "mill pendant"] },
  "tool counter": { mcu: "arduino-nano", components: [{ id: "sensor_vibration", type: "sensor" }, { id: "oled", type: "oled" }, { id: "btn_reset", type: "button" }, { id: "led_status", type: "led", color: "green" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["tool counter", "usage counter", "cycle counter", "tool life"] },
  "power monitor": { mcu: "esp32", components: [{ id: "sensor_current", type: "sensor" }, { id: "oled", type: "oled" }, { id: "led_normal", type: "led", color: "green" }, { id: "led_overload", type: "led", color: "red" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["power monitor", "energy meter", "watt meter", "current monitor", "electricity"] },

  // ── Robotics ──────────────────────────────────
  "robot car": { mcu: "esp32", components: [{ id: "motor_left", type: "motor" }, { id: "motor_right", type: "motor" }, { id: "ultrasonic", type: "ultrasonic" }, { id: "led_front", type: "led", color: "white" }, { id: "led_rear", type: "led", color: "red" }, { id: "buzzer", type: "buzzer" }, { id: "ir_receiver", type: "ir_receiver" }], power: "battery", keywords: ["robot car", "rover", "rc robot", "obstacle avoid"] },
  "drone": { mcu: "esp32-s3", components: [{ id: "motor_fl", type: "motor" }, { id: "motor_fr", type: "motor" }, { id: "motor_bl", type: "motor" }, { id: "motor_br", type: "motor" }, { id: "sensor_imu", type: "sensor" }, { id: "led_status", type: "led", color: "green" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["drone", "quadcopter", "multirotor", "uav"] },
  "robot arm": { mcu: "esp32", components: [{ id: "servo_base", type: "servo" }, { id: "servo_elbow", type: "servo" }, { id: "servo_gripper", type: "servo" }, { id: "potentiometer", type: "potentiometer" }, { id: "btn_grip", type: "button" }, { id: "oled", type: "oled" }], power: "usb", keywords: ["robot arm", "robotic arm", "gripper", "manipulator"] },
  "line follower": { mcu: "arduino-uno", components: [{ id: "sensor_ir_left", type: "sensor" }, { id: "sensor_ir_right", type: "sensor" }, { id: "motor_left", type: "motor" }, { id: "motor_right", type: "motor" }, { id: "led_status", type: "led", color: "green" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["line follower", "line tracker", "follow line", "track line"] },
  "balancing robot": { mcu: "esp32", components: [{ id: "sensor_imu", type: "sensor" }, { id: "motor_left", type: "motor" }, { id: "motor_right", type: "motor" }, { id: "oled", type: "oled" }, { id: "led_status", type: "led", color: "green" }], power: "battery", keywords: ["balancing robot", "self balancing", "segway bot", "inverted pendulum"] },
  "hexapod": { mcu: "esp32-s3", components: [{ id: "servo_1", type: "servo" }, { id: "servo_2", type: "servo" }, { id: "servo_3", type: "servo" }, { id: "sensor_imu", type: "sensor" }, { id: "ultrasonic", type: "ultrasonic" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["hexapod", "spider robot", "walking robot", "six leg"] },
  "sumo bot": { mcu: "arduino-uno", components: [{ id: "motor_left", type: "motor" }, { id: "motor_right", type: "motor" }, { id: "ultrasonic", type: "ultrasonic" }, { id: "sensor_line", type: "sensor" }, { id: "led_status", type: "led", color: "green" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["sumo bot", "sumo robot", "battle bot", "wrestling bot"] },

  // ── Lighting & Display ────────────────────────
  "night light": { mcu: "arduino-nano", components: [{ id: "neopixel_ring", type: "neopixel" }, { id: "ldr", type: "ldr" }, { id: "potentiometer", type: "potentiometer" }, { id: "btn_mode", type: "button" }], power: "usb", keywords: ["night light", "nightlight", "bedside light"] },
  "led matrix sign": { mcu: "esp32", components: [{ id: "neopixel", type: "neopixel" }, { id: "btn_mode", type: "button" }, { id: "potentiometer", type: "potentiometer" }, { id: "oled", type: "oled" }], power: "usb", keywords: ["led matrix", "led sign", "scrolling text", "pixel display", "marquee"] },
  "sunrise alarm": { mcu: "esp32", components: [{ id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }, { id: "btn_set", type: "button" }, { id: "btn_snooze", type: "button" }, { id: "oled", type: "oled" }], power: "usb", keywords: ["sunrise alarm", "wake up light", "dawn simulator", "sunrise clock"] },
  "ambilight": { mcu: "esp32", components: [{ id: "neopixel", type: "neopixel" }, { id: "ldr", type: "ldr" }, { id: "btn_mode", type: "button" }, { id: "potentiometer", type: "potentiometer" }], power: "usb", keywords: ["ambilight", "bias light", "tv backlight", "monitor backlight"] },
  "pixel art frame": { mcu: "esp32", components: [{ id: "neopixel", type: "neopixel" }, { id: "btn_next", type: "button" }, { id: "btn_mode", type: "button" }, { id: "potentiometer", type: "potentiometer" }], power: "usb", keywords: ["pixel art", "pixel frame", "led art", "pixel display", "retro display"] },
  "light theremin": { mcu: "arduino-uno", components: [{ id: "ldr", type: "ldr" }, { id: "neopixel", type: "neopixel" }, { id: "speaker", type: "speaker" }, { id: "potentiometer", type: "potentiometer" }], power: "usb", keywords: ["light theremin", "light instrument", "light music", "photophone"] },
  "color organ": { mcu: "esp32", components: [{ id: "microphone", type: "microphone" }, { id: "neopixel", type: "neopixel" }, { id: "potentiometer", type: "potentiometer" }, { id: "btn_mode", type: "button" }], power: "usb", keywords: ["color organ", "sound to light", "audio reactive", "music visualizer"] },

  // ── Sports & Fitness ──────────────────────────
  "shot clock": { mcu: "arduino-uno", components: [{ id: "oled", type: "oled" }, { id: "btn_start", type: "button" }, { id: "btn_reset", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "neopixel", type: "neopixel" }], power: "usb", keywords: ["shot clock", "game clock", "basketball clock"] },
  "pitch speed meter": { mcu: "arduino-uno", components: [{ id: "ultrasonic", type: "ultrasonic" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "led_status", type: "led", color: "green" }], power: "battery", keywords: ["pitch speed", "ball speed", "speed gun", "radar gun"] },
  "lap counter": { mcu: "arduino-nano", components: [{ id: "ir_receiver", type: "ir_receiver" }, { id: "ir_emitter", type: "ir_emitter" }, { id: "oled", type: "oled" }, { id: "btn_reset", type: "button" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["lap counter", "lap timer", "race lap", "track counter"] },
  "rep counter": { mcu: "esp32-s3", components: [{ id: "sensor_imu", type: "sensor" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "btn_start", type: "button" }, { id: "neopixel", type: "neopixel" }], power: "battery", keywords: ["rep counter", "exercise counter", "workout counter", "gym counter"] },
  "jump height meter": { mcu: "arduino-uno", components: [{ id: "ultrasonic", type: "ultrasonic" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "led_status", type: "led", color: "green" }, { id: "btn_measure", type: "button" }], power: "battery", keywords: ["jump height", "vertical jump", "jump meter", "vert"] },
  "swim lap counter": { mcu: "arduino-nano", components: [{ id: "btn_lap", type: "button" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "led_status", type: "led", color: "blue" }], power: "battery", keywords: ["swim lap", "pool counter", "swimming counter"] },
  "score keeper": { mcu: "arduino-nano", components: [{ id: "oled", type: "oled" }, { id: "btn_home", type: "button" }, { id: "btn_away", type: "button" }, { id: "btn_reset", type: "button" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["score keeper", "scoreboard", "score counter", "point tracker"] },

  // ── Office & Productivity ─────────────────────
  "timer": { mcu: "arduino-nano", components: [{ id: "oled", type: "oled" }, { id: "btn_start", type: "button" }, { id: "btn_reset", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "led_running", type: "led", color: "green" }, { id: "led_done", type: "led", color: "red" }], power: "battery", keywords: ["timer", "countdown", "stopwatch", "clock"] },
  "pomodoro timer": { mcu: "arduino-nano", components: [{ id: "oled", type: "oled" }, { id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }, { id: "btn_start", type: "button" }, { id: "btn_skip", type: "button" }], power: "usb", keywords: ["pomodoro", "focus timer", "work timer", "productivity timer"] },
  "meeting mute button": { mcu: "arduino-nano", components: [{ id: "btn_mute", type: "button" }, { id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["mute button", "meeting mute", "zoom mute", "teams mute"] },
  "desk occupancy": { mcu: "esp32", components: [{ id: "pir", type: "pir" }, { id: "led_occupied", type: "led", color: "red" }, { id: "led_free", type: "led", color: "green" }, { id: "ultrasonic", type: "ultrasonic" }], power: "usb", keywords: ["desk sensor", "occupancy sensor", "hot desk", "desk booking"] },
  "desk air quality": { mcu: "esp32", components: [{ id: "gas_sensor", type: "gas_sensor" }, { id: "temp_sensor", type: "sensor" }, { id: "oled", type: "oled" }, { id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["desk air", "office air", "workspace air", "office monitor"] },
  "macro pad": { mcu: "rp2040", components: [{ id: "btn_1", type: "button" }, { id: "btn_2", type: "button" }, { id: "btn_3", type: "button" }, { id: "btn_4", type: "button" }, { id: "btn_5", type: "button" }, { id: "btn_6", type: "button" }, { id: "neopixel", type: "neopixel" }, { id: "oled", type: "oled" }], power: "usb", keywords: ["macro pad", "stream deck", "hotkey pad", "shortcut pad", "key pad"] },
  "standing desk reminder": { mcu: "arduino-nano", components: [{ id: "ultrasonic", type: "ultrasonic" }, { id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }, { id: "btn_reset", type: "button" }], power: "usb", keywords: ["standing desk", "sit stand", "desk reminder", "ergonomic"] },

  // ── Accessibility ─────────────────────────────
  "vibration alert": { mcu: "esp32-s3", components: [{ id: "microphone", type: "microphone" }, { id: "motor", type: "motor" }, { id: "neopixel", type: "neopixel" }, { id: "pir", type: "pir" }], power: "battery", keywords: ["vibration alert", "deaf alert", "hearing impaired", "vibrate notify"] },
  "color identifier": { mcu: "esp32-s3", components: [{ id: "sensor_color", type: "sensor" }, { id: "speaker", type: "speaker" }, { id: "btn_scan", type: "button" }, { id: "oled", type: "oled" }, { id: "led_illuminate", type: "led", color: "white" }], power: "battery", keywords: ["color identifier", "color detector", "blind assist", "color reader"] },
  "distance cane": { mcu: "arduino-nano", components: [{ id: "ultrasonic", type: "ultrasonic" }, { id: "buzzer", type: "buzzer" }, { id: "motor", type: "motor" }, { id: "btn_mode", type: "button" }], power: "battery", keywords: ["distance cane", "smart cane", "blind cane", "obstacle cane", "walking cane"] },
  "large display clock": { mcu: "esp32", components: [{ id: "oled", type: "oled" }, { id: "temp_sensor", type: "sensor" }, { id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }, { id: "btn_set", type: "button" }], power: "usb", keywords: ["large clock", "big display", "easy read clock", "senior clock", "wall clock"] },
  "speech button": { mcu: "esp32-s3", components: [{ id: "btn_1", type: "button" }, { id: "btn_2", type: "button" }, { id: "btn_3", type: "button" }, { id: "btn_4", type: "button" }, { id: "speaker", type: "speaker" }, { id: "neopixel", type: "neopixel" }, { id: "oled", type: "oled" }], power: "battery", keywords: ["speech button", "aac device", "communication board", "talk button", "augmentative"] },
  "doorbell flasher": { mcu: "esp32", components: [{ id: "microphone", type: "microphone" }, { id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }, { id: "led_alert", type: "led", color: "red" }], power: "usb", keywords: ["doorbell flasher", "visual doorbell", "flash alert", "strobe alert"] },
  "braille cell": { mcu: "arduino-uno", components: [{ id: "servo_1", type: "servo" }, { id: "servo_2", type: "servo" }, { id: "servo_3", type: "servo" }, { id: "btn_next", type: "button" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["braille", "braille display", "braille cell", "tactile display"] },

  // ── Art & Creative ────────────────────────────
  "led poi": { mcu: "esp32-s3", components: [{ id: "neopixel", type: "neopixel" }, { id: "sensor_imu", type: "sensor" }, { id: "btn_mode", type: "button" }], power: "battery", keywords: ["led poi", "flow poi", "glow poi", "spinning poi"] },
  "sound reactive art": { mcu: "esp32", components: [{ id: "microphone", type: "microphone" }, { id: "neopixel", type: "neopixel" }, { id: "potentiometer", type: "potentiometer" }, { id: "btn_mode", type: "button" }], power: "usb", keywords: ["sound reactive", "audio art", "sound art", "interactive art"] },
  "kinetic sculpture": { mcu: "arduino-uno", components: [{ id: "motor", type: "motor" }, { id: "servo", type: "servo" }, { id: "neopixel", type: "neopixel" }, { id: "ldr", type: "ldr" }, { id: "potentiometer", type: "potentiometer" }], power: "usb", keywords: ["kinetic sculpture", "moving art", "kinetic art", "mechanical art"] },
  "light painting wand": { mcu: "rp2040", components: [{ id: "neopixel", type: "neopixel" }, { id: "btn_trigger", type: "button" }, { id: "btn_mode", type: "button" }, { id: "potentiometer", type: "potentiometer" }], power: "battery", keywords: ["light painting", "light wand", "long exposure", "pixelstick"] },
  "interactive mural": { mcu: "esp32-s3", components: [{ id: "ultrasonic", type: "ultrasonic" }, { id: "neopixel", type: "neopixel" }, { id: "pir", type: "pir" }, { id: "speaker", type: "speaker" }, { id: "led_accent", type: "led", color: "blue" }], power: "usb", keywords: ["interactive mural", "touch wall", "reactive wall", "installation art"] },
  "flame effect": { mcu: "arduino-nano", components: [{ id: "neopixel", type: "neopixel" }, { id: "temp_sensor", type: "sensor" }, { id: "btn_mode", type: "button" }, { id: "potentiometer", type: "potentiometer" }], power: "usb", keywords: ["flame effect", "fake fire", "electric candle", "fire simulation", "faux flame"] },
  "infinity mirror": { mcu: "esp32", components: [{ id: "neopixel", type: "neopixel" }, { id: "potentiometer", type: "potentiometer" }, { id: "btn_mode", type: "button" }, { id: "microphone", type: "microphone" }], power: "usb", keywords: ["infinity mirror", "led mirror", "depth mirror", "portal mirror"] },

  // ── Outdoor & Camping ─────────────────────────
  "headlamp": { mcu: "arduino-nano", components: [{ id: "neopixel", type: "neopixel" }, { id: "btn_mode", type: "button" }, { id: "ldr", type: "ldr" }, { id: "potentiometer", type: "potentiometer" }], power: "battery", keywords: ["headlamp", "head torch", "headlight", "hiking light"] },
  "trail marker": { mcu: "esp32", components: [{ id: "neopixel", type: "neopixel" }, { id: "ldr", type: "ldr" }, { id: "btn_mode", type: "button" }, { id: "gps", type: "gps" }], power: "battery", keywords: ["trail marker", "trail beacon", "path marker", "waypoint"] },
  "campfire monitor": { mcu: "arduino-uno", components: [{ id: "temp_sensor", type: "sensor" }, { id: "gas_sensor", type: "gas_sensor" }, { id: "buzzer", type: "buzzer" }, { id: "led_safe", type: "led", color: "green" }, { id: "led_danger", type: "led", color: "red" }], power: "battery", keywords: ["campfire", "fire monitor", "camp safety"] },
  "bear alarm": { mcu: "esp32", components: [{ id: "pir", type: "pir" }, { id: "buzzer", type: "buzzer" }, { id: "speaker", type: "speaker" }, { id: "led_alert", type: "led", color: "red" }], power: "battery", keywords: ["bear alarm", "bear deterrent", "wildlife alarm", "animal alert"] },
  "compass": { mcu: "esp32", components: [{ id: "sensor_mag", type: "sensor" }, { id: "oled", type: "oled" }, { id: "led_north", type: "led", color: "green" }, { id: "btn_calibrate", type: "button" }], power: "battery", keywords: ["compass", "digital compass", "heading", "navigation"] },
  "altimeter": { mcu: "esp32", components: [{ id: "sensor_baro", type: "sensor" }, { id: "oled", type: "oled" }, { id: "btn_calibrate", type: "button" }, { id: "led_status", type: "led", color: "blue" }], power: "battery", keywords: ["altimeter", "altitude", "elevation", "barometric altitude"] },

  // ── Marine & Boat ─────────────────────────────
  "bilge pump controller": { mcu: "esp32", components: [{ id: "moisture", type: "moisture" }, { id: "relay", type: "relay" }, { id: "buzzer", type: "buzzer" }, { id: "led_pump", type: "led", color: "blue" }, { id: "led_alarm", type: "led", color: "red" }, { id: "btn_manual", type: "button" }], power: "usb", keywords: ["bilge pump", "bilge", "boat pump", "hull water"] },
  "anchor light": { mcu: "arduino-nano", components: [{ id: "neopixel", type: "neopixel" }, { id: "ldr", type: "ldr" }, { id: "btn_mode", type: "button" }, { id: "led_status", type: "led", color: "white" }], power: "battery", keywords: ["anchor light", "navigation light", "boat light", "stern light"] },
  "depth sounder": { mcu: "arduino-uno", components: [{ id: "ultrasonic", type: "ultrasonic" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "led_shallow", type: "led", color: "red" }], power: "battery", keywords: ["depth sounder", "depth finder", "fish finder", "bathymetry"] },
  "wind speed indicator": { mcu: "arduino-uno", components: [{ id: "sensor_anemometer", type: "sensor" }, { id: "oled", type: "oled" }, { id: "led_status", type: "led", color: "green" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["wind speed", "anemometer", "wind meter", "wind gauge"] },
  "boat battery monitor": { mcu: "arduino-nano", components: [{ id: "sensor_voltage", type: "sensor" }, { id: "oled", type: "oled" }, { id: "led_ok", type: "led", color: "green" }, { id: "led_low", type: "led", color: "red" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["boat battery", "marine battery", "battery monitor", "voltage monitor"] },
  "nav light controller": { mcu: "arduino-uno", components: [{ id: "relay_port", type: "relay" }, { id: "relay_starboard", type: "relay" }, { id: "ldr", type: "ldr" }, { id: "btn_mode", type: "button" }, { id: "led_status", type: "led", color: "green" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["nav light", "navigation controller", "port starboard", "running light"] },

  // ── Fashion & Cosplay ─────────────────────────
  "led costume": { mcu: "esp32-s3", components: [{ id: "neopixel", type: "neopixel" }, { id: "btn_mode", type: "button" }, { id: "sensor_imu", type: "sensor" }, { id: "potentiometer", type: "potentiometer" }], power: "battery", keywords: ["led costume", "light suit", "glow costume", "rave outfit"] },
  "cosplay helmet": { mcu: "esp32-s3", components: [{ id: "neopixel", type: "neopixel" }, { id: "speaker", type: "speaker" }, { id: "microphone", type: "microphone" }, { id: "btn_mode", type: "button" }, { id: "led_eyes", type: "led", color: "blue" }], power: "battery", keywords: ["cosplay helmet", "costume helmet", "prop helmet", "mandalorian", "iron man"] },
  "light up shoes": { mcu: "arduino-nano", components: [{ id: "neopixel", type: "neopixel" }, { id: "sensor_imu", type: "sensor" }, { id: "btn_mode", type: "button" }], power: "battery", keywords: ["light shoes", "led shoes", "glow shoes", "light up sneaker"] },
  "led earrings": { mcu: "attiny85", components: [{ id: "neopixel", type: "neopixel" }, { id: "btn_mode", type: "button" }], power: "battery", keywords: ["led earring", "light earring", "glow earring", "cyber earring"] },
  "cyberpunk bracer": { mcu: "esp32-s3", components: [{ id: "oled", type: "oled" }, { id: "neopixel", type: "neopixel" }, { id: "btn_mode", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "sensor_imu", type: "sensor" }], power: "battery", keywords: ["cyberpunk bracer", "arm computer", "wrist computer", "pip boy"] },
  "animated tail": { mcu: "esp32-s3", components: [{ id: "servo", type: "servo" }, { id: "sensor_imu", type: "sensor" }, { id: "btn_mode", type: "button" }, { id: "neopixel", type: "neopixel" }], power: "battery", keywords: ["animated tail", "cosplay tail", "moving tail", "wagging tail", "furry tail"] },

  // ── Baby & Childcare ──────────────────────────
  "white noise nursery": { mcu: "esp32-s3", components: [{ id: "speaker", type: "speaker" }, { id: "potentiometer", type: "potentiometer" }, { id: "btn_sound", type: "button" }, { id: "neopixel", type: "neopixel" }, { id: "ldr", type: "ldr" }], power: "usb", keywords: ["nursery noise", "baby sleep sound", "infant soother", "nursery sound"] },
  "bottle warmer": { mcu: "arduino-uno", components: [{ id: "temp_sensor", type: "sensor" }, { id: "relay", type: "relay" }, { id: "oled", type: "oled" }, { id: "btn_start", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "led_ready", type: "led", color: "green" }], power: "usb", keywords: ["bottle warmer", "milk warmer", "formula warmer"] },
  "diaper alert": { mcu: "arduino-nano", components: [{ id: "moisture", type: "moisture" }, { id: "buzzer", type: "buzzer" }, { id: "led_wet", type: "led", color: "red" }, { id: "led_dry", type: "led", color: "green" }, { id: "neopixel", type: "neopixel" }], power: "battery", keywords: ["diaper", "nappy", "wetness alert", "diaper sensor"] },
  "nursery thermometer": { mcu: "esp32", components: [{ id: "temp_sensor", type: "sensor" }, { id: "oled", type: "oled" }, { id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["nursery temp", "room thermometer", "baby room temp"] },
  "toddler locator": { mcu: "esp32-s3", components: [{ id: "gps", type: "gps" }, { id: "buzzer", type: "buzzer" }, { id: "btn_ping", type: "button" }, { id: "led_status", type: "led", color: "green" }, { id: "neopixel", type: "neopixel" }], power: "battery", keywords: ["toddler locator", "child finder", "kid tracker", "child gps"] },
  "cry analyzer": { mcu: "esp32-s3", components: [{ id: "microphone", type: "microphone" }, { id: "oled", type: "oled" }, { id: "neopixel", type: "neopixel" }, { id: "speaker", type: "speaker" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["cry analyzer", "baby cry", "infant cry", "why crying"] },

  // ── Cleaning & Maintenance ────────────────────
  "robot vacuum": { mcu: "esp32", components: [{ id: "motor_left", type: "motor" }, { id: "motor_right", type: "motor" }, { id: "ultrasonic", type: "ultrasonic" }, { id: "pir", type: "pir" }, { id: "buzzer", type: "buzzer" }, { id: "btn_start", type: "button" }, { id: "led_status", type: "led", color: "green" }], power: "battery", keywords: ["robot vacuum", "roomba", "auto vacuum", "floor cleaner"] },
  "dust sensor": { mcu: "esp32", components: [{ id: "gas_sensor", type: "gas_sensor" }, { id: "oled", type: "oled" }, { id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["dust sensor", "dust monitor", "particle sensor", "dust level"] },
  "filter reminder": { mcu: "arduino-nano", components: [{ id: "sensor_pressure", type: "sensor" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "led_ok", type: "led", color: "green" }, { id: "led_change", type: "led", color: "red" }, { id: "btn_reset", type: "button" }], power: "usb", keywords: ["filter change", "filter reminder", "air filter", "hvac filter"] },
  "gutter monitor": { mcu: "esp32", components: [{ id: "moisture", type: "moisture" }, { id: "ultrasonic", type: "ultrasonic" }, { id: "led_clear", type: "led", color: "green" }, { id: "led_clogged", type: "led", color: "red" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["gutter monitor", "gutter sensor", "downspout", "drain monitor"] },
  "septic monitor": { mcu: "esp32", components: [{ id: "ultrasonic", type: "ultrasonic" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "led_ok", type: "led", color: "green" }, { id: "led_full", type: "led", color: "red" }], power: "battery", keywords: ["septic", "septic tank", "holding tank", "waste level"] },

  // ── Communication ─────────────────────────────
  "remote control": { mcu: "esp32", components: [{ id: "ir_emitter", type: "ir_emitter" }, { id: "oled", type: "oled" }, { id: "btn_power", type: "button" }, { id: "btn_up", type: "button" }, { id: "btn_down", type: "button" }, { id: "btn_ok", type: "button" }, { id: "led_tx", type: "led", color: "blue" }], power: "battery", keywords: ["remote control", "ir remote", "tv remote", "universal remote"] },
  "walkie talkie": { mcu: "esp32-s3", components: [{ id: "microphone", type: "microphone" }, { id: "speaker", type: "speaker" }, { id: "btn_ptt", type: "button" }, { id: "led_tx", type: "led", color: "red" }, { id: "led_rx", type: "led", color: "green" }, { id: "oled", type: "oled" }], power: "battery", keywords: ["walkie talkie", "two way radio", "push to talk", "intercom"] },
  "morse key": { mcu: "arduino-nano", components: [{ id: "btn_key", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "led_signal", type: "led", color: "green" }, { id: "oled", type: "oled" }], power: "battery", keywords: ["morse key", "telegraph key", "cw key", "ham radio key"] },
  "semaphore trainer": { mcu: "arduino-uno", components: [{ id: "servo_left", type: "servo" }, { id: "servo_right", type: "servo" }, { id: "oled", type: "oled" }, { id: "btn_next", type: "button" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["semaphore", "flag signal", "signal trainer"] },
  "message board": { mcu: "esp32", components: [{ id: "oled", type: "oled" }, { id: "btn_compose", type: "button" }, { id: "btn_send", type: "button" }, { id: "btn_scroll", type: "button" }, { id: "led_new", type: "led", color: "blue" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["message board", "bulletin board", "notice board", "memo board"] },

  // ── Aquatics & Aquarium ───────────────────────
  "aquarium thermometer": { mcu: "arduino-nano", components: [{ id: "temp_sensor", type: "sensor" }, { id: "oled", type: "oled" }, { id: "led_ok", type: "led", color: "green" }, { id: "led_alert", type: "led", color: "red" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["aquarium temp", "fish tank temp", "tank thermometer", "aquatic temp"] },
  "aquarium light": { mcu: "esp32", components: [{ id: "neopixel", type: "neopixel" }, { id: "potentiometer", type: "potentiometer" }, { id: "btn_mode", type: "button" }, { id: "ldr", type: "ldr" }], power: "usb", keywords: ["aquarium light", "fish tank light", "aqua light", "reef light"] },
  "ph monitor": { mcu: "arduino-uno", components: [{ id: "sensor_ph", type: "sensor" }, { id: "oled", type: "oled" }, { id: "led_acid", type: "led", color: "red" }, { id: "led_neutral", type: "led", color: "green" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["ph monitor", "aquarium ph", "reef ph", "water ph"] },
  "auto top off": { mcu: "esp32", components: [{ id: "ultrasonic", type: "ultrasonic" }, { id: "relay", type: "relay" }, { id: "led_pump", type: "led", color: "blue" }, { id: "led_low", type: "led", color: "red" }, { id: "buzzer", type: "buzzer" }, { id: "btn_manual", type: "button" }], power: "usb", keywords: ["auto top off", "ato", "water level", "evaporation", "top up"] },
  "wave maker": { mcu: "arduino-uno", components: [{ id: "motor", type: "motor" }, { id: "potentiometer", type: "potentiometer" }, { id: "btn_mode", type: "button" }, { id: "led_status", type: "led", color: "blue" }], power: "usb", keywords: ["wave maker", "powerhead", "water pump", "circulation pump"] },
  "reef doser": { mcu: "esp32", components: [{ id: "servo", type: "servo" }, { id: "oled", type: "oled" }, { id: "btn_dose", type: "button" }, { id: "led_status", type: "led", color: "green" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["reef doser", "dosing pump", "calcium reactor", "supplement doser"] },

  // ── Brewing & Fermentation ────────────────────
  "brew controller": { mcu: "esp32", components: [{ id: "temp_sensor", type: "sensor" }, { id: "relay", type: "relay" }, { id: "oled", type: "oled" }, { id: "btn_set", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "led_heating", type: "led", color: "red" }], power: "usb", keywords: ["brew controller", "homebrew", "beer brewing", "wort", "mash controller"] },
  "fermentation monitor": { mcu: "esp32", components: [{ id: "temp_sensor", type: "sensor" }, { id: "gas_sensor", type: "gas_sensor" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "led_status", type: "led", color: "green" }], power: "usb", keywords: ["fermentation", "fermenter", "wine making", "cider", "kombucha"] },
  "airlock counter": { mcu: "arduino-nano", components: [{ id: "sensor_ir", type: "sensor" }, { id: "oled", type: "oled" }, { id: "led_active", type: "led", color: "green" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["airlock", "bubble counter", "ferment activity", "airlock monitor"] },
  "keg level": { mcu: "esp32", components: [{ id: "sensor_load", type: "sensor" }, { id: "oled", type: "oled" }, { id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["keg level", "keg weight", "beer level", "keg monitor", "kegerator"] },
  "mash timer": { mcu: "esp32", components: [{ id: "oled", type: "oled" }, { id: "temp_sensor", type: "sensor" }, { id: "btn_start", type: "button" }, { id: "btn_step", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "led_active", type: "led", color: "green" }], power: "usb", keywords: ["mash timer", "mash step", "brew step", "sparge timer"] },

  // ── RC & Model ────────────────────────────────
  "rc car controller": { mcu: "esp32", components: [{ id: "pot_throttle", type: "potentiometer" }, { id: "pot_steering", type: "potentiometer" }, { id: "btn_horn", type: "button" }, { id: "led_power", type: "led", color: "green" }, { id: "buzzer", type: "buzzer" }, { id: "oled", type: "oled" }], power: "battery", keywords: ["rc car", "rc controller", "radio control car", "rc transmitter"] },
  "fpv timer": { mcu: "arduino-uno", components: [{ id: "ir_receiver", type: "ir_receiver" }, { id: "ir_emitter", type: "ir_emitter" }, { id: "oled", type: "oled" }, { id: "buzzer", type: "buzzer" }, { id: "btn_reset", type: "button" }, { id: "led_gate", type: "led", color: "green" }], power: "usb", keywords: ["fpv timer", "fpv gate", "drone race", "fpv race", "race gate"] },
  "model train": { mcu: "esp32", components: [{ id: "potentiometer", type: "potentiometer" }, { id: "btn_direction", type: "button" }, { id: "btn_horn", type: "button" }, { id: "oled", type: "oled" }, { id: "led_status", type: "led", color: "green" }, { id: "buzzer", type: "buzzer" }], power: "usb", keywords: ["model train", "train controller", "railway", "locomotive", "ho scale"] },
  "rc boat": { mcu: "esp32", components: [{ id: "servo", type: "servo" }, { id: "pot_rudder", type: "potentiometer" }, { id: "motor", type: "motor" }, { id: "btn_horn", type: "button" }, { id: "led_status", type: "led", color: "green" }], power: "battery", keywords: ["rc boat", "model boat", "radio boat", "rc ship"] },
  "launch controller": { mcu: "esp32", components: [{ id: "btn_arm", type: "button" }, { id: "btn_launch", type: "button" }, { id: "led_armed", type: "led", color: "red" }, { id: "led_safe", type: "led", color: "green" }, { id: "buzzer", type: "buzzer" }, { id: "relay", type: "relay" }, { id: "oled", type: "oled" }], power: "battery", keywords: ["launch controller", "rocket launch", "igniter", "model rocket"] },
  "altitude tracker": { mcu: "esp32", components: [{ id: "sensor_baro", type: "sensor" }, { id: "oled", type: "oled" }, { id: "btn_reset", type: "button" }, { id: "led_status", type: "led", color: "blue" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["altitude tracker", "altimeter logger", "rocket altitude", "flight recorder"] },

  // ── Escape Room & Entertainment ───────────────
  "puzzle box": { mcu: "esp32", components: [{ id: "servo", type: "servo" }, { id: "rfid", type: "rfid" }, { id: "btn_1", type: "button" }, { id: "btn_2", type: "button" }, { id: "btn_3", type: "button" }, { id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }, { id: "oled", type: "oled" }], power: "battery", keywords: ["puzzle box", "escape room", "mystery box", "lock box puzzle"] },
  "countdown bomb prop": { mcu: "arduino-uno", components: [{ id: "oled", type: "oled" }, { id: "neopixel", type: "neopixel" }, { id: "btn_wire1", type: "button" }, { id: "btn_wire2", type: "button" }, { id: "btn_wire3", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "led_defused", type: "led", color: "green" }], power: "battery", keywords: ["countdown bomb", "bomb prop", "defuse", "escape room bomb"] },
  "secret knock lock": { mcu: "esp32-s3", components: [{ id: "microphone", type: "microphone" }, { id: "servo", type: "servo" }, { id: "led_locked", type: "led", color: "red" }, { id: "led_unlocked", type: "led", color: "green" }, { id: "buzzer", type: "buzzer" }], power: "battery", keywords: ["secret knock", "knock lock", "pattern knock", "knock code"] },
  "cipher wheel": { mcu: "arduino-uno", components: [{ id: "potentiometer", type: "potentiometer" }, { id: "oled", type: "oled" }, { id: "btn_confirm", type: "button" }, { id: "buzzer", type: "buzzer" }, { id: "neopixel", type: "neopixel" }], power: "battery", keywords: ["cipher wheel", "decoder", "enigma", "crypto puzzle"] },
  "motion trigger prop": { mcu: "esp32-s3", components: [{ id: "pir", type: "pir" }, { id: "speaker", type: "speaker" }, { id: "neopixel", type: "neopixel" }, { id: "relay", type: "relay" }], power: "usb", keywords: ["motion trigger", "scare prop", "halloween", "haunted house", "jump scare"] },
  "treasure chest": { mcu: "esp32", components: [{ id: "servo", type: "servo" }, { id: "rfid", type: "rfid" }, { id: "neopixel", type: "neopixel" }, { id: "buzzer", type: "buzzer" }, { id: "btn_hint", type: "button" }, { id: "oled", type: "oled" }], power: "battery", keywords: ["treasure chest", "treasure box", "loot box", "pirate chest"] },
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
