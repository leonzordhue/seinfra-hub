"""Mapa do DMOB Hub v2: indicadores por município, trechos de 1 km e (no Actions) data/mapa.pmtiles. [Claude] 23/11/2026

Saídas
  data/mapa_municipios.json  por código IBGE: população, contratos, valores, ativos/paralisados, sinistros.
  data/mapa_malha.geojson    malha municipal leve (IBGE, qualidade mínima), base do mapa quando o .pmtiles não existe.
  data/mapa_trechos.json     GeoJSON de trechos de ~1 km das rodovias com levantamento de IRI (data/icm.json).
  data/mapa.pmtiles          (só com --tiles, precisa do tippecanoe) camadas municipios, rodovias, federais, ramais, hidrovias.
                             Só geometria: os números entram no navegador a partir dos JSON, então o .pmtiles quase nunca muda.

Fontes
  · IBGE, API de malhas v3 (servicodados.ibge.gov.br/api/v3/malhas/estados/13?intrarregiao=municipio).
  · IBGE, API de localidades v1 (nomes dos municípios).
  · IBGE/SIDRA, tabela 6579 "Estimativas de população", variável 9324, período mais recente.
  · Atlas Amazonas (leonzordhue.github.io/atlas-amazonas/geojson): rodovias estaduais/federais, ramais, hidrovias.
  · data/eobras.json, data/sinistros.json, data/sinistros_analise.json, data/icm.json (deste repositório).

Regras
  · Classe de condição pelo IRI: DNIT, Manual de Restauração de Pavimentos Asfálticos (IPR-720, 2006),
    quadro de condição do pavimento pelo IRI: excelente <= 1,9; bom <= 2,7; regular <= 3,5; ruim <= 4,6; péssimo > 4,6 m/km.
  · Contrato com vários municípios ("Manaus, Iranduba"): conta 1 contrato em cada um e o valor é rateado em partes iguais
    (assim a soma dos municípios fecha com o total). Mesma separação de v2/js/dados.js municipios().
  · Obra ativa = situação Andamento, Vigente, A Iniciar ou Em recebimento (v2/js/dados.js SIT.ativo).
  · Obra da rodovia: obra_da_rodovia() de pipelines/sinistros/analisar.py (rodovia citada só como localização não conta).

Uso: python -I pipelines/mapa/gerar.py [--tiles] [--teste]
"""
import argparse, datetime as dt, json, math, os, re, shutil, subprocess, sys, tempfile, unicodedata, urllib.request
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE_DIR))
DATA = os.path.join(RAIZ, "data")
sys.path.insert(0, os.path.join(RAIZ, "pipelines", "sinistros"))
from analisar import obra_da_rodovia  # noqa: E402  (regra única do repositório)

ATLAS_URL = "https://leonzordhue.github.io/atlas-amazonas/geojson/"
ATLAS_LOCAL = os.path.join(os.path.dirname(RAIZ), "atlas-amazonas", "geojson")  # repo irmão, se existir (teste no PC)
IBGE_MALHA = "https://servicodados.ibge.gov.br/api/v3/malhas/estados/13?intrarregiao=municipio&formato=application/vnd.geo+json&qualidade={q}"
IBGE_NOMES = "https://servicodados.ibge.gov.br/api/v1/localidades/estados/13/municipios"
SIDRA_POP = "https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N6[N3[13]]"
SIT_ATIVO = {"Andamento", "Vigente", "A Iniciar", "Em recebimento"}
# DNIT IPR-720 (2006): limites superiores de IRI (m/km) por classe
CLASSES_IRI = [(1.9, "Excelente"), (2.7, "Bom"), (3.5, "Regular"), (4.6, "Ruim"), (math.inf, "Péssimo")]


def baixar(url, tentativas=3):
    for i in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "dmob-hub-mapa/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if i == tentativas - 1:
                raise RuntimeError(f"falhou {url}: {e}")


def atlas(nome):
    local = os.path.join(ATLAS_LOCAL, nome)
    if os.path.exists(local):
        return json.load(open(local, encoding="utf-8"))
    return baixar(ATLAS_URL + nome)


def chave(s):
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().lower()


def municipios(mun):
    """Mesma separação de v2/js/dados.js municipios()."""
    return [m for m in re.split(r"\s*[,;/]\s*|\s+e\s+", str(mun or "")) if m]


def classe_iri(iri):
    if iri is None:
        return "Sem medição"
    return next(n for lim, n in CLASSES_IRI if iri <= lim)


