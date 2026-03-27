# MHDL Schema Reference

**Version: 0.1.0** | **Status: Unstable (pre-1.0)**

MHDL (MeshCue Hardware Description Language) is the single source of truth for a hardware project. One YAML or JSON file describes the entire device: board, firmware, enclosure, PCB layout, visualization, BOM, and documentation settings.

## Schema Versioning

The schema version is declared in the `meta.schemaVersion` field of every MHDL document.

**Stability guarantees:**

- The schema is currently **unstable** (pre-1.0.0).
- Breaking changes will increment the **minor** version until 1.0.0 (e.g., 0.1.0 -> 0.2.0).
- Non-breaking additions (new optional fields) increment the **patch** version (e.g., 0.1.0 -> 0.1.1).
- Once 1.0.0 is reached, standard semver rules apply: breaking changes require a major version bump.

## Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `meta` | `MHDLMeta` | Yes | Project metadata, schema version, name, description |
| `board` | `Board` | Yes | MCU, components, connections, power configuration |
| `firmware` | `FirmwareConfig` | Yes | Framework, entrypoint, libraries, build flags |
| `enclosure` | `EnclosureConfig` | Yes | Case type, cutouts, mounting, material, 3D print settings |
| `pcb` | `PCBConfig` | No | PCB layout settings (layers, dimensions, routing) |
| `visualization` | `VisualizationConfig` | No | 3D model and video generation settings |
| `bom` | `BOMConfig` | No | Bill of materials — auto-generate or specify entries |
| `docs` | `DocsConfig` | No | Which documentation artifacts to generate |

### `meta` Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | `"0.1.0"` | Yes | MHDL schema version |
| `name` | `string` | Yes | Project name |
| `description` | `string` | Yes | Human-readable description |
| `version` | `string` | Yes | Project version (semver) |
| `license` | `string` | No | License identifier (e.g., "MIT") |
| `author` | `string` | No | Author name or organization |
| `url` | `string` | No | Project URL |
| `tags` | `string[]` | No | Searchable tags |

### `board` Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mcu` | `MCU` | Yes | Microcontroller (family, pins, wireless capabilities) |
| `components` | `Component[]` | Yes | All non-MCU components |
| `connections` | `Connection[]` | Yes | Wiring between component pins |
| `power` | `PowerConfig` | Yes | Power source, voltage, current budget |
| `dimensions` | `object` | No | Board dimensions in mm (width, height, depth) |
| `mountingHoles` | `object` | No | Mounting hole diameter and positions |

### `firmware` Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `framework` | `string` | Yes | `arduino`, `micropython`, `circuitpython`, `esp-idf`, `platformio` |
| `entrypoint` | `string` | Yes | Main source file (e.g., `main.ino`) |
| `libraries` | `FirmwareLibrary[]` | Yes | Required libraries |
| `boardId` | `string` | No | PlatformIO board identifier |
| `features` | `string[]` | No | Feature flags for firmware generation |
| `buildFlags` | `string[]` | No | Compiler flags |

### `enclosure` Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | `snap-fit`, `screw-close`, `slide-on`, `friction-fit`, `open-frame` |
| `wallThicknessMm` | `number` | Yes | Wall thickness in mm |
| `cornerRadiusMm` | `number` | Yes | Corner radius in mm |
| `cutouts` | `Cutout[]` | Yes | Port and window cutouts |
| `mounts` | `string` | Yes | `m2-inserts`, `m3-inserts`, `snap-posts`, `standoffs` |
| `ventilation` | `boolean` | No | Add ventilation holes |
| `labelEmboss` | `string` | No | Text to emboss on the case |
| `material` | `string` | No | `pla`, `petg`, `abs`, `tpu` |
| `printOrientation` | `string` | No | `upright`, `flat`, `on-side` |
| `backend` | `string` | No | Override default enclosure backend |
| `organicShape` | `string` | No | Natural language shape hint for AI backends |

### `pcb` Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `backend` | `string` | No | `skidl` or `kicad` |
| `layers` | `number` | No | 2 or 4 layer PCB |
| `widthMm` | `number` | No | Board width |
| `heightMm` | `number` | No | Board height |
| `copperWeight` | `string` | No | `1oz` or `2oz` |
| `surfaceFinish` | `string` | No | `hasl`, `enig`, `osp` |
| `autoRoute` | `boolean` | No | Enable auto-routing |

### `visualization` Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `generate3DModel` | `boolean` | No | Generate a 3D model of the device |
| `generateVideo` | `boolean` | No | Generate a turntable or assembly video |
| `backend` | `string` | No | `hunyuan3d`, `llama-mesh`, `cosmos` |
| `style` | `string` | No | `photorealistic`, `technical`, `cartoon` |
| `background` | `string` | No | Background color or scene |
| `cameraAngle` | `string` | No | `front`, `isometric`, `top`, `exploded` |

## Minimal Valid MHDL Example

The smallest valid MHDL document — an ESP32 with a single LED:

```yaml
meta:
  schemaVersion: "0.1.0"
  name: Blinky
  description: A single blinking LED
  version: 1.0.0

board:
  mcu:
    id: mcu
    type: mcu
    family: esp32
    pins:
      - id: gpio2
        gpio: 2
        mode: digital-out
  components:
    - id: led1
      type: led
      pins:
        - id: anode
          mode: digital-in
  connections:
    - from: mcu.gpio2
      to: led1.anode
  power:
    source: usb
    voltageIn: 5
    maxCurrentMa: 500

firmware:
  framework: arduino
  entrypoint: main.ino
  libraries: []

enclosure:
  type: open-frame
  wallThicknessMm: 2
  cornerRadiusMm: 2
  cutouts: []
  mounts: standoffs
```

