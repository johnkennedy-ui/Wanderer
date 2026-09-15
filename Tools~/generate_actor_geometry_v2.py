#!/usr/bin/env python3
"""Create a small, dependency-free low-poly GLB asset pack for Wanderer."""

from __future__ import annotations

import hashlib
import json
import math
import struct
import sys
from pathlib import Path


OUT = Path(sys.argv[1]) if len(sys.argv) == 2 else Path(__file__).resolve().parents[1] / "public/assets/models/actor-geometry-v2"

COLORS = {
    "forest": (0.12, 0.27, 0.20, 1.0),
    "deep_forest": (0.06, 0.13, 0.12, 1.0),
    "moss": (0.28, 0.45, 0.22, 1.0),
    "teal": (0.14, 0.49, 0.47, 1.0),
    "violet": (0.48, 0.22, 0.70, 1.0),
    "ember": (0.96, 0.28, 0.06, 1.0),
    "gold": (0.88, 0.57, 0.15, 1.0),
    "bronze": (0.47, 0.25, 0.10, 1.0),
    "silver": (0.66, 0.74, 0.78, 1.0),
    "stone": (0.34, 0.39, 0.39, 1.0),
    "charcoal": (0.10, 0.12, 0.14, 1.0),
    "wood": (0.34, 0.18, 0.08, 1.0),
    "leather": (0.24, 0.12, 0.07, 1.0),
    "bone": (0.77, 0.70, 0.52, 1.0),
    "blue": (0.12, 0.28, 0.62, 1.0),
    "pale_teal": (0.43, 0.86, 0.78, 1.0),
    "rust": (0.55, 0.17, 0.08, 1.0),
    "soil": (0.22, 0.12, 0.07, 1.0),
    "crop": (0.22, 0.66, 0.25, 1.0),
}


class Asset:
    def __init__(self, name: str):
        self.name = name
        self.parts: list[tuple[str, list[float], list[float], list[int], int]] = []
        self.materials: list[tuple[float, float, float, float]] = []
        self.material_index: dict[tuple[float, float, float, float], int] = {}

    def material(self, color: str | tuple[float, float, float, float]) -> int:
        rgba = COLORS[color] if isinstance(color, str) else color
        if rgba not in self.material_index:
            self.material_index[rgba] = len(self.materials)
            self.materials.append(rgba)
        return self.material_index[rgba]

    def add_part(
        self,
        name: str,
        vertices: list[float],
        normals: list[float],
        indices: list[int],
        color: str | tuple[float, float, float, float],
    ) -> None:
        self.parts.append((name, vertices, normals, indices, self.material(color)))

    def write(self, filename: str) -> None:
        OUT.mkdir(parents=True, exist_ok=True)
        blob = bytearray()
        buffer_views = []
        accessors = []

        def align4() -> None:
            while len(blob) % 4:
                blob.append(0)

        def add_bytes(data: bytes, target: int | None = None) -> int:
            align4()
            start = len(blob)
            blob.extend(data)
            view = {"buffer": 0, "byteOffset": start, "byteLength": len(data)}
            if target is not None:
                view["target"] = target
            buffer_views.append(view)
            return len(buffer_views) - 1

        def add_accessor(view: int, count: int, component_type: int, typ: str, minimum=None, maximum=None) -> int:
            accessor = {
                "bufferView": view,
                "componentType": component_type,
                "count": count,
                "type": typ,
            }
            if minimum is not None:
                accessor["min"] = minimum
            if maximum is not None:
                accessor["max"] = maximum
            accessors.append(accessor)
            return len(accessors) - 1

        meshes = []
        nodes = []
        for part_name, vertices, normals, indices, material_index in self.parts:
            vertex_count = len(vertices) // 3
            vertex_bytes = struct.pack(f"<{len(vertices)}f", *vertices)
            normal_bytes = struct.pack(f"<{len(normals)}f", *normals)
            index_bytes = struct.pack(f"<{len(indices)}H", *indices)
            positions_view = add_bytes(vertex_bytes, 34962)
            normals_view = add_bytes(normal_bytes, 34962)
            indices_view = add_bytes(index_bytes, 34963)
            positions = list(zip(*(iter(vertices),) * 3))
            minimum = [min(p[i] for p in positions) for i in range(3)]
            maximum = [max(p[i] for p in positions) for i in range(3)]
            position_accessor = add_accessor(
                positions_view,
                vertex_count,
                5126,
                "VEC3",
                minimum,
                maximum,
            )
            normal_accessor = add_accessor(normals_view, vertex_count, 5126, "VEC3")
            index_accessor = add_accessor(indices_view, len(indices), 5123, "SCALAR")
            meshes.append(
                {
                    "name": part_name,
                    "primitives": [
                        {
                            "attributes": {"POSITION": position_accessor, "NORMAL": normal_accessor},
                            "indices": index_accessor,
                            "material": material_index,
                        }
                    ],
                }
            )
            nodes.append({"name": part_name, "mesh": len(meshes) - 1})

        gltf = {
            "asset": {"version": "2.0", "generator": "Wanderer low-poly asset tool"},
            "scene": 0,
            "scenes": [{"nodes": list(range(len(nodes)))}],
            "nodes": nodes,
            "meshes": meshes,
            "materials": [
                {
                    "name": f"mat_{index:02d}",
                    "pbrMetallicRoughness": {
                        "baseColorFactor": list(color),
                        "metallicFactor": 0.08,
                        "roughnessFactor": 0.82,
                    },
                }
                for index, color in enumerate(self.materials)
            ],
            "accessors": accessors,
            "bufferViews": buffer_views,
            "buffers": [{"byteLength": len(blob)}],
        }
        json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
        while len(json_bytes) % 4:
            json_bytes += b" "
        while len(blob) % 4:
            blob.append(0)
        glb = (
            struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(json_bytes) + 8 + len(blob))
            + struct.pack("<I4s", len(json_bytes), b"JSON")
            + json_bytes
            + struct.pack("<I4s", len(blob), b"BIN\x00")
            + blob
        )
        (OUT / filename).write_bytes(glb)