def dist_m(lat1, lon1, lat2, lon2):
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def agora():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=-4))).strftime("%Y-%m-%dT%H:%M")


# ── municípios ────────────────────────────────────────────────────────────────
def gerar_municipios(eobras, analise, nomes_ibge, pop, ano_pop):
    por_chave = {chave(n): c for c, n in nomes_ibge.items()}
    M = {c: {"nome": n, "pop": pop.get(c), "contratos": 0, "v_contratado": 0.0, "v_medido": 0.0,
             "ativos": 0, "paralisados": 0, "sinistros": 0} for c, n in nomes_ibge.items()}
    sem = defaultdict(int)
    for ct in eobras["ct"].values():
        ms = municipios(ct.get("mun"))
        cods = [por_chave.get(chave(m)) for m in ms]
        for m, c in zip(ms, cods):
            if not c:
                sem[m] += 1
        cods = [c for c in cods if c]
        for c in cods:
            x = M[c]
            x["contratos"] += 1
            x["v_contratado"] += (ct.get("v_atual") or 0) / len(cods)
            x["v_medido"] += (ct.get("medido") or 0) / len(cods)
            x["ativos"] += ct.get("sit") in SIT_ATIVO
            x["paralisados"] += ct.get("sit") == "Paralisado"
    for nome, n in (analise.get("por_municipio") or {}).items():
        c = por_chave.get(chave(nome))
        if c:
            M[c]["sinistros"] = n
        else:
            sem[f"(sinistros) {nome}"] += n
    for x in M.values():
        x["v_contratado"] = round(x["v_contratado"], 2)
        x["v_medido"] = round(x["v_medido"], 2)
        x["r_hab"] = round(x["v_contratado"] / x["pop"], 2) if x["pop"] else None
    return M, dict(sem)


# ── trechos de 1 km ───────────────────────────────────────────────────────────
def obras_por_rodovia(eobras):
    obras = defaultdict(list)
    for id_, ct in eobras["ct"].items():
        if ct.get("sit") not in SIT_ATIVO:
            continue
        for n in set(re.findall(r"AM[\s\-]?0*(\d{2,3})", ct.get("obj") or "")):
            if obra_da_rodovia(ct.get("obj"), int(n)):
                obras["AM-%03d" % int(n)].append(id_)
    return obras


def km_num(v):
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None


def gerar_trechos(icm, sinistros, obras):
    sin_km = defaultdict(lambda: [0, 0])  # (rodovia, km) -> [ocorrências, com morte]
    for o in sinistros.get("ocorrencias", []):
        k = km_num(o.get("km"))
        if k is not None:
            s = sin_km[(o["rodovia"], int(k))]
            s[0] += 1
            s[1] += bool(o.get("fatal"))
    feats = []
    for r in icm["rodovias"]:
        cod = r["codigo"]
        segs = json.loads(r["segments"]) if isinstance(r["segments"], str) else r["segments"]
        bins = defaultdict(lambda: {"linhas": [], "m": 0.0, "iri_m": 0.0, "m_iri": 0.0})
        acum = 0.0
        for la1, lo1, la2, lo2, iri, _ in segs:
            d = dist_m(la1, lo1, la2, lo2)
            b = bins[int(acum // 1000)]
            ls = b["linhas"]
            if ls and ls[-1][-1] == [lo1, la1]:
                ls[-1].append([lo2, la2])
            else:
                ls.append([[lo1, la1], [lo2, la2]])
            b["m"] += d
            if iri is not None:
                b["iri_m"] += iri * d
                b["m_iri"] += d
            acum += d
        for km, b in sorted(bins.items()):
            iri = round(b["iri_m"] / b["m_iri"], 2) if b["m_iri"] else None
            s = sin_km.get((cod, km), [0, 0])
            feats.append({"type": "Feature", "geometry": {"type": "MultiLineString", "coordinates": b["linhas"]},
                          "properties": {"rodovia": cod, "km": km, "ext_m": round(b["m"]), "iri": iri, "classe": classe_iri(iri),
                                         "sinistros": s[0], "fatais": s[1], "obras": len(obras.get(cod, []))}})
    return feats


# ── tiles ─────────────────────────────────────────────────────────────────────
def limpa(fc, props):
    """Tira o 'crs' (o tippecanoe espera WGS84; SIRGAS 2000 difere em centímetros) e mantém só as propriedades usadas no mapa."""
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": f["geometry"], "properties": props(f.get("properties") or {})}
        for f in fc["features"] if f.get("geometry")]}


