"""Nível dos rios do Amazonas (cotas diárias ANA) para o DMOB Hub. [Claude] 23/11/2026.

Fontes (públicas, sem cadastro):
- Série convencional (régua, leituras 7h/17h): ANA, ServiceANA.asmx/HidroSerieHistorica (tipoDados=1, cotas em cm).
  Prefere o dado consistido (NivelConsistencia=2) ao bruto (1). Para Manaus a série convencional vai de 1902 a 2014.
- Telemetria: ANA, ServiceANA.asmx/DadosHidrometeorologicos (leituras de 15 min/1 h, campo Nivel em cm).
  Vira média diária e preenche os dias sem dado convencional. As médias diárias já calculadas ficam em
  pipelines/hidro/cache/<codigo>_tel.csv, e cada rodada só busca os dias novos.
- A API nova do HidroWeb (snirh.gov.br/hidroweb/rest) responde 401 sem cadastro: não usada.
- Cotas de referência: boletim diário "Acompanhamento da Bacia do Rio Amazonas", Sala de Situação ANA,
  16/11/2026 (cota de permanência 95% = limite de estiagem; cotas de inundação e inundação severa do SGB/CPRM).
  Estação sem cota no boletim recebe a cota 95% calculada da própria série (marcada "calculada").

Saída: data/hidro.json (série dos últimos 2 anos, faixa histórica por dia do ano, referências e situação).
Uso: python -I pipelines/hidro/coletar.py [--estacoes 14990000,16030000] [--max-meses N] [--teste]
"""
import argparse, csv, datetime as dt, json, os, re, statistics, sys, time, urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(BASE_DIR, "..", ".."))
SAIDA = os.path.join(RAIZ, "data", "hidro.json")
CACHE = os.path.join(BASE_DIR, "cache")
WS = "http://telemetriaws1.ana.gov.br/ServiceANA.asmx"
BOLETIM = "https://www.gov.br/ana/pt-br/sala-de-situacao/rio-amazonas/boletins/diario/boletim_01_amazonas_publica1611.pdf"
UA = {"User-Agent": "Mozilla/5.0 (DMOB Hub)"}
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Cotas em cm. ref: c95 = cota de permanência 95% (abaixo dela a ANA classifica "Estiagem"),
# inund / sev = cota de inundação e de inundação severa (SGB). Fonte: boletim ANA de 16/11/2026 (BOLETIM).
ESTACOES = [
    {"cod": "14990000", "nome": "Manaus", "rio": "Rio Negro", "lat": -3.1383, "lon": -60.0272,
     "uso": "Porto de Manaus, balsas da AM-010/BR-319 e travessias da RMM", "ref": {"c95": 1738, "inund": 2750, "sev": 2900},
     "nota": "Recorde de seca na régua do Porto de Manaus (série desde 1902): 12,11 m em 09/10/2024, segundo SGB/Porto de Manaus "
             "(o recorde anterior era 12,70 m, em 26/10/2023). A telemetria da ANA marcou 12,27 m de média no dia mais baixo "
             "(12/10/2024): sensor e régua diferem alguns centímetros."},
    {"cod": "14100000", "nome": "Manacapuru", "rio": "Rio Solimões", "lat": -3.3106, "lon": -60.6094,
     "uso": "Travessias e AM-070/AM-352", "ref": {"c95": 789, "inund": 1820, "sev": 1960}},
    {"cod": "15040000", "nome": "Careiro", "rio": "Paraná do Careiro", "lat": -3.1961, "lon": -59.8336,
     "uso": "Travessia Manaus–Careiro (BR-319) e Autazes (AM-254)", "ref": None},
    {"cod": "16030000", "nome": "Itacoatiara", "rio": "Rio Amazonas", "lat": -3.1539, "lon": -58.4114,
     "uso": "Porto de Itacoatiara, fim da AM-010", "ref": {"c95": 377, "inund": 1400, "sev": 1420},
     "desde": "2009-01-01"},  # régua mudou em 2008: 1998-2007 lê ~7 m acima do zero atual
    {"cod": "16350002", "nome": "Parintins", "rio": "Rio Amazonas", "lat": -2.6306, "lon": -56.7519,
     "uso": "Abastecimento fluvial do Baixo Amazonas", "ref": None},
    {"cod": "15900000", "nome": "Borba", "rio": "Rio Madeira", "lat": -4.39, "lon": -59.59,
     "uso": "Travessias do Madeira (AM-364/AM-366)", "ref": None, "sem_telemetria": True},
    {"cod": "15630000", "nome": "Humaitá", "rio": "Rio Madeira", "lat": -7.5028, "lon": -63.0183,
     "uso": "BR-230/BR-319 e balsas do Madeira", "ref": None,
     "desde": "1967-01-01"},  # 1931-1949 em outro zero de régua (mínimas perto de 0 m)
    {"cod": "10100000", "nome": "Tabatinga", "rio": "Rio Solimões", "lat": -4.2347, "lon": -69.9447,
     "uso": "Alto Solimões (logística fluvial de cargas e combustível)", "ref": {"c95": 141}},
]


