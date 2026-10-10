#!/usr/bin/env python3
"""Generate tower upgrade recolours from the shipped GLB meshes; stdlib only."""
from __future__ import annotations
import hashlib, json, struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/assets/models/tower-expansion-v1"
OUTPUT = ROOT / "public/assets/models/tower-levels-v1"
PALETTES = {
    2: (0.42, 0.76, 1.0),   # azure/teal tier
    3: (1.0, 0.69, 0.26),   # gold/ember tier
}
TOWERS = {"ArcherTower": "tower_archer", "SwordTower": "tower_sword", "MageTower": "tower_mage"}

def recolour(source: bytes, tint: tuple[float, float, float]) -> bytes:
    if len(source) < 20 or source[:4] != b"glTF":
        raise ValueError("not a binary glTF")
    magic, version, total = struct.unpack_from("<4sII", source, 0)
    if version != 2 or total != len(source):
        raise ValueError("invalid GLB header")
    json_length, chunk_type = struct.unpack_from("<I4s", source, 12)
    if chunk_type != b"JSON": raise ValueError("missing JSON chunk")
    start, end = 20, 20 + json_length
    doc = json.loads(source[start:end].decode("utf-8").rstrip(" \t\r\n\0"))
    materials = doc.get("materials", [])
    if not materials: raise ValueError("tower GLB has no materials")
    for material in materials:
        pbr = material.setdefault("pbrMetallicRoughness", {})
        base = pbr.get("baseColorFactor", [1.0, 1.0, 1.0, 1.0])
        if len(base) != 4: raise ValueError("bad baseColorFactor")
        # Preserve each part's value contrast and alpha while shifting the whole skin.
        pbr["baseColorFactor"] = [round(max(0.0, min(1.0, base[i] * tint[i])), 5) for i in range(3)] + [base[3]]
        emissive = material.get("emissiveFactor")
        if emissive is not None:
            material["emissiveFactor"] = [round(max(0.0, min(1.0, emissive[i] * tint[i])), 5) for i in range(3)]
    encoded = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded += b" " * ((-len(encoded)) % 4)
    rest = source[end:]
    total_length = 12 + 8 + len(encoded) + len(rest)
    return struct.pack("<4sII", magic, version, total_length) + struct.pack("<I4s", len(encoded), b"JSON") + encoded + rest

def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    entries = []
    for kind, stem in TOWERS.items():
        original = (SOURCE / f"{stem}.glb").read_bytes()
        for level, tint in PALETTES.items():
            filename = f"{stem}_level_{level}.glb"
            payload = recolour(original, tint)
            (OUTPUT / filename).write_bytes(payload)
            entries.append({"kind": kind, "level": level, "file": filename,
                            "sourceSha256": hashlib.sha256(original).hexdigest(),
                            "sha256": hashlib.sha256(payload).hexdigest(), "bytes": len(payload),
                            "tint": list(tint), "geometry": "unchanged source tower skin"})
    manifest = {"format": "wanderer-tower-levels-v1", "levels": [1, 2, 3],
                "levelOne": "Original tower-expansion-v1 model; levels 2 and 3 are recolours.",
                "assets": entries}
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(entries)} deterministic level recolours from {len(TOWERS)} source skins.")

if __name__ == "__main__": main()
