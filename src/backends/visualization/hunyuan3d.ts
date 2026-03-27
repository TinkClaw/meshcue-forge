/**
 * Hunyuan3D 2.1 Visualization Backend
 *
 * Converts MHDL document into a text prompt and calls the Hunyuan3D
 * inference endpoint to generate a GLB 3D model of the product.
 */

import type { MHDLDocument, BuildArtifact, ForgeConfig } from "../../schema/mhdl.js";

// ─── Prompt Builder ─────────────────────────────────────────

function buildPrompt(doc: MHDLDocument): string {
  const parts: string[] = [];

  // Product identity
  parts.push(`A 3D model of "${doc.meta.name}": ${doc.meta.description}.`);

  // Dimensions
  const dims = doc.board.dimensions;
  if (dims) {
    parts.push(
      `The device measures ${dims.widthMm}mm wide x ${dims.heightMm}mm tall` +
        (dims.depthMm ? ` x ${dims.depthMm}mm deep` : "") +
        "."
    );
  }

  // Material and enclosure shape
  const enc = doc.enclosure;
  const material = enc.material?.toUpperCase() || "PLA";
  parts.push(
    `Enclosed in a ${enc.type} ${material} case with ${enc.wallThicknessMm}mm walls` +
      ` and ${enc.cornerRadiusMm}mm rounded corners.`
  );

  // Color scheme from label / material hints
  if (enc.labelEmboss) {
    parts.push(`The front face has embossed text reading "${enc.labelEmboss}".`);
  }

  // Visible components
  const visibleDescriptions: string[] = [];
  for (const comp of doc.board.components) {
    switch (comp.type) {
      case "led":
      case "neopixel": {
        const color = comp.properties?.["color"] ?? "white";
        visibleDescriptions.push(`a ${color} LED indicator`);
        break;
      }
      case "oled":
        visibleDescriptions.push(
          `a small OLED display screen (${comp.model || "128x64"})`
        );
        break;
      case "lcd":
        visibleDescriptions.push(
          `an LCD screen (${comp.model || "16x2 character"})`
        );
        break;
      case "button":
        visibleDescriptions.push("a tactile push button");
        break;
      case "speaker":
        visibleDescriptions.push("a speaker grille");
        break;
      case "buzzer":
        visibleDescriptions.push("a small buzzer opening");
        break;
      case "potentiometer":
        visibleDescriptions.push("a rotary knob");
        break;
      default:
        break;
    }
  }

  if (visibleDescriptions.length > 0) {
    parts.push(`Visible external features: ${visibleDescriptions.join(", ")}.`);
  }

  // Cutout hints
  const cutoutTypes = enc.cutouts.map((c) => c.type.replace(/-/g, " "));
  if (cutoutTypes.length > 0) {
    parts.push(`The case has cutouts for: ${cutoutTypes.join(", ")}.`);
  }

  // Style hint
  if (doc.visualization?.style) {
    parts.push(`Render in a ${doc.visualization.style} style.`);
  }

  return parts.join(" ");
}

// ─── Offline OBJ Generator ──────────────────────────────────