def get(url, timeout=180, tentativas=4):
    for t in range(tentativas):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            if t == tentativas - 1:
                raise
            print(f"  nova tentativa ({e})")
            time.sleep(5 * (t + 1))


def tag(bloco, k):
    m = re.search(rf"<{k}>([^<]*)</{k}>", bloco)
    return m.group(1).strip() if m else ""


def parse_convencional(xml):
    """HidroSerieHistorica: uma linha por mês com Cota01..Cota31 (cm). Retorna {iso: cm}, consistido ganha do bruto."""
    melhor = {}  # iso -> (consistencia, cm)
    for b in re.findall(r"<SerieHistorica[^>]*>(.*?)</SerieHistorica>", xml, re.S):
        nc = int(tag(b, "NivelConsistencia") or 1)
        mes = dt.date.fromisoformat(tag(b, "DataHora")[:10])
        for d in range(1, 32):
            v = tag(b, f"Cota{d:02d}")
            if not v:
                continue
            try:
                dia = mes.replace(day=d)
            except ValueError:
                continue
            iso = dia.isoformat()
            if iso not in melhor or nc > melhor[iso][0]:
                melhor[iso] = (nc, float(v))
    return {k: v[1] for k, v in melhor.items()}


def parse_telemetria(xml):
    """DadosHidrometeorologicos: leituras sub-diárias de Nivel (cm). Retorna {iso: média diária em cm}.
    Leitura a mais de 100 cm da mediana do dia é descartada (pico de sensor)."""
    por_dia = {}
    for b in re.findall(r"<DadosHidrometereologicos[^>]*>(.*?)</DadosHidrometereologicos>", xml, re.S):
        n, h = tag(b, "Nivel"), tag(b, "DataHora")
        if n and h:
            por_dia.setdefault(h[:10], []).append(float(n))
    out = {}
    for d, vs in por_dia.items():
        med = statistics.median(vs)
        ok = [v for v in vs if abs(v - med) <= 100]
        out[d] = round(sum(ok) / len(ok), 1)
    return out


