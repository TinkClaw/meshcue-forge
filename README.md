# MeshCue Forge

**The hardware compiler — describe it, build it, print it.**

[forge.meshcue.com](https://forge.meshcue.com)

MeshCue Forge is an open-source MCP server that turns natural language hardware descriptions into complete, buildable projects: circuits, firmware, 3D-printable enclosures, PCB files, and documentation — all from a single spec.

## How It Works

```
"ESP32-S3 board with OLED, 3 LEDs, 2 buttons, and a buzzer"
    |
    v  meshforge-describe
    |
  MHDL Spec (single source of truth)
    |
    v  meshforge-build
    |
    +-- diagram.json       (Wokwi circuit — simulate in browser)
    +-- main.ino           (Arduino firmware — ready to compile)
    +-- platformio.ini     (Build config)
    +-- enclosure.scad     (OpenSCAD — 3D printable case)
    +-- bom.csv            (Bill of materials)
    +-- PINOUT.md          (GPIO reference)
    +-- ASSEMBLY.md        (Step-by-step build guide)
    +-- PRINT_GUIDE.md     (3D print settings)
```

## Quick Start

### Install

```bash
npm install @meshcue/forge
```

### Add to Claude Code

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "meshcue-forge": {
      "command": "node",
      "args": ["node_modules/@meshcue/forge/dist/index.js"]
    }
  }
}
```

### Use It

Just describe what you want to build:

> "Use meshcue forge to design an ESP32-S3 board with an OLED display, 3 status LEDs, 2 buttons, and a buzzer for a mesh networking node"

MeshCue Forge generates everything you need to simulate, build, and 3D print the device.

## MCP Tools

| Tool | Description |
|------|-------------|
| `meshforge-describe` | Natural language to MHDL spec |
| `meshforge-build` | MHDL to all build artifacts |
| `meshforge-validate` | Design Rule Checks (DRC) |
| `meshforge-iterate` | Patch spec + rebuild |

## MHDL — Hardware Description Language

MHDL is the single source of truth for a hardware project. One YAML/JSON file describes the entire device:

```yaml
meta:
  name: MeshCue Node
  version: 1.0.0

board:
  mcu:
    family: esp32-s3
  components:
    - id: oled
      type: oled
    - id: led_green
      type: led
  connections:
    - from: mcu.oled_sda
      to: oled.sda

firmware:
  framework: arduino
  entrypoint: main.ino

enclosure:
  type: snap-fit
  cutouts:
    - type: oled-window
      wall: front
    - type: usb-c
      wall: back
```

MHDL is git-friendly (text-based diffs), team-friendly (one file everyone works from), and AI-friendly (structured enough for generation, readable enough for humans).

## Validation (DRC)

Every build runs automatic Design Rule Checks:

- **Pin conflict detection** — no two components on the same GPIO
- **I2C address collision** — no duplicate bus addresses
- **Power budget check** — total draw vs. supply capacity
- **Connection integrity** — all pin references are valid
- **Enclosure fit** — cutouts reference real components
- **Mounting alignment** — holes are within board bounds

## Pluggable Backends

MeshCue Forge uses a pluggable backend architecture:

| Stage | Default Backend | Alternatives |
|-------|----------------|-------------|
| Circuit | Wokwi JSON | Fritzing, SPICE |
| Firmware | Arduino | MicroPython, ESP-IDF |
| Enclosure | OpenSCAD | CadQuery, FreeCAD |
| PCB | KiCad | EasyEDA |

## Supported Hardware

### MCUs
ESP32, ESP32-S3, ESP32-C3, Arduino Uno/Nano/Mega, RP2040, STM32, ATtiny85

### Components
LEDs, buttons, OLED/LCD displays, buzzers, sensors (DHT22), motors, relays, transistors, resistors, capacitors

### Enclosure Types
Snap-fit, screw-close, slide-on, friction-fit, open-frame

## Flagship: MeshCue Node

The MeshCue Node — a dedicated mesh networking hardware device — was designed and built entirely using MeshCue Forge. See the [examples/meshcue-node](examples/meshcue-node) directory for the complete project.

```bash
npx tsx examples/meshcue-node/build.ts
```

## Development

```bash
git clone https://github.com/tinkclaw/meshcue-forge.git
cd meshcue-forge
npm install
npm run build
npm run dev  # watch mode
```

Run tests:
```bash
npx tsx test.ts
```

## Contributing

MeshCue Forge is MIT licensed and welcomes contributions:

- **New component templates** — add support for more sensors, displays, etc.
- **Backend plugins** — MicroPython firmware, FreeCAD enclosures, EasyEDA PCBs
- **Board templates** — pre-built MHDL specs for common projects
- **Validation rules** — more DRC checks

## License

MIT

---

Built by [TinkClaw](https://tinkclaw.com) | [forge.meshcue.com](https://forge.meshcue.com) | Powering the MeshCue decentralized mesh network.