function generatePlaceholderOBJ(doc: MHDLDocument): string {
  const dims = doc.board.dimensions;
  const enc = doc.enclosure;
  const wallT = enc.wallThicknessMm;

  // Outer dimensions of the enclosure (board + walls on each side)
  const w = ((dims?.widthMm || 60) + wallT * 2) / 2;
  const h = ((dims?.heightMm || 40) + wallT * 2) / 2;
  const d = ((dims?.depthMm || 20) + wallT * 2) / 2;

  const lines: string[] = [];

  lines.push(`# Placeholder 3D model generated offline by MeshCue Forge`);
  lines.push(`# This is a simple box mesh approximating the enclosure.`);
  lines.push(`# For a detailed AI-generated model, set the HUNYUAN3D_ENDPOINT env var.`);
  lines.push(`#`);
  lines.push(`# Product: ${doc.meta.name}`);
  lines.push(`# Outer dimensions: ${w * 2}mm x ${h * 2}mm x ${d * 2}mm`);
  lines.push(`# Material: ${enc.material?.toUpperCase() || "PLA"}`);
  lines.push(`# Enclosure type: ${enc.type}`);
  lines.push(``);
  lines.push(`o ${doc.meta.name.replace(/\s+/g, "_")}_enclosure`);
  lines.push(``);

  // 8 vertices of a box centered at origin
  lines.push(`# Vertices`);
  lines.push(`v ${-w} ${-h} ${d}`);   // v1: front-bottom-left
  lines.push(`v ${w} ${-h} ${d}`);    // v2: front-bottom-right
  lines.push(`v ${w} ${h} ${d}`);     // v3: front-top-right
  lines.push(`v ${-w} ${h} ${d}`);    // v4: front-top-left
  lines.push(`v ${-w} ${-h} ${-d}`);  // v5: back-bottom-left
  lines.push(`v ${w} ${-h} ${-d}`);   // v6: back-bottom-right
  lines.push(`v ${w} ${h} ${-d}`);    // v7: back-top-right
  lines.push(`v ${-w} ${h} ${-d}`);   // v8: back-top-left
  lines.push(``);

  // Normals for each face
  lines.push(`# Normals`);
  lines.push(`vn 0 0 1`);   // front
  lines.push(`vn 0 0 -1`);  // back
  lines.push(`vn 1 0 0`);   // right
  lines.push(`vn -1 0 0`);  // left
  lines.push(`vn 0 1 0`);   // top
  lines.push(`vn 0 -1 0`);  // bottom
  lines.push(``);

  // 6 faces (quads), each with two triangles for compatibility
  lines.push(`# Faces`);
  lines.push(`# Front`);
  lines.push(`f 1//1 2//1 3//1`);
  lines.push(`f 1//1 3//1 4//1`);
  lines.push(`# Back`);
  lines.push(`f 6//2 5//2 8//2`);
  lines.push(`f 6//2 8//2 7//2`);
  lines.push(`# Right`);
  lines.push(`f 2//3 6//3 7//3`);
  lines.push(`f 2//3 7//3 3//3`);
  lines.push(`# Left`);
  lines.push(`f 5//4 1//4 4//4`);
  lines.push(`f 5//4 4//4 8//4`);
  lines.push(`# Top`);
  lines.push(`f 4//5 3//5 7//5`);
  lines.push(`f 4//5 7//5 8//5`);
  lines.push(`# Bottom`);
  lines.push(`f 5//6 6//6 2//6`);
  lines.push(`f 5//6 2//6 1//6`);

  return lines.join("\n");
}

// ─── Main Generator ─────────────────────────────────────────

export async function generateHunyuan3DModel(
  doc: MHDLDocument,
  config: ForgeConfig
): Promise<BuildArtifact[]> {
  if (!config.hunyuan3dEndpoint) {
    // Offline mode: generate a placeholder OBJ box with correct dimensions
    const obj = generatePlaceholderOBJ(doc);
    return [
      {
        stage: "visualization",
        filename: "model.obj",
        content: obj,
        format: "obj",
        contentType: "text",
        mimeType: "model/obj",
        backend: "hunyuan3d-offline",
      },
    ];
  }

  const prompt = buildPrompt(doc);

  try {
    const response = await fetch(config.hunyuan3dEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: prompt,
        num_steps: 50,
        guidance_scale: 7.5,
        output_format: "glb",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return [
        {
          stage: "visualization",
          filename: "model.glb",
          content: `Error: Hunyuan3D API returned HTTP ${response.status} — ${errorText}`,
          format: "error",
          contentType: "text",
          backend: "hunyuan3d",
        },
      ];
    }

    const result = await response.json() as Record<string, unknown>;

    // Response contains base64-encoded GLB data
    if (typeof result.glb === "string" || typeof result.data === "string" || typeof result.output === "string") {
      const base64Data = (result.glb ?? result.data ?? result.output) as string;
      return [
        {
          stage: "visualization",
          filename: "model.glb",
          content: base64Data,
          format: "glb",
          contentType: "base64",
          mimeType: "model/gltf-binary",
          backend: "hunyuan3d",
        },
      ];
    }

    // Response contains a URL to the generated model
    if (typeof result.url === "string" || typeof result.model_url === "string") {
      const url = (result.url ?? result.model_url) as string;
      return [
        {
          stage: "visualization",
          filename: "model.glb",
          content: url,
          format: "glb",
          contentType: "url",
          mimeType: "model/gltf-binary",
          backend: "hunyuan3d",
        },
      ];
    }

    // Unexpected response shape
    return [
      {
        stage: "visualization",
        filename: "model.glb",
        content: `Error: Unexpected Hunyuan3D response format — ${JSON.stringify(result).slice(0, 500)}`,
        format: "error",
        contentType: "text",
        backend: "hunyuan3d",
      },
    ];
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return [
      {
        stage: "visualization",
        filename: "model.glb",
        content: `Error: Failed to call Hunyuan3D endpoint — ${message}`,
        format: "error",
        contentType: "text",
        backend: "hunyuan3d",
      },
    ];
  }
}
