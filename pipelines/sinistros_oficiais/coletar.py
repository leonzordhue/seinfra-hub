"""Sinistros de trânsito no Amazonas em bases oficiais, para validar o robô de notícias. [Claude] 23/11/2026.

Fontes (públicas, sem login):
- RENAEST/SENATRAN (Registro Nacional de Sinistros e Estatísticas de Trânsito, Res. CONTRAN 808/2020),
  dataset "renaest" no portal dados.transportes.gov.br (API CKAN package_show). Cada ZIP mensal traz a base
  INTEIRA acumulada (Acidentes, Vitimas, Localidade, TipoVeiculo; CSV ';' latin-1). Usa-se só o ZIP mais novo.
  Acidentes: uf_acidente, ano/mes, codigo_ibge, end_acidente, tp_rodovia, qtde_obitos.
  Vitimas: gravidade_lesao (LEVE/GRAVE = ferido). Localidade: qtde_habitantes (estimativa IBGE) por município/mês.
- PRF, dados abertos "BAT - Acidentes agrupados por ocorrência" (datatranAAAA.zip no Google Drive, links na
  página gov.br/prf). Só rodovias federais (BR) patrulhadas pela PRF no AM.
- SIM/DATASUS (CID-10 V01-V89): NÃO incluído. Os arquivos DO do OpenDataSUS são nacionais e pesados
  (centenas de MB por ano) e o tabnet não tem API; fica registrado em _meta.

Rodovia estadual no RENAEST: não há campo de código; procura "AM 010", "AM-070" etc. no endereço
(end_acidente) e conta também tp_rodovia = ESTADUAL. É estimativa por texto (registro sem código fica fora).

Saída: data/sinistros_oficiais.json
Uso: python -I pipelines/sinistros_oficiais/coletar.py [--amostra] [--teste]
  --teste   asserts sem rede (rápido; roda no Actions antes da coleta)
  --amostra teste local leve: lê do ZIP do RENAEST só o trecho do AM por HTTP Range (arquivos ordenados por UF)
            e só o último ano da PRF. NÃO usar para publicar (a saída sai marcada como amostra).
"""
import argparse, collections, csv, datetime as dt, io, json, os, re, sys, tempfile, time, unicodedata
import urllib.request, zipfile

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(BASE_DIR, "..", ".."))
SAIDA = os.path.join(RAIZ, "data", "sinistros_oficiais.json")
ROBO = os.path.join(RAIZ, "data", "sinistros.json")
CKAN = "https://dados.transportes.gov.br/api/3/action/package_show?id=renaest"
PRF_PAG = "https://www.gov.br/prf/pt-br/acesso-a-informacao/dados-abertos/dados-abertos-da-prf"
PRF_DESDE = 2017  # antes de 2017 o layout do datatran muda (colunas e codificação)
UA = {"User-Agent": "Mozilla/5.0 (DMOB Hub)"}
RX_AM = re.compile(r"\bAM\s*-?\s*(\d{3})\b")
RX_BR = re.compile(r"\bBR\s*-?\s*(\d{3})\b")
csv.field_size_limit(10_000_000)
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def get(url, timeout=120, tentativas=4, headers=None):
    for t in range(tentativas):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **(headers or {})}), timeout=timeout) as r:
                return r.read()
        except Exception as e:
            if t == tentativas - 1:
                raise
            print(f"  rede: {str(e)[:80]}; nova tentativa", flush=True)
            time.sleep(10 * (t + 1))


def norm(s):
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().upper()


class Faixa(io.RawIOBase):
    """Arquivo remoto lido por HTTP Range (só para --amostra: lê o trecho do AM sem baixar 540 MB)."""
    def __init__(self, url):
        self.url, self.p = url, 0
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD", headers=UA), timeout=60) as r:
            self.n = int(r.headers["Content-Length"])
    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.p
    def seek(self, o, w=0):
        self.p = o if w == 0 else self.p + o if w == 1 else self.n + o
        return self.p
    def readinto(self, b):
        if self.p >= self.n or not len(b):
            return 0
        d = get(self.url, headers={"Range": f"bytes={self.p}-{min(self.n, self.p + len(b)) - 1}"})
        b[:len(d)] = d
        self.p += len(d)
        return len(d)


