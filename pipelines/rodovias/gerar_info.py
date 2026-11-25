"""Gera data/rodovias_info.json: municípios atravessados por rodovia estadual (km em cada um),
região, rodovia coincidente e nome alternativo. Usado pela ficha e pelo briefing da rodovia (v1/v2).

Fontes:
- traçado: atlas-amazonas/geojson/v2/RODOVIAS_ESTADUAIS_AMAZONAS.geojson (SER/SEINFRA);
- limites municipais: data/mapa_malha.geojson (IBGE, malha municipal);
- nomes alternativos: projetos/dmob/despachos/base-de-conhecimento.md §5 (lista fixa abaixo).

Uso: python -I pipelines/rodovias/gerar_info.py
"""
import json, os, urllib.request
from datetime import date
from shapely.geometry import shape
from shapely.ops import transform
from pyproj import Transformer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE_DIR))
URL_ROD = "https://leonzordhue.github.io/atlas-amazonas/geojson/v2/RODOVIAS_ESTADUAIS_AMAZONAS.geojson"

# Denominações conhecidas (base-de-conhecimento.md §5 e CLAUDE.md "Dados institucionais").
NOMES = {
    "AM-010": "Rodovia Manaus–Itacoatiara",
    "AM-070": "Rodovia Manoel Urbano (Manaus/Iranduba–Manacapuru)",
    "AM-151": "antiga Estrada Carlos Braga",
    "AM-240": "Estrada de Balbina",
    "AM-254": "Estrada de Autazes",
    "AM-352": "Rodovia Washington Régis (Manacapuru–Novo Airão)",
    "AM-363": "Estrada da Várzea (Itacoatiara–Silves–Itapiranga)",
    "AM-364": "Ramal da Democracia (Manicoré–BR-319)",
    "AM-450": "Anel Sul / Rapidão",
    "AM-452": "Estrada do Caldeirão",
    "AM-453": "Acesso à Comunidade Bela Vista (km 56–57 da AM-070)",
}

# Equal-area para medir km (SIRGAS 2000 / Brazil Polyconic).
PROJ = Transformer.from_crs("EPSG:4674", "EPSG:5880", always_xy=True).transform


def main():
    with urllib.request.urlopen(URL_ROD, timeout=60) as r:
        rod = json.load(r)
    with open(os.path.join(RAIZ, "data", "mapa_malha.geojson"), encoding="utf-8") as f:
        malha = json.load(f)
    muns = [(m["properties"]["nome"], transform(PROJ, shape(m["geometry"]).buffer(0))) for m in malha["features"]]

    out = {}
    for ft in rod["features"]:
        p = ft["properties"]
        nome = (p.get("RODOVIA") or "").strip()
        if not nome or not ft.get("geometry"):
            continue
        linha = transform(PROJ, shape(ft["geometry"]))
        o = out.setdefault(nome, {"municipios": {}, "regiao": set(), "coincidente": set()})
        for mn, poly in muns:
            if poly.intersects(linha):
                km = poly.intersection(linha).length / 1000
                if km >= 0.05:
                    o["municipios"][mn] = o["municipios"].get(mn, 0) + km
        if p.get("REGIÃO"):
            o["regiao"].add(p["REGIÃO"].strip())
        if p.get("COINCIDENT"):
            o["coincidente"].add(str(p["COINCIDENT"]).strip())

    rodovias = {}
    for nome, o in sorted(out.items()):
        rodovias[nome] = {
            "municipios": [{"nome": m, "km": round(k, 1)} for m, k in sorted(o["municipios"].items(), key=lambda x: -x[1])],
            "regiao": sorted(o["regiao"]),
            "coincidente": sorted(o["coincidente"]),
            "nome_alt": NOMES.get(nome, ""),
        }
    # nome alternativo sem traçado no geojson ainda entra
    for nome, alt in NOMES.items():
        rodovias.setdefault(nome, {"municipios": [], "regiao": [], "coincidente": [], "nome_alt": alt})

    assert rodovias["AM-010"]["municipios"], "AM-010 sem município: malha ou traçado quebrado"
    doc = {
        "_meta": {
            "fonte": "Traçado SER/SEINFRA (atlas-amazonas RODOVIAS_ESTADUAIS_AMAZONAS.geojson) × malha municipal IBGE (data/mapa_malha.geojson); nomes alternativos: base de conhecimento DMOB §5",
            "gerado": date.today().isoformat(),
            "gerador": "pipelines/rodovias/gerar_info.py",
            "regras": "km por município = comprimento do traçado dentro do limite municipal (EPSG:5880); trechos com menos de 50 m são ignorados",
        },
        "rodovias": rodovias,
    }
    with open(os.path.join(RAIZ, "data", "rodovias_info.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    print(len(rodovias), "rodovias;", "AM-010:", rodovias["AM-010"])


if __name__ == "__main__":
    main()
