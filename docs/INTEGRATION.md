# MeshCue Forge Integration Guide

MeshCue Forge is an MCP (Model Context Protocol) server. It can be connected to any MCP-compatible client: Claude Desktop, Claude Code, custom applications via the MCP SDK, or tested directly via HTTP.

## Web UI Connection

The MeshCue Forge landing page at [forge.meshcue.com](https://forge.meshcue.com) connects to the MCP server for browser-based hardware generation.

To run the server locally for the web UI:

```bash
# Install and build
npm install
npm run build

# Start the MCP server (stdio transport)
node dist/index.js

# Or use the CLI binary
npx meshcue-forge
```

The web UI communicates with the MCP server over stdio. For HTTP-based connections (e.g., hosting the web UI separately), wrap the server with an SSE or WebSocket transport using the MCP SDK's `SSEServerTransport`:

```typescript
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
```

## Claude Desktop

Add the following to your Claude Desktop configuration file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "meshcue-forge": {
      "command": "node",
      "args": ["/absolute/path/to/meshcue-forge/dist/index.js"],
      "env": {
        "ZOO_CAD_API_KEY": "your-key-here",
        "FORGE_ENCLOSURE_BACKEND": "openscad"
      }
    }
  }
}
```

If installed globally via npm:

```json
{
  "mcpServers": {
    "meshcue-forge": {
      "command": "npx",
      "args": ["@meshcue/forge"]
    }
  }
}
```

After saving, restart Claude Desktop. You should see the MeshCue Forge tools (meshforge-describe, meshforge-build, meshforge-validate, meshforge-iterate) listed in the tools panel.

## Claude Code

Add the MCP server to your Claude Code settings. Run:

```bash
claude mcp add meshcue-forge node /absolute/path/to/meshcue-forge/dist/index.js
```

Or add it to your project-level `.claude/settings.json`:

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

If installed from npm:

```json
{
  "mcpServers": {
    "meshcue-forge": {
      "command": "npx",
      "args": ["@meshcue/forge"]
    }
  }
}
```

Verify the tools are available:

```bash
claude mcp list
```

## Programmatic Use via MCP SDK

Connect to MeshCue Forge from your own application using the MCP SDK:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["/path/to/meshcue-forge/dist/index.js"],
});

const client = new Client({ name: "my-app", version: "1.0.0" }, {});
await client.connect(transport);

// List available tools
const tools = await client.listTools();
console.log(tools);

// Describe a hardware project
const spec = await client.callTool({
  name: "meshforge-describe",
  arguments: {
    description: "ESP32-S3 with OLED display, 2 LEDs, and a button",
  },
});
console.log(spec);

// Build from the MHDL spec
const result = await client.callTool({
  name: "meshforge-build",
  arguments: {
    spec: spec.content[0].text,
  },
});
console.log(result);

// Validate a spec
const validation = await client.callTool({
  name: "meshforge-validate",
  arguments: {
    spec: spec.content[0].text,
  },
});
console.log(validation);
```

## Testing with curl

MCP servers use stdio by default. To test over HTTP, you need to run the server with an SSE transport. If you have an HTTP-wrapped instance running (e.g., on `localhost:3001`), you can test with curl:

```bash
# List available tools
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'

# Describe a hardware project
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "meshforge-describe",
      "arguments": {
        "description": "Arduino Nano with 3 LEDs and a button"
      }
    }
  }'

# Build from an MHDL spec (pass the JSON spec inline)
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "meshforge-build",
      "arguments": {
        "spec": "{\"meta\":{\"schemaVersion\":\"0.1.0\",\"name\":\"Blinky\",\"description\":\"LED blink\",\"version\":\"1.0.0\"},\"board\":{\"mcu\":{\"id\":\"mcu\",\"type\":\"mcu\",\"family\":\"esp32\",\"pins\":[{\"id\":\"gpio2\",\"gpio\":2,\"mode\":\"digital-out\"}]},\"components\":[{\"id\":\"led1\",\"type\":\"led\",\"pins\":[{\"id\":\"anode\",\"mode\":\"digital-in\"}]}],\"connections\":[{\"from\":\"mcu.gpio2\",\"to\":\"led1.anode\"}],\"power\":{\"source\":\"usb\",\"voltageIn\":5,\"maxCurrentMa\":500}},\"firmware\":{\"framework\":\"arduino\",\"entrypoint\":\"main.ino\",\"libraries\":[]},\"enclosure\":{\"type\":\"open-frame\",\"wallThicknessMm\":2,\"cornerRadiusMm\":2,\"cutouts\":[],\"mounts\":\"standoffs\"}}"
      }
    }
  }'

# Validate a spec
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "meshforge-validate",
      "arguments": {
        "spec": "{\"meta\":{\"schemaVersion\":\"0.1.0\",\"name\":\"Test\",\"description\":\"Validation test\",\"version\":\"1.0.0\"},\"board\":{\"mcu\":{\"id\":\"mcu\",\"type\":\"mcu\",\"family\":\"esp32\",\"pins\":[]},\"components\":[],\"connections\":[],\"power\":{\"source\":\"usb\",\"voltageIn\":5,\"maxCurrentMa\":500}},\"firmware\":{\"framework\":\"arduino\",\"entrypoint\":\"main.ino\",\"libraries\":[]},\"enclosure\":{\"type\":\"open-frame\",\"wallThicknessMm\":2,\"cornerRadiusMm\":2,\"cutouts\":[],\"mounts\":\"standoffs\"}}"
      }
    }
  }'
```