def transform(points: list[tuple[float, float, float]], rotate_y: float = 0.0, offset=(0.0, 0.0, 0.0)):
    c, s = math.cos(rotate_y), math.sin(rotate_y)
    ox, oy, oz = offset
    return [(x * c - z * s + ox, y + oy, x * s + z * c + oz) for x, y, z in points]


def flat_part(asset: Asset, name: str, triangles: list[tuple[tuple[float, float, float], ...]], color: str, rotate_y=0.0, offset=(0, 0, 0)):
    vertices: list[float] = []
    normals: list[float] = []
    indices: list[int] = []
    for triangle in triangles:
        pts = transform(list(triangle), rotate_y, offset)
        a, b, c = pts
        ab = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        ac = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
        n = (
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
        )
        length = math.sqrt(sum(value * value for value in n)) or 1.0
        n = tuple(value / length for value in n)
        start = len(vertices) // 3
        for point in pts:
            vertices.extend(point)
            normals.extend(n)
        indices.extend([start, start + 1, start + 2])
    asset.add_part(name, vertices, normals, indices, color)


def box(asset: Asset, name: str, size, color: str, offset=(0, 0, 0), rotate_y=0.0):
    sx, sy, sz = (value / 2 for value in size)
    p = [
        (-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
        (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz),
    ]
    # Counter-clockwise when viewed from outside.  flat_part derives normals
    # from this winding, so the two contracts must stay together.
    faces = [
        (0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7),
        (0, 5, 4), (0, 1, 5), (3, 6, 2), (3, 7, 6),
        (1, 6, 5), (1, 2, 6), (0, 7, 3), (0, 4, 7),
    ]
    flat_part(asset, name, [tuple(p[index] for index in face) for face in faces], color, rotate_y, offset)


def beam_between(asset: Asset, name: str, start, end, width: float, color: str):
    """Author a small rectangular beam between two measured local points."""
    dx, dy, dz = (end[index] - start[index] for index in range(3))
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    if length == 0:
        raise ValueError(f"{name} requires distinct endpoints")
    # A stable perpendicular pair, with the first one in the XY plane for the
    # actor weapon geometry authored here.
    ux, uy = -dy / length * width / 2, dx / length * width / 2
    vz = width / 2
    points = [
        (start[0] - ux, start[1] - uy, start[2] - vz),
        (start[0] + ux, start[1] + uy, start[2] - vz),
        (end[0] + ux, end[1] + uy, end[2] - vz),
        (end[0] - ux, end[1] - uy, end[2] - vz),
        (start[0] - ux, start[1] - uy, start[2] + vz),
        (start[0] + ux, start[1] + uy, start[2] + vz),
        (end[0] + ux, end[1] + uy, end[2] + vz),
        (end[0] - ux, end[1] - uy, end[2] + vz),
    ]
    faces = [
        (0, 1, 2), (0, 2, 3), (4, 6, 5), (4, 7, 6),
        (0, 4, 5), (0, 5, 1), (3, 2, 6), (3, 6, 7),
        (1, 5, 6), (1, 6, 2), (0, 3, 7), (0, 7, 4),
    ]
    flat_part(asset, name, [tuple(points[index] for index in face) for face in faces], color)


def cylinder(asset: Asset, name: str, radius: float, height: float, color: str, offset=(0, 0, 0), sides=8, rotate_y=0.0, top_radius=None):
    top_radius = radius if top_radius is None else top_radius
    triangles = []
    for index in range(sides):
        a0 = (index / sides) * math.tau
        a1 = ((index + 1) / sides) * math.tau
        b0 = (radius * math.cos(a0), -height / 2, radius * math.sin(a0))
        b1 = (radius * math.cos(a1), -height / 2, radius * math.sin(a1))
        t0 = (top_radius * math.cos(a0), height / 2, top_radius * math.sin(a0))
        t1 = (top_radius * math.cos(a1), height / 2, top_radius * math.sin(a1))
        # Side faces need the opposite winding to the cap faces below.
        triangles.extend([(b0, t1, b1), (b0, t0, t1)])
        triangles.extend([((0, height / 2, 0), t1, t0), ((0, -height / 2, 0), b0, b1)])
    flat_part(asset, name, triangles, color, rotate_y, offset)


def ico(asset: Asset, name: str, radius: float, color: str, offset=(0, 0, 0), scale=(1, 1, 1)):
    phi = (1 + math.sqrt(5)) / 2
    raw = [
        (-1, phi, 0), (1, phi, 0), (-1, -phi, 0), (1, -phi, 0),
        (0, -1, phi), (0, 1, phi), (0, -1, -phi), (0, 1, -phi),
        (phi, 0, -1), (phi, 0, 1), (-phi, 0, -1), (-phi, 0, 1),
    ]
    length = math.sqrt(1 + phi * phi)
    p = [(x / length * radius * scale[0], y / length * radius * scale[1], z / length * radius * scale[2]) for x, y, z in raw]
    faces = [
        (0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11),
        (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
        (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
        (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1),
    ]
    flat_part(asset, name, [tuple(p[index] for index in face) for face in faces], color, offset=offset)


def cone(asset: Asset, name: str, radius: float, height: float, color: str, offset=(0, 0, 0), sides=8):
    cylinder(asset, name, radius, height, color, offset, sides=sides, top_radius=0.0)


def fin(asset: Asset, name: str, length: float, width: float, height: float, color: str, offset=(0, 0, 0), rotate_y=0.0):
    box(asset, name, (length, height, width), color, offset, rotate_y)


def make_projectile_knight():
    a = Asset("projectile_knight_blade_arc")
    for index in range(7):
        angle = -0.95 + index * 0.32
        radius = 0.72
        box(a, f"arc_{index}", (0.34, 0.14, 0.12), "silver", (math.sin(angle) * radius, 0.14, math.cos(angle) * radius - 0.22), angle)
    ico(a, "ember_core", 0.16, "ember", (0, 0.16, -0.22), scale=(1.2, 0.8, 1.2))
    a.write("projectile_knight_blade_arc.glb")


def make_projectile_wizard():
    a = Asset("projectile_wizard_flame_orb")
    ico(a, "flame_orb", 0.28, "ember", (0, 0.28, 0), scale=(1, 1.25, 1))
    ico(a, "violet_core", 0.13, "violet", (0, 0.3, 0.03), scale=(1.2, 1, 1.2))
    for index in range(5):
        angle = index * math.tau / 5
        cone(a, f"flame_fin_{index}", 0.08, 0.3, "gold", (math.cos(angle) * 0.28, 0.28, math.sin(angle) * 0.28), sides=5)
    a.write("projectile_wizard_flame_orb.glb")


def make_projectile_archer():
    a = Asset("projectile_archer_arrow")
    box(a, "shaft", (1.35, 0.06, 0.06), "wood", (0, 0.1, 0), rotate_y=math.pi / 2)
    cone(a, "arrowhead", 0.13, 0.34, "silver", (0.79, 0.1, 0), sides=5)
    for angle in (0.0, math.pi / 2, math.pi):
        fin(a, f"fletching_{int(angle * 10)}", 0.23, 0.06, 0.12, "teal", (-0.48, 0.1, 0), rotate_y=angle)
    a.write("projectile_archer_arrow.glb")


def make_scout():
    a = Asset("enemy_scout")
    ico(a, "body", 0.42, "moss", (0, 0.47, 0), scale=(0.8, 1.15, 0.7))
    ico(a, "mask", 0.24, "bone", (0, 0.72, -0.26), scale=(1.0, 0.8, 0.45))
    grip = (0.34, 0.55, 0.0)
    spear_tip = (0.57, 0.55, -0.48)
    beam_between(a, "spear", grip, spear_tip, 0.08, "wood")
    # The tip overlaps the shaft endpoint and is deliberately on local -Z,
    # matching the actor's recorded forward axis.
    ico(a, "spear_tip", 0.15, "stone", spear_tip, scale=(0.6, 0.6, 1.1))
    box(a, "satchel", (0.25, 0.26, 0.18), "leather", (-0.3, 0.38, 0.15), rotate_y=0.3)
    a.write("enemy_scout.glb")


def make_brute():
    a = Asset("enemy_brute")
    ico(a, "body", 0.62, "stone", (0, 0.68, 0), scale=(1.2, 1.1, 0.95))
    box(a, "chest_plate", (0.72, 0.55, 0.16), "rust", (0, 0.72, -0.53), rotate_y=0.0)
    ico(a, "head", 0.34, "stone", (0, 1.26, -0.02), scale=(1.05, 0.9, 0.9))
    box(a, "club", (0.18, 0.18, 1.05), "wood", (0.78, 0.58, 0.05), rotate_y=-0.35)
    # Keep the original club identity while joining its head to the shaft.
    ico(a, "club_head", 0.27, "bronze", (0.96, 0.66, 0.54), scale=(1.3, 0.85, 1.0))
    a.write("enemy_brute.glb")


def make_spitter():
    a = Asset("enemy_spitter")
    ico(a, "body", 0.5, "deep_forest", (0, 0.48, 0), scale=(1.25, 0.8, 1.0))
    ico(a, "throat_sac", 0.3, "teal", (0, 0.45, -0.42), scale=(0.9, 1.1, 0.65))
    ico(a, "toxic_spines", 0.23, "violet", (0, 0.78, 0.18), scale=(1.0, 1.4, 0.8))
    for index in range(3):
        angle = -0.5 + index * 0.5
        cone(a, f"spine_{index}", 0.09, 0.35, "violet", (math.sin(angle) * 0.32, 0.72, math.cos(angle) * 0.28), sides=5)
    a.write("enemy_spitter.glb")


def make_elite():
    a = Asset("enemy_elite")
    ico(a, "armor", 0.57, "charcoal", (0, 0.7, 0), scale=(0.9, 1.35, 0.72))
    ico(a, "chest_core", 0.19, "violet", (0, 0.78, -0.47), scale=(1, 1.1, 0.6))
    ico(a, "head", 0.3, "charcoal", (0, 1.38, 0), scale=(0.9, 1.0, 0.8))
    for side in (-1, 1):
        cone(a, f"antler_{side}", 0.1, 0.58, "violet", (side * 0.22, 1.78, 0), sides=5)
        box(a, f"pauldron_{side}", (0.35, 0.2, 0.34), "bone", (side * 0.45, 1.04, 0))
    a.write("enemy_elite.glb")


def make_wyrm():
    a = Asset("enemy_ember_wyrm")
    ico(a, "body", 0.72, "charcoal", (0, 0.72, 0), scale=(1.5, 0.85, 0.95))
    ico(a, "chest_core", 0.25, "ember", (0, 0.72, -0.67), scale=(1.0, 1.25, 0.55))
    ico(a, "head", 0.42, "charcoal", (0, 1.05, -0.72), scale=(1.0, 0.85, 0.9))
    for side in (-1, 1):
        cone(a, f"horn_{side}", 0.13, 0.5, "bone", (side * 0.25, 1.45, -0.7), sides=6)
        fin(a, f"wing_{side}", 0.8, 0.42, 0.08, "ember", (side * 0.48, 0.95, 0.05), rotate_y=side * 0.5)
        box(a, f"leg_{side}", (0.2, 0.48, 0.28), "charcoal", (side * 0.42, 0.35, -0.05))
    box(a, "tail", (0.22, 0.22, 0.95), "charcoal", (0, 0.55, 0.7), rotate_y=math.pi)
    a.write("enemy_ember_wyrm.glb")


def make_knight():
    a = Asset("player_knight")
    cylinder(a, "boots", 0.28, 0.14, "charcoal", (-0.18, 0.07, 0), sides=6)
    cylinder(a, "boots_r", 0.28, 0.14, "charcoal", (0.18, 0.07, 0), sides=6)
    ico(a, "armor", 0.42, "silver", (0, 0.55, 0), scale=(0.9, 1.15, 0.7))
    ico(a, "head", 0.27, "bone", (0, 1.05, -0.02), scale=(0.95, 1.0, 0.85))
    box(a, "cloak", (0.55, 0.72, 0.12), "forest", (0, 0.54, 0.34))
    box(a, "sword", (0.1, 0.1, 0.9), "silver", (0.52, 0.57, -0.02), rotate_y=-0.35)
    box(a, "scarf", (0.44, 0.12, 0.08), "ember", (0, 0.87, -0.25))
    a.write("player_knight.glb")


def make_wizard():
    a = Asset("player_wizard")
    cone(a, "robe", 0.44, 0.86, "blue", (0, 0.5, 0), sides=7)
    ico(a, "head", 0.24, "bone", (0, 1.04, -0.02), scale=(0.9, 1.0, 0.9))
    cone(a, "hood", 0.31, 0.32, "violet", (0, 1.28, -0.02), sides=7)
    box(a, "staff", (0.09, 1.2, 0.09), "wood", (0.46, 0.65, 0), rotate_y=0.15)
    ico(a, "staff_crystal", 0.17, "pale_teal", (0.5, 1.28, 0), scale=(0.75, 1.4, 0.75))
    ico(a, "pendant", 0.1, "ember", (0, 0.8, -0.25), scale=(0.8, 1.2, 0.5))
    a.write("player_wizard.glb")


def make_archer():
    a = Asset("player_archer")
    cylinder(a, "body", 0.33, 0.7, "leather", (0, 0.48, 0), sides=7, top_radius=0.26)
    ico(a, "head", 0.25, "bone", (0, 0.98, -0.02), scale=(0.95, 1.0, 0.9))
    box(a, "hood", (0.48, 0.18, 0.35), "moss", (0, 1.18, 0.03))
    # A six-segment curved limb and two endpoint-to-grip string segments make
    # a connected bow rather than parallel detached bars.
    grip = (0.55, 0.60, 0.0)
    upper_tip, lower_tip = (0.67, 1.23, 0.0), (0.67, -0.03, 0.0)
    box(a, "bow", (0.10, 0.20, 0.10), "wood", grip, rotate_y=0.15)
    for name, start, end in [
        ("bow_upper_inner", grip, (0.75, 0.88, 0.0)),
        ("bow_upper_outer", (0.75, 0.88, 0.0), upper_tip),
        ("bow_lower_inner", grip, (0.75, 0.32, 0.0)),
        ("bow_lower_outer", (0.75, 0.32, 0.0), lower_tip),
    ]:
        beam_between(a, name, start, end, 0.09, "wood")
    beam_between(a, "bow_string_upper", upper_tip, grip, 0.025, "bone")
    beam_between(a, "bow_string_lower", grip, lower_tip, 0.025, "bone")
    box(a, "quiver", (0.18, 0.48, 0.18), "teal", (-0.32, 0.6, 0.25), rotate_y=0.25)
    for index in range(3):
        fin(a, f"feather_{index}", 0.12, 0.05, 0.12, "teal", (-0.32 + index * 0.06, 0.88, 0.25), rotate_y=index * 0.5)
    a.write("player_archer.glb")


def make_campfire():
    a = Asset("building_campfire")
    for index in range(8):
        angle = index * math.tau / 8
        cylinder(a, f"stone_{index}", 0.2, 0.25, "stone", (math.cos(angle) * 0.55, 0.13, math.sin(angle) * 0.55), sides=6)
    for index in range(3):
        box(a, f"log_{index}", (0.85, 0.13, 0.15), "wood", (0, 0.35 + index * 0.04, 0), rotate_y=index * math.pi / 3)
    ico(a, "flame", 0.32, "ember", (0, 0.65, 0), scale=(0.65, 1.4, 0.65))
    box(a, "pennant", (0.05, 0.5, 0.3), "moss", (0, 0.5, 0.75))
    a.write("building_campfire.glb")


def make_workshop():
    a = Asset("building_workshop")
    box(a, "floor", (1.55, 0.16, 1.3), "wood", (0, 0.08, 0))
    box(a, "back_wall", (1.5, 1.05, 0.14), "wood", (0, 0.62, 0.58))
    box(a, "left_wall", (0.14, 1.05, 1.15), "wood", (-0.68, 0.62, 0))
    box(a, "roof", (1.8, 0.18, 1.55), "bronze", (0, 1.28, 0))
    box(a, "bench", (0.8, 0.35, 0.38), "wood", (0, 0.33, -0.38))
    cylinder(a, "anvil", 0.2, 0.25, "silver", (0.26, 0.62, -0.38), sides=6)
    ico(a, "lantern", 0.12, "gold", (-0.42, 0.85, -0.42))
    a.write("building_workshop.glb")


def make_farm():
    a = Asset("building_farm")
    box(a, "soil_bed", (1.7, 0.12, 1.2), "soil", (0, 0.08, 0))
    for x in (-0.5, 0, 0.5):
        for z in (-0.32, 0.32):
            cylinder(a, f"crop_{x}_{z}", 0.1, 0.42, "crop", (x, 0.3, z), sides=5, top_radius=0.06)
    for index in range(4):
        angle = index * math.pi / 2
        box(a, f"fence_{index}", (1.95 if index % 2 == 0 else 0.12, 0.32, 0.12 if index % 2 == 0 else 1.45), "wood", (0, 0.24, 0) if index % 2 == 0 else (0, 0.24, 0))
    box(a, "gate", (0.42, 0.42, 0.12), "wood", (0, 0.3, -0.72))
    cylinder(a, "water_barrel", 0.22, 0.42, "teal", (0.72, 0.3, 0.5), sides=8)
    a.write("building_farm.glb")


def make_storage():
    a = Asset("building_storage")
    box(a, "shed", (1.55, 0.92, 1.28), "wood", (0, 0.54, 0))
    box(a, "roof", (1.75, 0.18, 1.48), "forest", (0, 1.1, 0))
    for x, z in [(-0.45, -0.7), (0.45, -0.7), (-0.45, 0.7), (0.45, 0.7)]:
        box(a, f"band_{x}_{z}", (0.1, 0.88, 0.1), "bronze", (x, 0.54, z))
    box(a, "door", (0.48, 0.65, 0.08), "deep_forest", (0, 0.45, -0.66))
    box(a, "crate", (0.4, 0.32, 0.35), "gold", (0.45, 0.25, -0.82))
    a.write("building_storage.glb")


def make_healing_hut():
    a = Asset("building_healing_hut")
    box(a, "hut", (1.45, 0.9, 1.25), "wood", (0, 0.5, 0))
    box(a, "roof", (1.7, 0.2, 1.48), "moss", (0, 1.08, 0))
    box(a, "door", (0.42, 0.62, 0.08), "deep_forest", (0, 0.42, -0.65))
    cylinder(a, "healing_basin", 0.28, 0.18, "stone", (0, 0.2, 0.72), sides=8)
    ico(a, "healing_crystal", 0.22, "violet", (0, 0.5, 0.72), scale=(0.75, 1.5, 0.75))
    for side in (-1, 1):
        box(a, f"herb_{side}", (0.12, 0.4, 0.12), "pale_teal", (side * 0.58, 0.55, -0.1), rotate_y=side * 0.25)
    a.write("building_healing_hut.glb")


def main():
    make_scout()
    make_brute()
    make_archer()
    assets = []
    for path in sorted(OUT.glob("*.glb")):
        assets.append({"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    (OUT / "manifest.json").write_text(json.dumps({
        "pack": "actor-geometry-v2", "version": 2,
        "source": "original actor identities with connected authored weapon geometry",
        "assets": assets,
        "grips": {
            "enemy_scout": [0.34, 0.55, 0.0],
            "enemy_brute": [0.78, 0.58, 0.05],
            "player_archer": [0.55, 0.60, 0.0]
        },
        "forward": [0, 0, -1]
    }, indent=2) + "\n")
    print(f"generated {len(assets)} actor-geometry-v2 GLB files in {OUT}")


if __name__ == "__main__":
    main()