#!/usr/bin/env python3
"""Generate low-poly map landmarks that reuse the project's deterministic GLB writer."""
from __future__ import annotations
import importlib.util, json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "Tools~/generate_visual_expansion.py"
OUTPUT = ROOT / "public/assets/models/world-map-v1"
spec = importlib.util.spec_from_file_location("wanderer_visual_expansion", SOURCE)
if spec is None or spec.loader is None: raise RuntimeError("cannot load existing GLB writer")
mesh = importlib.util.module_from_spec(spec); spec.loader.exec_module(mesh)
Asset, box, gem, plane = mesh.Asset, mesh.box, mesh.gem, mesh.plane

def build_assets():
    out = []
    # Four-metre river segment: banks, dark channel, and pale current accents.
    a = Asset("world_river_tile", "world-map-water")
    plane(a, "river_channel", 3.1, 4.0, .035, "water")
    box(a, "west_bank", (.48, .055, 4.0), "sand", (-1.78, .015, 0))
    box(a, "east_bank", (.48, .055, 4.0), "sand", (1.78, .015, 0))
    for i, z in enumerate((-1.2, -.1, 1.05)):
        box(a, f"current_{i}", (.72, .012, .045), "water_light", ((i % 2) * .4 - .2, .052, z), .08)
    out.append(a)
    # Soft irregular lake with a shore ring and three calm ripple arcs.
    a = Asset("world_lake", "world-map-water")
    n = 32
    outer = [(2.05 * (1 + .055 * __import__("math").sin(i * 2.3)) * __import__("math").cos(i * __import__("math").tau/n), .018,
              1.52 * (1 + .06 * __import__("math").cos(i * 1.7)) * __import__("math").sin(i * __import__("math").tau/n)) for i in range(n)]
    inner = [(x * .79, .04, z * .79) for x, _, z in outer]
    a.part("sandy_shore", outer + inner, [(i, (i+1)%n, n+(i+1)%n) for i in range(n)] + [(i, n+(i+1)%n, n+i) for i in range(n)], "sand", convex=False)
    a.part("lake_surface", [(0,.045,0)] + inner, [(0, 1+(i+1)%n, 1+i) for i in range(n)], "water", convex=False)
    for i, scale in enumerate((.18, .28, .38)):
        mesh.arc(a, f"lake_ripple_{i}", scale, scale+.012, -.95, .95, .055, "water_light", 14)
    out.append(a)
    # Clustered ridgeline with snow-lit high facets, sized to sit over one terrain cell.
    a = Asset("world_mountain", "world-map-landmark")
    for i, (x, z, sx, sy, sz) in enumerate(((-.78,-.18,.95,2.35,.86),(.55,-.05,1.2,2.95,1.05),(1.25,.42,.7,1.78,.7))):
        gem(a, f"peak_{i}", (x, sy*.45, z), (sx, sy, sz), "stone" if i != 1 else "stone_light", seed=740+i, jitter=.08)
        gem(a, f"snowcap_{i}", (x-.08, sy*.89, z-.04), (sx*.35, sy*.20, sz*.34), (0.81,.86,.82,1), seed=800+i, jitter=.025)
    out.append(a)
    # Rounded cave hill, dark arched opening, and chunky entrance stones.
    a = Asset("world_cave", "world-map-landmark")
    gem(a, "cave_hill", (0, .68, 0), (2.05, 1.35, 1.55), "stone", seed=990, jitter=.055)
    box(a, "cave_darkness", (1.13, .92, .035), (0.035,.045,.055,1), (0,.48,-1.23))
    box(a, "left_jamb", (.34, .96, .38), "stone_light", (-.76,.48,-1.22), -.12)
    box(a, "right_jamb", (.34, .96, .38), "stone_light", (.76,.48,-1.22), .12)
    box(a, "arch_keystone", (1.2,.30,.42), "stone_light", (0,1.03,-1.22))
    gem(a, "entrance_boulder_left", (-1.05,.30,-1.14), (.44,.36,.36), "charcoal", seed=991, jitter=.05)
    gem(a, "entrance_boulder_right", (1.02,.28,-1.13), (.38,.33,.34), "stone", seed=992, jitter=.05)
    out.append(a)
    return out

def main():
    assets = [item.write(OUTPUT) for item in build_assets()]
    manifest = {"format":"wanderer-world-map-v1", "upAxis":"+Y", "units":"metres", "static":True,
                "collision":"presentation only; existing deterministic terrain owns collision", "assets":assets}
    (OUTPUT/"manifest.json").write_text(json.dumps(manifest, indent=2)+"\n", encoding="utf-8")
    print(f"Generated {len(assets)} world-map assets; {sum(x['triangles'] for x in assets)} triangles.")
if __name__ == "__main__": main()
