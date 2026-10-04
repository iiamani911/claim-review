#!/usr/bin/env python3
"""Build the compact drug knowledge base used by the WAD Clinic claim review platform.

Source: CHI Drug Formulary (DDF) workbook, sheets "Indication" and "Mapped to SFDA".

Usage:
    python3 scripts/build_formulary.py path/to/DDF_CHI_Drug_Formulary.xlsx

Output: public/data/formulary.json
    {
      "version": "...",
      "ingredients": { <scientific root>: {
            "n": scientific name, "c": pharmacological class,
            "i": [[icd codes "J00,J02", indication text, edits, mdd adult, mdd paeds, ip-only flag], ...],
            "notes": [unique prescribing notes (truncated)] } },
      "products": [[root, trade name, route, legal status, form, price, atc], ...],
      "index":    { <register no | old register no | GTIN without leading zeros>: product idx }
    }
"""
import json
import os
import re
import sys

import pandas as pd


def clean(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    return re.sub(r"\s+", " ", str(v)).strip()


def main(src):
    ind = pd.read_excel(src, sheet_name="Indication", header=2, dtype=str)
    ind = ind.loc[:, ~ind.columns.str.startswith("Unnamed")]
    ind.columns = [re.sub(r"\s+", " ", c).strip() for c in ind.columns]

    sf = pd.read_excel(src, sheet_name="Mapped to SFDA", header=4, dtype=str)
    sf = sf.loc[:, ~sf.columns.str.startswith("Unnamed")]

    ingredients = {}
    for _, r in ind.iterrows():
        root = clean(r.get("SCIENTIFIC DESCRIPTION CODE ROOT"))
        if not root:
            continue
        ing = ingredients.setdefault(root, {
            "n": clean(r.get("SCIENTIFIC NAME")),
            "c": clean(r.get("DRUG PHARMACOLOGICAL CLASS")),
            "i": [], "_seen": set(), "notes": [], "_nseen": set(),
        })
        codes = ",".join(sorted({c.strip().upper() for c in re.split(r"[,;\s]+", clean(r.get("ICD 10 CODE"))) if c.strip()}))
        key = (codes, clean(r.get("INDICATION")))
        if codes and key not in ing["_seen"]:
            ing["_seen"].add(key)
            ing["i"].append([
                codes,
                clean(r.get("INDICATION")).title(),
                clean(r.get("PRESCRIBING EDITS")),
                clean(r.get("MDD ADULTS"))[:80],
                clean(r.get("MDD PEDIATRICS"))[:80],
                1 if clean(r.get("PATIENT TYPE")) == "IP" else 0,
            ])
        note = clean(r.get("NOTES"))
        if note and len(ing["notes"]) < 4:
            short = note[:420]
            if short not in ing["_nseen"]:
                ing["_nseen"].add(short)
                ing["notes"].append(short)

    for ing in ingredients.values():
        ing.pop("_seen", None)
        ing.pop("_nseen", None)

    products, index = [], {}
    for _, r in sf.iterrows():
        root = clean(r.get("ScientificDescriptionCodeRoot"))
        if not root:
            continue
        if root not in ingredients:
            # Registered by SFDA but not in the CHI formulary indication list:
            # keep the name so the app can say "not listed in CHI formulary".
            ingredients[root] = {"n": clean(r.get("Scientific Name")), "c": "", "i": [], "notes": []}
        price = clean(r.get("Public price"))
        products.append([
            root,
            clean(r.get("Trade Name")),
            clean(r.get("AdministrationRoute")),
            clean(r.get("Legal Status")),
            clean(r.get("PharmaceuticalForm")),
            float(price) if re.match(r"^[0-9.]+$", price) else None,
            clean(r.get("AtcCode1")),
        ])
        idx = len(products) - 1
        for k in (clean(r.get("RegisterNumber")), clean(r.get("Old register Number"))):
            if k:
                index.setdefault(k.upper(), idx)
        g = clean(r.get("GTIN")).lstrip("0")
        if g:
            index.setdefault(g, idx)

    out = {
        "version": re.sub(r"^[0-9a-f]{8}-", "", os.path.basename(src)),
        "ingredients": ingredients,
        "products": products,
        "index": index,
    }
    dest = os.path.join(os.path.dirname(__file__), "..", "public", "data", "formulary.json")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"ingredients={len(ingredients)} products={len(products)} index={len(index)} -> {dest} "
          f"({os.path.getsize(dest) / 1e6:.2f} MB)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
