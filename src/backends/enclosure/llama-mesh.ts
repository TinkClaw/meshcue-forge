/**
 * LLaMA-Mesh Enclosure Backend
 *
 * Uses a LLaMA-Mesh inference endpoint to generate 3D mesh geometry
 * (OBJ format) from a natural language enclosure description.
 */

import type { MHDLDocument, BuildArtifact, ForgeConfig } from "../../schema/mhdl.js";

// ─── Prompt Builder ────────────────────────────────────────

function buildMeshPrompt(doc: MHDLDocument): string {
  const enc = doc.enclosure;
  const board = doc.board;

  const boardW = board.dimensions?.widthMm || 60;
  const boardH = board.dimensions?.heightMm || 40;
  const boardD = board.dimensions?.depthMm || 20;

  const caseW = boardW + enc.wallThicknessMm * 2;
  const caseH = boardH + enc.wallThicknessMm * 2;
  const caseD = boardD + enc.wallThicknessMm * 2;

  // If organicShape is set, use it as the primary shape description
  if (enc.organicShape) {
    const parts: string[] = [];
    parts.push(
      `Generate a 3D mesh in OBJ format for: ${enc.organicShape}.`
    );
    parts.push(
      `The shape should fit within a bounding box of ${caseW}mm x ${caseH}mm x ${caseD}mm.`
    );
    parts.push(
      `It is a ${enc.type} electronics enclosure with ${enc.wallThicknessMm}mm wall thickness.`
    );
    parts.push(`The enclosure should be hollow to house a circuit board.`);

    if (enc.cutouts.length > 0) {
      parts.push(
        `Include openings for: ${enc.cutouts.map((c) => `${c.type} on ${c.wall} wall`).join(", ")}.`
      );
    }

    if (board.mountingHoles) {
      parts.push(
        `Include ${board.mountingHoles.positions.length} mounting hole standoffs inside.`
      );
    }

    parts.push(`Output precise vertex (v) and face (f) data only.`);
    return parts.join(" ");
  }

  // Standard prompt for geometric enclosures
  const parts: string[] = [];

  parts.push(
    `Generate a 3D mesh in OBJ format for: a ${enc.type} rectangular electronics enclosure.`
  );
  parts.push(
    `Outer dimensions: ${caseW}mm wide, ${caseH}mm deep, ${caseD}mm tall.`
  );
  parts.push(
    `Wall thickness: ${enc.wallThicknessMm}mm. Corner radius: ${enc.cornerRadiusMm}mm.`
  );
  parts.push(`The enclosure splits into a base (70% height) and a lid (30% height).`);

  // Cutouts
  if (enc.cutouts.length > 0) {
    const cutoutDescs = enc.cutouts.map((c) => {
      let desc = `${c.type} on the ${c.wall} wall`;
      if (c.size) {
        desc += ` (${c.size.width}mm x ${c.size.height}mm)`;
      } else if (c.diameter) {
        desc += ` (diameter ${c.diameter}mm)`;
      }
      if (c.position) {
        desc += ` at (${c.position.x}, ${c.position.y}, ${c.position.z})`;
      }
      return desc;
    });
    parts.push(`Cutout positions: ${cutoutDescs.join("; ")}.`);
  }

  // Mounting holes
  if (board.mountingHoles) {
    const positions = board.mountingHoles.positions
      .map((p) => `(${p.x}, ${p.y})`)
      .join(", ");
    parts.push(
      `Mounting hole standoffs (${board.mountingHoles.diameterMm}mm diameter) at positions: ${positions}.`
    );
  }

  // Ventilation
  if (enc.ventilation) {
    parts.push(`Add ventilation slots on the bottom face.`);
  }

  // Material hint
  if (enc.material) {
    parts.push(`Designed for ${enc.material.toUpperCase()} 3D printing.`);
  }

  parts.push(`Output precise vertex (v) and face (f) data only.`);

  return parts.join(" ");
}

// ─── OBJ Parser ────────────────────────────────────────────

