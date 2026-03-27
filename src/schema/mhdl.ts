/**
 * MHDL — MeshCue Forge Hardware Description Language
 *
 * The single source of truth for a hardware project.
 * One YAML/JSON file describes the entire device:
 * board, firmware, enclosure, BOM, and metadata.
 */

// ─── Component Library ───────────────────────────────────────

export type ComponentType =
  | "mcu"
  | "led"
  | "button"
  | "resistor"
  | "capacitor"
  | "oled"
  | "lcd"
  | "buzzer"
  | "sensor"
  | "motor"
  | "relay"
  | "voltage-regulator"
  | "connector"
  | "antenna"
  | "crystal"
  | "transistor"
  | "diode"
  | "speaker"
  | "microphone"
  | "servo"
  | "ir_receiver"
  | "ir_emitter"
  | "neopixel"
  | "ultrasonic"
  | "pir"
  | "ldr"
  | "gps"
  | "rfid"
  | "potentiometer"
  | "moisture"
  | "gas_sensor"
  | "stepper"
  | "encoder"
  | "temperature_sensor"
  | "thermocouple"
  | "joystick"
  | "pulse_oximeter"
  | "ecg"
  | "blood_pressure"
  | "load_cell"
  | "color_sensor"
  | "custom";

export type MCUFamily =
  | "esp32"
  | "esp32-s3"
  | "esp32-c3"
  | "arduino-uno"
  | "arduino-nano"
  | "arduino-mega"
  | "rp2040"
  | "stm32"
  | "attiny85";

export type PinMode =
  | "digital-out"
  | "digital-in"
  | "analog-in"
  | "pwm"
  | "i2c-sda"
  | "i2c-scl"
  | "spi-mosi"
  | "spi-miso"
  | "spi-sck"
  | "spi-cs"
  | "uart-tx"
  | "uart-rx"
  | "power"
  | "ground";

// ─── Component Definitions ───────────────────────────────────

export interface Pin {
  id: string;
  gpio?: number;
  mode: PinMode;
  label?: string;
}

export interface Component {
  id: string;
  type: ComponentType;
  model?: string;
  value?: string;
  pins: Pin[];
  properties?: Record<string, string | number | boolean>;
  footprint?: string;
  datasheet?: string;
}

export interface MCU extends Component {
  type: "mcu";
  family: MCUFamily;
  clockMhz?: number;
  flashKb?: number;
  ramKb?: number;
  wireless?: ("wifi" | "bluetooth" | "ble" | "lora" | "zigbee")[];
}

// ─── Connections ─────────────────────────────────────────────

export interface Connection {
  from: string; // "component_id.pin_id"
  to: string;   // "component_id.pin_id"
  type?: "wire" | "bus" | "trace";
  net?: string;
  color?: string;
}

// ─── Power ───────────────────────────────────────────────────

export interface PowerConfig {
  source: "usb" | "battery" | "dc-jack" | "solar";
  voltageIn: number;
  regulatorOut?: number;
  maxCurrentMa: number;
  batteryMah?: number;
}

// ─── Board ───────────────────────────────────────────────────

export interface Board {
  mcu: MCU;
  components: Component[];
  connections: Connection[];
  power: PowerConfig;
  dimensions?: {
    widthMm: number;
    heightMm: number;
    depthMm?: number;
  };
  mountingHoles?: {
    diameterMm: number;
    positions: { x: number; y: number }[];
  };
}

// ─── Firmware ────────────────────────────────────────────────

export type FirmwareFramework =
  | "arduino"
  | "micropython"
  | "circuitpython"
  | "esp-idf"
  | "platformio";

export interface FirmwareLibrary {
  name: string;
  version?: string;
  source?: "arduino" | "platformio" | "pip" | "github";
  url?: string;
}

export interface FirmwareConfig {
  framework: FirmwareFramework;
  entrypoint: string;
  libraries: FirmwareLibrary[];
  boardId?: string;
  features?: string[];
  buildFlags?: string[];
  estimatedBatteryHours?: number;
}

// ─── Enclosure ───────────────────────────────────────────────

export type EnclosureType =
  | "snap-fit"
  | "screw-close"
  | "slide-on"
  | "friction-fit"
  | "open-frame";

export type EnclosureBackend =
  | "openscad"
  | "cadquery"
  | "zoo-cad"
  | "llama-mesh";

export type IPRating = "IP20" | "IP44" | "IP54" | "IP65" | "IP67" | "IP68";

export type SterilizationMethod = "none" | "chemical" | "uv" | "autoclave";

export type EnclosureMaterial =
  | "pla"
  | "petg"
  | "abs"
  | "tpu"
  | "pc"       // polycarbonate
  | "peek"
  | "silicone"
  | "pp";      // polypropylene

export interface CableGland {
  count: number;
  diameterMm: number;
}

export interface EnclosureSpec {
  ipRating?: IPRating;
  sterilization?: SterilizationMethod;
  biocompatible?: boolean;
  gasketGrooveMm?: number;
  cableGland?: CableGland;
}

export type CutoutType =
  | "usb-c"
  | "usb-micro"
  | "usb-a"
  | "dc-jack"
  | "led-hole"
  | "button-cap"
  | "oled-window"
  | "lcd-window"
  | "antenna-slot"
  | "vent"
  | "sd-card"
  | "audio-jack"
  | "speaker-grille"
  | "mic-hole"
  | "custom-rect"
  | "custom-circle";

