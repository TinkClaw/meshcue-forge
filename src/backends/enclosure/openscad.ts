/**
 * OpenSCAD Enclosure Backend
 *
 * Converts MHDL board + enclosure spec → parametric OpenSCAD file
 * that generates a 3D printable STL enclosure.
 */

import type { MHDLDocument, BuildArtifact, Cutout } from "../../schema/mhdl.js";

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
};

// ─── Wall position offsets ───────────────────────────────────

type WallName = "front" | "back" | "left" | "right" | "top" | "bottom";

function wallTransform(
  wall: WallName,
  caseW: number,
  caseH: number,
  caseD: number,
  wallT: number,
  cutoutW: number,
  cutoutH: number,
  cutout: Cutout
): string {
  const cx = cutout.position?.x;
  const cy = cutout.position?.y;

  switch (wall) {
    case "front":
      return `translate([${cx ?? caseW / 2 - cutoutW / 2}, -0.1, ${cy ?? caseD / 2 - cutoutH / 2}])`;
    case "back":
      return `translate([${cx ?? caseW / 2 - cutoutW / 2}, ${caseH - wallT + 0.1}, ${cy ?? caseD / 2 - cutoutH / 2}])`;
    case "left":
      return `translate([-0.1, ${cx ?? caseH / 2 - cutoutW / 2}, ${cy ?? caseD / 2 - cutoutH / 2}])`;
    case "right":
      return `translate([${caseW - wallT + 0.1}, ${cx ?? caseH / 2 - cutoutW / 2}, ${cy ?? caseD / 2 - cutoutH / 2}])`;
    case "top":
      return `translate([${cx ?? caseW / 2 - cutoutW / 2}, ${cy ?? caseH / 2 - cutoutH / 2}, ${caseD - wallT + 0.1}])`;
    case "bottom":
      return `translate([${cx ?? caseW / 2 - cutoutW / 2}, ${cy ?? caseH / 2 - cutoutH / 2}, -0.1])`;
  }
}

function cutoutDimensions(
  wall: WallName,
  wallT: number,
  cutoutW: number,
  cutoutH: number
): string {
  switch (wall) {
    case "front":
    case "back":
      return `cube([${cutoutW}, ${wallT + 0.2}, ${cutoutH}])`;
    case "left":
    case "right":
      return `cube([${wallT + 0.2}, ${cutoutW}, ${cutoutH}])`;
    case "top":
    case "bottom":
      return `cube([${cutoutW}, ${cutoutH}, ${wallT + 0.2}])`;
  }
}

// ─── Mount Post Generation ───────────────────────────────────

function generateMountPosts(doc: MHDLDocument, wallT: number): string {
  if (!doc.board.mountingHoles) return "";

  const lines: string[] = [];
  const postH = 5; // standoff height
  const outerR = doc.board.mountingHoles.diameterMm / 2 + 1.5;
  const innerR = doc.board.mountingHoles.diameterMm / 2;

  lines.push(`// Mounting posts`);
  lines.push(`module mount_posts() {`);

  for (const pos of doc.board.mountingHoles.positions) {
    lines.push(`  translate([${pos.x + wallT}, ${pos.y + wallT}, ${wallT}]) {`);
    lines.push(`    difference() {`);
    lines.push(`      cylinder(h=${postH}, r=${outerR}, $fn=24);`);
    lines.push(`      cylinder(h=${postH + 0.1}, r=${innerR}, $fn=24);`);
    lines.push(`    }`);
    lines.push(`  }`);
  }

  lines.push(`}`);
  return lines.join("\n");
}

// ─── Ventilation Slots ───────────────────────────────────────

function generateVents(caseW: number, caseH: number, caseD: number, wallT: number): string {
  const lines: string[] = [];
  const slotW = 1.5;
  const slotH = 15;
  const slotCount = Math.floor((caseW - 20) / 4);
  const startX = (caseW - slotCount * 4) / 2;

  lines.push(`// Ventilation slots`);
  lines.push(`module vents() {`);

  for (let i = 0; i < slotCount; i++) {
    const x = startX + i * 4;
    // Bottom vents
    lines.push(`  translate([${x}, ${caseH / 2 - slotH / 2}, -0.1])`);
    lines.push(`    cube([${slotW}, ${slotH}, ${wallT + 0.2}]);`);
  }

  lines.push(`}`);
  return lines.join("\n");
}

// ─── Label Embossing ─────────────────────────────────────────

