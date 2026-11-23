"""Análise para decisão · sinistros nas rodovias estaduais do AM (DMOB Hub). [Proton] 23/11/2026, a partir do analisar.py do Nexus (06/11).

Entradas: data/sinistros.json (coletar.py) · extensão por rodovia (planilha Rodovias SER, gviz) · data/icm.json (IRI RoadLab)
          · data/eobras.json (contratos e situação).
Saída:    data/sinistros_analise.json, lido pelo módulo Sinistros do Hub.

Métodos (fonte de cada um, para citar):
- Severidade em UPS (Unidade Padrão de Severidade): acidente com morte = 13, com ferido envolvendo pedestre
  (atropelamento) = 6, com ferido = 4, só danos = 1. DENATRAN, "Manual de identificação, análise e tratamento de
  pontos negros", 2ª ed., Brasília, 1987. Notícia sem número de feridos e sem morte conta como "com ferido" (4) só se o
  texto citar ferido/socorro; senão 1.
- Taxas por 100 km e por ano (exposição = extensão não planejada da rodovia × anos observados) com intervalo de 95%
  de Poisson (aproximação de Wilson-Hilferty). Rodovia com menos de 3 ocorrências não entra no ranking.
- Trecho crítico: janelas de 5 km pelo km citado nas matérias; vale com 2 ocorrências ou mais.
- Tendência: ocorrências dos últimos 12 meses ÷ média anual dos 36 meses anteriores.
- Índice de prioridade (0–100), só para quem tem ≥ 3 ocorrências: 35% UPS/100 km/ano, 25% ocorrências fatais/100 km/ano,
  15% tendência, 15% IRI (rugosidade; pior = maior), 10% ausência de obra ativa na rodovia. UPS e fatais: proporção
  da pior rodovia do ranking (v / máx.); tendência: escala fixa 1,0→0 a 2,0→1; IRI: escala fixa 2,7→0 a 4,6→1 m/km (DNIT). Os pesos são escolha do DMOB e ficam escritos na saída.
Cuidados (vão no painel): a base são notícias, então acidente sem matéria não aparece e rodovias perto de Manaus têm
mais cobertura; "mortos" é o mínimo citado; o km vem do texto e às vezes falta.
Uso: python -I pipelines/sinistros/analisar.py
"""
import csv, datetime as dt, io, json, math, os, re, urllib.request
from collections import Counter, defaultdict

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(BASE_DIR))
ENTRADA = os.path.join(RAIZ, "data", "sinistros.json")
SAIDA = os.path.join(RAIZ, "data", "sinistros_analise.json")
ICM = os.path.join(RAIZ, "data", "icm.json")
EOBRAS = os.path.join(RAIZ, "data", "eobras.json")
PLAN_ROD = "1bYf2anVF4un84-lusSOeSRaNLiod9fq0joUEnbgHxnM"
INICIO = dt.date(2019, 1, 1)
ATIVAS = re.compile(r"andamento|vigente|paralis|recebimento|a iniciar", re.I)
PESOS = {"ups": 0.35, "fatal": 0.25, "tendencia": 0.15, "iri": 0.15, "sem_obra": 0.10}
MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
DIAS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]

# Intervenção usual por tipo (indicação para estudo de campo, não projeto). Referências: DNIT, Manual de Sinalização
# Rodoviária (2010); DNIT, Manual de Projeto de Interseções (2005); DNIT/IPR, Defensas metálicas (NBR 6971).
INTERVENCAO = {
    "Atropelamento": "travessia segura (faixa elevada ou passarela), iluminação, calçada e redutor de velocidade nos trechos urbanos",
    "Saída de pista": "sinalização de curva (horizontal e vertical), defensas metálicas, acostamento e limpeza da faixa de domínio",
    "Capotamento": "correção de curva e superelevação, defensas, sinalização de curva e controle de velocidade",
    "Tombamento": "correção de curva e superelevação, sinalização para veículos pesados, acostamento",
    "Colisão": "3ª faixa ou duplicação nos trechos de maior volume, separação de sentidos, fiscalização eletrônica",
    "Engavetamento": "controle de velocidade, sinalização de aproximação e iluminação",
    "Colisão com animal": "cerca na faixa de domínio, sinalização de fauna e passagem de animais",
    "Acidente (geral)": "vistoria de campo do trecho (sinalização, pavimento, acostamento)",
}


def gviz(id_, gid=None):
    u = f"https://docs.google.com/spreadsheets/d/{id_}/gviz/tq?tqx=out:csv" + (f"&gid={gid}" if gid else "")
    t = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=60).read().decode("utf-8", "replace")
    return list(csv.DictReader(io.StringIO(t)))


def num(v):
    try:
        s = str(v).strip()
        return float(s.replace(".", "").replace(",", ".")) if "," in s else float(s)
    except Exception:
        return None


