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
