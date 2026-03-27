/**
 * KiCad 9 PCB Backend
 *
 * Converts MHDL board spec into a KiCad PCB file (.kicad_pcb),
 * runs DRC checks and autorouting via kicad-cli, and exports
 * Gerber files for manufacturing. Falls back gracefully when
 * kicad-cli is not available on the system.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, isAbsolute, basename } from "node:path";
import { writeFile, readFile, mkdir, readdir, access } from "node:fs/promises";

import type {
  MHDLDocument,
  BuildArtifact,
  ForgeConfig,
  PCBConfig,
} from "../../schema/mhdl.js";
import { generateSKiDLScript } from "./skidl.js";
import { runPython } from "../../python/bridge.js";

const execFileAsync = promisify(execFile);

// ─── Helpers ────────────────────────────────────────────────

/** Sanitize an MHDL id into a safe filename fragment. */
function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Build a temporary working directory for the KiCad pipeline. */
async function makeTempDir(projectName: string): Promise<string> {
  const dir = join(tmpdir(), `meshforge-kicad-${safeId(projectName)}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// ─── KiCad PCB Template Generation ──────────────────────────

interface LayerDef {
  index: number;
  name: string;
  type: string;
}

function buildLayerStack(layerCount: 2 | 4): LayerDef[] {
  const layers: LayerDef[] = [
    { index: 0, name: "F.Cu", type: "signal" },
    { index: 31, name: "B.Cu", type: "signal" },
    { index: 32, name: "B.Adhes", type: "user" },
    { index: 33, name: "F.Adhes", type: "user" },
    { index: 34, name: "B.Paste", type: "user" },
    { index: 35, name: "F.Paste", type: "user" },
    { index: 36, name: "B.SilkS", type: "user" },
    { index: 37, name: "F.SilkS", type: "user" },
    { index: 38, name: "B.Mask", type: "user" },
    { index: 39, name: "F.Mask", type: "user" },
    { index: 44, name: "Edge.Cuts", type: "user" },
    { index: 45, name: "Margin", type: "user" },
    { index: 46, name: "B.CrtYd", type: "user" },
    { index: 47, name: "F.CrtYd", type: "user" },
    { index: 48, name: "B.Fab", type: "user" },
    { index: 49, name: "F.Fab", type: "user" },
  ];

  if (layerCount === 4) {
    layers.splice(1, 0,
      { index: 1, name: "In1.Cu", type: "signal" },
      { index: 2, name: "In2.Cu", type: "signal" },
    );
  }

  return layers;
}

function generateLayerSection(layers: LayerDef[]): string {
  const entries = layers.map(l => `    (${l.index} "${l.name}" ${l.type})`);
  return `  (layers\n${entries.join("\n")}\n  )`;
}

interface DesignRules {
  clearanceMm: number;
  traceWidthMm: number;
  viaDiameterMm: number;
  viaDrillMm: number;
  powerTraceWidthMm: number;
  powerClearanceMm: number;
}

function defaultDesignRules(): DesignRules {
  return {
    clearanceMm: 0.2,
    traceWidthMm: 0.25,
    viaDiameterMm: 0.8,
    viaDrillMm: 0.4,
    powerTraceWidthMm: 0.5,
    powerClearanceMm: 0.3,
  };
}

function generateSetupSection(rules: DesignRules, gridMm: number): string {
  return `  (setup
    (pad_to_mask_clearance 0.05)
    (grid_origin 0 0)
    (pcbplotparams
      (layerselection 0x010fc_ffffffff)
      (plot_on_all_layers_selection 0x0000000_00000000)
      (disableapertmacros false)
      (usegerberextensions true)
      (usegerberattributes true)
      (usegerberadvancedattributes true)
      (creategerberjobfile true)
      (excludeedgelayer true)
      (linewidth 0.1)
      (plotframeref false)
      (viasonmask false)
      (mode 1)
      (useauxorigin false)
      (hpglpennumber 1)
      (hpglpenspeed 20)
      (hpglpendiameter 15.000000)
      (pdf_front_fp_property_popups true)
      (pdf_back_fp_property_popups true)
      (dxfpolygonmode true)
      (dxfimperialunits true)
      (dxfusepcbnewfont true)
      (psnegative false)
      (psa4output false)
      (plotreference true)
      (plotvalue true)
      (plotfptext true)
      (plotinvisibletext false)
      (sketchpadsonfab false)
      (subtractmaskfromsilk true)
      (outputformat 1)
      (mirror false)
      (drillshape 1)
      (scaleselection 1)
      (outputdirectory "gerbers/")
    )
  )`;
}

function generateNetClassSection(rules: DesignRules): string {
  return `  (net_class "Default" ""
    (clearance ${rules.clearanceMm})
    (trace_width ${rules.traceWidthMm})
    (via_dia ${rules.viaDiameterMm})
    (via_drill ${rules.viaDrillMm})
    (uvia_dia 0.3)
    (uvia_drill 0.1)
  )
  (net_class "Power" ""
    (clearance ${rules.powerClearanceMm})
    (trace_width ${rules.powerTraceWidthMm})
    (via_dia 1.0)
    (via_drill 0.5)
    (uvia_dia 0.3)
    (uvia_drill 0.1)
  )`;
}

function generateBoardOutline(widthMm: number, heightMm: number): string {
  const x0 = 0;
  const y0 = 0;
  const x1 = widthMm;
  const y1 = heightMm;

  return `  (gr_rect (start ${x0} ${y0}) (end ${x1} ${y1})
    (stroke (width 0.05) (type default))
    (fill none)
    (layer "Edge.Cuts")
  )`;
}

/**
 * Generate a complete .kicad_pcb file template.
 *
 * This creates a valid KiCad 9 PCB file with board outline,
 * layer setup, and design rules. Actual component placement
 * and routing is handled by kicad-cli or freerouting.
 */
function generateKiCadPCBContent(doc: MHDLDocument): string {
  const pcb: PCBConfig = doc.pcb ?? {};
  const layerCount = pcb.layers ?? 2;
  const widthMm = pcb.widthMm ?? doc.board.dimensions?.widthMm ?? 50;
  const heightMm = pcb.heightMm ?? doc.board.dimensions?.heightMm ?? 50;
  const rules = defaultDesignRules();
  const gridMm = 1.27; // Standard 50mil grid
  const layers = buildLayerStack(layerCount);

  const sections: string[] = [];

  sections.push(`(kicad_pcb (version 20231014) (generator "meshforge") (generator_version "1.0")`);
  sections.push(`  (general`);
  sections.push(`    (thickness 1.6)`);
  sections.push(`    (legacy_teardrops no)`);
  sections.push(`  )`);
  sections.push(``);
  sections.push(generateLayerSection(layers));
  sections.push(``);
  sections.push(generateSetupSection(rules, gridMm));
  sections.push(``);

  // Net declarations
  sections.push(`  (net 0 "")`);
  sections.push(`  (net 1 "VCC")`);
  sections.push(`  (net 2 "GND")`);

  // Add signal nets from connections
  let netIdx = 3;
  for (const conn of doc.board.connections) {
    const netName = conn.net || `N${String(netIdx - 3).padStart(3, "0")}`;
    sections.push(`  (net ${netIdx} "${netName}")`);
    netIdx++;
  }
  sections.push(``);

  // Net classes
  sections.push(generateNetClassSection(rules));
  sections.push(``);

  // Board outline on Edge.Cuts layer
  sections.push(generateBoardOutline(widthMm, heightMm));
  sections.push(``);

  // Mounting holes if defined
  if (doc.board.mountingHoles) {
    const holeDia = doc.board.mountingHoles.diameterMm;
    for (const pos of doc.board.mountingHoles.positions) {
      sections.push(`  (footprint "MountingHole:MountingHole_${holeDia}mm_M${holeDia}" (layer "F.Cu")`);
      sections.push(`    (at ${pos.x} ${pos.y})`);
      sections.push(`    (pad "" thru_hole circle (at 0 0) (size ${holeDia + 1} ${holeDia + 1}) (drill ${holeDia}) (layers "*.Cu" "*.Mask"))`);
      sections.push(`  )`);
    }
    sections.push(``);
  }

  sections.push(`)`);

  return sections.join("\n");
}

// ─── KiCad Path Validation ───────────────────────────────────

/** Shell metacharacters that must not appear in executable paths. */
const SHELL_META = /[;|&$`\\!(){}<>'"*?#~\n\r]/;

/** Path traversal sequences. */
const PATH_TRAVERSAL = /(?:^|\/)\.\.(?:\/|$)/;

/**
 * Validate a KiCad CLI path before execution.
 *
 * Ensures the path:
 *   - Contains no shell metacharacters
 *   - Does not use path traversal (../)
 *   - Is either an absolute path (that exists on disk) or a simple command name
 */
async function validateKicadPath(kicadPath: string): Promise<void> {
  if (SHELL_META.test(kicadPath)) {
    throw new Error(
      `Invalid KiCad path: contains shell metacharacters — "${kicadPath}"`,
    );
  }

  if (PATH_TRAVERSAL.test(kicadPath)) {
    throw new Error(
      `Invalid KiCad path: contains path traversal — "${kicadPath}"`,
    );
  }

  if (isAbsolute(kicadPath)) {
    // Absolute path — verify the directory exists on disk
    try {
      await access(kicadPath);
    } catch {
      throw new Error(
        `Invalid KiCad path: directory does not exist — "${kicadPath}"`,
      );
    }
  } else {
    // Must be a simple directory or command name (no slashes except trailing)
    const cleaned = kicadPath.replace(/\/+$/, "");
    if (cleaned !== basename(cleaned)) {
      throw new Error(
        `Invalid KiCad path: relative paths with directories are not allowed — "${kicadPath}". Use an absolute path or a simple command name.`,
      );
    }
  }
}

// ─── KiCad CLI Wrappers ─────────────────────────────────────

async function runKiCadCli(
  kicadPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  await validateKicadPath(kicadPath);
  const cliPath = join(kicadPath, "kicad-cli");
  try {
    const { stdout, stderr } = await execFileAsync(cliPath, args, {
      timeout: 120_000,
    });
    return { stdout, stderr };
  } catch (err: unknown) {
    const error = err as Error & { stdout?: string; stderr?: string };
    throw new Error(
      `kicad-cli failed: ${error.message}\nstdout: ${error.stdout ?? ""}\nstderr: ${error.stderr ?? ""}`,
    );
  }
}

async function runDRC(
  kicadPath: string,
  pcbFilePath: string,
  outputPath: string,
): Promise<string> {
  const { stdout, stderr } = await runKiCadCli(kicadPath, [
    "pcb", "drc",
    "--output", outputPath,
    "--format", "json",
    "--severity-all",
    pcbFilePath,
  ]);
  return stdout + stderr;
}

async function runAutoRoute(
  kicadPath: string,
  pcbFilePath: string,
): Promise<string> {
  // KiCad 9 introduced `kicad-cli pcb autoroute` as an experimental feature.
  // Fall back to freerouting if the command is not available.
  try {
    const { stdout, stderr } = await runKiCadCli(kicadPath, [
      "pcb", "autoroute",
      pcbFilePath,
    ]);
    return stdout + stderr;
  } catch {
    // Attempt freerouting as a fallback
    try {
      const { stdout, stderr } = await execFileAsync("freerouting", [
        "-de", pcbFilePath,
      ], { timeout: 300_000 });
      return `[freerouting fallback] ${stdout}${stderr}`;
    } catch (frErr: unknown) {
      const error = frErr as Error;
      return `Autorouting unavailable: kicad-cli pcb autoroute failed and freerouting not found. ${error.message}`;
    }
  }
}

async function exportGerbers(
  kicadPath: string,
  pcbFilePath: string,
  outputDir: string,
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const { stdout, stderr } = await runKiCadCli(kicadPath, [
    "pcb", "export", "gerbers",
    "--output", outputDir + "/",
    pcbFilePath,
  ]);
  return stdout + stderr;
}

// ─── Main Export ────────────────────────────────────────────

/**
 * Generate KiCad PCB artifacts from an MHDL document.
 *
 * Pipeline:
 *   1. Generate SKiDL Python script (netlist)
 *   2. Run SKiDL via Python bridge to produce circuit.net
 *   3. Generate .kicad_pcb template with board outline + design rules
 *   4. If kicad-cli is available: run DRC, autoroute, and Gerber export
 *   5. Return all artifacts
 */
export async function generateKiCadPCB(
  doc: MHDLDocument,
  config: ForgeConfig,
): Promise<BuildArtifact[]> {
  const artifacts: BuildArtifact[] = [];
  const projectName = safeId(doc.meta.name);
  const notes: string[] = [];

  // ── Step 1: Generate SKiDL netlist script ──
  const skidlArtifacts = generateSKiDLScript(doc);
  const scriptArtifact = skidlArtifacts.find(a => a.filename === "circuit.py");

  if (!scriptArtifact) {
    throw new Error("SKiDL backend did not produce circuit.py");
  }

  artifacts.push(...skidlArtifacts);

  // ── Step 2: Run SKiDL to produce the netlist ──
  let netlistContent: string | undefined;

  try {
    const workDir = await makeTempDir(projectName);
    const scriptPath = join(workDir, "circuit.py");
    await writeFile(scriptPath, scriptArtifact.content, "utf-8");

    const result = await runPython(
      scriptArtifact.content,
      config.pythonPath,
    );

    if (result.exitCode === 0) {
      // SKiDL writes circuit.net in the current directory; try to read it
      try {
        netlistContent = await readFile(join(workDir, "circuit.net"), "utf-8");
      } catch {
        // SKiDL may write to cwd instead of workDir
        notes.push("SKiDL executed successfully but circuit.net was not found in the work directory. The netlist may have been written to the current working directory.");
      }

      if (netlistContent) {
        artifacts.push({
          stage: "pcb",
          filename: "circuit.net",
          content: netlistContent,
          format: "kicad-netlist",
          backend: "kicad",
        });
      }
    } else {
      notes.push(
        `SKiDL execution failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500)}. ` +
        `Continuing with PCB template generation.`,
      );
    }
  } catch (err: unknown) {
    const error = err as Error;
    notes.push(
      `Python bridge error: ${error.message}. ` +
      `SKiDL/Python may not be installed. Continuing with PCB template generation.`,
    );
  }

  // ── Step 3: Generate .kicad_pcb template ──
  const pcbContent = generateKiCadPCBContent(doc);
  const pcbFilename = `${projectName}.kicad_pcb`;

  artifacts.push({
    stage: "pcb",
    filename: pcbFilename,
    content: pcbContent,
    format: "kicad-pcb",
    backend: "kicad",
  });

  // ── Steps 4-7: KiCad CLI operations (require kicadPath) ──
  if (config.kicadPath) {
    const workDir = await makeTempDir(projectName + "-cli");
    const pcbFilePath = join(workDir, pcbFilename);
    await writeFile(pcbFilePath, pcbContent, "utf-8");

    // ── Step 5: DRC check ──
    try {
      const drcOutputPath = join(workDir, "drc-report.json");
      await runDRC(config.kicadPath, pcbFilePath, drcOutputPath);

      let drcContent: string;
      try {
        drcContent = await readFile(drcOutputPath, "utf-8");
      } catch {
        drcContent = JSON.stringify({ note: "DRC ran but report file was not produced." });
      }

      artifacts.push({
        stage: "pcb",
        filename: "drc-report.json",
        content: drcContent,
        format: "json",
        backend: "kicad",
      });
    } catch (err: unknown) {
      const error = err as Error;
      notes.push(`DRC check failed: ${error.message}`);
    }

    // ── Step 6: Autorouting ──
    if (doc.pcb?.autoRoute) {
      try {
        const routeLog = await runAutoRoute(config.kicadPath, pcbFilePath);

        // Re-read the PCB file after autorouting (it modifies in place)
        try {
          const routedPcb = await readFile(pcbFilePath, "utf-8");
          // Replace the template artifact with the routed version
          const pcbIdx = artifacts.findIndex(
            a => a.filename === pcbFilename && a.backend === "kicad" && a.format === "kicad-pcb",
          );
          if (pcbIdx !== -1) {
            artifacts[pcbIdx] = {
              stage: "pcb",
              filename: pcbFilename,
              content: routedPcb,
              format: "kicad-pcb",
              backend: "kicad",
            };
          }
        } catch {
          // PCB file unchanged, keep the template
        }

        artifacts.push({
          stage: "pcb",
          filename: "autoroute.log",
          content: routeLog,
          format: "text",
          backend: "kicad",
        });
      } catch (err: unknown) {
        const error = err as Error;
        notes.push(`Autorouting failed: ${error.message}`);
      }
    }

    // ── Step 7: Gerber export ──
    try {
      const gerberDir = join(workDir, "gerbers");
      await exportGerbers(config.kicadPath, pcbFilePath, gerberDir);

      // Read all generated Gerber files
      let gerberFiles: string[];
      try {
        gerberFiles = await readdir(gerberDir);
      } catch {
        gerberFiles = [];
      }

      for (const gf of gerberFiles) {
        const gerberContent = await readFile(join(gerberDir, gf), "utf-8");
        artifacts.push({
          stage: "pcb",
          filename: `gerbers/${gf}`,
          content: gerberContent,
          format: "gerber",
          backend: "kicad",
        });
      }

      if (gerberFiles.length === 0) {
        notes.push("Gerber export ran but produced no files.");
      }
    } catch (err: unknown) {
      const error = err as Error;
      notes.push(`Gerber export failed: ${error.message}`);
    }
  } else {
    // No kicad-cli available
    notes.push(
      "KiCad CLI (kicad-cli) is not configured. Set KICAD_PATH to enable " +
      "DRC checks, autorouting, and Gerber export. The .kicad_pcb template " +
      "has been generated and can be opened manually in KiCad 9.",
    );
  }

  // ── Attach notes to the build ──
  if (notes.length > 0) {
    artifacts.push({
      stage: "pcb",
      filename: "kicad-backend.log",
      content: notes.join("\n\n"),
      format: "text",
      backend: "kicad",
    });
  }

  return artifacts;
}
