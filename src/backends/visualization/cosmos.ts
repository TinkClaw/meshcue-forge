/**
 * NVIDIA Cosmos Transfer 2.5 Video Backend
 *
 * Generates a product showcase video from an MHDL document,
 * optionally using a Hunyuan3D model artifact as input geometry.
 */

import type { MHDLDocument, BuildArtifact, ForgeConfig } from "../../schema/mhdl.js";

// ─── Prompt Builder ─────────────────────────────────────────

function buildScenePrompt(doc: MHDLDocument): string {
  const parts: string[] = [];

  parts.push(
    `A product showcase video of "${doc.meta.name}": ${doc.meta.description}.`
  );

  // Physical description
  const dims = doc.board.dimensions;
  if (dims) {
    parts.push(
      `The device is ${dims.widthMm}mm x ${dims.heightMm}mm` +
        (dims.depthMm ? ` x ${dims.depthMm}mm` : "") +
        "."
    );
  }

  const enc = doc.enclosure;
  const material = enc.material?.toUpperCase() || "PLA";
  parts.push(`It has a ${enc.type} ${material} enclosure with smooth rounded edges.`);

  // Scene setup
  parts.push(
    "The product sits on a clean, matte white surface and rotates slowly 360 degrees."
  );
  parts.push(
    "Studio lighting with soft shadows, neutral background."
  );

  // Style
  if (doc.visualization?.style) {
    parts.push(`Visual style: ${doc.visualization.style}.`);
  }

  // Background override
  if (doc.visualization?.background) {
    parts.push(`Background: ${doc.visualization.background}.`);
  }

  return parts.join(" ");
}

// ─── Main Generator ─────────────────────────────────────────

export async function generateCosmosVideo(
  doc: MHDLDocument,
  config: ForgeConfig,
  modelArtifact?: BuildArtifact
): Promise<BuildArtifact[]> {
  if (!config.cosmosEndpoint) {
    return [
      {
        stage: "visualization",
        filename: "product-video.mp4",
        content: "Error: COSMOS_ENDPOINT is not configured. Set the COSMOS_ENDPOINT environment variable.",
        format: "error",
        contentType: "text",
        backend: "cosmos",
      },
    ];
  }

  const prompt = buildScenePrompt(doc);

  // Build request body
  const body: Record<string, unknown> = {
    prompt,
    num_frames: 81,
    fps: 24,
    resolution: "720p",
  };

  // If a Hunyuan3D model artifact is available, pass it as input geometry
  if (modelArtifact && modelArtifact.contentType === "base64") {
    body.input_image = modelArtifact.content;
  }

  try {
    const response = await fetch(config.cosmosEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return [
        {
          stage: "visualization",
          filename: "product-video.mp4",
          content: `Error: Cosmos API returned HTTP ${response.status} — ${errorText}`,
          format: "error",
          contentType: "text",
          backend: "cosmos",
        },
      ];
    }

    const result = await response.json() as Record<string, unknown>;

    // Response contains base64-encoded video data
    if (typeof result.video === "string" || typeof result.data === "string" || typeof result.output === "string") {
      const base64Data = (result.video ?? result.data ?? result.output) as string;
      return [
        {
          stage: "visualization",
          filename: "product-video.mp4",
          content: base64Data,
          format: "mp4",
          contentType: "base64",
          mimeType: "video/mp4",
          backend: "cosmos",
        },
      ];
    }

    // Response contains a URL to the generated video
    if (typeof result.url === "string" || typeof result.video_url === "string") {
      const url = (result.url ?? result.video_url) as string;
      return [
        {
          stage: "visualization",
          filename: "product-video.mp4",
          content: url,
          format: "mp4",
          contentType: "url",
          mimeType: "video/mp4",
          backend: "cosmos",
        },
      ];
    }

    // Unexpected response shape
    return [
      {
        stage: "visualization",
        filename: "product-video.mp4",
        content: `Error: Unexpected Cosmos response format — ${JSON.stringify(result).slice(0, 500)}`,
        format: "error",
        contentType: "text",
        backend: "cosmos",
      },
    ];
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return [
      {
        stage: "visualization",
        filename: "product-video.mp4",
        content: `Error: Failed to call Cosmos endpoint — ${message}`,
        format: "error",
        contentType: "text",
        backend: "cosmos",
      },
    ];
  }
}