function generateLabel(text: string, caseW: number, caseD: number, wallT: number): string {
  return [
    `// Embossed label`,
    `module label() {`,
    `  translate([${caseW / 2}, 0.2, ${caseD / 2}])`,
    `    rotate([90, 0, 0])`,
    `      linear_extrude(height=0.6)`,
    `        text("${text}", size=5, halign="center", valign="center", font="Liberation Sans:style=Bold");`,
    `}`,
  ].join("\n");
}

// ─── Main Generator ──────────────────────────────────────────

export function generateOpenSCADEnclosure(doc: MHDLDocument): BuildArtifact[] {
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

  // Header
  lines.push(`/**`);
  lines.push(` * ${doc.meta.name} — Enclosure`);
  lines.push(` * ${doc.meta.description}`);
  lines.push(` * Generated by MeshCue Forge v${doc.meta.schemaVersion}`);
  lines.push(` *`);
  lines.push(` * Print settings:`);
  lines.push(` *   Material: ${enc.material?.toUpperCase() || "PLA"}`);
  lines.push(` *   Layer height: 0.2mm`);
  lines.push(` *   Infill: 20%`);
  lines.push(` *   Supports: ${enc.type === "snap-fit" ? "minimal" : "none"}`);
  lines.push(` *   Orientation: ${enc.printOrientation || "upright"}`);
  lines.push(` */`);
  lines.push(``);

  // Parameters
  lines.push(`// ─── Parameters ────────────────────────────────`);
  lines.push(`case_width = ${caseW};`);
  lines.push(`case_height = ${caseH};`);
  lines.push(`case_depth = ${caseD};`);
  lines.push(`wall = ${wallT};`);
  lines.push(`corner_r = ${cornerR};`);
  lines.push(`split_z = ${splitZ};`);
  lines.push(`tolerance = 0.3; // printer tolerance`);
  lines.push(``);

  // Rounded box module
  lines.push(`// ─── Base Shape ────────────────────────────────`);
  lines.push(`module rounded_box(w, h, d, r) {`);
  lines.push(`  hull() {`);
  lines.push(`    for (x = [r, w - r])`);
  lines.push(`      for (y = [r, h - r])`);
  lines.push(`        for (z = [r, d - r])`);
  lines.push(`          translate([x, y, z]) sphere(r=r, $fn=24);`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push(``);

  // Shell module
  lines.push(`module shell() {`);
  lines.push(`  difference() {`);
  lines.push(`    rounded_box(case_width, case_height, case_depth, corner_r);`);
  lines.push(`    translate([wall, wall, wall])`);
  lines.push(`      rounded_box(case_width - wall*2, case_height - wall*2, case_depth - wall*2, max(corner_r - wall, 0.1));`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push(``);

  // Cutouts module
  lines.push(`// ─── Cutouts ───────────────────────────────────`);
  lines.push(`module cutouts() {`);

  for (const cutout of enc.cutouts) {
    const size = cutout.size || CUTOUT_SIZES[cutout.type] || { width: 10, height: 5 };
    const w = cutout.diameter || size.width;
    const h = cutout.diameter || size.height;

    if (cutout.type === "led-hole" && cutout.diameter) {
      // Circular cutout for LEDs
      const transform = wallTransform(cutout.wall, caseW, caseH, caseD, wallT, w, h, cutout);
      lines.push(`  // ${cutout.type} (${cutout.componentRef || ""})`);
      lines.push(`  ${transform}`);
      lines.push(`    rotate([${cutout.wall === "front" || cutout.wall === "back" ? "-90, 0, 0" : cutout.wall === "left" || cutout.wall === "right" ? "0, 90, 0" : "0, 0, 0"}])`);
      lines.push(`      cylinder(h=${wallT + 0.2}, d=${cutout.diameter}, $fn=24);`);
    } else {
      // Rectangular cutout
      const transform = wallTransform(cutout.wall, caseW, caseH, caseD, wallT, w, h, cutout);
      lines.push(`  // ${cutout.type} (${cutout.componentRef || ""})`);
      lines.push(`  ${transform}`);
      lines.push(`    ${cutoutDimensions(cutout.wall, wallT, w, h)};`);
    }
  }

  lines.push(`}`);
  lines.push(``);

  // Mount posts
  const mountCode = generateMountPosts(doc, wallT);
  if (mountCode) {
    lines.push(mountCode);
    lines.push(``);
  }

  // Vents
  if (enc.ventilation) {
    lines.push(generateVents(caseW, caseH, caseD, wallT));
    lines.push(``);
  }

  // Label
  if (enc.labelEmboss) {
    lines.push(generateLabel(enc.labelEmboss, caseW, caseD, wallT));
    lines.push(``);
  }

  // Snap-fit clips
  if (enc.type === "snap-fit") {
    lines.push(`// ─── Snap-fit Clips ────────────────────────────`);
    lines.push(`clip_w = 8;`);
    lines.push(`clip_h = 2;`);
    lines.push(`clip_depth = 1.5;`);
    lines.push(``);
    lines.push(`module clip() {`);
    lines.push(`  hull() {`);
    lines.push(`    cube([clip_w, clip_depth, clip_h]);`);
    lines.push(`    translate([clip_w/2, clip_depth, clip_h]) sphere(r=0.5, $fn=16);`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push(``);
    lines.push(`module clips_base() {`);
    lines.push(`  // Left and right clips`);
    lines.push(`  translate([-clip_depth, case_height/2 - clip_w/2, split_z - clip_h])`);
    lines.push(`    rotate([0, 0, -90]) clip();`);
    lines.push(`  translate([case_width, case_height/2 - clip_w/2, split_z - clip_h])`);
    lines.push(`    rotate([0, 0, 90]) clip();`);
    lines.push(`}`);
    lines.push(``);
    lines.push(`module clips_lid() {`);
    lines.push(`  // Matching slots`);
    lines.push(`  translate([-0.1, case_height/2 - clip_w/2 - tolerance, split_z - clip_h - tolerance])`);
    lines.push(`    cube([clip_depth + 0.2, clip_w + tolerance*2, clip_h + tolerance*2]);`);
    lines.push(`  translate([case_width - clip_depth - 0.1, case_height/2 - clip_w/2 - tolerance, split_z - clip_h - tolerance])`);
    lines.push(`    cube([clip_depth + 0.2, clip_w + tolerance*2, clip_h + tolerance*2]);`);
    lines.push(`}`);
    lines.push(``);
  }

  // Screw-close tabs
  if (enc.type === "screw-close") {
    lines.push(`// ─── Screw Tabs ────────────────────────────────`);
    lines.push(`screw_r = 1.5;`);
    lines.push(`tab_r = 4;`);
    lines.push(``);
    lines.push(`module screw_tabs() {`);
    lines.push(`  for (x = [tab_r + 2, case_width - tab_r - 2])`);
    lines.push(`    for (y = [tab_r + 2, case_height - tab_r - 2])`);
    lines.push(`      translate([x, y, 0]) {`);
    lines.push(`        difference() {`);
    lines.push(`          cylinder(h=case_depth, r=tab_r, $fn=24);`);
    lines.push(`          cylinder(h=case_depth + 0.1, r=screw_r, $fn=24);`);
    lines.push(`        }`);
    lines.push(`      }`);
    lines.push(`}`);
    lines.push(``);
  }

  // Assembly — Base
  lines.push(`// ─── Assembly ──────────────────────────────────`);
  lines.push(`module base() {`);
  lines.push(`  difference() {`);
  lines.push(`    intersection() {`);
  lines.push(`      shell();`);
  lines.push(`      cube([case_width, case_height, split_z]);`);
  lines.push(`    }`);
  lines.push(`    cutouts();`);
  if (enc.ventilation) lines.push(`    vents();`);
  lines.push(`  }`);
  if (mountCode) lines.push(`  mount_posts();`);
  if (enc.type === "snap-fit") lines.push(`  clips_base();`);
  if (enc.labelEmboss) lines.push(`  label();`);
  lines.push(`}`);
  lines.push(``);

  // Assembly — Lid
  lines.push(`module lid() {`);
  lines.push(`  difference() {`);
  lines.push(`    intersection() {`);
  lines.push(`      shell();`);
  lines.push(`      translate([0, 0, split_z])`);
  lines.push(`        cube([case_width, case_height, case_depth - split_z]);`);
  lines.push(`    }`);
  lines.push(`    cutouts();`);
  if (enc.type === "snap-fit") lines.push(`    clips_lid();`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push(``);

  // Render
  lines.push(`// ─── Render ────────────────────────────────────`);
  lines.push(`// Uncomment one:`);
  lines.push(`base();`);
  lines.push(`// lid();`);
  lines.push(`// Exploded view:`);
  lines.push(`// base(); translate([0, 0, split_z + 15]) lid();`);

  // Base enclosure file
  artifacts.push({
    stage: "enclosure",
    filename: "enclosure.scad",
    content: lines.join("\n"),
    format: "openscad",
  });

  return artifacts;
}