# ── RENAEST ────────────────────────────────────────────────────────────────────
def renaest_recurso():
    res = json.loads(get(CKAN))["result"]["resources"]
    def chave(r):  # nome "RENAEST - Mensal - 07-2026"
        m = re.search(r"(\d{2})-(\d{4})", r["name"])
        return (int(m[2]), int(m[1])) if m else (0, 0)
    r = max((r for r in res if r.get("format", "").upper() == "ZIP"), key=chave)
    return r["name"], r["url"]


def abrir_zip(url, amostra):
    if amostra:
        return zipfile.ZipFile(io.BufferedReader(Faixa(url), buffer_size=1 << 20))
    arq = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    print(f"  baixando {url}", flush=True)
    # ~540 MB: a conexão do servidor cai no meio (Broken pipe, 23/11/2026). Retoma com HTTP Range de onde parou.
    pos, tentativa = 0, 0
    while True:
        try:
            h = {**UA, **({"Range": f"bytes={pos}-"} if pos else {})}
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=600) as r:
                if pos and r.status != 206:  # servidor ignorou o Range: recomeça do zero
                    arq.seek(0); arq.truncate(); pos = 0
                while bloco := r.read(1 << 22):
                    arq.write(bloco); pos += len(bloco)
            break
        except Exception as e:
            tentativa += 1
            if tentativa > 8:
                raise
            print(f"  rede: {str(e)[:80]}; retomando em {pos // (1 << 20)} MB (tentativa {tentativa})", flush=True)
            time.sleep(15 * tentativa)
    arq.close()
    return zipfile.ZipFile(arq.name)


def linhas_am(z, prefixo, amostra):
    """Linhas do AM de um CSV do ZIP. Na amostra para ao passar do AM (o arquivo vem ordenado por UF)."""
    info = next(i for i in z.infolist() if i.filename.startswith(prefixo))
    with io.TextIOWrapper(z.open(info), encoding="latin-1", newline="") as f:
        rd = csv.reader(f, delimiter=";")
        cab = next(rd)
        iu = cab.index("uf_acidente") if "uf_acidente" in cab else cab.index("uf")
        visto = False
        for r in rd:
            if len(r) <= iu:
                continue
            if r[iu] == "AM":
                visto = True
                yield dict(zip(cab, r))
            elif amostra and visto and r[iu] > "AM":
                return


def rodovia_do_endereco(end):
    """'ROD AM 010 KM 20' -> 'AM-010'; 'BR 174' -> 'BR-174'; senão None."""
    e = norm(end)
    m = RX_AM.search(e)
    if m:
        return f"AM-{m[1]}"
    m = RX_BR.search(e)
    return f"BR-{m[1]}" if m else None


def agrega_renaest(acidentes, vitimas, localidade):
    mun = {}            # ibge -> {nome, pop, pop_ano, anos:{ano:{acidentes,com_obito,obitos,feridos,estadual,am_xxx,am_xxx_fatais}}}
    rod = collections.defaultdict(lambda: collections.defaultdict(lambda: {"acidentes": 0, "obitos": 0}))
    meses = collections.defaultdict(set)
    tp = collections.defaultdict(collections.Counter)
    vazio = lambda: {"acidentes": 0, "com_obito": 0, "obitos": 0, "feridos": 0, "estadual": 0, "am_xxx": 0, "am_xxx_fatais": 0}
    for r in localidade:
        ib, ano = r["codigo_ibge"], int(r["ano_referencia"] or 0)
        m = mun.setdefault(ib, {"nome": r["municipio"], "pop": None, "pop_ano": 0, "anos": {}})
        if ano >= m["pop_ano"] and (r["qtde_habitantes"] or "").isdigit():
            m["pop"], m["pop_ano"] = int(r["qtde_habitantes"]), ano
    for r in acidentes:
        ib, ano = r["codigo_ibge"], r["ano_acidente"]
        meses[ano].add(r["mes_acidente"])
        m = mun.setdefault(ib, {"nome": "MUNICÍPIO NÃO INFORMADO", "pop": None, "pop_ano": 0, "anos": {}})
        a = m["anos"].setdefault(ano, vazio())
        ob = int(r["qtde_obitos"] or 0)
        a["acidentes"] += 1
        a["obitos"] += ob
        a["com_obito"] += ob > 0
        a["estadual"] += r["tp_rodovia"] == "ESTADUAL"
        tp[ano][r["tp_rodovia"] or "NAO INFORMADO"] += 1
        cod = rodovia_do_endereco(r["end_acidente"])
        if cod:
            rod[cod][ano]["acidentes"] += 1
            rod[cod][ano]["obitos"] += ob
            if cod.startswith("AM-"):
                a["am_xxx"] += 1
                a["am_xxx_fatais"] += ob > 0
    for r in vitimas:
        if r["gravidade_lesao"] in ("LEVE", "GRAVE"):
            ib = r["chv_localidade"][2:9]  # chv_localidade = UF + IBGE(7) + AAAAMM
            m = mun.get(ib)
            if m:
                m["anos"].setdefault(r["ano_acidente"], vazio())["feridos"] += 1
    serie = collections.defaultdict(vazio)
    for m in mun.values():
        for ano, a in m["anos"].items():
            for k, v in a.items():
                serie[ano][k] += v
    return {
        "serie": {a: {**serie[a], "meses": len(meses[a])} for a in sorted(serie)},
        "municipios": {ib: m for ib, m in sorted(mun.items()) if m["anos"]},
        "rodovias": {c: dict(sorted(v.items())) for c, v in sorted(rod.items())},
        "tp_rodovia": {a: dict(tp[a]) for a in sorted(tp)},
    }


