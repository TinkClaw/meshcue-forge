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

## Architecture

MeshCue Forge follows a linear pipeline with validation at every stage:

```
Natural Language Input
    |
    v  meshforge-describe (keyword NL parser)
    |
  MHDL Spec (YAML/JSON — single source of truth)
    |
    v  meshforge-validate (Design Rule Checks)
    |
    v  meshforge-build (parallel backend execution)
    |
    +-- Circuit Stage     -> diagram.json (Wokwi)
    +-- Firmware Stage    -> main.ino + platformio.ini (Arduino)
    +-- Enclosure Stage   -> enclosure.scad (OpenSCAD / CadQuery / Zoo / LLaMA-Mesh)
    +-- PCB Stage         -> pcb.py (SKiDL) or .kicad_pcb (KiCad)
    +-- BOM Stage         -> bom.csv
    +-- Docs Stage        -> PINOUT.md, ASSEMBLY.md, PRINT_GUIDE.md
    +-- Viz Stage         -> 3D model / video (Hunyuan3D / Cosmos / LLaMA-Mesh)
```

The `meshforge-iterate` tool allows patching an existing spec and re-running the pipeline without starting from scratch.

## Backend Configuration

Each pipeline stage has a default backend and optional alternatives. Backends are selected via environment variables or per-spec overrides.

| Stage | Env Variable | Default | Alternatives | Requirements |
|-------|-------------|---------|-------------|--------------|
| Enclosure | `FORGE_ENCLOSURE_BACKEND` | `openscad` | `cadquery`, `zoo-cad`, `llama-mesh` | OpenSCAD: none (generates .scad). CadQuery: Python 3 + cadquery pip package. Zoo: `ZOO_CAD_API_KEY`. LLaMA-Mesh: `LLAMA_MESH_ENDPOINT`. |
| PCB | `FORGE_PCB_BACKEND` | `skidl` | `kicad` | SKiDL: generates Python script (execution needs Python + skidl). KiCad: `KICAD_PATH` pointing to kicad-cli. |
| Visualization | `FORGE_VIZ_BACKEND` | `hunyuan3d` | `cosmos`, `llama-mesh` | All generate placeholders in offline mode. Online mode requires the respective `*_ENDPOINT` env var. |
| Circuit | (not configurable) | Wokwi JSON | -- | None |
| Firmware | (not configurable) | Arduino | -- | None (generates source; compilation requires Arduino CLI or PlatformIO) |

See [`.env.example`](.env.example) for all environment variables.

## Troubleshooting

**"Python not found" or CadQuery backend fails**
- Set `PYTHON_PATH` to your Python 3 interpreter (e.g., `PYTHON_PATH=/usr/local/bin/python3`).
- Ensure `cadquery` is installed: `pip3 install cadquery`.

