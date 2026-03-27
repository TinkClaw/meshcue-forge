# MeshCue Node — 3D Print Guide

## Enclosure Dimensions
- Width: 75mm
- Height: 50mm
- Depth: 30mm
- Wall: 2.5mm

## Recommended Print Settings

| Setting | Value |
|---------|-------|
| Material | PETG |
| Nozzle | 0.4mm |
| Layer Height | 0.2mm |
| Infill | 20% |
| Perimeters | 3 |
| Top/Bottom layers | 4 |
| Supports | Yes (for snap clips) |
| Orientation | upright |
| Estimated time | ~101min per piece |
| Estimated filament | ~34g per piece |

## Print Order
1. Print **base** (enclosure.scad with `base()` uncommented)
2. Print **lid** (uncomment `lid()`, comment out `base()`)
3. Insert M3 threaded inserts into mounting posts (soldering iron, 220°C)
4. Mount PCB onto posts with M3x6mm screws
5. Snap/screw lid onto base

## Post-Processing
- Sand mating surfaces lightly if snap-fit is too tight
- Adjust `tolerance` parameter in .scad file (default 0.3mm)