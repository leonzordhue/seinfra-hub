"""Acessibilidade rodoviária das sedes municipais do Amazonas. [Claude] 23/11/2026.

Tempo de viagem por estrada (OSRM, perfil car) de cada sede até Manaus, até o hospital mais próximo e até o
terminal flutuante mais próximo, e isócronas de 1 h, 2 h e 4 h a partir de Manaus e das sedes.

Fontes (públicas, sem login):
- Malha viária: OpenStreetMap, extrato Geofabrik south-america/brazil/norte (ODbL).
- Roteamento: OSRM v5.27.1 (Project-OSRM), perfil car.lua com dois ajustes (ver perfil()).
- Sedes: kelvins/municipios-brasileiros (coordenadas das sedes, base IBGE), código IBGE de 7 dígitos.
- População: IBGE, Censo 2022, SIDRA tabela 4709, variável 93 (população residente).
- Hospitais: CNES/DATASUS, API de dados abertos do Ministério da Saúde (tipo 5 hospital geral, 7 hospital
  especializado, 15 unidade mista), mais OSM amenity=hospital onde o CNES não tem ponto a menos de 300 m.
- Terminais: SEINFRA-AM, TERMINAIS_FLUTUANTES_SEINFRA.geojson (atlas-amazonas).

Etapas (o pesado roda só no GitHub Actions, ver .github/workflows/acesso.yml):
  python -I acesso.py preparar --pbf am_vias.osm.pbf --saida am_osrm.osm.pbf --trab w
      tira balsas longas (> BALSA_MAX_KM, são linhas fluviais e não travessias), extrai os nós de via
      por célula da grade (isócronas) e os hospitais do OSM.
  python -I acesso.py perfil car.lua car_am.lua      inclui highway=track (ramal) no perfil car.
  python -I acesso.py calcular --osrm http://localhost:5000 --trab w      gera data/acesso*.
  python -I acesso.py --teste [--demo]      asserts offline; --demo roda 3 sedes no OSRM público.
"""
import argparse, csv, io, json, math, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(BASE_DIR, "..", ".."))
DATA = os.path.join(RAIZ, "data")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