def gerar_tiles(malha_fina, nomes_ibge, saida):
    tip = shutil.which("tippecanoe")
    if not tip:
        raise SystemExit("tippecanoe não encontrado (roda só no GitHub Actions; ver .github/workflows/mapa.yml)")
    rod_keys = lambda p: {k: p.get(k) for k in ("RODOVIA", "KM INICIAL", "KM FINAL")}
    camadas = {
        "municipios": limpa(malha_fina, lambda p: {"cod": p.get("codarea"), "nome": nomes_ibge.get(p.get("codarea"))}),
        "rodovias": limpa(atlas("RODOVIAS_ESTADUAIS_AMAZONAS.geojson"), rod_keys),
        "federais": limpa(atlas("RODOVIAS_FEDERAIS.geojson"), lambda p: {"br": p.get("Codigo_BR")}),
        "ramais": limpa(atlas("RAMAIS_SEINFRA.geojson"), lambda p: {}),
        "hidrovias": limpa(atlas("HIDROVIAS.geojson"), lambda p: {}),
    }
    with tempfile.TemporaryDirectory() as tmp:
        args = [tip, "-o", saida, "--force", "-Z4", "-z11", "--no-tile-size-limit", "--detect-shared-borders",
                "--name", "DMOB Hub - mapa do Amazonas",
                "--attribution", "IBGE; Atlas Amazonas (SEINFRA-AM, DNIT/SNV, ANTAQ)"]
        for nome, fc in camadas.items():
            p = os.path.join(tmp, nome + ".geojson")
            json.dump(fc, open(p, "w", encoding="utf-8"))
            args += ["-L", f"{nome}:{p}"]
        subprocess.run(args, check=True)
    print(f"pmtiles: {os.path.getsize(saida) / 1e6:.1f} MB")


