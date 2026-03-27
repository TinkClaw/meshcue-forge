#!/usr/bin/env node

/**
 * MeshCue Forge MCP Server
 *
 * The hardware compiler — describe it, build it, print it.
 *
 * Exposes 4 tools via Model Context Protocol:
 *   1. meshforge-describe  — natural language → MHDL spec
 *   2. meshforge-build     — MHDL → circuit + firmware + enclosure + docs
 *   3. meshforge-validate  — run DRC checks on an MHDL spec
 *   4. meshforge-iterate   — patch an MHDL spec and rebuild
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { describe } from "./tools/describe.js";
import { build, type BuildStage } from "./tools/build.js";
import { validate } from "./schema/validate.js";
import type { MHDLDocument } from "./schema/mhdl.js";

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
        z.enum(["circuit", "firmware", "enclosure", "pcb", "bom", "docs", "all"])
      )
      .default(["all"])
      .describe("Which stages to build. Default: all"),
  },
  async ({ mhdl, stages }) => {
    try {
      const doc: MHDLDocument = JSON.parse(mhdl);
      const result = build(doc, stages as BuildStage[]);

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
                  message:
                    "Build failed — fix validation errors and retry",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      // Return artifacts as structured output
      const output: Record<string, unknown> = {
        success: true,
        buildTime: `${result.buildTime}ms`,
        stats: result.validation.stats,
        warnings: result.validation.issues.filter(
          (i) => i.severity === "warning"
        ),
        artifacts: result.artifacts.map((a) => ({
          stage: a.stage,
          filename: a.filename,
          format: a.format,
          size: `${a.content.length} bytes`,
        })),
      };

      // Include full artifact content
      const files: Record<string, string> = {};
      for (const artifact of result.artifacts) {
        files[artifact.filename] = artifact.content;
      }
      output.files = files;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(output, null, 2),
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
        z.enum(["circuit", "firmware", "enclosure", "pcb", "bom", "docs", "all"])
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
      const result = build(patched, stages as BuildStage[]);

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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MeshCue Forge MCP server running — forge.meshcue.com");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