def meses(ini, fim):
    d = ini.replace(day=1)
    while d <= fim:
        prox = (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        yield max(d, ini), min(prox - dt.timedelta(days=1), fim)
        d = prox


def ler_cache(cod):
    p = os.path.join(CACHE, f"{cod}_tel.csv")
    if not os.path.exists(p):
        return {}
    with open(p, encoding="utf-8") as f:
        return {r["data"]: float(r["cota_cm"]) for r in csv.DictReader(f)}


def gravar_cache(cod, tel):
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, f"{cod}_tel.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["data", "cota_cm"])
        for d in sorted(tel):
            w.writerow([d, tel[d]])


def doy(iso):
    """Índice 0..365 pelo calendário de ano bissexto (29/02 tem o seu, os demais dias não se deslocam)."""
    m, d = int(iso[5:7]), int(iso[8:10])
    return (dt.date(2000, m, d) - dt.date(2000, 1, 1)).days


def pct(vs, p):
    vs = sorted(vs)
    k = (len(vs) - 1) * p
    i = int(k)
    return vs[i] if i + 1 >= len(vs) else vs[i] + (vs[i + 1] - vs[i]) * (k - i)


def climatologia(serie, ano_atual):
    """Por dia do ano: média, mín, máx, P10 e P90 (m) de todos os anos completos anteriores ao atual."""
    por = [[] for _ in range(366)]
    anos = set()
    for d, v in serie.items():
        if int(d[:4]) < ano_atual:
            por[doy(d)].append(v)
            anos.add(int(d[:4]))
    dias = []
    for vs in por:
        if not vs:
            dias.append(None)
            continue
        dias.append([round(sum(vs) / len(vs) / 100, 2), round(min(vs) / 100, 2), round(max(vs) / 100, 2),
                     round(pct(vs, .1) / 100, 2), round(pct(vs, .9) / 100, 2)])
    return {"anos": len(anos), "periodo": [min(anos), max(anos)] if anos else None,
            "campos": ["media", "min", "max", "p10", "p90"], "dia": dias}


def situacao(cm, ref, dia):
    """Regra do Hub (citar na tela):
    - inundação severa / inundação: cota >= cota SGB (boletim ANA);
    - estiagem: cota < cota de permanência 95% (critério do boletim da Sala de Situação ANA);
    - atenção: cota abaixo do P10 histórico do dia do ano (cálculo do Hub, não é classificação oficial);
    - normal: demais casos."""
    if ref.get("sev") and cm >= ref["sev"]:
        return "inundação severa"
    if ref.get("inund") and cm >= ref["inund"]:
        return "inundação"
    if ref.get("c95") is not None and cm < ref["c95"]:
        return "estiagem"
    if dia and cm / 100 < dia[3]:
        return "atenção"
    return "normal"


def coletar_estacao(e, hoje, max_meses=None):
    cod = e["cod"]
    print(f"{e['nome']} ({cod})")
    conv = parse_convencional(get(f"{WS}/HidroSerieHistorica?codEstacao={cod}&dataInicio=01/01/1900"
                                  f"&dataFim={hoje:%d/%m/%Y}&tipoDados=1&nivelConsistencia="))
    conv = {d: v for d, v in conv.items() if d >= e.get("desde", "")}
    print(f"  convencional: {len(conv)} dias" + (f", {min(conv)} a {max(conv)}" if conv else ""))
    tel = ler_cache(cod)
    if not e.get("sem_telemetria"):
        # do fim da régua (-30 dias, para conferir o zero) até hoje; mês que já tem dia no cache não é rebaixado,
        # exceto os últimos dias (a telemetria chega com atraso)
        ini = dt.date.fromisoformat(max(conv)) - dt.timedelta(days=30) if conv else hoje - dt.timedelta(days=730)
        recente = dt.date.fromisoformat(max(tel)) - dt.timedelta(days=3) if tel else ini
        no_cache = {d[:7] for d in tel}
        janelas = [(max(a, recente) if f"{a:%Y-%m}" in no_cache else a, b)
                   for a, b in meses(ini, hoje) if b >= recente or f"{a:%Y-%m}" not in no_cache]
        if max_meses:
            janelas = janelas[-max_meses:]
        for a, b in janelas:
            try:
                tel.update(parse_telemetria(get(f"{WS}/DadosHidrometeorologicos?codEstacao={cod}"
                                                f"&DataInicio={a:%d/%m/%Y}&DataFim={b:%d/%m/%Y}")))
            except Exception as ex:
                print(f"  telemetria {a:%m/%Y} falhou: {ex}")
        gravar_cache(cod, tel)
        print(f"  telemetria: {len(tel)} dias no cache")
    # conferência de régua: telemetria e convencional nos mesmos dias devem bater (zero comum)
    comum = [tel[d] - conv[d] for d in tel if d in conv]
    dif_tel = round(statistics.median(comum)) if comum else None
    if dif_tel is not None and abs(dif_tel) > 30:
        print(f"  AVISO: telemetria difere da régua em {dif_tel} cm (mediana de {len(comum)} dias)")
    tel = {d: v for d, v in tel.items() if d >= e.get("desde", "")}
    serie = {**tel, **conv}  # convencional (régua, consistida) prevalece onde existe
    if not serie:
        return None
    ref = dict(e["ref"] or {})
    fonte_ref = "Boletim Sala de Situação ANA de 16/11/2026 (cota 95% e cotas de inundação SGB)" if e["ref"] else ""
    if ref.get("c95") is None:
        ref["c95"] = round(pct(list(serie.values()), .05))
        fonte_ref = "cota 95% calculada pelo Hub (permanência 95% da série diária completa); estação fora do boletim ANA"
    clima = climatologia(serie, hoje.year)
    ult = max(serie)
    dia = clima["dia"][doy(ult)]
    corte = (hoje - dt.timedelta(days=730)).isoformat()
    mn = min(serie, key=serie.get)
    mx = max(serie, key=serie.get)
    return {
        "cod": cod, "nome": e["nome"], "rio": e["rio"], "lat": e["lat"], "lon": e["lon"], "uso": e["uso"], "nota": e.get("nota"),
        "ultima": {"data": ult, "cota_m": round(serie[ult] / 100, 2), "origem": "convencional" if ult in conv else "telemetria",
                   "situacao": situacao(serie[ult], ref, dia),
                   "dif_media_m": round(serie[ult] / 100 - dia[0], 2) if dia else None},
        "ref": {k: round(v / 100, 2) for k, v in ref.items()}, "ref_fonte": fonte_ref,
        "recorde_min": {"data": mn, "cota_m": round(serie[mn] / 100, 2)},
        "recorde_max": {"data": mx, "cota_m": round(serie[mx] / 100, 2)},
        "inicio_serie": min(serie), "dif_tel_conv_cm": dif_tel, "dias_comuns_tel_conv": len(comum),
        "serie": [[d, round(serie[d] / 100, 2)] for d in sorted(serie) if d >= corte],
        "clima": clima,
    }


def teste():
    conv = parse_convencional("""<SerieHistorica><NivelConsistencia>1</NivelConsistencia><DataHora>2024-02-01 00:00:00</DataHora>
      <Cota01>1000</Cota01><Cota29>1010</Cota29><Cota30>999</Cota30></SerieHistorica>
      <SerieHistorica><NivelConsistencia>2</NivelConsistencia><DataHora>2024-02-01 00:00:00</DataHora><Cota01>1005</Cota01><Cota02></Cota02></SerieHistorica>""")
    assert conv == {"2024-02-01": 1005.0, "2024-02-29": 1010.0}, conv  # consistido vence; 30/02 descartado
    tel = parse_telemetria("""<DadosHidrometereologicos><DataHora>2026-11-01 01:00:00 </DataHora><Vazao /><Nivel>1645.00</Nivel></DadosHidrometereologicos>
      <DadosHidrometereologicos><DataHora>2026-11-01 02:00:00</DataHora><Nivel>1647.00</Nivel></DadosHidrometereologicos>
      <DadosHidrometereologicos><DataHora>2026-11-01 03:00:00</DataHora><Nivel>9999.00</Nivel></DadosHidrometereologicos>
      <DadosHidrometereologicos><DataHora>2026-11-01 04:00:00</DataHora><Nivel /></DadosHidrometereologicos>""")
    assert tel == {"2026-11-01": 1646.0}, tel
    assert doy("2023-03-01") == doy("2024-03-01") == 60 and doy("2024-02-29") == 59 and doy("2025-12-31") == 365
    assert list(meses(dt.date(2026, 1, 15), dt.date(2026, 3, 2)))[-1] == (dt.date(2026, 3, 1), dt.date(2026, 3, 2))
    c = climatologia({"2020-01-01": 1000, "2021-01-01": 1200, "2026-01-01": 1}, 2026)
    assert c["anos"] == 2 and c["dia"][0][:3] == [11.0, 10.0, 12.0], c["dia"][0]
    ref = {"c95": 1738, "inund": 2750, "sev": 2900}
    assert situacao(1612, ref, None) == "estiagem" and situacao(2950, ref, None) == "inundação severa"
    assert situacao(1800, ref, [20, 15, 25, 18.5, 22]) == "atenção" and situacao(2000, ref, [20, 15, 25, 18.5, 22]) == "normal"
    print("teste ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--estacoes", help="códigos separados por vírgula (padrão: todas)")
    ap.add_argument("--max-meses", type=int, help="limita a busca de telemetria aos N meses mais recentes (teste local)")
    ap.add_argument("--teste", action="store_true")
    a = ap.parse_args()
    if a.teste:
        return teste()
    hoje = dt.date.today()
    sel = [e for e in ESTACOES if not a.estacoes or e["cod"] in a.estacoes.split(",")]
    antigo = {}
    if os.path.exists(SAIDA):
        with open(SAIDA, encoding="utf-8") as f:
            antigo = {e["cod"]: e for e in json.load(f).get("estacoes", [])}
    out = []
    for e in ESTACOES:
        r = None
        if e in sel:
            try:
                r = coletar_estacao(e, hoje, a.max_meses)
            except Exception as ex:
                print(f"  FALHOU {e['nome']}: {ex}")
        r = r or antigo.get(e["cod"])  # estação que falhou mantém o dado da rodada anterior
        if r:
            out.append(r)
    assert out, "nenhuma estação coletada"
    meta = {
        "fonte": "ANA - Agência Nacional de Águas e Saneamento Básico (HidroSerieHistorica e telemetria, ServiceANA); "
                 "cotas de referência do boletim da Sala de Situação ANA (Bacia do Rio Amazonas) e SGB/CPRM",
        "url": WS, "boletim_referencia": BOLETIM,
        "gerado_em": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "metodologia": "Cota diária = leitura convencional (régua; consistida quando houver) ou, na falta dela, média diária "
                       "das leituras telemétricas (descarta leitura a mais de 1 m da mediana do dia). Faixa histórica por dia do "
                       "ano com todos os anos anteriores ao corrente. Situação: inundação/inundação severa = cota >= cota SGB; "
                       "estiagem = cota abaixo da cota de permanência 95% (critério do boletim ANA); atenção = abaixo do P10 "
                       "histórico da data (cálculo do Hub, sem valor oficial); normal = demais.",
        "unidade": "metros na régua local de cada estação (não é altitude)",
    }
    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    with open(SAIDA, "w", encoding="utf-8") as f:
        json.dump({"_meta": meta, "estacoes": out}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"gravado {SAIDA}: {len(out)} estações")


if __name__ == "__main__":
    main()