URL_SEDES = "https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv/municipios.csv"
URL_POP = "https://apisidra.ibge.gov.br/values/t/4709/n6/in%20n3%2013/v/93/p/last"
URL_CNES = "https://apidadosabertos.saude.gov.br/cnes/estabelecimentos?codigo_uf=13&codigo_tipo_unidade={t}&limit=20&offset={p}"
URL_TERM = "https://leonzordhue.github.io/atlas-amazonas/geojson/TERMINAIS_FLUTUANTES_SEINFRA.geojson"
URL_OSM = "https://download.geofabrik.de/south-america/brazil/norte-latest.osm.pbf"
OSRM_DEMO = "https://router.project-osrm.org"
TIPOS_CNES = {5: "Hospital geral", 7: "Hospital especializado", 15: "Unidade mista"}  # tabela de tipos de unidade do CNES
COD_MANAUS = "1302603"
BBOX = (-74.5, -11.5, -53.5, 3.0)   # AM e vizinhos: a BR-319 passa por RO e Boca do Acre se liga pelo AC
CEL = 0.05                          # grade das isócronas, em graus (~5,5 km no Equador)
FAIXAS = (60, 120, 240)             # minutos
BALSA_MAX_KM = 25                   # route=ferry acima disso é linha fluvial, não travessia de balsa
SNAP_MAX_M = 3000                   # sede/hospital a mais de 3 km da via mais próxima: sem acesso por estrada no OSM
VEL_URBANA = 20                     # km/h, só para o fallback em linha reta dentro da cidade (ver hosp_mais_proximo)
ROTA_TOL = 0.0015                   # graus (~165 m): simplificação do traçado das rotas no mapa
# Classes de via do car.lua (OSRM v5.27.1) + track, que o perfil ajustado aceita (ramais no OSM)
VIAS = {"motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
        "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "service", "track"}
UA = {"User-Agent": "Mozilla/5.0 (DMOB Hub)"}


def get(url, timeout=120, tentativas=4):
    for t in range(tentativas):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception as e:
            if t == tentativas - 1:
                raise
            print(f"  rede: {str(e)[:80]}; nova tentativa", flush=True)
            time.sleep(5 * (t + 1))


def hav_km(la1, lo1, la2, lo2):
    """Distância em linha reta (fórmula de haversine, raio médio da Terra 6371 km)."""
    p = math.pi / 180
    a = math.sin((la2 - la1) * p / 2) ** 2 + math.cos(la1 * p) * math.cos(la2 * p) * math.sin((lo2 - lo1) * p / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(a))


def chave(lat, lon):
    return math.floor(lat / CEL), math.floor(lon / CEL)


def no_am(lat, lon):
    return lat and lon and BBOX[1] <= lat <= BBOX[3] and BBOX[0] <= lon <= BBOX[2]


# ── preparar: uma passada no pbf já filtrado (osmium tags-filter) ───────────────────────────────────────────
def preparar(pbf_in, pbf_out, trab):
    import osmium
    os.makedirs(trab, exist_ok=True)
    celulas, hosp, balsas, nos = {}, [], [], 0
    with osmium.SimpleWriter(pbf_out, overwrite=True) as w:
        for o in osmium.FileProcessor(pbf_in).with_locations():
            if o.is_node():
                nos += 1
                if o.tags.get("amenity") == "hospital":
                    hosp.append({"nome": o.tags.get("name", "Hospital (sem nome no OSM)"), "lat": o.location.lat, "lon": o.location.lon})
                w.add_node(o)
            elif o.is_way():
                t = o.tags
                pts = [(n.lat, n.lon) for n in o.nodes if n.location.valid()]
                if t.get("route") == "ferry":
                    km = sum(hav_km(*pts[i], *pts[i + 1]) for i in range(len(pts) - 1))
                    if km > BALSA_MAX_KM:
                        balsas.append({"id": o.id, "nome": t.get("name", ""), "km": round(km, 1)})
                        continue
                if t.get("highway") in VIAS and t.get("access") not in ("no", "private"):
                    for la, lo in pts:
                        celulas.setdefault(chave(la, lo), (round(la, 6), round(lo, 6)))
                if t.get("amenity") == "hospital" and pts:
                    hosp.append({"nome": t.get("name", "Hospital (sem nome no OSM)"),
                                 "lat": sum(p[0] for p in pts) / len(pts), "lon": sum(p[1] for p in pts) / len(pts)})
                w.add_way(o)
            else:
                w.add_relation(o)
    json.dump([[k[0], k[1], v[0], v[1]] for k, v in celulas.items()], open(os.path.join(trab, "celulas.json"), "w"))
    json.dump(hosp, open(os.path.join(trab, "hospitais_osm.json"), "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(balsas, open(os.path.join(trab, "balsas_longas.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print(f"preparar: {nos} nós, {len(celulas)} células com via, {len(hosp)} hospitais OSM, {len(balsas)} linhas fluviais removidas")
    return len(celulas), len(hosp), len(balsas)


def perfil(lua_in, lua_out):
    """car.lua v5.27.1 + highway=track a 15 km/h (mesma velocidade de service). No AM boa parte dos ramais
    está no OSM como track; sem isso o OSRM ignora a via. tracktype_speeds do próprio perfil ainda limita."""
    txt = open(lua_in, encoding="utf-8").read()
    velho = "        service         = 15\n"
    assert txt.count(velho) == 1, "car.lua mudou: revise o ajuste de track"
    open(lua_out, "w", encoding="utf-8").write(txt.replace(velho, "        service         = 15,\n        track           = 15\n"))
    print("perfil: track = 15 km/h incluído")


# ── fontes ──────────────────────────────────────────────────────────────────────────────────────────────
def sedes():
    ls = csv.DictReader(io.StringIO(get(URL_SEDES).decode("utf-8")))
    r = [{"cod": l["codigo_ibge"], "nome": l["nome"], "lat": float(l["latitude"]), "lon": float(l["longitude"])} for l in ls if l["codigo_uf"] == "13"]
    assert len(r) == 62, f"AM tem 62 municípios, veio {len(r)}"
    return r


def populacao():
    d = json.loads(get(URL_POP))[1:]
    return {x["D1C"]: int(x["V"]) for x in d if x["V"].isdigit()}, d[0]["D3N"]


def hospitais_cnes():
    r = []
    for t, rot in TIPOS_CNES.items():
        for p in range(200):
            d = json.loads(get(URL_CNES.format(t=t, p=p)))["estabelecimentos"]
            for e in d:
                la, lo = e.get("latitude_estabelecimento_decimo_grau"), e.get("longitude_estabelecimento_decimo_grau")
                if e.get("codigo_motivo_desabilitacao_estabelecimento") or not no_am(la, lo):
                    continue
                r.append({"nome": (e.get("nome_fantasia") or e.get("nome_razao_social") or "").strip(), "tipo": rot,
                          "cnes": e["codigo_cnes"], "lat": la, "lon": lo, "fonte": "CNES"})
            if len(d) < 20:
                break
            time.sleep(0.3)
    return r


def juntar_hospitais(cnes, osm):
    r = list(cnes)
    for h in osm:
        if no_am(h["lat"], h["lon"]) and all(hav_km(h["lat"], h["lon"], c["lat"], c["lon"]) > 0.3 for c in cnes):
            r.append({**h, "tipo": "Hospital (OSM)", "fonte": "OSM"})
    return r


def terminais():
    fs = json.loads(get(URL_TERM))["features"]
    return [{"nome": f"{f['properties'].get('Localidade', '').title()} ({f['properties'].get('Destino', '')})",
             "lat": f["geometry"]["coordinates"][1], "lon": f["geometry"]["coordinates"][0]} for f in fs]


# ── OSRM ────────────────────────────────────────────────────────────────────────────────────────────────
def tabela(osrm, orig, dest, lote=150, pausa=0.0):
    """Matriz origem×destino pelo serviço /table do OSRM. Devolve (min, km, snap_orig_m, snap_dest_m);
    None onde não há rota. snap = distância do ponto até a via onde o OSRM o encaixou."""
    dur = [[None] * len(dest) for _ in orig]
    km = [[None] * len(dest) for _ in orig]
    so, sd = [None] * len(orig), [None] * len(dest)
    for i0 in range(0, len(dest), lote):
        ch = dest[i0:i0 + lote]
        coords = ";".join(f"{lo:.5f},{la:.5f}" for la, lo in orig + ch)   # lote 150 mantém a URL abaixo de ~8 KB
        q = urllib.parse.urlencode({"sources": ";".join(map(str, range(len(orig)))),
                                    "destinations": ";".join(map(str, range(len(orig), len(orig) + len(ch)))),
                                    "annotations": "duration,distance"})
        r = json.loads(get(f"{osrm}/table/v1/driving/{coords}?{q}", timeout=600))
        assert r.get("code") == "Ok", r.get("message")
        for i in range(len(orig)):
            so[i] = r["sources"][i]["distance"]
            for j in range(len(ch)):
                d, m = r["durations"][i][j], r["distances"][i][j]
                dur[i][i0 + j] = None if d is None else d / 60
                km[i][i0 + j] = None if m is None else m / 1000
        for j in range(len(ch)):
            sd[i0 + j] = r["destinations"][j]["distance"]
        if pausa:
            time.sleep(pausa)
    return dur, km, so, sd


def simplificar(coords, tol=ROTA_TOL):
    """Linha [lon, lat] simplificada (Douglas-Peucker, shapely) e arredondada a 4 casas (~11 m), para o mapa."""
    if len(coords) < 3:
        return [[round(x, 4), round(y, 4)] for x, y in coords]
    from shapely.geometry import LineString
    return [[round(x, 4), round(y, 4)] for x, y in LineString(coords).simplify(tol, preserve_topology=False).coords]


def rota(osrm, a, b):
    """Rota a→b do OSRM: (usa balsa?, traçado [lon, lat], trechos de balsa). None se não houver rota.
    [Claude] 25/11/2026: o traçado vai para data/acesso_rotas.geojson (mapa do painel)."""
    r = json.loads(get(f"{osrm}/route/v1/driving/{a[1]:.6f},{a[0]:.6f};{b[1]:.6f},{b[0]:.6f}?overview=full&geometries=geojson&steps=true"))
    if r.get("code") != "Ok":
        return None
    steps = [s for leg in r["routes"][0]["legs"] for s in leg["steps"]]
    balsas = [simplificar(s["geometry"]["coordinates"]) for s in steps if s.get("mode") == "ferry" and len(s["geometry"]["coordinates"]) > 1]
    return bool(balsas), simplificar(r["routes"][0]["geometry"]["coordinates"]), balsas


def feicao(m, destino, alvo, tracado, balsas):
    """Linha da rota para o GeoJSON; os trechos de balsa vão juntos para o mapa desenhá-los tracejados."""
    return {"type": "Feature", "properties": {"cod": m["cod"], "nome": m["nome"], "destino": destino, "alvo": alvo.get("nome"),
                                              "min": alvo.get("min"), "km": alvo.get("km"), "balsas": balsas},
            "geometry": {"type": "LineString", "coordinates": tracado}}


def mais_proximo(sede, alvos, dur, km, snap_s, snap_d, i):
    """Alvo (hospital/terminal) de menor tempo por estrada. Sem rota, aceita alvo a até 3 km em linha reta
    (sede sem malha urbana no OSM) com tempo estimado a VEL_URBANA e marca estimado=True."""
    melhor, com_rota = None, set()
    if snap_s[i] is not None and snap_s[i] <= SNAP_MAX_M:
        for j, a in enumerate(alvos):
            if dur[i][j] is not None and snap_d[j] <= SNAP_MAX_M:
                com_rota.add(j)
                if melhor is None or dur[i][j] < melhor["min"]:
                    melhor = {"nome": a["nome"], "tipo": a.get("tipo"), "fonte": a.get("fonte"), "min": round(dur[i][j]), "km": round(km[i][j], 1), "estimado": False,
                              "lat": a["lat"], "lon": a["lon"]}
    for j, a in enumerate(alvos):   # estimativa só para alvo que o OSRM não alcançou
        lr = hav_km(sede["lat"], sede["lon"], a["lat"], a["lon"])
        m = lr * 1.3 / VEL_URBANA * 60   # 1,3 = fator de sinuosidade usual em malha urbana
        if j not in com_rota and lr <= 3 and (melhor is None or m < melhor["min"]):
            melhor = {"nome": a["nome"], "tipo": a.get("tipo"), "fonte": a.get("fonte"), "min": round(m), "km": round(lr * 1.3, 1), "estimado": True,
                      "lat": a["lat"], "lon": a["lon"]}
    if melhor is None:   # sem estrada: guarda o mais perto em linha reta, sem tempo
        j = min(range(len(alvos)), key=lambda j: hav_km(sede["lat"], sede["lon"], alvos[j]["lat"], alvos[j]["lon"]))
        melhor = {"nome": alvos[j]["nome"], "tipo": alvos[j].get("tipo"), "fonte": alvos[j].get("fonte"), "min": None,
                  "km_linha_reta": round(hav_km(sede["lat"], sede["lon"], alvos[j]["lat"], alvos[j]["lon"]), 1),
                  "lat": alvos[j]["lat"], "lon": alvos[j]["lon"]}
    return melhor


def ligado(snap_o, snap_d, km_rota, km_reta):
    """Rota válida: os dois pontos encaixam numa via a até 3 km e a rota não é menor que a linha reta
    (descarta encaixe em componente distante, que o OSRM faz quando a malha local é pequena)."""
    return km_rota is not None and snap_o <= SNAP_MAX_M and snap_d <= SNAP_MAX_M and km_rota >= 0.95 * km_reta


def isocronas(cels, tempos_manaus, tempos_sede):
    from shapely.geometry import box, mapping
    from shapely.ops import unary_union
    fs = []
    for origem, ts in (("Manaus", tempos_manaus), ("Sede municipal mais próxima", tempos_sede)):
        for lim in FAIXAS:
            cx = [box(c[1] * CEL, c[0] * CEL, (c[1] + 1) * CEL, (c[0] + 1) * CEL) for c, t in zip(cels, ts) if t is not None and t <= lim]
            if not cx:
                continue
            g = unary_union(cx).simplify(CEL / 4, preserve_topology=True)
            fs.append({"type": "Feature", "properties": {"origem": origem, "ate_min": lim, "celulas": len(cx)},
                       "geometry": json.loads(json.dumps(mapping(g)), parse_float=lambda x: round(float(x), 4))})
    return {"type": "FeatureCollection", "features": fs}


def calcular(osrm, trab, saida=DATA, so=None, lote=150, pausa=0.0, cels=None):
    S = sedes()
    if so:
        S = [s for s in S if s["cod"] in so]
    pop, ano_pop = populacao()
    hosp_osm = json.load(open(os.path.join(trab, "hospitais_osm.json"), encoding="utf-8")) if os.path.exists(os.path.join(trab, "hospitais_osm.json")) else []
    H = juntar_hospitais(hospitais_cnes(), hosp_osm)
    T = terminais()
    if cels is None:
        cels = json.load(open(os.path.join(trab, "celulas.json")))
    print(f"{len(S)} sedes, {len(H)} hospitais ({sum(h['fonte'] == 'OSM' for h in H)} só OSM), {len(T)} terminais, {len(cels)} células", flush=True)
    P = [(s["lat"], s["lon"]) for s in S]
    iM = next(i for i, s in enumerate(S) if s["cod"] == COD_MANAUS)

    dm, km_m, so_s, sd_m = tabela(osrm, P, [P[iM]], lote, pausa)
    dh, kh, _, sd_h = tabela(osrm, P, [(h["lat"], h["lon"]) for h in H], lote, pausa)
    dt_, kt, _, sd_t = tabela(osrm, P, [(t["lat"], t["lon"]) for t in T], lote, pausa)
    dc, _, _, sd_c = tabela(osrm, P, [(c[2], c[3]) for c in cels], lote, pausa)

    mun, rotas = [], []
    for i, s in enumerate(S):
        reta = hav_km(s["lat"], s["lon"], *P[iM])
        lig = i == iM or ligado(so_s[i], sd_m[0], km_m[i][0], reta)
        m = {"cod": s["cod"], "nome": s["nome"], "lat": s["lat"], "lon": s["lon"], "pop": pop.get(s["cod"]),
             "ligacao_rodoviaria": lig, "travessia_balsa": False,
             "tempo_manaus_min": round(dm[i][0]) if lig else None, "km_manaus": round(km_m[i][0], 1) if lig else None,
             "km_linha_reta_manaus": round(reta, 1), "encaixe_via_m": round(so_s[i]) if so_s[i] is not None else None,
             "hospital_mais_proximo": mais_proximo(s, H, dh, kh, so_s, sd_h, i),
             "terminal_mais_proximo": mais_proximo(s, T, dt_, kt, so_s, sd_t, i)}
        if lig and i != iM:
            r = rota(osrm, P[i], P[iM])
            if r:
                m["travessia_balsa"] = r[0]
                rotas.append(feicao(m, "Manaus", {"nome": "Manaus", "min": m["tempo_manaus_min"], "km": m["km_manaus"]}, r[1], r[2]))
            if pausa:
                time.sleep(pausa)
        # rota até hospital e terminal só quando o tempo veio do OSRM (estimado = linha reta, sem traçado)
        for destino, alvo in (("Hospital", m["hospital_mais_proximo"]), ("Terminal", m["terminal_mais_proximo"])):
            if alvo.get("min") is not None and not alvo.get("estimado"):
                r = rota(osrm, P[i], (alvo["lat"], alvo["lon"]))
                if r and len(r[1]) > 1:
                    rotas.append(feicao(m, destino, alvo, r[1], r[2]))
                if pausa:
                    time.sleep(pausa)
        mun.append(m)

    # isócronas: célula conta se o nó de via encaixou (sempre, é nó do OSM) e há rota a partir de sede encaixada
    ok_s = [so_s[i] is not None and so_s[i] <= SNAP_MAX_M for i in range(len(S))]
    cel_k = [(c[0], c[1]) for c in cels]
    tm = [dc[iM][j] if ok_s[iM] and sd_c[j] <= SNAP_MAX_M else None for j in range(len(cels))]
    ts = [min((dc[i][j] for i in range(len(S)) if ok_s[i] and dc[i][j] is not None), default=None) if sd_c[j] <= SNAP_MAX_M else None for j in range(len(cels))]
    geo = isocronas(cel_k, tm, ts)

    tot = sum(m["pop"] or 0 for m in mun)
    resumo = {"municipios": len(mun), "com_ligacao": sum(m["ligacao_rodoviaria"] for m in mun),
              "com_ligacao_via_balsa": sum(bool(m["travessia_balsa"]) for m in mun),
              "pop_total": tot, "ano_pop": ano_pop,
              "pop_sem_ligacao": sum(m["pop"] or 0 for m in mun if not m["ligacao_rodoviaria"]),
              "pop_manaus_ate_min": {str(l): sum(m["pop"] or 0 for m in mun if m["tempo_manaus_min"] is not None and m["tempo_manaus_min"] <= l) for l in FAIXAS},
              "pop_hospital_ate_120": sum(m["pop"] or 0 for m in mun if (m["hospital_mais_proximo"].get("min") is not None and m["hospital_mais_proximo"]["min"] <= 120)),
              "hospitais": len(H), "terminais": len(T), "celulas_grade": len(cels)}
    meta = {
        "fonte": "OpenStreetMap (Geofabrik, extrato norte do Brasil) roteado com OSRM 5.27.1; sedes kelvins/municipios-brasileiros (IBGE); "
                 f"população IBGE Censo {ano_pop} (SIDRA 4709); hospitais CNES/DATASUS (API dados abertos) + OSM amenity=hospital; "
                 "terminais flutuantes SEINFRA-AM (atlas-amazonas)",
        "url": {"osm": URL_OSM, "sedes": URL_SEDES, "populacao": URL_POP, "cnes": URL_CNES.split("?")[0], "terminais": URL_TERM,
                "osrm": "https://github.com/Project-OSRM/osrm-backend"},
        "gerado_em": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "servidor_osrm": "demo público (teste)" if osrm == OSRM_DEMO else "OSRM local no GitHub Actions",
        "metodologia": {
            "tempo": "Duração do OSRM (perfil car.lua: velocidade por classe de via, maxspeed e superfície do OSM; track incluído a 15 km/h). É tempo de fluxo livre: sem trânsito, chuva ou atoleiro.",
            "ligacao_rodoviaria": f"Há rota OSRM sede→Manaus, sede e Manaus a até {SNAP_MAX_M} m de uma via e rota não menor que 95% da linha reta. Travessias de balsa até {BALSA_MAX_KM} km contam (a balsa Manaus–Careiro é parte da BR-319); linhas fluviais mais longas foram retiradas da malha.",
            "balsa": "Trecho de balsa no OSRM: duration do OSM ou 5 km/h. Espera, horário e fila não entram.",
            "hospital": "Menor tempo por estrada até hospital geral, especializado ou unidade mista do CNES (ativo, com coordenada) ou hospital do OSM. Sede sem malha no OSM: hospital a até 3 km em linha reta, tempo estimado a 20 km/h com fator 1,3 (estimado=true).",
            "isocronas": f"Grade de {CEL}° (~5,5 km); cada célula com via recebe o tempo do primeiro nó de via do OSM nela. Faixas cumulativas de {', '.join(str(f) for f in FAIXAS)} min a partir de Manaus e da sede mais próxima. Polígono = união das células, simplificado.",
            "populacao_por_faixa": "População do município inteiro atribuída ao tempo da sede (Censo 2022). Aproximação: ignora quem mora fora da sede (zona rural, comunidades ribeirinhas).",
        },
        "limitacoes": [
            "Malha do OSM incompleta nos ramais e nas vias urbanas do interior: falta de via vira 'sem ligação' ou tempo maior.",
            "Tempo de espera de balsa não incluído; trechos fluviais acima de 25 km não contam como ligação rodoviária.",
            "BR-319 (trecho do meio) e ramais de terra podem estar intransitáveis na cheia; o OSRM não sabe disso.",
            "Coordenada do CNES vem do cadastro da unidade e pode estar errada; hospital do OSM pode estar desatualizado.",
            "Coordenada da sede é um ponto (praça/prefeitura), não o centro populacional.",
        ],
        "balsas_longas_removidas": len(json.load(open(os.path.join(trab, "balsas_longas.json"), encoding="utf-8"))) if os.path.exists(os.path.join(trab, "balsas_longas.json")) else None,
    }
    os.makedirs(saida, exist_ok=True)
    out = {"_meta": meta, "resumo": resumo, "municipios": sorted(mun, key=lambda m: m["nome"])}
    json.dump(out, open(os.path.join(saida, "acesso.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    geo["_meta"] = {k: meta[k] for k in ("fonte", "gerado_em")} | {"metodologia": meta["metodologia"]["isocronas"]}
    gs = json.dumps(geo, ensure_ascii=False, separators=(",", ":"))
    assert len(gs) < 2_000_000, f"isócronas com {len(gs)} bytes; aumente a simplificação"
    open(os.path.join(saida, "acesso_isocronas.geojson"), "w", encoding="utf-8").write(gs)
    rg = {"type": "FeatureCollection", "features": rotas,
          "_meta": {k: meta[k] for k in ("fonte", "gerado_em")} | {"metodologia": f"Traçado da rota mais rápida do OSRM (overview full), simplificado a {ROTA_TOL}° (~165 m). Trechos com mode=ferry em 'balsas'."}}
    rs = json.dumps(rg, ensure_ascii=False, separators=(",", ":"))
    assert len(rs) < 3_000_000, f"rotas com {len(rs)} bytes; aumente ROTA_TOL"
    open(os.path.join(saida, "acesso_rotas.geojson"), "w", encoding="utf-8").write(rs)
    print(f"ok: {resumo['com_ligacao']}/{resumo['municipios']} com ligação; isócronas {len(gs) // 1024} KB; {len(rotas)} rotas {len(rs) // 1024} KB")
    return out


# ── testes ──────────────────────────────────────────────────────────────────────────────────────────────
OSM_TESTE = """<?xml version='1.0' encoding='UTF-8'?><osm version="0.6">
<node id="1" lat="-3.02" lon="-60.02"/><node id="2" lat="-3.11" lon="-60.03"/>
<node id="3" lat="-3.20" lon="-60.10"/><node id="4" lat="-3.60" lon="-60.50"/>
<node id="5" lat="-3.13" lon="-60.02"><tag k="amenity" v="hospital"/><tag k="name" v="H Teste"/></node>
<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="track"/></way>
<way id="11"><nd ref="2"/><nd ref="3"/><tag k="route" v="ferry"/></way>
<way id="12"><nd ref="3"/><nd ref="4"/><tag k="route" v="ferry"/></way>
</osm>"""


def teste(demo=False):
    import tempfile
    assert abs(hav_km(-3.11866, -60.0212, -3.1429, -58.4442) - 175) < 5   # Manaus–Itacoatiara ~175 km em linha reta
    assert chave(-3.11, -60.02) == (-63, -1201)
    assert ligado(10, 0, 270, 175) and not ligado(10, 0, 100, 175) and not ligado(5000, 0, 270, 175) and not ligado(10, 0, None, 1)
    g = isocronas([(-63, -1201), (-63, -1200), (-62, -1201)], [30, 90, None], [0, 0, 200])
    assert [(f["properties"]["origem"], f["properties"]["ate_min"], f["properties"]["celulas"]) for f in g["features"]] == \
        [("Manaus", 60, 1), ("Manaus", 120, 2), ("Manaus", 240, 2), ("Sede municipal mais próxima", 60, 2),
         ("Sede municipal mais próxima", 120, 2), ("Sede municipal mais próxima", 240, 3)]
    s = {"lat": -3.1, "lon": -60.0}
    a = [{"nome": "A", "lat": -3.1, "lon": -60.01}, {"nome": "B", "lat": -5, "lon": -60}]
    r = mais_proximo(s, a, [[None, 50]], [[None, 40]], [100], [0, 0], 0)
    assert r["nome"] == "A" and r["estimado"], r                  # A sem rota, a 1,1 km em linha reta, ganha de B por estrada
    r = mais_proximo(s, a, [[10, 50]], [[5, 40]], [100], [0, 0], 0)
    assert r["nome"] == "A" and not r["estimado"] and r["min"] == 10   # com rota, vale o tempo do OSRM
    r = mais_proximo(s, a, [[None, None]], [[None, None]], [9000], [0, 0], 0)
    assert r["nome"] == "A" and r["estimado"]
    r = mais_proximo({"lat": 0, "lon": -65}, a, [[None, None]], [[None, None]], [9000], [0, 0], 0)
    assert r["min"] is None and r["nome"] == "A"
    assert len(juntar_hospitais([{"nome": "C", "lat": -3.1, "lon": -60}], [{"nome": "o", "lat": -3.1005, "lon": -60}, {"nome": "p", "lat": -3.2, "lon": -60}])) == 2
    assert r["lat"] == -3.1 and r["lon"] == -60.01   # alvo leva a coordenada (marcador no mapa)
    assert simplificar([[-60.0, -3.0], [-59.5, -3.00001], [-59.0, -3.0]]) == [[-60.0, -3.0], [-59.0, -3.0]]   # ponto colinear sai
    assert simplificar([[-60.123456, -3.0], [-59.0, -3.0]]) == [[-60.1235, -3.0], [-59.0, -3.0]]
    f = feicao({"cod": "1", "nome": "X"}, "Hospital", {"nome": "H", "min": 5, "km": 2.0}, [[0, 0], [1, 1]], [])
    assert f["properties"]["destino"] == "Hospital" and f["geometry"]["type"] == "LineString"
    try:
        import osmium  # noqa: F401
        with tempfile.TemporaryDirectory() as d:
            f = os.path.join(d, "t.osm")
            open(f, "w", encoding="utf-8").write(OSM_TESTE)
            assert preparar(f, os.path.join(d, "o.osm.pbf"), d) == (2, 1, 1)   # 2 células do track, 1 hospital, balsa de ~57 km removida
    except ImportError:
        print("pyosmium ausente: teste de preparar pulado")
    print("teste offline ok")
    if demo:
        with tempfile.TemporaryDirectory() as d:
            for n in ("hospitais_osm.json", "balsas_longas.json"):
                json.dump([], open(os.path.join(d, n), "w"))
            # células sintéticas ao redor de Manaus: poucas, para não pesar no servidor público
            cels = [[*chave(-3.1 + a * 0.3, -60.0 + b * 0.3), -3.1 + a * 0.3, -60.0 + b * 0.3] for a in (-1, 0, 1) for b in (-1, 0, 1)]
            out = calcular(OSRM_DEMO, d, saida=os.path.join(tempfile.gettempdir(), "acesso_demo"), so={COD_MANAUS, "1301902", "1304203"}, lote=60, pausa=1.5, cels=cels)
        m = {x["nome"]: x for x in out["municipios"]}
        print({k: (v["ligacao_rodoviaria"], v["tempo_manaus_min"], v["km_manaus"], v["travessia_balsa"], v["hospital_mais_proximo"]["min"]) for k, v in m.items()})
        assert m["Manaus"]["tempo_manaus_min"] == 0 and m["Itacoatiara"]["ligacao_rodoviaria"] and 120 < m["Itacoatiara"]["tempo_manaus_min"] < 400
        assert not m["Tefé"]["ligacao_rodoviaria"], "Tefé não tem estrada até Manaus"
        rg = json.load(open(os.path.join(tempfile.gettempdir(), "acesso_demo", "acesso_rotas.geojson"), encoding="utf-8"))
        ita = [f for f in rg["features"] if f["properties"]["nome"] == "Itacoatiara" and f["properties"]["destino"] == "Manaus"]
        assert ita and len(ita[0]["geometry"]["coordinates"]) > 10, "rota Itacoatiara→Manaus sem traçado"
        print(len(rg["features"]), "rotas no demo")
        print("demo ok, saída em", os.path.join(tempfile.gettempdir(), "acesso_demo"))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("acao", nargs="?", choices=["preparar", "perfil", "calcular"])
    ap.add_argument("args", nargs="*")
    ap.add_argument("--pbf"); ap.add_argument("--saida"); ap.add_argument("--trab", default="w")
    ap.add_argument("--osrm", default="http://localhost:5000")
    ap.add_argument("--teste", action="store_true"); ap.add_argument("--demo", action="store_true")
    a = ap.parse_args()
    if a.teste:
        teste(a.demo)
    elif a.acao == "preparar":
        preparar(a.pbf, a.saida, a.trab)
    elif a.acao == "perfil":
        perfil(*a.args)
    elif a.acao == "calcular":
        calcular(a.osrm, a.trab)
    else:
        ap.print_help()