**"KiCad not installed" or PCB generation fails with kicad backend**
- Install KiCad 9 from [kicad.org](https://www.kicad.org/download/).
- Set `KICAD_PATH` to the CLI binary (e.g., `KICAD_PATH=/usr/bin/kicad-cli` on Linux, `KICAD_PATH=/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli` on macOS).

**Zoo Text-to-CAD returns errors**
- Verify your API key is valid: `curl -H "Authorization: Bearer $ZOO_CAD_API_KEY" https://api.zoo.dev/user`.
- Check that `ZOO_CAD_ENDPOINT` is set correctly (default: `https://api.zoo.dev`).

**Enclosure cutouts don't match components**
- Ensure `componentRef` in each cutout matches a component `id` in the board section.
- Run `meshforge-validate` to catch mismatches before building.

**Build succeeds but firmware won't compile**
- MeshCue Forge generates source code, not compiled binaries. You need Arduino CLI or PlatformIO installed to compile.
- Check that all libraries listed in the MHDL spec are available in your Arduino/PlatformIO environment.

**"I2C address collision" validation error**
- Two components share the same I2C address. Change the address in the component's `properties.i2cAddress` field, or use different I2C bus pins.

**OpenSCAD rendering is slow**
- OpenSCAD .scad files are generated instantly. Rendering to STL requires OpenSCAD installed locally (`OPENSCAD_PATH`).
- For faster iteration, preview in the OpenSCAD GUI before exporting.

## Contributing

MeshCue Forge is MIT licensed and welcomes contributions.

### Adding a New Backend

1. Create a new file in the appropriate `src/backends/` directory (e.g., `src/backends/enclosure/freecad.ts`).
2. Implement the backend interface matching the existing pattern (see `openscad.ts` or `cadquery.ts` as reference).
3. Register the backend in the stage's factory/registry.
4. Add the backend identifier to the relevant type union in `src/schema/mhdl.ts`.
5. Update `src/config.ts` to detect the new backend's capabilities.
6. Add tests covering the new backend's output.

### Running Tests

```bash
npm run build          # Compile TypeScript
npm test               # Run all tests
npx tsx test.ts        # Run integration tests
npm run typecheck      # Type-check without emitting
npm run lint           # ESLint
npm run format:check   # Prettier check
```

### Submitting PRs

1. Fork the repo and create a feature branch from `main`.
2. Follow the existing code style (TypeScript strict mode, ESLint + Prettier).
3. Include tests for new functionality.
4. Run `npm run typecheck && npm run lint && npm test` before submitting.
5. Keep PRs focused: one backend, one feature, or one fix per PR.

### Contribution Ideas

- **New component templates** -- add support for more sensors, displays, actuators.
- **Backend plugins** -- MicroPython firmware, FreeCAD enclosures, EasyEDA PCBs.
- **Board templates** -- pre-built MHDL specs for common projects.
- **Validation rules** -- more DRC checks (thermal analysis, signal integrity).
- **MHDL schema extensions** -- new fields for advanced use cases.

## MeshCue Connect

MeshCue Connect is the patient communication layer — it closes the loop between medical devices, clinics, patients, and families.

### What It Does

- **Clinic-to-patient-to-family communication** — critical readings trigger alerts that flow from device to clinic to patient to family, automatically.
- **Smart triage** — AI-powered keyword detection routes incoming messages by urgency (e.g., FEVER triggers nurse notification, HELP triggers emergency escalation, STOP triggers instant opt-out).
- **Patient consent management** — patients opt in/out at any time via SMS or USSD. Consent state is tracked per-patient, per-channel.

### Supported Channels

| Channel | Provider | Notes |
|---------|----------|-------|
| SMS | Africa's Talking | Works on any phone, any network. No internet needed. |
| USSD | Africa's Talking | Zero data cost. Patients dial *123# to report symptoms, request appointments, check results. |
| WhatsApp | WhatsApp Business API | Rich messages with images, documents, and interactive buttons. |
| Voice/IVR | Africa's Talking or Twilio | Automated voice calls for critical alerts. Supports text-to-speech in 9 languages. |

### Languages

9 languages supported: English, French, Swahili, Kinyarwanda, Lingala, Kirundi, Portuguese, Arabic, Spanish. Language is set per-patient and auto-detected from incoming messages.

### MCP Tools

| Tool | Description |
|------|-------------|
| `meshcue-connect-alert` | Send a critical alert to patient + family + nurse based on device reading |
| `meshcue-connect-send` | Send a message to a specific phone number via any channel |
| `meshcue-connect-register` | Register a patient with phone, language, emergency contacts, and consent |
| `meshcue-connect-inbox` | Retrieve incoming messages (symptoms, replies, opt-outs) |

### Configuration

All Connect environment variables are documented in [`.env.example`](.env.example). Key variables:

- `MESHCUE_AT_API_KEY` / `MESHCUE_AT_USERNAME` — Africa's Talking credentials
- `MESHCUE_WA_TOKEN` / `MESHCUE_WA_PHONE_ID` — WhatsApp Business API
- `MESHCUE_VOICE_PROVIDER` — `"africastalking"` or `"twilio"`
- `MESHCUE_DEFAULT_CHANNEL` — Default delivery channel (`sms`, `whatsapp`, `voice`)
- `MESHCUE_DEFAULT_LANGUAGE` — Default language code (`en`, `fr`, `sw`, `rw`, `ln`, `rn`, `pt`, `ar`, `es`)
- `MESHCUE_ESCALATION_PHONE` — Fallback phone number for critical alerts when primary contacts fail

## Known Limitations

- **Keyword-based NL parsing**: The `meshforge-describe` tool uses keyword matching, not a full NLU model. Complex or ambiguous descriptions may produce incomplete specs. Iterate with `meshforge-iterate` to refine.
- **Arduino-only firmware generation**: Only Arduino/C++ firmware is generated currently. MicroPython and ESP-IDF support are planned but not yet implemented.
- **No compiled output**: Forge generates source files (`.ino`, `.scad`, `.py`), not compiled binaries or rendered STLs. You need the respective toolchains installed locally to compile/render.
- **Wokwi-only circuit output**: Circuit diagrams are generated in Wokwi JSON format only. Fritzing and SPICE export are planned.
- **2-layer PCB only**: SKiDL backend currently generates 2-layer PCBs. 4-layer support is defined in the schema but not yet implemented.
- **AI backends require external servers**: Zoo Text-to-CAD, LLaMA-Mesh, Hunyuan3D, and Cosmos all require external API endpoints. Without them, Forge operates in offline mode with template-based generation.
- **Limited component library**: While many common components are supported, some specialized parts (e.g., specific sensor models) may need to be defined as `custom` type with manual pin configuration.

## License

MIT

---

Built by [TinkClaw](https://tinkclaw.com) | [forge.meshcue.com](https://forge.meshcue.com) | Powering the MeshCue decentralized mesh network.
