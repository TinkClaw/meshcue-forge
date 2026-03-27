#!/usr/bin/env node

/**
 * MeshCue Forge + Connect + RAM MCP Server
 *
 * The hardware compiler — describe it, build it, print it.
 * Plus patient messaging — alerts, triage, and multi-channel delivery.
 * Plus resource & asset management — track devices, stock, and supply chains.
 *
 * Forge tools:
 *   1. meshforge-describe  — natural language → MHDL spec
 *   2. meshforge-build     — MHDL → circuit + firmware + enclosure + docs
 *   3. meshforge-validate  — run DRC checks on an MHDL spec
 *   4. meshforge-iterate   — patch an MHDL spec and rebuild
 *   5. meshforge-capabilities — detect available backends
 *
 * Connect tools:
 *   6. meshcue-connect-alert    — process device alert → triage + messages
 *   7. meshcue-connect-send     — send templated message to patient/contact
 *   8. meshcue-connect-register — register patient for Connect messaging
 *   9. meshcue-connect-inbox    — process incoming patient message
 *  10. meshcue-connect-status   — check channel availability and queue
 *
 * RAM tools:
 *  11. meshcue-ram-register-asset — add device/equipment to asset tracking
 *  12. meshcue-ram-update-asset   — update status, location, assignment
 *  13. meshcue-ram-inventory      — list/search assets and stock
 *  14. meshcue-ram-restock        — add stock for consumables/medications
 *  15. meshcue-ram-order          — create/update supply orders
 *  16. meshcue-ram-maintenance    — log maintenance records
 *  17. meshcue-ram-alerts         — low stock, expiring, maintenance due alerts
 *  18. meshcue-ram-dashboard      — clinic resource summary
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createServer } from "node:http";

import { describe } from "./tools/describe.js";
import { build, type BuildStage, type BuildProgress } from "./tools/build.js";
import { validate } from "./schema/validate.js";
import { loadConfig, detectCapabilities } from "./config.js";
import type { MHDLDocument } from "./schema/mhdl.js";
import { registerConnectTools } from "./connect/mcp.js";
import { registerRAMTools } from "./ram/mcp.js";
import { startWebhookServer } from "./connect/webhook.js";

// ─── Server Setup ────────────────────────────────────────────

const server = new McpServer({
  name: "meshcue-forge",
  version: "0.1.0",
});

// ─── Tool: meshforge-describe ────────────────────────────────

server.tool(
  "meshforge-describe",
  "Generate an MHDL hardware spec from a natural language description. " +
    "Describe what you want to build — MCU, components, features — and get " +
    "a complete buildable spec with auto-assigned GPIO pins, connections, " +
    "enclosure cutouts, and firmware config.",
  {
    description: z
      .string()
      .describe(
        "Natural language description of the hardware project. " +
          "Example: 'ESP32-S3 board with OLED display, 3 status LEDs, 2 buttons, and a buzzer for a mesh networking node'"
      ),
  },
  async ({ description: desc }) => {
    try {
      const doc = describe(desc);
      const validation = validate(doc);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                mhdl: doc,
                validation: {
                  valid: validation.valid,
                  issues: validation.issues,
                  stats: validation.stats,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error generating MHDL: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: meshforge-build ───────────────────────────────────

server.tool(
  "meshforge-build",
  "Build all artifacts from an MHDL spec: Wokwi circuit diagram, " +
    "Arduino firmware, OpenSCAD 3D-printable enclosure, BOM, and documentation. " +
    "Runs validation (DRC) before building — fails fast if there are errors.",
  {
    mhdl: z
      .string()
      .describe("The MHDL document as a JSON string"),
    stages: z
      .array(
        z.enum(["circuit", "firmware", "enclosure", "pcb", "bom", "docs", "visualization", "all"])
      )
      .default(["all"])
      .describe("Which stages to build. Default: all"),
  },
  async ({ mhdl, stages }) => {
    try {
      const doc: MHDLDocument = JSON.parse(mhdl);

      // Collect progress events during build
      const progressLog: BuildProgress[] = [];
      const onProgress = (p: BuildProgress) => {
        progressLog.push(p);
        // Stream progress to stderr so MCP clients can display it
        console.error(
          `[forge] ${p.status === "starting" ? "▶" : p.status === "done" ? "✓" : "✗"} ${p.stage}${p.backend ? ` (${p.backend})` : ""}${p.durationMs !== undefined ? ` ${p.durationMs}ms` : ""}${p.error ? ` — ${p.error}` : ""}`
        );
      };

      const result = await build(doc, stages as BuildStage[], undefined, onProgress);

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: false,
                  errors: result.validation.issues.filter(
                    (i) => i.severity === "error"
                  ),
                  failedStages: result.failedStages,
                  message:
                    result.failedStages.length > 0
                      ? `Build failed — ${result.failedStages.length} stage(s) errored: ${result.failedStages.map(f => f.stage).join(", ")}`
                      : "Build failed — fix validation errors and retry",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      // Check if this is a medical device build
      const isMedicalBuild = !!(
        doc.meta?.medical ||
        result.artifacts.some((a) =>
          ["WHO_CHECKLIST.md", "IEC62304_SOFTWARE_LIFECYCLE.md", "FMEA.csv", "CE_GUIDANCE.md", "BATTERY_LIFE_ESTIMATE.md", "FIELD_TEST_CHECKLIST.md"].includes(a.filename)
        )
      );

      // Return artifacts as structured output
      const output: Record<string, unknown> = {
        success: true,
        buildTime: `${result.buildTime}ms`,
        progress: progressLog,
        failedStages: result.failedStages,
        stats: result.validation.stats,
        warnings: result.validation.issues.filter(
          (i) => i.severity === "warning"
        ),
        artifacts: result.artifacts.map((a) => ({
          stage: a.stage,
          filename: a.filename,
          format: a.format,
          size: `${a.content.length} bytes`,
          backend: a.backend,
        })),
      };

      // Include full artifact content
      const files: Record<string, string> = {};
      for (const artifact of result.artifacts) {
        files[artifact.filename] = artifact.content;
      }
      output.files = files;

      // Prepend medical disclaimer to response text if applicable
      const medicalDisclaimer = isMedicalBuild
        ? "⚠️ MEDICAL DEVICE OUTPUT: These artifacts are design aids for prototyping only. Clinical validation, sensor calibration, and regulatory approval are required before patient use.\n\n"
        : "";

      return {
        content: [
          {
            type: "text" as const,
            text: medicalDisclaimer + JSON.stringify(output, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Build error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: meshforge-validate ────────────────────────────────

server.tool(
  "meshforge-validate",
  "Run Design Rule Checks (DRC) on an MHDL spec without building. " +
    "Checks: pin conflicts, I2C address collisions, power budget, " +
    "connection integrity, enclosure fit, and mounting alignment.",
  {
    mhdl: z
      .string()
      .describe("The MHDL document as a JSON string"),
  },
  async ({ mhdl }) => {
    try {
      const doc: MHDLDocument = JSON.parse(mhdl);
      const result = validate(doc);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                valid: result.valid,
                issues: result.issues,
                stats: result.stats,
                summary: result.valid
                  ? `✓ All checks passed (${result.stats.componentCount} components, ${result.stats.connectionCount} connections, ${result.stats.estimatedCurrentMa}mA)`
                  : `✗ ${result.issues.filter((i) => i.severity === "error").length} errors, ${result.issues.filter((i) => i.severity === "warning").length} warnings`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Validation error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: meshforge-iterate ─────────────────────────────────

server.tool(
  "meshforge-iterate",
  "Apply changes to an existing MHDL spec and rebuild. " +
    "Pass the original MHDL and a set of patches (JSON merge patch format). " +
    "The tool applies the patches, re-validates, and rebuilds all artifacts.",
  {
    mhdl: z
      .string()
      .describe("The current MHDL document as a JSON string"),
    patches: z
      .string()
      .describe(
        "JSON merge patch to apply to the MHDL document. " +
          "Example: to change enclosure type, pass: {\"enclosure\": {\"type\": \"screw-close\"}}"
      ),
    stages: z
      .array(
        z.enum(["circuit", "firmware", "enclosure", "pcb", "bom", "docs", "visualization", "all"])
      )
      .default(["all"])
      .describe("Which stages to rebuild after patching"),
  },
  async ({ mhdl, patches, stages }) => {
    try {
      const doc: MHDLDocument = JSON.parse(mhdl);
      const patchObj = JSON.parse(patches);

      // Deep merge patch into document
      const patched = deepMerge(doc, patchObj) as MHDLDocument;

      // Validate
      const validation = validate(patched);
      if (!validation.valid) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: false,
                  message: "Patch applied but validation failed",
                  patchedMhdl: patched,
                  errors: validation.issues.filter(
                    (i) => i.severity === "error"
                  ),
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      // Rebuild
      const result = await build(patched, stages as BuildStage[]);

      const files: Record<string, string> = {};
      for (const artifact of result.artifacts) {
        files[artifact.filename] = artifact.content;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                patchedMhdl: patched,
                buildTime: `${result.buildTime}ms`,
                stats: result.validation.stats,
                artifacts: result.artifacts.map((a) => ({
                  stage: a.stage,
                  filename: a.filename,
                  format: a.format,
                })),
                files,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Iterate error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: meshforge-capabilities ─────────────────────────────

server.tool(
  "meshforge-capabilities",
  "Detect which backends are available based on the current environment. " +
    "Returns per-stage backend availability (enclosure, PCB, visualization) " +
    "with reasons for any unavailable backends.",
  {},
  async () => {
    const config = loadConfig();
    const registry = await detectCapabilities(config);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              backends: registry,
              defaults: {
                enclosure: config.defaultEnclosureBackend || "openscad",
                pcb: config.defaultPCBBackend || "skidl",
                visualization: config.defaultVisualizationBackend || "hunyuan3d",
              },
              gpu: config.enableGpuBackends ?? false,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ─── Connect Tools ───────────────────────────────────────────

registerConnectTools(server);

// ─── RAM Tools ───────────────────────────────────────────────

registerRAMTools(server);

// ─── Utility: Deep Merge ─────────────────────────────────────

function deepMerge(target: unknown, source: unknown): unknown {
  if (
    typeof target !== "object" ||
    target === null ||
    typeof source !== "object" ||
    source === null
  ) {
    return source;
  }

  if (Array.isArray(source)) {
    return source;
  }

  const result: Record<string, unknown> = { ...(target as Record<string, unknown>) };

  for (const key of Object.keys(source as Record<string, unknown>)) {
    const sourceVal = (source as Record<string, unknown>)[key];
    const targetVal = result[key];

    if (sourceVal === null) {
      delete result[key];
    } else if (
      typeof sourceVal === "object" &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === "object" &&
      targetVal !== null
    ) {
      result[key] = deepMerge(targetVal, sourceVal);
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}

// ─── Start Server ────────────────────────────────────────────

// ─── Health Check HTTP Server ───────────────────────────────

const HEALTH_PORT = parseInt(process.env.MESHCUE_HEALTH_PORT || "8080", 10);

const healthServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      service: "meshcue-forge",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    }));
  } else if (req.url === "/ready") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ready: true }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

// ─── Startup Validation ──────────────────────────────────────

function validateEnv(): void {
  const dbPath = process.env.MESHCUE_DB_PATH;
  if (!dbPath) {
    console.warn(
      "[startup] MESHCUE_DB_PATH not set — data will NOT persist across restarts. " +
      "Set MESHCUE_DB_PATH for production use.",
    );
  }
}

// ─── Graceful Shutdown ──────────────────────────────────────

let shuttingDown = false;
const servers: { health?: ReturnType<typeof createServer>; webhook?: ReturnType<typeof createServer> } = {};

function gracefulShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[shutdown] ${signal} received — closing servers...`);

  // Close HTTP servers (stop accepting new connections)
  if (servers.health) servers.health.close();
  if (servers.webhook) servers.webhook.close();

  // Allow in-flight requests 5s to complete
  setTimeout(() => {
    console.error("[shutdown] Complete.");
    process.exit(0);
  }, 5_000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Global unhandled rejection handler — log and exit cleanly
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled Promise Rejection:", reason);
  process.exit(1);
});

// ─── Start Server ────────────────────────────────────────────

async function main() {
  validateEnv();

  // Start health check server (non-blocking, for Docker/k8s probes)
  healthServer.listen(HEALTH_PORT, "0.0.0.0", () => {
    console.error(`[startup] Health endpoint: http://0.0.0.0:${HEALTH_PORT}/health`);
  });
  servers.health = healthServer;

  // Start webhook server for incoming SMS/WhatsApp/USSD callbacks
  const webhookPort = parseInt(process.env.MESHCUE_WEBHOOK_PORT || "8081", 10);
  servers.webhook = startWebhookServer(webhookPort);

  // Start MCP stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[startup] MeshCue Forge + Connect + RAM MCP server running — forge.meshcue.com");
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
