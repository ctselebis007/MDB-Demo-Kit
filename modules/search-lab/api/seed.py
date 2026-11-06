"""~2,000 deterministic synthetic products. Edit the vocab below to re-theme for a prospect."""

from __future__ import annotations

import random

SEED = 7
N_PRODUCTS = 2000

CATEGORIES: dict[str, dict] = {
    "footwear": {
        "nouns": ["running shoe", "trail runner", "hiking boot", "sneaker", "sandal", "rain boot"],
        "features": [
            "grippy rubber outsole",
            "responsive foam cushioning",
            "a wide toe box",
            "a waterproof membrane",
            "reflective details",
            "a cushioned heel",
        ],
        "price": (39, 240),
    },
    "outerwear": {
        "nouns": ["rain jacket", "puffer jacket", "fleece", "windbreaker", "parka", "softshell"],
        "features": [
            "taped seams",
            "recycled down fill",
            "pit zips",
            "an adjustable hood",
            "a packable pocket",
            "a brushed lining",
        ],
        "price": (49, 480),
    },
    "camping": {
        "nouns": ["tent", "sleeping bag", "camp stove", "headlamp", "trekking poles", "backpack"],
        "features": [
            "a three-season rating",
            "a 20-degree comfort rating",
            "a quick-pitch frame",
            "a rechargeable battery",
            "carbon-fiber shafts",
            "a ventilated back panel",
        ],
        "price": (15, 650),
    },
    "kitchen": {
        "nouns": [
            "espresso machine",
            "chef's knife",
            "cast iron skillet",
            "blender",
            "pour-over kettle",
            "dutch oven",
        ],
        "features": [
            "a 15-bar pump",
            "a full-tang blade",
            "a pre-seasoned surface",
            "a gooseneck spout",
            "variable speed control",
            "an enameled interior",
        ],
        "price": (19, 900),
    },
    "electronics": {
        "nouns": [
            "noise-cancelling headphones",
            "smartwatch",
            "bluetooth speaker",
            "e-reader",
            "action camera",
            "wireless earbuds",
        ],
        "features": [
            "40-hour battery life",
            "active noise cancellation",
            "a glare-free display",
            "4K video",
            "water resistance",
            "multipoint pairing",
        ],
        "price": (29, 750),
    },
    "home": {
        "nouns": [
            "desk lamp",
            "throw blanket",
            "air purifier",
            "standing desk",
            "area rug",
            "bookshelf",
        ],
        "features": [
            "a HEPA filter",
            "a dimmable warm light",
            "a memory-preset motor",
            "organic cotton",
            "a solid oak frame",
            "a low-pile weave",
        ],
        "price": (25, 850),
    },
}
BRANDS = [
    "Northpeak",
    "Riverstone",
    "Lumen & Co",
    "Altitude",
    "Kestrel",
    "Harbor",
    "Evergreen",
    "Solace",
    "Ironwood",
    "Brightline",
]
ADJECTIVES = [
    "lightweight",
    "waterproof",
    "insulated",
    "compact",
    "ergonomic",
    "durable",
    "breathable",
    "recycled",
    "premium",
    "minimalist",
    "rugged",
    "packable",
]
COLORS = ["slate", "forest green", "sand", "black", "ocean blue", "rust", "charcoal", "white"]
USES = [
    "for weekend hikes",
    "for daily commutes",
    "for small apartments",
    "for long-haul travel",
    "for rainy city days",
    "for backcountry trips",
    "for home baristas",
    "for focused work sessions",
    "for family camping",
    "for marathon training",
]

embed_fields = {"products": ["title", "description"]}


def collections() -> list[str]:
    return ["products"]


def generate(rng: random.Random) -> dict[str, list[dict]]:
    products = []
    for i in range(N_PRODUCTS):
        category = rng.choice(sorted(CATEGORIES))
        spec = CATEGORIES[category]
        noun = rng.choice(spec["nouns"])
        adjective = rng.choice(ADJECTIVES)
        color = rng.choice(COLORS)
        use = rng.choice(USES)
        f1, f2 = rng.sample(spec["features"], 2)
        brand = rng.choice(BRANDS)
        lo, hi = spec["price"]
        products.append(
            {
                "_id": f"p{i:04d}",
                "title": f"{brand} {adjective.title()} {noun.title()}",
                "description": f"A {adjective} {color} {noun} {use}, with {f1} and {f2}.",
                "category": category,
                "brand": brand,
                "price": round(rng.uniform(lo, hi), 2),
                "tags": [adjective, color, use.removeprefix("for ")],
                "rating": round(rng.uniform(3.0, 5.0), 1),
            }
        )
    return {"products": products}
