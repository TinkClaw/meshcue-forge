/**
 * CadQuery Enclosure Backend
 *
 * Converts MHDL board + enclosure spec into a parametric CadQuery Python
 * script that generates a 3D-printable STEP/STL enclosure.
 */

import type { MHDLDocument, BuildArtifact, Cutout, IPRating } from "../../schema/mhdl.js";

// ─── Helpers ────────────────────────────────────────────────

/** Escape a string for safe interpolation into a Python triple-quoted string. */
function escapePythonString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"""/g, '\\"\\"\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

// ─── Cutout Dimensions (mm) ─────────────────────────────────

const CUTOUT_SIZES: Record<string, { width: number; height: number }> = {
  "usb-c": { width: 9.5, height: 3.5 },
  "usb-micro": { width: 8, height: 3 },
  "usb-a": { width: 13, height: 6 },
  "dc-jack": { width: 9, height: 11 },
  "led-hole": { width: 5, height: 5 },
  "button-cap": { width: 7, height: 7 },
  "oled-window": { width: 27, height: 15 },
  "lcd-window": { width: 72, height: 25 },
  "antenna-slot": { width: 12, height: 3 },
  "vent": { width: 20, height: 10 },
  "sd-card": { width: 12, height: 2.5 },
  "audio-jack": { width: 6, height: 6 },
  "speaker-grille": { width: 15, height: 15 },
  "mic-hole": { width: 3, height: 3 },
};

// ─── Wall Axis Helpers ──────────────────────────────────────

type WallName = "front" | "back" | "left" | "right" | "top" | "bottom";

/**
 * Compute the centre position and face-selection workplane string
 * for a cutout on a given wall.
 */
function wallFaceSelector(wall: WallName): string {
  switch (wall) {
    case "front":
      return "-Y";
    case "back":
      return "+Y";
    case "left":
      return "-X";
    case "right":
      return "+X";
    case "top":
      return "+Z";
    case "bottom":
      return "-Z";
  }
}

/**
 * Return the CadQuery centre-of-rect coordinates for a cutout on a wall.
 * The two values returned are in the workplane-local (u, v) coordinate
 * system of the face.
 */
function cutoutCentre(
  wall: WallName,
  caseW: number,
  caseH: number,
  caseD: number,
  cutout: Cutout,
): [number, number] {
  const cx = cutout.position?.x;
  const cy = cutout.position?.y;

  // CadQuery workplanes have origin at the face centre, so we compute
  // offsets relative to the box centre.
  switch (wall) {
    case "front":
    case "back":
      return [
        cx !== undefined ? cx - caseW / 2 : 0,
        cy !== undefined ? cy - caseD / 2 : 0,
      ];
    case "left":
    case "right":
      return [
        cx !== undefined ? cx - caseH / 2 : 0,
        cy !== undefined ? cy - caseD / 2 : 0,
      ];
    case "top":
    case "bottom":
      return [
        cx !== undefined ? cx - caseW / 2 : 0,
        cy !== undefined ? cy - caseH / 2 : 0,
      ];
  }
}

// ─── Mount Post Generation ──────────────────────────────────

function generateMountPosts(doc: MHDLDocument, wallT: number): string {
  if (!doc.board.mountingHoles) return "";

  const postH = 5; // standoff height
  const outerR = doc.board.mountingHoles.diameterMm / 2 + 1.5;
  const innerR = doc.board.mountingHoles.diameterMm / 2;

  const lines: string[] = [];
  lines.push(`# ── Mounting posts ──────────────────────────────`);
  lines.push(`mount_posts = cq.Workplane("XY")`);

  for (let i = 0; i < doc.board.mountingHoles.positions.length; i++) {
    const pos = doc.board.mountingHoles.positions[i];
    const px = pos.x + wallT;
    const py = pos.y + wallT;
    if (i === 0) {
      lines.push(
        `mount_posts = (mount_posts` +
        `\n    .moveTo(${px}, ${py})` +
        `\n    .circle(${outerR})` +
        `\n    .extrude(${wallT + postH})` +
        `\n    .faces(">Z")` +
        `\n    .workplane()` +
        `\n    .circle(${innerR})` +
        `\n    .cutBlind(-${postH + 0.1})` +
        `\n)`,
      );
    } else {
      lines.push(
        `mount_posts = (mount_posts` +
        `\n    .faces("<Z")` +
        `\n    .workplane()` +
        `\n    .moveTo(${px}, ${py})` +
        `\n    .circle(${outerR})` +
        `\n    .extrude(${wallT + postH})` +
        `\n    .faces(">Z")` +
        `\n    .workplane()` +
        `\n    .moveTo(${px}, ${py})` +
        `\n    .circle(${innerR})` +
        `\n    .cutBlind(-${postH + 0.1})` +
        `\n)`,
      );
    }
  }

  lines.push(`base = base.union(mount_posts)`);
  return lines.join("\n");
}

// ─── Ventilation Slots ──────────────────────────────────────

function generateVents(caseW: number, caseH: number, wallT: number): string {
  const slotW = 1.5;
  const slotLen = 15;
  const slotCount = Math.floor((caseW - 20) / 4);
  const startX = (caseW - slotCount * 4) / 2;

  const lines: string[] = [];
  lines.push(`# ── Ventilation slots (bottom) ──────────────────`);
  lines.push(`vent_cuts = cq.Workplane("XY")`);

  for (let i = 0; i < slotCount; i++) {
    const xOff = startX + i * 4 + slotW / 2 - caseW / 2;
    const yOff = 0; // centred along Y
    if (i === 0) {
      lines.push(
        `vent_cuts = (vent_cuts` +
        `\n    .moveTo(${xOff}, ${yOff})` +
        `\n    .rect(${slotW}, ${slotLen})` +
        `\n    .extrude(${wallT + 0.2})` +
        `\n)`,
      );
    } else {
      lines.push(
        `vent_cuts = (vent_cuts` +
        `\n    .moveTo(${xOff}, ${yOff})` +
        `\n    .rect(${slotW}, ${slotLen})` +
        `\n    .extrude(${wallT + 0.2})` +
        `\n)`,
      );
    }
  }

  lines.push(`base = base.cut(vent_cuts)`);
  return lines.join("\n");
}

// ─── Label Embossing ────────────────────────────────────────

function generateLabel(text: string, caseW: number, caseD: number, wallT: number): string {
  const safeText = escapePythonString(text);
  return [
    `# ── Embossed label ─────────────────────────────`,
    `label = (cq.Workplane("XZ")`,
    `    .center(${caseW / 2}, ${caseD / 2})`,
    `    .text("${safeText}", 5, 0.6, font="Sans")`,
    `)`,
    `base = base.union(label)`,
  ].join("\n");
}

// ─── IP Rating Helpers ───────────────────────────────────────

const IP_RATING_NUMERIC: Record<IPRating, number> = {
  IP20: 20,
  IP44: 44,
  IP54: 54,
  IP65: 65,
  IP67: 67,
  IP68: 68,
};

function ipRatingRequiresGasket(rating?: IPRating): boolean {
  if (!rating) return false;
  return IP_RATING_NUMERIC[rating] >= 54;
}

// ─── Gasket Groove (CadQuery) ────────────────────────────────

function generateCQGasketGroove(
  caseW: number,
  caseH: number,
  splitZ: number,
  wallT: number,
  grooveDepth: number,
  ipRating: IPRating,
): string {
  const grooveWidth = 1.5;
  const inset = wallT / 2;
  const outerW = caseW - inset * 2;
  const outerH = caseH - inset * 2;
  const innerW = outerW - grooveWidth * 2;
  const innerH = outerH - grooveWidth * 2;

  const lines: string[] = [];
  lines.push(`# ── O-ring groove for ${ipRating} sealing — use 2mm silicone O-ring`);
  lines.push(`gasket_groove = (`);
  lines.push(`    cq.Workplane("XY")`);
  lines.push(`    .transformed(offset=(${caseW / 2}, ${caseH / 2}, ${splitZ - grooveDepth}))`);
  lines.push(`    .rect(${outerW}, ${outerH})`);
  lines.push(`    .rect(${innerW}, ${innerH})`);
  lines.push(`    .extrude(${grooveDepth + 0.1})`);
  lines.push(`)`);
  lines.push(`lid = lid.cut(gasket_groove)`);
  return lines.join("\n");
}

// ─── Cable Gland Holes (CadQuery) ───────────────────────────

function generateCQCableGlandHoles(
  count: number,
  diameterMm: number,
  caseW: number,
  caseH: number,
  caseD: number,
  wallT: number,
): string {
  const spacing = caseW / (count + 1);
  let pgSize = "PG7";
  if (diameterMm > 12) pgSize = "PG11";
  else if (diameterMm > 7) pgSize = "PG9";

  const lines: string[] = [];
  lines.push(`# ── Cable gland mount — use ${pgSize} waterproof gland`);

  for (let i = 0; i < count; i++) {
    const x = spacing * (i + 1) - caseW / 2;
    lines.push(`base = (`);
    lines.push(`    base`);
    lines.push(`    .faces("+Y")`);
    lines.push(`    .workplane()`);
    lines.push(`    .moveTo(${x}, ${caseD / 2 - caseD / 2})`);
    lines.push(`    .hole(${diameterMm}, ${wallT + 0.2})`);
    lines.push(`)`);
  }

  return lines.join("\n");
}

// ─── Sterilization Comments (Python) ────────────────────────

function sterilizationPythonComment(method?: string): string {
  switch (method) {
    case "chemical":
      return "# Sterilization: Compatible with 70% IPA / quaternary ammonium wipes";
    case "uv":
      return "# Sterilization: Ensure UV-C exposure on all surfaces — add UV indicator window";
    case "autoclave":
      return "# Sterilization: WARNING: PLA/PETG will deform. Use PEEK, PP, or Nylon at 134°C";
    default:
      return "";
  }
}

// ─── Main Generator ─────────────────────────────────────────

export function generateCadQueryEnclosure(doc: MHDLDocument): BuildArtifact[] {
  const artifacts: BuildArtifact[] = [];
  const enc = doc.enclosure;
  const wallT = enc.wallThicknessMm;
  const cornerR = enc.cornerRadiusMm;

  // Board dimensions (with defaults)
  const boardW = doc.board.dimensions?.widthMm || 60;
  const boardH = doc.board.dimensions?.heightMm || 40;
  const boardD = doc.board.dimensions?.depthMm || 20;

  // Case outer dimensions
  const caseW = boardW + wallT * 2;
  const caseH = boardH + wallT * 2;
  const caseD = boardD + wallT * 2;

  // Lid split height (70% base, 30% lid)
  const splitZ = caseD * 0.7;

  const lines: string[] = [];

  // ── Header ────────────────────────────────────────
  const safeName = escapePythonString(doc.meta.name);
  const safeDescription = escapePythonString(doc.meta.description);

  // Medical device disclaimer (if applicable)
  if (doc.meta?.medical) {
    lines.push(`# ⚠️ MEDICAL DEVICE: This enclosure design is a prototype starting point.`);
    lines.push(`# Validate IP rating, material biocompatibility, and sterilization compatibility`);
    lines.push(`# before clinical use. See PRINT_GUIDE.md for medical print requirements.`);
    lines.push(``);
  }

  lines.push(`"""`)
  lines.push(`${safeName} — Enclosure`);
  lines.push(`${safeDescription}`);
  lines.push(`Generated by MeshCue Forge v${doc.meta.schemaVersion}`);
  lines.push(``);
  lines.push(`Print settings:`);
  lines.push(`  Material: ${enc.material?.toUpperCase() || "PLA"}`);
  lines.push(`  Layer height: 0.2mm`);
  lines.push(`  Infill: 20%`);
  lines.push(`  Supports: ${enc.type === "snap-fit" ? "minimal" : "none"}`);
  lines.push(`  Orientation: ${enc.printOrientation || "upright"}`);

  // Medical device header additions
  if (doc.meta.medical) {
    lines.push(``);
    lines.push(`MEDICAL DEVICE — ${doc.meta.deviceClass ? "Class " + doc.meta.deviceClass : "Unclassified"}`);
    if (doc.meta.intendedUse) {
      lines.push(`Intended use: ${doc.meta.intendedUse}`);
    }
    if (enc.ipRating) {
      lines.push(`IP Rating: ${enc.ipRating}`);
    }
    if (enc.sterilization && enc.sterilization !== "none") {
      lines.push(`Sterilization: ${enc.sterilization}`);
    }
  }

  lines.push(`"""`);
  lines.push(``);
  lines.push(`import cadquery as cq`);
  lines.push(``);

  // Sterilization compatibility notes
  if (enc.sterilization && enc.sterilization !== "none") {
    const sterComment = sterilizationPythonComment(enc.sterilization);
    if (sterComment) {
      lines.push(sterComment);
      lines.push(``);
    }
  }

  // Biocompatible material warnings
  if (enc.biocompatible && enc.material === "pla") {
    lines.push(`# WARNING: PLA is not biocompatible for patient contact. Use PETG, PP, or medical-grade silicone`);
    lines.push(``);
  }

  // ── Parameters ────────────────────────────────────
  lines.push(`# ── Parameters ─────────────────────────────────`);
  lines.push(`CASE_W = ${caseW}   # outer width (X)`);
  lines.push(`CASE_H = ${caseH}   # outer height (Y)`);
  lines.push(`CASE_D = ${caseD}   # outer depth (Z)`);
  lines.push(`WALL   = ${wallT}`);
  lines.push(`CORNER_R = ${cornerR}`);
  lines.push(`SPLIT_Z  = ${splitZ}   # base/lid split height`);
  lines.push(`TOL      = 0.3       # printer tolerance`);
  lines.push(``);

  // ── Outer shell (rounded box minus inner cavity) ──
  lines.push(`# ── Shell (rounded box with fillet) ────────────`);
  lines.push(`outer = (`);
  lines.push(`    cq.Workplane("XY")`);
  lines.push(`    .box(CASE_W, CASE_H, CASE_D, centered=False)`);
  lines.push(`    .edges("|Z")`);
  lines.push(`    .fillet(CORNER_R)`);
  lines.push(`    .edges("|X")`);
  lines.push(`    .fillet(min(CORNER_R, CASE_D / 2 - 0.1))`);
  lines.push(`)`);
  lines.push(``);
  lines.push(`inner = (`);
  lines.push(`    cq.Workplane("XY")`);
  lines.push(`    .transformed(offset=(${wallT}, ${wallT}, ${wallT}))`);
  lines.push(`    .box(CASE_W - WALL * 2, CASE_H - WALL * 2, CASE_D - WALL * 2, centered=False)`);
  lines.push(`    .edges("|Z")`);
  lines.push(`    .fillet(max(CORNER_R - WALL, 0.1))`);
  lines.push(`    .edges("|X")`);
  lines.push(`    .fillet(max(min(CORNER_R - WALL, (CASE_D - WALL * 2) / 2 - 0.1), 0.1))`);
  lines.push(`)`);
  lines.push(``);
  lines.push(`shell = outer.cut(inner)`);

  // Medical: fillet all external edges for patient safety
  const isMedical = !!doc.meta.medical;
  if (isMedical) {
    lines.push(`# Medical device — fillet all external edges for patient safety`);
    lines.push(`shell = shell.edges().fillet(1.0)`);
  }

  lines.push(``);

  // ── Cutouts ───────────────────────────────────────
  lines.push(`# ── Cutouts ────────────────────────────────────`);
  lines.push(`cutout_body = cq.Workplane("XY")  # accumulator for all cuts`);
  lines.push(`_first_cutout = True`);
  lines.push(``);

  for (const cutout of enc.cutouts) {
    const size = cutout.size || CUTOUT_SIZES[cutout.type] || { width: 10, height: 5 };
    const w = cutout.diameter || size.width;
    const h = cutout.diameter || size.height;
    const face = wallFaceSelector(cutout.wall);
    const [cu, cv] = cutoutCentre(cutout.wall, caseW, caseH, caseD, cutout);
    const wallDepth = wallT + 0.2;

    lines.push(`# ${cutout.type}${cutout.componentRef ? " (" + cutout.componentRef + ")" : ""} — ${cutout.wall} wall`);

    if (
      (cutout.type === "led-hole" || cutout.type === "mic-hole" || cutout.type === "custom-circle")
      && cutout.diameter
    ) {
      // Circular cutout
      lines.push(`shell = (`);
      lines.push(`    shell`);
      lines.push(`    .faces("${face}")`);
      lines.push(`    .workplane()`);
      lines.push(`    .moveTo(${cu}, ${cv})`);
      lines.push(`    .hole(${cutout.diameter}, ${wallDepth})`);
      lines.push(`)`);
    } else if (cutout.type === "speaker-grille") {
      // Speaker grille: array of small holes in a circular pattern
      const grilleDia = w;
      const holeD = 1.5;
      const holeSpacing = 3;
      const gridN = Math.floor(grilleDia / holeSpacing);
      const halfSpan = (gridN - 1) * holeSpacing / 2;
      const rMax = grilleDia / 2;

      lines.push(`shell = (`);
      lines.push(`    shell`);
      lines.push(`    .faces("${face}")`);
      lines.push(`    .workplane()`);

      let first = true;
      for (let gx = 0; gx < gridN; gx++) {
        for (let gy = 0; gy < gridN; gy++) {
          const dx = -halfSpan + gx * holeSpacing + cu;
          const dy = -halfSpan + gy * holeSpacing + cv;
          // Only add holes inside the circular boundary
          const distFromCentre = Math.sqrt(
            Math.pow(dx - cu, 2) + Math.pow(dy - cv, 2),
          );
          if (distFromCentre <= rMax) {
            if (first) {
              lines.push(`    .moveTo(${dx}, ${dy})`);
              lines.push(`    .hole(${holeD}, ${wallDepth})`);
              // After first hole we need to re-select the face
              lines.push(`    .faces("${face}")`);
              lines.push(`    .workplane()`);
              first = false;
            } else {
              lines.push(`    .moveTo(${dx}, ${dy})`);
              lines.push(`    .hole(${holeD}, ${wallDepth})`);
              lines.push(`    .faces("${face}")`);
              lines.push(`    .workplane()`);
            }
          }
        }
      }

      lines.push(`)`);
    } else {
      // Rectangular cutout
      lines.push(`shell = (`);
      lines.push(`    shell`);
      lines.push(`    .faces("${face}")`);
      lines.push(`    .workplane()`);
      lines.push(`    .moveTo(${cu}, ${cv})`);
      lines.push(`    .rect(${w}, ${h})`);
      lines.push(`    .cutBlind(-${wallDepth})`);
      lines.push(`)`);
    }
    lines.push(``);
  }

  // ── Mounting posts ────────────────────────────────
  const mountCode = generateMountPosts(doc, wallT);

  // ── Split into base and lid ───────────────────────
  lines.push(`# ── Split into base and lid ────────────────────`);
  lines.push(`split_box_top = (`);
  lines.push(`    cq.Workplane("XY")`);
  lines.push(`    .transformed(offset=(0, 0, ${splitZ}))`);
  lines.push(`    .box(CASE_W + 1, CASE_H + 1, CASE_D, centered=False)`);
  lines.push(`    .translate((-0.5, -0.5, 0))`);
  lines.push(`)`);
  lines.push(`split_box_bot = (`);
  lines.push(`    cq.Workplane("XY")`);
  lines.push(`    .box(CASE_W + 1, CASE_H + 1, ${splitZ}, centered=False)`);
  lines.push(`    .translate((-0.5, -0.5, 0))`);
  lines.push(`)`);
  lines.push(``);
  lines.push(`base = shell.intersect(split_box_bot)`);
  lines.push(`lid  = shell.intersect(split_box_top)`);
  lines.push(``);

  // ── Mount posts (added to base) ───────────────────
  if (mountCode) {
    lines.push(mountCode);
    lines.push(``);
  }

  // ── Ventilation ───────────────────────────────────
  if (enc.ventilation) {
    lines.push(generateVents(caseW, caseH, wallT));
    lines.push(``);
  }

  // ── Label emboss ──────────────────────────────────
  if (enc.labelEmboss) {
    lines.push(generateLabel(enc.labelEmboss, caseW, caseD, wallT));
    lines.push(``);
  }

  // ── Gasket groove for IP-rated enclosures ─────────
  const hasGasket = ipRatingRequiresGasket(enc.ipRating);
  if (hasGasket && enc.ipRating) {
    const grooveDepth = enc.gasketGrooveMm || 1.2;
    lines.push(generateCQGasketGroove(caseW, caseH, splitZ, wallT, grooveDepth, enc.ipRating));
    lines.push(``);
  }

  // ── Cable gland holes ────────────────────────────
  if (enc.cableGland) {
    lines.push(generateCQCableGlandHoles(
      enc.cableGland.count,
      enc.cableGland.diameterMm,
      caseW, caseH, caseD, wallT,
    ));
    lines.push(``);
  }

  // ── Snap-fit clips ────────────────────────────────
  if (enc.type === "snap-fit") {
    lines.push(`# ── Snap-fit clips ─────────────────────────────`);
    lines.push(`CLIP_W = 8`);
    lines.push(`CLIP_H = 2`);
    lines.push(`CLIP_D = 1.5`);
    lines.push(``);
    // Left clip on base
    lines.push(`clip_left = (`);
    lines.push(`    cq.Workplane("YZ")`);
    lines.push(`    .transformed(offset=(${caseH / 2 - 4}, ${splitZ - 2}, 0))`);
    lines.push(`    .rect(CLIP_W, CLIP_H)`);
    lines.push(`    .extrude(CLIP_D)`);
    lines.push(`)`);
    // Right clip on base
    lines.push(`clip_right = (`);
    lines.push(`    cq.Workplane("YZ")`);
    lines.push(`    .transformed(offset=(${caseH / 2 - 4}, ${splitZ - 2}, ${caseW - 1.5}))`);
    lines.push(`    .rect(CLIP_W, CLIP_H)`);
    lines.push(`    .extrude(CLIP_D)`);
    lines.push(`)`);
    lines.push(`base = base.union(clip_left).union(clip_right)`);
    lines.push(``);
    // Matching slots on lid
    lines.push(`slot_left = (`);
    lines.push(`    cq.Workplane("YZ")`);
    lines.push(`    .transformed(offset=(${caseH / 2 - 4}, ${splitZ - 2}, -TOL))`);
    lines.push(`    .rect(CLIP_W + TOL * 2, CLIP_H + TOL * 2)`);
    lines.push(`    .extrude(CLIP_D + TOL)`);
    lines.push(`)`);
    lines.push(`slot_right = (`);
    lines.push(`    cq.Workplane("YZ")`);
    lines.push(`    .transformed(offset=(${caseH / 2 - 4}, ${splitZ - 2}, ${caseW - 1.5 - 0.3}))`);
    lines.push(`    .rect(CLIP_W + TOL * 2, CLIP_H + TOL * 2)`);
    lines.push(`    .extrude(CLIP_D + TOL)`);
    lines.push(`)`);
    lines.push(`lid = lid.cut(slot_left).cut(slot_right)`);
    lines.push(``);
  }

  // ── Screw bosses ──────────────────────────────────
  if (enc.type === "screw-close") {
    lines.push(`# ── Screw bosses ───────────────────────────────`);
    lines.push(`SCREW_R = 1.5`);
    lines.push(`BOSS_R  = 4`);
    lines.push(``);
    const bossPositions = [
      [4 + 2, 4 + 2],
      [caseW - 4 - 2, 4 + 2],
      [4 + 2, caseH - 4 - 2],
      [caseW - 4 - 2, caseH - 4 - 2],
    ];
    for (const [bx, by] of bossPositions) {
      lines.push(`base = (`);
      lines.push(`    base`);
      lines.push(`    .union(`);
      lines.push(`        cq.Workplane("XY")`);
      lines.push(`        .moveTo(${bx}, ${by})`);
      lines.push(`        .circle(BOSS_R)`);
      lines.push(`        .extrude(CASE_D)`);
      lines.push(`    )`);
      lines.push(`    .faces(">Z")`);
      lines.push(`    .workplane()`);
      lines.push(`    .moveTo(${bx}, ${by})`);
      lines.push(`    .hole(SCREW_R * 2, CASE_D + 0.1)`);
      lines.push(`)`);
    }
    lines.push(``);
  }

  // ── Export ────────────────────────────────────────
  lines.push(`# ── Export ─────────────────────────────────────`);
  lines.push(`cq.exporters.export(base, "enclosure_base.step")`);
  lines.push(`cq.exporters.export(base, "enclosure_base.stl")`);
  lines.push(`cq.exporters.export(lid, "enclosure_lid.step")`);
  lines.push(`cq.exporters.export(lid, "enclosure_lid.stl")`);
  lines.push(``);
  lines.push(`# Combined for preview`);
  lines.push(`combined = base.union(lid.translate((0, 0, 15)))`);
  lines.push(`cq.exporters.export(combined, "enclosure.step")`);
  lines.push(`cq.exporters.export(combined, "enclosure.stl")`);
  lines.push(``);
  lines.push(`print("Enclosure exported: enclosure_base.step/.stl, enclosure_lid.step/.stl, enclosure.step/.stl")`);

  const scriptContent = lines.join("\n");

  // Primary artifact: the runnable CadQuery Python script
  artifacts.push({
    stage: "enclosure",
    filename: "enclosure_cadquery.py",
    content: scriptContent,
    format: "python",
  });

  // Secondary artifact tagged with backend identifier
  artifacts.push({
    stage: "enclosure",
    filename: "enclosure_cadquery.py",
    content: scriptContent,
    format: "python",
    backend: "cadquery",
  });

  return artifacts;
}
