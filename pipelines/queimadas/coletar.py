"""Focos de queimada perto das rodovias estaduais do Amazonas, para o DMOB Hub. [Claude] 23/11/2026.

Fonte: INPE, Programa Queimadas, dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/ (público, sem login).
Satélite de referência AQUA_M-T (o mesmo usado pelo INPE nas séries comparáveis entre anos).
- Anos fechados: anual/EstadosBr_sat_ref/AM/focos_br_am_ref_AAAA.zip; se ainda não existir, anual/Brasil_sat_ref/
  focos_br_ref_AAAA.zip filtrado por estado; se nem esse existir, os arquivos mensais.
- Ano corrente: mensal/Brasil/focos_mensal_br_AAAAMM.csv (todos os satélites, até 120 MB; lido em fluxo e filtrado
  por AQUA_M-T + AMAZONAS). Período fechado há mais de 7 dias vira cache em pipelines/queimadas/cache/ e não é
  baixado de novo.
Geometria: RODOVIAS_ESTADUAIS_AMAZONAS.geojson do Atlas (SIRGAS 2000, EPSG:4674), trechos do SRE com km inicial/final.
Buffer de 5 km: projeção equiretangular local por trecho (x = R·Δlon·cos(lat0), y = R·Δlat, R = 6.371.008,8 m,
lat0/lon0 = centro do trecho). Nos trechos do AM (até ~3° de latitude) o erro de escala fica abaixo de 1,5%,
ou seja, menos de 75 m na borda do buffer. Distância ponto-linha e km por referência linear com shapely.
Saída: data/queimadas.json
Uso: python -I pipelines/queimadas/coletar.py [--desde 2019] [--ate AAAA-MM-DD] [--geojson caminho] [--teste]
"""
import argparse, csv, datetime as dt, io, json, math, os, sys, time, urllib.request, zipfile

import numpy as np
import shapely
from shapely.geometry import shape
from shapely.ops import linemerge

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(BASE_DIR, "..", ".."))
SAIDA = os.path.join(RAIZ, "data", "queimadas.json")
CACHE = os.path.join(BASE_DIR, "cache")
INPE = "https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv"
GEOJSON = "https://leonzordhue.github.io/atlas-amazonas/geojson/RODOVIAS_ESTADUAIS_AMAZONAS.geojson"
SAT = "AQUA_M-T"
BUFFER_M = 5000
R = 6371008.8
UA = {"User-Agent": "Mozilla/5.0 (DMOB Hub)"}
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def abrir(url, timeout=300, tentativas=4):
    for t in range(tentativas):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if t == tentativas - 1:
                raise
        except Exception:
            if t == tentativas - 1:
                raise
        time.sleep(5 * (t + 1))


def linha(r):
    """Normaliza as duas variantes de CSV do INPE (anual: data_pas; mensal: data_hora_gmt) -> (lat, lon, 'AAAA-MM-DD', município)."""
    return (round(float(r["lat"]), 4), round(float(r["lon"]), 4), (r.get("data_pas") or r.get("data_hora_gmt"))[:10],
            (r.get("municipio") or "").strip())


def filtra(linhas, anual):
    out = []
    for r in csv.DictReader(linhas):
        if (r.get("estado") or "").strip() != "AMAZONAS":
            continue
        if not anual and (r.get("satelite") or "").strip() != SAT:
            continue
        out.append(linha(r))
    return out


