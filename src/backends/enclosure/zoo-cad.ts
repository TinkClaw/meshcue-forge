/**
 * Zoo Text-to-CAD Enclosure Backend
 *
 * Converts MHDL enclosure spec into a natural language prompt,
 * sends it to the Zoo Text-to-CAD API, and returns a STEP file artifact.
 */

import type { MHDLDocument, BuildArtifact, ForgeConfig } from "../../schema/mhdl.js";
import { fetchWithRetry, classifyHttpError } from "../../utils/fetch-retry.js";

// ─── Prompt Builder ────────────────────────────────────────

function buildEnclosurePrompt(doc: MHDLDocument): string {
  const enc = doc.enclosure;
  const board = doc.board;

  const boardW = board.dimensions?.widthMm || 60;
  const boardH = board.dimensions?.heightMm || 40;
  const boardD = board.dimensions?.depthMm || 20;

  const caseW = boardW + enc.wallThicknessMm * 2;
  const caseH = boardH + enc.wallThicknessMm * 2;
  const caseD = boardD + enc.wallThicknessMm * 2;

  const parts: string[] = [];

  parts.push(
    `Design a ${enc.type} electronics enclosure for the "${doc.meta.name}" project.`
  );
  parts.push(
    `Outer dimensions: ${caseW}mm wide x ${caseH}mm deep x ${caseD}mm tall.`
  );
  parts.push(
    `Wall thickness: ${enc.wallThicknessMm}mm. Corner radius: ${enc.cornerRadiusMm}mm.`
  );

  if (enc.material) {
    parts.push(`Intended for 3D printing in ${enc.material.toUpperCase()}.`);
  }

  if (enc.printOrientation) {
    parts.push(`Print orientation: ${enc.printOrientation}.`);
  }

  // Cutouts
  if (enc.cutouts.length > 0) {
    const cutoutDescs = enc.cutouts.map((c) => {
      let desc = `${c.type} cutout on the ${c.wall} wall`;
      if (c.size) {
        desc += ` (${c.size.width}mm x ${c.size.height}mm)`;
      } else if (c.diameter) {
        desc += ` (diameter ${c.diameter}mm)`;
      }
      if (c.position) {
        desc += ` at position (${c.position.x}, ${c.position.y}, ${c.position.z})`;
      }
      return desc;
    });
    parts.push(`Cutouts needed: ${cutoutDescs.join("; ")}.`);
  }

  // Mounting
  parts.push(`Mounting style: ${enc.mounts}.`);

  if (board.mountingHoles) {
    const holeCount = board.mountingHoles.positions.length;
    parts.push(
      `Include ${holeCount} mounting holes (${board.mountingHoles.diameterMm}mm diameter) with standoffs.`
    );
  }

  // Ventilation
  if (enc.ventilation) {
    parts.push(`Include ventilation slots on the bottom or sides.`);
  }

  // Label
  if (enc.labelEmboss) {
    parts.push(`Emboss the text "${enc.labelEmboss}" on the front face.`);
  }

  // Closure type specifics
  if (enc.type === "snap-fit") {
    parts.push(`Use snap-fit clips to join the base and lid.`);
  } else if (enc.type === "screw-close") {
    parts.push(`Use screw tabs at the corners to join the base and lid.`);
  }

  parts.push(`The enclosure should split into a base and lid.`);
  parts.push(`Output a precise, manufacturable STEP solid model.`);

  return parts.join(" ");
}

// ─── Zoo API Polling ───────────────────────────────────────

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 90; // 3 minutes max

interface ZooTaskResponse {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed";
  output_format?: string;
  outputs?: Record<string, string>;
  status_info?: string;
  error?: string;
}

async function pollForCompletion(
  taskId: string,
  config: ForgeConfig
): Promise<ZooTaskResponse> {
  const endpoint = config.zooCadEndpoint || "https://api.zoo.dev";

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const res = await fetchWithRetry(
      `${endpoint}/ai/text-to-cad/${taskId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.zooCadApiKey}`,
        },
      },
      { timeoutMs: 30_000, maxRetries: 2, baseDelayMs: 1_000 },
    );

    if (!res.ok) {
      const classified = classifyHttpError(res.status, "Zoo");
      throw new Error(
        classified || `Zoo API poll failed (HTTP ${res.status}): ${await res.text()}`
      );
    }

    const task: ZooTaskResponse = await res.json() as ZooTaskResponse;

    if (task.status === "completed") {
      return task;
    }

    if (task.status === "failed") {
      throw new Error(
        `Zoo Text-to-CAD task failed: ${task.error || task.status_info || "unknown error"}`
      );
    }

    // Still queued or in progress — wait and retry
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Zoo Text-to-CAD task timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`
  );
}

// ─── Main Generator ────────────────────────────────────────

export async function generateZooCadEnclosure(
  doc: MHDLDocument,
  config: ForgeConfig
): Promise<BuildArtifact[]> {
  const endpoint = config.zooCadEndpoint || "https://api.zoo.dev";

  if (!config.zooCadApiKey || typeof config.zooCadApiKey !== "string" || config.zooCadApiKey.trim().length === 0) {
    return [
      {
        stage: "enclosure",
        filename: "enclosure-zoo-cad-error.txt",
        content: "Error: ZOO_CAD_API_KEY is not configured or is empty. Set the environment variable to a valid API key to use the Zoo Text-to-CAD backend.",
        format: "step",
        contentType: "text",
        backend: "zoo-cad",
      },
    ];
  }

  const prompt = buildEnclosurePrompt(doc);

  try {
    // Submit the text-to-CAD request
    const submitRes = await fetchWithRetry(
      `${endpoint}/ai/text-to-cad`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.zooCadApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          output_format: "step",
          prompt,
        }),
      },
      { timeoutMs: 30_000, maxRetries: 2, baseDelayMs: 1_000 },
    );

    if (!submitRes.ok) {
      const classified = classifyHttpError(submitRes.status, "Zoo");
      const errorBody = classified || await submitRes.text();
      return [
        {
          stage: "enclosure",
          filename: "enclosure-zoo-cad-error.txt",
          content: `Error: Zoo API returned HTTP ${submitRes.status}: ${errorBody}`,
          format: "step",
          contentType: "text",
          backend: "zoo-cad",
        },
      ];
    }

    const submitData: ZooTaskResponse = await submitRes.json() as ZooTaskResponse;

    // If the API returned a completed result immediately
    if (submitData.status === "completed" && submitData.outputs) {
      const stepUrl = Object.values(submitData.outputs)[0];
      return [
        {
          stage: "enclosure",
          filename: "enclosure.step",
          content: stepUrl,
          format: "step",
          contentType: "url",
          backend: "zoo-cad",
        },
      ];
    }

    // Otherwise, poll for completion
    const completed = await pollForCompletion(submitData.id, config);

    if (!completed.outputs || Object.keys(completed.outputs).length === 0) {
      return [
        {
          stage: "enclosure",
          filename: "enclosure-zoo-cad-error.txt",
          content: "Error: Zoo API returned no output files.",
          format: "step",
          contentType: "text",
          backend: "zoo-cad",
        },
      ];
    }

    const stepUrl = Object.values(completed.outputs)[0];

    return [
      {
        stage: "enclosure",
        filename: "enclosure.step",
        content: stepUrl,
        format: "step",
        contentType: "url",
        backend: "zoo-cad",
      },
    ];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [
      {
        stage: "enclosure",
        filename: "enclosure-zoo-cad-error.txt",
        content: `Error: ${message}`,
        format: "step",
        contentType: "text",
        backend: "zoo-cad",
      },
    ];
  }
}