export interface Cutout {
  type: CutoutType;
  componentRef?: string;
  position?: { x: number; y: number; z: number };
  size?: { width: number; height: number };
  diameter?: number;
  wall: "front" | "back" | "left" | "right" | "top" | "bottom";
}

export interface EnclosureConfig {
  type: EnclosureType;
  wallThicknessMm: number;
  cornerRadiusMm: number;
  cutouts: Cutout[];
  mounts: "m2-inserts" | "m3-inserts" | "snap-posts" | "standoffs";
  ventilation?: boolean;
  labelEmboss?: string;
  material?: EnclosureMaterial;
  printOrientation?: "upright" | "flat" | "on-side";
  backend?: EnclosureBackend;
  organicShape?: string; // Natural language shape hint for AI backends

  // Medical-grade enclosure features
  ipRating?: IPRating;
  sterilization?: SterilizationMethod;
  biocompatible?: boolean;
  gasketGrooveMm?: number;
  cableGland?: CableGland;
}

// ─── PCB ────────────────────────────────────────────────────

export type PCBBackend = "skidl" | "kicad";

export interface PCBConfig {
  backend?: PCBBackend;
  layers?: 2 | 4;
  widthMm?: number;
  heightMm?: number;
  copperWeight?: "1oz" | "2oz";
  surfaceFinish?: "hasl" | "enig" | "osp";
  autoRoute?: boolean;
  traceWidthMm?: number;
  viaSizeMm?: number;
}

// ─── Visualization ──────────────────────────────────────────

export type VisualizationBackend = "hunyuan3d" | "llama-mesh" | "cosmos";

export interface VisualizationConfig {
  generate3DModel?: boolean;
  generateVideo?: boolean;
  backend?: VisualizationBackend;
  style?: "photorealistic" | "technical" | "cartoon";
  background?: string;
  cameraAngle?: "front" | "isometric" | "top" | "exploded";
}

// ─── BOM ─────────────────────────────────────────────────────

export interface BOMEntry {
  componentRef: string;
  partNumber?: string;
  supplier?: "digikey" | "mouser" | "lcsc" | "adafruit" | "sparkfun";
  quantity: number;
  unitPrice?: number;
  url?: string;
}

export interface BOMConfig {
  auto: boolean;
  preferredSuppliers?: string[];
  budget?: number;
  currency?: string;
  entries?: BOMEntry[];
}

// ─── Documentation ───────────────────────────────────────────

export interface DocsConfig {
  generatePinout: boolean;
  generateAssembly: boolean;
  generateBOM: boolean;
  generatePrintGuide: boolean;
  generateMedicalDocs?: boolean;
  readme?: boolean;
  language?: "en" | "fr" | "pt" | "es" | "sw" | "ar" | "bn" | "hi" | "zh";
}

// ─── Metadata ────────────────────────────────────────────────

export interface MHDLMeta {
  schemaVersion: "0.1.0";
  name: string;
  description: string;
  version: string;
  license?: string;
  author?: string;
  url?: string;
  tags?: string[];

  // Medical device metadata
  medical?: boolean;
  deviceClass?: "I" | "IIa" | "IIb" | "III";
  intendedUse?: string;
}

// ─── Root MHDL Document ──────────────────────────────────────

export interface MHDLDocument {
  meta: MHDLMeta;
  board: Board;
  firmware: FirmwareConfig;
  enclosure: EnclosureConfig;
  pcb?: PCBConfig;
  visualization?: VisualizationConfig;
  bom?: BOMConfig;
  docs?: DocsConfig;
}

// ─── Validation Result ───────────────────────────────────────

export type Severity = "error" | "warning" | "info";

export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  path?: string;
  fix?: string;
}

export interface MedicalStats {
  medicalClass?: "I" | "IIa" | "IIb" | "III";
  medicalChecks: number;
  medicalWarnings: number;
  estimatedBatteryHours?: number;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  stats: {
    componentCount: number;
    connectionCount: number;
    pinUsage: number;
    estimatedCurrentMa: number;
    enclosureVolumeMm3: number;
    medical?: MedicalStats;
  };
}

// ─── Build Output ────────────────────────────────────────────

export type BuildStageType =
  | "circuit"
  | "firmware"
  | "enclosure"
  | "pcb"
  | "bom"
  | "docs"
  | "visualization";

export interface BuildArtifact {
  stage: BuildStageType;
  filename: string;
  content: string;
  format: string;
  contentType?: "text" | "base64" | "url";
  mimeType?: string;
  backend?: string;
}

export interface FailedStage {
  stage: BuildStageType;
  error: string;
}

export interface BuildResult {
  success: boolean;
  artifacts: BuildArtifact[];
  validation: ValidationResult;
  buildTime: number;
  failedStages: FailedStage[];
}

// ─── Forge Configuration ────────────────────────────────────

export interface ForgeConfig {
  // API endpoints
  zooCadApiKey?: string;
  zooCadEndpoint?: string;
  llamaMeshEndpoint?: string;
  hunyuan3dEndpoint?: string;
  cosmosEndpoint?: string;

  // Local tools
  pythonPath?: string;
  kicadPath?: string;
  openscadPath?: string;

  // Preferences
  defaultEnclosureBackend?: EnclosureBackend;
  defaultPCBBackend?: PCBBackend;
  defaultVisualizationBackend?: VisualizationBackend;
  enableGpuBackends?: boolean;
}