def baixar_anual(ano):
    for url in (f"{INPE}/anual/EstadosBr_sat_ref/AM/focos_br_am_ref_{ano}.zip", f"{INPE}/anual/Brasil_sat_ref/focos_br_ref_{ano}.zip"):
        r = abrir(url)
        if r:
            print(f"  {url}")
            z = zipfile.ZipFile(io.BytesIO(r.read()))
            return filtra(io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8", errors="replace"), anual=True)
    return None


def baixar_mensal(ano, mes):
    nome = f"{INPE}/mensal/Brasil/focos_mensal_br_{ano}{mes:02d}"
    r = abrir(nome + ".csv")
    if r:
        print(f"  {nome}.csv")
        # pré-filtro barato por texto antes do csv (o arquivo do mês tem todos os satélites do Brasil)
        txt = io.TextIOWrapper(r, encoding="utf-8", errors="replace")
        cab = next(txt)
        return filtra([cab] + [l for l in txt if SAT in l and "AMAZONAS" in l], anual=False)
    r = abrir(nome + ".zip")
    if r:
        print(f"  {nome}.zip")
        z = zipfile.ZipFile(io.BytesIO(r.read()))
        return filtra(io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8", errors="replace"), anual=False)
    return None


def periodo(chave, fim, baixar, hoje):
    """Lê do cache ou baixa; grava cache quando o período terminou há mais de 7 dias."""
    p = os.path.join(CACHE, f"focos_am_{chave}.csv")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            return [(float(a), float(b), c, d) for a, b, c, d in list(csv.reader(f))[1:]]
    rows = baixar()
    if rows is not None and (hoje - fim).days > 7:
        os.makedirs(CACHE, exist_ok=True)
        with open(p, "w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["lat", "lon", "data", "municipio"])
            w.writerows(rows)
    return rows


def focos(desde, hoje):
    todos = []
    for ano in range(desde, hoje.year + 1):
        print(f"{ano}")
        rows = periodo(str(ano), dt.date(ano, 12, 31), lambda: baixar_anual(ano), hoje) if ano < hoje.year else None
        if rows is None:
            rows = []
            for m in range(1, 13 if ano < hoje.year else hoje.month + 1):
                fim = (dt.date(ano, m, 28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
                rm = periodo(f"{ano}{m:02d}", fim, lambda: baixar_mensal(ano, m), hoje)
                if rm is None:
                    print(f"  {ano}-{m:02d}: arquivo não encontrado no INPE")
                rows += rm or []
        print(f"  {len(rows)} focos no AM")
        todos += rows
    return todos


def trechos(geo):
    out = []
    for f in geo["features"]:
        p = f["properties"]
        g = f["geometry"]
        if not g:
            continue
        geom = shape(g)
        (x0, y0, x1, y1) = geom.bounds
        lat0, lon0 = (y0 + y1) / 2, (x0 + x1) / 2
        k = math.cos(math.radians(lat0))
        proj = shapely.transform(geom, lambda c: np.column_stack([R * np.radians(c[:, 0] - lon0) * k, R * np.radians(c[:, 1] - lat0)]))
        if proj.geom_type == "MultiLineString":
            proj = linemerge(proj)
        m = BUFFER_M / 111195  # graus de latitude
        out.append({"rod": p.get("RODOVIA"), "sre": p.get("CÓDIGO S."), "km_ini": p.get("KM INICIAL") or 0, "km_fim": p.get("KM FINAL"),
                    "ext": p.get("EXTENSÃO"), "lat0": lat0, "lon0": lon0, "k": k, "geom": proj,
                    "bbox": (x0 - m / k, y0 - m, x1 + m / k, y1 + m)})
    return out


def cruzar(pts, tr):
    """Para cada foco (lat, lon): {rodovia: (sre, km, dist_m)} das rodovias a até 5 km (o trecho mais próximo de cada rodovia)."""
    lat = np.array([p[0] for p in pts])
    lon = np.array([p[1] for p in pts])
    perto = [dict() for _ in pts]
    for t in tr:
        x0, y0, x1, y1 = t["bbox"]
        idx = np.nonzero((lon >= x0) & (lon <= x1) & (lat >= y0) & (lat <= y1))[0]
        if not len(idx):
            continue
        xs = R * np.radians(lon[idx] - t["lon0"]) * t["k"]
        ys = R * np.radians(lat[idx] - t["lat0"])
        geoms = shapely.points(xs, ys)
        d = shapely.distance(t["geom"], geoms)
        for i, dist, g in zip(idx, d, geoms):
            if dist <= BUFFER_M:
                ant = perto[i].get(t["rod"])
                if ant is None or dist < ant[2]:
                    km = t["km_ini"] + shapely.line_locate_point(t["geom"], g) / 1000
                    perto[i][t["rod"]] = (t["sre"], round(km, 1), round(float(dist)))
    return perto


def resumir(pts, perto, tr, hoje, desde):
    ano_at = hoje.year
    corte30 = (hoje - dt.timedelta(days=30)).isoformat()
    rods = {}
    for t in tr:
        r = rods.setdefault(t["rod"], {"anos": {str(a): 0 for a in range(desde, ano_at + 1)}, "meses_ano_atual": [0] * 12,
                                       "ultimos_30d": 0, "extensao_km": 0.0, "trechos_sre": {}})
        r["extensao_km"] = round(r["extensao_km"] + (t["ext"] or 0), 2)
        r["trechos_sre"].setdefault(t["sre"], 0)
    bins = {}
    total_am = {str(a): 0 for a in range(desde, ano_at + 1)}
    for p, pr in zip(pts, perto):
        ano = p[2][:4]
        total_am[ano] = total_am.get(ano, 0) + 1
        for rod, (sre, km, _) in pr.items():
            r = rods[rod]
            r["anos"][ano] += 1
            r["trechos_sre"][sre] += 1
            if int(ano) == ano_at:
                r["meses_ano_atual"][int(p[2][5:7]) - 1] += 1
            if p[2] >= corte30:
                r["ultimos_30d"] += 1
            b = bins.setdefault((rod, int(km // 5) * 5), {"total": 0, "ano_atual": 0})
            b["total"] += 1
            b["ano_atual"] += int(ano) == ano_at
    for r in rods.values():
        r["total"] = sum(r["anos"].values())
        r["por_100km"] = round(r["total"] / r["extensao_km"] * 100, 1) if r["extensao_km"] else None
    top = sorted(bins.items(), key=lambda kv: -kv[1]["total"])[:20]
    recentes = [[p[0], p[1], p[2], p[3], sorted(pr)[0] if pr else None, min((v[2] for v in pr.values()), default=None)]
                for p, pr in zip(pts, perto) if p[2] >= corte30]
    em_buffer = {str(a): 0 for a in range(desde, ano_at + 1)}
    for p, pr in zip(pts, perto):
        if pr:
            em_buffer[p[2][:4]] += 1
    return {
        "anos": [str(a) for a in range(desde, ano_at + 1)],
        "total_am": total_am, "em_buffer": em_buffer,
        "ranking": sorted(rods, key=lambda c: (-rods[c]["total"], c)),
        "rodovias": rods,
        "trechos_top": [{"rod": k[0], "km_ini": k[1], "km_fim": k[1] + 5, **v} for k, v in top],
        "recentes": sorted(recentes, key=lambda x: x[2], reverse=True)[:5000],
        "recentes_campos": ["lat", "lon", "data", "municipio", "rodovia_5km", "dist_m"],
    }


def teste():
    geo = {"features": [{"properties": {"RODOVIA": "AM-999", "CÓDIGO S.": "999EAM0010", "KM INICIAL": 10.0, "KM FINAL": 30.0, "EXTENSÃO": 20.0},
                         "geometry": {"type": "LineString", "coordinates": [[-60.0, -3.0], [-60.0 + 20000 / (111195 * math.cos(math.radians(3))), -3.0]]}}]}
    tr = trechos(geo)
    lat_4km = -3.0 + 4000 / 111195
    pts = [(lat_4km, -59.95, "2026-11-20", "X"), (-3.0 + 6000 / 111195, -59.95, "2026-11-20", "X"), (-3.0, -61.0, "2020-01-01", "Y")]
    pr = cruzar(pts, tr)
    assert "AM-999" in pr[0] and abs(pr[0]["AM-999"][2] - 4000) < 30, pr[0]
    assert abs(pr[0]["AM-999"][1] - (10 + 0.05 * 111195 * math.cos(math.radians(3)) / 1000)) < 0.2, pr[0]
    assert pr[1] == {} and pr[2] == {}, pr
    res = resumir(pts, pr, tr, dt.date(2026, 11, 23), 2019)
    assert res["rodovias"]["AM-999"]["anos"]["2026"] == 1 and res["rodovias"]["AM-999"]["ultimos_30d"] == 1
    assert res["total_am"]["2026"] == 2 and res["em_buffer"]["2026"] == 1 and res["trechos_top"][0]["km_ini"] == 15
    assert filtra(["lat,lon,data_hora_gmt,satelite,estado,municipio\n", "-3.1,-60.2,2026-11-01 17:00:00,AQUA_M-T,AMAZONAS,MANAUS\n",
                   "-3.1,-60.2,2026-11-01 17:00:00,NOAA-20,AMAZONAS,MANAUS\n"], anual=False) == [(-3.1, -60.2, "2026-11-01", "MANAUS")]
    print("teste ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde", type=int, default=2019)
    ap.add_argument("--ate", help="data final AAAA-MM-DD (teste local sem os mensais grandes do ano corrente)")
    ap.add_argument("--geojson", default=GEOJSON, help="URL ou caminho local do GeoJSON das rodovias estaduais")
    ap.add_argument("--teste", action="store_true")
    a = ap.parse_args()
    if a.teste:
        return teste()
    hoje = dt.date.fromisoformat(a.ate) if a.ate else dt.date.today()
    if os.path.exists(a.geojson):
        with open(a.geojson, encoding="utf-8") as f:
            geo = json.load(f)
    else:
        geo = json.load(abrir(a.geojson))
    tr = trechos(geo)
    print(f"{len(tr)} trechos de rodovia")
    pts = focos(a.desde, hoje)
    assert pts, "nenhum foco baixado"
    res = resumir(pts, cruzar(pts, tr), tr, hoje, a.desde)
    meta = {
        "fonte": "INPE - Programa Queimadas (BDQueimadas), focos do satélite de referência AQUA_M-T; "
                 "geometria das rodovias estaduais do Atlas Amazonas (SRE/SEINFRA)",
        "url": INPE + "/", "geojson": GEOJSON,
        "gerado_em": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "metodologia": "Foco conta para a rodovia se estiver a até 5 km de qualquer trecho dela (distância ponto-linha em projeção "
                       "equiretangular local por trecho, erro < 1,5%). Um foco perto de duas rodovias conta para as duas; no total "
                       "do AM conta uma vez. Km do foco = km inicial do trecho + posição projetada sobre a linha (aproximado). "
                       "Satélite de referência: só AQUA_M-T, para comparar anos; o total de focos de todos os satélites é bem maior.",
        "buffer_km": BUFFER_M / 1000, "satelite": SAT,
    }
    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    with open(SAIDA, "w", encoding="utf-8") as f:
        json.dump({"_meta": meta, **res}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"gravado {SAIDA}: {len(pts)} focos no AM, {sum(res['em_buffer'].values())} a até 5 km de rodovia estadual")


if __name__ == "__main__":
    main()