def poisson_ic(k):
    """IC 95% de Poisson para a contagem k (Wilson-Hilferty)."""
    def q(p, df):
        z = -1.959964 if p < 0.5 else 1.959964
        return df * (1 - 2 / (9 * df) + z * math.sqrt(2 / (9 * df))) ** 3
    return (0.0 if k == 0 else q(0.025, 2 * k) / 2), q(0.975, 2 * (k + 1)) / 2


def ups(o):
    if o.get("fatal"):
        return 13
    if o.get("tipo") == "Atropelamento":
        return 6
    if o.get("feridos") or o.get("_cita_ferido"):
        return 4
    return 1


def extensoes():
    """km por rodovia, sem trechos planejados (não há tráfego). Falha de rede: devolve {} e as taxas saem vazias."""
    ext = defaultdict(float)
    try:
        for r in gviz(PLAN_ROD):
            cod = (r.get("Rodovia") or "").strip()
            sit = (r.get("Situação Física") or "") + " " + (r.get("Descrição") or "")
            e = num(r.get("Extensão"))
            if cod.startswith("AM-") and e and not re.search(r"planej", sit, re.I):
                ext[cod] += e
    except Exception as e:
        print("extensão: sem acesso à planilha Rodovias:", e)
    return {k: round(v, 2) for k, v in ext.items()}


def obra_da_rodovia(obj, n):
    """CLAUDE.md: contrato que cita a rodovia só como localização não é da rodovia. Mesma regra de v2/js/dados.js."""
    am = rf"AM[\s-]?0*{n}\b"
    if not re.search(rf"\b{am}", obj or "", re.I):
        return False
    return not re.search(rf"\b(?:km|quil[oô]metros?)\s*\d+[\d.,]*(?:\s*(?:e|a|ao)\s*\d+[\d.,]*)?\s*(?:da|na|do)\s+(?:rodovia\s+)?{am}|localizad[oa][^.;]{{0,60}}\b{am}", obj, re.I)


def normaliza(vals):
    """Proporção da pior rodovia (v / máximo). [Nexus] 23/11: era min-max, que com poucas rodovias forçava 0 ou 1."""
    vs = [v for v in vals.values() if v is not None]
    hi = max(vs) if vs else 0
    return {k: (0.0 if v is None or not hi else v / hi) for k, v in vals.items()}


def escala(v, bom, ruim):
    """Escala absoluta 0–1 entre um limiar 'bom' (0) e um 'ruim' (1)."""
    return 0.0 if v is None else max(0.0, min(1.0, (v - bom) / (ruim - bom)))