function extractObjContent(raw: string): string {
  const lines = raw.split("\n");
  const objLines: string[] = [];
  let inObjBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect start of OBJ data
    if (
      trimmed.startsWith("v ") ||
      trimmed.startsWith("vn ") ||
      trimmed.startsWith("vt ") ||
      trimmed.startsWith("f ") ||
      trimmed.startsWith("# ") ||
      trimmed.startsWith("o ") ||
      trimmed.startsWith("g ") ||
      trimmed.startsWith("s ") ||
      trimmed.startsWith("mtllib ") ||
      trimmed.startsWith("usemtl ")
    ) {
      inObjBlock = true;
      objLines.push(trimmed);
    } else if (inObjBlock && trimmed === "") {
      // Allow blank lines within the OBJ block
      objLines.push("");
    } else if (inObjBlock) {
      // Non-OBJ line after we started collecting — stop
      break;
    }
  }

  // If line-by-line extraction found nothing, try code fence extraction
  if (objLines.length === 0) {
    const fenceMatch = raw.match(/```(?:obj)?\s*\n([\s\S]*?)```/);
    if (fenceMatch) {
      return fenceMatch[1].trim();
    }
  }

  return objLines.join("\n").trim();
}

// ─── Inference Response ────────────────────────────────────

interface LlamaMeshResponse {
  text?: string;
  output?: string;
  generated_text?: string;
  choices?: { text?: string; message?: { content?: string } }[];
}

function extractTextFromResponse(data: LlamaMeshResponse): string {
  if (data.text) return data.text;
  if (data.output) return data.output;
  if (data.generated_text) return data.generated_text;
  if (data.choices && data.choices.length > 0) {
    const choice = data.choices[0];
    if (choice.text) return choice.text;
    if (choice.message?.content) return choice.message.content;
  }
  // Fall back to stringifying the whole response
  return JSON.stringify(data);
}

// ─── Main Generator ────────────────────────────────────────

export async function generateLlamaMeshEnclosure(
  doc: MHDLDocument,
  config: ForgeConfig
): Promise<BuildArtifact[]> {
  if (!config.llamaMeshEndpoint) {
    return [
      {
        stage: "enclosure",
        filename: "enclosure-llama-mesh-error.txt",
        content:
          "Error: LLAMA_MESH_ENDPOINT is not configured. Set the environment variable to use the LLaMA-Mesh backend.",
        format: "obj",
        contentType: "text",
        backend: "llama-mesh",
      },
    ];
  }

  const prompt = buildMeshPrompt(doc);

  try {
    const res = await fetch(config.llamaMeshEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        max_tokens: 8192,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      return [
        {
          stage: "enclosure",
          filename: "enclosure-llama-mesh-error.txt",
          content: `Error: LLaMA-Mesh endpoint returned HTTP ${res.status}: ${errorBody}`,
          format: "obj",
          contentType: "text",
          backend: "llama-mesh",
        },
      ];
    }

    const data: LlamaMeshResponse = await res.json() as LlamaMeshResponse;
    const rawText = extractTextFromResponse(data);
    const objContent = extractObjContent(rawText);

    if (!objContent || objContent.length === 0) {
      return [
        {
          stage: "enclosure",
          filename: "enclosure-llama-mesh-error.txt",
          content: `Error: LLaMA-Mesh response did not contain valid OBJ data.\n\nRaw response:\n${rawText.slice(0, 2000)}`,
          format: "obj",
          contentType: "text",
          backend: "llama-mesh",
        },
      ];
    }

    // Validate that we got at least some vertices and faces
    const hasVertices = objContent.includes("\nv ") || objContent.startsWith("v ");
    const hasFaces = objContent.includes("\nf ") || objContent.startsWith("f ");

    if (!hasVertices || !hasFaces) {
      return [
        {
          stage: "enclosure",
          filename: "enclosure-llama-mesh-error.txt",
          content: `Error: LLaMA-Mesh output is missing ${!hasVertices ? "vertices" : ""}${!hasVertices && !hasFaces ? " and " : ""}${!hasFaces ? "faces" : ""}.\n\nExtracted content:\n${objContent.slice(0, 2000)}`,
          format: "obj",
          contentType: "text",
          backend: "llama-mesh",
        },
      ];
    }

    // Add a header comment to the OBJ file
    const header = [
      `# ${doc.meta.name} — Enclosure Mesh`,
      `# Generated by MeshCue Forge (LLaMA-Mesh backend)`,
      `# ${doc.meta.description}`,
      `#`,
    ].join("\n");

    return [
      {
        stage: "enclosure",
        filename: "enclosure.obj",
        content: `${header}\n${objContent}`,
        format: "obj",
        contentType: "text",
        backend: "llama-mesh",
      },
    ];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [
      {
        stage: "enclosure",
        filename: "enclosure-llama-mesh-error.txt",
        content: `Error: ${message}`,
        format: "obj",
        contentType: "text",
        backend: "llama-mesh",
      },
    ];
  }
}