# ── principal ─────────────────────────────────────────────────────────────────
def main(tiles=False):
    ler = lambda n: json.load(open(os.path.join(DATA, n), encoding="utf-8"))
    eobras, analise, sinistros, icm = ler("eobras.json"), ler("sinistros_analise.json"), ler("sinistros.json"), ler("icm.json")

    nomes_ibge = {str(m["id"]): m["nome"] for m in baixar(IBGE_NOMES)}
    serie = baixar(SIDRA_POP)[0]["resultados"][0]["series"]
    ano_pop = max(serie[0]["serie"])
    pop = {s["localidade"]["id"]: int(s["serie"][ano_pop]) for s in serie if s["serie"].get(ano_pop, "").isdigit()}
    assert len(nomes_ibge) == 62 and len(pop) == 62, (len(nomes_ibge), len(pop))

    M, sem = gerar_municipios(eobras, analise, nomes_ibge, pop, ano_pop)
    meta_mun = {"fonte": f"IBGE (malhas v3, localidades v1, SIDRA tabela 6579 var. 9324 – estimativa {ano_pop}); data/eobras.json; data/sinistros_analise.json",
                "url": SIDRA_POP, "gerado_em": agora(), "gerador": "pipelines/mapa/gerar.py", "ano_populacao": ano_pop,
                "metodologia": "Contrato com vários municípios conta 1 em cada e tem o valor rateado em partes iguais. "
                               "Valor contratado = valor atual (original + aditivos); medido = soma das medições (e-Obras). "
                               "Ativo = Andamento, Vigente, A Iniciar ou Em recebimento. R$/hab = valor contratado / população estimada. "
                               "Sinistros = ocorrências em rodovias estaduais por município (notícias; ver módulo Sinistros).",
                "nao_casados": sem}
    json.dump({"_meta": meta_mun, "municipios": M}, open(os.path.join(DATA, "mapa_municipios.json"), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))

    malha = baixar(IBGE_MALHA.format(q="minima"))
    assert len(malha["features"]) == 62
    leve = limpa(malha, lambda p: {"cod": p.get("codarea"), "nome": nomes_ibge.get(p.get("codarea"))})
    leve["_meta"] = {"fonte": "IBGE, API de malhas v3, qualidade mínima", "url": IBGE_MALHA.format(q="minima"), "gerado_em": agora(),
                     "metodologia": "Polígonos dos 62 municípios do AM; propriedades cod (IBGE) e nome."}
    json.dump(leve, open(os.path.join(DATA, "mapa_malha.geojson"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    obras = obras_por_rodovia(eobras)
    feats = gerar_trechos(icm, sinistros, obras)
    meta_tr = {"fonte": f"data/icm.json ({icm.get('fonte')}, {icm.get('gerado_em')}); data/sinistros.json; data/eobras.json",
               "url": "https://leonzordhue.github.io/seinfra-hub/data/icm.json", "gerado_em": agora(), "gerador": "pipelines/mapa/gerar.py",
               "metodologia": "Intervalos do levantamento RoadLab agrupados a cada 1 km pela distância acumulada desde o início do levantamento "
                              "(pode diferir do marco quilométrico oficial). IRI = média ponderada pela extensão dos intervalos medidos. "
                              "Classe: DNIT IPR-720/2006 (excelente <= 1,9; bom <= 2,7; regular <= 3,5; ruim <= 4,6; péssimo > 4,6 m/km). "
                              "Sinistros = ocorrências com km informado na notícia, contadas no km inteiro. "
                              "Obras = contratos ativos da rodovia (rodovia citada só como localização não conta).",
               "obras_por_rodovia": {k: sorted(v) for k, v in sorted(obras.items())}}
    json.dump({"type": "FeatureCollection", "_meta": meta_tr, "features": feats},
              open(os.path.join(DATA, "mapa_trechos.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    print(f"municípios: 62 · população {ano_pop}: {sum(pop.values()):,} · não casados: {sem}")
    print(f"trechos: {len(feats)} · com IRI: {sum(f['properties']['iri'] is not None for f in feats)} · com sinistro: {sum(f['properties']['sinistros'] > 0 for f in feats)}")
    if tiles:
        gerar_tiles(baixar(IBGE_MALHA.format(q="intermediaria")), nomes_ibge, os.path.join(DATA, "mapa.pmtiles"))


def teste():
    assert classe_iri(None) == "Sem medição"
    assert classe_iri(1.9) == "Excelente" and classe_iri(2.7) == "Bom" and classe_iri(2.71) == "Regular"
    assert classe_iri(3.5) == "Regular" and classe_iri(4.6) == "Ruim" and classe_iri(4.61) == "Péssimo"
    assert municipios("Itacoatiara, Manaus e Rio Preto da Eva") == ["Itacoatiara", "Manaus", "Rio Preto da Eva"]
    assert chave("São Gabriel  da Cachoeira") == "sao gabriel da cachoeira"
    assert 1100 < dist_m(-3.0, -60.0, -3.01, -60.0) < 1120
    nomes = {"1": "Manaus", "2": "Iranduba"}
    eo = {"ct": {"a": {"mun": "Manaus, Iranduba", "v_atual": 100, "medido": 40, "sit": "Andamento"},
                 "b": {"mun": "Manaus", "v_atual": 50, "medido": 0, "sit": "Paralisado"},
                 "c": {"mun": "Lugar Nenhum", "v_atual": 1, "sit": "Concluído"}}}
    M, sem = gerar_municipios(eo, {"por_municipio": {"Manaus": 3}}, nomes, {"1": 10, "2": 0}, "2026")
    assert M["1"] == {"nome": "Manaus", "pop": 10, "contratos": 2, "v_contratado": 100.0, "v_medido": 20.0,
                      "ativos": 1, "paralisados": 1, "sinistros": 3, "r_hab": 10.0}, M["1"]
    assert M["2"]["v_contratado"] == 50.0 and M["2"]["r_hab"] is None and sem == {"Lugar Nenhum": 1}
    icm = {"rodovias": [{"codigo": "AM-001", "segments": json.dumps(
        [[-3.0, -60.0, -3.005, -60.0, 2.0, 1], [-3.005, -60.0, -3.01, -60.0, 4.0, 3], [-3.01, -60.0, -3.015, -60.0, None, 5]])}]}
    sin = {"ocorrencias": [{"rodovia": "AM-001", "km": "0,5", "fatal": True}, {"rodovia": "AM-001", "km": None}]}
    fs = gerar_trechos(icm, sin, {"AM-001": ["CT-1"]})
    assert [f["properties"]["km"] for f in fs] == [0, 1], fs
    p0 = fs[0]["properties"]
    assert p0["iri"] == 3.0 and p0["classe"] == "Regular" and p0["sinistros"] == 1 and p0["fatais"] == 1 and p0["obras"] == 1, p0
    assert fs[0]["geometry"]["coordinates"] == [[[-60.0, -3.0], [-60.0, -3.005], [-60.0, -3.01]]]
    assert fs[1]["properties"]["classe"] == "Sem medição"
    print("teste ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiles", action="store_true", help="gera data/mapa.pmtiles (precisa do tippecanoe)")
    ap.add_argument("--teste", action="store_true")
    a = ap.parse_args()
    teste() if a.teste else main(a.tiles)