# ── PRF ────────────────────────────────────────────────────────────────────────
def prf_links():
    h = get(PRF_PAG).decode("utf-8", "replace")
    out = {}
    # o link vem na célula seguinte da tabela: pula tags e espaços (inclusive &nbsp;) até o 1º <a>
    for m in re.finditer(r"Acidentes\s+(\d{4})\s*\(Agrupados por ocorr[êe]ncia\)(?:(?!<a\b).){0,600}?<a[^>]+href=\"[^\"]*?/d/([\w-]+)", h, re.S):
        out.setdefault(int(m[1]), m[2])
    return out


def prf_linhas(ano, id_drive):
    b = get(f"https://drive.usercontent.google.com/download?id={id_drive}&export=download&confirm=t", timeout=300)
    z = zipfile.ZipFile(io.BytesIO(b))
    nome = next(n for n in z.namelist() if n.lower().endswith(".csv"))
    with io.TextIOWrapper(z.open(nome), encoding="latin-1", newline="") as f:
        for r in csv.DictReader(f, delimiter=";"):
            if r.get("uf") == "AM":
                yield r


def agrega_prf(linhas):
    """linhas: dicts do datatran (uf=AM). Ferido = feridos_leves + feridos_graves (dicionário de dados PRF)."""
    num = lambda v: int(float((v or "0").replace(",", ".")))
    brs = collections.defaultdict(lambda: {"anos": collections.defaultdict(lambda: {"acidentes": 0, "mortos": 0, "feridos": 0, "com_morte": 0}),
                                           "trechos": collections.defaultdict(lambda: {"acidentes": 0, "mortos": 0})})
    serie = collections.defaultdict(lambda: {"acidentes": 0, "mortos": 0, "feridos": 0, "com_morte": 0})
    mun = collections.defaultdict(lambda: collections.defaultdict(lambda: {"acidentes": 0, "mortos": 0}))
    for r in linhas:
        ano = r["data_inversa"][:4] if "-" in r["data_inversa"] else r["data_inversa"][-4:]
        br = f"BR-{int(num(r['br'])):03d}" if num(r["br"]) else "BR não informada"
        mo, fe = num(r["mortos"]), num(r["feridos_leves"]) + num(r["feridos_graves"])
        for d in (brs[br]["anos"][ano], serie[ano]):
            d["acidentes"] += 1; d["mortos"] += mo; d["feridos"] += fe; d["com_morte"] += mo > 0
        km = num(r["km"])
        t = brs[br]["trechos"][km // 10 * 10]  # trechos de 10 km para achar concentração
        t["acidentes"] += 1; t["mortos"] += mo
        mm = mun[norm(r["municipio"])][ano]
        mm["acidentes"] += 1; mm["mortos"] += mo
    out = {}
    for br, v in sorted(brs.items()):
        tot = {k: sum(a[k] for a in v["anos"].values()) for k in ("acidentes", "mortos", "feridos", "com_morte")}
        tr = sorted(({"km_ini": k, "km_fim": k + 10, **x} for k, x in v["trechos"].items()), key=lambda x: (-x["mortos"], -x["acidentes"]))[:8]
        out[br] = {"total": tot, "anos": dict(sorted(v["anos"].items())), "trechos_criticos": tr}
    return {"serie": dict(sorted(serie.items())), "brs": out, "municipios": {m: dict(sorted(a.items())) for m, a in sorted(mun.items())}}


# ── cobertura do robô ─────────────────────────────────────────────────────────
def cobertura(robo, ren):
    """Robô (notícias, só AM-xxx) x RENAEST por município e ano. Denominadores: registros oficiais com AM-xxx no
    endereço (comparação justa), tp_rodovia=ESTADUAL e total do município (inclui vias urbanas)."""
    por_nome = {norm(m["nome"]): ib for ib, m in ren["municipios"].items()}
    rb = collections.defaultdict(lambda: {"ocorrencias": 0, "fatais": 0})
    sem_mun = 0
    for o in robo:
        ano = (o.get("data") or "")[:4]
        ib = por_nome.get(norm(o.get("municipio")))
        if not ib:
            sem_mun += 1
            continue
        rb[(ib, ano)]["ocorrencias"] += 1
        rb[(ib, ano)]["fatais"] += bool(o.get("fatal"))
    anos_ren = set(ren["serie"])
    linhas = []
    for (ib, ano), r in sorted(rb.items()):
        if ano not in anos_ren:
            continue
        a = ren["municipios"][ib]["anos"].get(ano, {})
        linhas.append({"ibge": ib, "municipio": ren["municipios"][ib]["nome"], "ano": ano, "robo": r["ocorrencias"], "robo_fatais": r["fatais"],
                       "oficial_am_xxx": a.get("am_xxx", 0), "oficial_am_xxx_fatais": a.get("am_xxx_fatais", 0),
                       "oficial_estadual": a.get("estadual", 0), "oficial_total": a.get("acidentes", 0), "oficial_com_obito": a.get("com_obito", 0)})
    pct = lambda x, y: round(100 * x / y, 1) if y else None
    por_ano = {}
    for l in linhas:
        p = por_ano.setdefault(l["ano"], {k: 0 for k in l if k not in ("ibge", "municipio", "ano")})
        for k in p:
            p[k] += l[k]
    for p in por_ano.values():
        p["pct_am_xxx"] = pct(p["robo"], p["oficial_am_xxx"])
        p["pct_fatais_am_xxx"] = pct(p["robo_fatais"], p["oficial_am_xxx_fatais"])
        p["pct_total"] = pct(p["robo"], p["oficial_total"])
        p["pct_fatais_total"] = pct(p["robo_fatais"], p["oficial_com_obito"])
    for l in linhas:
        l["pct_am_xxx"] = pct(l["robo"], l["oficial_am_xxx"])
        l["pct_fatais_total"] = pct(l["robo_fatais"], l["oficial_com_obito"])
    return {"por_ano": dict(sorted(por_ano.items())), "por_municipio_ano": linhas, "ocorrencias_sem_municipio": sem_mun}


# ── principal ─────────────────────────────────────────────────────────────────
def ultimo_ano_completo(serie):
    # o Detran-AM envia de forma irregular (2023 e 2024 vieram com 11 meses): aceita 11+ meses informados
    cheios = [a for a, v in serie.items() if v.get("meses", 0) >= 11]
    return max(cheios) if cheios else None


def main(amostra):
    agora = dt.datetime.now(dt.timezone(dt.timedelta(hours=-4))).strftime("%Y-%m-%d %H:%M")
    nome, url = renaest_recurso()
    print(f"RENAEST: {nome}", flush=True)
    z = abrir_zip(url, amostra)
    loc = list(linhas_am(z, "Localidade", amostra))
    ren = agrega_renaest(linhas_am(z, "Acidentes", amostra), linhas_am(z, "Vitimas", amostra), loc)
    ult = ultimo_ano_completo(ren["serie"])
    # qtde_habitantes do RENAEST vem errado no AM (Careiro da Várzea 80, Barcelos 1.091, Rio Preto da Eva 8.530; 23/11/2026).
    # Usa a estimativa do IBGE (SIDRA 6579, já gravada em data/mapa_municipios.json pelo robô do mapa) quando existir.
    try:
        ibge = json.load(open(os.path.join(RAIZ, "data", "mapa_municipios.json"), encoding="utf-8"))["municipios"]
    except Exception:
        ibge = {}
    for cod, m in ren["municipios"].items():
        if ibge.get(cod, {}).get("pop"):
            m["pop_renaest"], m["pop"], m["pop_fonte"] = m["pop"], ibge[cod]["pop"], "IBGE estimativa (SIDRA 6579)"
    pop_am = sum(m["pop"] or 0 for m in ren["municipios"].values())
    for m in ren["municipios"].values():  # taxa = óbitos / população x 100 mil (indicador OMS/ONSV)
        a = m["anos"].get(ult, {})
        m["taxa_obitos_100mil"] = round(a.get("obitos", 0) / m["pop"] * 1e5, 2) if m["pop"] and ult else None
    print(f"  municípios {len(ren['municipios'])}, anos {list(ren['serie'])}, último completo {ult}", flush=True)

    # PRF é opcional: o gov.br às vezes derruba a conexão do runner (Errno 104, 23/11/2026).
    # Se falhar, reaproveita a PRF da rodada anterior e segue com o RENAEST.
    anos_prf, prf_erro = [], None
    try:
        links = prf_links()
        anos_prf = sorted(a for a in links if a >= PRF_DESDE)
        if amostra:
            anos_prf = anos_prf[-1:]
        linhas = []
        for a in anos_prf:
            print(f"PRF {a}", flush=True)
            linhas += list(prf_linhas(a, links[a]))
        prf = agrega_prf(linhas)
    except Exception as e:
        prf_erro = f"{type(e).__name__}: {e}"
        print(f"  PRF indisponível ({prf_erro}); mantendo a rodada anterior", flush=True)
        try:
            ant = json.load(open(SAIDA, encoding="utf-8"))
            prf = ant["prf"]; anos_prf = ant["_meta"]["fontes"]["prf"].get("anos", [])
        except Exception:
            prf = agrega_prf([])

    robo = json.load(open(ROBO, encoding="utf-8"))["ocorrencias"] if os.path.exists(ROBO) else []
    cob = cobertura(robo, ren)
    sem = ren["serie"].get(ult, {})
    saida = {
        "_meta": {
            "gerado_em": agora, "amostra": amostra,
            "fonte": "RENAEST/SENATRAN (dados.transportes.gov.br) + PRF dados abertos (datatran)",
            "url": "https://dados.transportes.gov.br/dataset/renaest",
            "metodologia": "Filtro UF = AM. RENAEST por município (codigo_ibge) e ano; rodovia estadual pelo código AM-xxx no endereço do registro; PRF por BR e trechos de 10 km. Cobertura = ocorrências do robô de notícias / registros oficiais no mesmo município e ano.",
            "fontes": {
                "renaest": {"fonte": "SENATRAN, Registro Nacional de Sinistros e Estatísticas de Trânsito (Res. CONTRAN 808/2020)", "url": url, "arquivo": nome,
                            "periodo": [min(ren["serie"], default=None), max(ren["serie"], default=None)], "ultimo_ano_completo": ult,
                            "populacao": "estimativa IBGE (SIDRA 6579, data/mapa_municipios.json); o qtde_habitantes do RENAEST vem inconsistente no AM e fica só como pop_renaest",
                            "feridos": "vítimas com gravidade_lesao LEVE ou GRAVE (tabela Vitimas); a maioria das vítimas vem como NAO INFORMADO, então é piso",
                            "rodovia_estadual": "regex AM-xxx em end_acidente (estimativa por texto) e, à parte, tp_rodovia = ESTADUAL"},
                "prf": {"fonte": "Polícia Rodoviária Federal, dados abertos, Acidentes agrupados por ocorrência (datatran)", "url": PRF_PAG,
                        "anos": anos_prf, "escopo": "só rodovias federais patrulhadas pela PRF no AM",
                        "feridos": "feridos_leves + feridos_graves", "erro_ultima_coleta": prf_erro},
                "sim_datasus": {"status": "não incluído", "motivo": "arquivos DO do OpenDataSUS são nacionais e pesados; tabnet sem API. Candidato a etapa futura (CID-10 V01-V89 por município de ocorrência)."},
            },
            "cuidados": [
                "O RENAEST depende do envio de dados pelos órgãos de trânsito estaduais e municipais: há defasagem de meses e subnotificação. O Observatório Nacional de Segurança Viária (ONSV) aponta que o RENAEST registra menos óbitos que o SIM/DATASUS; trate os números como piso.",
                "O AM envia dados ao RENAEST de forma irregular (há anos com poucos meses ou quase nenhum registro); KPIs e taxas usam o último ano com pelo menos 11 meses informados.",
                "A identificação de AM-xxx depende de o endereço do registro trazer o código da rodovia.",
                "A PRF cobre só as BRs federais; a BR-319 e a BR-230 têm trechos com pouca fiscalização.",
            ],
        },
        "kpi": {"ano": ult, "obitos": sem.get("obitos"), "acidentes": sem.get("acidentes"), "com_obito": sem.get("com_obito"), "feridos": sem.get("feridos"),
                "populacao_am": pop_am or None, "taxa_obitos_100mil": round(sem.get("obitos", 0) / pop_am * 1e5, 2) if pop_am and ult else None},
        "renaest": ren, "prf": prf, "cobertura": cob,
    }
    if amostra:
        saida["_meta"]["cuidados"].insert(0, "AMOSTRA de teste local: não publicar.")
    with open(SAIDA + ".tmp", "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(SAIDA + ".tmp", SAIDA)
    print(f"ok -> {SAIDA} ({os.path.getsize(SAIDA) // 1024} KB)")


def teste():
    assert rodovia_do_endereco("ROD AM 010 KM 25") == "AM-010"
    assert rodovia_do_endereco("RODOVIA AM-070, KM 3") == "AM-070"
    assert rodovia_do_endereco("BR 174") == "BR-174"
    assert rodovia_do_endereco("RUA DAMASCO 100") is None  # "DAM" não pode virar AM
    assert norm("São Gabriel  da Cachoeira") == "SAO GABRIEL DA CACHOEIRA"
    loc = [{"codigo_ibge": "1302603", "ano_referencia": "2024", "municipio": "MANAUS", "qtde_habitantes": "2063547"}]
    ac = [{"codigo_ibge": "1302603", "ano_acidente": "2024", "mes_acidente": f"{m:02d}", "qtde_obitos": "1" if m == 1 else "0",
           "tp_rodovia": "ESTADUAL" if m < 3 else "MUNICIPAL", "end_acidente": "ROD AM 010" if m < 3 else "AV TORQUATO TAPAJOS"} for m in range(1, 13)]
    vi = [{"chv_localidade": "AM1302603202401", "ano_acidente": "2024", "gravidade_lesao": g} for g in ("LEVE", "GRAVE", "NAO INFORMADO")]
    r = agrega_renaest(ac, vi, loc)
    a = r["municipios"]["1302603"]["anos"]["2024"]
    assert (a["acidentes"], a["obitos"], a["com_obito"], a["feridos"], a["estadual"], a["am_xxx"], a["am_xxx_fatais"]) == (12, 1, 1, 2, 2, 2, 1), a
    assert r["serie"]["2024"]["meses"] == 12 and ultimo_ano_completo(r["serie"]) == "2024"
    assert r["rodovias"]["AM-010"]["2024"] == {"acidentes": 2, "obitos": 1}
    robo = [{"municipio": "Manaus", "data": "2024-03-01", "fatal": True}, {"municipio": "Manaus", "data": "2024-05-01", "fatal": False},
            {"municipio": None, "data": "2024-01-01"}]
    c = cobertura(robo, r)
    p = c["por_ano"]["2024"]
    assert (p["robo"], p["oficial_am_xxx"], p["pct_am_xxx"], p["pct_fatais_am_xxx"], p["pct_total"]) == (2, 2, 100.0, 100.0, 16.7), p
    assert c["ocorrencias_sem_municipio"] == 1
    prf = agrega_prf([{"data_inversa": "2025-12-21", "br": "174", "km": "970", "municipio": "MANAUS", "mortos": "1", "feridos_leves": "2", "feridos_graves": "1"},
                      {"data_inversa": "21/12/2018", "br": "319,0", "km": "5,4", "municipio": "CAREIRO", "mortos": "0", "feridos_leves": "0", "feridos_graves": "0"}])
    assert prf["brs"]["BR-174"]["total"] == {"acidentes": 1, "mortos": 1, "feridos": 3, "com_morte": 1}
    assert prf["brs"]["BR-319"]["anos"]["2018"]["acidentes"] == 1 and prf["brs"]["BR-174"]["trechos_criticos"][0]["km_ini"] == 970
    print("teste ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--teste", action="store_true")
    ap.add_argument("--amostra", action="store_true")
    a = ap.parse_args()
    teste() if a.teste else main(a.amostra)