## Testing via stdio Directly

You can also pipe JSON-RPC messages directly to the server over stdio:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
```

Note: The server expects newline-delimited JSON-RPC messages on stdin and writes responses to stdout.

## MCP Tools Reference

| Tool | Description | Key Arguments |
|------|-------------|---------------|
| `meshforge-describe` | Natural language to MHDL spec | `description` (string) |
| `meshforge-build` | MHDL spec to build artifacts | `spec` (MHDL JSON string) |
| `meshforge-validate` | Run Design Rule Checks on a spec | `spec` (MHDL JSON string) |
| `meshforge-iterate` | Patch an existing spec and rebuild | `spec` (MHDL JSON), `patch` (string) |
| `meshcue-connect-alert` | Send critical alert to patient + family + nurse | `patientId`, `reading`, `deviceId` |
| `meshcue-connect-send` | Send message to a phone number | `phone`, `message`, `channel`, `language` |
| `meshcue-connect-register` | Register patient with contacts and consent | `phone`, `name`, `language`, `emergencyContacts` |
| `meshcue-connect-inbox` | Retrieve incoming messages | `since` (ISO timestamp), `status` |

---

## MeshCue Connect — Patient Communication

MeshCue Connect adds SMS, USSD, WhatsApp, and Voice/IVR communication to the Forge pipeline. Alerts flow from device readings through the mesh network to patients, families, and clinicians.

### Setting Up Africa's Talking Sandbox

1. Create a free account at [africastalking.com](https://africastalking.com).
2. Navigate to the Sandbox environment (toggle in the top-right corner of the dashboard).
3. Generate an API key under **Settings > API Key**.
4. Note your sandbox username — it is always `sandbox`.
5. Set environment variables:

```bash
export MESHCUE_AT_API_KEY="your-sandbox-api-key"
export MESHCUE_AT_USERNAME="sandbox"
export MESHCUE_AT_SHORTCODE="5555"
```

6. Register test phone numbers in the sandbox simulator at [simulator.africastalking.com](https://simulator.africastalking.com).

### Example MCP Tool Calls

**Send a critical alert (device reading triggers SMS to patient + family + nurse):**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "meshcue-connect-alert",
    "arguments": {
      "patientId": "patient-001",
      "reading": {
        "type": "spo2",
        "value": 88,
        "unit": "%",
        "severity": "critical",
        "deviceId": "oximeter-node-12"
      }
    }
  }
}
```

Response: alert sent to patient via SMS, family contacts via SMS, and assigned nurse via SMS + WhatsApp.

**Send a direct message:**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "meshcue-connect-send",
    "arguments": {
      "phone": "+250781234567",
      "message": "Your appointment is confirmed for Monday 10am at Kigali Health Center.",
      "channel": "sms",
      "language": "en"
    }
  }
}
```

**Register a patient:**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "meshcue-connect-register",
    "arguments": {
      "phone": "+250781234567",
      "name": "Marie Uwimana",
      "language": "rw",
      "emergencyContacts": [
        { "phone": "+250789876543", "relation": "mother", "name": "Jeanne" }
      ],
      "consent": true
    }
  }
}
```

**Retrieve incoming messages:**

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "meshcue-connect-inbox",
    "arguments": {
      "since": "2026-03-25T00:00:00Z",
      "status": "unread"
    }
  }
}
```

### Example USSD Flow

When a patient dials the USSD shortcode (e.g., `*384*5555#`), they see:

```
Welcome to MeshCue Health
1. Report symptoms
2. Request appointment
3. Check results
4. Update language
5. Opt out
```

Selecting **1. Report symptoms** prompts:

```
Describe your symptoms:
(Type keywords: FEVER, COUGH, PAIN, DIZZY, BLEEDING)
```

The patient types `FEVER COUGH`. The smart triage engine:

1. Detects `FEVER` as a priority keyword.
2. Assigns urgency level `high`.
3. Routes the message to the assigned nurse via SMS.
4. Sends confirmation to the patient: "Your symptoms have been reported. A nurse will contact you within 2 hours."
5. If the patient's language is Kinyarwanda, all messages are sent in Kinyarwanda.

### Webhook Setup for Incoming Messages

MeshCue Connect receives incoming SMS, USSD sessions, and delivery reports via webhooks.

**Africa's Talking webhook configuration:**

1. In the Africa's Talking dashboard, go to **SMS > Callback URLs**.
2. Set the **Incoming Messages** callback to:
   ```
   https://your-server.com/webhooks/africastalking/sms/incoming
   ```
3. Set the **Delivery Reports** callback to:
   ```
   https://your-server.com/webhooks/africastalking/sms/delivery
   ```
4. For USSD, go to **USSD > Callback URL** and set:
   ```
   https://your-server.com/webhooks/africastalking/ussd
   ```

**WhatsApp webhook configuration:**

1. In the Meta Business dashboard, configure the webhook URL:
   ```
   https://your-server.com/webhooks/whatsapp/incoming
   ```
2. Set the verify token to match your `MESHCUE_WA_VERIFY_TOKEN` environment variable.
3. Subscribe to `messages` webhook events.

**Webhook payload format (incoming SMS):**

```json
{
  "from": "+250781234567",
  "to": "5555",
  "text": "FEVER COUGH",
  "date": "2026-03-26T14:30:00Z",
  "id": "ATXid_abc123"
}
```

MeshCue Connect processes the incoming message through the triage engine, matches the phone number to a registered patient, applies language preferences, and routes accordingly.
