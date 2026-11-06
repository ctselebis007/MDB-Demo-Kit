"""~500-node synthetic supply chain: supplier -> part -> product -> customer.

Edges are stored as adjacency lists on each node (`out_<edge>`), which is what
`$graphLookup` follows via `connectFromField`.
"""

from __future__ import annotations

import random

SEED = 11
COUNTS = {"supplier": 60, "part": 180, "product": 140, "customer": 120}
EDGES = {"supplier": "out_supplies", "part": "out_component_of", "product": "out_sold_to"}

REGIONS = [
    "Rotterdam",
    "Shenzhen",
    "Monterrey",
    "Penang",
    "Stuttgart",
    "Osaka",
    "Austin",
    "Gdańsk",
    "Pune",
    "Busan",
]
SUPPLIER_WORDS = (
    [
        "Apex",
        "Pacific",
        "Northstar",
        "Granite",
        "Helix",
        "Vertex",
        "Cobalt",
        "Summit",
        "Meridian",
        "Aurora",
    ],
    [
        "Metals",
        "Polymers",
        "Electronics",
        "Cells",
        "Optics",
        "Castings",
        "Textiles",
        "Semiconductors",
        "Magnetics",
        "Composites",
    ],
)
SPECIALTIES = {
    "Metals": "aluminum and steel",
    "Polymers": "engineering plastics",
    "Electronics": "circuit board",
    "Cells": "lithium battery cell",
    "Optics": "lens and sensor",
    "Castings": "die-cast housing",
    "Textiles": "technical fabric",
    "Semiconductors": "microcontroller",
    "Magnetics": "rare-earth magnet",
    "Composites": "carbon fiber",
}
TRAITS = [
    "fast lead times",
    "conflict-free sourcing",
    "ISO 14001 certification",
    "low defect rates",
    "recycled feedstock",
    "just-in-time delivery",
]
PARTS = [
    "lithium cell pack",
    "aluminum housing",
    "OLED panel",
    "brushless motor",
    "PCB assembly",
    "silicone gasket",
    "carbon frame",
    "image sensor",
    "charging module",
    "steel axle",
    "thermal pad",
    "wifi chipset",
    "fabric shell",
    "magnet array",
    "glass lens",
]
PROPERTIES = [
    "heat resistance",
    "weight savings",
    "energy density",
    "durability",
    "water resistance",
    "low power draw",
]
PRODUCTS = [
    "e-bike",
    "camera drone",
    "smart thermostat",
    "cordless drill",
    "VR headset",
    "robot vacuum",
    "electric scooter",
    "smart speaker",
    "action camera",
    "heat pump",
    "solar inverter",
    "rain shell jacket",
    "fitness tracker",
    "home battery",
]
PRODUCT_LINES = ["Pro", "Lite", "Max", "Air", "One", "Trail", "Urban", "Edge"]
CUSTOMER_WORDS = (
    [
        "Northwind",
        "Bluebird",
        "Contoso",
        "Fabrikam",
        "Lakeside",
        "Redwood",
        "Silverline",
        "Tailspin",
    ],
    ["Outfitters", "Retail", "Mobility", "Homes", "Energy", "Logistics"],
)
SEGMENTS = [
    "big-box retail",
    "direct-to-consumer",
    "fleet operator",
    "utility",
    "online marketplace",
    "specialty dealer",
]

embed_fields = {"nodes": ["name", "description"]}


def collections() -> list[str]:
    return ["nodes"]


def _ids(kind: str) -> list[str]:
    return [f"{kind[:3]}-{i:03d}" for i in range(COUNTS[kind])]


def _link(
    rng: random.Random, sources: list[str], targets: list[str], lo: int, hi: int
) -> dict[str, list[str]]:
    """Each source gets lo..hi targets; every target gets at least one source."""
    out = {s: rng.sample(targets, rng.randint(lo, hi)) for s in sources}
    covered = {t for ts in out.values() for t in ts}
    for t in targets:
        if t not in covered:
            out[rng.choice(sources)].append(t)
    return {s: sorted(set(ts)) for s, ts in out.items()}


def generate(rng: random.Random) -> dict[str, list[dict]]:
    sup, par, pro, cus = (_ids(k) for k in ("supplier", "part", "product", "customer"))
    edges = {
        **_link(rng, sup, par, 2, 5),
        **_link(rng, par, pro, 1, 3),
        **_link(rng, pro, cus, 1, 4),
    }
    nodes: list[dict] = []

    for i in sup:
        a, b = rng.choice(SUPPLIER_WORDS[0]), rng.choice(SUPPLIER_WORDS[1])
        region = rng.choice(REGIONS)
        nodes.append(
            {
                "_id": i,
                "type": "supplier",
                "name": f"{a} {b}",
                "region": region,
                "description": f"{a} {b} is a {SPECIALTIES[b]} supplier based in {region}, "
                f"known for {rng.choice(TRAITS)}.",
            }
        )
    for i in par:
        part = rng.choice(PARTS)
        nodes.append(
            {
                "_id": i,
                "type": "part",
                "name": f"{part} {i[-3:]}",
                "description": f"A {part} engineered for {rng.choice(PROPERTIES)}.",
            }
        )
    for i in pro:
        product = rng.choice(PRODUCTS)
        name = f"{product.title()} {rng.choice(PRODUCT_LINES)}"
        nodes.append(
            {
                "_id": i,
                "type": "product",
                "name": name,
                "description": f"The {name} is a consumer {product} assembled from "
                "components sourced across the supply chain.",
            }
        )
    for i in cus:
        a, b = rng.choice(CUSTOMER_WORDS[0]), rng.choice(CUSTOMER_WORDS[1])
        region = rng.choice(REGIONS)
        nodes.append(
            {
                "_id": i,
                "type": "customer",
                "name": f"{a} {b}",
                "region": region,
                "description": f"{a} {b} is a {rng.choice(SEGMENTS)} customer in {region}.",
            }
        )

    for n in nodes:
        field = EDGES.get(n["type"])
        targets = edges.get(n["_id"], []) if field else []
        for f in EDGES.values():
            n[f] = targets if f == field else []
        n["out_all"] = targets
    return {"nodes": nodes}