def main():
    d = json.load(open(ENTRADA, encoding="utf-8"))
    ocs, nots = d["ocorrencias"], {n["id"]: n for n in d["noticias"]}
    hoje = dt.date.today()
    anos_obs = (hoje - INICIO).days / 365.25
    for o in ocs:  # o texto das notícias diz se houve ferido mesmo sem número
        o["_cita_ferido"] = any(re.search(r"ferid|socorrid|hospital", (nots.get(i, {}).get("trecho") or "") + " " +
                                          (nots.get(i, {}).get("titulo") or ""), re.I) for i in o["noticias"])
        o["ups"] = ups(o)
        o["_d"] = dt.date.fromisoformat(o["data"]) if o.get("data") else None
    ocs = [o for o in ocs if o["_d"] and o["_d"] >= INICIO]

    ext = extensoes()
    icm = {r["codigo"]: r for r in json.load(open(ICM, encoding="utf-8"))["rodovias"]} if os.path.exists(ICM) else {}
    eo = json.load(open(EOBRAS, encoding="utf-8")).get("ct", {}) if os.path.exists(EOBRAS) else {}
    obras = defaultdict(list)
    for ct, o in eo.items():
        if ATIVAS.search(o.get("sit") or ""):
            for m in set(re.findall(r"AM[\s\-]?0*(\d{2,3})", o.get("obj") or "")):
                if not obra_da_rodovia(o.get("obj"), int(m)):  # rodovia só como localização (ramal no km X da AM) não conta
                    continue
                obras["AM-%03d" % int(m)].append({"ct": ct, "sit": o.get("sit"), "fis": o.get("fis"), "obj": (o.get("obj") or "")[:160]})

    # ── por rodovia ──
    por = defaultdict(list)
    for o in ocs:
        por[o["rodovia"]].append(o)
    rods = {}
    lim12 = hoje - dt.timedelta(days=365)
    lim48 = hoje - dt.timedelta(days=365 * 4)
    for cod, lst in por.items():
        n, fat = len(lst), sum(1 for o in lst if o.get("fatal"))
        km = ext.get(cod)
        expo = km / 100 * anos_obs if km else None
        u = sum(o["ups"] for o in lst)
        rec = sum(1 for o in lst if o["_d"] >= lim12)
        ant = sum(1 for o in lst if lim48 <= o["_d"] < lim12) / 3
        janelas = defaultdict(list)
        for o in lst:
            k = num(o.get("km"))
            if k is not None:
                janelas[int(k // 5) * 5].append(o)
        criticos = sorted(({"km_ini": a, "km_fim": a + 5, "ocorrencias": len(v), "fatais": sum(1 for o in v if o.get("fatal")),
                            "ups": sum(o["ups"] for o in v)} for a, v in janelas.items() if len(v) >= 2),
                          key=lambda x: -x["ups"])[:5]
        tipos = Counter(o["tipo"] for o in lst)
        tipo_top = tipos.most_common(1)[0][0]
        lo, hi = poisson_ic(n)
        flo, fhi = poisson_ic(fat)
        i = icm.get(cod, {})
        rods[cod] = {
            "ocorrencias": n, "fatais": fat, "mortos": sum(o.get("mortos") or 0 for o in lst),
            "feridos": sum(o.get("feridos") or 0 for o in lst), "ups": u, "extensao_km": km,
            "taxa_100km_ano": round(n / expo, 2) if expo else None,
            "taxa_ic95": [round(lo / expo, 2), round(hi / expo, 2)] if expo else None,
            "fatais_100km_ano": round(fat / expo, 3) if expo else None,
            "fatais_ic95": [round(flo / expo, 3), round(fhi / expo, 3)] if expo else None,
            "ups_100km_ano": round(u / expo, 2) if expo else None,
            "ultimos_12m": rec, "media_anual_36m_antes": round(ant, 2),
            "tendencia": round(rec / ant, 2) if ant else None,
            "trechos_criticos": criticos, "tipos": dict(tipos.most_common()), "tipo_predominante": tipo_top,
            "intervencao_sugerida": INTERVENCAO.get(tipo_top), "km_informado_pct": round(100 * sum(1 for o in lst if o.get("km")) / n),
            "iri_medio": i.get("iri_medio"), "condicao": i.get("nivel_geral"),
            "obras_ativas": obras.get(cod, []),
            "ultima": max(o["data"] for o in lst),
        }

    # ── índice de prioridade ──
    elegiveis = {c: r for c, r in rods.items() if r["ocorrencias"] >= 3 and r["ups_100km_ano"] is not None}
    fatores = {
        "ups": normaliza({c: r["ups_100km_ano"] for c, r in elegiveis.items()}),
        "fatal": normaliza({c: r["fatais_100km_ano"] for c, r in elegiveis.items()}),
        # tendência: 1,0 = igual à média anterior (0); 2,0 = dobrou (1). Queda não pontua.
        "tendencia": {c: escala(r["tendencia"], 1.0, 2.0) for c, r in elegiveis.items()},
        # IRI: DNIT, faixas de irregularidade (bom ≤ 2,7 m/km; péssimo > 4,6 m/km). Bom = 0, péssimo = 1.
        "iri": {c: escala(r["iri_medio"], 2.7, 4.6) for c, r in elegiveis.items()},
        "sem_obra": {c: 0.0 if r["obras_ativas"] else 1.0 for c, r in elegiveis.items()},
    }
    for c, r in rods.items():
        if c in elegiveis:
            r["prioridade"] = round(100 * sum(PESOS[f] * fatores[f][c] for f in PESOS), 1)
            r["fatores"] = {f: round(fatores[f][c], 2) for f in PESOS}
        else:
            r["prioridade"] = None
    ranking = sorted(elegiveis, key=lambda c: -rods[c]["prioridade"])
    for pos, c in enumerate(ranking, 1):
        r = rods[c]
        r["posicao"] = pos
        r["faixa"] = "Alta" if r["prioridade"] >= 60 else "Média" if r["prioridade"] >= 35 else "Baixa"
        partes = [f"{r['ocorrencias']} ocorrências desde 2019 ({r['fatais']} com morte)"]
        if r["fatais_100km_ano"] is not None:
            partes.append(f"{str(r['fatais_100km_ano']).replace('.', ',')} ocorrências fatais por 100 km/ano")
        if r["trechos_criticos"]:
            t = r["trechos_criticos"][0]
            partes.append(f"trecho mais grave: km {t['km_ini']}–{t['km_fim']} ({t['ocorrencias']} ocorrências)")
        if r["tendencia"] and r["tendencia"] >= 1.3:
            partes.append(f"alta recente: {r['ultimos_12m']} nos últimos 12 meses (×{str(r['tendencia']).replace('.', ',')} sobre a média)")
        partes.append(f"tipo mais comum: {r['tipo_predominante'].lower()}. Estudar: {r['intervencao_sugerida']}")
        partes.append(f"obra ativa: {', '.join(x['ct'] for x in r['obras_ativas'][:3])}" if r["obras_ativas"] else "sem obra ativa no e-Obras")
        r["leitura"] = "; ".join(partes) + "."

    # ── visão geral ──
    por_ano = defaultdict(lambda: {"ocorrencias": 0, "fatais": 0, "mortos": 0, "ups": 0})
    serie = Counter()
    mes, dia, tipo, mun, fonte = Counter(), Counter(), Counter(), Counter(), Counter()
    for o in ocs:
        a = por_ano[o["_d"].year]
        a["ocorrencias"] += 1; a["fatais"] += int(bool(o.get("fatal"))); a["mortos"] += o.get("mortos") or 0; a["ups"] += o["ups"]
        serie[o["_d"].strftime("%Y-%m")] += 1
        mes[o["_d"].month - 1] += 1
        dia[o["_d"].weekday()] += 1
        tipo[o["tipo"]] += 1
        if o.get("municipio"):
            mun[o["municipio"]] += 1
    for n in d["noticias"]:
        fonte[n.get("fonte") or "?"] += 1
    cheia = sum(mes[i] for i in (11, 0, 1, 2, 3, 4))  # dez–mai: período chuvoso na Amazônia central
    rec12 = [o for o in ocs if o["_d"] >= lim12]
    ant12 = [o for o in ocs if lim12 - dt.timedelta(days=365) <= o["_d"] < lim12]
    saida = {
        "_meta": {
            "gerado": dt.datetime.now().strftime("%Y-%m-%d %H:%M"), "periodo": [INICIO.isoformat(), hoje.isoformat()],
            "anos_observados": round(anos_obs, 2), "fonte_base": d.get("_meta", {}),
            "metodos": {
                "ups": "DENATRAN (1987), Manual de identificação, análise e tratamento de pontos negros: morte 13, atropelamento com ferido 6, ferido 4, só danos 1",
                "taxas": "ocorrências ÷ (extensão não planejada/100 × anos observados); IC 95% Poisson (Wilson-Hilferty)",
                "trecho_critico": "janelas de 5 km pelo km citado; mínimo 2 ocorrências",
                "tendencia": "últimos 12 meses ÷ média anual dos 36 meses anteriores",
                "prioridade": {"pesos": PESOS, "escalas": "UPS e fatais: v / pior rodovia; tendência 1,0→0 a 2,0→1; IRI 2,7→0 a 4,6→1 m/km (faixas DNIT)", "minimo_ocorrencias": 3, "faixas": "Alta ≥ 60; Média ≥ 35; Baixa < 35"},
                "intervencoes": "indicação para estudo de campo (DNIT: Manual de Sinalização Rodoviária 2010; Manual de Projeto de Interseções 2005)",
            },
            "cuidados": [
                "A base são notícias: acidente sem matéria não aparece, e as rodovias perto de Manaus têm mais cobertura.",
                "Mortos é o mínimo citado nas matérias; quem morreu depois no hospital pode faltar.",
                "O km vem do texto da matéria e nem sempre é informado.",
                "A data é a da publicação (Google News) ou a da matéria (Wayback), não necessariamente a do acidente.",
            ],
        },
        "totais": {
            "ocorrencias": len(ocs), "fatais": sum(1 for o in ocs if o.get("fatal")), "mortos": sum(o.get("mortos") or 0 for o in ocs),
            "feridos": sum(o.get("feridos") or 0 for o in ocs), "ups": sum(o["ups"] for o in ocs),
            "noticias": len(d["noticias"]), "arquivadas_wayback": sum(1 for n in d["noticias"] if n.get("arquivo")),
            "rodovias_com_registro": len(rods), "ultimos_12m": len(rec12), "12m_anteriores": len(ant12),
            "fatais_ultimos_12m": sum(1 for o in rec12 if o.get("fatal")), "fatais_12m_anteriores": sum(1 for o in ant12 if o.get("fatal")),
        },
        "por_ano": {str(k): v for k, v in sorted(por_ano.items())},
        "serie_mensal": dict(sorted(serie.items())),
        "por_mes": {MESES[i]: mes[i] for i in range(12)},
        "sazonalidade": {"chuvoso_dez_mai": cheia, "seco_jun_nov": len(ocs) - cheia},
        "por_dia_semana": {DIAS[i]: dia[i] for i in range(7)},
        "por_tipo": dict(tipo.most_common()), "por_municipio": dict(mun.most_common(20)), "por_fonte": dict(fonte.most_common(15)),
        "ranking": ranking, "rodovias": dict(sorted(rods.items())),
    }
    tmp = SAIDA + ".part"
    json.dump(saida, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.replace(tmp, SAIDA)
    print(f"{len(ocs)} ocorrências, {len(rods)} rodovias, {len(ranking)} no ranking -> {SAIDA}")


if __name__ == "__main__":
    main()