## Full-Featured MHDL Example

A complete MeshCue Node with all optional sections:

```yaml
meta:
  schemaVersion: "0.1.0"
  name: MeshCue Node
  description: Dedicated mesh networking hardware node with OLED, LEDs, buttons, and buzzer
  version: 1.0.0
  license: MIT
  author: TinkClaw
  url: https://forge.meshcue.com
  tags:
    - mesh-networking
    - esp32
    - iot

board:
  mcu:
    id: mcu
    type: mcu
    family: esp32-s3
    clockMhz: 240
    flashKb: 8192
    ramKb: 512
    wireless:
      - wifi
      - ble
    pins:
      - id: sda
        gpio: 21
        mode: i2c-sda
      - id: scl
        gpio: 22
        mode: i2c-scl
      - id: gpio2
        gpio: 2
        mode: digital-out
      - id: gpio4
        gpio: 4
        mode: digital-out
      - id: gpio5
        gpio: 5
        mode: digital-out
      - id: gpio12
        gpio: 12
        mode: digital-in
      - id: gpio14
        gpio: 14
        mode: digital-in
      - id: gpio15
        gpio: 15
        mode: pwm
  components:
    - id: oled
      type: oled
      model: SSD1306
      pins:
        - id: sda
          mode: i2c-sda
        - id: scl
          mode: i2c-scl
      properties:
        i2cAddress: "0x3C"
        width: 128
        height: 64
    - id: led_green
      type: led
      value: green
      pins:
        - id: anode
          mode: digital-in
    - id: led_yellow
      type: led
      value: yellow
      pins:
        - id: anode
          mode: digital-in
    - id: led_red
      type: led
      value: red
      pins:
        - id: anode
          mode: digital-in
    - id: btn_action
      type: button
      pins:
        - id: signal
          mode: digital-out
    - id: btn_reset
      type: button
      pins:
        - id: signal
          mode: digital-out
    - id: buzzer
      type: buzzer
      pins:
        - id: signal
          mode: pwm
  connections:
    - from: mcu.sda
      to: oled.sda
      type: bus
      net: I2C_SDA
    - from: mcu.scl
      to: oled.scl
      type: bus
      net: I2C_SCL
    - from: mcu.gpio2
      to: led_green.anode
    - from: mcu.gpio4
      to: led_yellow.anode
    - from: mcu.gpio5
      to: led_red.anode
    - from: mcu.gpio12
      to: btn_action.signal
    - from: mcu.gpio14
      to: btn_reset.signal
    - from: mcu.gpio15
      to: buzzer.signal
  power:
    source: usb
    voltageIn: 5
    regulatorOut: 3.3
    maxCurrentMa: 500
  dimensions:
    widthMm: 60
    heightMm: 40
    depthMm: 20
  mountingHoles:
    diameterMm: 2.5
    positions:
      - { x: 3, y: 3 }
      - { x: 57, y: 3 }
      - { x: 3, y: 37 }
      - { x: 57, y: 37 }

firmware:
  framework: arduino
  entrypoint: main.ino
  boardId: esp32-s3-devkitc-1
  libraries:
    - name: Adafruit SSD1306
      version: "^2.5"
      source: arduino
    - name: Adafruit GFX Library
      source: arduino
    - name: WiFi
      source: arduino
  features:
    - mesh-networking
    - ota-updates
  buildFlags:
    - "-DCORE_DEBUG_LEVEL=3"

enclosure:
  type: snap-fit
  wallThicknessMm: 2.5
  cornerRadiusMm: 3
  cutouts:
    - type: oled-window
      componentRef: oled
      wall: front
    - type: usb-c
      wall: back
    - type: led-hole
      componentRef: led_green
      wall: front
      diameter: 3
    - type: led-hole
      componentRef: led_yellow
      wall: front
      diameter: 3
    - type: led-hole
      componentRef: led_red
      wall: front
      diameter: 3
    - type: button-cap
      componentRef: btn_action
      wall: top
    - type: button-cap
      componentRef: btn_reset
      wall: top
    - type: vent
      wall: bottom
  mounts: m2-inserts
  ventilation: true
  labelEmboss: MeshCue Node
  material: petg
  printOrientation: upright

pcb:
  backend: skidl
  layers: 2
  widthMm: 60
  heightMm: 40
  copperWeight: 1oz
  surfaceFinish: hasl
  autoRoute: true

visualization:
  generate3DModel: true
  generateVideo: true
  backend: hunyuan3d
  style: photorealistic
  cameraAngle: isometric

bom:
  auto: true
  preferredSuppliers:
    - adafruit
    - digikey
  budget: 25
  currency: USD

docs:
  generatePinout: true
  generateAssembly: true
  generateBOM: true
  generatePrintGuide: true
  readme: true
```

## Supported Component Types

`mcu`, `led`, `button`, `resistor`, `capacitor`, `oled`, `lcd`, `buzzer`, `sensor`, `motor`, `relay`, `voltage-regulator`, `connector`, `antenna`, `crystal`, `transistor`, `diode`, `speaker`, `microphone`, `servo`, `ir_receiver`, `ir_emitter`, `neopixel`, `ultrasonic`, `pir`, `ldr`, `gps`, `rfid`, `potentiometer`, `moisture`, `gas_sensor`, `stepper`, `encoder`, `temperature_sensor`, `thermocouple`, `joystick`, `custom`

## Supported MCU Families

`esp32`, `esp32-s3`, `esp32-c3`, `arduino-uno`, `arduino-nano`, `arduino-mega`, `rp2040`, `stm32`, `attiny85`
